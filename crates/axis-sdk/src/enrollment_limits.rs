//! Create / update Graph device enrolment limit configurations.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::graph::{GraphClient, GraphError};
use crate::inventory::CatalogPolicySummary;

/// Portal-documented range for Intune device limit restrictions.
pub const DEVICE_LIMIT_MIN: i32 = 1;
pub const DEVICE_LIMIT_MAX: i32 = 15;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEnrollmentLimitInput {
    pub id: String,
    /// Graph `@odata.type` from the live object (required for PATCH).
    pub odata_type: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Maximum devices a user may enrol (1–15).
    pub limit: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnrollmentLimitInput {
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Maximum devices a user may enrol (1–15).
    pub limit: i32,
    #[serde(default)]
    pub priority: Option<i32>,
    #[serde(default)]
    pub role_scope_tag_ids: Option<Vec<String>>,
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

fn validate_limit(limit: i32) -> Result<(), GraphError> {
    if (DEVICE_LIMIT_MIN..=DEVICE_LIMIT_MAX).contains(&limit) {
        Ok(())
    } else {
        Err(GraphError::Request {
            status: 400,
            code: None,
            message: format!(
                "Device limit must be between {DEVICE_LIMIT_MIN} and {DEVICE_LIMIT_MAX}."
            ),
            permission_related: false,
        })
    }
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
        message: "Graph created the enrollment limit but did not return an id.".into(),
        permission_related: false,
    })?;
    let name = string_field(value, "displayName")
        .or_else(|| string_field(value, "name"))
        .unwrap_or_else(|| "Enrollment device limit".to_string());
    let priority = value
        .get("priority")
        .and_then(Value::as_i64)
        .and_then(|n| i32::try_from(n).ok());
    let limit = value
        .get("limit")
        .and_then(Value::as_i64)
        .and_then(|n| u32::try_from(n).ok());
    Ok(CatalogPolicySummary {
        id,
        name,
        description: string_field(value, "description"),
        platforms: None,
        technologies: None,
        setting_count: limit,
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

pub fn enrollment_limit_patch_body(input: &UpdateEnrollmentLimitInput) -> Result<Value, GraphError> {
    validate_limit(input.limit)?;
    let odata_type = normalize_odata_type(&input.odata_type)?;
    if !odata_type
        .to_ascii_lowercase()
        .contains("deviceenrollmentlimitconfiguration")
    {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: format!("Unsupported enrollment limit @odata.type: {odata_type}"),
            permission_related: false,
        });
    }
    let mut body = json!({
        "@odata.type": odata_type,
        "limit": input.limit,
    });
    if let Some(name) = input
        .display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        body["displayName"] = Value::String(name.to_string());
    }
    if let Some(description) = &input.description {
        body["description"] = Value::String(description.trim().to_string());
    }
    Ok(body)
}

pub fn create_enrollment_limit_body(input: &CreateEnrollmentLimitInput) -> Result<Value, GraphError> {
    validate_limit(input.limit)?;
    let display_name = input.display_name.trim();
    if display_name.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Display name is required.".into(),
            permission_related: false,
        });
    }
    let mut body = json!({
        "@odata.type": "#microsoft.graph.deviceEnrollmentLimitConfiguration",
        "displayName": display_name,
        "deviceEnrollmentConfigurationType": "limit",
        "limit": input.limit,
    });
    if let Some(description) = input
        .description
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        body["description"] = Value::String(description.to_string());
    }
    if let Some(priority) = input.priority {
        body["priority"] = json!(priority);
    }
    if let Some(tags) = &input.role_scope_tag_ids {
        body["roleScopeTagIds"] = json!(tags);
    }
    Ok(body)
}

pub async fn update_enrollment_limit(
    access_token: &str,
    input: UpdateEnrollmentLimitInput,
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
    let body = enrollment_limit_patch_body(&input)?;
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

pub async fn create_enrollment_limit(
    access_token: &str,
    input: CreateEnrollmentLimitInput,
) -> Result<CatalogPolicySummary, GraphError> {
    let body = create_enrollment_limit_body(&input)?;
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
    fn patch_body_includes_limit() {
        let body = enrollment_limit_patch_body(&UpdateEnrollmentLimitInput {
            id: "x_DefaultLimit".into(),
            odata_type: "#microsoft.graph.deviceEnrollmentLimitConfiguration".into(),
            display_name: None,
            description: None,
            limit: 5,
        })
        .unwrap();
        assert_eq!(
            body["@odata.type"],
            "#microsoft.graph.deviceEnrollmentLimitConfiguration"
        );
        assert_eq!(body["limit"], 5);
    }

    #[test]
    fn create_body_sets_limit_type() {
        let body = create_enrollment_limit_body(&CreateEnrollmentLimitInput {
            display_name: "Pilot users".into(),
            description: Some("Cap at 3".into()),
            limit: 3,
            priority: None,
            role_scope_tag_ids: None,
        })
        .unwrap();
        assert_eq!(
            body["@odata.type"],
            "#microsoft.graph.deviceEnrollmentLimitConfiguration"
        );
        assert_eq!(body["deviceEnrollmentConfigurationType"], "limit");
        assert_eq!(body["limit"], 3);
        assert_eq!(body["displayName"], "Pilot users");
    }

    #[test]
    fn rejects_out_of_range_limit() {
        assert!(enrollment_limit_patch_body(&UpdateEnrollmentLimitInput {
            id: "x".into(),
            odata_type: "#microsoft.graph.deviceEnrollmentLimitConfiguration".into(),
            display_name: None,
            description: None,
            limit: 16,
        })
        .is_err());
        assert!(create_enrollment_limit_body(&CreateEnrollmentLimitInput {
            display_name: "x".into(),
            description: None,
            limit: 0,
            priority: None,
            role_scope_tag_ids: None,
        })
        .is_err());
    }
}
