//! Local Axis packs and kits (named `includes` selections).
//!
//! Layout (platform first):
//! ```text
//! axis-pack.json
//! kits/
//! {platform}/
//!   enrollment/…
//!   policies/…
//!   compliance/…
//!   endpoint-security/…
//!   scripts/{platform,remediation,compliance}/…
//!   applications/       # placeholder
//! ```

use chrono::Utc;
use crate::e8_baselines::{apply_github_auth, github_contents_url, parse_github_repo_url};
use crate::e8_baselines::BaselineReferenceSourceInput;
use crate::graph::GraphError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

const MANIFEST_FILE: &str = "axis-pack.json";
const KITS_DIR: &str = "kits";
const PACK_PLATFORMS: &[&str] = &["windows", "macos", "android"];

#[derive(Debug, Error)]
pub enum PackKitsError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Graph(#[from] GraphError),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackManifestView {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_label: Option<String>,
    pub platforms: Vec<String>,
    pub root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackKitSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub includes: Vec<String>,
    /// Relative path of the kit JSON under the pack root (`kits/….json`).
    pub rel_path: String,
    pub include_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackArtifactRow {
    pub rel_path: String,
    pub name: String,
    pub platform: String,
    pub category: String,
    pub category_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackWorkspace {
    pub pack: PackManifestView,
    pub kits: Vec<PackKitSummary>,
    pub artifacts: Vec<PackArtifactRow>,
    pub warnings: Vec<String>,
    /// Local packs can create/edit kits; GitHub packs are read-only in Axis today.
    pub writable: bool,
    /// `local` or `github`.
    pub source_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackKitWriteInput {
    pub pack_root: String,
    /// Existing relative path to update, or omit/empty to create under `kits/`.
    #[serde(default)]
    pub rel_path: Option<String>,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    pub includes: Vec<String>,
}

fn normalize_rel(path: &str) -> String {
    path.replace('\\', "/")
        .trim()
        .trim_matches('/')
        .to_string()
}

fn ensure_inside_root(root: &Path, candidate: &Path) -> Result<PathBuf, PackKitsError> {
    let root = root
        .canonicalize()
        .map_err(|error| PackKitsError::Message(format!("Pack folder is not usable: {error}")))?;
    let abs = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    // Resolve `..` without requiring the file to exist yet.
    let mut cleaned = PathBuf::new();
    for component in abs.components() {
        match component {
            Component::ParentDir => {
                if !cleaned.pop() {
                    return Err(PackKitsError::Message(
                        "Path escapes the pack folder.".into(),
                    ));
                }
            }
            Component::CurDir => {}
            other => cleaned.push(other),
        }
    }
    if !cleaned.starts_with(&root) {
        return Err(PackKitsError::Message(
            "Path escapes the pack folder.".into(),
        ));
    }
    Ok(cleaned)
}

fn read_manifest_raw(root: &Path) -> Result<(Value, PackManifestView), PackKitsError> {
    let path = root.join(MANIFEST_FILE);
    if !path.is_file() {
        return Err(PackKitsError::Message(format!(
            "No {MANIFEST_FILE} in this folder. Choose a pack root."
        )));
    }
    let text = fs::read_to_string(&path)?;
    let value: Value = serde_json::from_str(&text)?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("pack")
        .to_string();
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("Untitled pack")
        .to_string();
    let version = value
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let source_label = value
        .get("sourceLabel")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let platforms = value
        .pointer("/paths/platforms")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(|row| row.trim().to_ascii_lowercase())
                .filter(|row| !row.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|rows| !rows.is_empty())
        .unwrap_or_else(|| PACK_PLATFORMS.iter().map(|p| (*p).to_string()).collect());
    Ok((
        value,
        PackManifestView {
            id,
            name,
            version,
            source_label,
            platforms,
            root: root.to_string_lossy().into_owned(),
        },
    ))
}

fn category_for_rel(rel: &str) -> Option<(String, String, String)> {
    let normalized = normalize_rel(rel).to_ascii_lowercase();
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.len() < 2 {
        return None;
    }
    let platform = parts[0].to_string();
    if !PACK_PLATFORMS.iter().any(|p| *p == platform) {
        return None;
    }
    let (category, label) = match parts.get(1).copied() {
        Some("policies") => ("policies", "Policies"),
        Some("compliance") => ("compliance", "Compliance"),
        Some("endpoint-security") => ("endpoint-security", "Endpoint security"),
        Some("enrollment") => ("enrollment", "Enrolment"),
        Some("applications") => ("applications", "Applications"),
        Some("windows-update") => ("windows-update", "Windows Update"),
        Some("group-policy") => ("group-policy", "Group Policy"),
        Some("scripts") => match parts.get(2).copied() {
            Some("platform") => ("script-platform", "Scripts · Platform"),
            Some("remediation") => ("script-remediation", "Scripts · Remediation"),
            Some("compliance") => ("script-compliance", "Scripts · Compliance"),
            _ => return None,
        },
        _ => return None,
    };
    Some((platform, category.to_string(), label.to_string()))
}

fn is_kit_dir_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(KITS_DIR)
}

fn collect_files(root: &Path, rel_dir: &str, out: &mut Vec<(String, PathBuf)>) -> Result<(), PackKitsError> {
    let dir = root.join(rel_dir.replace('/', std::path::MAIN_SEPARATOR_STR));
    if !dir.is_dir() {
        return Ok(());
    }
    let mut stack = vec![(dir, normalize_rel(rel_dir))];
    while let Some((current, prefix)) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let child_rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if path.is_dir() {
                if is_kit_dir_name(&name) || name.eq_ignore_ascii_case("third-party") {
                    continue;
                }
                stack.push((path, child_rel));
            } else if path.is_file() {
                out.push((child_rel, path));
            }
        }
    }
    Ok(())
}

