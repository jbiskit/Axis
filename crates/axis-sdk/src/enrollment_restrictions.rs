//! Update Graph device enrolment platform restrictions.

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::graph::{GraphClient, GraphError};
use crate::inventory::CatalogPolicySummary;

const MULTI_PLATFORM_KEYS: &[&str] = &[
    "windowsRestriction",
    "windowsHomeSkuRestriction",
    "windowsMobileRestriction",
    "iosRestriction",
    "androidRestriction",
    "androidForWorkRestriction",
    "macOSRestriction",
    "macRestriction",
    "visionOSRestriction",
    "tvosRestriction",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformRestrictionPatch {
    #[serde(default)]
    pub platform_blocked: Option<bool>,
    #[serde(default)]
    pub personal_device_enrollment_blocked: Option<bool>,
    #[serde(default)]
    pub os_minimum_version: Option<String>,
    #[serde(default)]
    pub os_maximum_version: Option<String>,
    #[serde(default)]
    pub blocked_manufacturers: Option<Vec<String>>,
    #[serde(default)]
    pub blocked_skus: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEnrollmentPlatformRestrictionsInput {
    pub id: String,
    /// Graph `@odata.type` from the live object (required for PATCH).
    pub odata_type: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Multi-platform default: map of Graph property → restriction blob.
    #[serde(default)]
    pub restrictions: Option<Map<String, Value>>,
    /// Single-platform override.
    #[serde(default)]
    pub platform_restriction: Option<PlatformRestrictionPatch>,
    #[serde(default)]
    pub platform_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnrollmentPlatformRestrictionInput {
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Graph platformType for a single-platform restriction.
    pub platform_type: String,
    /// Optional priority hint; Graph may normalize ordering server-side.
    #[serde(default)]
    pub priority: Option<i32>,
    #[serde(default)]
    pub role_scope_tag_ids: Option<Vec<String>>,
    pub platform_restriction: PlatformRestrictionPatch,
}

fn normalize_odata_type(raw: &str) -> Result<String, GraphError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Enrollment configuration @odata.type is required.".into(),
            permission_related: false,
        });
    }
    if trimmed.starts_with('#') {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("#{trimmed}"))
    }
}

fn empty_to_null_string(value: Option<String>) -> Value {
    match value.map(|s| s.trim().to_string()) {
        Some(s) if !s.is_empty() => Value::String(s),
        _ => Value::Null,
    }
}

fn restriction_value(patch: &PlatformRestrictionPatch) -> Value {
    let mut body = Map::new();
    body.insert(
        "@odata.type".into(),
        Value::String("microsoft.graph.deviceEnrollmentPlatformRestriction".into()),
    );
    if let Some(v) = patch.platform_blocked {
        body.insert("platformBlocked".into(), Value::Bool(v));
    }
    if let Some(v) = patch.personal_device_enrollment_blocked {
        body.insert("personalDeviceEnrollmentBlocked".into(), Value::Bool(v));
    }
    body.insert(
        "osMinimumVersion".into(),
        empty_to_null_string(patch.os_minimum_version.clone()),
    );
    body.insert(
        "osMaximumVersion".into(),
        empty_to_null_string(patch.os_maximum_version.clone()),
    );
    if let Some(list) = &patch.blocked_manufacturers {
        body.insert(
            "blockedManufacturers".into(),
            Value::Array(
                list.iter()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| Value::String(s.to_string()))
                    .collect(),
            ),
        );
    }
    if let Some(list) = &patch.blocked_skus {
        body.insert(
            "blockedSkus".into(),
            Value::Array(
                list.iter()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| Value::String(s.to_string()))
                    .collect(),
            ),
        );
    }
    Value::Object(body)
}

fn parse_restriction_map(map: &Map<String, Value>) -> Result<Map<String, Value>, GraphError> {
    let mut out = Map::new();
    for (key, value) in map {
        if !MULTI_PLATFORM_KEYS.contains(&key.as_str()) {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: format!("Unknown platform restriction property: {key}"),
                permission_related: false,
            });
        }
        let patch: PlatformRestrictionPatch =
            serde_json::from_value(value.clone()).map_err(|error| GraphError::Request {
                status: 400,
                code: None,
                message: format!("Invalid {key}: {error}"),
                permission_related: false,
            })?;
        out.insert(key.clone(), restriction_value(&patch));
    }
    Ok(out)
}

