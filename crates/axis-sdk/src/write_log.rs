//! Local record of every Graph write Axis makes, and undo for the ones that can
//! be reversed.
//!
//! `GraphClient` calls [`record`] after each write. Entries are JSON lines under
//! `{root}/{tenantId}/{YYYY-MM-DD}.jsonl`, so the log survives restarts and is
//! easy to export.
//!
//! State is tracked on both sides of a write: the object is read just before a
//! PATCH, PUT, DELETE or `/assign`, and read again once it succeeds. A create
//! keeps the new object's id and its state as first read. Undo writes `before`
//! back, but only after checking the object still matches `after`, so a change
//! someone made since is never silently overwritten.

use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use chrono::{SecondsFormat, Utc};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::auth::decode_access_token_claims;
use crate::graph::GraphClient;

/// Bodies larger than this are replaced with a size note.
const MAX_BODY_BYTES: usize = 256 * 1024;

const REDACTED: &str = "[redacted]";
const TRUNCATED_KEY: &str = "_axisTruncated";

/// Keys whose values never reach disk.
const SECRET_KEYS: &[&str] = &[
    "password",
    "presharedkey",
    "sharedsecret",
    "secret",
    "clientsecret",
    "privatekey",
    "certificatepassword",
    "pfxpassword",
    "passphrase",
    "accesstoken",
    "refreshtoken",
    "uploadurl",
    "azurestorageuri",
    "fileencryptioninfo",
];

/// Keys Graph or Intune change on their own. They do not count as a change
/// someone made when checking whether an object moved on since a write.
const VOLATILE_KEYS: &[&str] = &["lastModifiedDateTime", "version", "isAssigned", "settingCount"];

/// Assignment fields Graph returns but `/assign` does not accept.
const ASSIGNMENT_READ_ONLY: &[&str] = &["id", "source", "sourceId"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteLogEntry {
    pub id: String,
    pub at: String,
    pub tenant_id: String,
    pub actor: Option<String>,
    /// Label of the user action that caused this write, when one was set.
    pub operation: Option<String>,
    pub method: String,
    pub path: String,
    pub version: String,
    pub request_body: Option<Value>,
    /// Object state read just before the write. Absent for creates and actions.
    pub before: Option<Value>,
    /// Object state read just after a successful write.
    #[serde(default)]
    pub after: Option<Value>,
    /// Id of the object a successful create made.
    #[serde(default)]
    pub created_id: Option<String>,
    /// Id of the entry this write reverted.
    #[serde(default)]
    pub undoes: Option<String>,
    /// Whether the object was read around this write. Off means no undo.
    #[serde(default = "default_true")]
    pub state_tracked: bool,
    pub status: Option<u16>,
    pub ok: bool,
    pub error: Option<String>,
}

/// A log entry with what the list needs to offer undo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteLogRow {
    #[serde(flatten)]
    pub entry: WriteLogEntry,
    /// Why undo is not offered. `None` when it is.
    pub undo_blocked: Option<String>,
    /// Id of the entry that reverted this one.
    pub undone_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoOutcome {
    pub ok: bool,
    /// Fields that differ from the state Axis left. Undo stops unless forced.
    pub conflicts: Vec<String>,
    /// The object could not be read after the original write, so a change
    /// since then cannot be ruled out. Undo stops unless forced.
    pub unverified: bool,
    pub error: Option<String>,
}

impl UndoOutcome {
    fn failed(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            conflicts: vec![],
            unverified: false,
            error: Some(message.into()),
        }
    }
}

pub(crate) struct WriteRecord<'a> {
    pub access_token: &'a str,
    pub method: &'a Method,
    pub path: &'a str,
    pub version: &'a str,
    pub body: Option<&'a Value>,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub created_id: Option<String>,
    pub state_tracked: bool,
    pub status: Option<u16>,
    pub error: Option<String>,
}

struct WriteLog {
    root: PathBuf,
    lock: Mutex<()>,
}

static LOG: OnceLock<WriteLog> = OnceLock::new();

/// Read each object before and after a write so it can be undone. Costs two
/// extra GETs per write, which counts against Graph throttling on bulk work.
static STATE_TRACKING: AtomicBool = AtomicBool::new(true);