fn looks_like_kit(value: &Value) -> bool {
    value.get("includes").and_then(Value::as_array).is_some()
}

fn parse_kit(rel_path: &str, path: &Path) -> Result<Option<PackKitSummary>, PackKitsError> {
    let text = fs::read_to_string(path)?;
    let value: Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if !looks_like_kit(&value) {
        return Ok(None);
    }
    let includes: Vec<String> = value
        .get("includes")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(normalize_rel)
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
            Path::new(rel_path)
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
    let description = value
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let version = value
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let include_count = includes.len() as u32;
    Ok(Some(PackKitSummary {
        id,
        name,
        description,
        version,
        includes,
        rel_path: normalize_rel(rel_path),
        include_count,
    }))
}

fn list_kits(root: &Path) -> Result<(Vec<PackKitSummary>, Vec<String>), PackKitsError> {
    let mut kits = Vec::new();
    let mut warnings = Vec::new();
    let dir = root.join(KITS_DIR);
    if dir.is_dir() {
        let entries = fs::read_dir(&dir)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.to_ascii_lowercase().ends_with(".json") {
                continue;
            }
            let rel = format!("{KITS_DIR}/{name}");
            match parse_kit(&rel, &path) {
                Ok(Some(kit)) => kits.push(kit),
                Ok(None) => {}
                Err(error) => warnings.push(format!("{rel}: {error}")),
            }
        }
    }
    kits.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok((kits, warnings))
}

