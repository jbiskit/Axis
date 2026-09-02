use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::graph::{GraphClient, GraphError};
use crate::inventory::CatalogPolicySummary;

pub const NIL_CATEGORY_PARENT_ID: &str = "00000000-0000-0000-0000-000000000000";
pub const ADMINISTRATIVE_TEMPLATES_CATEGORY_ID: &str = "48be5f9d-4941-4189-8015-dd78f87aacd5";
pub const MACOS_MICROSOFT_EDGE_CATEGORY_ID: &str = "9d14bbed-327d-4c38-ac02-6b916909bdd9";
pub const WINDOWS_MICROSOFT_EDGE_CATEGORY_ID: &str = "a25a7a02-4bac-411b-9d02-10cb3297cb17";

const PINNED_ROOT_CATEGORY_IDS: &[&str] = &[
    ADMINISTRATIVE_TEMPLATES_CATEGORY_ID,
    "0a1347d2-90c0-407a-baa0-e4859260532a",
    "e8400c82-34c8-4d6e-bbf9-85220f3205ea",
    WINDOWS_MICROSOFT_EDGE_CATEGORY_ID,
    MACOS_MICROSOFT_EDGE_CATEGORY_ID,
    "f62e0f2a-4363-4246-8057-1dc811fe4360",
];

const CATALOG_PAGE_MAX: usize = 20_000;
const CATALOG_SEARCH_MAX: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SettingsCatalogPlatform {
    Windows,
    Macos,
}

impl SettingsCatalogPlatform {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "macos" | "mac" => Self::Macos,
            _ => Self::Windows,
        }
    }

    pub fn graph_platforms(self) -> &'static str {
        match self {
            Self::Macos => "macOS",
            Self::Windows => "windows10",
        }
    }

    pub fn technologies(self) -> &'static [&'static str] {
        match self {
            Self::Macos => &["mdm", "appleRemoteManagement"],
            Self::Windows => &["mdm"],
        }
    }

    pub fn technologies_csv(self) -> String {
        self.technologies().join(",")
    }
}

pub fn settings_catalog_platform_from_graph(platform: &str) -> SettingsCatalogPlatform {
    SettingsCatalogPlatform::parse(platform)
}

fn odata_has_any(field: &str, values: &[&str]) -> String {
    if values.len() == 1 {
        return format!("({field} has '{}')", values[0]);
    }
    let inner = values
        .iter()
        .map(|value| format!("{field} has '{value}'"))
        .collect::<Vec<_>>()
        .join(" or ");
    format!("({inner})")
}

pub fn settings_catalog_category_graph_filter(platform: SettingsCatalogPlatform) -> String {
    format!(
        "(platforms has '{}') and {}",
        platform.graph_platforms(),
        odata_has_any("technologies", platform.technologies())
    )
}

pub fn settings_catalog_settings_applicability_graph_filter(
    platform: SettingsCatalogPlatform,
) -> String {
    format!(
        "visibility has 'settingsCatalog' and (applicability/platform has '{}') and {}",
        platform.graph_platforms(),
        odata_has_any("applicability/technologies", platform.technologies())
    )
}

