use crate::graph::{GraphClient, GraphError};
use crate::inventory::{
    fetch_autopilot_profiles, fetch_compliance_policies, fetch_configuration_policies,
    fetch_endpoint_security_intents, fetch_group_policy_configurations, fetch_tenant_scripts,
    fetch_windows_update_policies, CatalogPolicySummary, TenantScriptSummary, WindowsUpdatePolicy,
};
use crate::object_detail::{fetch_graph_object_detail, GraphObjectDetail};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;
use urlencoding::encode;

const AXIS_EXPORT_SCHEMA: &str = "axis.pack.artifact/v1";
const SETTINGS_PAGE_MAX: usize = 1000;

#[derive(Debug, Error)]
pub enum PackExportError {
    #[error(transparent)]
    Graph(#[from] GraphError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackExportOptions {
    #[serde(default)]
    pub pack_id: Option<String>,
    #[serde(default)]
    pub pack_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackExportProgress {
    pub phase: String,
    pub current: u32,
    pub total: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackExportResult {
    pub root: String,
    pub files_written: u32,
    pub include_count: u32,
    pub catalog_count: u32,
    pub skipped: Vec<String>,
    pub warnings: Vec<String>,
    pub baseline_path: String,
    pub catalog_baseline_path: String,
    pub platforms: Vec<String>,
}

struct ExportWriter {
    root: PathBuf,
    used_names: HashSet<String>,
    includes: Vec<String>,
    catalog_includes: Vec<String>,
    platforms: HashSet<String>,
    files_written: u32,
}

impl ExportWriter {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            used_names: HashSet::new(),
            includes: Vec::new(),
            catalog_includes: Vec::new(),
            platforms: HashSet::new(),
            files_written: 0,
        }
    }

    fn unique_rel(&mut self, dir: &str, stem: &str, ext: &str) -> String {
        let clean = sanitize_file_stem(stem);
        let mut name = format!("{clean}.{ext}");
        let mut n = 2u32;
        loop {
            let rel = if dir.is_empty() {
                name.clone()
            } else {
                format!("{dir}/{name}")
            };
            if self.used_names.insert(rel.clone()) {
                return rel;
            }
            name = format!("{clean}-{n}.{ext}");
            n += 1;
        }
    }

    fn write_bytes(&mut self, rel: &str, bytes: &[u8]) -> Result<(), PackExportError> {
        let path = self.root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, bytes)?;
        self.files_written += 1;
        Ok(())
    }

    fn write_json(&mut self, rel: &str, value: &Value) -> Result<(), PackExportError> {
        let mut text = serde_json::to_string_pretty(value)?;
        text.push('\n');
        self.write_bytes(rel, text.as_bytes())
    }

    fn add_include(&mut self, rel: &str, catalog: bool) {
        if let Some(platform) = rel.split('/').next() {
            if matches!(platform, "windows" | "macos" | "android") {
                self.platforms.insert(platform.to_string());
            }
        }
        self.includes.push(rel.to_string());
        if catalog {
            self.catalog_includes.push(rel.to_string());
        }
    }
}