fn list_artifacts(
    root: &Path,
    platforms: &[String],
) -> Result<(Vec<PackArtifactRow>, Vec<String>), PackKitsError> {
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    for platform in platforms {
        for folder in [
            "policies",
            "compliance",
            "endpoint-security",
            "enrollment",
            "applications",
            "scripts/platform",
            "scripts/remediation",
            "scripts/compliance",
            "windows-update",
            "group-policy",
        ] {
            collect_files(root, &format!("{platform}/{folder}"), &mut files)?;
        }
    }
    let mut rows = Vec::new();
    let mut seen = BTreeSet::new();
    for (rel, path) in files {
        let lower = rel.to_ascii_lowercase();
        if !(lower.ends_with(".json")
            || lower.ends_with(".ps1")
            || lower.ends_with(".sh")
            || lower.ends_with(".txt"))
        {
            continue;
        }
        // Skip kit-shaped JSON accidentally under policies.
        if lower.ends_with(".json") {
            if let Ok(text) = fs::read_to_string(&path) {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    if looks_like_kit(&value) {
                        continue;
                    }
                }
            }
        }
        let Some((platform, category, category_label)) = category_for_rel(&rel) else {
            continue;
        };
        if !seen.insert(rel.clone()) {
            continue;
        }
        let name = Path::new(&rel)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| rel.clone());
        rows.push(PackArtifactRow {
            rel_path: rel,
            name,
            platform,
            category,
            category_label,
        });
    }
    rows.sort_by(|a, b| {
        a.platform
            .cmp(&b.platform)
            .then(a.category_label.cmp(&b.category_label))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    if rows.is_empty() {
        warnings.push("No pack artifacts found under platform folders.".into());
    }
    Ok((rows, warnings))
}

/// Load pack identity, kits, and includeable artifacts for the editor.
pub fn open_pack_workspace(pack_root: &str) -> Result<PackWorkspace, PackKitsError> {
    let root = PathBuf::from(pack_root.trim());
    if !root.is_dir() {
        return Err(PackKitsError::Message("Pack folder was not found.".into()));
    }
    let root = root.canonicalize().map_err(|error| {
        PackKitsError::Message(format!("Pack folder is not usable: {error}"))
    })?;
    let (_raw, pack) = read_manifest_raw(&root)?;
    let (kits, mut warnings) = list_kits(&root)?;
    let (artifacts, artifact_warnings) = list_artifacts(&root, &pack.platforms)?;
    warnings.extend(artifact_warnings);
    Ok(PackWorkspace {
        pack: PackManifestView {
            root: root.to_string_lossy().into_owned(),
            ..pack
        },
        kits,
        artifacts,
        warnings,
        writable: true,
        source_kind: "local".into(),
        source_id: None,
    })
}

/// Open a pack from a saved GitHub or local source definition.
pub async fn open_pack_workspace_from_source(
    input: BaselineReferenceSourceInput,
) -> Result<PackWorkspace, PackKitsError> {
    let kind = input.kind.trim().to_ascii_lowercase();
    if kind == "local" || !input.local_path.trim().is_empty() {
        let mut workspace = open_pack_workspace(&input.local_path)?;
        workspace.source_id = input
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if let Some(name) = input
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            workspace.pack.name = name.to_string();
        }
        return Ok(workspace);
    }
    open_github_pack_workspace(input).await
}

fn sanitize_file_stem(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if ch.is_whitespace() || ch == '.' {
            if !out.ends_with('-') {
                out.push('-');
            }
        }
    }
    let trimmed = out.trim_matches('-').to_ascii_lowercase();
    if trimmed.is_empty() {
        "kit".into()
    } else {
        trimmed
    }
}

fn validate_includes(root: &Path, includes: &[String]) -> Result<Vec<String>, PackKitsError> {
    let mut cleaned = Vec::new();
    let mut seen = BTreeSet::new();
    for raw in includes {
        let rel = normalize_rel(raw);
        if rel.is_empty() {
            continue;
        }
        if Path::new(&rel)
            .components()
            .any(|c| matches!(c, Component::ParentDir))
        {
            return Err(PackKitsError::Message(format!(
                "Include path is not allowed: {rel}"
            )));
        }
        let abs = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if !abs.is_file() {
            return Err(PackKitsError::Message(format!(
                "Include path is missing from the pack: {rel}"
            )));
        }
        if seen.insert(rel.clone()) {
            cleaned.push(rel);
        }
    }
    Ok(cleaned)
}

