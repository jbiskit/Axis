//! Local Win32 package housing.
//!
//! The source location is the library root. Packages live at
//! `{source}/Applications/{Vendor}/{App}/{Version}/PackageInformation/config.json`.
//! The source location is never the `Applications` folder itself.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const APPLICATIONS_DIR: &str = "Applications";
const PACKAGE_INFO_DIR: &str = "PackageInformation";
const CONFIG_FILE: &str = "config.json";

const RESERVED_SOURCE_CHILD_DIRS: &[&str] = &[
    "applications",
    "scripts",
    "policies",
    "remediations",
];

const SKIP_WALK_DIRS: &[&str] = &[
    "node_modules",
    "output",
    "psappdeploytoolkit",
    "files",
    "config",
    ".git",
    ".appforge-cache",
];

fn ps_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn detection_name_script(display_name: &str) -> String {
    let name = ps_literal(display_name);
    format!(
        r#"# Check that the app is installed (registry detection).
# Exit 0 when an uninstall key DisplayName matches. Exit 1 otherwise.
# Intune counts the app as detected only when the script exits 0 and writes to the output stream.

$applicationDisplayName = {name}
$uninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$application = Get-ChildItem -Path $uninstallRoots -ErrorAction SilentlyContinue |
    Get-ItemProperty -ErrorAction SilentlyContinue |
    Where-Object {{ $_.DisplayName -match [regex]::Escape($applicationDisplayName) }} |
    Select-Object -First 1

if ($application) {{
    Write-Output 'Installed'
    exit 0
}}

Write-Output 'Not Installed'
exit 1
"#
    )
}

fn detection_version_script(display_name: &str, version: &str) -> String {
    let name = ps_literal(display_name);
    let version = ps_literal(version);
    format!(
        r#"# Check for a specific version (registry detection).
# Exit 0 when DisplayName matches and DisplayVersion is greater than or equal to $version.
# Exit 1 when the app is missing or older.
# A name-only check, without a version, is in detection-name.ps1.
# Intune counts the app as detected only when the script exits 0 and writes to the output stream.

$applicationDisplayName = {name}
$version = {version}
$uninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$applicationDetection = Get-ChildItem -Path $uninstallRoots -ErrorAction SilentlyContinue |
    Get-ItemProperty -ErrorAction SilentlyContinue |
    Where-Object {{ $_.DisplayName -match [regex]::Escape($applicationDisplayName) }} |
    Select-Object -First 1 DisplayName, DisplayVersion

if ($applicationDetection) {{
    Write-Output "$($applicationDisplayName) detected as installed with version $($applicationDetection.DisplayVersion)"
    if ($applicationDetection.DisplayVersion -ge $version) {{
        # -lt less than
        # -eq equal to
        # -gt greater than
        # -ge greater than or equal to
        # -le less than or equal to
        Write-Output "$($applicationDisplayName) is up to date"
        exit 0
    }}
    Write-Output "$($applicationDisplayName) is not up to date"
    exit 1
}}

Write-Output "$($applicationDisplayName) is not installed"
exit 1
"#
    )
}

fn stamp_detection_version(package_info: &Path, version: &str) {
    let path = package_info.join("detection.ps1");
    let Ok(text) = fs::read_to_string(&path) else {
        return;
    };
    let mut changed = false;
    let mut out = String::new();
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start().trim_end_matches(['\r', '\n']);
        if trimmed.starts_with("$version ") || trimmed.starts_with("$version=") {
            let ending = if line.ends_with("\r\n") {
                "\r\n"
            } else if line.ends_with('\n') {
                "\n"
            } else {
                ""
            };
            out.push_str("$version = ");
            out.push_str(&ps_literal(version));
            out.push_str(ending);
            changed = true;
        } else {
            out.push_str(line);
        }
    }
    if changed {
        let _ = fs::write(path, out);
    }
}