pub async fn export_tenant_pack<F>(
    access_token: &str,
    dest: &Path,
    options: PackExportOptions,
    mut on_progress: F,
) -> Result<PackExportResult, PackExportError>
where
    F: FnMut(PackExportProgress),
{
    if dest.as_os_str().is_empty() {
        return Err(PackExportError::Message(
            "Choose a folder for the exported pack.".into(),
        ));
    }
    if dest.is_file() {
        return Err(PackExportError::Message(
            "The export path is a file. Choose a folder.".into(),
        ));
    }
    fs::create_dir_all(dest)?;

    let exported_at = Utc::now().to_rfc3339();
    let pack_name = options
        .pack_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Tenant Intune export")
        .to_string();
    let pack_id = options
        .pack_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| sanitize_file_stem(&pack_name));

    let mut warnings = Vec::new();
    let mut skipped = Vec::new();
    let mut writer = ExportWriter::new(dest.to_path_buf());

    on_progress(progress("listing", 0, 0, "Listing tenant objects…"));

    let catalog = list_or_warn(
        "Settings Catalog",
        fetch_configuration_policies(access_token).await,
        &mut warnings,
    );
    let scripts = list_or_warn(
        "Scripts",
        fetch_tenant_scripts(access_token).await,
        &mut warnings,
    );
    let compliance = list_or_warn(
        "Compliance policies",
        fetch_compliance_policies(access_token).await,
        &mut warnings,
    );
    let intents = list_or_warn(
        "Endpoint Security",
        fetch_endpoint_security_intents(access_token).await,
        &mut warnings,
    );
    let windows_update = list_or_warn(
        "Windows Update",
        fetch_windows_update_policies(access_token).await,
        &mut warnings,
    );
    let autopilot = list_or_warn(
        "Autopilot profiles",
        fetch_autopilot_profiles(access_token).await,
        &mut warnings,
    );
    let group_policy = list_or_warn(
        "Group Policy",
        fetch_group_policy_configurations(access_token).await,
        &mut warnings,
    );

    let total = (catalog.len()
        + scripts.len()
        + compliance.len()
        + intents.len()
        + windows_update.len()
        + autopilot.len()
        + group_policy.len()) as u32;
    let mut current = 0u32;

    for policy in &catalog {
        current += 1;
        on_progress(progress(
            "catalog",
            current,
            total,
            &format!("Catalog: {}", policy.name),
        ));
        match export_catalog_policy(access_token, policy, &exported_at, &mut writer).await {
            Ok(()) => {}
            Err(error) => warnings.push(format!("{}: {error}", policy.name)),
        }
    }

    for script in &scripts {
        current += 1;
        on_progress(progress(
            "scripts",
            current,
            total,
            &format!("Script: {}", script.display_name),
        ));
        match export_script(access_token, script, &exported_at, &mut writer).await {
            Ok(()) => {}
            Err(error) => warnings.push(format!("{}: {error}", script.display_name)),
        }
    }

    for policy in &compliance {
        current += 1;
        on_progress(progress(
            "compliance",
            current,
            total,
            &format!("Compliance: {}", policy.name),
        ));
        match export_named_graph(
            access_token,
            "compliancePolicy",
            policy,
            pack_platform_from_graph(policy.platforms.as_deref(), policy.odata_type.as_deref()),
            "compliance",
            "compliancePolicy",
            &exported_at,
            &mut writer,
            &mut skipped,
        )
        .await
        {
            Ok(()) => {}
            Err(error) => warnings.push(format!("{}: {error}", policy.name)),
        }
    }

    for policy in &intents {
        current += 1;
        on_progress(progress(
            "endpoint-security",
            current,
            total,
            &format!("Endpoint Security: {}", policy.name),
        ));
        match export_endpoint_security(access_token, policy, &exported_at, &mut writer).await {
            Ok(()) => {}
            Err(error) => warnings.push(format!("{}: {error}", policy.name)),
        }
    }

    for policy in &windows_update {
        current += 1;
        on_progress(progress(
            "windows-update",
            current,
            total,
            &format!("Windows Update: {}", policy.name),
        ));
        match export_windows_update(access_token, policy, &exported_at, &mut writer).await {
            Ok(()) => {}
            Err(error) => warnings.push(format!("{}: {error}", policy.name)),
        }
    }

    for profile in &autopilot {
        current += 1;
        on_progress(progress(
            "autopilot",
            current,
            total,
            &format!("Autopilot: {}", profile.display_name),
        ));
        let summary = CatalogPolicySummary {
            id: profile.id.clone(),
            name: profile.display_name.clone(),
            description: profile.description.clone(),
            platforms: Some("windows".into()),
            technologies: None,
            setting_count: None,
            created_date_time: profile.created_date_time.clone(),
            last_modified_date_time: profile.last_modified_date_time.clone(),
            is_assigned: None,
            template_family: None,
            template_id: None,
            odata_type: profile.odata_type.clone(),
        };
        match export_named_graph(
            access_token,
            "autopilotProfile",
            &summary,
            Some("windows"),
            "enrollment/autopilot",
            "enrollment-autopilot",
            &exported_at,
            &mut writer,
            &mut skipped,
        )
        .await
        {
            Ok(()) => {}
            Err(error) => warnings.push(format!("{}: {error}", profile.display_name)),
        }
    }

    for policy in &group_policy {
        current += 1;
        on_progress(progress(
            "group-policy",
            current,
            total,
            &format!("Group Policy: {}", policy.name),
        ));
        match export_named_graph(
            access_token,
            "groupPolicyConfiguration",
            policy,
            Some("windows"),
            "group-policy",
            "group-policy",
            &exported_at,
            &mut writer,
            &mut skipped,
        )
        .await
        {
            Ok(()) => {}
            Err(error) => warnings.push(format!("{}: {error}", policy.name)),
        }
    }

    writer.includes.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    writer
        .catalog_includes
        .sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    let mut platforms: Vec<String> = writer.platforms.iter().cloned().collect();
    platforms.sort();
    if platforms.is_empty() {
        platforms.push("windows".into());
    }

    on_progress(progress("writing", total, total, "Writing pack manifest…"));

    let baseline_rel = "baselines/tenant-export.json";
    let catalog_baseline_rel = "baselines/tenant-export-catalog.json";
    writer.write_json(
        baseline_rel,
        &json!({
            "id": format!("{pack_id}-all"),
            "name": format!("{pack_name} (all)"),
            "description": "Every file Axis exported from this tenant. Device compare uses catalog paths under policies/.",
            "exportedAt": exported_at,
            "includes": writer.includes,
        }),
    )?;
    writer.write_json(
        catalog_baseline_rel,
        &json!({
            "id": format!("{pack_id}-catalog"),
            "name": format!("{pack_name} (Settings Catalog)"),
            "description": "Settings Catalog files only — import and device compare.",
            "exportedAt": exported_at,
            "includes": writer.catalog_includes,
        }),
    )?;

    writer.write_json(
        "axis-pack.json",
        &json!({
            "id": pack_id,
            "name": pack_name,
            "version": "0.1.0",
            "sourceLabel": "Axis tenant export",
            "exportedAt": exported_at,
            "paths": {
                "platforms": platforms,
                "baselines": "baselines"
            }
        }),
    )?;

    Ok(PackExportResult {
        root: dest.to_string_lossy().into_owned(),
        files_written: writer.files_written,
        include_count: writer.includes.len() as u32,
        catalog_count: writer.catalog_includes.len() as u32,
        skipped,
        warnings,
        baseline_path: dest.join("baselines").join("tenant-export.json").to_string_lossy().into_owned(),
        catalog_baseline_path: dest
            .join("baselines")
            .join("tenant-export-catalog.json")
            .to_string_lossy()
            .into_owned(),
        platforms,
    })
}