/// Create or update a kit JSON under the pack.
pub fn write_pack_kit(input: PackKitWriteInput) -> Result<PackKitSummary, PackKitsError> {
    let root = PathBuf::from(input.pack_root.trim());
    let root = root.canonicalize().map_err(|error| {
        PackKitsError::Message(format!("Pack folder is not usable: {error}"))
    })?;
    let _ = read_manifest_raw(&root)?;
    let id = input.id.trim();
    let name = input.name.trim();
    if id.is_empty() || name.is_empty() {
        return Err(PackKitsError::Message("Kit id and name are required.".into()));
    }
    let includes = validate_includes(&root, &input.includes)?;
    let rel = match input.rel_path.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(existing) => {
            let normalized = normalize_rel(existing);
            if !normalized.starts_with("kits/") {
                return Err(PackKitsError::Message(
                    "Kit files must live under kits/.".into(),
                ));
            }
            normalized
        }
        None => {
            let stem = sanitize_file_stem(id);
            let mut candidate = format!("{KITS_DIR}/{stem}.json");
            let mut n = 2u32;
            while root
                .join(candidate.replace('/', std::path::MAIN_SEPARATOR_STR))
                .exists()
            {
                candidate = format!("{KITS_DIR}/{stem}-{n}.json");
                n += 1;
            }
            fs::create_dir_all(root.join(KITS_DIR))?;
            candidate
        }
    };
    let path = ensure_inside_root(&root, Path::new(&rel))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let document = json!({
        "id": id,
        "name": name,
        "description": input.description.as_deref().map(str::trim).filter(|v| !v.is_empty()),
        "version": input.version.as_deref().map(str::trim).filter(|v| !v.is_empty()).unwrap_or("0.1.0"),
        "includes": includes,
        "updatedAt": Utc::now().to_rfc3339(),
    });
    let mut text = serde_json::to_string_pretty(&document)?;
    text.push('\n');
    fs::write(&path, text)?;
    Ok(PackKitSummary {
        id: id.to_string(),
        name: name.to_string(),
        description: input
            .description
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        version: Some(
            input
                .version
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .unwrap_or("0.1.0")
                .to_string(),
        ),
        include_count: includes.len() as u32,
        includes,
        rel_path: rel,
    })
}

