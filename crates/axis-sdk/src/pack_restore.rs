//! Selective restore of snapshot pack artifacts into the live tenant.
//!
//! v1 supports Settings Catalog policies and scripts (platform / remediation / compliance).
//! Modes:
//! - **Add** — create when missing; skip when a live match exists (identical or settings differ)
//! - **Update** — patch matching live objects' settings/script content in place when content
//!   differs; skip identical / missing
//!
//! After an identity match (Graph id or display name), Axis compares settings / script text
//! so the plan can show **Identical** vs **Settings differ**.
//! Update is not delete+create — it patches the existing Graph object.

use crate::inventory::{
    fetch_configuration_policies, fetch_tenant_scripts, CatalogPolicySummary, TenantScriptSummary,
};
use crate::object_detail::{
    create_tenant_script, fetch_graph_object_detail, update_script_content, CreateTenantScriptInput,
    UpdateScriptContentInput,
};
use crate::object_duplicate::strip_keys;
use crate::settings_catalog::{
    create_policy_with_settings, create_policy_with_template, replace_catalog_policy_settings,
    SettingsCatalogPlatform,
};
use crate::GraphError;
use futures::stream::{self, StreamExt};
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
    Update,
}

impl RestoreMode {
    pub fn parse(value: &str) -> Result<Self, PackRestoreError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "add" => Ok(Self::Add),
            "update" => Ok(Self::Update),
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
    WillUpdate,
    SkipExists,
    SkipMissing,
    /// Live object matches and settings/script content are the same.
    Identical,
    /// Live object matches by identity, but settings/script content differ.
    SettingsDiffer,
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
    pub updated: u32,
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
    let targets: Vec<_> = payloads
        .into_iter()
        .filter(|payload| selected.is_empty() || selected.contains(payload.key().as_str()))
        .collect();
    let items = plan_items(access_token, &targets, mode, &live, &mut warnings).await;

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
    let mut updated = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;

    let targets: Vec<_> = payloads
        .into_iter()
        .filter(|payload| selected.is_empty() || selected.contains(payload.key().as_str()))
        .collect();
    let total = targets.len();