fn default_true() -> bool {
    true
}

/// Turn undo state tracking on or off. Writes are still logged either way.
pub fn set_write_state_tracking(enabled: bool) {
    STATE_TRACKING.store(enabled, Ordering::Relaxed);
}

pub(crate) fn state_tracking() -> bool {
    STATE_TRACKING.load(Ordering::Relaxed)
}

tokio::task_local! {
    static OPERATION: String;
    static UNDOES: String;
}

/// Set the folder the log is written to. Called once at startup.
pub fn init_write_log(root: PathBuf) {
    let _ = LOG.set(WriteLog {
        root,
        lock: Mutex::new(()),
    });
}

/// Run `future` with every write inside it tagged with `label`.
pub async fn with_write_operation<F: std::future::Future>(label: String, future: F) -> F::Output {
    OPERATION.scope(label, future).await
}

pub(crate) fn enabled() -> bool {
    LOG.get().is_some()
}

/// Whether a request changes tenant state. Report and lookup POSTs do not.
pub(crate) fn is_write(method: &Method, path: &str) -> bool {
    if *method == Method::GET || *method == Method::HEAD {
        return false;
    }
    if *method != Method::POST {
        return true;
    }
    let bare = bare_path(path);
    if bare.contains("/reports/") {
        return false;
    }
    let last = bare.rsplit('/').next().unwrap_or("").to_ascii_lowercase();
    // Advanced hunting is a read sent as POST.
    if last == "runhuntingquery" {
        return false;
    }
    !["get", "evaluate", "search", "retrieve", "token"]
        .iter()
        .any(|prefix| last.starts_with(prefix))
}

/// Path to read for an object's state around a write, if there is one.
pub(crate) fn state_path(method: &Method, path: &str) -> Option<String> {
    let bare = bare_path(path);
    if bare.ends_with("/$ref") {
        return None;
    }
    if *method == Method::POST {
        // Assignment replace: keep the assignments it overwrites.
        return bare
            .strip_suffix("/assign")
            .map(|base| format!("{base}/assignments"));
    }
    if *method != Method::PATCH && *method != Method::PUT && *method != Method::DELETE {
        return None;
    }
    Some(object_state_path(bare))
}

/// Read path for one object. Settings Catalog settings are only returned when expanded.
pub(crate) fn object_state_path(object_path: &str) -> String {
    if object_path.contains("/deviceManagement/configurationPolicies/")
        && object_path.matches('/').count() == 3
    {
        return format!("{object_path}?$expand=settings");
    }
    object_path.to_string()
}

/// A POST to a collection that answered with an object made that object.
pub(crate) fn created_object_path(method: &Method, path: &str, response: Option<&Value>) -> Option<(String, String)> {
    if *method != Method::POST || state_path(method, path).is_some() {
        return None;
    }
    let id = response?.get("id")?.as_str()?.to_string();
    Some((format!("{}/{}", bare_path(path), urlencoding::encode(&id)), id))
}

/// A batch changes state when any of its requests is not a GET.
pub(crate) fn batch_is_write(requests: &[Value]) -> bool {
    requests.iter().any(|request| {
        request
            .get("method")
            .and_then(Value::as_str)
            .map_or(true, |method| !method.eq_ignore_ascii_case("GET"))
    })
}

pub(crate) fn record(write: WriteRecord<'_>) {
    let Some(log) = LOG.get() else {
        return;
    };
    let claims = decode_access_token_claims(write.access_token);
    let tenant_id = claims.tid.unwrap_or_else(|| "unknown-tenant".to_string());
    let entry = WriteLogEntry {
        id: Uuid::new_v4().to_string(),
        at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        tenant_id: tenant_id.clone(),
        actor: claims.upn.or(claims.name),
        operation: OPERATION.try_with(Clone::clone).ok(),
        method: write.method.as_str().to_string(),
        path: write.path.to_string(),
        version: write.version.to_string(),
        request_body: write.body.map(prepare_body),
        before: write.before.map(|value| prepare_body(&value)),
        after: write.after.map(|value| prepare_body(&value)),
        created_id: write.created_id,
        undoes: UNDOES.try_with(Clone::clone).ok(),
        state_tracked: write.state_tracked,
        status: write.status,
        ok: write.error.is_none(),
        error: write.error,
    };
    let Ok(line) = serde_json::to_string(&entry) else {
        return;
    };
    let dir = log.root.join(safe_segment(&tenant_id));
    let file = dir.join(format!("{}.jsonl", Utc::now().format("%Y-%m-%d")));
    let _guard = log.lock.lock().unwrap_or_else(|poison| poison.into_inner());
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(mut handle) = OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(handle, "{line}");
    }
}

