//! Upload an existing `.intunewin` as a Win32 LOB app. Packaging stays separate.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::io::AsyncReadExt;
use zip::ZipArchive;

use crate::app_catalog::{find_intune_win_path, read_catalog_app_config};
use crate::app_icon::resolve_catalog_large_icon;
use crate::graph::{GraphClient, GraphError};
use crate::win32_apps::win32_lob_body_from_catalog;

const CHUNK_SIZE: usize = 6 * 1024 * 1024;
const RENEW_AFTER: Duration = Duration::from_secs(450);
const SAS_SETTLE: Duration = Duration::from_secs(5);
const PUT_ATTEMPTS: u32 = 5;

#[derive(Debug, Error)]
pub enum IntuneWinError {
    #[error(transparent)]
    Graph(#[from] GraphError),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Win32UploadProgress {
    pub stage: &'static str,
    pub message: String,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Win32UploadResult {
    pub app_id: String,
    pub display_name: String,
    pub content_version_id: String,
    pub replaced: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

struct EncryptionInfo {
    encryption_key: String,
    mac_key: String,
    initialization_vector: String,
    mac: String,
    profile_identifier: String,
    file_digest: String,
    file_digest_algorithm: String,
}

struct ParsedPackage {
    inner_file_name: String,
    setup_file: String,
    unencrypted_size: u64,
    encrypted_size: u64,
    encryption: EncryptionInfo,
    encrypted_path: PathBuf,
    _temp: TempDir,
}

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> io::Result<Self> {
        let path = std::env::temp_dir().join(format!("axis-intunewin-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path)?;
        Ok(Self(path))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Debug, Deserialize)]
struct GraphId {
    id: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContentFileStatus {
    #[serde(default)]
    upload_state: String,
    #[serde(default)]
    azure_storage_uri: String,
}

struct AzureReject {
    message: String,
    auth_failed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Win32AppMatch {
    pub id: String,
    pub display_name: String,
    pub display_version: String,
    pub publisher: String,
    pub linked: bool,
}

/// Win32 apps already in the tenant with this package's name, plus the app this package uploaded before.
pub async fn find_catalog_upload_matches(
    access_token: &str,
    app_path: &str,
) -> Result<Vec<Win32AppMatch>, IntuneWinError> {
    let app_dir = PathBuf::from(app_path.trim());
    let document = read_catalog_app_config(app_path)
        .map_err(|error| IntuneWinError::Message(error.to_string()))?;
    let display_name = document
        .config
        .pointer("/application/name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if display_name.is_empty() {
        return Err(IntuneWinError::Message(
            "Display name is required before upload.".into(),
        ));
    }
    let linked_id = read_linked_app_id(&app_dir);
    let graph = GraphClient::new();
    let filter = format!(
        "displayName eq '{}' and (isof('microsoft.graph.win32LobApp') and not(isof('microsoft.graph.win32CatalogApp')))",
        display_name.replace('\'', "''")
    );
    let path = format!(
        "/deviceAppManagement/mobileApps?$filter={}&$select=id,displayName,publisher&$top=25",
        urlencoding::encode(&filter)
    );
    let page: crate::graph::GraphCollection<GraphAppRow> =
        graph.fetch_plain(access_token, &path, "beta").await?;
    let mut matches = page
        .value
        .into_iter()
        .filter(|row| is_win32_lob(&row.odata_type) || row.odata_type.is_empty())
        .map(|row| Win32AppMatch {
            linked: linked_id.as_deref() == Some(row.id.as_str()),
            id: row.id,
            display_name: row.display_name,
            display_version: row.display_version,
            publisher: row.publisher,
        })
        .collect::<Vec<_>>();
    if let Some(linked_id) = linked_id {
        if !matches.iter().any(|row| row.id == linked_id) {
            let linked_path = format!(
                "/deviceAppManagement/mobileApps/{}?$select=id,displayName,publisher",
                urlencoding::encode(&linked_id)
            );
            if let Ok(row) = graph
                .fetch_plain::<GraphAppRow>(access_token, &linked_path, "beta")
                .await
            {
                if is_win32_lob(&row.odata_type) || row.odata_type.is_empty() {
                    matches.insert(
                        0,
                        Win32AppMatch {
                            id: row.id,
                            display_name: row.display_name,
                            display_version: row.display_version,
                            publisher: row.publisher,
                            linked: true,
                        },
                    );
                }
            }
        }
    }
    Ok(matches)
}

/// Add or update one Win32 dependency on a parent app. Other relationships stay in place.
pub async fn link_win32_app_dependency(
    access_token: &str,
    parent_app_id: &str,
    target_app_id: &str,
    auto_install: bool,
) -> Result<(), IntuneWinError> {
    let parent_app_id = parent_app_id.trim();
    let target_app_id = target_app_id.trim();
    if parent_app_id.is_empty() || target_app_id.is_empty() {
        return Err(IntuneWinError::Message(
            "Both the app and its dependency need an Intune id before they can be linked.".into(),
        ));
    }
    if parent_app_id.eq_ignore_ascii_case(target_app_id) {
        return Err(IntuneWinError::Message(
            "An app cannot be a dependency of itself.".into(),
        ));
    }
    write_parent_relationship(
        access_token,
        parent_app_id,
        target_app_id,
        "dependency",
        Some(json!({
            "@odata.type": "#microsoft.graph.mobileAppDependency",
            "targetId": target_app_id,
            "dependencyType": if auto_install { "autoInstall" } else { "detect" },
        })),
    )
    .await
}

/// Remove one dependency from the app that requires it. Other relationships stay in place.
pub async fn unlink_win32_app_dependency(
    access_token: &str,
    parent_app_id: &str,
    target_app_id: &str,
) -> Result<(), IntuneWinError> {
    write_parent_relationship(access_token, parent_app_id, target_app_id, "dependency", None).await
}

/// The newer app supersedes the older one. `replace` uninstalls the older app; otherwise this is an update.
/// Other relationships stay in place.
pub async fn link_win32_app_supersedence(
    access_token: &str,
    newer_app_id: &str,
    older_app_id: &str,
    replace: bool,
) -> Result<(), IntuneWinError> {
    let newer_app_id = newer_app_id.trim();
    let older_app_id = older_app_id.trim();
    if newer_app_id.is_empty() || older_app_id.is_empty() {
        return Err(IntuneWinError::Message(
            "Both apps need an Intune id before one can supersede the other.".into(),
        ));
    }
    if newer_app_id.eq_ignore_ascii_case(older_app_id) {
        return Err(IntuneWinError::Message(
            "An app cannot supersede itself.".into(),
        ));
    }
    write_parent_relationship(
        access_token,
        newer_app_id,
        older_app_id,
        "supersedence",
        Some(json!({
            "@odata.type": "#microsoft.graph.mobileAppSupersedence",
            "targetId": older_app_id,
            "supersedenceType": if replace { "replace" } else { "update" },
        })),
    )
    .await
}

/// Remove one supersedence link from the newer app. Other relationships stay in place.
pub async fn unlink_win32_app_supersedence(
    access_token: &str,
    newer_app_id: &str,
    older_app_id: &str,
) -> Result<(), IntuneWinError> {
    write_parent_relationship(
        access_token,
        newer_app_id,
        older_app_id,
        "supersedence",
        None,
    )
    .await
}

async fn write_parent_relationship(
    access_token: &str,
    parent_app_id: &str,
    target_app_id: &str,
    drop_kind: &str,
    replacement: Option<Value>,
) -> Result<(), IntuneWinError> {
    let parent_app_id = parent_app_id.trim();
    let target_app_id = target_app_id.trim();
    if parent_app_id.is_empty() || target_app_id.is_empty() {
        return Err(IntuneWinError::Message(
            "Both the app and its dependency need an Intune id before they can be linked.".into(),
        ));
    }
    if parent_app_id.eq_ignore_ascii_case(target_app_id) {
        return Err(IntuneWinError::Message(
            "An app cannot be a dependency of itself.".into(),
        ));
    }
    let graph = GraphClient::new();
    let list_path = format!(
        "/deviceAppManagement/mobileApps/{}/relationships",
        urlencoding::encode(parent_app_id)
    );
    let page: crate::graph::GraphCollection<Value> =
        graph.fetch_plain(access_token, &list_path, "beta").await?;
    let mut relationships = Vec::new();
    for row in page.value {
        if let Some(kept) = kept_relationship(&row, parent_app_id, target_app_id, drop_kind) {
            relationships.push(kept);
        }
    }
    if let Some(next) = replacement {
        relationships.push(next);
    }
    graph
        .post_no_content(
            access_token,
            &format!(
                "/deviceAppManagement/mobileApps/{}/updateRelationships",
                urlencoding::encode(parent_app_id)
            ),
            "beta",
            &json!({ "relationships": relationships }),
        )
        .await?;
    Ok(())
}

fn kept_relationship(
    row: &Value,
    parent_app_id: &str,
    replace_target_id: &str,
    drop_kind: &str,
) -> Option<Value> {
    // Graph lists the same link from both apps. On the dependency, targetType is
    // "parent" (or sourceId is the app that requires it). Writing that row back
    // would make the parent a dependency of the child and block the next link.
    if !outgoing_relationship(row, parent_app_id) {
        return None;
    }
    let target = row.get("targetId").and_then(Value::as_str)?.trim();
    if target.is_empty() {
        return None;
    }
    let odata = row.get("@odata.type").and_then(Value::as_str).unwrap_or("");
    let dependency_type = row.get("dependencyType").and_then(Value::as_str);
    let supersedence_type = row.get("supersedenceType").and_then(Value::as_str);
    let lower = odata.to_ascii_lowercase();
    let kind = if lower.contains("supersedence") || supersedence_type.is_some() {
        "supersedence"
    } else if lower.contains("dependency") || dependency_type.is_some() {
        "dependency"
    } else {
        return None;
    };
    if target.eq_ignore_ascii_case(replace_target_id) && kind == drop_kind {
        return None;
    }
    if kind == "supersedence" {
        return Some(json!({
            "@odata.type": "#microsoft.graph.mobileAppSupersedence",
            "targetId": target,
            "supersedenceType": supersedence_type.unwrap_or("update"),
        }));
    }
    if lower.contains("dependency") || dependency_type.is_some() {
        return Some(json!({
            "@odata.type": "#microsoft.graph.mobileAppDependency",
            "targetId": target,
            "dependencyType": dependency_type.unwrap_or("detect"),
        }));
    }
    None
}

fn outgoing_relationship(row: &Value, parent_app_id: &str) -> bool {
    let target_type = row
        .get("targetType")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if target_type == "parent" {
        return false;
    }
    if target_type == "child" {
        return true;
    }
    match row
        .get("sourceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(source_id) => source_id.eq_ignore_ascii_case(parent_app_id),
        None => true,
    }
}

pub async fn upload_catalog_win32(
    access_token: &str,
    app_path: &str,
    existing_app_id: Option<&str>,
    content_only: bool,
    on_progress: impl Fn(Win32UploadProgress) + Send,
) -> Result<Win32UploadResult, IntuneWinError> {
    let app_dir = PathBuf::from(app_path.trim());
    report(&on_progress, "prepare", "Reading the .intunewin package…", 2);
    let intune_win = find_intune_win_path(&app_dir).ok_or_else(|| {
        IntuneWinError::Message(
            "No .intunewin file is attached. Add one under Output before uploading.".into(),
        )
    })?;
    let package_file_name = intune_win
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "package.intunewin".into());
    let intune_win_for_parse = intune_win.clone();
    let package = tokio::task::spawn_blocking(move || parse_intunewin(&intune_win_for_parse))
        .await
        .map_err(|error| IntuneWinError::Message(error.to_string()))??;

    let document = read_catalog_app_config(app_path)
        .map_err(|error| IntuneWinError::Message(error.to_string()))?;
    let large_icon = resolve_catalog_large_icon(&app_dir, &document.config)
        .await
        .map_err(|error| IntuneWinError::Message(error.to_string()))?;
    let mut body = win32_lob_body_from_catalog(
        &document.config,
        &package_file_name,
        &package.setup_file,
    )?;
    if let Some(icon) = &large_icon {
        if let Some(map) = body.as_object_mut() {
            map.insert("largeIcon".into(), icon.clone());
        }
    }
    let display_name = body
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or("Win32 app")
        .to_string();
    let existing_id = existing_app_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    let replacing = existing_id.is_some();
    let content_only = replacing && content_only;
    let graph = GraphClient::new();

    let app_id = if let Some(app_id) = existing_id {
        report(
            &on_progress,
            "createApp",
            if content_only {
                "Replacing the package on the existing app…"
            } else {
                "Overwriting the existing app…"
            },
            8,
        );
        app_id
    } else {
        report(&on_progress, "createApp", "Creating the Win32 app…", 8);
        let created: GraphId = graph
            .post(access_token, "/deviceAppManagement/mobileApps", "beta", &body)
            .await?;
        id_string(&created.id).ok_or_else(|| {
            IntuneWinError::Message("Graph did not return a mobile app id.".into())
        })?
    };

    report(&on_progress, "contentVersion", "Creating a content version…", 12);
    let version_path = format!(
        "/deviceAppManagement/mobileApps/{}/microsoft.graph.win32LobApp/contentVersions",
        urlencoding::encode(&app_id)
    );
    let content_version: GraphId = match graph
        .post(access_token, &version_path, "beta", &json!({}))
        .await
    {
        Ok(version) => version,
        Err(error) => return Err(missing_app_hint(error, replacing, &app_id)),
    };
    let content_version_id = id_string(&content_version.id)
        .ok_or_else(|| IntuneWinError::Message("Graph did not return a content version id.".into()))?;

    report(&on_progress, "createFile", "Registering the content file…", 15);
    let files_path = format!(
        "{version_path}/{}/files",
        urlencoding::encode(&content_version_id)
    );
    let file: GraphId = graph
        .post(
            access_token,
            &files_path,
            "beta",
            &json!({
                "@odata.type": "#microsoft.graph.mobileAppContentFile",
                "name": package.inner_file_name,
                "size": package.unencrypted_size,
                "sizeEncrypted": package.encrypted_size,
                "isDependency": false,
            }),
        )
        .await?;
    let file_id = id_string(&file.id)
        .ok_or_else(|| IntuneWinError::Message("Graph did not return a content file id.".into()))?;
    let file_path = format!("{files_path}/{}", urlencoding::encode(&file_id));

    report(
        &on_progress,
        "waitSas",
        "Waiting for Azure storage…",
        18,
    );
    let ready = wait_for_upload_state(
        &graph,
        access_token,
        &file_path,
        "azureStorageUriRequestSuccess",
    )
    .await?;
    if ready.azure_storage_uri.is_empty() {
        return Err(IntuneWinError::Message(
            "Graph did not return an Azure storage URI.".into(),
        ));
    }

    report(
        &on_progress,
        "upload",
        "Uploading the encrypted package…",
        20,
    );
    upload_encrypted_blocks(
        access_token,
        &file_path,
        ready.azure_storage_uri,
        &package.encrypted_path,
        |uploaded, total| {
            let fraction = if total == 0 { 1.0 } else { uploaded as f64 / total as f64 };
            let percent = (20.0 + fraction * 70.0).round().clamp(20.0, 90.0) as u8;
            let file_percent = if total == 0 {
                100
            } else {
                ((uploaded as f64 / total as f64) * 100.0).round() as u64
            };
            report(
                &on_progress,
                "upload",
                format!("Uploading package… {file_percent}%"),
                percent,
            );
        },
    )
    .await?;

    report(&on_progress, "commitFile", "Committing the content file…", 92);
    graph
        .post_no_content(
            access_token,
            &format!("{file_path}/commit"),
            "beta",
            &encryption_commit_body(&package.encryption),
        )
        .await?;
    wait_for_upload_state(&graph, access_token, &file_path, "commitFileSuccess").await?;

    report(
        &on_progress,
        "commitApp",
        if replacing && content_only {
            "Committing the replaced package…"
        } else if replacing {
            "Committing the overwritten app…"
        } else {
            "Committing the app content version…"
        },
        97,
    );
    if let Some(map) = body.as_object_mut() {
        map.insert(
            "committedContentVersion".into(),
            json!(content_version_id),
        );
    }
    let mut commit_body = if replacing && !content_only {
        body
    } else {
        json!({
            "@odata.type": "#microsoft.graph.win32LobApp",
            "committedContentVersion": content_version_id,
        })
    };
    if !replacing {
        if let Some(icon) = large_icon {
            if let Some(map) = commit_body.as_object_mut() {
                map.insert("largeIcon".into(), icon);
            }
        }
    }
    graph
        .patch_no_content(
            access_token,
            &format!("/deviceAppManagement/mobileApps/{}", urlencoding::encode(&app_id)),
            "beta",
            &commit_body,
        )
        .await?;

    let warning = match write_content_meta(
        &app_dir,
        &app_id,
        &content_version_id,
        &file_id,
        &display_name,
        &package_file_name,
        &package.encryption,
    ) {
        Ok(()) => None,
        Err(error) => Some(format!(
            "Upload committed, but PackageInformation/intune-content.json was not saved: {error}"
        )),
    };

    report(
        &on_progress,
        "done",
        if replacing {
            "Content update complete."
        } else {
            "Upload complete."
        },
        100,
    );
    Ok(Win32UploadResult {
        app_id,
        display_name,
        content_version_id,
        replaced: replacing,
        warning,
    })
}

fn report(
    on_progress: &impl Fn(Win32UploadProgress),
    stage: &'static str,
    message: impl Into<String>,
    percent: u8,
) {
    on_progress(Win32UploadProgress {
        stage,
        message: message.into(),
        percent,
    });
}

fn parse_intunewin(path: &Path) -> Result<ParsedPackage, IntuneWinError> {
    let xml = detection_xml(path)?;
    let info = element_block(&xml, "ApplicationInfo").unwrap_or(xml);
    let encryption_xml = element_block(&info, "EncryptionInfo").ok_or_else(|| {
        IntuneWinError::Message("EncryptionInfo is missing from Detection.xml.".into())
    })?;
    let inner_file_name = element_text(&info, "FileName").ok_or_else(|| {
        IntuneWinError::Message("ApplicationInfo.FileName is missing from Detection.xml.".into())
    })?;
    let setup_file = element_text(&info, "SetupFile").unwrap_or_default();
    let unencrypted_size = element_text(&info, "UnencryptedContentSize")
        .unwrap_or_default()
        .parse::<u64>()
        .unwrap_or(0);
    let encryption = EncryptionInfo {
        encryption_key: require_base64("EncryptionKey", &element_text(&encryption_xml, "EncryptionKey").unwrap_or_default(), 32)?,
        mac_key: require_base64("MacKey", &element_text(&encryption_xml, "MacKey").unwrap_or_default(), 32)?,
        initialization_vector: require_base64(
            "InitializationVector",
            &element_text(&encryption_xml, "InitializationVector").unwrap_or_default(),
            16,
        )?,
        mac: require_base64("Mac", &element_text(&encryption_xml, "Mac").unwrap_or_default(), 32)?,
        profile_identifier: element_text(&encryption_xml, "ProfileIdentifier")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "ProfileVersion1".into()),
        file_digest: require_base64(
            "FileDigest",
            &element_text(&encryption_xml, "FileDigest").unwrap_or_default(),
            32,
        )?,
        file_digest_algorithm: element_text(&encryption_xml, "FileDigestAlgorithm")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "SHA256".into()),
    };
    let temp = TempDir::new()?;
    let encrypted_path = temp.0.join(safe_file_name(&inner_file_name));
    let encrypted_size = extract_entry(path, &inner_file_name, &encrypted_path)?;
    Ok(ParsedPackage {
        inner_file_name,
        setup_file,
        unencrypted_size,
        encrypted_size,
        encryption,
        encrypted_path,
        _temp: temp,
    })
}

fn detection_xml(path: &Path) -> Result<String, IntuneWinError> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(zip_error)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        if entry.is_dir() {
            continue;
        }
        if !entry.name().to_ascii_lowercase().ends_with("detection.xml") {
            continue;
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        return Ok(xml_to_string(&bytes));
    }
    Err(IntuneWinError::Message(
        "Detection.xml was not found inside the .intunewin package.".into(),
    ))
}

fn extract_entry(path: &Path, inner_name: &str, dest: &Path) -> Result<u64, IntuneWinError> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(zip_error)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        if entry.is_dir() || !entry_matches(entry.name(), inner_name) {
            continue;
        }
        let mut output = File::create(dest)?;
        io::copy(&mut entry, &mut output)?;
        return Ok(output.metadata()?.len());
    }
    Err(IntuneWinError::Message(format!(
        "Encrypted content file \"{inner_name}\" was not found in the .intunewin package."
    )))
}