fn progress(phase: &str, current: u32, total: u32, message: &str) -> PackExportProgress {
    PackExportProgress {
        phase: phase.into(),
        current,
        total,
        message: message.into(),
    }
}

fn list_or_warn<T>(
    label: &str,
    result: Result<crate::inventory::InventoryList<T>, GraphError>,
    warnings: &mut Vec<String>,
) -> Vec<T> {
    match result {
        Ok(list) => list.items,
        Err(error) => {
            warnings.push(format!("{label}: {error}"));
            Vec::new()
        }
    }
}

async fn export_catalog_policy(
    access_token: &str,
    policy: &CatalogPolicySummary,
    exported_at: &str,
    writer: &mut ExportWriter,
) -> Result<(), PackExportError> {
    let Some(platform) = pack_platform_from_graph(policy.platforms.as_deref(), None) else {
        return Err(PackExportError::Message(format!(
            "skipped unsupported platform ({})",
            policy.platforms.as_deref().unwrap_or("unknown")
        )));
    };
    let detail = fetch_graph_object_detail(access_token, "configurationPolicy", &policy.id).await?;
    let settings = catalog_settings_for_export(detail.settings.as_deref().unwrap_or(&[]));
    if settings.is_empty() {
        return Err(PackExportError::Message(
            "no Settings Catalog instances returned".into(),
        ));
    }
    let mut document = json!({
        "axisExport": envelope("catalogPolicy", &detail.id, exported_at),
        "name": detail.object.get("name").cloned().unwrap_or(json!(policy.name)),
        "description": detail.object.get("description").cloned().unwrap_or(json!(policy.description.clone().unwrap_or_default())),
        "platforms": detail.object.get("platforms").cloned().unwrap_or(json!(policy.platforms.clone().unwrap_or_default())),
        "technologies": detail.object.get("technologies").cloned().unwrap_or(json!(policy.technologies.clone().unwrap_or_default())),
        "settings": settings,
    });
    if let Some(reference) = detail.object.get("templateReference") {
        if reference.is_object() {
            document
                .as_object_mut()
                .expect("object")
                .insert("templateReference".into(), reference.clone());
        }
    }
    let rel = writer.unique_rel(&format!("{platform}/policies"), &policy.name, "json");
    writer.write_json(&rel, &document)?;
    writer.add_include(&rel, true);
    Ok(())
}

