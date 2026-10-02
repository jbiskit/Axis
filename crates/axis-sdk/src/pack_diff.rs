//! Diff two Axis tenant pack roots (snapshot folders or a live export).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const SKIP_NAMES: &[&str] = &[
    "axis-pack.json",
    "notice.md",
    "readme.md",
    "license",
    "license.txt",
];

#[derive(Debug, Error)]
pub enum PackDiffError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PackDiffChangeKind {
    Added,
    Removed,
    Changed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFieldChange {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackObjectDiff {
    pub key: String,
    pub kind: String,
    pub display_name: String,
    pub change: PackDiffChangeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub field_changes: Vec<PackFieldChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDiffSummary {
    pub added: u32,
    pub removed: u32,
    pub changed: u32,
    pub unchanged: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDiffReport {
    pub left_label: String,
    pub right_label: String,
    pub summary: PackDiffSummary,
    pub objects: Vec<PackObjectDiff>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct IndexedArtifact {
    key: String,
    kind: String,
    display_name: String,
    source_id: Option<String>,
    rel_path: String,
    fingerprint: String,
    comparable: Value,
}

pub fn diff_pack_roots(
    left_root: &Path,
    right_root: &Path,
    left_label: &str,
    right_label: &str,
) -> Result<PackDiffReport, PackDiffError> {
    if !left_root.is_dir() {
        return Err(PackDiffError::Message(format!(
            "Left pack folder is missing: {}",
            left_root.display()
        )));
    }
    if !right_root.is_dir() {
        return Err(PackDiffError::Message(format!(
            "Right pack folder is missing: {}",
            right_root.display()
        )));
    }

    let mut warnings = Vec::new();
    let left = index_pack(left_root, &mut warnings)?;
    let right = index_pack(right_root, &mut warnings)?;

    let mut keys = BTreeSet::new();
    keys.extend(left.keys().cloned());
    keys.extend(right.keys().cloned());

    let mut objects = Vec::new();
    let mut added = 0u32;
    let mut removed = 0u32;
    let mut changed = 0u32;
    let mut unchanged = 0u32;

    for key in keys {
        match (left.get(&key), right.get(&key)) {
            (None, Some(r)) => {
                added += 1;
                objects.push(PackObjectDiff {
                    key: key.clone(),
                    kind: r.kind.clone(),
                    display_name: r.display_name.clone(),
                    change: PackDiffChangeKind::Added,
                    left_path: None,
                    right_path: Some(r.rel_path.clone()),
                    source_id: r.source_id.clone(),
                    field_changes: vec![PackFieldChange {
                        path: "object".into(),
                        before: None,
                        after: Some("Present on right only".into()),
                    }],
                });
            }
            (Some(l), None) => {
                removed += 1;
                objects.push(PackObjectDiff {
                    key: key.clone(),
                    kind: l.kind.clone(),
                    display_name: l.display_name.clone(),
                    change: PackDiffChangeKind::Removed,
                    left_path: Some(l.rel_path.clone()),
                    right_path: None,
                    source_id: l.source_id.clone(),
                    field_changes: vec![PackFieldChange {
                        path: "object".into(),
                        before: Some("Present on left only".into()),
                        after: None,
                    }],
                });
            }
            (Some(l), Some(r)) => {
                if l.fingerprint == r.fingerprint {
                    unchanged += 1;
                    continue;
                }
                changed += 1;
                let mut field_changes = diff_values(&l.comparable, &r.comparable, "");
                if field_changes.is_empty() {
                    field_changes.push(PackFieldChange {
                        path: "content".into(),
                        before: Some("Changed".into()),
                        after: Some("Changed".into()),
                    });
                }
                // Cap per-object noise for the UI.
                if field_changes.len() > 80 {
                    let omitted = field_changes.len() - 80;
                    field_changes.truncate(80);
                    field_changes.push(PackFieldChange {
                        path: "…".into(),
                        before: Some(format!("{omitted} more changes omitted")),
                        after: None,
                    });
                }
                objects.push(PackObjectDiff {
                    key: key.clone(),
                    kind: r.kind.clone(),
                    display_name: r.display_name.clone(),
                    change: PackDiffChangeKind::Changed,
                    left_path: Some(l.rel_path.clone()),
                    right_path: Some(r.rel_path.clone()),
                    source_id: r.source_id.clone().or(l.source_id.clone()),
                    field_changes,
                });
            }
            (None, None) => {}
        }
    }

    objects.sort_by(|a, b| {
        change_rank(a.change)
            .cmp(&change_rank(b.change))
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()))
    });

    Ok(PackDiffReport {
        left_label: left_label.to_string(),
        right_label: right_label.to_string(),
        summary: PackDiffSummary {
            added,
            removed,
            changed,
            unchanged,
        },
        objects,
        warnings,
    })
}

fn change_rank(kind: PackDiffChangeKind) -> u8 {
    match kind {
        PackDiffChangeKind::Changed => 0,
        PackDiffChangeKind::Added => 1,
        PackDiffChangeKind::Removed => 2,
    }
}

fn index_pack(
    root: &Path,
    warnings: &mut Vec<String>,
) -> Result<BTreeMap<String, IndexedArtifact>, PackDiffError> {
    let mut out = BTreeMap::new();
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    for path in files {
        match index_file(root, &path) {
            Ok(Some(artifact)) => {
                if out.contains_key(&artifact.key) {
                    warnings.push(format!(
                        "Duplicate identity {} (keeping first; also at {})",
                        artifact.key, artifact.rel_path
                    ));
                    continue;
                }
                out.insert(artifact.key.clone(), artifact);
            }
            Ok(None) => {}
            Err(error) => warnings.push(format!("{}: {error}", rel_path(root, &path))),
        }
    }
    Ok(out)
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), PackDiffError> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_ascii_lowercase();
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
        if SKIP_NAMES.contains(&name.as_str()) {
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

fn index_file(root: &Path, path: &Path) -> Result<Option<IndexedArtifact>, PackDiffError> {
    let rel = rel_path(root, path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if matches!(ext.as_str(), "ps1" | "sh") {
        return index_script(root, path, &rel);
    }
    if ext != "json" {
        return Ok(None);
    }

    let text = fs::read_to_string(path)?;
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{FEFF}'))?;
    let (kind, source_id, display_name, comparable) = extract_json_artifact(&value, &rel);
    let fingerprint = fingerprint_value(&comparable);
    let key = identity_key(&kind, source_id.as_deref(), &display_name, &rel);
    Ok(Some(IndexedArtifact {
        key,
        kind,
        display_name,
        source_id,
        rel_path: rel,
        fingerprint,
        comparable,
    }))
}

fn index_script(
    root: &Path,
    path: &Path,
    rel: &str,
) -> Result<Option<IndexedArtifact>, PackDiffError> {
    let _ = root;
    let text = fs::read_to_string(path)?;
    let (meta, body) = split_axis_pack_script(&text);
    let kind = meta
        .as_ref()
        .and_then(|m| m.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("script")
        .to_string();
    let source_id = meta
        .as_ref()
        .and_then(|m| m.get("sourceId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let display_name = meta
        .as_ref()
        .and_then(|m| m.get("displayName"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| rel.to_string())
        });

    let mut comparable = meta.clone().unwrap_or_else(|| Value::Object(Default::default()));
    if let Some(obj) = comparable.as_object_mut() {
        obj.remove("exportedAt");
        obj.remove("schema");
        obj.insert("body".into(), Value::String(normalize_script_body(body)));
    }
    ignore_empty_assignments(&mut comparable);
    let fingerprint = fingerprint_value(&comparable);
    let key = identity_key(&kind, source_id.as_deref(), &display_name, rel);
    Ok(Some(IndexedArtifact {
        key,
        kind,
        display_name,
        source_id,
        rel_path: rel.to_string(),
        fingerprint,
        comparable,
    }))
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

fn normalize_script_body(body: &str) -> String {
    body.replace("\r\n", "\n").trim().to_string()
}

fn extract_json_artifact(value: &Value, rel: &str) -> (String, Option<String>, String, Value) {
    let axis = value.get("axisExport");
    let kind = axis
        .and_then(|a| a.get("kind"))
        .and_then(Value::as_str)
        .or_else(|| infer_kind_from_path(rel))
        .unwrap_or("unknown")
        .to_string();
    let source_id = axis
        .and_then(|a| a.get("sourceId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let display_name = value
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/object/displayName").and_then(Value::as_str))
        .or_else(|| value.pointer("/object/name").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| {
            Path::new(rel)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| rel.to_string())
        });

    let mut comparable = value.clone();
    strip_volatile(&mut comparable);
    ignore_empty_assignments(&mut comparable);
    (kind, source_id, display_name, comparable)
}

fn infer_kind_from_path(rel: &str) -> Option<&'static str> {
    let lower = rel.to_ascii_lowercase();
    if lower.contains("/policies/") {
        Some("catalogPolicy")
    } else if lower.contains("/compliance/") {
        Some("compliance")
    } else if lower.contains("/endpoint-security/") {
        Some("endpointSecurity")
    } else if lower.contains("/windows-update/") {
        Some("windowsUpdate")
    } else if lower.contains("/group-policy/") {
        Some("groupPolicyConfiguration")
    } else if lower.contains("/enrollment/") {
        Some("enrollment")
    } else {
        None
    }
}

fn identity_key(kind: &str, source_id: Option<&str>, display_name: &str, rel: &str) -> String {
    if let Some(id) = source_id.map(str::trim).filter(|v| !v.is_empty()) {
        return format!("{kind}::{id}");
    }
    let name = display_name.trim().to_ascii_lowercase();
    if !name.is_empty() {
        return format!("{kind}::name:{name}");
    }
    format!("{kind}::path:{rel}")
}

/// Older snapshots omit `assignments`. An empty list is the same fact (nothing assigned),
/// so it should not mark the object as changed.
fn ignore_empty_assignments(value: &mut Value) {
    let Some(map) = value.as_object_mut() else {
        return;
    };
    if map
        .get("assignments")
        .is_some_and(|rows| rows.as_array().is_some_and(|rows| rows.is_empty()))
    {
        map.remove("assignments");
    }
}

fn strip_volatile(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("exportedAt");
            if let Some(axis) = map.get_mut("axisExport").and_then(Value::as_object_mut) {
                axis.remove("exportedAt");
            }
            // Walk children.
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                if let Some(child) = map.get_mut(&key) {
                    strip_volatile(child);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                strip_volatile(item);
            }
        }
        _ => {}
    }
}

fn fingerprint_value(value: &Value) -> String {
    let canonical = serde_json::to_vec(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&canonical);
    format!("{:x}", hasher.finalize())
}

fn diff_values(left: &Value, right: &Value, path: &str) -> Vec<PackFieldChange> {
    if left == right {
        return Vec::new();
    }
    match (left, right) {
        (Value::Object(l), Value::Object(r)) => {
            let mut keys = BTreeSet::new();
            keys.extend(l.keys().cloned());
            keys.extend(r.keys().cloned());
            let mut out = Vec::new();
            for key in keys {
                let child = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                if key == "assignments" {
                    let before = l
                        .get(&key)
                        .map(summarize_assignment_value)
                        .unwrap_or_else(|| "Unassigned".into());
                    let after = r
                        .get(&key)
                        .map(summarize_assignment_value)
                        .unwrap_or_else(|| "Unassigned".into());
                    if before != after {
                        out.push(PackFieldChange {
                            path: "Assignments".into(),
                            before: Some(before),
                            after: Some(after),
                        });
                    }
                    continue;
                }
                match (l.get(&key), r.get(&key)) {
                    (Some(lv), Some(rv)) => out.extend(diff_values(lv, rv, &child)),
                    (Some(lv), None) => out.push(PackFieldChange {
                        path: child,
                        before: Some(summarize_value(lv)),
                        after: None,
                    }),
                    (None, Some(rv)) => out.push(PackFieldChange {
                        path: child,
                        before: None,
                        after: Some(summarize_value(rv)),
                    }),
                    (None, None) => {}
                }
            }
            out
        }
        (Value::Array(l), Value::Array(r)) => {
            // Match settings by definition id, including nested choice/group children.
            if path.ends_with("settings")
                || path.ends_with(".settings")
                || array_is_settings(l)
                || array_is_settings(r)
            {
                return diff_settings_arrays(l, r, path);
            }
            if l.len() != r.len() {
                return vec![PackFieldChange {
                    path: path.to_string(),
                    before: Some(format!("{} items", l.len())),
                    after: Some(format!("{} items", r.len())),
                }];
            }
            let mut out = Vec::new();
            for (index, (lv, rv)) in l.iter().zip(r.iter()).enumerate() {
                out.extend(diff_values(lv, rv, &format!("{path}[{index}]")));
            }
            out
        }
        _ => vec![PackFieldChange {
            path: path.to_string(),
            before: Some(summarize_value(left)),
            after: Some(summarize_value(right)),
        }],
    }
}

fn diff_settings_arrays(left: &[Value], right: &[Value], path: &str) -> Vec<PackFieldChange> {
    let left_map = settings_by_definition(left);
    let right_map = settings_by_definition(right);
    let mut keys = BTreeSet::new();
    keys.extend(left_map.keys().cloned());
    keys.extend(right_map.keys().cloned());
    let mut out = Vec::new();
    for key in keys {
        let sample = left_map.get(&key).or_else(|| right_map.get(&key));
        let label = sample
            .map(|row| setting_label(row, &key))
            .unwrap_or_else(|| setting_label(&Value::Null, &key));
        let child = format!("{label} [{key}]");
        match (left_map.get(&key), right_map.get(&key)) {
            (Some(l), Some(r)) => {
                let left_clean = clean_setting(l);
                let right_clean = clean_setting(r);
                if left_clean == right_clean {
                    continue;
                }
                let mut inner = diff_values(&left_clean, &right_clean, &child);
                if inner.is_empty() {
                    inner.push(PackFieldChange {
                        path: child,
                        before: Some(summarize_setting(l)),
                        after: Some(summarize_setting(r)),
                    });
                }
                out.extend(inner);
            }
            (Some(l), None) => out.push(PackFieldChange {
                path: child,
                before: Some(summarize_setting(l)),
                after: None,
            }),
            (None, Some(r)) => out.push(PackFieldChange {
                path: child,
                before: None,
                after: Some(summarize_setting(r)),
            }),
            (None, None) => {}
        }
    }
    if out.is_empty() && left != right {
        out.push(PackFieldChange {
            path: path.to_string(),
            before: Some(format!("{} settings", left.len())),
            after: Some(format!("{} settings", right.len())),
        });
    }
    out
}

fn array_is_settings(rows: &[Value]) -> bool {
    rows.iter().any(|row| setting_definition_key(row).is_some())
}

fn settings_by_definition(rows: &[Value]) -> BTreeMap<String, Value> {
    let mut map = BTreeMap::new();
    for (index, row) in rows.iter().enumerate() {
        let id = setting_definition_key(row).unwrap_or_else(|| format!("#{index}"));
        map.insert(id, row.clone());
    }
    map
}

fn setting_definition_key(row: &Value) -> Option<String> {
    row.pointer("/settingInstance/settingDefinitionId")
        .and_then(Value::as_str)
        .or_else(|| row.pointer("/settingDefinitionId").and_then(Value::as_str))
        .or_else(|| row.pointer("/definitionId").and_then(Value::as_str))
        .or_else(|| {
            row.get("definition")
                .and_then(|definition| definition.get("id").or_else(|| definition.get("name")))
                .and_then(Value::as_str)
        })
        .map(str::to_string)
}

const SETTING_NOISE_KEYS: &[&str] = &[
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

fn clean_setting(row: &Value) -> Value {
    let instance = row.get("settingInstance").unwrap_or(row);
    strip_setting_noise(instance)
}

fn strip_setting_noise(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (key, child) in map {
                if SETTING_NOISE_KEYS.iter().any(|noise| key == noise) {
                    continue;
                }
                out.insert(key.clone(), strip_setting_noise(child));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(strip_setting_noise).collect()),
        other => other.clone(),
    }
}

fn setting_label(row: &Value, key: &str) -> String {
    if let Some(name) = text_field(row, "displayName") {
        return name;
    }
    if let Some(definition) = row.get("definition") {
        if let Some(name) = text_field(definition, "displayName").or_else(|| text_field(definition, "name"))
        {
            return name;
        }
    }
    let instance = row.get("settingInstance").unwrap_or(row);
    if let Some(name) = text_field(instance, "displayName") {
        return name;
    }
    let id = instance
        .get("settingDefinitionId")
        .and_then(Value::as_str)
        .unwrap_or(key);
    humanize_setting_id(id)
}

fn summarize_setting(row: &Value) -> String {
    if let Some(text) = summarize_admx_setting(row) {
        return text;
    }
    let instance = row.get("settingInstance").unwrap_or(row);
    let lines = summarize_setting_instance(instance);
    if lines.is_empty() {
        return summarize_value(row);
    }
    lines.join("\n")
}

fn summarize_admx_setting(row: &Value) -> Option<String> {
    if row.get("definition").is_none()
        && row.get("presentationValues").is_none()
        && row.get("enabled").is_none()
    {
        return None;
    }
    if row.get("settingInstance").is_some() {
        return None;
    }
    let state = match row.get("enabled").and_then(Value::as_bool) {
        Some(true) => "Enabled",
        Some(false) => "Disabled",
        None => "Configured",
    };
    let mut lines = vec![state.to_string()];
    if let Some(items) = row.get("presentationValues").and_then(Value::as_array) {
        for (index, item) in items.iter().take(8).enumerate() {
            let presentation = item.get("presentation");
            let label = presentation
                .and_then(|value| text_field(value, "label").or_else(|| text_field(value, "displayName")))
                .unwrap_or_else(|| format!("Value {}", index + 1));
            let value = item
                .get("value")
                .map(summarize_value)
                .unwrap_or_else(|| "—".into());
            lines.push(format!("  {label}: {value}"));
        }
        if items.len() > 8 {
            lines.push(format!("  … {} more", items.len() - 8));
        }
    }
    Some(lines.join("\n"))
}

fn summarize_setting_instance(instance: &Value) -> Vec<String> {
    let definition_id = instance
        .get("settingDefinitionId")
        .and_then(Value::as_str)
        .unwrap_or("");
    if let Some(choice) = instance.get("choiceSettingValue") {
        let raw = choice.get("value").and_then(Value::as_str).unwrap_or("");
        let mut lines = vec![humanize_option(raw, definition_id)];
        lines.extend(child_setting_lines(choice.get("children")));
        return lines;
    }
    if let Some(simple) = instance.get("simpleSettingValue") {
        if let Some(value) = simple.get("value") {
            return vec![summarize_value(value)];
        }
    }
    if let Some(group) = instance.get("groupSettingValue") {
        let children = child_setting_lines(group.get("children"));
        if children.is_empty() {
            return vec!["Empty group".into()];
        }
        return children;
    }
    if let Some(items) = collection_values(instance.get("simpleSettingCollectionValue")) {
        return numbered_values("Value", &items, |item| {
            summarize_value(item.get("value").unwrap_or(item))
        });
    }
    if let Some(items) = collection_values(instance.get("choiceSettingCollectionValue")) {
        return numbered_values("Selection", &items, |item| {
            humanize_option(
                item.get("value").and_then(Value::as_str).unwrap_or(""),
                definition_id,
            )
        });
    }
    if let Some(items) = collection_values(instance.get("groupSettingCollectionValue")) {
        let mut lines = Vec::new();
        for (index, group) in items.iter().take(8).enumerate() {
            lines.push(format!("Group {}", index + 1));
            lines.extend(child_setting_lines(group.get("children")));
        }
        if items.len() > 8 {
            lines.push(format!("… {} more groups", items.len() - 8));
        }
        if lines.is_empty() {
            lines.push("No groups".into());
        }
        return lines;
    }
    if let Some(value) = instance.get("value") {
        return vec![summarize_value(value)];
    }
    Vec::new()
}

fn child_setting_lines(children: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = children else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    for child in items.iter().take(8) {
        let instance = child.get("settingInstance").unwrap_or(child);
        let name = setting_label(instance, "Setting");
        let value = summarize_setting_instance(instance);
        let value = if value.is_empty() {
            "Configured".into()
        } else {
            value.join(", ")
        };
        lines.push(format!("  {name}: {value}"));
    }
    if items.len() > 8 {
        lines.push(format!("  … {} more", items.len() - 8));
    }
    lines
}

fn collection_values(value: Option<&Value>) -> Option<Vec<Value>> {
    match value? {
        Value::Array(items) => Some(items.clone()),
        Value::Object(map) => map.get("value").and_then(Value::as_array).cloned(),
        _ => None,
    }
}

fn numbered_values(
    label: &str,
    items: &[Value],
    value_of: impl Fn(&Value) -> String,
) -> Vec<String> {
    if items.is_empty() {
        return vec![format!("No {label}s")];
    }
    let mut lines: Vec<String> = items
        .iter()
        .take(8)
        .enumerate()
        .map(|(index, item)| format!("{label} {}: {}", index + 1, value_of(item)))
        .collect();
    if items.len() > 8 {
        lines.push(format!("… {} more", items.len() - 8));
    }
    lines
}

fn humanize_option(option_id: &str, definition_id: &str) -> String {
    let trimmed = option_id.trim();
    if trimmed.is_empty() {
        return "Not configured".into();
    }
    let rest = trimmed
        .strip_prefix(&format!("{definition_id}_"))
        .or_else(|| trimmed.strip_prefix(definition_id))
        .unwrap_or(trimmed)
        .trim_matches('_');
    if rest.is_empty() {
        return humanize_setting_id(trimmed);
    }
    humanize_setting_id(rest)
}

fn humanize_setting_id(value: &str) -> String {
    const SKIP: &[&str] = &[
        "device",
        "user",
        "vendor",
        "msft",
        "microsoft",
        "policy",
        "config",
        "admx",
    ];
    let parts: Vec<&str> = value
        .split(|ch: char| ch == '_' || ch == '/' || ch == '~')
        .filter(|part| !part.is_empty())
        .filter(|part| !SKIP.iter().any(|skip| part.eq_ignore_ascii_case(skip)))
        .collect();
    let words = if parts.is_empty() {
        value.to_string()
    } else {
        parts.join(" ")
    };
    title_case_words(&words)
}

fn title_case_words(value: &str) -> String {
    value
        .split_whitespace()
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            match lower.as_str() {
                "true" | "enabled" => "Enabled".into(),
                "false" | "disabled" => "Disabled".into(),
                "allow" => "Allow".into(),
                "block" => "Block".into(),
                "none" => "None".into(),
                _ => {
                    let mut chars = word.chars();
                    match chars.next() {
                        Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                        None => String::new(),
                    }
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn text_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn summarize_assignment_value(value: &Value) -> String {
    match value {
        Value::Array(items) => summarize_assignment_list(items),
        Value::Null => "Unassigned".into(),
        other => summarize_assignment_list(std::slice::from_ref(other)),
    }
}

fn summarize_assignment_list(items: &[Value]) -> String {
    if items.is_empty() {
        return "Unassigned".into();
    }
    let mut lines: Vec<String> = items.iter().map(summarize_assignment_row).collect();
    lines.sort();
    lines.dedup();
    lines.join("\n")
}

fn summarize_assignment_row(row: &Value) -> String {
    let target = row.get("target");
    let odata = target
        .and_then(|value| value.get("@odata.type"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let group_id = target
        .and_then(|value| value.get("groupId"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let group_name = target
        .and_then(|value| value.get("groupName"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let who = if odata.contains("allLicensedUsersAssignmentTarget") {
        "All users".to_string()
    } else if odata.contains("allDevicesAssignmentTarget") {
        "All devices".to_string()
    } else if odata.contains("exclusionGroupAssignmentTarget") {
        format!("Exclude {}", named_target(group_name, group_id))
    } else if !group_id.is_empty() || group_name.is_some() {
        format!("Group {}", named_target(group_name, group_id))
    } else {
        "Assignment".to_string()
    };

    let mut line = who;
    if let Some(intent) = row.get("intent").and_then(Value::as_str).map(str::trim) {
        if !intent.is_empty() {
            line.push_str(" · ");
            line.push_str(intent);
        }
    }
    let filter_type = target
        .and_then(|value| value.get("deviceAndAppManagementAssignmentFilterType"))
        .and_then(Value::as_str)
        .unwrap_or("none");
    let filter_id = target
        .and_then(|value| value.get("deviceAndAppManagementAssignmentFilterId"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if matches!(filter_type, "include" | "exclude") && !filter_id.is_empty() {
        let filter_name = target
            .and_then(|value| value.get("filterName"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let verb = if filter_type == "include" {
            "include filter"
        } else {
            "exclude filter"
        };
        line.push_str(" · ");
        line.push_str(verb);
        line.push(' ');
        line.push_str(&named_target(filter_name, filter_id));
    }
    line
}

fn named_target(name: Option<&str>, id: &str) -> String {
    match name {
        Some(name) => name.to_string(),
        None if !id.is_empty() => id.to_string(),
        None => "unknown".into(),
    }
}

/// Group and filter ids that appear in assignment field text, so a compare can
/// replace them with directory display names.
pub fn assignment_target_ids(report: &PackDiffReport) -> Vec<String> {
    let mut ids = Vec::new();
    for object in &report.objects {
        for change in &object.field_changes {
            if change.path != "Assignments" {
                continue;
            }
            if let Some(text) = &change.before {
                push_guids(text, &mut ids);
            }
            if let Some(text) = &change.after {
                push_guids(text, &mut ids);
            }
        }
    }
    ids
}

pub fn label_assignment_ids(report: &mut PackDiffReport, names: &std::collections::HashMap<String, String>) {
    if names.is_empty() {
        return;
    }
    for object in &mut report.objects {
        for change in &mut object.field_changes {
            if change.path != "Assignments" {
                continue;
            }
            if let Some(text) = &mut change.before {
                replace_known_ids(text, names);
            }
            if let Some(text) = &mut change.after {
                replace_known_ids(text, names);
            }
        }
    }
}

fn replace_known_ids(text: &mut String, names: &std::collections::HashMap<String, String>) {
    for (id, name) in names {
        if text.contains(id.as_str()) {
            *text = text.replace(id.as_str(), name);
        }
    }
}

fn push_guids(text: &str, ids: &mut Vec<String>) {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() < 36 {
        return;
    }
    let mut index = 0;
    while index + 36 <= chars.len() {
        let candidate: String = chars[index..index + 36].iter().collect();
        if is_guid(&candidate) {
            if !ids.iter().any(|existing| existing.eq_ignore_ascii_case(&candidate)) {
                ids.push(candidate);
            }
            index += 36;
        } else {
            index += 1;
        }
    }
}

fn is_guid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    bytes.iter().enumerate().all(|(index, byte)| match index {
        8 | 13 | 18 | 23 => *byte == b'-',
        _ => byte.is_ascii_hexdigit(),
    })
}

fn summarize_value(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(v) => v.to_string(),
        Value::Number(v) => v.to_string(),
        Value::String(v) => {
            let compact = v.replace('\n', "\\n");
            if compact.chars().count() > 120 {
                let trimmed: String = compact.chars().take(117).collect();
                format!("{trimmed}…")
            } else {
                compact
            }
        }
        Value::Array(items) => format!("[{} items]", items.len()),
        Value::Object(map) => {
            if let Some(simple) = map
                .get("value")
                .or_else(|| map.get("simpleValue"))
                .or_else(|| map.get("choiceValue"))
            {
                return summarize_value(simple);
            }
            let text = serde_json::to_string(value).unwrap_or_else(|_| "{}".into());
            if text.chars().count() > 160 {
                let trimmed: String = text.chars().take(157).collect();
                format!("{trimmed}…")
            } else {
                text
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::env;
    use uuid::Uuid;

    fn write_pack(root: &Path, rel: &str, value: &Value) {
        let path = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, serde_json::to_string_pretty(value).unwrap()).unwrap();
    }

    #[test]
    fn detects_added_removed_changed() {
        let left = env::temp_dir().join(format!("axis-diff-l-{}", Uuid::new_v4()));
        let right = env::temp_dir().join(format!("axis-diff-r-{}", Uuid::new_v4()));
        let _ = fs::remove_dir_all(&left);
        let _ = fs::remove_dir_all(&right);
        fs::create_dir_all(left.join("windows/policies")).unwrap();
        fs::create_dir_all(right.join("windows/policies")).unwrap();

        write_pack(
            &left,
            "windows/policies/a.json",
            &json!({
                "axisExport": { "kind": "catalogPolicy", "sourceId": "id-a", "exportedAt": "1" },
                "name": "Policy A",
                "settings": [{ "settingInstance": { "settingDefinitionId": "s1", "value": "old" } }]
            }),
        );
        write_pack(
            &left,
            "windows/policies/gone.json",
            &json!({
                "axisExport": { "kind": "catalogPolicy", "sourceId": "id-gone" },
                "name": "Gone",
                "settings": []
            }),
        );
        write_pack(
            &right,
            "windows/policies/a.json",
            &json!({
                "axisExport": { "kind": "catalogPolicy", "sourceId": "id-a", "exportedAt": "2" },
                "name": "Policy A",
                "settings": [{ "settingInstance": { "settingDefinitionId": "s1", "value": "new" } }]
            }),
        );
        write_pack(
            &right,
            "windows/policies/new.json",
            &json!({
                "axisExport": { "kind": "catalogPolicy", "sourceId": "id-new" },
                "name": "New",
                "settings": []
            }),
        );

        let report = diff_pack_roots(&left, &right, "left", "right").unwrap();
        assert_eq!(report.summary.added, 1);
        assert_eq!(report.summary.removed, 1);
        assert_eq!(report.summary.changed, 1);
        assert!(report
            .objects
            .iter()
            .any(|o| o.change == PackDiffChangeKind::Changed && o.display_name == "Policy A"));

        let _ = fs::remove_dir_all(&left);
        let _ = fs::remove_dir_all(&right);
    }

    #[test]
    fn assignment_diff_names_the_target() {
        let left = env::temp_dir().join(format!("axis-diff-asg-l-{}", Uuid::new_v4()));
        let right = env::temp_dir().join(format!("axis-diff-asg-r-{}", Uuid::new_v4()));
        let _ = fs::remove_dir_all(&left);
        let _ = fs::remove_dir_all(&right);
        fs::create_dir_all(left.join("windows/policies")).unwrap();
        fs::create_dir_all(right.join("windows/policies")).unwrap();
        let group_id = "11111111-2222-3333-4444-555555555555";
        write_pack(
            &left,
            "windows/policies/a.json",
            &json!({
                "axisExport": { "kind": "catalogPolicy", "sourceId": "id-a" },
                "name": "Policy A",
                "settings": [{ "settingInstance": { "settingDefinitionId": "s1", "value": "on" } }],
                "assignments": [{
                    "target": {
                        "@odata.type": "#microsoft.graph.groupAssignmentTarget",
                        "groupId": group_id,
                        "deviceAndAppManagementAssignmentFilterType": "include",
                        "deviceAndAppManagementAssignmentFilterId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
                    }
                }, {
                    "target": {
                        "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget"
                    }
                }]
            }),
        );
        write_pack(
            &right,
            "windows/policies/a.json",
            &json!({
                "axisExport": { "kind": "catalogPolicy", "sourceId": "id-a" },
                "name": "Policy A",
                "settings": [{ "settingInstance": { "settingDefinitionId": "s1", "value": "on" } }]
            }),
        );

        let mut report = diff_pack_roots(&left, &right, "left", "right").unwrap();
        let change = report
            .objects
            .iter()
            .find(|object| object.display_name == "Policy A")
            .and_then(|object| object.field_changes.first())
            .unwrap();
        assert_eq!(change.path, "Assignments");
        let before = change.before.as_deref().unwrap();
        assert!(before.contains("All devices"));
        assert!(before.contains(&format!("Group {group_id}")));
        assert!(before.contains("include filter aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
        assert_eq!(change.after.as_deref(), Some("Unassigned"));

        let ids = assignment_target_ids(&report);
        assert!(ids.iter().any(|id| id.eq_ignore_ascii_case(group_id)));
        let mut names = std::collections::HashMap::new();
        names.insert(group_id.to_string(), "Pilot devices".into());
        names.insert(
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into(),
            "Corporate".into(),
        );
        label_assignment_ids(&mut report, &names);
        let before = report
            .objects
            .iter()
            .find(|object| object.display_name == "Policy A")
            .and_then(|object| object.field_changes.first())
            .and_then(|change| change.before.as_deref())
            .unwrap();
        assert!(before.contains("Group Pilot devices"));
        assert!(before.contains("include filter Corporate"));
        assert!(!before.contains(group_id));

        let _ = fs::remove_dir_all(&left);
        let _ = fs::remove_dir_all(&right);
    }
}