fn entry_matches(entry_name: &str, inner_name: &str) -> bool {
    let entry = entry_name.replace('\\', "/");
    entry == inner_name || entry.ends_with(&format!("/{inner_name}"))
}

fn xml_to_string(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .to_string()
}

fn element_block(xml: &str, name: &str) -> Option<String> {
    element_text(xml, name)
}

fn element_text(xml: &str, name: &str) -> Option<String> {
    let lower = xml.to_ascii_lowercase();
    let open = format!("<{name}").to_ascii_lowercase();
    let mut search_from = 0;
    while let Some(relative) = lower[search_from..].find(&open) {
        let start = search_from + relative;
        let after = &xml[start + 1..];
        let after_lower = &lower[start + 1..];
        let boundary = after_lower.as_bytes().get(name.len()).copied();
        if !matches!(
            boundary,
            Some(b'>') | Some(b' ') | Some(b'/') | Some(b'\t') | Some(b'\n') | Some(b'\r')
        ) {
            search_from = start + 1;
            continue;
        }
        let end_of_open = after.find('>')?;
        if after.as_bytes().get(end_of_open.wrapping_sub(1)) == Some(&b'/') {
            return Some(String::new());
        }
        let content_start = start + 1 + end_of_open + 1;
        let close = format!("</{name}>").to_ascii_lowercase();
        let end = lower[content_start..].find(&close)?;
        return Some(xml[content_start..content_start + end].trim().to_string());
    }
    None
}