async fn export_script(
    access_token: &str,
    script: &TenantScriptSummary,
    exported_at: &str,
    writer: &mut ExportWriter,
) -> Result<(), PackExportError> {
    let kind = format!("script:{}", script.kind);
    let detail = fetch_graph_object_detail(access_token, &kind, &script.id).await?;
    let platform = script_pack_platform(&script.kind);
    let folder = match script.kind.as_str() {
        "platform-powershell" | "platform-shell" => "scripts/platform",
        "remediation" => "scripts/remediation",
        "compliance" => "scripts/compliance",
        other => {
            return Err(PackExportError::Message(format!(
                "unknown script kind {other}"
            )));
        }
    };
    let dir = format!("{platform}/{folder}");
    let ext = if script.kind == "platform-shell" {
        "sh"
    } else {
        "ps1"
    };

    if script.kind == "remediation" {
        let detection = detail.detection_script_text.as_deref().unwrap_or("");
        let remediation = detail.remediation_script_text.as_deref().unwrap_or("");
        if detection.trim().is_empty() && remediation.trim().is_empty() {
            return Err(PackExportError::Message("empty remediation scripts".into()));
        }
        if !detection.trim().is_empty() {
            let rel = writer.unique_rel(&dir, &format!("{}-detect", script.display_name), ext);
            let body = script_file_with_header(
                &script_meta(&detail, script, "script:remediation-detect", exported_at, "detect.ps1"),
                detection,
            );
            writer.write_bytes(&rel, body.as_bytes())?;
            writer.add_include(&rel, false);
        }
        if !remediation.trim().is_empty() {
            let rel = writer.unique_rel(&dir, &format!("{}-remediate", script.display_name), ext);
            let body = script_file_with_header(
                &script_meta(
                    &detail,
                    script,
                    "script:remediation-remediate",
                    exported_at,
                    "remediate.ps1",
                ),
                remediation,
            );
            writer.write_bytes(&rel, body.as_bytes())?;
            writer.add_include(&rel, false);
        }
        return Ok(());
    }

    let text = if script.kind == "compliance" {
        detail
            .detection_script_text
            .as_deref()
            .or(detail.script_text.as_deref())
            .unwrap_or("")
    } else {
        detail.script_text.as_deref().unwrap_or("")
    };
    if text.trim().is_empty() {
        return Err(PackExportError::Message("empty script body".into()));
    }
    let file_name = script
        .file_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(if ext == "sh" { "script.sh" } else { "script.ps1" });
    let rel = writer.unique_rel(&dir, &script.display_name, ext);
    let body = script_file_with_header(
        &script_meta(&detail, script, &kind, exported_at, file_name),
        text,
    );
    writer.write_bytes(&rel, body.as_bytes())?;
    writer.add_include(&rel, false);
    Ok(())
}

async fn export_named_graph(
    access_token: &str,
    graph_kind: &str,
    policy: &CatalogPolicySummary,
    platform: Option<&str>,
    folder: &str,
    axis_kind: &str,
    exported_at: &str,
    writer: &mut ExportWriter,
    skipped: &mut Vec<String>,
) -> Result<(), PackExportError> {
    let Some(platform) = platform else {
        skipped.push(format!(
            "{} ({})",
            policy.name,
            policy.odata_type.as_deref().unwrap_or("unsupported platform")
        ));
        return Ok(());
    };
    let detail = fetch_graph_object_detail(access_token, graph_kind, &policy.id).await?;
    let document = graph_object_document(&detail, axis_kind, exported_at);
    let rel = writer.unique_rel(&format!("{platform}/{folder}"), &policy.name, "json");
    writer.write_json(&rel, &document)?;
    writer.add_include(&rel, false);
    Ok(())
}