pub fn settings_catalog_settings_by_category_graph_filter(
    platform: SettingsCatalogPlatform,
    category_id: &str,
) -> String {
    let escaped = category_id.replace('\'', "''");
    format!(
        "categoryId eq '{escaped}' and {}",
        settings_catalog_settings_applicability_graph_filter(platform)
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCategory {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub child_category_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_category_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_category_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platforms: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technologies: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting_usage: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDependentRef {
    pub setting_definition_id: String,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSettingOption {
    pub item_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub depended_on_by: Vec<CatalogDependentRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSettingSummary {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    pub keywords: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technologies: Option<String>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_definition_id: Option<String>,
    pub is_root: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSettingDetail {
    #[serde(flatten)]
    pub summary: CatalogSettingSummary,
    pub options: Vec<CatalogSettingOption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_option_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_string: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_length: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_length: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_count: Option<i64>,
    #[serde(rename = "@odata.type", skip_serializing_if = "Option::is_none")]
    pub odata_type: Option<String>,
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySettingsLoad {
    pub category_id: String,
    pub roots: Vec<CatalogSettingDetail>,
    pub by_id: HashMap<String, CatalogSettingDetail>,
    pub setting_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSearchResult {
    pub settings: Vec<CatalogSettingSummary>,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedCatalogPolicy {
    pub id: String,
    pub name: String,
}

fn as_object(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    value.as_object()
}

fn string_field(map: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn short_odata_type(value: Option<&str>) -> String {
    value
        .unwrap_or("settingDefinition")
        .replace("#microsoft.graph.deviceManagementConfiguration", "")
        .replace("microsoft.graph.deviceManagementConfiguration", "")
}

pub fn is_synthetic_top_level_group_id(id: &str) -> bool {
    let Some(separator) = id.find('_') else {
        return false;
    };
    if separator == 0 {
        return false;
    }
    let domain = &id[..separator];
    let rest = &id[separator + 1..];
    rest == domain || rest.starts_with(&format!("{domain}-"))
}

fn flag_tokens(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

pub fn category_applies_to_catalog_platform(
    category: &CatalogCategory,
    platform: SettingsCatalogPlatform,
) -> bool {
    if platform != SettingsCatalogPlatform::Macos {
        return true;
    }
    let technologies = flag_tokens(category.technologies.as_deref());
    if technologies.is_empty() {
        return true;
    }
    if technologies
        .iter()
        .any(|token| token == "appleremotemanagement")
    {
        return true;
    }
    !technologies
        .iter()
        .any(|token| token == "mobileapplicationmanagement")
}

fn is_root_category(category: &CatalogCategory) -> bool {
    match category.parent_category_id.as_deref().map(str::trim) {
        None | Some("") => true,
        Some(parent) if parent == NIL_CATEGORY_PARENT_ID => true,
        Some(parent) if parent == category.id => true,
        Some(_) => false,
    }
}

fn compare_root_categories(a: &CatalogCategory, b: &CatalogCategory) -> std::cmp::Ordering {
    let pin = |id: &str| {
        PINNED_ROOT_CATEGORY_IDS
            .iter()
            .position(|pinned| *pinned == id)
            .unwrap_or(usize::MAX)
    };
    pin(&a.id).cmp(&pin(&b.id)).then_with(|| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    })
}

pub fn root_catalog_categories(categories: &[CatalogCategory]) -> Vec<CatalogCategory> {
    let by_id: HashSet<&str> = categories
        .iter()
        .map(|category| category.id.as_str())
        .collect();
    let mut roots: Vec<CatalogCategory> = categories
        .iter()
        .filter(|category| is_root_category(category))
        .cloned()
        .collect();

    if roots.is_empty() {
        roots = categories
            .iter()
            .filter(|category| {
                let parent = category.parent_category_id.as_deref().map(str::trim);
                match parent {
                    None | Some("") | Some(NIL_CATEGORY_PARENT_ID) => true,
                    Some(parent) => !by_id.contains(parent),
                }
            })
            .cloned()
            .collect();
    }

    if roots.is_empty() {
        let mentioned: HashSet<&str> = categories
            .iter()
            .flat_map(|category| category.child_category_ids.iter().map(String::as_str))
            .collect();
        roots = categories
            .iter()
            .filter(|category| !mentioned.contains(category.id.as_str()))
            .cloned()
            .collect();
    }

    roots.sort_by(compare_root_categories);
    roots
}

pub fn child_catalog_categories(
    categories: &[CatalogCategory],
    parent_id: &str,
) -> Vec<CatalogCategory> {
    let by_id: HashMap<&str, &CatalogCategory> = categories
        .iter()
        .map(|category| (category.id.as_str(), category))
        .collect();
    if let Some(parent) = by_id.get(parent_id) {
        if !parent.child_category_ids.is_empty() {
            let mut children: Vec<CatalogCategory> = parent
                .child_category_ids
                .iter()
                .filter_map(|id| by_id.get(id.as_str()).copied())
                .filter(|category| category.id != parent_id)
                .cloned()
                .collect();
            children.sort_by(|a, b| {
                a.display_name
                    .to_lowercase()
                    .cmp(&b.display_name.to_lowercase())
            });
            return children;
        }
    }

    let mut children: Vec<CatalogCategory> = categories
        .iter()
        .filter(|category| {
            category.parent_category_id.as_deref() == Some(parent_id) && category.id != parent_id
        })
        .cloned()
        .collect();
    children.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    children
}

fn map_catalog_category(item: &Value) -> Option<CatalogCategory> {
    let map = as_object(item)?;
    let id = string_field(map, "id")?;
    let display_name = string_field(map, "displayName")
        .or_else(|| string_field(map, "name"))
        .unwrap_or_else(|| id.clone());
    let child_category_ids = map
        .get("childCategoryIds")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Some(CatalogCategory {
        id,
        display_name,
        description: string_field(map, "description"),
        child_category_ids,
        parent_category_id: string_field(map, "parentCategoryId"),
        root_category_id: string_field(map, "rootCategoryId"),
        platforms: string_field(map, "platforms"),
        technologies: string_field(map, "technologies"),
        setting_usage: string_field(map, "settingUsage"),
    })
}

fn merge_categories_by_id(batches: Vec<Vec<CatalogCategory>>) -> Vec<CatalogCategory> {
    let mut by_id: HashMap<String, CatalogCategory> = HashMap::new();
    for batch in batches {
        for category in batch {
            if category.id.is_empty() {
                continue;
            }
            by_id
                .entry(category.id.clone())
                .and_modify(|existing| {
                    if !category.display_name.is_empty() {
                        existing.display_name = category.display_name.clone();
                    }
                    if category.description.is_some() {
                        existing.description = category.description.clone();
                    }
                    if !category.child_category_ids.is_empty() {
                        existing.child_category_ids = category.child_category_ids.clone();
                    }
                    existing.parent_category_id = category
                        .parent_category_id
                        .clone()
                        .or(existing.parent_category_id.clone());
                    existing.root_category_id = category
                        .root_category_id
                        .clone()
                        .or(existing.root_category_id.clone());
                    existing.platforms = category.platforms.clone().or(existing.platforms.clone());
                    existing.technologies = category
                        .technologies
                        .clone()
                        .or(existing.technologies.clone());
                })
                .or_insert(category);
        }
    }
    let mut categories: Vec<CatalogCategory> = by_id.into_values().collect();
    categories.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    categories
}

pub(crate) fn map_setting_summary(raw: &Value) -> Option<CatalogSettingSummary> {
    let map = as_object(raw)?;
    let id = string_field(map, "id")?;
    let root_definition_id = string_field(map, "rootDefinitionId");
    let applicability = map.get("applicability").and_then(as_object);
    let keywords = map
        .get("keywords")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let is_root = root_definition_id
        .as_deref()
        .map(|root| root == id)
        .unwrap_or(true);
    Some(CatalogSettingSummary {
        display_name: string_field(map, "displayName")
            .or_else(|| string_field(map, "name"))
            .unwrap_or_else(|| id.clone()),
        description: string_field(map, "description"),
        help_text: string_field(map, "helpText"),
        category_id: string_field(map, "categoryId"),
        keywords,
        platform: applicability.and_then(|app| string_field(app, "platform")),
        technologies: applicability.and_then(|app| string_field(app, "technologies")),
        kind: short_odata_type(map.get("@odata.type").and_then(Value::as_str)),
        visibility: string_field(map, "visibility"),
        root_definition_id,
        is_root,
        id,
    })
}

fn map_setting_detail(raw: &Value) -> Option<CatalogSettingDetail> {
    let map = as_object(raw)?;
    let summary = map_setting_summary(raw)?;
    let mut options = Vec::new();
    if let Some(items) = map.get("options").and_then(Value::as_array) {
        for option in items {
            let Some(rec) = as_object(option) else {
                continue;
            };
            let Some(item_id) = string_field(rec, "itemId").or_else(|| string_field(rec, "name"))
            else {
                continue;
            };
            let mut depended_on_by = Vec::new();
            if let Some(deps) = rec.get("dependedOnBy").and_then(Value::as_array) {
                for dep in deps {
                    let Some(dep_rec) = as_object(dep) else {
                        continue;
                    };
                    let Some(setting_definition_id) = string_field(dep_rec, "dependedOnBy")
                        .or_else(|| string_field(dep_rec, "settingDefinitionId"))
                    else {
                        continue;
                    };
                    depended_on_by.push(CatalogDependentRef {
                        setting_definition_id,
                        required: dep_rec
                            .get("required")
                            .and_then(Value::as_bool)
                            .unwrap_or(true),
                    });
                }
            }
            options.push(CatalogSettingOption {
                item_id: item_id.clone(),
                display_name: string_field(rec, "displayName")
                    .or_else(|| string_field(rec, "name"))
                    .unwrap_or(item_id),
                description: string_field(rec, "description"),
                depended_on_by,
            });
        }
    }

    let value_definition = map.get("valueDefinition").and_then(as_object);
    let default_value = map.get("defaultValue").and_then(as_object);
    let mut value_type = None;
    let mut min_value = None;
    let mut max_value = None;
    let mut maximum_length = None;
    let mut minimum_length = None;
    if let Some(def) = value_definition {
        value_type = Some(short_odata_type(
            def.get("@odata.type").and_then(Value::as_str),
        ));
        min_value = def.get("minimumValue").and_then(Value::as_f64);
        max_value = def.get("maximumValue").and_then(Value::as_f64);
        maximum_length = def.get("maximumLength").and_then(Value::as_i64);
        minimum_length = def.get("minimumLength").and_then(Value::as_i64);
    }

    let default_string = default_value.and_then(|value| {
        value.get("value").and_then(|inner| match inner {
            Value::Null => None,
            other => Some(other.to_string().trim_matches('"').to_string()),
        })
    });

    Some(CatalogSettingDetail {
        summary,
        options,
        default_option_id: string_field(map, "defaultOptionId"),
        value_type,
        default_string,
        min_value,
        max_value,
        maximum_length,
        minimum_length,
        minimum_count: map.get("minimumCount").and_then(Value::as_i64),
        maximum_count: map.get("maximumCount").and_then(Value::as_i64),
        odata_type: string_field(map, "@odata.type"),
        raw: raw.clone(),
    })
}

pub fn declared_child_setting_ids(detail: &CatalogSettingDetail) -> Vec<String> {
    detail
        .raw
        .get("dependedOnBy")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(as_object)
                .filter_map(|record| {
                    string_field(record, "dependedOnBy")
                        .or_else(|| string_field(record, "settingDefinitionId"))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn is_synthetic_top_level_group(detail: &CatalogSettingDetail) -> bool {
    detail
        .summary
        .kind
        .to_ascii_lowercase()
        .contains("settinggroup")
        && is_synthetic_top_level_group_id(&detail.summary.id)
}

fn unwrap_synthetic_group(
    wrapper: &CatalogSettingDetail,
    loaded: &[CatalogSettingDetail],
    by_id: &HashMap<String, CatalogSettingDetail>,
) -> Vec<CatalogSettingDetail> {
    let declared: Vec<CatalogSettingDetail> = declared_child_setting_ids(wrapper)
        .into_iter()
        .filter_map(|id| by_id.get(&id).cloned())
        .collect();
    if !declared.is_empty() {
        return declared;
    }

    let mut claimed = HashSet::new();
    for detail in loaded {
        if detail.summary.id == wrapper.summary.id {
            continue;
        }
        for id in declared_child_setting_ids(detail) {
            claimed.insert(id);
        }
    }
    loaded
        .iter()
        .filter(|detail| {
            detail.summary.id != wrapper.summary.id
                && detail.summary.root_definition_id.as_deref() == Some(wrapper.summary.id.as_str())
                && !claimed.contains(&detail.summary.id)
        })
        .cloned()
        .collect()
}

fn category_settings_from_rows(category_id: &str, raw: Vec<Value>) -> CategorySettingsLoad {
    let mut by_id = HashMap::new();
    let mut loaded = Vec::new();
    for row in raw {
        let Some(detail) = map_setting_detail(&row) else {
            continue;
        };
        if detail.summary.id.is_empty() {
            continue;
        }
        by_id.insert(detail.summary.id.clone(), detail.clone());
        loaded.push(detail);
    }

    let top_level: Vec<CatalogSettingDetail> = loaded
        .iter()
        .filter(
            |detail| match detail.summary.root_definition_id.as_deref() {
                None => true,
                Some(root) if root == detail.summary.id => true,
                Some(root) => !by_id.contains_key(root),
            },
        )
        .cloned()
        .collect();

    let mut roots = Vec::new();
    let mut wrappers = 0usize;
    for detail in top_level {
        if is_synthetic_top_level_group(&detail) {
            let children = unwrap_synthetic_group(&detail, &loaded, &by_id);
            if !children.is_empty() {
                wrappers += 1;
                roots.extend(children);
                continue;
            }
        }
        roots.push(detail);
    }
    roots.sort_by(|a, b| {
        a.summary
            .display_name
            .to_lowercase()
            .cmp(&b.summary.display_name.to_lowercase())
    });
    let setting_count = loaded.len().saturating_sub(wrappers);
    CategorySettingsLoad {
        category_id: category_id.to_string(),
        roots,
        by_id,
        setting_count,
    }
}

async fn list_values(
    client: &GraphClient,
    access_token: &str,
    path: &str,
) -> Result<Vec<Value>, GraphError> {
    client
        .fetch_all_pages::<Value>(access_token, path, "beta", CATALOG_PAGE_MAX)
        .await
}

pub async fn list_catalog_categories(
    access_token: &str,
    platform: SettingsCatalogPlatform,
) -> Result<Vec<CatalogCategory>, GraphError> {
    let client = GraphClient::new();
    let base_filter = settings_catalog_category_graph_filter(platform);
    let encoded = urlencoding::encode(&base_filter);
    let root_unquoted = format!("(parentCategoryId eq {NIL_CATEGORY_PARENT_ID}) and {base_filter}");
    let root_quoted = format!("(parentCategoryId eq '{NIL_CATEGORY_PARENT_ID}') and {base_filter}");

    let all_path = format!("/deviceManagement/configurationCategories?$filter={encoded}");
    let roots_unquoted_path = format!(
        "/deviceManagement/configurationCategories?$filter={}",
        urlencoding::encode(&root_unquoted)
    );
    let roots_quoted_path = format!(
        "/deviceManagement/configurationCategories?$filter={}",
        urlencoding::encode(&root_quoted)
    );

    let all_raw = list_values(&client, access_token, &all_path).await?;
    let roots_unquoted = list_values(&client, access_token, &roots_unquoted_path)
        .await
        .unwrap_or_default();
    let roots_quoted = list_values(&client, access_token, &roots_quoted_path)
        .await
        .unwrap_or_default();
    let admin_raw = if platform == SettingsCatalogPlatform::Windows {
        client
            .fetch_plain::<Value>(
                access_token,
                &format!(
                    "/deviceManagement/configurationCategories/{ADMINISTRATIVE_TEMPLATES_CATEGORY_ID}"
                ),
                "beta",
            )
            .await
            .ok()
    } else {
        None
    };

    Ok(merge_categories_by_id(vec![
        all_raw.iter().filter_map(map_catalog_category).collect(),
        roots_unquoted
            .iter()
            .filter_map(map_catalog_category)
            .collect(),
        roots_quoted
            .iter()
            .filter_map(map_catalog_category)
            .collect(),
        admin_raw
            .as_ref()
            .and_then(map_catalog_category)
            .map(|category| vec![category])
            .unwrap_or_default(),
    ])
    .into_iter()
    .filter(|category| category_applies_to_catalog_platform(category, platform))
    .collect())
}

pub async fn load_category_settings(
    access_token: &str,
    category_id: &str,
    platform: SettingsCatalogPlatform,
) -> Result<CategorySettingsLoad, GraphError> {
    let filter = settings_catalog_settings_by_category_graph_filter(platform, category_id);
    let path = format!(
        "/deviceManagement/configurationSettings?$filter={}",
        urlencoding::encode(&filter)
    );
    let raw = list_values(&GraphClient::new(), access_token, &path).await?;
    Ok(category_settings_from_rows(category_id, raw))
}

pub async fn search_catalog_settings(
    access_token: &str,
    query: &str,
    platform: SettingsCatalogPlatform,
) -> Result<CatalogSearchResult, GraphError> {
    let query = query.trim();
    if query.len() < 2 {
        return Ok(CatalogSearchResult {
            settings: vec![],
            mode: "empty".into(),
        });
    }

    let escaped = query.replace('\'', "''").to_lowercase();
    let applicability = settings_catalog_settings_applicability_graph_filter(platform);
    let select = "$select=id,displayName,name,description,helpText,categoryId,keywords,applicability,visibility,rootDefinitionId";
    let candidates = [
        (
            "displayName",
            format!("contains(tolower(displayName),'{escaped}') and {applicability}"),
        ),
        (
            "keywords",
            format!("keywords/any(k:contains(tolower(k),'{escaped}')) and {applicability}"),
        ),
        (
            "id",
            format!("contains(tolower(id),'{escaped}') and {applicability}"),
        ),
    ];

    let client = GraphClient::new();
    let mut by_id: HashMap<String, CatalogSettingSummary> = HashMap::new();
    let mut mode = "none".to_string();

    for (candidate_mode, filter) in candidates {
        let path = format!(
            "/deviceManagement/configurationSettings?{select}&$top={CATALOG_SEARCH_MAX}&$filter={}",
            urlencoding::encode(&filter)
        );
        match client
            .fetch_all_pages::<Value>(access_token, &path, "beta", CATALOG_SEARCH_MAX)
            .await
        {
            Ok(raw) => {
                let mut hits = 0usize;
                for row in raw {
                    if let Some(summary) = map_setting_summary(&row) {
                        if !summary.is_root {
                            continue;
                        }
                        if !by_id.contains_key(&summary.id) {
                            by_id.insert(summary.id.clone(), summary);
                            hits += 1;
                        }
                    }
                }
                if hits > 0 && mode == "none" {
                    mode = candidate_mode.to_string();
                }
                if candidate_mode == "displayName" && hits > 0 {
                    break;
                }
            }
            Err(_) => continue,
        }
    }

    let q = query.to_lowercase();
    let mut settings: Vec<CatalogSettingSummary> = by_id.into_values().collect();
    settings.sort_by(|a, b| {
        let rank = |name: &str| {
            let name = name.to_lowercase();
            if name == q {
                0
            } else if name.starts_with(&q) {
                1
            } else if name.contains(&q) {
                2
            } else {
                3
            }
        };
        rank(&a.display_name)
            .cmp(&rank(&b.display_name))
            .then_with(|| {
                a.display_name
                    .to_lowercase()
                    .cmp(&b.display_name.to_lowercase())
            })
    });
    settings.truncate(40);
    Ok(CatalogSearchResult {
        mode: if settings.is_empty() {
            "unsupported".into()
        } else {
            mode
        },
        settings,
    })
}

fn map_created_policy(
    value: &Value,
    fallback_name: &str,
) -> Result<CreatedCatalogPolicy, GraphError> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| GraphError::Request {
            status: 200,
            code: None,
            message: "Create succeeded but returned no policy id".into(),
            permission_related: false,
        })?;
    Ok(CreatedCatalogPolicy {
        id: id.to_string(),
        name: value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(fallback_name)
            .to_string(),
    })
}

fn setting_envelope(instance: &Value) -> Value {
    if instance.get("settingInstance").is_some() {
        let mut row = instance.clone();
        if row.get("@odata.type").is_none() {
            row["@odata.type"] = json!("#microsoft.graph.deviceManagementConfigurationSetting");
        }
        row
    } else {
        json!({
            "@odata.type": "#microsoft.graph.deviceManagementConfigurationSetting",
            "settingInstance": instance
        })
    }
}

fn is_group_setting_instance(instance: &Value) -> bool {
    instance.get("groupSettingCollectionValue").is_some()
        || instance.get("groupSettingValue").is_some()
}

fn group_instance_children(instance: &Value) -> Vec<Value> {
    if let Some(entries) = instance
        .get("groupSettingCollectionValue")
        .and_then(Value::as_array)
    {
        return entries
            .iter()
            .flat_map(|entry| {
                entry
                    .get("children")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
            })
            .collect();
    }
    instance
        .get("groupSettingValue")
        .and_then(|group| group.get("children"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn group_setting_value(children: Vec<Value>) -> Value {
    json!({
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingValue",
        "children": children
    })
}

fn merge_setting_instances(existing: Option<Value>, incoming: Value) -> Value {
    let Some(existing) = existing else {
        return incoming;
    };
    if !is_group_setting_instance(&existing) || !is_group_setting_instance(&incoming) {
        return incoming;
    }

    let mut by_id: HashMap<String, Value> = HashMap::new();
    let mut order = Vec::new();
    for child in group_instance_children(&existing)
        .into_iter()
        .chain(group_instance_children(&incoming))
    {
        let Some(id) = setting_definition_id(&child) else {
            continue;
        };
        if !by_id.contains_key(&id) {
            order.push(id.clone());
        }
        by_id.insert(id, child);
    }
    let children: Vec<Value> = order
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .collect();
    let definition_id = setting_definition_id(&incoming)
        .or_else(|| setting_definition_id(&existing))
        .unwrap_or_default();
    if existing.get("groupSettingCollectionValue").is_some()
        || incoming.get("groupSettingCollectionValue").is_some()
    {
        json!({
            "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
            "settingDefinitionId": definition_id,
            "groupSettingCollectionValue": [group_setting_value(children)],
        })
    } else {
        json!({
            "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingInstance",
            "settingDefinitionId": definition_id,
            "groupSettingValue": group_setting_value(children),
        })
    }
}

fn setting_definition_id(instance: &Value) -> Option<String> {
    instance
        .get("settingDefinitionId")
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub fn is_freeform_settings_catalog_policy(policy: &CatalogPolicySummary) -> bool {
    if policy
        .template_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return false;
    }
    match policy.template_family.as_deref().map(str::trim) {
        None | Some("") | Some("none") => true,
        Some(_) => false,
    }
}

pub fn policy_matches_catalog_platform(
    policy: &CatalogPolicySummary,
    platform: SettingsCatalogPlatform,
) -> bool {
    let normalized = policy
        .platforms
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match platform {
        SettingsCatalogPlatform::Macos => normalized.contains("macos") || normalized == "mac",
        SettingsCatalogPlatform::Windows => normalized.contains("windows"),
    }
}

pub async fn create_policy_with_settings(
    access_token: &str,
    name: &str,
    description: Option<&str>,
    platform: SettingsCatalogPlatform,
    settings: &[Value],
) -> Result<CreatedCatalogPolicy, GraphError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Policy name is required".into(),
            permission_related: false,
        });
    }
    if settings.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Intune requires at least one setting (1–5000) on a Settings Catalog policy."
                .into(),
            permission_related: false,
        });
    }

    let payload = json!({
        "name": name,
        "description": description.map(str::trim).filter(|value| !value.is_empty()),
        "platforms": platform.graph_platforms(),
        "technologies": platform.technologies_csv(),
        "roleScopeTagIds": ["0"],
        "settings": settings.iter().map(setting_envelope).collect::<Vec<_>>(),
    });

    let created: Value = GraphClient::new()
        .post(
            access_token,
            "/deviceManagement/configurationPolicies",
            "beta",
            &payload,
        )
        .await?;
    map_created_policy(&created, name)
}

pub async fn add_settings_to_policy(
    access_token: &str,
    policy_id: &str,
    settings: &[Value],
) -> Result<(), GraphError> {
    if settings.is_empty() {
        return Ok(());
    }
    let client = GraphClient::new();
    let policy: Value = client
        .fetch_plain(
            access_token,
            &format!(
                "/deviceManagement/configurationPolicies/{policy_id}?$select=id,name,description,platforms,technologies,roleScopeTagIds,templateReference"
            ),
            "beta",
        )
        .await?;

    let template_id = policy
        .get("templateReference")
        .and_then(as_object)
        .and_then(|reference| string_field(reference, "templateId"));

    let existing = list_values(
        &client,
        access_token,
        &format!("/deviceManagement/configurationPolicies/{policy_id}/settings"),
    )
    .await?;

    let mut by_definition: HashMap<String, Value> = HashMap::new();
    let mut order = Vec::new();
    for row in existing {
        let Some(instance) = row.get("settingInstance") else {
            continue;
        };
        let Some(id) = setting_definition_id(instance) else {
            continue;
        };
        if !by_definition.contains_key(&id) {
            order.push(id.clone());
        }
        by_definition.insert(id, instance.clone());
    }

    let existing_ids: HashSet<String> = by_definition.keys().cloned().collect();

    for setting in settings {
        let instance = setting
            .get("settingInstance")
            .cloned()
            .unwrap_or_else(|| setting.clone());
        let Some(id) = setting_definition_id(&instance) else {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "Each setting instance requires a settingDefinitionId.".into(),
                permission_related: false,
            });
        };
        if template_id.is_some() && !existing_ids.contains(&id) {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "Cannot add catalog settings that are not already on this template-backed policy. Edit existing values here, or use a freeform Settings Catalog policy to add settings.".into(),
                permission_related: false,
            });
        }
        if !by_definition.contains_key(&id) {
            order.push(id.clone());
        }
        let merged = merge_setting_instances(by_definition.get(&id).cloned(), instance);
        by_definition.insert(id, merged);
    }

    let merged: Vec<Value> = order
        .into_iter()
        .filter_map(|id| by_definition.remove(&id))
        .collect();
    replace_configuration_policy_settings(&client, access_token, policy_id, &policy, merged).await
}

pub async fn remove_settings_from_policy(
    access_token: &str,
    policy_id: &str,
    definition_ids: &[String],
) -> Result<(), GraphError> {
    let remove: HashSet<String> = definition_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    if remove.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Select at least one setting to remove.".into(),
            permission_related: false,
        });
    }
    let client = GraphClient::new();
    let policy: Value = client
        .fetch_plain(
            access_token,
            &format!(
                "/deviceManagement/configurationPolicies/{policy_id}?$select=id,name,description,platforms,technologies,roleScopeTagIds,templateReference"
            ),
            "beta",
        )
        .await?;

    let template_id = policy
        .get("templateReference")
        .and_then(as_object)
        .and_then(|reference| string_field(reference, "templateId"));
    if template_id.is_some() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Cannot remove settings from a template-backed policy. Duplicate it as a freeform Settings Catalog policy first.".into(),
            permission_related: false,
        });
    }

    let existing = list_values(
        &client,
        access_token,
        &format!("/deviceManagement/configurationPolicies/{policy_id}/settings"),
    )
    .await?;
    let (kept, removed) = instances_without_definitions(&existing, &remove);
    if removed == 0 {
        return Err(GraphError::Request {
            status: 404,
            code: None,
            message: "That setting is not on this policy.".into(),
            permission_related: false,
        });
    }
    replace_configuration_policy_settings(&client, access_token, policy_id, &policy, kept).await
}