fn require_base64(label: &str, value: &str, expected: usize) -> Result<String, IntuneWinError> {
    let compact: String = value.chars().filter(|ch| !ch.is_whitespace()).collect();
    if compact.is_empty() {
        return Err(IntuneWinError::Message(format!(
            "Detection.xml EncryptionInfo.{label} is missing."
        )));
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&compact)
        .map_err(|_| {
            IntuneWinError::Message(format!(
                "Detection.xml EncryptionInfo.{label} is not valid base64."
            ))
        })?;
    if decoded.len() != expected {
        return Err(IntuneWinError::Message(format!(
            "Detection.xml EncryptionInfo.{label} decodes to {} bytes; expected {expected}.",
            decoded.len()
        )));
    }
    Ok(compact)
}

fn safe_file_name(name: &str) -> String {
    Path::new(name)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty() && value != "." && value != "..")
        .unwrap_or_else(|| "IntunePackage.intunewin".into())
}

fn encryption_commit_body(encryption: &EncryptionInfo) -> Value {
    json!({
        "fileEncryptionInfo": {
            "encryptionKey": encryption.encryption_key,
            "macKey": encryption.mac_key,
            "initializationVector": encryption.initialization_vector,
            "mac": encryption.mac,
            "profileIdentifier": encryption.profile_identifier,
            "fileDigest": encryption.file_digest,
            "fileDigestAlgorithm": encryption.file_digest_algorithm,
        }
    })
}