async fn export_endpoint_security(
    access_token: &str,
    policy: &CatalogPolicySummary,
    exported_at: &str,
    writer: &mut ExportWriter,
) -> Result<(), PackExportError> {
    let client = GraphClient::new();
    let enc = encode(&policy.id);
    let mut object: Value = client
        .fetch_plain(
            access_token,
            &format!("/deviceManagement/intents/{enc}"),
            "beta",
        )
        .await?;
    let settings = match client
        .fetch_all_pages::<Value>(
            access_token,
            &format!("/deviceManagement/intents/{enc}/settings"),
            "beta",
            SETTINGS_PAGE_MAX,
        )
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            return Err(PackExportError::Graph(error));
        }
    };
    strip_graph_noise(object.as_object_mut());
    let id = policy.id.clone();
    let document = json!({
        "axisExport": envelope("endpointSecurityIntent", &id, exported_at),
        "displayName": object.get("displayName").cloned().unwrap_or(json!(policy.name)),
        "description": object.get("description").cloned().unwrap_or(json!(policy.description.clone().unwrap_or_default())),
        "templateId": object.get("templateId").cloned().unwrap_or(json!(policy.template_id.clone().unwrap_or_default())),
        "intent": object,
        "settings": settings,
    });
    let rel = writer.unique_rel("windows/endpoint-security", &policy.name, "json");
    writer.write_json(&rel, &document)?;
    writer.add_include(&rel, false);
    Ok(())
}

async fn export_windows_update(
    access_token: &str,
    policy: &WindowsUpdatePolicy,
    exported_at: &str,
    writer: &mut ExportWriter,
) -> Result<(), PackExportError> {
    let graph_kind = format!("windowsUpdate:{}", policy.family);
    let detail = fetch_graph_object_detail(access_token, &graph_kind, &policy.id).await?;
    let document = graph_object_document(&detail, &format!("windowsUpdate:{}", policy.family), exported_at);
    let rel = writer.unique_rel("windows/windows-update", &policy.name, "json");
    writer.write_json(&rel, &document)?;
    writer.add_include(&rel, false);
    Ok(())
}

fn envelope(kind: &str, source_id: &str, exported_at: &str) -> Value {
    json!({
        "schema": AXIS_EXPORT_SCHEMA,
        "kind": kind,
        "sourceId": source_id,
        "exportedAt": exported_at,
    })
}

fn graph_object_document(detail: &GraphObjectDetail, axis_kind: &str, exported_at: &str) -> Value {
    let mut object = detail.object.clone();
    strip_graph_noise(object.as_object_mut());
    let mut document = json!({
        "axisExport": envelope(axis_kind, &detail.id, exported_at),
        "object": object,
    });
    let map = document.as_object_mut().expect("object");
    if let Some(settings) = &detail.settings {
        map.insert("settings".into(), json!(settings));
    }
    if let Some(extras) = &detail.extras {
        map.insert("extras".into(), extras.clone());
        if let Some(actions) = extras.get("scheduledActions") {
            if let Some(obj) = map.get_mut("object").and_then(Value::as_object_mut) {
                obj.insert("scheduledActionsForRule".into(), actions.clone());
            }
        }
    }
    document
}

fn catalog_settings_for_export(rows: &[Value]) -> Vec<Value> {
    rows.iter()
        .filter_map(|row| {
            let instance = row.get("settingInstance")?.clone();
            Some(json!({ "settingInstance": instance }))
        })
        .collect()
}

fn strip_graph_noise(object: Option<&mut Map<String, Value>>) {
    let Some(object) = object else {
        return;
    };
    for key in [
        "@odata.context",
        "@odata.id",
        "@odata.editLink",
        "@odata.etag",
        "id",
        "createdDateTime",
        "lastModifiedDateTime",
        "assignments",
        "isAssigned",
        "roleScopeTagIds",
        "version",
        "settingCount",
    ] {
        object.remove(key);
    }
}

fn script_meta(
    detail: &GraphObjectDetail,
    script: &TenantScriptSummary,
    kind: &str,
    exported_at: &str,
    file_name: &str,
) -> Value {
    json!({
        "schema": AXIS_EXPORT_SCHEMA,
        "kind": kind,
        "sourceId": detail.id,
        "exportedAt": exported_at,
        "displayName": script.display_name,
        "description": script.description,
        "fileName": file_name,
        "runAsAccount": detail.object.get("runAsAccount").and_then(Value::as_str).or(script.run_as_account.as_deref()),
        "publisher": detail.object.get("publisher").and_then(Value::as_str).or(script.publisher.as_deref()),
        "runAs32Bit": detail.object.get("runAs32Bit").cloned(),
        "enforceSignatureCheck": detail.object.get("enforceSignatureCheck").cloned(),
    })
}