/// Create an empty kit shell (no includes) for the New kit button.
pub fn create_empty_kit(pack_root: &str, name: &str) -> Result<PackKitSummary, PackKitsError> {
    let label = name.trim();
    let label = if label.is_empty() { "New kit" } else { label };
    write_pack_kit(PackKitWriteInput {
        pack_root: pack_root.to_string(),
        rel_path: None,
        id: format!("kit-{}", &Uuid::new_v4().to_string()[..8]),
        name: label.to_string(),
        description: None,
        version: Some("0.1.0".into()),
        includes: Vec::new(),
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLocalPackInput {
    /// Parent directory chosen by the user. Pack is created as `{parent}/{folderName}/`.
    pub parent_dir: String,
    pub name: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    /// Platform roots to scaffold. Defaults to `windows`.
    #[serde(default)]
    pub platforms: Vec<String>,
}

fn write_gitkeep(path: &Path) -> Result<(), PackKitsError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if !path.exists() {
        fs::write(path, b"")?;
    }
    Ok(())
}

/// Scaffold a new local Axis pack under `parent_dir/{folder}/`.
pub fn create_local_pack(input: CreateLocalPackInput) -> Result<PackWorkspace, PackKitsError> {
    let parent = PathBuf::from(input.parent_dir.trim());
    if !parent.is_dir() {
        return Err(PackKitsError::Message(
            "Choose an existing parent folder for the new pack.".into(),
        ));
    }
    let parent = parent.canonicalize().map_err(|error| {
        PackKitsError::Message(format!("Parent folder is not usable: {error}"))
    })?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err(PackKitsError::Message("Pack name is required.".into()));
    }
    let folder = sanitize_file_stem(name);
    let root = parent.join(&folder);
    if root.exists() {
        return Err(PackKitsError::Message(format!(
            "Folder already exists: {}",
            root.display()
        )));
    }
    fs::create_dir_all(&root)?;

    let mut platforms: Vec<String> = input
        .platforms
        .into_iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect();
    if platforms.is_empty() {
        platforms.push("windows".into());
    }
    platforms.sort();
    platforms.dedup();

    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| sanitize_file_stem(name));
    let version = input
        .version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("0.1.0");

    let manifest = json!({
        "id": id,
        "name": name,
        "version": version,
        "sourceLabel": name,
        "paths": {
            "platforms": platforms,
            "kits": KITS_DIR,
        }
    });
    let mut manifest_text = serde_json::to_string_pretty(&manifest)?;
    manifest_text.push('\n');
    fs::write(root.join(MANIFEST_FILE), manifest_text)?;

    fs::create_dir_all(root.join(KITS_DIR))?;
    for platform in &platforms {
        let base = root.join(platform);
        for folder in [
            "policies",
            "compliance",
            "endpoint-security",
            "applications",
            "scripts/platform",
            "scripts/remediation",
            "scripts/compliance",
        ] {
            write_gitkeep(&base.join(folder).join(".gitkeep"))?;
        }
        if platform == "windows" {
            for folder in [
                "windows-update",
                "group-policy",
                "enrollment/autopilot",
                "enrollment/esp",
                "enrollment/restrictions",
                "enrollment/windows-hello",
            ] {
                write_gitkeep(&base.join(folder).join(".gitkeep"))?;
            }
        } else {
            write_gitkeep(&base.join("enrollment").join(".gitkeep"))?;
        }
    }

    // Seed an empty kit so the editor has something to open.
    let root_str = root.to_string_lossy().into_owned();
    let _ = create_empty_kit(&root_str, "Default kit")?;
    open_pack_workspace(&root_str)
}

#[derive(Debug, Deserialize)]
struct GitHubContentItem {
    name: String,
    #[serde(default)]
    path: String,
    #[serde(rename = "type")]
    item_type: String,
    download_url: Option<String>,
}

fn nonempty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resolve_github_coords(
    input: &BaselineReferenceSourceInput,
) -> Result<(String, String, String, Option<String>, String, Option<String>), PackKitsError> {
    let parsed = input.url.as_deref().and_then(parse_github_repo_url);
    let owner = nonempty(&input.owner)
        .or_else(|| parsed.as_ref().map(|value| value.0.clone()))
        .ok_or_else(|| PackKitsError::Message("GitHub owner is required.".into()))?;
    let repo = nonempty(&input.repo)
        .map(|value| value.trim_end_matches(".git").to_string())
        .or_else(|| parsed.as_ref().map(|value| value.1.clone()))
        .ok_or_else(|| PackKitsError::Message("GitHub repository is required.".into()))?;
    let git_ref = nonempty(&input.git_ref)
        .or_else(|| {
            parsed
                .as_ref()
                .map(|value| value.2.clone())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| "main".into());
    let token = if input.private {
        input
            .token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    } else {
        None
    };
    let source_id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("repo:{owner}/{repo}:{git_ref}"));
    Ok((owner, repo, git_ref, token, source_id, input.name.clone()))
}

async fn github_list(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    path: &str,
    git_ref: &str,
    token: Option<&str>,
) -> Result<Vec<GitHubContentItem>, PackKitsError> {
    let url = github_contents_url(owner, repo, path, git_ref);
    let response = apply_github_auth(client.get(url), token).send().await?;
    if response.status().as_u16() == 404 {
        return Ok(Vec::new());
    }
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(PackKitsError::Message(format!(
            "GitHub contents {status}: {}",
            detail.trim()
        )));
    }
    let body: Value = response.json().await?;
    if let Ok(items) = serde_json::from_value::<Vec<GitHubContentItem>>(body.clone()) {
        return Ok(items);
    }
    if let Ok(item) = serde_json::from_value::<GitHubContentItem>(body) {
        return Ok(vec![item]);
    }
    Err(PackKitsError::Message(
        "GitHub contents response was not a file listing.".into(),
    ))
}

