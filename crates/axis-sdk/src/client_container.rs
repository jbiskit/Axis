//! Client containers — user-chosen folders that scope Axis work to one Entra tenant.
//!
//! Layout:
//! ```text
//! Contoso/
//!   axis-client.json
//!   snapshots/
//!     2026-09-14T103045Z/
//!       manifest.json
//!       pack/     # tenant pack export
//!       report/   # standard environment as-built (html + markdown)
//! ```

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

pub const CLIENT_MANIFEST_FILE: &str = "axis-client.json";
pub const SNAPSHOTS_DIR: &str = "snapshots";
pub const SNAPSHOT_MANIFEST_FILE: &str = "manifest.json";
pub const SNAPSHOT_PACK_DIR: &str = "pack";
pub const SNAPSHOT_REPORT_DIR: &str = "report";
pub const CLIENT_SCHEMA: &str = "axis.client/v1";
pub const SNAPSHOT_SCHEMA: &str = "axis.client.snapshot/v1";

/// Default age before the stale-snapshot prompt appears.
pub const DEFAULT_STALE_DAYS: u32 = 14;

#[derive(Debug, Error)]
pub enum ClientContainerError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStalePromptPrefs {
    /// ISO-8601 instant; suppress the stale prompt until this time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snooze_until: Option<String>,
    /// Last snooze duration the user picked (days).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snooze_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientContainerManifest {
    pub schema: String,
    pub id: String,
    pub name: String,
    /// Entra tenant GUID — strict 1:1 with this container.
    pub tenant_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_domain: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// ISO-8601 of the newest snapshot under `snapshots/`, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_snapshot_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale_prompt: Option<ClientStalePromptPrefs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotManifest {
    pub schema: String,
    pub id: String,
    pub exported_at: String,
    pub tenant_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack_name: Option<String>,
    #[serde(default)]
    pub files_written: u32,
    #[serde(default)]
    pub catalog_count: u32,
    #[serde(default)]
    pub include_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report_html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report_markdown: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report_object_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientContainerStatus {
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<ClientContainerManifest>,
    /// Signed-in tenant differs from the container's bound tenant.
    pub tenant_mismatch: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_tenant_id: Option<String>,
    /// Show the "snapshot is stale / missing" banner.
    pub stale_prompt: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale_reason: Option<String>,
    pub snapshot_count: u32,
    pub stale_after_days: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSnapshotSummary {
    pub id: String,
    pub path: String,
    pub exported_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pack_name: Option<String>,
    pub files_written: u32,
    pub catalog_count: u32,
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn slugify_id(name: &str) -> String {
    let mut out = String::new();
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch == ' ' || ch == '-' || ch == '_' {
            if !out.ends_with('-') {
                out.push('-');
            }
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("client-{}", &Uuid::new_v4().to_string()[..8])
    } else {
        trimmed
    }
}

fn parse_instant(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

pub fn manifest_path(root: &Path) -> PathBuf {
    root.join(CLIENT_MANIFEST_FILE)
}

pub fn snapshots_dir(root: &Path) -> PathBuf {
    root.join(SNAPSHOTS_DIR)
}

pub fn read_manifest(root: &Path) -> Result<ClientContainerManifest, ClientContainerError> {
    let path = manifest_path(root);
    if !path.is_file() {
        return Err(ClientContainerError::Message(format!(
            "No {CLIENT_MANIFEST_FILE} in that folder. Choose a client container, or create one."
        )));
    }
    let text = fs::read_to_string(&path)?;
    let manifest: ClientContainerManifest = serde_json::from_str(text.trim_start_matches('\u{FEFF}'))?;
    if manifest.schema != CLIENT_SCHEMA {
        return Err(ClientContainerError::Message(format!(
            "Unsupported client container schema {:?}. Expected {CLIENT_SCHEMA}.",
            manifest.schema
        )));
    }
    if manifest.tenant_id.trim().is_empty() {
        return Err(ClientContainerError::Message(
            "Client container is missing tenantId.".into(),
        ));
    }
    if manifest.name.trim().is_empty() {
        return Err(ClientContainerError::Message(
            "Client container is missing a name.".into(),
        ));
    }
    Ok(manifest)
}

pub fn write_manifest(
    root: &Path,
    manifest: &ClientContainerManifest,
) -> Result<(), ClientContainerError> {
    fs::create_dir_all(root)?;
    fs::create_dir_all(snapshots_dir(root))?;
    let mut text = serde_json::to_string_pretty(manifest)?;
    text.push('\n');
    fs::write(manifest_path(root), text)?;
    Ok(())
}

/// Create a new client container in an empty (or new) folder.
pub fn create_container(
    root: &Path,
    name: &str,
    tenant_id: &str,
    primary_domain: Option<&str>,
) -> Result<ClientContainerManifest, ClientContainerError> {
    let name = name.trim();
    let tenant_id = tenant_id.trim();
    if name.is_empty() {
        return Err(ClientContainerError::Message(
            "Enter a client name.".into(),
        ));
    }
    if tenant_id.is_empty() {
        return Err(ClientContainerError::Message(
            "Sign in so Axis can bind this container to your Entra tenant.".into(),
        ));
    }

    if root.is_file() {
        return Err(ClientContainerError::Message(
            "That path is a file. Choose a folder.".into(),
        ));
    }

    if manifest_path(root).is_file() {
        return Err(ClientContainerError::Message(
            "That folder already has an axis-client.json. Open it instead.".into(),
        ));
    }

    // Allow empty dirs or dirs that only have unrelated files — but warn if snapshots already exist.
    let now = now_rfc3339();
    let manifest = ClientContainerManifest {
        schema: CLIENT_SCHEMA.into(),
        id: slugify_id(name),
        name: name.to_string(),
        tenant_id: tenant_id.to_string(),
        primary_domain: primary_domain
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        created_at: now.clone(),
        updated_at: now,
        last_snapshot_at: None,
        stale_prompt: None,
    };
    write_manifest(root, &manifest)?;
    Ok(manifest)
}

pub fn open_container(root: &Path) -> Result<ClientContainerManifest, ClientContainerError> {
    if !root.is_dir() {
        return Err(ClientContainerError::Message(
            "That path is not a folder.".into(),
        ));
    }
    let mut manifest = read_manifest(root)?;
    // Refresh last_snapshot_at from disk if snapshots exist.
    if let Some(latest) = latest_snapshot_exported_at(root)? {
        if manifest.last_snapshot_at.as_deref() != Some(latest.as_str()) {
            manifest.last_snapshot_at = Some(latest);
            manifest.updated_at = now_rfc3339();
            write_manifest(root, &manifest)?;
        }
    }
    Ok(manifest)
}

fn tenants_match(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

pub fn tenant_mismatch(manifest: &ClientContainerManifest, session_tenant_id: Option<&str>) -> bool {
    match session_tenant_id.map(str::trim).filter(|value| !value.is_empty()) {
        Some(session) => !tenants_match(&manifest.tenant_id, session),
        None => false,
    }
}

/// Whether to show the stale snapshot prompt.
pub fn evaluate_stale(
    manifest: &ClientContainerManifest,
    stale_after_days: u32,
) -> (bool, Option<String>) {
    let now = Utc::now();
    if let Some(prefs) = &manifest.stale_prompt {
        if let Some(until) = prefs.snooze_until.as_deref().and_then(parse_instant) {
            if until > now {
                return (false, None);
            }
        }
    }

    match manifest
        .last_snapshot_at
        .as_deref()
        .and_then(parse_instant)
    {
        None => (
            true,
            Some("No snapshot yet. Export a tenant pack into this container.".into()),
        ),
        Some(exported) => {
            let age = now.signed_duration_since(exported);
            let limit = Duration::days(i64::from(stale_after_days.max(1)));
            if age >= limit {
                let days = age.num_days().max(0);
                (
                    true,
                    Some(format!(
                        "Last snapshot was {days} day{} ago (prompt after {stale_after_days}).",
                        if days == 1 { "" } else { "s" }
                    )),
                )
            } else {
                (false, None)
            }
        }
    }
}

pub fn snooze_stale_prompt(
    root: &Path,
    days: u32,
) -> Result<ClientContainerManifest, ClientContainerError> {
    let days = days.max(1);
    let mut manifest = read_manifest(root)?;
    let until = Utc::now() + Duration::days(i64::from(days));
    manifest.stale_prompt = Some(ClientStalePromptPrefs {
        snooze_until: Some(until.to_rfc3339()),
        snooze_days: Some(days),
    });
    manifest.updated_at = now_rfc3339();
    write_manifest(root, &manifest)?;
    Ok(manifest)
}

pub fn list_snapshots(root: &Path) -> Result<Vec<ClientSnapshotSummary>, ClientContainerError> {
    let dir = snapshots_dir(root);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut rows = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join(SNAPSHOT_MANIFEST_FILE);
        if !manifest_path.is_file() {
            continue;
        }
        let text = fs::read_to_string(&manifest_path)?;
        let Ok(snap) = serde_json::from_str::<SnapshotManifest>(text.trim_start_matches('\u{FEFF}'))
        else {
            continue;
        };
        rows.push(ClientSnapshotSummary {
            id: snap.id,
            path: path.to_string_lossy().into_owned(),
            exported_at: snap.exported_at,
            pack_name: snap.pack_name,
            files_written: snap.files_written,
            catalog_count: snap.catalog_count,
        });
    }
    rows.sort_by(|a, b| b.exported_at.cmp(&a.exported_at));
    Ok(rows)
}

/// Resolve `snapshots/{id}/pack` for a snapshot id (folder name).
pub fn snapshot_pack_dir(root: &Path, snapshot_id: &str) -> Result<PathBuf, ClientContainerError> {
    let id = snapshot_id.trim();
    if id.is_empty() || id.contains(['/', '\\']) || id == "." || id == ".." {
        return Err(ClientContainerError::Message(
            "Invalid snapshot id.".into(),
        ));
    }
    let snap_root = snapshots_dir(root).join(id);
    let pack = snap_root.join(SNAPSHOT_PACK_DIR);
    if !pack.is_dir() {
        return Err(ClientContainerError::Message(format!(
            "Snapshot pack not found: {id}"
        )));
    }
    Ok(pack)
}

pub fn snapshot_label(root: &Path, snapshot_id: &str) -> String {
    list_snapshots(root)
        .ok()
        .and_then(|rows| {
            rows.into_iter()
                .find(|row| row.id == snapshot_id)
                .map(|row| {
                    row.pack_name
                        .filter(|name| !name.trim().is_empty())
                        .map(|name| format!("{name} ({})", row.exported_at))
                        .unwrap_or(row.exported_at)
                })
        })
        .unwrap_or_else(|| snapshot_id.to_string())
}

fn latest_snapshot_exported_at(root: &Path) -> Result<Option<String>, ClientContainerError> {
    Ok(list_snapshots(root)?
        .into_iter()
        .next()
        .map(|row| row.exported_at))
}

fn snapshot_folder_name(exported_at: &DateTime<Utc>) -> String {
    exported_at.format("%Y-%m-%dT%H%M%SZ").to_string()
}

/// Allocate `snapshots/{iso}/pack` (+ `report`) for a new export and return paths.
pub fn prepare_snapshot_export(
    root: &Path,
) -> Result<(PathBuf, PathBuf, PathBuf, String), ClientContainerError> {
    let _ = read_manifest(root)?;
    let now = Utc::now();
    let folder = snapshot_folder_name(&now);
    let snap_root = snapshots_dir(root).join(&folder);
    if snap_root.exists() {
        return Err(ClientContainerError::Message(format!(
            "Snapshot folder already exists: {folder}"
        )));
    }
    let pack_root = snap_root.join(SNAPSHOT_PACK_DIR);
    let report_root = snap_root.join(SNAPSHOT_REPORT_DIR);
    fs::create_dir_all(&pack_root)?;
    fs::create_dir_all(&report_root)?;
    Ok((snap_root, pack_root, report_root, now.to_rfc3339()))
}

/// Write snapshot manifest and update the client container's lastSnapshotAt.
pub fn finalize_snapshot(
    root: &Path,
    snap_root: &Path,
    exported_at: &str,
    tenant_id: &str,
    pack_name: Option<&str>,
    files_written: u32,
    catalog_count: u32,
    include_count: u32,
    report_html: Option<&str>,
    report_markdown: Option<&str>,
    report_object_count: Option<u32>,
    axis_version: Option<&str>,
) -> Result<SnapshotManifest, ClientContainerError> {
    let mut client = read_manifest(root)?;
    let snap = SnapshotManifest {
        schema: SNAPSHOT_SCHEMA.into(),
        id: snap_root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        exported_at: exported_at.to_string(),
        tenant_id: tenant_id.to_string(),
        client_id: Some(client.id.clone()),
        client_name: Some(client.name.clone()),
        pack_name: pack_name.map(str::to_string),
        files_written,
        catalog_count,
        include_count,
        report_html: report_html.map(str::to_string),
        report_markdown: report_markdown.map(str::to_string),
        report_object_count,
        axis_version: axis_version.map(str::to_string),
    };
    let mut text = serde_json::to_string_pretty(&snap)?;
    text.push('\n');
    fs::write(snap_root.join(SNAPSHOT_MANIFEST_FILE), text)?;

    client.last_snapshot_at = Some(exported_at.to_string());
    client.updated_at = now_rfc3339();
    // Clear snooze after a successful snapshot — fresh baseline.
    client.stale_prompt = None;
    write_manifest(root, &client)?;
    Ok(snap)
}

pub fn build_status(
    root: Option<&Path>,
    session_tenant_id: Option<&str>,
    stale_after_days: u32,
) -> Result<ClientContainerStatus, ClientContainerError> {
    let Some(root) = root else {
        return Ok(ClientContainerStatus {
            active: false,
            root: None,
            manifest: None,
            tenant_mismatch: false,
            session_tenant_id: session_tenant_id.map(str::to_string),
            stale_prompt: false,
            stale_reason: None,
            snapshot_count: 0,
            stale_after_days,
        });
    };

    let manifest = open_container(root)?;
    let mismatch = tenant_mismatch(&manifest, session_tenant_id);
    let (stale, reason) = if mismatch {
        (false, None)
    } else {
        evaluate_stale(&manifest, stale_after_days)
    };
    let snapshot_count = list_snapshots(root)?.len() as u32;

    Ok(ClientContainerStatus {
        active: true,
        root: Some(root.to_string_lossy().into_owned()),
        manifest: Some(manifest),
        tenant_mismatch: mismatch,
        session_tenant_id: session_tenant_id.map(str::to_string),
        stale_prompt: stale,
        stale_reason: reason,
        snapshot_count,
        stale_after_days,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn create_open_snooze_roundtrip() {
        let dir = env::temp_dir().join(format!("axis-client-{}", Uuid::new_v4()));
        let _ = fs::remove_dir_all(&dir);
        let manifest = create_container(
            &dir,
            "Contoso Ltd",
            "11111111-2222-3333-4444-555555555555",
            Some("contoso.com"),
        )
        .expect("create");
        assert_eq!(manifest.name, "Contoso Ltd");
        assert!(manifest_path(&dir).is_file());

        let opened = open_container(&dir).expect("open");
        assert_eq!(opened.id, manifest.id);

        let (stale, reason) = evaluate_stale(&opened, 14);
        assert!(stale);
        assert!(reason.unwrap().contains("No snapshot"));

        let snoozed = snooze_stale_prompt(&dir, 7).expect("snooze");
        let (stale_after, _) = evaluate_stale(&snoozed, 14);
        assert!(!stale_after);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tenant_mismatch_detects() {
        let manifest = ClientContainerManifest {
            schema: CLIENT_SCHEMA.into(),
            id: "x".into(),
            name: "X".into(),
            tenant_id: "aaa".into(),
            primary_domain: None,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
            last_snapshot_at: None,
            stale_prompt: None,
        };
        assert!(tenant_mismatch(&manifest, Some("bbb")));
        assert!(!tenant_mismatch(&manifest, Some("aaa")));
        assert!(!tenant_mismatch(&manifest, None));
    }
}
