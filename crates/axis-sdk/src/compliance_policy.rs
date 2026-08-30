use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::graph::{GraphClient, GraphError};
use crate::inventory::CatalogPolicySummary;

const COLLECTION: &str = "/deviceManagement/deviceCompliancePolicies";

const WINDOWS_SETTING_KEYS: &[&str] = &[
    "bitLockerEnabled",
    "secureBootEnabled",
    "codeIntegrityEnabled",
    "tpmRequired",
    "activeFirewallRequired",
    "defenderEnabled",
    "antivirusRequired",
    "antiSpywareRequired",
];

const MACOS_SETTING_KEYS: &[&str] = &[
    "passwordRequired",
    "systemIntegrityProtectionEnabled",
    "firewallEnabled",
    "storageRequireEncryption",
];

const IOS_SETTING_KEYS: &[&str] = &[
    "passcodeRequired",
    "passcodeBlockSimple",
    "securityBlockJailbrokenDevices",
];

const ANDROID_DEVICE_OWNER_SETTING_KEYS: &[&str] = &[
    "passwordRequired",
    "storageRequireEncryption",
    "securityRequireSafetyNetAttestationBasicIntegrity",
];

const ANDROID_WORK_PROFILE_SETTING_KEYS: &[&str] = &[
    "passwordRequired",
    "storageRequireEncryption",
];

const ANDROID_AOSP_SETTING_KEYS: &[&str] = &["passwordRequired", "storageRequireEncryption"];

const ANDROID_DEVICE_ADMIN_SETTING_KEYS: &[&str] = &[
    "passwordRequired",
    "storageRequireEncryption",
    "securityBlockJailbrokenDevices",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompliancePolicyKind {
    pub slug: &'static str,
    pub odata_type: &'static str,
    pub platforms: &'static str,
}

const KINDS: &[CompliancePolicyKind] = &[
    CompliancePolicyKind {
        slug: "windows",
        odata_type: "#microsoft.graph.windows10CompliancePolicy",
        platforms: "windows",
    },
    CompliancePolicyKind {
        slug: "macos",
        odata_type: "#microsoft.graph.macOSCompliancePolicy",
        platforms: "macos",
    },
    CompliancePolicyKind {
        slug: "ios",
        odata_type: "#microsoft.graph.iosCompliancePolicy",
        platforms: "ios",
    },
    CompliancePolicyKind {
        slug: "androidDeviceOwner",
        odata_type: "#microsoft.graph.androidDeviceOwnerCompliancePolicy",
        platforms: "android",
    },
    CompliancePolicyKind {
        slug: "androidWorkProfile",
        odata_type: "#microsoft.graph.androidWorkProfileCompliancePolicy",
        platforms: "android",
    },
    CompliancePolicyKind {
        slug: "androidAosp",
        odata_type: "#microsoft.graph.aospDeviceOwnerCompliancePolicy",
        platforms: "android",
    },
    CompliancePolicyKind {
        slug: "androidDeviceAdmin",
        odata_type: "#microsoft.graph.androidCompliancePolicy",
        platforms: "android",
    },
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCompliancePolicyInput {
    pub platform: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub grace_period_hours: Option<u32>,
    #[serde(default)]
    pub settings: Map<String, Value>,
}

pub fn compliance_kind(slug: &str) -> Result<&'static CompliancePolicyKind, GraphError> {
    KINDS
        .iter()
        .find(|kind| kind.slug.eq_ignore_ascii_case(slug.trim()))
        .ok_or_else(|| GraphError::Request {
            status: 400,
            code: None,
            message: format!(
                "Unknown compliance platform '{slug}'. Use windows, macos, ios, androidDeviceOwner, androidWorkProfile, androidAosp, or androidDeviceAdmin."
            ),
            permission_related: false,
        })
}

pub fn platforms_from_compliance_odata(odata_type: Option<&str>) -> Option<String> {
    let needle = odata_type?
        .trim()
        .trim_start_matches('#')
        .to_ascii_lowercase();
    if needle.contains("windows") {
        Some("windows".into())
    } else if needle.contains("macos") {
        Some("macos".into())
    } else if needle.contains("ios") {
        Some("ios".into())
    } else if needle.contains("android") || needle.contains("aosp") {
        Some("android".into())
    } else {
        None
    }
}

fn allowed_setting_keys(kind: &CompliancePolicyKind) -> &'static [&'static str] {
    match kind.slug {
        "windows" => WINDOWS_SETTING_KEYS,
        "macos" => MACOS_SETTING_KEYS,
        "ios" => IOS_SETTING_KEYS,
        "androidDeviceOwner" => ANDROID_DEVICE_OWNER_SETTING_KEYS,
        "androidWorkProfile" => ANDROID_WORK_PROFILE_SETTING_KEYS,
        "androidAosp" => ANDROID_AOSP_SETTING_KEYS,
        "androidDeviceAdmin" => ANDROID_DEVICE_ADMIN_SETTING_KEYS,
        _ => &[],
    }
}