async fn github_download_text(
    client: &reqwest::Client,
    download_url: &str,
    token: Option<&str>,
) -> Result<String, PackKitsError> {
    let response = apply_github_auth(client.get(download_url), token)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(PackKitsError::Message(format!(
            "Failed to download {download_url} ({})",
            response.status()
        )));
    }
    Ok(response.text().await?)
}

async fn collect_github_files(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    rel_dir: &str,
    git_ref: &str,
    token: Option<&str>,
    out: &mut Vec<(String, String)>,
) -> Result<(), PackKitsError> {
    let mut stack = vec![normalize_rel(rel_dir)];
    let mut visited = BTreeSet::new();
    while let Some(path) = stack.pop() {
        if !visited.insert(path.clone()) {
            continue;
        }
        if out.len() > 400 {
            break;
        }
        let items = github_list(client, owner, repo, &path, git_ref, token).await?;
        for item in items {
            let child = if item.path.trim().is_empty() {
                if path.is_empty() {
                    item.name.clone()
                } else {
                    format!("{path}/{}", item.name)
                }
            } else {
                item.path.replace('\\', "/")
            };
            if item.item_type == "dir" {
                if item.name.eq_ignore_ascii_case("third-party")
                    || is_kit_dir_name(&item.name)
                    || item.name.starts_with('.')
                {
                    continue;
                }
                stack.push(child);
            } else if item.item_type == "file" {
                if let Some(url) = item.download_url {
                    out.push((normalize_rel(&child), url));
                }
            }
        }
    }
    Ok(())
}

fn kit_from_json(rel_path: &str, text: &str) -> Option<PackKitSummary> {
    let value: Value = serde_json::from_str(text).ok()?;
    if !looks_like_kit(&value) {
        return None;
    }
    let includes: Vec<String> = value
        .get("includes")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(normalize_rel)
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
            Path::new(rel_path)
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
    Some(PackKitSummary {
        id,
        name,
        description: value
            .get("description")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        version: value
            .get("version")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        include_count: includes.len() as u32,
        includes,
        rel_path: normalize_rel(rel_path),
    })
}