fn id_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
struct GraphAppRow {
    id: String,
    #[serde(default, rename = "displayName")]
    display_name: String,
    #[serde(default, rename = "displayVersion")]
    display_version: String,
    #[serde(default)]
    publisher: String,
    #[serde(default, rename = "@odata.type")]
    odata_type: String,
}

fn is_win32_lob(odata_type: &str) -> bool {
    let lower = odata_type.to_ascii_lowercase();
    lower.contains("win32lobapp") && !lower.contains("win32catalogapp")
}

fn read_linked_app_id(app_dir: &Path) -> Option<String> {
    let text = fs::read_to_string(app_dir.join("PackageInformation").join("intune-content.json")).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let id = value.get("intuneAppId")?.as_str()?.trim().to_string();
    if id.is_empty() { None } else { Some(id) }
}

fn write_content_meta(
    app_dir: &Path,
    app_id: &str,
    content_version_id: &str,
    file_id: &str,
    display_name: &str,
    file_name: &str,
    encryption: &EncryptionInfo,
) -> Result<(), IntuneWinError> {
    let dir = app_dir.join("PackageInformation");
    fs::create_dir_all(&dir)?;
    let body = json!({
        "schemaVersion": 1,
        "intuneAppId": app_id,
        "contentVersionId": content_version_id,
        "fileId": file_id,
        "displayName": display_name,
        "fileName": file_name,
        "uploadedAt": chrono::Utc::now().to_rfc3339(),
        "fileEncryptionInfo": encryption_commit_body(encryption)["fileEncryptionInfo"],
    });
    let mut text = serde_json::to_string_pretty(&body)
        .map_err(|error| IntuneWinError::Message(error.to_string()))?;
    text.push('\n');
    fs::write(dir.join("intune-content.json"), text)?;
    Ok(())
}