fn default_scheduled_actions(grace_period_hours: u32) -> Value {
    json!([
        {
            "@odata.type": "#microsoft.graph.deviceComplianceScheduledActionForRule",
            "ruleName": "PasswordRequired",
            "scheduledActionConfigurations": [
                {
                    "@odata.type": "#microsoft.graph.deviceComplianceActionItem",
                    "actionType": "block",
                    "gracePeriodHours": grace_period_hours,
                    "notificationTemplateId": "",
                    "notificationMessageCCList": []
                }
            ]
        }
    ])
}

pub fn compliance_create_body(input: &CreateCompliancePolicyInput) -> Result<Value, GraphError> {
    let kind = compliance_kind(&input.platform)?;
    let display_name = input.display_name.trim();
    if display_name.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Display name is required.".into(),
            permission_related: false,
        });
    }
    let description = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let grace = input.grace_period_hours.unwrap_or(0);

    let mut body = json!({
        "@odata.type": kind.odata_type,
        "displayName": display_name,
        "roleScopeTagIds": ["0"],
        "scheduledActionsForRule": default_scheduled_actions(grace),
    });
    let object = body.as_object_mut().expect("json object");
    if let Some(description) = description {
        object.insert("description".into(), json!(description));
    }
    for key in allowed_setting_keys(kind) {
        let Some(value) = input.settings.get(*key) else {
            continue;
        };
        if value.as_bool() != Some(true) {
            continue;
        }
        object.insert((*key).into(), json!(true));
    }
    Ok(body)
}

fn summary_from_created(
    kind: &CompliancePolicyKind,
    object: &Value,
    fallback_name: &str,
) -> Result<CatalogPolicySummary, GraphError> {
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| GraphError::Request {
            status: 502,
            code: None,
            message: "Graph created the compliance policy but did not return an id.".into(),
            permission_related: false,
        })?;
    Ok(CatalogPolicySummary {
        id: id.to_string(),
        name: object
            .get("displayName")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or(fallback_name)
            .to_string(),
        description: object
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        platforms: Some(kind.platforms.to_string()),
        technologies: None,
        setting_count: None,
        created_date_time: object
            .get("createdDateTime")
            .and_then(Value::as_str)
            .map(str::to_string),
        last_modified_date_time: object
            .get("lastModifiedDateTime")
            .and_then(Value::as_str)
            .map(str::to_string),
        is_assigned: Some(false),
        template_family: None,
        template_id: None,
        odata_type: object
            .get("@odata.type")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| Some(kind.odata_type.to_string())),
    })
}

pub async fn create_compliance_policy(
    access_token: &str,
    input: CreateCompliancePolicyInput,
) -> Result<CatalogPolicySummary, GraphError> {
    let kind = compliance_kind(&input.platform)?;
    let body = compliance_create_body(&input)?;
    let created: Value = GraphClient::new()
        .post(access_token, COLLECTION, "beta", &body)
        .await?;
    summary_from_created(kind, &created, input.display_name.trim())
}

const BLOCKED_PATCH_KEYS: &[&str] = &[
    "id",
    "displayName",
    "description",
    "createdDateTime",
    "lastModifiedDateTime",
    "version",
    "roleScopeTagIds",
    "scheduledActionsForRule",
    "assignments",
    "@odata.context",
    "@odata.etag",
    "@odata.id",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCompliancePolicyInput {
    pub id: String,
    pub odata_type: String,
    #[serde(default)]
    pub settings: Map<String, Value>,
}

pub fn compliance_patch_body(input: &UpdateCompliancePolicyInput) -> Result<Value, GraphError> {
    let odata_type = input.odata_type.trim();
    if odata_type.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "@odata.type is required to PATCH a compliance policy.".into(),
            permission_related: false,
        });
    }
    let mut body = json!({ "@odata.type": odata_type });
    let object = body.as_object_mut().expect("json object");
    for (key, value) in &input.settings {
        if BLOCKED_PATCH_KEYS.contains(&key.as_str()) || key.starts_with('@') {
            continue;
        }
        object.insert(key.clone(), value.clone());
    }
    if object.len() <= 1 {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "No compliance settings to update.".into(),
            permission_related: false,
        });
    }
    Ok(body)
}

