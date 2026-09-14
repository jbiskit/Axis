//! Selective restore of snapshot pack artifacts into the live tenant.
//!
//! v1 supports Settings Catalog policies and scripts (platform / remediation / compliance).
//! Modes:
//! - **Add** — create when missing; skip when a live match exists
//! - **Replace** — update matching live objects; skip when no match

use crate::inventory::{
    fetch_configuration_policies, fetch_tenant_scripts, CatalogPolicySummary, TenantScriptSummary,
};
use crate::object_detail::{
    create_tenant_script, update_script_content, CreateTenantScriptInput, UpdateScriptContentInput,
};
use crate::settings_catalog::{
    create_policy_with_settings, create_policy_with_template, replace_catalog_policy_settings,
    SettingsCatalogPlatform,
};
use crate::GraphError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PackRestoreError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Graph(#[from] GraphError),
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreMode {
    Add,
    Replace,
}

impl RestoreMode {
    pub fn parse(value: &str) -> Result<Self, PackRestoreError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "add" => Ok(Self::Add),
            "replace" => Ok(Self::Replace),
            other => Err(PackRestoreError::Message(format!(
                "Unknown restore mode: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreItemStatus {
    WillAdd,
    WillReplace,
    SkipExists,
    SkipMissing,
    Unsupported,
    Applied,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreCandidate {
    pub key: String,
    pub kind: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub rel_paths: Vec<String>,
    pub restorable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePlanItem {
    pub key: String,
    pub kind: String,
    pub display_name: String,
    pub status: RestoreItemStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePlan {
    pub mode: RestoreMode,
    pub snapshot_id: String,
    pub items: Vec<RestorePlanItem>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreApplyResult {
    pub mode: RestoreMode,
    pub snapshot_id: String,
    pub items: Vec<RestorePlanItem>,
    pub added: u32,
    pub replaced: u32,
    pub skipped: u32,
    pub failed: u32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
enum RestorePayload {
    Catalog {
        name: String,
        description: Option<String>,
        platform: SettingsCatalogPlatform,
        platforms_raw: Option<String>,
        technologies_raw: Option<String>,
        template_id: Option<String>,
        template_family: Option<String>,
        settings: Vec<Value>,
        source_id: Option<String>,
        rel_paths: Vec<String>,
    },
    Script {
        kind: String,
        display_name: String,
        description: Option<String>,
        publisher: Option<String>,
        run_as_account: Option<String>,
        run_as_32_bit: Option<bool>,
        enforce_signature_check: Option<bool>,
        script_text: Option<String>,
        detection_script_text: Option<String>,
        remediation_script_text: Option<String>,
        source_id: Option<String>,
        rel_paths: Vec<String>,
    },
}

impl RestorePayload {
    fn key(&self) -> String {
        match self {
            Self::Catalog {
                source_id, name, ..
            } => identity_key("catalogPolicy", source_id.as_deref(), name),
            Self::Script {
                kind,
                source_id,
                display_name,
                ..
            } => identity_key(kind, source_id.as_deref(), display_name),
        }
    }

    fn kind_label(&self) -> &str {
        match self {
            Self::Catalog { .. } => "catalogPolicy",
            Self::Script { kind, .. } => kind.as_str(),
        }
    }

    fn display_name(&self) -> &str {
        match self {
            Self::Catalog { name, .. } => name.as_str(),
            Self::Script { display_name, .. } => display_name.as_str(),
        }
    }

    fn source_id(&self) -> Option<&str> {
        match self {
            Self::Catalog { source_id, .. } => source_id.as_deref(),
            Self::Script { source_id, .. } => source_id.as_deref(),
        }
    }

    fn rel_paths(&self) -> &[String] {
        match self {
            Self::Catalog { rel_paths, .. } | Self::Script { rel_paths, .. } => rel_paths,
        }
    }
}

fn identity_key(kind: &str, source_id: Option<&str>, name: &str) -> String {
    if let Some(id) = source_id.map(str::trim).filter(|v| !v.is_empty()) {
        return format!("{kind}::{id}");
    }
    format!("{kind}::name:{}", name.trim().to_ascii_lowercase())
}

pub fn list_restore_candidates(pack_root: &Path) -> Result<Vec<RestoreCandidate>, PackRestoreError> {
    let payloads = load_restore_payloads(pack_root)?;
    Ok(payloads
        .into_iter()
        .map(|payload| {
            let restorable = matches!(
                payload.kind_label(),
                "catalogPolicy"
                    | "script:platform-powershell"
                    | "script:platform-shell"
                    | "platform-powershell"
                    | "platform-shell"
                    | "script:remediation"
                    | "remediation"
                    | "script:compliance"
                    | "compliance"
            );
            RestoreCandidate {
                key: payload.key(),
                kind: payload.kind_label().to_string(),
                display_name: payload.display_name().to_string(),
                source_id: payload.source_id().map(str::to_string),
                rel_paths: payload.rel_paths().to_vec(),
                restorable,
                note: if restorable {
                    None
                } else {
                    Some("This artifact type is not restorable in this version.".into())
                },
            }
        })
        .collect())
}

pub async fn plan_restore(
    access_token: &str,
    pack_root: &Path,
    snapshot_id: &str,
    mode: RestoreMode,
    selected_keys: &[String],
) -> Result<RestorePlan, PackRestoreError> {
    let payloads = load_restore_payloads(pack_root)?;
    let selected: std::collections::HashSet<&str> =
        selected_keys.iter().map(String::as_str).collect();
    let live = load_live_index(access_token).await?;
    let mut warnings = Vec::new();
    let mut items = Vec::new();

    for payload in payloads {
        let key = payload.key();
        if !selected.is_empty() && !selected.contains(key.as_str()) {
            continue;
        }
        items.push(plan_item(&payload, mode, &live, &mut warnings));
    }

    Ok(RestorePlan {
        mode,
        snapshot_id: snapshot_id.to_string(),
        items,
        warnings,
    })
}

pub async fn apply_restore(
    access_token: &str,
    pack_root: &Path,
    snapshot_id: &str,
    mode: RestoreMode,
    selected_keys: &[String],
    mut on_progress: impl FnMut(String),
) -> Result<RestoreApplyResult, PackRestoreError> {
    let payloads = load_restore_payloads(pack_root)?;
    let selected: std::collections::HashSet<&str> =
        selected_keys.iter().map(String::as_str).collect();
    let live = load_live_index(access_token).await?;
    let mut warnings = Vec::new();
    let mut items = Vec::new();
    let mut added = 0u32;
    let mut replaced = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;

    let targets: Vec<_> = payloads
        .into_iter()
        .filter(|payload| selected.is_empty() || selected.contains(payload.key().as_str()))
        .collect();
    let total = targets.len();

    for (index, payload) in targets.into_iter().enumerate() {
        let planned = plan_item(&payload, mode, &live, &mut warnings);
        on_progress(format!(
            "{} {} ({}/{})…",
            match planned.status {
                RestoreItemStatus::WillAdd => "Adding",
                RestoreItemStatus::WillReplace => "Replacing",
                _ => "Skipping",
            },
            payload.display_name(),
            index + 1,
            total
        ));

        match planned.status {
            RestoreItemStatus::WillAdd => match apply_add(access_token, &payload).await {
                Ok(live_id) => {
                    added += 1;
                    items.push(RestorePlanItem {
                        status: RestoreItemStatus::Applied,
                        live_id: Some(live_id),
                        message: Some("Created".into()),
                        ..planned
                    });
                }
                Err(error) => {
                    failed += 1;
                    items.push(RestorePlanItem {
                        status: RestoreItemStatus::Failed,
                        message: Some(error.to_string()),
                        ..planned
                    });
                }
            },
            RestoreItemStatus::WillReplace => {
                let Some(live_id) = planned.live_id.clone() else {
                    failed += 1;
                    items.push(RestorePlanItem {
                        status: RestoreItemStatus::Failed,
                        message: Some("Missing live id for replace.".into()),
                        ..planned
                    });
                    continue;
                };
                match apply_replace(access_token, &payload, &live_id).await {
                    Ok(()) => {
                        replaced += 1;
                        items.push(RestorePlanItem {
                            status: RestoreItemStatus::Applied,
                            message: Some("Replaced".into()),
                            ..planned
                        });
                    }
                    Err(error) => {
                        failed += 1;
                        items.push(RestorePlanItem {
                            status: RestoreItemStatus::Failed,
                            message: Some(error.to_string()),
                            ..planned
                        });
                    }
                }
            }
            RestoreItemStatus::SkipExists
            | RestoreItemStatus::SkipMissing
            | RestoreItemStatus::Unsupported
            | RestoreItemStatus::Skipped => {
                skipped += 1;
                items.push(RestorePlanItem {
                    status: RestoreItemStatus::Skipped,
                    ..planned
                });
            }
            RestoreItemStatus::Applied | RestoreItemStatus::Failed => items.push(planned),
        }
    }

    Ok(RestoreApplyResult {
        mode,
        snapshot_id: snapshot_id.to_string(),
        items,
        added,
        replaced,
        skipped,
        failed,
        warnings,
    })
}

struct LiveIndex {
    catalog_by_id: HashMap<String, CatalogPolicySummary>,
    catalog_by_name: HashMap<String, CatalogPolicySummary>,
    scripts_by_id: HashMap<String, TenantScriptSummary>,
    scripts_by_name: HashMap<String, Vec<TenantScriptSummary>>,
}

async fn load_live_index(access_token: &str) -> Result<LiveIndex, PackRestoreError> {
    let catalog = fetch_configuration_policies(access_token).await?;
    let scripts = fetch_tenant_scripts(access_token).await?;
    let mut catalog_by_id = HashMap::new();
    let mut catalog_by_name = HashMap::new();
    for item in catalog.items {
        catalog_by_id.insert(item.id.clone(), item.clone());
        catalog_by_name.insert(item.name.trim().to_ascii_lowercase(), item);
    }
    let mut scripts_by_id = HashMap::new();
    let mut scripts_by_name: HashMap<String, Vec<TenantScriptSummary>> = HashMap::new();
    for item in scripts.items {
        scripts_by_id.insert(item.id.clone(), item.clone());
        scripts_by_name
            .entry(item.display_name.trim().to_ascii_lowercase())
            .or_default()
            .push(item);
    }
    Ok(LiveIndex {
        catalog_by_id,
        catalog_by_name,
        scripts_by_id,
        scripts_by_name,
    })
}

fn plan_item(
    payload: &RestorePayload,
    mode: RestoreMode,
    live: &LiveIndex,
    warnings: &mut Vec<String>,
) -> RestorePlanItem {
    let match_live = match payload {
        RestorePayload::Catalog {
            source_id, name, ..
        } => resolve_catalog_match(live, source_id.as_deref(), name),
        RestorePayload::Script {
            kind,
            source_id,
            display_name,
            ..
        } => resolve_script_match(live, kind, source_id.as_deref(), display_name, warnings),
    };

    let (status, message) = match (mode, match_live.as_ref()) {
        (RestoreMode::Add, Some(_)) => (
            RestoreItemStatus::SkipExists,
            Some("Already present in tenant — skipped for Add.".into()),
        ),
        (RestoreMode::Add, None) => (RestoreItemStatus::WillAdd, Some("Will create.".into())),
        (RestoreMode::Replace, Some(_)) => (
            RestoreItemStatus::WillReplace,
            Some("Will overwrite live object.".into()),
        ),
        (RestoreMode::Replace, None) => (
            RestoreItemStatus::SkipMissing,
            Some("No live match — skipped for Replace.".into()),
        ),
    };

    RestorePlanItem {
        key: payload.key(),
        kind: payload.kind_label().to_string(),
        display_name: payload.display_name().to_string(),
        status,
        live_id: match_live.map(|(id, _)| id),
        message,
    }
}

fn resolve_catalog_match(
    live: &LiveIndex,
    source_id: Option<&str>,
    name: &str,
) -> Option<(String, String)> {
    if let Some(id) = source_id.map(str::trim).filter(|v| !v.is_empty()) {
        if let Some(item) = live.catalog_by_id.get(id) {
            return Some((item.id.clone(), item.name.clone()));
        }
    }
    live.catalog_by_name
        .get(&name.trim().to_ascii_lowercase())
        .map(|item| (item.id.clone(), item.name.clone()))
}

fn resolve_script_match(
    live: &LiveIndex,
    kind: &str,
    source_id: Option<&str>,
    display_name: &str,
    warnings: &mut Vec<String>,
) -> Option<(String, String)> {
    let normalized_kind = normalize_script_kind(kind);
    if let Some(id) = source_id.map(str::trim).filter(|v| !v.is_empty()) {
        if let Some(item) = live.scripts_by_id.get(id) {
            return Some((item.id.clone(), item.display_name.clone()));
        }
    }
    let matches = live
        .scripts_by_name
        .get(&display_name.trim().to_ascii_lowercase())
        .into_iter()
        .flatten()
        .filter(|item| normalize_script_kind(&item.kind) == normalized_kind)
        .collect::<Vec<_>>();
    if matches.len() > 1 {
        warnings.push(format!(
            "Multiple live scripts named {display_name:?} ({normalized_kind}); using the first."
        ));
    }
    matches
        .first()
        .map(|item| (item.id.clone(), item.display_name.clone()))
}

fn normalize_script_kind(kind: &str) -> String {
    kind.trim()
        .trim_start_matches("script:")
        .to_ascii_lowercase()
}

async fn apply_add(access_token: &str, payload: &RestorePayload) -> Result<String, PackRestoreError> {
    match payload {
        RestorePayload::Catalog {
            name,
            description,
            platform,
            platforms_raw,
            technologies_raw,
            template_id,
            template_family,
            settings,
            ..
        } => {
            let created = if let Some(template_id) = template_id.as_deref().map(str::trim).filter(|v| !v.is_empty())
            {
                create_policy_with_template(
                    access_token,
                    name,
                    description.as_deref(),
                    *platform,
                    template_id,
                    template_family.as_deref(),
                    settings,
                    platforms_raw.as_deref(),
                    technologies_raw.as_deref(),
                )
                .await?
            } else {
                create_policy_with_settings(
                    access_token,
                    name,
                    description.as_deref(),
                    *platform,
                    settings,
                )
                .await?
            };
            Ok(created.id)
        }
        RestorePayload::Script {
            kind,
            display_name,
            description,
            publisher,
            run_as_account,
            run_as_32_bit,
            enforce_signature_check,
            script_text,
            detection_script_text,
            remediation_script_text,
            ..
        } => {
            let created = create_tenant_script(
                access_token,
                CreateTenantScriptInput {
                    kind: normalize_script_kind(kind),
                    display_name: display_name.clone(),
                    description: description.clone(),
                    publisher: publisher.clone(),
                    run_as_account: run_as_account.clone(),
                    file_name: None,
                    script_text: script_text.clone(),
                    detection_script_text: detection_script_text.clone(),
                    remediation_script_text: remediation_script_text.clone(),
                    run_as_32_bit: *run_as_32_bit,
                    enforce_signature_check: *enforce_signature_check,
                },
            )
            .await?;
            Ok(created.id)
        }
    }
}

async fn apply_replace(
    access_token: &str,
    payload: &RestorePayload,
    live_id: &str,
) -> Result<(), PackRestoreError> {
    match payload {
        RestorePayload::Catalog { settings, .. } => {
            replace_catalog_policy_settings(access_token, live_id, settings).await?;
            Ok(())
        }
        RestorePayload::Script {
            kind,
            display_name,
            description,
            publisher,
            run_as_account,
            run_as_32_bit,
            enforce_signature_check,
            script_text,
            detection_script_text,
            remediation_script_text,
            ..
        } => {
            update_script_content(
                access_token,
                &UpdateScriptContentInput {
                    kind: normalize_script_kind(kind),
                    id: live_id.to_string(),
                    display_name: Some(display_name.clone()),
                    description: description.clone(),
                    publisher: publisher.clone(),
                    run_as_account: run_as_account.clone(),
                    run_as_32_bit: *run_as_32_bit,
                    enforce_signature_check: *enforce_signature_check,
                    script_text: script_text.clone(),
                    detection_script_text: detection_script_text.clone(),
                    remediation_script_text: remediation_script_text.clone(),
                },
            )
            .await?;
            Ok(())
        }
    }
}

fn load_restore_payloads(pack_root: &Path) -> Result<Vec<RestorePayload>, PackRestoreError> {
    if !pack_root.is_dir() {
        return Err(PackRestoreError::Message(format!(
            "Pack folder missing: {}",
            pack_root.display()
        )));
    }
    let mut files = Vec::new();
    collect_files(pack_root, pack_root, &mut files)?;

    let mut catalog = Vec::new();
    let mut script_pieces: BTreeMap<String, ScriptPieces> = BTreeMap::new();

    for path in files {
        let rel = rel_path(pack_root, &path);
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext == "json" {
            if let Some(payload) = load_catalog_payload(&path, &rel)? {
                catalog.push(payload);
            }
            continue;
        }
        if matches!(ext.as_str(), "ps1" | "sh") {
            if let Some((group_key, piece)) = load_script_piece(&path, &rel)? {
                script_pieces.entry(group_key).or_default().push(piece);
            }
        }
    }

    let mut out = catalog;
    for (_, pieces) in script_pieces {
        if let Some(payload) = merge_script_pieces(pieces) {
            out.push(payload);
        }
    }
    out.sort_by(|a, b| {
        a.kind_label()
            .cmp(b.kind_label())
            .then_with(|| a.display_name().to_ascii_lowercase().cmp(&b.display_name().to_ascii_lowercase()))
    });
    Ok(out)
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), PackRestoreError> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            if name == "baselines" || name == "third-party" || name == ".git" {
                continue;
            }
            collect_files(root, &path, out)?;
            continue;
        }
        out.push(path);
    }
    Ok(())
}

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn load_catalog_payload(
    path: &Path,
    rel: &str,
) -> Result<Option<RestorePayload>, PackRestoreError> {
    let text = fs::read_to_string(path)?;
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{FEFF}'))?;
    let axis_kind = value
        .pointer("/axisExport/kind")
        .and_then(Value::as_str)
        .unwrap_or("");
    let settings = value
        .get("settings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if settings.is_empty() {
        return Ok(None);
    }
    if !axis_kind.is_empty() && axis_kind != "catalogPolicy" {
        // Other JSON types (compliance etc.) — not in v1.
        return Ok(None);
    }
    if !rel.to_ascii_lowercase().contains("/policies/") && axis_kind != "catalogPolicy" {
        return Ok(None);
    }

    let name = value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Imported policy".into())
        });
    let description = value
        .get("description")
        .and_then(Value::as_str)
        .map(str::to_string);
    let platforms_raw = value
        .get("platforms")
        .and_then(Value::as_str)
        .map(str::to_string);
    let technologies_raw = value
        .get("technologies")
        .and_then(Value::as_str)
        .map(str::to_string);
    let platform = SettingsCatalogPlatform::parse(platforms_raw.as_deref().unwrap_or("windows"));
    let template_id = value
        .pointer("/templateReference/templateId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let template_family = value
        .pointer("/templateReference/templateFamily")
        .and_then(Value::as_str)
        .map(str::to_string);
    let source_id = value
        .pointer("/axisExport/sourceId")
        .and_then(Value::as_str)
        .map(str::to_string);

    Ok(Some(RestorePayload::Catalog {
        name,
        description,
        platform,
        platforms_raw,
        technologies_raw,
        template_id,
        template_family,
        settings,
        source_id,
        rel_paths: vec![rel.to_string()],
    }))
}

#[derive(Default)]
struct ScriptPieces {
    pieces: Vec<ScriptPiece>,
}

impl ScriptPieces {
    fn push(&mut self, piece: ScriptPiece) {
        self.pieces.push(piece);
    }
}

struct ScriptPiece {
    kind: String,
    role: ScriptRole,
    display_name: String,
    description: Option<String>,
    publisher: Option<String>,
    run_as_account: Option<String>,
    run_as_32_bit: Option<bool>,
    enforce_signature_check: Option<bool>,
    body: String,
    source_id: Option<String>,
    rel_path: String,
}

#[derive(Clone, Copy)]
enum ScriptRole {
    Body,
    Detect,
    Remediate,
}

fn load_script_piece(
    path: &Path,
    rel: &str,
) -> Result<Option<(String, ScriptPiece)>, PackRestoreError> {
    let text = fs::read_to_string(path)?;
    let (meta, body) = split_axis_pack_script(&text);
    let kind_raw = meta
        .as_ref()
        .and_then(|m| m.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let kind = if kind_raw.is_empty() {
        if rel.contains("/scripts/remediation/") {
            "script:remediation"
        } else if rel.contains("/scripts/compliance/") {
            "script:compliance"
        } else if path.extension().and_then(|e| e.to_str()) == Some("sh") {
            "script:platform-shell"
        } else {
            "script:platform-powershell"
        }
    } else {
        kind_raw
    };
    let role = if kind.contains("remediate") || path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.contains("-remediate"))
    {
        ScriptRole::Remediate
    } else if kind.contains("detect")
        || path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.contains("-detect"))
    {
        ScriptRole::Detect
    } else {
        ScriptRole::Body
    };

    let display_name = meta
        .as_ref()
        .and_then(|m| m.get("displayName"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Imported script".into())
                .replace("-detect", "")
                .replace("-remediate", "")
        });
    let source_id = meta
        .as_ref()
        .and_then(|m| m.get("sourceId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let group_kind = if kind.contains("remediation") {
        "script:remediation"
    } else if kind.contains("compliance") {
        "script:compliance"
    } else if kind.contains("shell") {
        "script:platform-shell"
    } else {
        "script:platform-powershell"
    };
    let group_key = identity_key(group_kind, source_id.as_deref(), &display_name);

    Ok(Some((
        group_key,
        ScriptPiece {
            kind: group_kind.to_string(),
            role,
            display_name,
            description: meta
                .as_ref()
                .and_then(|m| m.get("description"))
                .and_then(Value::as_str)
                .map(str::to_string),
            publisher: meta
                .as_ref()
                .and_then(|m| m.get("publisher"))
                .and_then(Value::as_str)
                .map(str::to_string),
            run_as_account: meta
                .as_ref()
                .and_then(|m| m.get("runAsAccount"))
                .and_then(Value::as_str)
                .map(str::to_string),
            run_as_32_bit: meta.as_ref().and_then(|m| m.get("runAs32Bit")).and_then(Value::as_bool),
            enforce_signature_check: meta
                .as_ref()
                .and_then(|m| m.get("enforceSignatureCheck"))
                .and_then(Value::as_bool),
            body: body.replace("\r\n", "\n").trim().to_string(),
            source_id,
            rel_path: rel.to_string(),
        },
    )))
}

fn merge_script_pieces(pieces: ScriptPieces) -> Option<RestorePayload> {
    if pieces.pieces.is_empty() {
        return None;
    }
    let first = &pieces.pieces[0];
    let kind = first.kind.clone();
    let display_name = first.display_name.clone();
    let source_id = pieces
        .pieces
        .iter()
        .find_map(|p| p.source_id.clone())
        .or_else(|| first.source_id.clone());
    let mut detection = None;
    let mut remediation = None;
    let mut body = None;
    let mut rel_paths = Vec::new();
    for piece in &pieces.pieces {
        rel_paths.push(piece.rel_path.clone());
        match piece.role {
            ScriptRole::Detect => detection = Some(piece.body.clone()),
            ScriptRole::Remediate => remediation = Some(piece.body.clone()),
            ScriptRole::Body => body = Some(piece.body.clone()),
        }
    }
    if kind.contains("remediation") {
        let detection = detection.or(body.clone()).unwrap_or_default();
        if detection.trim().is_empty() {
            return None;
        }
        Some(RestorePayload::Script {
            kind,
            display_name,
            description: first.description.clone(),
            publisher: first.publisher.clone(),
            run_as_account: first.run_as_account.clone(),
            run_as_32_bit: first.run_as_32_bit,
            enforce_signature_check: first.enforce_signature_check,
            script_text: None,
            detection_script_text: Some(detection),
            remediation_script_text: Some(remediation.unwrap_or_default()),
            source_id,
            rel_paths,
        })
    } else if kind.contains("compliance") {
        let detection = detection.or(body).unwrap_or_default();
        if detection.trim().is_empty() {
            return None;
        }
        Some(RestorePayload::Script {
            kind,
            display_name,
            description: first.description.clone(),
            publisher: first.publisher.clone(),
            run_as_account: first.run_as_account.clone(),
            run_as_32_bit: first.run_as_32_bit,
            enforce_signature_check: first.enforce_signature_check,
            script_text: None,
            detection_script_text: Some(detection),
            remediation_script_text: None,
            source_id,
            rel_paths,
        })
    } else {
        let script_text = body.or(detection).unwrap_or_default();
        if script_text.trim().is_empty() {
            return None;
        }
        Some(RestorePayload::Script {
            kind,
            display_name,
            description: first.description.clone(),
            publisher: first.publisher.clone(),
            run_as_account: first.run_as_account.clone(),
            run_as_32_bit: first.run_as_32_bit,
            enforce_signature_check: first.enforce_signature_check,
            script_text: Some(script_text),
            detection_script_text: None,
            remediation_script_text: None,
            source_id,
            rel_paths,
        })
    }
}

fn split_axis_pack_script(text: &str) -> (Option<Value>, &str) {
    let trimmed = text.trim_start_matches('\u{FEFF}');
    for line in trimmed.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        const PREFIX: &str = "# @axis-pack ";
        if let Some(rest) = line.strip_prefix(PREFIX) {
            let meta = serde_json::from_str(rest).ok();
            let body = if let Some(pos) = trimmed.find('\n') {
                &trimmed[pos + 1..]
            } else {
                ""
            };
            return (meta, body);
        }
        break;
    }
    (None, trimmed)
}