fn instances_without_definitions(
    existing: &[Value],
    remove: &HashSet<String>,
) -> (Vec<Value>, usize) {
    let mut kept = Vec::new();
    let mut removed = 0;
    for row in existing {
        let Some(instance) = row.get("settingInstance") else {
            continue;
        };
        let Some(id) = setting_definition_id(instance) else {
            continue;
        };
        if remove.contains(&id) {
            removed += 1;
            continue;
        }
        kept.push(instance.clone());
    }
    (kept, removed)
}

async fn replace_configuration_policy_settings(
    client: &GraphClient,
    access_token: &str,
    policy_id: &str,
    policy: &Value,
    instances: Vec<Value>,
) -> Result<(), GraphError> {
    if instances.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Intune requires at least one setting on a Settings Catalog policy.".into(),
            permission_related: false,
        });
    }

    let payload = json!({
        "name": policy.get("name").and_then(Value::as_str).unwrap_or("Settings Catalog policy"),
        "description": policy.get("description").and_then(Value::as_str).unwrap_or(""),
        "platforms": policy.get("platforms").cloned().unwrap_or(json!("windows10")),
        "technologies": policy.get("technologies").cloned().unwrap_or(json!("mdm")),
        "roleScopeTagIds": policy.get("roleScopeTagIds").cloned().unwrap_or(json!(["0"])),
        "settings": instances.iter().map(setting_envelope).collect::<Vec<_>>(),
    });

    client
        .put_empty(
            access_token,
            &format!("/deviceManagement/configurationPolicies/{policy_id}"),
            "beta",
            &payload,
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_removed_setting_instances() {
        let existing = vec![
            json!({ "settingInstance": { "settingDefinitionId": "keep" } }),
            json!({ "settingInstance": { "settingDefinitionId": "drop" } }),
            json!({ "id": "orphan" }),
        ];
        let remove = HashSet::from(["drop".into()]);
        let (kept, removed) = instances_without_definitions(&existing, &remove);
        assert_eq!(removed, 1);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0]["settingDefinitionId"], "keep");
    }

    fn windows_root(id: &str, name: &str, children: Vec<&str>) -> CatalogCategory {
        CatalogCategory {
            id: id.into(),
            display_name: name.into(),
            description: None,
            child_category_ids: children.into_iter().map(str::to_string).collect(),
            parent_category_id: Some(NIL_CATEGORY_PARENT_ID.into()),
            root_category_id: Some(id.into()),
            platforms: Some("windows10".into()),
            technologies: Some("mdm".into()),
            setting_usage: None,
        }
    }

    #[test]
    fn macos_filters_match_portal() {
        let macos_edge = settings_catalog_settings_by_category_graph_filter(
            SettingsCatalogPlatform::Macos,
            MACOS_MICROSOFT_EDGE_CATEGORY_ID,
        );
        assert_eq!(
            macos_edge,
            format!(
                "categoryId eq '{MACOS_MICROSOFT_EDGE_CATEGORY_ID}' and visibility has 'settingsCatalog' and (applicability/platform has 'macOS') and (applicability/technologies has 'mdm' or applicability/technologies has 'appleRemoteManagement')"
            )
        );
        assert_eq!(
            settings_catalog_category_graph_filter(SettingsCatalogPlatform::Macos),
            "(platforms has 'macOS') and (technologies has 'mdm' or technologies has 'appleRemoteManagement')"
        );
        assert_eq!(
            SettingsCatalogPlatform::Macos.technologies_csv(),
            "mdm,appleRemoteManagement"
        );
    }

    #[test]
    fn windows_filters_match_portal() {
        let windows_laps = settings_catalog_settings_by_category_graph_filter(
            SettingsCatalogPlatform::Windows,
            "b3b2fc04-4b88-4a1c-8370-04573019eebe",
        );
        assert_eq!(
            windows_laps,
            "categoryId eq 'b3b2fc04-4b88-4a1c-8370-04573019eebe' and visibility has 'settingsCatalog' and (applicability/platform has 'windows10') and (applicability/technologies has 'mdm')"
        );
        assert_eq!(SettingsCatalogPlatform::Windows.technologies_csv(), "mdm");
    }

    #[test]
    fn synthetic_group_ids() {
        assert!(is_synthetic_top_level_group_id(
            "com.apple.airplay_com.apple.airplay"
        ));
        assert!(is_synthetic_top_level_group_id(
            "com.apple.mcx_com.apple.mcx-accounts"
        ));
        assert!(!is_synthetic_top_level_group_id(
            "com.apple.airplay_allowlist"
        ));
    }

    #[test]
    fn merges_apple_group_children() {
        let existing = json!({
            "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
            "settingDefinitionId": "com.apple.mcx_com.apple.mcx-accounts",
            "groupSettingCollectionValue": [{
                "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingValue",
                "children": [{
                    "settingDefinitionId": "com.apple.mcx_enableguestaccount",
                    "simpleSettingValue": { "value": true }
                }]
            }]
        });
        let incoming = json!({
            "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
            "settingDefinitionId": "com.apple.mcx_com.apple.mcx-accounts",
            "groupSettingCollectionValue": [{
                "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingValue",
                "children": [{
                    "settingDefinitionId": "com.apple.mcx_autologinclient",
                    "simpleSettingValue": { "value": false }
                }]
            }]
        });
        let merged = merge_setting_instances(Some(existing), incoming);
        let children = group_instance_children(&merged);
        assert_eq!(children.len(), 2);
        let ids: Vec<_> = children
            .iter()
            .filter_map(setting_definition_id)
            .collect();
        assert!(ids.contains(&"com.apple.mcx_enableguestaccount".to_string()));
        assert!(ids.contains(&"com.apple.mcx_autologinclient".to_string()));
    }

    #[test]
    fn drops_mam_edge_on_macos() {
        let mam = CatalogCategory {
            id: "mam-edge".into(),
            display_name: "Microsoft Edge".into(),
            description: None,
            child_category_ids: vec!["cast".into()],
            parent_category_id: Some(NIL_CATEGORY_PARENT_ID.into()),
            root_category_id: None,
            platforms: Some("macOS".into()),
            technologies: Some("mdm,mobileApplicationManagement".into()),
            setting_usage: None,
        };
        assert!(!category_applies_to_catalog_platform(
            &mam,
            SettingsCatalogPlatform::Macos
        ));
        assert!(category_applies_to_catalog_platform(
            &mam,
            SettingsCatalogPlatform::Windows
        ));
    }

    #[test]
    fn unwraps_synthetic_wrapper() {
        let wrapper_id = "com.apple.applicationaccess_com.apple.applicationaccess";
        let camera_id = "com.apple.applicationaccess_allowcamera";
        let safari_id = "com.apple.applicationaccess_allowsafari";
        let loaded = category_settings_from_rows(
            "macos-restrictions",
            vec![
                json!({
                    "id": wrapper_id,
                    "displayName": "Top Level Setting Group Collection",
                    "categoryId": "macos-restrictions",
                    "rootDefinitionId": wrapper_id,
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSettingGroupCollectionDefinition",
                    "applicability": {
                        "platform": "macOS",
                        "technologies": "mdm,appleRemoteManagement"
                    },
                    "dependedOnBy": [
                        { "dependedOnBy": camera_id },
                        { "dependedOnBy": safari_id }
                    ]
                }),
                json!({
                    "id": camera_id,
                    "displayName": "Allow Camera",
                    "categoryId": "macos-restrictions",
                    "rootDefinitionId": wrapper_id,
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingDefinition",
                    "applicability": {
                        "platform": "macOS",
                        "technologies": "mdm,appleRemoteManagement"
                    }
                }),
                json!({
                    "id": safari_id,
                    "displayName": "Allow Safari",
                    "categoryId": "macos-restrictions",
                    "rootDefinitionId": wrapper_id,
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingDefinition",
                    "applicability": {
                        "platform": "macOS",
                        "technologies": "mdm,appleRemoteManagement"
                    }
                }),
            ],
        );
        assert!(loaded.roots.iter().all(|row| row.summary.id != wrapper_id));
        assert_eq!(loaded.roots.len(), 2);
        assert!(loaded
            .roots
            .iter()
            .any(|row| row.summary.display_name == "Allow Camera"));
    }

    #[test]
    fn parent_categories_are_roots() {
        let categories = vec![
            windows_root(WINDOWS_MICROSOFT_EDGE_CATEGORY_ID, "Microsoft Edge", vec![]),
            windows_root(
                ADMINISTRATIVE_TEMPLATES_CATEGORY_ID,
                "Administrative Templates",
                vec!["child"],
            ),
            CatalogCategory {
                id: "child".into(),
                display_name: "Logon".into(),
                description: None,
                child_category_ids: vec![],
                parent_category_id: Some(ADMINISTRATIVE_TEMPLATES_CATEGORY_ID.into()),
                root_category_id: Some(ADMINISTRATIVE_TEMPLATES_CATEGORY_ID.into()),
                platforms: Some("windows10".into()),
                technologies: Some("mdm".into()),
                setting_usage: None,
            },
        ];
        let roots = root_catalog_categories(&categories);
        assert!(roots
            .iter()
            .any(|category| category.id == WINDOWS_MICROSOFT_EDGE_CATEGORY_ID));
        assert!(roots
            .iter()
            .any(|category| category.id == ADMINISTRATIVE_TEMPLATES_CATEGORY_ID));
        assert!(roots.iter().all(|category| category.id != "child"));
    }
}
