use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const STALE_DEVICE_DAYS: i64 = 7;
pub const MANAGED_DEVICE_LIST_PAGE_SIZE: u32 = 100;
pub const MANAGED_DEVICE_LIST_MAX: usize = 500;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ManagedDeviceSummary {
    pub id: String,
    pub device_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_principal_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operating_system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compliance_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub management_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_encrypted: Option<bool>,
    #[serde(rename = "azureADDeviceId", skip_serializing_if = "Option::is_none")]
    pub azure_ad_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub managed_device_owner_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enrolled_date_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedDeviceList {
    pub devices: Vec<ManagedDeviceSummary>,
    pub truncated: bool,
    pub fetched_at: String,
}

impl ManagedDeviceList {
    pub fn empty_with_now() -> Self {
        Self {
            devices: vec![],
            truncated: false,
            fetched_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSummary {
    pub total: u32,
    pub by_os: HashMap<String, u32>,
    pub by_compliance: HashMap<String, u32>,
    pub active: u32,
    pub stale: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyCounts {
    pub compliance_policies: u32,
    pub configuration_profiles: u32,
    pub device_configurations: u32,
    pub group_policy_configurations: u32,
    pub endpoint_security: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryCount {
    pub id: String,
    pub title: String,
    pub category: String,
    pub count: u32,
    pub api: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_related: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlanceConflictItem {
    pub id: String,
    pub label: String,
    pub setting_count: u32,
    pub policy_count: u32,
    pub device_checkins_impacted: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlanceConflicts {
    pub summary_count: u32,
    pub devices_impacted: u32,
    pub items: Vec<GlanceConflictItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlanceFailures {
    pub app_failed_device_count: Option<u32>,
    pub app_failure_sample_size: Option<u32>,
    pub config_noncompliant_devices: u32,
    pub config_error_devices: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlanceCompliance {
    pub compliant: u32,
    pub noncompliant: u32,
    pub in_grace_period: u32,
    pub unknown: u32,
    pub rate_percent: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryAuditActor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_principal_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryAuditEvent {
    pub id: String,
    pub activity_date_time: String,
    pub activity_display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_type: Option<String>,
    pub actor: DirectoryAuditActor,
    pub target_resources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlanceDriftFailingCheck {
    pub id: String,
    pub title: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlanceDrift {
    pub baseline_id: String,
    pub baseline_name: String,
    pub pass: u32,
    pub fail: u32,
    pub unknown: u32,
    pub incomplete: bool,
    pub failing_checks: Vec<GlanceDriftFailingCheck>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantGlance {
    pub organization_name: Option<String>,
    pub devices: DeviceSummary,
    pub policies: PolicyCounts,
    pub inventory: Vec<InventoryCount>,
    pub conflicts: GlanceConflicts,
    pub failures: GlanceFailures,
    pub compliance: GlanceCompliance,
    pub recent_activity: Vec<DirectoryAuditEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_activity_warning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_activity_permission_related: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drift: Option<GlanceDrift>,
    pub warnings: Vec<String>,
    pub permission_warnings: Vec<String>,
    pub other_warnings: Vec<String>,
    pub token_scopes: Vec<String>,
    pub fetched_at: String,
}

impl TenantGlance {
    pub fn empty_with_now() -> Self {
        Self {
            organization_name: None,
            devices: DeviceSummary {
                total: 0,
                by_os: HashMap::new(),
                by_compliance: HashMap::new(),
                active: 0,
                stale: 0,
            },
            policies: PolicyCounts {
                compliance_policies: 0,
                configuration_profiles: 0,
                device_configurations: 0,
                group_policy_configurations: 0,
                endpoint_security: 0,
            },
            inventory: vec![],
            conflicts: GlanceConflicts {
                summary_count: 0,
                devices_impacted: 0,
                items: vec![],
                warning: None,
            },
            failures: GlanceFailures {
                app_failed_device_count: None,
                app_failure_sample_size: None,
                config_noncompliant_devices: 0,
                config_error_devices: 0,
                warning: None,
            },
            compliance: GlanceCompliance {
                compliant: 0,
                noncompliant: 0,
                in_grace_period: 0,
                unknown: 0,
                rate_percent: None,
            },
            recent_activity: vec![],
            recent_activity_warning: None,
            recent_activity_permission_related: None,
            drift: None,
            warnings: vec![],
            permission_warnings: vec![],
            other_warnings: vec![],
            token_scopes: vec![],
            fetched_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct IntuneObjectType {
    pub id: &'static str,
    pub title: &'static str,
    pub api: &'static str,
    pub category: &'static str,
}

pub const GLANCE_OBJECT_TYPES: &[IntuneObjectType] = &[
    IntuneObjectType {
        id: "CompliancePolicies",
        title: "Compliance Policies",
        api: "/deviceManagement/deviceCompliancePolicies",
        category: "compliance",
    },
    IntuneObjectType {
        id: "CompliancePoliciesV2",
        title: "Compliance Policies (V2)",
        api: "/deviceManagement/compliancePolicies",
        category: "compliance",
    },
    IntuneObjectType {
        id: "DeviceConfiguration",
        title: "Device Configuration",
        api: "/deviceManagement/deviceConfigurations",
        category: "configuration",
    },
    IntuneObjectType {
        id: "SettingsCatalog",
        title: "Settings Catalog",
        api: "/deviceManagement/configurationPolicies",
        category: "configuration",
    },
    IntuneObjectType {
        id: "AdministrativeTemplates",
        title: "Administrative Templates",
        api: "/deviceManagement/groupPolicyConfigurations",
        category: "configuration",
    },
    IntuneObjectType {
        id: "EndpointSecurity",
        title: "Endpoint Security",
        api: "/deviceManagement/intents",
        category: "endpointSecurity",
    },
    IntuneObjectType {
        id: "FeatureUpdates",
        title: "Feature Updates",
        api: "/deviceManagement/windowsFeatureUpdateProfiles",
        category: "updates",
    },
    IntuneObjectType {
        id: "QualityUpdates",
        title: "Quality Updates (Profiles)",
        api: "/deviceManagement/windowsQualityUpdateProfiles",
        category: "updates",
    },
    IntuneObjectType {
        id: "Autopilot",
        title: "Autopilot",
        api: "/deviceManagement/windowsAutopilotDeploymentProfiles",
        category: "enrollment",
    },
    IntuneObjectType {
        id: "EnrollmentStatusPage",
        title: "Enrollment Status Page",
        api: "/deviceManagement/deviceEnrollmentConfigurations",
        category: "enrollment",
    },
    IntuneObjectType {
        id: "AssignmentFilters",
        title: "Filters",
        api: "/deviceManagement/assignmentFilters",
        category: "tenant",
    },
    IntuneObjectType {
        id: "PowerShellScripts",
        title: "Scripts (PowerShell)",
        api: "/deviceManagement/deviceManagementScripts",
        category: "scripts",
    },
    IntuneObjectType {
        id: "ShellScripts",
        title: "Scripts (Shell)",
        api: "/deviceManagement/deviceShellScripts",
        category: "scripts",
    },
    IntuneObjectType {
        id: "DeviceHealthScripts",
        title: "Remediations",
        api: "/deviceManagement/deviceHealthScripts",
        category: "scripts",
    },
    IntuneObjectType {
        id: "MacCustomAttributes",
        title: "Custom Attributes",
        api: "/deviceManagement/deviceCustomAttributeShellScripts",
        category: "scripts",
    },
    IntuneObjectType {
        id: "ComplianceScripts",
        title: "Compliance Scripts",
        api: "/deviceManagement/deviceComplianceScripts",
        category: "compliance",
    },
    IntuneObjectType {
        id: "AppProtection",
        title: "App Protection",
        api: "/deviceAppManagement/managedAppPolicies",
        category: "apps",
    },
    IntuneObjectType {
        id: "ConditionalAccess",
        title: "Conditional Access",
        api: "/identity/conditionalAccess/policies",
        category: "identity",
    },
];