fn missing_app_hint(error: GraphError, replacing: bool, app_id: &str) -> IntuneWinError {
    if replacing && error.status() == Some(404) {
        IntuneWinError::Message(format!(
            "{error} This package is linked to Intune app {app_id}. Delete PackageInformation/intune-content.json to upload it as a new app."
        ))
    } else {
        IntuneWinError::Graph(error)
    }
}

async fn wait_for_upload_state(
    graph: &GraphClient,
    access_token: &str,
    path: &str,
    expected: &str,
) -> Result<ContentFileStatus, IntuneWinError> {
    let expected_norm = normalize_state(expected);
    for _ in 0..90 {
        let status: ContentFileStatus = graph.fetch(access_token, path, "beta").await?;
        let state = normalize_state(&status.upload_state);
        if state == expected_norm {
            return Ok(status);
        }
        if state.contains("failed") || state.contains("timedout") {
            return Err(IntuneWinError::Message(format!(
                "Content file entered {state} while waiting for {expected}."
            )));
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Err(IntuneWinError::Message(format!(
        "Timed out waiting for content file state {expected}."
    )))
}

async fn upload_encrypted_blocks(
    access_token: &str,
    file_path: &str,
    mut sas_uri: String,
    encrypted_path: &Path,
    on_bytes: impl Fn(u64, u64),
) -> Result<(), IntuneWinError> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()?;
    tokio::time::sleep(SAS_SETTLE).await;
    let mut file = tokio::fs::File::open(encrypted_path).await?;
    let total = file.metadata().await?.len();
    if total == 0 {
        return Err(IntuneWinError::Message(
            "The encrypted package inside the .intunewin file is empty.".into(),
        ));
    }
    let graph = GraphClient::new();
    let mut block_ids = Vec::new();
    let mut offset = 0u64;
    let mut index = 0u32;
    let mut chunks_uploaded = 0u32;
    let mut renew_started = Instant::now();
    let mut buffer = vec![0u8; CHUNK_SIZE];

    while offset < total {
        let want = usize::try_from(total - offset).unwrap_or(CHUNK_SIZE).min(CHUNK_SIZE);
        file.read_exact(&mut buffer[..want]).await?;
        let block_id = block_id_for(index);
        put_block_with_retry(
            &http,
            &graph,
            access_token,
            file_path,
            &mut sas_uri,
            &block_id,
            &buffer[..want],
            chunks_uploaded,
        )
        .await?;
        block_ids.push(block_id);
        offset += want as u64;
        index += 1;
        chunks_uploaded += 1;
        on_bytes(offset, total);
        if offset < total && renew_started.elapsed() >= RENEW_AFTER {
            if let Some(renewed) = try_renew_sas(&graph, access_token, file_path).await {
                sas_uri = renewed;
            }
            renew_started = Instant::now();
        }
    }

    let mut finalize_attempts = 0u32;
    loop {
        match put_block_list(&http, &sas_uri, &block_ids).await {
            Ok(()) => break,
            Err(error) if error.auth_failed && finalize_attempts < PUT_ATTEMPTS => {
                finalize_attempts += 1;
                if finalize_attempts < 3 {
                    tokio::time::sleep(Duration::from_secs(2 * u64::from(finalize_attempts))).await;
                    continue;
                }
                if let Some(renewed) = try_renew_sas(&graph, access_token, file_path).await {
                    sas_uri = renewed;
                } else {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
            Err(error) => {
                return Err(IntuneWinError::Message(error.message));
            }
        }
    }
    Ok(())
}

async fn put_block_with_retry(
    http: &reqwest::Client,
    graph: &GraphClient,
    access_token: &str,
    file_path: &str,
    sas_uri: &mut String,
    block_id: &str,
    bytes: &[u8],
    chunks_uploaded: u32,
) -> Result<(), IntuneWinError> {
    let mut last_message = String::new();
    for attempt in 1..=PUT_ATTEMPTS {
        match put_block(http, sas_uri, block_id, bytes).await {
            Ok(()) => return Ok(()),
            Err(error) if error.auth_failed && attempt < PUT_ATTEMPTS => {
                last_message = error.message;
                let should_renew = chunks_uploaded > 0 && attempt >= 3;
                if !should_renew {
                    tokio::time::sleep(Duration::from_secs(2 * u64::from(attempt))).await;
                    continue;
                }
                match renew_sas(graph, access_token, file_path).await {
                    Ok(renewed) => *sas_uri = renewed,
                    Err(renew_error) => {
                        last_message = renew_error.to_string();
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                }
            }
            Err(error) => return Err(IntuneWinError::Message(error.message)),
        }
    }
    Err(IntuneWinError::Message(if last_message.is_empty() {
        "Azure block upload failed.".into()
    } else {
        last_message
    }))
}

async fn put_block(
    http: &reqwest::Client,
    sas_uri: &str,
    block_id: &str,
    bytes: &[u8],
) -> Result<(), AzureReject> {
    let url = append_sas_query(sas_uri, &format!("comp=block&blockid={block_id}"));
    let response = http
        .put(url)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(bytes.to_vec())
        .send()
        .await
        .map_err(|error| AzureReject {
            message: error.to_string(),
            auth_failed: false,
        })?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    Err(AzureReject {
        auth_failed: is_azure_auth_failure(status, &body),
        message: format!("Azure block upload failed ({status}): {}", trim_body(&body)),
    })
}

async fn put_block_list(
    http: &reqwest::Client,
    sas_uri: &str,
    block_ids: &[String],
) -> Result<(), AzureReject> {
    let items = block_ids
        .iter()
        .map(|id| format!("<Latest>{id}</Latest>"))
        .collect::<String>();
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><BlockList>{items}</BlockList>"
    );
    let url = append_sas_query(sas_uri, "comp=blocklist");
    let response = http
        .put(url)
        .header(reqwest::header::CONTENT_TYPE, "application/xml")
        .body(xml)
        .send()
        .await
        .map_err(|error| AzureReject {
            message: error.to_string(),
            auth_failed: false,
        })?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    Err(AzureReject {
        auth_failed: is_azure_auth_failure(status, &body),
        message: format!(
            "Azure block list finalize failed ({status}): {}",
            trim_body(&body)
        ),
    })
}

async fn try_renew_sas(
    graph: &GraphClient,
    access_token: &str,
    file_path: &str,
) -> Option<String> {
    renew_sas(graph, access_token, file_path).await.ok()
}

async fn renew_sas(
    graph: &GraphClient,
    access_token: &str,
    file_path: &str,
) -> Result<String, IntuneWinError> {
    let mut last = IntuneWinError::Message("SAS renewal failed.".into());
    for attempt in 1u32..=3 {
        match renew_sas_once(graph, access_token, file_path).await {
            Ok(uri) => return Ok(uri),
            Err(error) => {
                last = error;
                tokio::time::sleep(Duration::from_secs(8 * u64::from(attempt))).await;
            }
        }
    }
    Err(last)
}

async fn renew_sas_once(
    graph: &GraphClient,
    access_token: &str,
    file_path: &str,
) -> Result<String, IntuneWinError> {
    graph
        .post_empty(access_token, &format!("{file_path}/renewUpload"), "beta")
        .await?;
    for _ in 0..60 {
        let status: ContentFileStatus = graph.fetch(access_token, file_path, "beta").await?;
        let state = normalize_state(&status.upload_state);
        if state == "azurestorageurirenewalsuccess" {
            if status.azure_storage_uri.is_empty() {
                return Err(IntuneWinError::Message(
                    "SAS renewal succeeded but Graph returned no storage URI.".into(),
                ));
            }
            tokio::time::sleep(SAS_SETTLE).await;
            return Ok(status.azure_storage_uri);
        }
        if state == "azurestorageurirenewalfailed" || state == "azurestorageurirenewaltimedout" {
            return Err(IntuneWinError::Message(format!(
                "SAS renewal failed with uploadState={}.",
                status.upload_state
            )));
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Err(IntuneWinError::Message(
        "Timed out renewing the Azure storage upload URI.".into(),
    ))
}

fn block_id_for(index: u32) -> String {
    base64::engine::general_purpose::STANDARD.encode(format!("{index:04}").as_bytes())
}

fn append_sas_query(sas_uri: &str, query: &str) -> String {
    if sas_uri.contains('?') {
        format!("{sas_uri}&{query}")
    } else {
        format!("{sas_uri}?{query}")
    }
}

fn is_azure_auth_failure(status: u16, body: &str) -> bool {
    (status == 401 || status == 403)
        && (body.contains("AuthenticationFailed")
            || body.to_ascii_lowercase().contains("signature")
            || body.to_ascii_lowercase().contains("expired")
            || body.to_ascii_lowercase().contains("forbidden"))
}

fn normalize_state(state: &str) -> String {
    state
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn trim_body(body: &str) -> String {
    let compact = body.trim().replace('\n', " ");
    compact.chars().take(300).collect()
}

fn zip_error(error: zip::result::ZipError) -> IntuneWinError {
    IntuneWinError::Message(error.to_string())
}