pub fn enrollment_platform_restrictions_patch_body(
    input: &UpdateEnrollmentPlatformRestrictionsInput,
) -> Result<Value, GraphError> {
    let odata_type = normalize_odata_type(&input.odata_type)?;
    let mut body = json!({ "@odata.type": odata_type });
    let obj = body.as_object_mut().expect("object");

    if let Some(name) = input
        .display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        obj.insert("displayName".into(), Value::String(name.to_string()));
    }
    if let Some(description) = &input.description {
        obj.insert(
            "description".into(),
            Value::String(description.trim().to_string()),
        );
    }

    let is_single = odata_type.contains("deviceEnrollmentPlatformRestrictionConfiguration")
        && !odata_type.contains("deviceEnrollmentPlatformRestrictionsConfiguration");

    if is_single {
        let Some(patch) = &input.platform_restriction else {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "platformRestriction is required for single-platform configs.".into(),
                permission_related: false,
            });
        };
        obj.insert("platformRestriction".into(), restriction_value(patch));
        if let Some(platform_type) = input
            .platform_type
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            obj.insert("platformType".into(), Value::String(platform_type.to_string()));
        }
    } else {
        let Some(map) = &input.restrictions else {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "restrictions map is required for multi-platform configs.".into(),
                permission_related: false,
            });
        };
        if map.is_empty() {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "At least one platform restriction is required.".into(),
                permission_related: false,
            });
        }
        for (key, value) in parse_restriction_map(map)? {
            obj.insert(key, value);
        }
    }

    Ok(body)
}

pub async fn update_enrollment_platform_restrictions(
    access_token: &str,
    input: UpdateEnrollmentPlatformRestrictionsInput,
) -> Result<(), GraphError> {
    let id = input.id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Enrollment configuration id is required.".into(),
            permission_related: false,
        });
    }
    let body = enrollment_platform_restrictions_patch_body(&input)?;
    let enc = urlencoding::encode(id);
    GraphClient::new()
        .patch_no_content(
            access_token,
            &format!("/deviceManagement/deviceEnrollmentConfigurations/{enc}"),
            "beta",
            &body,
        )
        .await
}

fn string_field(object: &Value, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn summary_from_created(value: &Value) -> Result<CatalogPolicySummary, GraphError> {
    let id = string_field(value, "id").ok_or_else(|| GraphError::Request {
        status: 502,
        code: None,
        message: "Graph created the enrollment restriction but did not return an id.".into(),
        permission_related: false,
    })?;
    let name = string_field(value, "displayName")
        .or_else(|| string_field(value, "name"))
        .unwrap_or_else(|| "Enrollment platform restriction".to_string());
    let priority = value
        .get("priority")
        .and_then(Value::as_i64)
        .and_then(|n| i32::try_from(n).ok());
    Ok(CatalogPolicySummary {
        id,
        name,
        description: string_field(value, "description"),
        platforms: string_field(value, "platformType"),
        technologies: None,
        setting_count: None,
        created_date_time: string_field(value, "createdDateTime"),
        last_modified_date_time: string_field(value, "lastModifiedDateTime"),
        is_assigned: value
            .get("assignments")
            .and_then(Value::as_array)
            .map(|rows| !rows.is_empty())
            .or(Some(false)),
        template_family: None,
        template_id: None,
        template_display_name: None,
        odata_type: string_field(value, "@odata.type"),
        priority,
    })
}

pub fn create_enrollment_platform_restriction_body(
    input: &CreateEnrollmentPlatformRestrictionInput,
) -> Result<Value, GraphError> {
    let display_name = input.display_name.trim();
    if display_name.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Display name is required.".into(),
            permission_related: false,
        });
    }
    let platform_type = input.platform_type.trim();
    if platform_type.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "platformType is required.".into(),
            permission_related: false,
        });
    }
    let mut body = json!({
        "@odata.type": "#microsoft.graph.deviceEnrollmentPlatformRestrictionConfiguration",
        "displayName": display_name,
        "deviceEnrollmentConfigurationType": "singlePlatformRestriction",
        "platformType": platform_type,
        "platformRestriction": restriction_value(&input.platform_restriction),
    });
    let obj = body.as_object_mut().expect("create body");
    if let Some(description) = &input.description {
        obj.insert(
            "description".into(),
            Value::String(description.trim().to_string()),
        );
    }
    if let Some(priority) = input.priority {
        obj.insert("priority".into(), Value::Number(priority.into()));
    }
    if let Some(tags) = &input.role_scope_tag_ids {
        obj.insert(
            "roleScopeTagIds".into(),
            Value::Array(tags.iter().map(|t| Value::String(t.to_string())).collect()),
        );
    }
    Ok(body)
}