#[derive(Debug, Error)]
pub enum AppCatalogError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAppSummary {
    pub id: String,
    pub vendor: String,
    pub name: String,
    pub version: String,
    pub local_path: String,
    pub relative_path: String,
    pub has_config: bool,
    pub has_intune_win: bool,
    /// Intune Win32 fields still empty: name, file, description, publisher,
    /// install and uninstall commands, architecture, minimum OS, or detection.
    #[serde(default)]
    pub missing_required: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCatalogAppInput {
    /// Ignored when a client container is open. The command fills this from the open container.
    #[serde(default)]
    pub source_root: String,
    pub vendor: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyCatalogAppInput {
    pub source_app_path: String,
    pub new_version: String,
    /// Used when no client container is open.
    #[serde(default)]
    pub source_root: Option<String>,
}

/// Assert `location` is a source root, not `…/Applications` (or Scripts / Policies).
pub fn assert_source_root(source_location: &str) -> Result<PathBuf, AppCatalogError> {
    let trimmed = source_location
        .trim()
        .trim_end_matches(|ch: char| ch == '\\' || ch == '/');
    if trimmed.is_empty() {
        return Err(AppCatalogError::Message(
            "Source folder path is required.".into(),
        ));
    }
    let resolved = PathBuf::from(trimmed);
    if !resolved.is_dir() {
        return Err(AppCatalogError::Message(format!(
            "Source root not found: {}",
            resolved.display()
        )));
    }
    let base = resolved
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if RESERVED_SOURCE_CHILD_DIRS.iter().any(|name| *name == base) {
        let parent = resolved
            .parent()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| resolved.display().to_string());
        return Err(AppCatalogError::Message(format!(
            "Source location must be the source root, not the {base} folder. Use {parent} instead."
        )));
    }
    Ok(resolved)
}

pub fn list_catalog_apps(source_root: &str) -> Result<Vec<CatalogAppSummary>, AppCatalogError> {
    let root = assert_source_root(source_root)?;
    let apps_root = root.join(APPLICATIONS_DIR);
    if !apps_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut apps = Vec::new();
    discover_apps(&apps_root, "", &mut apps)?;
    apps.sort_by(|a, b| {
        format!("{}/{}/{}", a.vendor, a.name, a.version)
            .to_lowercase()
            .cmp(&format!("{}/{}/{}", b.vendor, b.name, b.version).to_lowercase())
    });
    Ok(apps)
}

pub fn create_catalog_app(input: CreateCatalogAppInput) -> Result<CatalogAppSummary, AppCatalogError> {
    let root = assert_source_root(&input.source_root)?;
    let vendor = sanitize_catalog_segment(&input.vendor)?;
    let name = sanitize_catalog_segment(&input.name)?;
    let version = sanitize_catalog_segment(&input.version)?;
    let apps_root = root.join(APPLICATIONS_DIR);
    fs::create_dir_all(&apps_root)?;
    let app_path = apps_root.join(&vendor).join(&name).join(&version);
    let config_path = app_path.join(PACKAGE_INFO_DIR).join(CONFIG_FILE);
    if config_path.is_file() {
        return Err(AppCatalogError::Message(format!(
            "An app already exists at {vendor}/{name}/{version}. Open it from the catalog list instead."
        )));
    }
    if app_path.is_dir() {
        let occupied = fs::read_dir(&app_path)?.any(|entry| entry.is_ok());
        if occupied {
            return Err(AppCatalogError::Message(format!(
                "Folder already exists and is not empty: {vendor}/{name}/{version}"
            )));
        }
    }
    let package_info = app_path.join(PACKAGE_INFO_DIR);
    fs::create_dir_all(&package_info)?;
    fs::create_dir_all(app_path.join("Output"))?;
    let marker = app_path.join("Output").join(".gitinclude");
    if !marker.exists() {
        fs::write(marker, b"")?;
    }
    fs::write(
        package_info.join("detection.ps1"),
        detection_version_script(&name, &version),
    )?;
    fs::write(
        package_info.join("detection-name.ps1"),
        detection_name_script(&name),
    )?;
    let publisher = input
        .publisher
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(vendor.as_str());
    let description = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let config = seed_config(&name, &vendor, &version, publisher, description);
    let mut text = serde_json::to_string_pretty(&config)?;
    text.push('\n');
    fs::write(&config_path, text)?;
    Ok(summary_for_app(
        &app_path,
        &format!("{vendor}/{name}/{version}"),
        true,
    ))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAppDocument {
    pub app_path: String,
    pub config_path: String,
    pub config: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intune_win_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_preview: Option<crate::app_icon::CatalogIconPreview>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCatalogAppInput {
    pub app_path: String,
    pub config: Value,
}

pub fn read_catalog_app_config(app_path: &str) -> Result<CatalogAppDocument, AppCatalogError> {
    let app = package_dir(app_path)?;
    let config_path = app.join(PACKAGE_INFO_DIR).join(CONFIG_FILE);
    if !config_path.is_file() {
        return Err(AppCatalogError::Message(format!(
            "No PackageInformation/config.json in {}",
            app.display()
        )));
    }
    let text = fs::read_to_string(&config_path)?;
    let mut config: Value = serde_json::from_str(&text)?;
    if !config.is_object() {
        return Err(AppCatalogError::Message(
            "config.json must be a JSON object.".into(),
        ));
    }
    hydrate_detection_scripts(&app, &mut config);
    let icon_preview = crate::app_icon::preview_catalog_icon(&app, &config);
    Ok(CatalogAppDocument {
        app_path: app.to_string_lossy().into_owned(),
        config_path: config_path.to_string_lossy().into_owned(),
        config,
        intune_win_file: intune_win_file_name(&app),
        icon_preview,
    })
}

pub fn save_catalog_app_config(input: SaveCatalogAppInput) -> Result<CatalogAppDocument, AppCatalogError> {
    let app = package_dir(&input.app_path)?;
    if !input.config.is_object() {
        return Err(AppCatalogError::Message(
            "config.json must be a JSON object.".into(),
        ));
    }
    materialize_detection_scripts(&app, &input.config)?;
    let config_path = app.join(PACKAGE_INFO_DIR).join(CONFIG_FILE);
    fs::create_dir_all(app.join(PACKAGE_INFO_DIR))?;
    let mut text = serde_json::to_string_pretty(&input.config)?;
    text.push('\n');
    fs::write(&config_path, text)?;
    read_catalog_app_config(&app.to_string_lossy())
}

fn package_dir(app_path: &str) -> Result<PathBuf, AppCatalogError> {
    let trimmed = app_path.trim();
    if trimmed.is_empty() {
        return Err(AppCatalogError::Message("Package folder is required.".into()));
    }
    let app = PathBuf::from(trimmed);
    if !app.is_dir() {
        return Err(AppCatalogError::Message(format!(
            "Package folder not found: {}",
            app.display()
        )));
    }
    Ok(app)
}

fn hydrate_detection_scripts(app: &Path, config: &mut Value) {
    let Some(rules) = config
        .pointer_mut("/detection/rules")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for rule in rules {
        if rule.get("type").and_then(Value::as_str) != Some("powershell") {
            continue;
        }
        let existing = rule
            .get("scriptContent")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if !existing.is_empty() {
            continue;
        }
        let Some(name) = script_file_name(rule.get("scriptFile").and_then(Value::as_str)) else {
            continue;
        };
        let path = app.join(PACKAGE_INFO_DIR).join(&name);
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        if let Some(object) = rule.as_object_mut() {
            object.insert("scriptContent".into(), json!(text));
            object.insert("scriptFile".into(), json!(name));
        }
    }
}

fn materialize_detection_scripts(app: &Path, config: &Value) -> Result<(), AppCatalogError> {
    let Some(rules) = config.pointer("/detection/rules").and_then(Value::as_array) else {
        return Ok(());
    };
    let dir = app.join(PACKAGE_INFO_DIR);
    fs::create_dir_all(&dir)?;
    for rule in rules {
        if rule.get("type").and_then(Value::as_str) != Some("powershell") {
            continue;
        }
        let content = rule
            .get("scriptContent")
            .and_then(Value::as_str)
            .unwrap_or("");
        if content.trim().is_empty() {
            continue;
        }
        let name = script_file_name(rule.get("scriptFile").and_then(Value::as_str))
            .unwrap_or_else(|| "detection.ps1".to_string());
        fs::write(dir.join(name), content)?;
    }
    Ok(())
}

fn script_file_name(raw: Option<&str>) -> Option<String> {
    let raw = raw.unwrap_or("").trim();
    if raw.is_empty() {
        return None;
    }
    let name = Path::new(raw)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return None;
    }
    Some(name)
}

pub fn copy_catalog_app_version(
    input: CopyCatalogAppInput,
) -> Result<CatalogAppSummary, AppCatalogError> {
    let source = PathBuf::from(input.source_app_path.trim());
    if !source.is_dir() {
        return Err(AppCatalogError::Message(format!(
            "Source app folder not found: {}",
            source.display()
        )));
    }
    let new_version = sanitize_catalog_segment(&input.new_version)?;
    let source_version = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if source_version.eq_ignore_ascii_case(&new_version) {
        return Err(AppCatalogError::Message(
            "New version must be different from the source version folder.".into(),
        ));
    }
    let parent = source.parent().ok_or_else(|| {
        AppCatalogError::Message("Source app folder has no parent.".into())
    })?;
    let dest = parent.join(&new_version);
    if dest.exists() {
        let occupied = fs::read_dir(&dest)?.any(|entry| entry.is_ok());
        if occupied {
            return Err(AppCatalogError::Message(format!(
                "Destination already exists and is not empty: {}",
                dest.display()
            )));
        }
    }
    copy_package_tree(&source, &dest)?;
    fs::create_dir_all(dest.join("Output"))?;
    let config_path = dest.join(PACKAGE_INFO_DIR).join(CONFIG_FILE);
    if config_path.is_file() {
        let text = fs::read_to_string(&config_path)?;
        if let Ok(mut value) = serde_json::from_str::<Value>(&text) {
            if let Some(application) = value.get_mut("application").and_then(|row| row.as_object_mut())
            {
                application.insert("version".into(), json!(new_version));
                application.insert("displayVersion".into(), json!(new_version));
            }
            let mut written = serde_json::to_string_pretty(&value)?;
            written.push('\n');
            fs::write(&config_path, written)?;
            stamp_detection_version(&dest.join(PACKAGE_INFO_DIR), &new_version);
        }
    }
    let app_name = parent
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "App".into());
    let vendor = parent
        .parent()
        .and_then(|path| path.file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Vendor".into());
    Ok(summary_for_app(
        &dest,
        &format!("{vendor}/{app_name}/{new_version}"),
        true,
    ))
}

/// Remove catalog package folders. Each path must be a version directory under
/// `Applications` that still has `PackageInformation/config.json`. Empty vendor
/// and application folders left behind are removed. `Applications` itself stays.
pub fn delete_catalog_apps(
    source_root: &str,
    app_paths: &[String],
) -> Result<Vec<String>, AppCatalogError> {
    let root = assert_source_root(source_root)?;
    if app_paths.is_empty() {
        return Err(AppCatalogError::Message(
            "Choose an application to delete.".into(),
        ));
    }
    let apps_root = root.join(APPLICATIONS_DIR);
    let mut targets: Vec<(PathBuf, String)> = Vec::new();
    let mut seen = HashSet::new();
    for raw in app_paths {
        let app = package_dir(raw)?;
        let relative = normalize_dependency_path(&relative_catalog_path(&root, &app)?);
        if relative.is_empty() || !app.join(PACKAGE_INFO_DIR).join(CONFIG_FILE).is_file() {
            return Err(AppCatalogError::Message(format!(
                "That folder is not a catalog application: {}",
                app.display()
            )));
        }
        if seen.insert(relative.to_ascii_lowercase()) {
            targets.push((app, relative));
        }
    }
    let deleted: Vec<String> = targets.iter().map(|(_, relative)| relative.clone()).collect();
    for (app, relative) in &targets {
        fs::remove_dir_all(app).map_err(|error| {
            AppCatalogError::Message(format!("Could not delete {relative}: {error}"))
        })?;
        if let Some(parent) = app.parent() {
            prune_empty_catalog_dirs(parent, &apps_root);
        }
    }
    let deleted_keys: HashSet<String> = deleted.iter().map(|path| path.to_ascii_lowercase()).collect();
    let _ = drop_deleted_dependencies(&root, &deleted_keys);
    Ok(deleted)
}

fn prune_empty_catalog_dirs(start: &Path, apps_root: &Path) {
    let Ok(apps_root) = apps_root.canonicalize() else {
        return;
    };
    let mut current = start.to_path_buf();
    loop {
        let Ok(canonical) = current.canonicalize() else {
            return;
        };
        if canonical == apps_root || !canonical.starts_with(&apps_root) {
            return;
        }
        let Ok(mut entries) = fs::read_dir(&canonical) else {
            return;
        };
        if entries.next().is_some() {
            return;
        }
        if fs::remove_dir(&canonical).is_err() {
            return;
        }
        let Some(parent) = canonical.parent() else {
            return;
        };
        current = parent.to_path_buf();
    }
}

fn drop_deleted_dependencies(root: &Path, deleted: &HashSet<String>) -> Result<(), AppCatalogError> {
    let apps_root = root.join(APPLICATIONS_DIR);
    if !apps_root.is_dir() {
        return Ok(());
    }
    let mut apps = Vec::new();
    discover_apps(&apps_root, "", &mut apps)?;
    for app in apps {
        let config_path = PathBuf::from(&app.local_path)
            .join(PACKAGE_INFO_DIR)
            .join(CONFIG_FILE);
        let Ok(text) = fs::read_to_string(&config_path) else {
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(items) = value.get_mut("dependencies").and_then(Value::as_array_mut) else {
            continue;
        };
        let before = items.len();
        items.retain(|item| {
            dependency_path(item)
                .map(|path| !deleted.contains(&path.to_ascii_lowercase()))
                .unwrap_or(true)
        });
        if items.len() == before {
            continue;
        }
        if items.is_empty() {
            if let Some(object) = value.as_object_mut() {
                object.remove("dependencies");
            }
        }
        let mut written = serde_json::to_string_pretty(&value)?;
        written.push('\n');
        fs::write(config_path, written)?;
    }
    Ok(())
}

fn discover_apps(
    dir: &Path,
    relative: &str,
    out: &mut Vec<CatalogAppSummary>,
) -> Result<(), AppCatalogError> {
    let config_path = dir.join(PACKAGE_INFO_DIR).join(CONFIG_FILE);
    if config_path.is_file() {
        let id = if relative.is_empty() {
            dir.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "app".into())
        } else {
            relative.replace('\\', "/")
        };
        out.push(summary_for_app(dir, &id, true));
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "." || name == ".." || skip_walk_dir(&name) {
            continue;
        }
        let child_relative = if relative.is_empty() {
            name
        } else {
            format!("{relative}/{name}")
        };
        discover_apps(&path, &child_relative, out)?;
    }
    Ok(())
}

fn summary_for_app(app_dir: &Path, relative: &str, has_config: bool) -> CatalogAppSummary {
    let relative = relative.replace('\\', "/");
    let parts: Vec<&str> = relative.split('/').filter(|part| !part.is_empty()).collect();
    let (path_vendor, path_name, path_version) = match parts.as_slice() {
        [vendor, name, version, ..] => (*vendor, *name, *version),
        [name, version] => ("Unknown", *name, *version),
        [name] => ("Unknown", *name, ""),
        _ => ("Unknown", relative.as_str(), ""),
    };
    let config = read_config_value(app_dir);
    let application = config.as_ref().and_then(|value| value.get("application"));
    let vendor = nonempty(application.and_then(|row| row.get("vendor")).and_then(Value::as_str))
        .unwrap_or_else(|| path_vendor.to_string());
    let name = nonempty(application.and_then(|row| row.get("name")).and_then(Value::as_str))
        .unwrap_or_else(|| path_name.to_string());
    let version = nonempty(application.and_then(|row| row.get("version")).and_then(Value::as_str))
        .unwrap_or_else(|| path_version.to_string());
    let description = nonempty(
        application
            .and_then(|row| row.get("description"))
            .and_then(Value::as_str),
    );
    CatalogAppSummary {
        id: relative.clone(),
        vendor,
        name,
        version,
        local_path: app_dir.to_string_lossy().into_owned(),
        relative_path: relative,
        has_config,
        has_intune_win: has_intune_win(app_dir),
        missing_required: missing_required(config.as_ref(), app_dir),
        description,
    }
}

fn missing_required(config: Option<&Value>, app_dir: &Path) -> Vec<String> {
    let mut missing = Vec::new();
    let Some(config) = config else {
        missing.push("Name".into());
        if !has_intune_win(app_dir) {
            missing.push("File".into());
        }
        missing.extend([
            "Description".into(),
            "Publisher".into(),
            "Install command".into(),
            "Uninstall command".into(),
            "Check operating system architecture".into(),
            "Minimum operating system".into(),
            "Detection rule".into(),
        ]);
        return missing;
    };
    let application = config.get("application");
    if object_text(application, "name").is_empty() {
        missing.push("Name".into());
    }
    if !has_intune_win(app_dir) {
        missing.push("File".into());
    }
    if object_text(application, "description").is_empty() {
        missing.push("Description".into());
    }
    if object_text(application, "publisher").is_empty() {
        missing.push("Publisher".into());
    }
    if !command_ready(config, "installCommandLine", "installCommand") {
        missing.push("Install command".into());
    }
    if !command_ready(config, "uninstallCommandLine", "uninstallCommand") {
        missing.push("Uninstall command".into());
    }
    if !architecture_ready(application) {
        missing.push("Check operating system architecture".into());
    }
    if !minimum_os_ready(application) {
        missing.push("Minimum operating system".into());
    }
    if !detection_ready(config, app_dir) {
        missing.push("Detection rule".into());
    }
    missing
}

fn architecture_ready(application: Option<&Value>) -> bool {
    let allowed = object_text(application, "allowedArchitectures");
    let raw = if allowed.is_empty() {
        object_text(application, "applicableArchitectures")
    } else {
        allowed
    };
    raw.split(|ch: char| ch == ',' || ch == ';' || ch.is_whitespace())
        .any(|part| matches!(part.to_ascii_lowercase().as_str(), "x86" | "x64" | "arm64"))
}

fn minimum_os_ready(application: Option<&Value>) -> bool {
    let raw = object_text(application, "minimumSupportedWindowsRelease");
    let lower = raw.to_ascii_lowercase();
    !raw.is_empty() && lower != "none" && lower != "notconfigured"
}

fn command_ready(config: &Value, app_key: &str, install_key: &str) -> bool {
    !object_text(config.get("application"), app_key).is_empty()
        || !object_text(config.get("installation"), install_key).is_empty()
}

fn detection_ready(config: &Value, app_dir: &Path) -> bool {
    let Some(rules) = config
        .get("detection")
        .and_then(|row| row.get("rules"))
        .and_then(Value::as_array)
    else {
        return false;
    };
    !rules.is_empty() && rules.iter().all(|rule| detection_rule_ready(rule, app_dir))
}

fn detection_rule_ready(rule: &Value, app_dir: &Path) -> bool {
    match rule.get("type").and_then(Value::as_str).unwrap_or("") {
        "file" => {
            !json_text(rule, "path").is_empty()
                && !json_text(rule, "fileOrFolderName").is_empty()
                && comparison_ready(rule)
        }
        "registry" => !json_text(rule, "keyPath").is_empty() && comparison_ready(rule),
        "msi" => msi_rule_ready(rule),
        "powershell" => !json_text(rule, "scriptContent").is_empty() || script_on_disk(rule, app_dir),
        "unknown" => rule
            .get("raw")
            .and_then(|raw| raw.get("@odata.type"))
            .and_then(Value::as_str)
            .is_some_and(|kind| !kind.trim().is_empty()),
        _ => false,
    }
}

fn comparison_ready(rule: &Value) -> bool {
    let detection_type = json_text(rule, "detectionType");
    if detection_type.is_empty()
        || matches!(
            detection_type.as_str(),
            "exists" | "doesNotExist" | "notConfigured"
        )
    {
        return true;
    }
    !json_text(rule, "detectionValue").is_empty()
}

fn msi_rule_ready(rule: &Value) -> bool {
    if json_text(rule, "productCode").is_empty() {
        return false;
    }
    let operator = json_text(rule, "productVersionOperator");
    if operator.is_empty() || operator.eq_ignore_ascii_case("notConfigured") {
        return true;
    }
    !json_text(rule, "productVersion").is_empty()
}

fn script_on_disk(rule: &Value, app_dir: &Path) -> bool {
    let Some(file) = rule.get("scriptFile").and_then(Value::as_str).map(str::trim) else {
        return false;
    };
    if file.is_empty() || file.contains("..") || Path::new(file).is_absolute() {
        return false;
    }
    fs::read_to_string(app_dir.join(PACKAGE_INFO_DIR).join(file))
        .ok()
        .is_some_and(|text| !text.trim().is_empty())
}

fn object_text(parent: Option<&Value>, key: &str) -> String {
    parent.map(|row| json_text(row, key)).unwrap_or_default()
}

fn json_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("")
        .to_string()
}

fn nonempty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn has_intune_win(app_dir: &Path) -> bool {
    find_intune_win_path(app_dir).is_some()
}

pub fn intune_win_file_name(app_dir: &Path) -> Option<String> {
    find_intune_win_path(app_dir)
        .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
}

/// Newest `.intunewin` under `Output`, otherwise a file sitting in the version folder.
pub fn find_intune_win_path(app_dir: &Path) -> Option<PathBuf> {
    let output = newest_intune_win_in(&app_dir.join("Output"));
    if output.is_some() {
        return output;
    }
    newest_intune_win_in(app_dir)
}

fn newest_intune_win_in(dir: &Path) -> Option<PathBuf> {
    let mut files = Vec::new();
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name.ends_with(".intunewin") {
            let mtime = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .ok();
            files.push((mtime, path));
        }
    }
    files.sort_by(|left, right| right.0.cmp(&left.0));
    files.into_iter().next().map(|(_, path)| path)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogIntuneWinFile {
    pub file_name: String,
    pub path: String,
}

pub fn attach_catalog_intunewin(
    app_path: &str,
    source_file: &str,
) -> Result<CatalogIntuneWinFile, AppCatalogError> {
    let app = package_dir(app_path)?;
    let source = PathBuf::from(source_file.trim());
    if !source.is_file() {
        return Err(AppCatalogError::Message(format!(
            ".intunewin file not found: {}",
            source.display()
        )));
    }
    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !file_name.to_ascii_lowercase().ends_with(".intunewin")
        || file_name.contains(['/', '\\'])
        || file_name == "."
        || file_name == ".."
    {
        return Err(AppCatalogError::Message(
            "Choose a .intunewin file.".into(),
        ));
    }
    let output = app.join("Output");
    fs::create_dir_all(&output)?;
    let dest = output.join(&file_name);
    if !same_file(&source, &dest) {
        fs::copy(&source, &dest)?;
    }
    Ok(CatalogIntuneWinFile {
        file_name,
        path: dest.to_string_lossy().into_owned(),
    })
}

fn same_file(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn skip_walk_dir(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    SKIP_WALK_DIRS.iter().any(|entry| *entry == lower)
}

fn sanitize_catalog_segment(raw: &str) -> Result<String, AppCatalogError> {
    let mut cleaned = String::new();
    let mut pending_space = false;
    for ch in raw.trim().chars() {
        if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control() {
            cleaned.push('-');
            pending_space = false;
            continue;
        }
        if ch.is_whitespace() {
            pending_space = !cleaned.is_empty();
            continue;
        }
        if pending_space {
            cleaned.push(' ');
            pending_space = false;
        }
        cleaned.push(ch);
    }
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).trim().to_string();
    if cleaned.is_empty() {
        return Err(AppCatalogError::Message(
            "Name cannot be empty or only invalid path characters.".into(),
        ));
    }
    if cleaned == "." || cleaned == ".." {
        return Err(AppCatalogError::Message("Invalid folder name.".into()));
    }
    Ok(cleaned)
}

fn seed_config(name: &str, vendor: &str, version: &str, publisher: &str, description: &str) -> Value {
    json!({
        "application": {
            "name": name,
            "vendor": vendor,
            "version": version,
            "displayVersion": version,
            "applicableArchitectures": "x64",
            "allowedArchitectures": "x64",
            "description": description,
            "publisher": publisher,
            "notes": "",
            "icon": { "file": "AppIcon.png", "type": "image/png" },
            "installCommandLine": "Invoke-AppDeployToolkit.exe -DeploymentType Install",
            "uninstallCommandLine": "Invoke-AppDeployToolkit.exe -DeploymentType Uninstall",
            "minimumSupportedWindowsRelease": "1809",
            "allowAvailableUninstall": true,
            "requirements": {
                "minimumFreeDiskSpaceInMB": 250,
                "minimumMemoryInMB": 512,
                "minimumNumberOfProcessors": 1,
                "minimumCpuSpeedInMHz": 1000
            }
        },
        "installation": {
            "installCommand": "Invoke-AppDeployToolkit.exe -DeploymentType Install",
            "uninstallCommand": "Invoke-AppDeployToolkit.exe -DeploymentType Uninstall",
            "installBehavior": "system",
            "restartBehavior": "allow",
            "timeout": 60,
            "runAs32bit": false
        },
        "detection": {
            "rules": [
                {
                    "type": "powershell",
                    "scriptFile": "detection.ps1",
                    "enforceSignatureCheck": false,
                    "runAs32Bit": false
                }
            ]
        },
        "returnCodes": {
            "0": "Success",
            "1707": "Success with restart required",
            "3010": "Soft restart required",
            "1641": "Success with restart initiated",
            "1618": "Another installation is already in progress",
            "1602": "User cancelled installation",
            "1603": "Fatal error during installation"
        },
        "notes": "",
        "lastUpdated": "",
        "maintainer": "",
        "tags": []
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDependencyNode {
    pub vendor: String,
    pub name: String,
    pub version: String,
    pub relative_path: String,
    pub local_path: String,
    pub required_by: String,
    pub required_by_path: String,
    pub depth: u32,
    pub has_intune_win: bool,
    pub in_intune: bool,
    pub missing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intune_app_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDependencyChain {
    pub nodes: Vec<CatalogDependencyNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cycle: Option<String>,
}

/// Direct dependencies first, then the packages those dependencies require.
pub fn catalog_dependency_chain(
    source_root: &str,
    app_path: &str,
) -> Result<CatalogDependencyChain, AppCatalogError> {
    let root = assert_source_root(source_root)?;
    let start_dir = package_dir(app_path)?;
    let start_relative = relative_catalog_path(&root, &start_dir)?;
    let start_config = read_config_value(&start_dir);
    let start_label = package_identity(start_config.as_ref(), &start_relative).3;
    let mut nodes = Vec::new();
    let mut seen = HashSet::new();
    let mut stack = vec![start_relative.to_lowercase()];
    seen.insert(start_relative.to_lowercase());
    let mut cycle = None;
    walk_dependencies(
        &root,
        &dependency_paths(start_config.as_ref()),
        &start_relative,
        &start_label,
        1,
        &mut stack,
        &mut seen,
        &mut nodes,
        &mut cycle,
    );
    Ok(CatalogDependencyChain { nodes, cycle })
}

fn walk_dependencies(
    root: &Path,
    paths: &[String],
    required_by_path: &str,
    required_by: &str,
    depth: u32,
    stack: &mut Vec<String>,
    seen: &mut HashSet<String>,
    nodes: &mut Vec<CatalogDependencyNode>,
    cycle: &mut Option<String>,
) {
    for relative in paths {
        let key = relative.to_lowercase();
        if stack.iter().any(|item| item == &key) {
            if cycle.is_none() {
                *cycle = Some(format!(
                    "{required_by} depends on {relative}, which is already in this chain."
                ));
            }
            continue;
        }
        if !seen.insert(key.clone()) {
            continue;
        }
        let dir = dependency_dir(root, relative);
        let config = read_config_value(&dir);
        let missing = config.is_none();
        let (vendor, name, version, label) = package_identity(config.as_ref(), relative);
        let intune_app_id = read_linked_intune_app_id(&dir);
        nodes.push(CatalogDependencyNode {
            vendor,
            name,
            version,
            relative_path: relative.clone(),
            local_path: dir.to_string_lossy().into_owned(),
            required_by: required_by.to_string(),
            required_by_path: required_by_path.to_string(),
            depth,
            has_intune_win: has_intune_win(&dir),
            in_intune: intune_app_id.is_some(),
            missing,
            intune_app_id,
        });
        if missing {
            continue;
        }
        let children = dependency_paths(config.as_ref());
        stack.push(key);
        walk_dependencies(
            root,
            &children,
            relative,
            &label,
            depth + 1,
            stack,
            seen,
            nodes,
            cycle,
        );
        stack.pop();
    }
}

fn dependency_paths(config: Option<&Value>) -> Vec<String> {
    let Some(items) = config.and_then(|value| value.get("dependencies")).and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    for item in items {
        if let Some(path) = dependency_path(item) {
            if !path.is_empty() && !paths.iter().any(|existing: &String| existing.eq_ignore_ascii_case(&path)) {
                paths.push(path);
            }
        }
    }
    paths
}

fn dependency_path(value: &Value) -> Option<String> {
    if let Some(path) = value.get("path").and_then(Value::as_str) {
        return Some(normalize_dependency_path(path));
    }
    let vendor = value.get("vendor").and_then(Value::as_str)?.trim();
    let name = value.get("name").and_then(Value::as_str)?.trim();
    let version = value.get("version").and_then(Value::as_str)?.trim();
    if vendor.is_empty() || name.is_empty() || version.is_empty() {
        return None;
    }
    Some(normalize_dependency_path(&format!("{vendor}/{name}/{version}")))
}

fn normalize_dependency_path(path: &str) -> String {
    let slash = path.replace('\\', "/");
    let trimmed = slash.trim().trim_matches('/');
    trimmed
        .strip_prefix("Applications/")
        .unwrap_or(trimmed)
        .trim_matches('/')
        .to_string()
}

fn dependency_dir(root: &Path, relative: &str) -> PathBuf {
    let mut dir = root.join(APPLICATIONS_DIR);
    for part in relative.split('/').filter(|part| !part.is_empty() && *part != "." && *part != "..") {
        dir.push(part);
    }
    dir
}

fn relative_catalog_path(root: &Path, app_dir: &Path) -> Result<String, AppCatalogError> {
    let apps = root.join(APPLICATIONS_DIR);
    let apps = apps.canonicalize().unwrap_or(apps);
    let app_dir = app_dir.canonicalize().unwrap_or_else(|_| app_dir.to_path_buf());
    let relative = app_dir.strip_prefix(&apps).map_err(|_| {
        AppCatalogError::Message("Package is not under Applications.".into())
    })?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn read_config_value(app_dir: &Path) -> Option<Value> {
    let text = fs::read_to_string(app_dir.join(PACKAGE_INFO_DIR).join(CONFIG_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn read_linked_intune_app_id(app_dir: &Path) -> Option<String> {
    let text = fs::read_to_string(app_dir.join(PACKAGE_INFO_DIR).join("intune-content.json")).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let id = value.get("intuneAppId")?.as_str()?.trim().to_string();
    if id.is_empty() { None } else { Some(id) }
}

fn package_identity(config: Option<&Value>, relative: &str) -> (String, String, String, String) {
    let parts: Vec<&str> = relative.split('/').filter(|part| !part.is_empty()).collect();
    let (path_vendor, path_name, path_version) = match parts.as_slice() {
        [vendor, name, version, ..] => (*vendor, *name, *version),
        [name, version] => ("", *name, *version),
        [name] => ("", *name, ""),
        _ => ("", relative, ""),
    };
    let application = config.and_then(|value| value.get("application"));
    let text = |key: &str, fallback: &str| -> String {
        application
            .and_then(|row| row.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(fallback)
            .to_string()
    };
    let vendor = text("vendor", path_vendor);
    let name = text("name", path_name);
    let version = text("version", path_version);
    let label = if version.is_empty() {
        name.clone()
    } else {
        format!("{name} {version}")
    };
    (vendor, name, version, label)
}

fn copy_package_tree(src: &Path, dest: &Path) -> Result<(), AppCatalogError> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_text = name.to_string_lossy();
        let lower = name_text.to_ascii_lowercase();
        if lower == "output"
            || lower == "node_modules"
            || lower == ".git"
            || lower == ".appforge-cache"
            || lower.ends_with(".intunewin")
        {
            continue;
        }
        let from = entry.path();
        let to = dest.join(&name);
        if from.is_dir() {
            copy_package_tree(&from, &to)?;
        } else if from.is_file() {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