fn script_file_with_header(meta: &Value, body: &str) -> String {
    let header = serde_json::to_string(meta).unwrap_or_else(|_| "{}".into());
    let trimmed = body.trim_start_matches('\u{FEFF}');
    format!("# @axis-pack {header}\n{trimmed}")
}

fn script_pack_platform(kind: &str) -> &'static str {
    if kind == "platform-shell" {
        "macos"
    } else {
        "windows"
    }
}

/// Maps Graph platform / OData type strings onto pack folders. iOS and Linux are skipped.
pub fn pack_platform_from_graph(platforms: Option<&str>, odata: Option<&str>) -> Option<&'static str> {
    let blob = format!(
        "{} {}",
        platforms.unwrap_or(""),
        odata.unwrap_or("")
    )
    .to_ascii_lowercase();
    if blob.contains("ios") || blob.contains("ipados") || blob.contains("ipad") {
        return None;
    }
    if blob.contains("linux") {
        return None;
    }
    if blob.contains("android") || blob.contains("aosp") {
        return Some("android");
    }
    if blob.contains("macos") {
        return Some("macos");
    }
    if blob.contains("windows") || blob.contains("win32") || blob.trim().is_empty() {
        return Some("windows");
    }
    Some("windows")
}

pub fn sanitize_file_stem(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_control() || "<>:\"/\\|?*".contains(ch) {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    let collapsed: String = out
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|ch: char| ch == '.' || ch == ' ' || ch == '-')
        .chars()
        .take(120)
        .collect();
    let trimmed = collapsed.trim().to_string();
    if trimmed.is_empty() {
        return "item".into();
    }
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.iter().any(|row| trimmed.eq_ignore_ascii_case(row)) {
        return format!("{trimmed}-item");
    }
    trimmed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackExportObject {
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedExportResult {
    pub path: String,
    pub files_written: u32,
    pub warnings: Vec<String>,
}

/// Same Graph JSON the inspector Export dialog shows. Assignments are omitted on purpose.
pub fn graph_object_export_value(detail: &GraphObjectDetail) -> Value {
    let mut root = detail.object.clone();
    let Some(map) = root.as_object_mut() else {
        return json!({
            "object": detail.object,
            "settings": detail.settings,
            "extras": detail.extras,
            "scriptText": detail.script_text,
            "detectionScriptText": detail.detection_script_text,
            "remediationScriptText": detail.remediation_script_text,
        });
    };
    map.remove("assignments");
    if let Some(settings) = &detail.settings {
        map.insert("settings".into(), json!(settings));
    }
    if let Some(extras) = &detail.extras {
        map.insert("extras".into(), extras.clone());
    }
    if let Some(text) = &detail.script_text {
        map.insert("scriptText".into(), json!(text));
    }
    if let Some(text) = &detail.detection_script_text {
        map.insert("detectionScriptText".into(), json!(text));
    }
    if let Some(text) = &detail.remediation_script_text {
        map.insert("remediationScriptText".into(), json!(text));
    }
    root
}

pub fn pretty_json(value: &Value) -> Result<String, PackExportError> {
    let mut text = serde_json::to_string_pretty(value)?;
    text.push('\n');
    Ok(text)
}

pub fn dest_dir_from_save_as(path: &Path) -> PathBuf {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    if lower.ends_with(".json") || lower.ends_with(".zip") {
        path.with_extension("")
    } else {
        path.to_path_buf()
    }
}

pub async fn export_selected_graph_objects<F>(
    access_token: &str,
    dest: &Path,
    objects: &[PackExportObject],
    mut on_progress: F,
) -> Result<SelectedExportResult, PackExportError>
where
    F: FnMut(PackExportProgress),
{
    if objects.is_empty() {
        return Err(PackExportError::Message(
            "Select at least one object to export.".into(),
        ));
    }
    let total = objects.len() as u32;
    let mut warnings = Vec::new();
    let mut files_written = 0u32;

    if objects.len() == 1 {
        let item = &objects[0];
        on_progress(progress(
            "export",
            1,
            1,
            item.title.as_deref().unwrap_or(&item.id),
        ));
        let detail = fetch_graph_object_detail(access_token, &item.kind, &item.id).await?;
        let text = pretty_json(&graph_object_export_value(&detail))?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(dest, text)?;
        files_written = 1;
        return Ok(SelectedExportResult {
            path: dest.to_string_lossy().into_owned(),
            files_written,
            warnings,
        });
    }

    fs::create_dir_all(dest)?;
    let mut used = HashSet::new();
    for (index, item) in objects.iter().enumerate() {
        let label = item
            .title
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&item.id);
        on_progress(progress("export", (index + 1) as u32, total, label));
        match fetch_graph_object_detail(access_token, &item.kind, &item.id).await {
            Ok(detail) => {
                let stem = sanitize_file_stem(label);
                let mut name = format!("{stem}.json");
                let mut n = 2u32;
                while !used.insert(name.clone()) {
                    name = format!("{stem}-{n}.json");
                    n += 1;
                }
                let path = dest.join(&name);
                match pretty_json(&graph_object_export_value(&detail)) {
                    Ok(text) => {
                        fs::write(path, text)?;
                        files_written += 1;
                    }
                    Err(error) => warnings.push(format!("{label}: {error}")),
                }
            }
            Err(error) => warnings.push(format!("{label}: {error}")),
        }
    }
    Ok(SelectedExportResult {
        path: dest.to_string_lossy().into_owned(),
        files_written,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_windows_reserved_and_separators() {
        assert_eq!(sanitize_file_stem("Win: BitLocker / OS"), "Win- BitLocker - OS");
        assert_eq!(sanitize_file_stem("CON"), "CON-item");
        assert_eq!(sanitize_file_stem("   "), "item");
    }

    #[test]
    fn routes_platforms() {
        assert_eq!(pack_platform_from_graph(Some("windows10"), None), Some("windows"));
        assert_eq!(pack_platform_from_graph(Some("macOS"), None), Some("macos"));
        assert_eq!(pack_platform_from_graph(Some("android"), None), Some("android"));
        assert_eq!(pack_platform_from_graph(None, Some("#microsoft.graph.iosCompliancePolicy")), None);
        assert_eq!(
            pack_platform_from_graph(None, Some("#microsoft.graph.macosCompliancePolicy")),
            Some("macos")
        );
    }

    #[test]
    fn catalog_settings_drop_definitions() {
        let rows = vec![json!({
            "id": "row-1",
            "settingInstance": { "settingDefinitionId": "def", "value": 1 },
            "settingDefinitions": [{ "id": "def" }]
        })];
        assert_eq!(
            catalog_settings_for_export(&rows),
            vec![json!({ "settingInstance": { "settingDefinitionId": "def", "value": 1 } })]
        );
    }

    #[test]
    fn script_header_is_parseable() {
        let meta = json!({"kind": "script:platform-powershell", "displayName": "TZ"});
        let text = script_file_with_header(&meta, "Write-Host hi\n");
        assert!(text.starts_with("# @axis-pack {"));
        assert!(text.contains("Write-Host hi"));
    }

    #[test]
    fn graph_export_omits_assignments() {
        let detail = GraphObjectDetail {
            id: "p1".into(),
            kind: "configurationPolicy".into(),
            title: "BitLocker".into(),
            object: json!({
                "name": "BitLocker",
                "assignments": [{ "id": "a1" }]
            }),
            assignments: vec![json!({ "id": "a1" })],
            settings: Some(vec![json!({ "settingInstance": { "id": "s1" } })]),
            script_text: None,
            detection_script_text: None,
            remediation_script_text: None,
            extras: None,
            warnings: Vec::new(),
        };
        let exported = graph_object_export_value(&detail);
        assert!(exported.get("assignments").is_none());
        assert_eq!(exported.get("name").and_then(Value::as_str), Some("BitLocker"));
        assert!(exported.get("settings").is_some());
    }

    #[test]
    fn dest_dir_strips_json_extension() {
        let path = dest_dir_from_save_as(Path::new(r"C:\Exports\Contoso.json"));
        assert_eq!(path, PathBuf::from(r"C:\Exports\Contoso"));
    }
}