/// Every entry for one tenant, newest first.
fn read_entries(tenant_id: &str) -> Vec<WriteLogEntry> {
    let Some(log) = LOG.get() else {
        return Vec::new();
    };
    let dir = log.root.join(safe_segment(tenant_id));
    let Ok(read_dir) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = read_dir
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .collect();
    files.sort();
    files.reverse();

    let mut entries = Vec::new();
    for file in files {
        let Ok(handle) = fs::File::open(&file) else {
            continue;
        };
        let mut day: Vec<WriteLogEntry> = BufReader::new(handle)
            .lines()
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_str(&line).ok())
            .collect();
        day.reverse();
        entries.extend(day);
    }
    entries
}

/// Entries for one tenant, newest first, with undo state.
pub fn list_write_log(tenant_id: &str, limit: usize) -> Vec<WriteLogRow> {
    let entries = read_entries(tenant_id);
    let undone_by: HashMap<String, String> = entries
        .iter()
        .filter(|entry| entry.ok)
        .filter_map(|entry| entry.undoes.clone().map(|target| (target, entry.id.clone())))
        .collect();
    entries
        .into_iter()
        .take(limit)
        .map(|entry| {
            let undone = undone_by.get(&entry.id).cloned();
            let undo_blocked = if undone.is_some() {
                Some("Already undone.".to_string())
            } else if !state_tracking() {
                Some("Undo is turned off in Settings.".to_string())
            } else {
                undo_plan(&entry).err()
            };
            WriteLogRow {
                entry,
                undo_blocked,
                undone_by: undone,
            }
        })
        .collect()
}

/// Folder holding the log, for "Open folder".
pub fn write_log_dir() -> Option<PathBuf> {
    LOG.get().map(|log| log.root.clone())
}

/* ── Undo ─────────────────────────────────────────────────────────── */

struct UndoPlan {
    method: Method,
    path: String,
    body: Option<Value>,
    /// Where to read the object now, and what Axis left it as.
    check_path: String,
    expected: Option<Value>,
}

fn undo_plan(entry: &WriteLogEntry) -> Result<UndoPlan, String> {
    if !entry.ok {
        return Err("The write failed, so there is nothing to undo.".into());
    }
    if !entry.state_tracked {
        return Err("Undo was turned off in Settings when this write was made, so its prior state was not kept.".into());
    }
    let method = Method::from_bytes(entry.method.as_bytes()).map_err(|_| "Unknown method.".to_string())?;
    let bare = bare_path(&entry.path).to_string();

    if let Some(created_id) = &entry.created_id {
        let object_path = format!("{bare}/{}", urlencoding::encode(created_id));
        return Ok(UndoPlan {
            method: Method::DELETE,
            check_path: object_state_path(&object_path),
            path: object_path,
            body: None,
            expected: entry.after.clone(),
        });
    }

    let not_undoable = || -> String {
        if method == Method::DELETE {
            "A deleted object cannot be brought back by undo. Its last state is under Before this write; use Compare & restore to recreate it.".into()
        } else if bare == "/$batch" {
            "Batch writes are not undoable yet.".into()
        } else {
            "This write is an action with no saved prior state, so it cannot be undone.".into()
        }
    };
    let check_path = state_path(&method, &entry.path).ok_or_else(not_undoable)?;
    if method == Method::DELETE {
        return Err(not_undoable());
    }
    let before = entry
        .before
        .as_ref()
        .ok_or("Axis could not read the object before this write, so there is nothing to put back.")?;
    let sent = entry
        .request_body
        .as_ref()
        .and_then(Value::as_object)
        .ok_or("The request body was not saved.")?;

    // A Windows Update ring uninstall rolls devices back on their next
    // check-in. Writing the flag back cannot recall a rollback that has run.
    if sent.keys().any(|key| key.ends_with("UpdatesWillBeRolledBack")) {
        return Err("An update uninstall cannot be undone. Devices that already checked in have rolled back.".into());
    }

    let body = if method == Method::POST {
        revert_assign_body(sent, before)?
    } else {
        revert_object_body(&method, sent, before)?
    };
    let text = body.to_string();
    if text.contains(REDACTED) || text.contains(TRUNCATED_KEY) {
        return Err("A value this would put back was redacted or too large to save, so undo could write the wrong value.".into());
    }
    Ok(UndoPlan {
        method,
        path: bare,
        body: Some(body),
        check_path,
        expected: entry.after.clone(),
    })
}

