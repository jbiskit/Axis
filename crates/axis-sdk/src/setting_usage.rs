//! Tenant-wide "where used" index for Settings Catalog settings.
//!
//! The catalog explorer shows, for any setting definition, which
//! configurationPolicies set it, to what value, and who those policies are
//! assigned to. Reading each policy's settings one at a time is one Graph call
//! per policy, so this walks the collection once with
//! `$expand=settings,assignments` and flattens every setting instance
//! (children included) into `definition id -> [(policy, value)]`.
//!
//! Values are kept raw (choice option ids, simple values). The UI resolves
//! option labels from the Graph setting definition, which stays the source of
//! truth for display copy.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::assignments::{drafts_from_graph_assignments, AssignmentDraft};
use crate::graph::{GraphClient, GraphError};

const POLICIES_PATH: &str = "/deviceManagement/configurationPolicies";
const MAX_POLICIES: usize = 2000;
const SETTINGS_MAX: usize = 1000;
/// Recorded for group containers, which carry children but no value of their own.
const GROUP_VALUE: &str = "configured";

/// One policy that configures at least one indexed setting.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingUsagePolicy {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platforms: Option<String>,
    /// `templateReference.templateFamily`, e.g. `endpointSecurityDiskEncryption`; `none` for freeform.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_family: Option<String>,
    pub assignments: Vec<AssignmentDraft>,
    /// `false` when assignments could not be read, so "unassigned" is not implied.
    pub assignments_loaded: bool,
}

/// One policy's value for a setting. Several instances of the same
/// definition in one policy (collections) are joined, sorted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingUsageValue {
    pub policy_id: String,
    pub values: Vec<String>,
}

/// Every policy that sets one definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingUsage {
    pub definition_id: String,
    pub usages: Vec<SettingUsageValue>,
    /// More than one distinct value across the policies that set it.
    pub conflict: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingUsageIndex {
    pub policies: Vec<SettingUsagePolicy>,
    pub settings: Vec<SettingUsage>,
    /// Partial reads (assignments missing, a policy's settings failed), for the UI to surface.
    pub warnings: Vec<String>,
    /// The policy list hit `MAX_POLICIES`.
    pub truncated: bool,
}

fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn scalar_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

/// Text for a simple value; secrets never leave the SDK.
fn simple_value_text(simple: &Value) -> Option<String> {
    let odata = str_field(simple, "@odata.type").unwrap_or_default();
    if odata.to_ascii_lowercase().contains("secret") {
        return Some("secret".into());
    }
    simple.get("value").and_then(scalar_text)
}

/// Walk one setting instance: record its own value, then recurse into children.
fn collect_instance(instance: &Value, out: &mut BTreeMap<String, BTreeSet<String>>) {
    let Some(definition_id) = str_field(instance, "settingDefinitionId") else {
        return;
    };
    let mut values: Vec<String> = Vec::new();
    let mut children: Vec<&Value> = Vec::new();

    if let Some(choice) = instance.get("choiceSettingValue") {
        if let Some(value) = str_field(choice, "value") {
            values.push(value.to_string());
        }
        children.extend(choice.get("children").and_then(Value::as_array).into_iter().flatten());
    }
    if let Some(items) = instance.get("choiceSettingCollectionValue").and_then(Value::as_array) {
        for item in items {
            if let Some(value) = str_field(item, "value") {
                values.push(value.to_string());
            }
            children.extend(item.get("children").and_then(Value::as_array).into_iter().flatten());
        }
    }
    if let Some(simple) = instance.get("simpleSettingValue") {
        values.extend(simple_value_text(simple));
    }
    if let Some(items) = instance.get("simpleSettingCollectionValue").and_then(Value::as_array) {
        values.extend(items.iter().filter_map(simple_value_text));
    }
    if let Some(group) = instance.get("groupSettingValue") {
        values.push(GROUP_VALUE.into());
        children.extend(group.get("children").and_then(Value::as_array).into_iter().flatten());
    }
    if let Some(items) = instance.get("groupSettingCollectionValue").and_then(Value::as_array) {
        values.push(GROUP_VALUE.into());
        for item in items {
            children.extend(item.get("children").and_then(Value::as_array).into_iter().flatten());
        }
    }

    let entry = out.entry(definition_id.to_string()).or_default();
    entry.extend(values);
    for child in children {
        collect_instance(child, out);
    }
}