    for (index, payload) in targets.into_iter().enumerate() {
        let planned = plan_item(access_token, &payload, mode, &live, &mut warnings).await;
        on_progress(format!(
            "{} {} ({}/{})…",
            match planned.status {
                RestoreItemStatus::WillAdd => "Adding",
                RestoreItemStatus::WillUpdate => "Updating",
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
            RestoreItemStatus::WillUpdate => {
                let Some(live_id) = planned.live_id.clone() else {
                    failed += 1;
                    items.push(RestorePlanItem {
                        status: RestoreItemStatus::Failed,
                        message: Some("Missing live id for update.".into()),
                        ..planned
                    });
                    continue;
                };
                match apply_update(access_token, &payload, &live_id).await {
                    Ok(()) => {
                        updated += 1;
                        items.push(RestorePlanItem {
                            status: RestoreItemStatus::Applied,
                            message: Some("Updated".into()),
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
            | RestoreItemStatus::Identical
            | RestoreItemStatus::SettingsDiffer
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
        updated,
        skipped,
        failed,
        warnings,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitApplyPlan {
    pub mode: RestoreMode,
    pub kit_id: String,
    pub kit_name: String,
    pub kit_rel_path: String,
    pub items: Vec<RestorePlanItem>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitApplyResult {
    pub mode: RestoreMode,
    pub kit_id: String,
    pub kit_name: String,
    pub kit_rel_path: String,
    pub items: Vec<RestorePlanItem>,
    pub added: u32,
    pub updated: u32,
    pub skipped: u32,
    pub failed: u32,
    pub warnings: Vec<String>,
}

struct KitApplySelection {
    kit_id: String,
    kit_name: String,
    kit_rel_path: String,
    payloads: Vec<RestorePayload>,
    unsupported: Vec<RestorePlanItem>,
    warnings: Vec<String>,
}

fn normalize_include_path(value: &str) -> String {
    value.replace('\\', "/").trim().trim_matches('/').to_string()
}

fn join_pack_rel(root: &Path, rel: &str) -> PathBuf {
    let mut path = root.to_path_buf();
    for part in normalize_include_path(rel).split('/') {
        if !part.is_empty() {
            path.push(part);
        }
    }
    path
}

fn unsupported_reason_for_include(pack_root: &Path, rel: &str) -> String {
    let lower = rel.to_ascii_lowercase();
    if lower.starts_with("kits/") {
        return "Kit membership files are selections, not Intune objects.".into();
    }
    let path = join_pack_rel(pack_root, rel);
    if !path.is_file() {
        return "File is missing from the pack.".into();
    }
    if lower.contains("/compliance/") {
        return "Compliance policies are not applied from kits in this version.".into();
    }
    if lower.contains("/endpoint-security/") {
        return "Endpoint security intents are not applied from kits in this version.".into();
    }
    if lower.contains("/enrollment/") || lower.contains("/autopilot/") {
        return "Enrolment / Autopilot objects are not applied from kits in this version.".into();
    }
    if lower.contains("/applications/") {
        return "Applications are not applied from kits in this version.".into();
    }
    if lower.contains("/windows-update/") || lower.contains("/group-policy/") {
        return "This artifact type is not applied from kits in this version.".into();
    }
    if lower.ends_with(".json") && lower.contains("/policies/") {
        return "Not a Settings Catalog export (missing settings / catalogPolicy).".into();
    }
    if lower.ends_with(".ps1") || lower.ends_with(".sh") {
        return "Script could not be loaded for apply.".into();
    }
    "Not a supported Settings Catalog policy or script for kit apply.".into()
}

fn read_kit_for_apply(pack_root: &Path, kit_rel_path: &str) -> Result<(String, String, String, Vec<String>), PackRestoreError> {
    let rel = normalize_include_path(kit_rel_path);
    if rel.is_empty() {
        return Err(PackRestoreError::Message("Kit path is required.".into()));
    }
    let path = join_pack_rel(pack_root, &rel);
    if !path.is_file() {
        return Err(PackRestoreError::Message(format!(
            "Kit file not found: {rel}"
        )));
    }
    let text = fs::read_to_string(&path)?;
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{FEFF}'))?;
    let includes: Vec<String> = value
        .get("includes")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(normalize_include_path)
                .filter(|row| !row.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            Path::new(&rel)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "kit".into())
        });
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| id.clone());
    Ok((id, name, rel, includes))
}

fn select_kit_apply_targets(
    pack_root: &Path,
    kit_rel_path: &str,
) -> Result<KitApplySelection, PackRestoreError> {
    let (kit_id, kit_name, kit_rel_path, includes) = read_kit_for_apply(pack_root, kit_rel_path)?;
    let mut warnings = Vec::new();
    if includes.is_empty() {
        warnings.push("This kit has no includes to apply.".into());
    }
    let include_set: std::collections::HashSet<String> = includes.iter().cloned().collect();
    let payloads = load_restore_payloads(pack_root)?;
    let mut matched = Vec::new();
    let mut covered: std::collections::HashSet<String> = std::collections::HashSet::new();
    for payload in payloads {
        let hit: Vec<String> = payload
            .rel_paths()
            .iter()
            .map(|p| normalize_include_path(p))
            .filter(|p| include_set.contains(p))
            .collect();
        if hit.is_empty() {
            continue;
        }
        for path in &hit {
            covered.insert(path.clone());
        }
        matched.push(payload);
    }

    let mut unsupported = Vec::new();
    for rel in &includes {
        if covered.contains(rel) {
            continue;
        }
        let reason = unsupported_reason_for_include(pack_root, rel);
        unsupported.push(RestorePlanItem {
            key: format!("unsupported::{rel}"),
            kind: "unsupported".into(),
            display_name: rel.clone(),
            status: RestoreItemStatus::Unsupported,
            live_id: None,
            message: Some(reason),
        });
    }

    Ok(KitApplySelection {
        kit_id,
        kit_name,
        kit_rel_path,
        payloads: matched,
        unsupported,
        warnings,
    })
}

/// Plan applying a kit's `includes` into the signed-in tenant (catalog + scripts v1).
pub async fn plan_kit_apply(
    access_token: &str,
    pack_root: &Path,
    kit_rel_path: &str,
    mode: RestoreMode,
) -> Result<KitApplyPlan, PackRestoreError> {
    let selection = select_kit_apply_targets(pack_root, kit_rel_path)?;
    let live = load_live_index(access_token).await?;
    let mut warnings = selection.warnings;
    let mut items =
        plan_items(access_token, &selection.payloads, mode, &live, &mut warnings).await;
    items.extend(selection.unsupported);
    Ok(KitApplyPlan {
        mode,
        kit_id: selection.kit_id,
        kit_name: selection.kit_name,
        kit_rel_path: selection.kit_rel_path,
        items,
        warnings,
    })
}

/// Apply selected kit plan keys (or all restorable kit payloads when `selected_keys` is empty).
pub async fn apply_kit_apply(
    access_token: &str,
    pack_root: &Path,
    kit_rel_path: &str,
    mode: RestoreMode,
    selected_keys: &[String],
    mut on_progress: impl FnMut(String),
) -> Result<KitApplyResult, PackRestoreError> {
    let selection = select_kit_apply_targets(pack_root, kit_rel_path)?;
    let selected: std::collections::HashSet<&str> =
        selected_keys.iter().map(String::as_str).collect();
    let live = load_live_index(access_token).await?;
    let mut warnings = selection.warnings;
    let mut items = Vec::new();
    let mut added = 0u32;
    let mut updated = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;

    let targets: Vec<_> = selection
        .payloads
        .into_iter()
        .filter(|payload| selected.is_empty() || selected.contains(payload.key().as_str()))
        .collect();
    let total = targets.len();

    for (index, payload) in targets.into_iter().enumerate() {
        let planned = plan_item(access_token, &payload, mode, &live, &mut warnings).await;
        on_progress(format!(
            "{} {} ({}/{})…",
            match planned.status {
                RestoreItemStatus::WillAdd => "Adding",
                RestoreItemStatus::WillUpdate => "Updating",
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
            RestoreItemStatus::WillUpdate => {
                let Some(live_id) = planned.live_id.clone() else {
                    failed += 1;
                    items.push(RestorePlanItem {
                        status: RestoreItemStatus::Failed,
                        message: Some("Missing live id for update.".into()),
                        ..planned
                    });
                    continue;
                };
                match apply_update(access_token, &payload, &live_id).await {
                    Ok(()) => {
                        updated += 1;
                        items.push(RestorePlanItem {
                            status: RestoreItemStatus::Applied,
                            message: Some("Updated".into()),
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
            | RestoreItemStatus::Identical
            | RestoreItemStatus::SettingsDiffer
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

    for row in selection.unsupported {
        skipped += 1;
        items.push(RestorePlanItem {
            status: RestoreItemStatus::Skipped,
            ..row
        });
    }

    Ok(KitApplyResult {
        mode,
        kit_id: selection.kit_id,
        kit_name: selection.kit_name,
        kit_rel_path: selection.kit_rel_path,
        items,
        added,
        updated,
        skipped,
        failed,
        warnings,
    })
}

/// Offline helper for tests: which includes map to restorable payloads vs unsupported.
pub fn kit_apply_selection_preview(
    pack_root: &Path,
    kit_rel_path: &str,
) -> Result<(Vec<String>, Vec<RestorePlanItem>), PackRestoreError> {
    let selection = select_kit_apply_targets(pack_root, kit_rel_path)?;
    let keys = selection
        .payloads
        .iter()
        .map(|payload| payload.key())
        .collect();
    Ok((keys, selection.unsupported))
}

#[derive(Clone)]
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

const COMPARE_STRIP_KEYS: &[&str] = &[
    "@odata.type",
    "@odata.id",
    "@odata.context",
    "@odata.editLink",
    "@odata.associationLink",
    "@odata.navigationLink",
    "@odata.count",
    "id",
    "settingDefinitions",
    "settingDefinition",
    "settingInstanceTemplateReference",
    "settingValueTemplateReference",
];

const PLAN_COMPARE_CONCURRENCY: usize = 8;

async fn plan_items(
    access_token: &str,
    payloads: &[RestorePayload],
    mode: RestoreMode,
    live: &LiveIndex,
    warnings: &mut Vec<String>,
) -> Vec<RestorePlanItem> {
    let live = live.clone();
    let planned: Vec<(usize, RestorePlanItem, Vec<String>)> =
        stream::iter(payloads.iter().cloned().enumerate())
            .map(|(index, payload)| {
                let token = access_token.to_string();
                let live = live.clone();
                async move {
                    let mut local_warnings = Vec::new();
                    let item =
                        plan_item(&token, &payload, mode, &live, &mut local_warnings).await;
                    (index, item, local_warnings)
                }
            })
            .buffer_unordered(PLAN_COMPARE_CONCURRENCY)
            .collect()
            .await;

    let mut ordered = planned;
    ordered.sort_by_key(|(index, _, _)| *index);
    let mut out = Vec::with_capacity(ordered.len());
    for (_, item, local_warnings) in ordered {
        warnings.extend(local_warnings);
        out.push(item);
    }
    out
}

async fn plan_item(
    access_token: &str,
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

    let content = match match_live.as_ref() {
        Some((live_id, _)) => {
            match compare_payload_to_live(access_token, payload, live_id).await {
                Ok(equal) => Some(equal),
                Err(error) => {
                    warnings.push(format!(
                        "{}: could not compare content ({error}); using identity only.",
                        payload.display_name()
                    ));
                    None
                }
            }
        }
        None => None,
    };

    let (status, message) = match (mode, match_live.as_ref(), content) {
        (RestoreMode::Add, None, _) => (
            RestoreItemStatus::WillAdd,
            Some("Will create.".into()),
        ),
        (RestoreMode::Update, None, _) => (
            RestoreItemStatus::SkipMissing,
            Some("No live match — skipped for Update.".into()),
        ),
        (_, Some(_), Some(true)) => (
            RestoreItemStatus::Identical,
            Some("Already present with the same settings.".into()),
        ),
        (RestoreMode::Add, Some(_), Some(false)) => (
            RestoreItemStatus::SettingsDiffer,
            Some("Exists with different settings — switch to Update to align.".into()),
        ),
        (RestoreMode::Update, Some(_), Some(false)) => (
            RestoreItemStatus::WillUpdate,
            Some("Will update live object settings in place.".into()),
        ),
        (RestoreMode::Add, Some(_), None) => (
            RestoreItemStatus::SkipExists,
            Some("Already present in tenant — skipped for Add.".into()),
        ),
        (RestoreMode::Update, Some(_), None) => (
            RestoreItemStatus::WillUpdate,
            Some("Will update live object in place.".into()),
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

async fn compare_payload_to_live(
    access_token: &str,
    payload: &RestorePayload,
    live_id: &str,
) -> Result<bool, PackRestoreError> {
    match payload {
        RestorePayload::Catalog { settings, .. } => {
            let detail =
                fetch_graph_object_detail(access_token, "configurationPolicy", live_id).await?;
            let live_settings = detail.settings.unwrap_or_default();
            Ok(catalog_settings_equivalent(settings, &live_settings))
        }
        RestorePayload::Script {
            kind,
            script_text,
            detection_script_text,
            remediation_script_text,
            ..
        } => {
            let detail =
                fetch_graph_object_detail(access_token, &normalize_script_kind(kind), live_id)
                    .await?;
            Ok(script_content_equivalent(
                script_text.as_deref(),
                detection_script_text.as_deref(),
                remediation_script_text.as_deref(),
                detail.script_text.as_deref(),
                detail.detection_script_text.as_deref(),
                detail.remediation_script_text.as_deref(),
            ))
        }
    }
}

fn normalize_script_body(value: Option<&str>) -> String {
    value.unwrap_or("").replace("\r\n", "\n").trim().to_string()
}

fn script_content_equivalent(
    pack_script: Option<&str>,
    pack_detect: Option<&str>,
    pack_remediate: Option<&str>,
    live_script: Option<&str>,
    live_detect: Option<&str>,
    live_remediate: Option<&str>,
) -> bool {
    normalize_script_body(pack_script) == normalize_script_body(live_script)
        && normalize_script_body(pack_detect) == normalize_script_body(live_detect)
        && normalize_script_body(pack_remediate) == normalize_script_body(live_remediate)
}

fn setting_instance_for_compare(row: &Value) -> Value {
    let instance = row
        .get("settingInstance")
        .cloned()
        .unwrap_or_else(|| row.clone());
    strip_keys(&instance, COMPARE_STRIP_KEYS)
}

fn catalog_settings_equivalent(pack: &[Value], live: &[Value]) -> bool {
    let pack_map = settings_map_for_compare(pack);
    let live_map = settings_map_for_compare(live);
    pack_map == live_map
}

fn settings_map_for_compare(rows: &[Value]) -> BTreeMap<String, Value> {
    let mut map = BTreeMap::new();
    for (index, row) in rows.iter().enumerate() {
        let cleaned = setting_instance_for_compare(row);
        let id = cleaned
            .get("settingDefinitionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("#{index}"));
        map.insert(id, cleaned);
    }
    map
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

async fn apply_update(
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
            if name == "baselines" || name == "kits" || name == "third-party" || name == ".git" {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn write_file(root: &Path, rel: &str, contents: &str) {
        let path = join_pack_rel(root, rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn kit_apply_preview_splits_supported_and_unsupported() {
        let root = std::env::temp_dir().join(format!("axis-kit-apply-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        write_file(
            &root,
            "windows/policies/demo.json",
            &json!({
                "name": "Demo Catalog",
                "platforms": "windows10",
                "technologies": "mdm",
                "settings": [{
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting",
                    "settingInstance": {
                        "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
                        "settingDefinitionId": "device_vendor_msft_demo",
                        "choiceSettingValue": { "value": "device_vendor_msft_demo_1", "children": [] }
                    }
                }],
                "axisExport": { "kind": "catalogPolicy" }
            })
            .to_string(),
        );
        write_file(
            &root,
            "windows/scripts/platform/Hello.ps1",
            "# @axis-pack {\"displayName\":\"Hello\",\"kind\":\"platform-powershell\"}\nWrite-Host hi\n",
        );
        write_file(
            &root,
            "windows/compliance/placeholder.json",
            &json!({ "name": "Compliance placeholder", "axisExport": { "kind": "compliancePolicy" } }).to_string(),
        );
        write_file(
            &root,
            "kits/basic.json",
            &json!({
                "id": "basic",
                "name": "Basic",
                "includes": [
                    "windows/policies/demo.json",
                    "windows/scripts/platform/Hello.ps1",
                    "windows/compliance/placeholder.json",
                    "windows/missing/nope.json"
                ]
            })
            .to_string(),
        );

        let (keys, unsupported) = kit_apply_selection_preview(&root, "kits/basic.json").unwrap();
        assert_eq!(keys.len(), 2, "expected catalog + script payloads, got {keys:?}");
        assert_eq!(unsupported.len(), 2);
        assert!(unsupported.iter().any(|row| row.display_name.contains("compliance")));
        assert!(unsupported.iter().any(|row| {
            row.display_name.contains("missing")
                && row
                    .message
                    .as_deref()
                    .unwrap_or("")
                    .contains("missing")
        }));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn kit_apply_preview_empty_includes() {
        let root = std::env::temp_dir().join(format!("axis-kit-apply-empty-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        write_file(
            &root,
            "kits/empty.json",
            &json!({ "id": "empty", "name": "Empty", "includes": [] }).to_string(),
        );
        let (keys, unsupported) = kit_apply_selection_preview(&root, "kits/empty.json").unwrap();
        assert!(keys.is_empty());
        assert!(unsupported.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_settings_compare_ignores_odata_noise() {
        let pack = vec![json!({
            "settingInstance": {
                "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
                "settingDefinitionId": "device_vendor_msft_demo",
                "choiceSettingValue": {
                    "value": "device_vendor_msft_demo_1",
                    "children": []
                }
            }
        })];
        let live = vec![json!({
            "id": "0",
            "@odata.id": "noise",
            "settingInstance": {
                "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
                "settingDefinitionId": "device_vendor_msft_demo",
                "settingInstanceTemplateReference": { "settingInstanceTemplateId": "tpl" },
                "choiceSettingValue": {
                    "value": "device_vendor_msft_demo_1",
                    "settingValueTemplateReference": { "settingValueTemplateId": "v" },
                    "children": []
                }
            },
            "settingDefinitions": []
        })];
        assert!(catalog_settings_equivalent(&pack, &live));

        let live_diff = vec![json!({
            "settingInstance": {
                "settingDefinitionId": "device_vendor_msft_demo",
                "choiceSettingValue": {
                    "value": "device_vendor_msft_demo_0",
                    "children": []
                }
            }
        })];
        assert!(!catalog_settings_equivalent(&pack, &live_diff));
    }
}