pub async fn update_compliance_policy(
    access_token: &str,
    input: UpdateCompliancePolicyInput,
) -> Result<(), GraphError> {
    let id = input.id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Policy id is required.".into(),
            permission_related: false,
        });
    }
    let body = compliance_patch_body(&input)?;
    let path = format!("{COLLECTION}/{enc}", enc = urlencoding::encode(id));
    GraphClient::new()
        .patch_no_content(access_token, &path, "beta", &body)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(platform: &str, name: &str) -> CreateCompliancePolicyInput {
        CreateCompliancePolicyInput {
            platform: platform.into(),
            display_name: name.into(),
            description: Some("  from Axis  ".into()),
            grace_period_hours: Some(24),
            settings: Map::new(),
        }
    }

    #[test]
    fn windows_body_includes_required_actions() {
        let mut settings = Map::new();
        settings.insert("bitLockerEnabled".into(), json!(true));
        settings.insert("tpmRequired".into(), json!(false));
        settings.insert("unknownKey".into(), json!(true));
        let mut body = input("windows", "Win baseline");
        body.settings = settings;
        let json = compliance_create_body(&body).unwrap();
        assert_eq!(
            json["@odata.type"],
            "#microsoft.graph.windows10CompliancePolicy"
        );
        assert_eq!(json["displayName"], "Win baseline");
        assert_eq!(json["description"], "from Axis");
        assert_eq!(json["bitLockerEnabled"], true);
        assert!(json.get("tpmRequired").is_none());
        assert!(json.get("unknownKey").is_none());
        assert_eq!(
            json["scheduledActionsForRule"][0]["scheduledActionConfigurations"][0]["gracePeriodHours"],
            24
        );
        assert_eq!(
            json["scheduledActionsForRule"][0]["scheduledActionConfigurations"][0]["actionType"],
            "block"
        );
    }

    #[test]
    fn empty_name_is_rejected() {
        assert!(compliance_create_body(&input("macos", "   ")).is_err());
    }

    #[test]
    fn unknown_platform_is_rejected() {
        assert!(compliance_kind("linux").is_err());
    }

    #[test]
    fn android_flavors_map() {
        assert_eq!(
            compliance_kind("androidDeviceOwner").unwrap().odata_type,
            "#microsoft.graph.androidDeviceOwnerCompliancePolicy"
        );
        assert_eq!(
            compliance_kind("androidAosp").unwrap().odata_type,
            "#microsoft.graph.aospDeviceOwnerCompliancePolicy"
        );
        assert_eq!(
            platforms_from_compliance_odata(Some(
                "#microsoft.graph.androidWorkProfileCompliancePolicy"
            ))
            .as_deref(),
            Some("android")
        );
        assert_eq!(
            platforms_from_compliance_odata(Some("#microsoft.graph.windows10CompliancePolicy"))
                .as_deref(),
            Some("windows")
        );
    }

    #[test]
    fn patch_body_keeps_settings_and_strips_actions() {
        let mut settings = Map::new();
        settings.insert("bitLockerEnabled".into(), json!(true));
        settings.insert("scheduledActionsForRule".into(), json!([]));
        settings.insert("osMinimumVersion".into(), json!("10.0.19045"));
        let body = compliance_patch_body(&UpdateCompliancePolicyInput {
            id: "p1".into(),
            odata_type: "#microsoft.graph.windows10CompliancePolicy".into(),
            settings,
        })
        .unwrap();
        assert_eq!(
            body["@odata.type"],
            "#microsoft.graph.windows10CompliancePolicy"
        );
        assert_eq!(body["bitLockerEnabled"], true);
        assert_eq!(body["osMinimumVersion"], "10.0.19045");
        assert!(body.get("scheduledActionsForRule").is_none());
    }
}