pub async fn create_enrollment_platform_restriction(
    access_token: &str,
    input: CreateEnrollmentPlatformRestrictionInput,
) -> Result<CatalogPolicySummary, GraphError> {
    let body = create_enrollment_platform_restriction_body(&input)?;
    let created: Value = GraphClient::new()
        .post(
            access_token,
            "/deviceManagement/deviceEnrollmentConfigurations",
            "beta",
            &body,
        )
        .await?;
    summary_from_created(&created)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multi_platform_patch_includes_windows_blob() {
        let mut restrictions = Map::new();
        restrictions.insert(
            "windowsRestriction".into(),
            json!({
                "platformBlocked": false,
                "personalDeviceEnrollmentBlocked": true,
                "osMinimumVersion": "",
                "osMaximumVersion": null
            }),
        );
        let body = enrollment_platform_restrictions_patch_body(&UpdateEnrollmentPlatformRestrictionsInput {
            id: "x_DefaultPlatformRestrictions".into(),
            odata_type: "#microsoft.graph.deviceEnrollmentPlatformRestrictionsConfiguration"
                .into(),
            display_name: None,
            description: None,
            restrictions: Some(restrictions),
            platform_restriction: None,
            platform_type: None,
        })
        .unwrap();
        assert_eq!(
            body["@odata.type"],
            "#microsoft.graph.deviceEnrollmentPlatformRestrictionsConfiguration"
        );
        assert_eq!(body["windowsRestriction"]["platformBlocked"], false);
        assert_eq!(
            body["windowsRestriction"]["personalDeviceEnrollmentBlocked"],
            true
        );
        assert!(body["windowsRestriction"]["osMinimumVersion"].is_null());
    }

    #[test]
    fn single_platform_patch_uses_platform_restriction() {
        let body = enrollment_platform_restrictions_patch_body(&UpdateEnrollmentPlatformRestrictionsInput {
            id: "x_SinglePlatformRestriction".into(),
            odata_type: "#microsoft.graph.deviceEnrollmentPlatformRestrictionConfiguration".into(),
            display_name: Some("Restrict Personal".into()),
            description: None,
            restrictions: None,
            platform_restriction: Some(PlatformRestrictionPatch {
                platform_blocked: Some(false),
                personal_device_enrollment_blocked: Some(true),
                os_minimum_version: None,
                os_maximum_version: None,
                blocked_manufacturers: Some(vec![]),
                blocked_skus: Some(vec![]),
            }),
            platform_type: Some("windows".into()),
        })
        .unwrap();
        assert_eq!(body["platformType"], "windows");
        assert_eq!(body["platformRestriction"]["personalDeviceEnrollmentBlocked"], true);
        assert_eq!(body["displayName"], "Restrict Personal");
    }

    #[test]
    fn single_platform_create_body_sets_graph_shape() {
        let body =
            create_enrollment_platform_restriction_body(&CreateEnrollmentPlatformRestrictionInput {
                display_name: "Restrict Personal Device Enrolment (Windows)".into(),
                description: Some("Created from Axis".into()),
                platform_type: "windows".into(),
                priority: Some(5),
                role_scope_tag_ids: Some(vec!["0".into()]),
                platform_restriction: PlatformRestrictionPatch {
                    platform_blocked: Some(false),
                    personal_device_enrollment_blocked: Some(true),
                    os_minimum_version: None,
                    os_maximum_version: None,
                    blocked_manufacturers: Some(vec![]),
                    blocked_skus: Some(vec![]),
                },
            })
            .unwrap();
        assert_eq!(
            body["@odata.type"],
            "#microsoft.graph.deviceEnrollmentPlatformRestrictionConfiguration"
        );
        assert_eq!(
            body["deviceEnrollmentConfigurationType"],
            "singlePlatformRestriction"
        );
        assert_eq!(body["platformType"], "windows");
        assert_eq!(body["priority"], 5);
        assert_eq!(body["platformRestriction"]["personalDeviceEnrollmentBlocked"], true);
    }
}