/// PATCH or PUT: the fields that were sent, with the values they had before.
fn revert_object_body(method: &Method, sent: &Map<String, Value>, before: &Value) -> Result<Value, String> {
    let before = before.as_object().ok_or("The saved prior state is not an object.")?;
    let mut body = Map::new();
    for (key, value) in sent {
        let next = if key == "@odata.type" || (*method == Method::PUT && key == "templateReference") {
            // Type and template do not change on update; send them as before.
            value.clone()
        } else if key == "settings" {
            let settings = before
                .get("settings")
                .and_then(Value::as_array)
                .ok_or("The saved prior state has no settings to put back.")?;
            Value::Array(
                settings
                    .iter()
                    .map(|setting| {
                        json!({
                            "@odata.type": setting.get("@odata.type").cloned()
                                .unwrap_or(json!("#microsoft.graph.deviceManagementConfigurationSetting")),
                            "settingInstance": setting.get("settingInstance").cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect(),
            )
        } else {
            before.get(key).cloned().unwrap_or(Value::Null)
        };
        body.insert(key.clone(), next);
    }
    Ok(Value::Object(body))
}

/// `/assign`: the assignment list the object had before, under the key that was sent.
fn revert_assign_body(sent: &Map<String, Value>, before: &Value) -> Result<Value, String> {
    let (key, sent_items) = sent
        .iter()
        .find(|(_, value)| value.is_array())
        .ok_or("The assignment request was not in a form Axis can reverse.")?;
    let previous = before
        .get("value")
        .and_then(Value::as_array)
        .ok_or("The saved prior assignments are missing.")?;
    // App assignments need their type; Graph does not always return it.
    let sent_type = sent_items
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| item.get("@odata.type"))
        .cloned();
    let items = previous
        .iter()
        .map(|item| {
            let mut item = strip_odata_meta(item);
            if let Some(map) = item.as_object_mut() {
                for key in ASSIGNMENT_READ_ONLY {
                    map.remove(*key);
                }
                if let (Some(kind), false) = (&sent_type, map.contains_key("@odata.type")) {
                    map.insert("@odata.type".into(), kind.clone());
                }
            }
            item
        })
        .collect();
    let mut body = Map::new();
    body.insert(key.clone(), Value::Array(items));
    Ok(Value::Object(body))
}

/// Reverse a logged write. Stops when the object changed since, unless `force`.
pub async fn undo_write(access_token: &str, entry_id: &str, force: bool) -> UndoOutcome {
    if !enabled() {
        return UndoOutcome::failed("The write log is not available.");
    }
    if !state_tracking() {
        // The reverse write would itself be logged without state, and the
        // conflict check needs the extra reads this setting turns off.
        return UndoOutcome::failed("Undo is turned off in Settings.");
    }
    let tenant_id = decode_access_token_claims(access_token)
        .tid
        .unwrap_or_else(|| "unknown-tenant".to_string());
    let entries = read_entries(&tenant_id);
    let Some(entry) = entries.iter().find(|entry| entry.id == entry_id) else {
        return UndoOutcome::failed("That write is not in this tenant's log.");
    };
    if entries.iter().any(|other| other.ok && other.undoes.as_deref() == Some(entry_id)) {
        return UndoOutcome::failed("This write was already undone.");
    }
    let plan = match undo_plan(entry) {
        Ok(plan) => plan,
        Err(reason) => return UndoOutcome::failed(reason),
    };

    let client = GraphClient::new();
    if !force {
        let Some(expected) = plan
            .expected
            .as_ref()
            .filter(|expected| expected.get(TRUNCATED_KEY).is_none())
        else {
            return UndoOutcome {
                ok: false,
                conflicts: vec![],
                unverified: true,
                error: None,
            };
        };
        let current = match client.read_state(access_token, &entry.version, &plan.check_path).await {
            Some(current) => current,
            None if plan.method == Method::DELETE => {
                return UndoOutcome::failed("The object Axis created is already gone.");
            }
            None => return UndoOutcome::failed("Axis could not read the object's current state."),
        };
        let conflicts = changed_keys(expected, &current);
        if !conflicts.is_empty() {
            return UndoOutcome {
                ok: false,
                conflicts,
                unverified: false,
                error: None,
            };
        }
    }

    let label = format!("Undo {} {}", entry.method, bare_path(&entry.path));
    let run = client.write_no_content(plan.method, access_token, &plan.path, &entry.version, plan.body);
    let result = UNDOES
        .scope(entry.id.clone(), OPERATION.scope(label, run))
        .await;
    match result {
        Ok(()) => UndoOutcome {
            ok: true,
            conflicts: vec![],
            unverified: false,
            error: None,
        },
        Err(error) => UndoOutcome::failed(error.to_string()),
    }
}

/// Top-level fields that differ between two reads of the same object.
fn changed_keys(expected: &Value, current: &Value) -> Vec<String> {
    let expected = comparable(expected);
    let current = comparable(current);
    match (expected.as_object(), current.as_object()) {
        (Some(left), Some(right)) => {
            let keys: HashSet<&String> = left.keys().chain(right.keys()).collect();
            let mut changed: Vec<String> = keys
                .into_iter()
                .filter(|key| left.get(*key) != right.get(*key))
                .cloned()
                .collect();
            changed.sort();
            changed
        }
        _ if expected != current => vec!["(object)".to_string()],
        _ => vec![],
    }
}

/// Drop OData metadata and fields Intune changes on its own. A collection read
/// (`{ value: [...] }`) is compared as an unordered set.
fn comparable(value: &Value) -> Value {
    let mut value = strip_odata_meta(&redact(value));
    if let Some(map) = value.as_object_mut() {
        for key in VOLATILE_KEYS {
            map.remove(*key);
        }
        if let Some(Value::Array(items)) = map.get_mut("value") {
            items.sort_by_key(|item| item.to_string());
        }
    }
    value
}

fn strip_odata_meta(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(key, _)| !(key.contains("@odata.") && *key != "@odata.type"))
                .map(|(key, inner)| (key.clone(), strip_odata_meta(inner)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(strip_odata_meta).collect()),
        other => other.clone(),
    }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

fn bare_path(path: &str) -> &str {
    path.split('?').next().unwrap_or(path)
}

fn safe_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' { ch } else { '_' })
        .collect()
}

fn prepare_body(value: &Value) -> Value {
    let redacted = redact(value);
    let size = serde_json::to_string(&redacted).map_or(0, |text| text.len());
    if size > MAX_BODY_BYTES {
        let mut note = Map::new();
        note.insert(TRUNCATED_KEY.into(), Value::Bool(true));
        note.insert("bytes".into(), json!(size));
        return Value::Object(note);
    }
    redacted
}

fn redact(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            // Settings Catalog secrets carry their value under a plain `value` key.
            let secret_setting = map
                .get("@odata.type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.to_ascii_lowercase().contains("secretsettingvalue"));
            Value::Object(
                map.iter()
                    .map(|(key, inner)| {
                        let lower = key.to_ascii_lowercase();
                        let secret = (SECRET_KEYS.iter().any(|name| lower == *name || lower.ends_with(name))
                            || (secret_setting && lower == "value"))
                            && !inner.is_null()
                            && !inner.is_boolean();
                        let next = if secret {
                            Value::String(REDACTED.to_string())
                        } else {
                            redact(inner)
                        };
                        (key.clone(), next)
                    })
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(redact).collect()),
        other => other.clone(),
    }
}