async fn open_github_pack_workspace(
    input: BaselineReferenceSourceInput,
) -> Result<PackWorkspace, PackKitsError> {
    let (owner, repo, git_ref, token, source_id, display_name) = resolve_github_coords(&input)?;
    let token_ref = token.as_deref();
    let client = reqwest::Client::new();

    let manifest_items =
        github_list(&client, &owner, &repo, MANIFEST_FILE, &git_ref, token_ref).await?;
    let manifest_item = manifest_items.into_iter().find(|item| {
        item.item_type == "file" && item.name.eq_ignore_ascii_case(MANIFEST_FILE)
    });
    let Some(manifest_item) = manifest_item else {
        return Err(PackKitsError::Message(format!(
            "No {MANIFEST_FILE} at the root of {owner}/{repo}@{git_ref}."
        )));
    };
    let download_url = manifest_item.download_url.ok_or_else(|| {
        PackKitsError::Message("GitHub did not return a download URL for axis-pack.json.".into())
    })?;
    let manifest_text = github_download_text(&client, &download_url, token_ref).await?;
    let value: Value = serde_json::from_str(manifest_text.trim_start_matches('\u{feff}'))?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("pack")
        .to_string();
    let name = display_name
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| {
            value
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| format!("{owner}/{repo}"));
    let version = value
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let source_label = value
        .get("sourceLabel")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let platforms = value
        .pointer("/paths/platforms")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(|row| row.trim().to_ascii_lowercase())
                .filter(|row| !row.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|rows| !rows.is_empty())
        .unwrap_or_else(|| PACK_PLATFORMS.iter().map(|p| (*p).to_string()).collect());

    let mut warnings = Vec::new();
    let mut kits = Vec::new();
    let items = github_list(&client, &owner, &repo, KITS_DIR, &git_ref, token_ref).await?;
    for item in items {
        if item.item_type != "file" || !item.name.to_ascii_lowercase().ends_with(".json") {
            continue;
        }
        let Some(url) = item.download_url.clone() else {
            continue;
        };
        let rel = if item.path.trim().is_empty() {
            format!("{KITS_DIR}/{}", item.name)
        } else {
            normalize_rel(&item.path)
        };
        match github_download_text(&client, &url, token_ref).await {
            Ok(text) => {
                if let Some(kit) = kit_from_json(&rel, &text) {
                    kits.push(kit);
                }
            }
            Err(error) => warnings.push(format!("{rel}: {error}")),
        }
    }
    kits.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut files = Vec::new();
    for platform in &platforms {
        for folder in [
            "policies",
            "compliance",
            "endpoint-security",
            "enrollment",
            "applications",
            "scripts/platform",
            "scripts/remediation",
            "scripts/compliance",
            "windows-update",
            "group-policy",
        ] {
            collect_github_files(
                &client,
                &owner,
                &repo,
                &format!("{platform}/{folder}"),
                &git_ref,
                token_ref,
                &mut files,
            )
            .await?;
        }
    }

    let mut artifacts = Vec::new();
    let mut seen = BTreeSet::new();
    for (rel, url) in files {
        let lower = rel.to_ascii_lowercase();
        if !(lower.ends_with(".json")
            || lower.ends_with(".ps1")
            || lower.ends_with(".sh")
            || lower.ends_with(".txt"))
        {
            continue;
        }
        if lower.ends_with(".json") {
            if let Ok(text) = github_download_text(&client, &url, token_ref).await {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    if looks_like_kit(&value) {
                        continue;
                    }
                }
            }
        }
        let Some((platform, category, category_label)) = category_for_rel(&rel) else {
            continue;
        };
        if !seen.insert(rel.clone()) {
            continue;
        }
        let name = Path::new(&rel)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| rel.clone());
        artifacts.push(PackArtifactRow {
            rel_path: rel,
            name,
            platform,
            category,
            category_label,
        });
    }
    artifacts.sort_by(|a, b| {
        a.platform
            .cmp(&b.platform)
            .then(a.category_label.cmp(&b.category_label))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    if artifacts.is_empty() {
        warnings.push("No pack artifacts found under platform folders.".into());
    }

    Ok(PackWorkspace {
        pack: PackManifestView {
            id,
            name,
            version,
            source_label,
            platforms,
            root: format!("github://{owner}/{repo}@{git_ref}"),
        },
        kits,
        artifacts,
        warnings,
        writable: false,
        source_kind: "github".into(),
        source_id: Some(source_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn create_local_pack_scaffolds_layout() {
        let parent = env::temp_dir().join(format!("axis-pack-create-{}", Uuid::new_v4()));
        fs::create_dir_all(&parent).unwrap();
        let workspace = create_local_pack(CreateLocalPackInput {
            parent_dir: parent.to_string_lossy().into_owned(),
            name: "Demo Pack".into(),
            id: None,
            version: None,
            platforms: vec!["windows".into()],
        })
        .unwrap();
        let root = PathBuf::from(&workspace.pack.root);
        assert!(root.join(MANIFEST_FILE).is_file());
        assert!(root.join(KITS_DIR).is_dir());
        assert!(!workspace.kits.is_empty());
        assert!(root.join("windows/policies/.gitkeep").is_file());
        assert!(root.join("windows/scripts/platform/.gitkeep").is_file());
        assert!(root.join("windows/applications/.gitkeep").is_file());
        let _ = fs::remove_dir_all(&parent);
    }
}