/// Flatten a policy's `settings` rows (each wrapping a `settingInstance`).
fn collect_policy_settings(rows: &[Value]) -> BTreeMap<String, BTreeSet<String>> {
    let mut out = BTreeMap::new();
    for row in rows {
        let instance = row.get("settingInstance").unwrap_or(row);
        collect_instance(instance, &mut out);
    }
    out
}

fn array_of(row: &Value, key: &str) -> Vec<Value> {
    row.get(key).and_then(Value::as_array).cloned().unwrap_or_default()
}

/// Read every configurationPolicy with its settings and assignments and index
/// them by setting definition id.
pub async fn fetch_setting_usage_index(access_token: &str) -> Result<SettingUsageIndex, GraphError> {
    let client = GraphClient::new();
    let select = "$select=id,name,platforms,templateReference";
    let mut warnings: Vec<String> = Vec::new();

    let mut assignments_loaded = true;
    let rows = match client
        .fetch_all_pages::<Value>(
            access_token,
            &format!("{POLICIES_PATH}?{select}&$expand=settings,assignments&$top=100"),
            "beta",
            MAX_POLICIES,
        )
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            // Some tenants reject the double expand; settings are what the index needs.
            warnings.push(format!("Assignments not loaded: {error}"));
            assignments_loaded = false;
            client
                .fetch_all_pages::<Value>(
                    access_token,
                    &format!("{POLICIES_PATH}?{select}&$expand=settings&$top=100"),
                    "beta",
                    MAX_POLICIES,
                )
                .await?
        }
    };
    let truncated = rows.len() >= MAX_POLICIES;

    let mut policies: Vec<SettingUsagePolicy> = Vec::new();
    let mut by_definition: BTreeMap<String, Vec<SettingUsageValue>> = BTreeMap::new();

    for row in rows {
        let Some(id) = str_field(&row, "id") else {
            continue;
        };
        let name = str_field(&row, "name").unwrap_or(id).to_string();

        // Large policies page their expanded settings; read the rest directly.
        let mut settings = array_of(&row, "settings");
        if row.get("settings@odata.nextLink").is_some() {
            let enc = urlencoding::encode(id);
            match client
                .fetch_all_pages::<Value>(
                    access_token,
                    &format!("{POLICIES_PATH}/{enc}/settings?$top={SETTINGS_MAX}"),
                    "beta",
                    SETTINGS_MAX,
                )
                .await
            {
                Ok(all) => settings = all,
                Err(error) => warnings.push(format!("{name}: only some settings read ({error})")),
            }
        }

        let flattened = collect_policy_settings(&settings);
        if flattened.is_empty() {
            continue;
        }
        for (definition_id, values) in flattened {
            by_definition.entry(definition_id).or_default().push(SettingUsageValue {
                policy_id: id.to_string(),
                values: values.into_iter().collect(),
            });
        }

        let assignments = array_of(&row, "assignments");
        policies.push(SettingUsagePolicy {
            id: id.to_string(),
            name,
            platforms: str_field(&row, "platforms").map(str::to_string),
            template_family: row
                .get("templateReference")
                .and_then(|reference| str_field(reference, "templateFamily"))
                .map(str::to_string),
            assignments: drafts_from_graph_assignments(&assignments, true),
            assignments_loaded,
        });
    }

    let settings = by_definition
        .into_iter()
        .map(|(definition_id, usages)| {
            let distinct: BTreeSet<&Vec<String>> = usages.iter().map(|usage| &usage.values).collect();
            SettingUsage {
                conflict: distinct.len() > 1,
                definition_id,
                usages,
            }
        })
        .collect();

    Ok(SettingUsageIndex {
        policies,
        settings,
        warnings,
        truncated,
    })
}
