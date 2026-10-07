//! Create a Windows LAPS enablement policy.
//!
//! Windows LAPS is configured through the Endpoint Security "Account protection"
//! template "Local admin password solution (Windows LAPS)". Template-backed
//! policies require every setting instance to carry the template id it was
//! created from, so the template is loaded first and its references are stamped
//! onto each instance.
//!
//! The setting definition ids are the LAPS CSP paths
//! (`./Device/Vendor/MSFT/LAPS/Policies/...`) lowercased and prefixed with
//! `device_vendor_msft_laps_policies_`. Enum settings are choice instances whose
//! option item ids are `<definitionId>_<value>`. Several settings are dependents
//! and must be nested under their parent choice: `PasswordAgeDays` (the `_aad`
//! variant under an Entra `BackupDirectory`, or the base id under an Active
//! Directory one), `PassphraseLength` (under `PasswordComplexity` when a
//! passphrase is chosen), and the automatic account management settings (under
//! `AutomaticAccountManagementEnabled`).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::device_recovery::annotate_scope;
use crate::graph::{GraphClient, GraphError};
use crate::object_detail::{
    fetch_configuration_policy_template, list_configuration_policy_templates,
};
use crate::settings_catalog::{
    create_policy_with_template, CreatedCatalogPolicy, SettingsCatalogPlatform,
};

const TEMPLATE_FAMILY: &str = "endpointSecurityAccountProtection";

const BACKUP_DIRECTORY: &str = "device_vendor_msft_laps_policies_backupdirectory";
const PASSWORD_AGE_DAYS_AAD: &str = "device_vendor_msft_laps_policies_passwordagedays_aad";
const PASSWORD_AGE_DAYS_AD: &str = "device_vendor_msft_laps_policies_passwordagedays";
const PASSWORD_LENGTH: &str = "device_vendor_msft_laps_policies_passwordlength";
const PASSPHRASE_LENGTH: &str = "device_vendor_msft_laps_policies_passphraselength";
const PASSWORD_COMPLEXITY: &str = "device_vendor_msft_laps_policies_passwordcomplexity";
const POST_AUTHENTICATION_ACTIONS: &str =
    "device_vendor_msft_laps_policies_postauthenticationactions";
const POST_AUTHENTICATION_RESET_DELAY: &str =
    "device_vendor_msft_laps_policies_postauthenticationresetdelay";
const AUTOMATIC_ACCOUNT_MANAGEMENT_ENABLED: &str =
    "device_vendor_msft_laps_policies_automaticaccountmanagementenabled";
const AUTOMATIC_ACCOUNT_MANAGEMENT_NAME_OR_PREFIX: &str =
    "device_vendor_msft_laps_policies_automaticaccountmanagementnameorprefix";
const AUTOMATIC_ACCOUNT_MANAGEMENT_ENABLE_ACCOUNT: &str =
    "device_vendor_msft_laps_policies_automaticaccountmanagementenableaccount";

/// Input for the LAPS enablement wizard. Values mirror the LAPS CSP.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLapsPolicyInput {
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// `1` backs the password up to Microsoft Entra ID, `2` to Active Directory.
    pub backup_directory: i32,
    /// Maximum password age in days (`1`–`365`).
    pub password_age_days: i32,
    /// Password complexity (`1`–`8`).
    pub password_complexity: i32,
    /// Password length in characters (`8`–`64`). Used when complexity is `1`–`5`.
    pub password_length: i32,
    /// Passphrase length in words (`3`–`10`). Used when complexity is `6`–`8`.
    pub passphrase_length: i32,
    /// Optional name or prefix for the automatically managed local administrator
    /// account. When set, automatic account management is turned on.
    #[serde(default)]
    pub managed_account_name: Option<String>,
    /// Post-authentication action (`1`, `3`, `5`, or `11`).
    pub post_authentication_actions: i32,
    /// Post-authentication reset delay in hours (`0`–`24`).
    pub post_authentication_reset_delay: i32,
}

fn input_error(message: impl Into<String>) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: message.into(),
        permission_related: false,
    }
}

/// Walk a template's `settingInstanceTemplate`, collecting
/// `settingDefinitionId -> settingInstanceTemplateId` for every instance
/// (including nested dependents).
fn collect_template_refs(instance: &Value, into: &mut HashMap<String, String>) {
    if let (Some(definition_id), Some(template_id)) = (
        instance.get("settingDefinitionId").and_then(Value::as_str),
        instance
            .get("settingInstanceTemplateId")
            .and_then(Value::as_str),
    ) {
        into.insert(definition_id.to_string(), template_id.to_string());
    }

    let mut nested: Vec<&Value> = Vec::new();
    if let Some(collection) = instance
        .get("groupSettingCollectionValueTemplate")
        .and_then(Value::as_array)
    {
        for entry in collection {
            if let Some(children) = entry.get("children").and_then(Value::as_array) {
                nested.extend(children);
            }
        }
    }
    if let Some(children) = instance
        .get("groupSettingValueTemplate")
        .and_then(|group| group.get("children"))
        .and_then(Value::as_array)
    {
        nested.extend(children);
    }
    if let Some(collection) = instance
        .get("choiceSettingCollectionValueTemplate")
        .and_then(Value::as_array)
    {
        for entry in collection {
            if let Some(children) = entry.get("children").and_then(Value::as_array) {
                nested.extend(children);
            }
        }
    }
    if let Some(children) = instance
        .get("choiceSettingValueTemplate")
        .and_then(|choice| choice.get("children"))
        .and_then(Value::as_array)
    {
        nested.extend(children);
    }

    for child in nested {
        collect_template_refs(child, into);
    }
}

/// Load the Windows LAPS account protection template and its setting references.
async fn laps_template(
    access_token: &str,
) -> Result<(String, HashMap<String, String>), GraphError> {
    let templates = list_configuration_policy_templates(access_token, TEMPLATE_FAMILY).await?;
    let template = templates
        .iter()
        .find(|template| {
            let name = template.display_name.to_ascii_lowercase();
            name.contains("laps") || name.contains("local admin password")
        })
        .ok_or_else(|| {
            input_error(
                "The Windows LAPS account protection template was not found in this tenant.",
            )
        })?;
    let rows = fetch_configuration_policy_template(access_token, &template.id).await?;
    let mut refs = HashMap::new();
    for row in &rows {
        if let Some(instance) = row.get("settingInstanceTemplate") {
            collect_template_refs(instance, &mut refs);
        }
    }
    Ok((template.id.clone(), refs))
}

fn with_ref(mut instance: Value, definition_id: &str, refs: &HashMap<String, String>) -> Value {
    if let Some(template_id) = refs.get(definition_id) {
        instance["settingInstanceTemplateReference"] =
            json!({ "settingInstanceTemplateId": template_id });
    }
    instance
}

/// A choice instance. `option` is the raw option suffix, e.g. `"1"` or `"true"`.
fn choice_instance(
    definition_id: &str,
    option: &str,
    children: Vec<Value>,
    refs: &HashMap<String, String>,
) -> Value {
    with_ref(
        json!({
            "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
            "settingDefinitionId": definition_id,
            "choiceSettingValue": {
                "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingValue",
                "value": format!("{definition_id}_{option}"),
                "children": children,
            },
        }),
        definition_id,
        refs,
    )
}

fn integer_instance(definition_id: &str, value: i32, refs: &HashMap<String, String>) -> Value {
    with_ref(
        json!({
            "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
            "settingDefinitionId": definition_id,
            "simpleSettingValue": {
                "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue",
                "value": value,
            },
        }),
        definition_id,
        refs,
    )
}

fn string_instance(definition_id: &str, value: &str, refs: &HashMap<String, String>) -> Value {
    with_ref(
        json!({
            "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
            "settingDefinitionId": definition_id,
            "simpleSettingValue": {
                "@odata.type": "#microsoft.graph.deviceManagementConfigurationStringSettingValue",
                "value": value,
            },
        }),
        definition_id,
        refs,
    )
}

fn is_passphrase(complexity: i32) -> bool {
    (6..=8).contains(&complexity)
}

fn validate(input: &CreateLapsPolicyInput) -> Result<(), GraphError> {
    if input.display_name.trim().is_empty() {
        return Err(input_error("Policy name is required."));
    }
    if !matches!(input.backup_directory, 1 | 2) {
        return Err(input_error(
            "Backup directory must be Microsoft Entra ID (1) or Active Directory (2).",
        ));
    }
    if !(1..=365).contains(&input.password_age_days) {
        return Err(input_error("Password age must be from 1 to 365 days."));
    }
    if !(1..=8).contains(&input.password_complexity) {
        return Err(input_error("Password complexity must be from 1 to 8."));
    }
    if is_passphrase(input.password_complexity) {
        if !(3..=10).contains(&input.passphrase_length) {
            return Err(input_error("Passphrase length must be from 3 to 10 words."));
        }
    } else if !(8..=64).contains(&input.password_length) {
        return Err(input_error(
            "Password length must be from 8 to 64 characters.",
        ));
    }
    if !matches!(input.post_authentication_actions, 1 | 3 | 5 | 11) {
        return Err(input_error(
            "Post-authentication action must be 1, 3, 5, or 11.",
        ));
    }
    if !(0..=24).contains(&input.post_authentication_reset_delay) {
        return Err(input_error(
            "Post-authentication reset delay must be from 0 to 24 hours.",
        ));
    }
    if let Some(name) = input
        .managed_account_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if name.chars().count() > 20 {
            return Err(input_error(
                "Managed account name must be 20 characters or fewer.",
            ));
        }
    }
    Ok(())
}

/// Build the template-backed setting instances for a LAPS policy.
pub fn laps_policy_settings(
    input: &CreateLapsPolicyInput,
    refs: &HashMap<String, String>,
) -> Vec<Value> {
    let age_definition = if input.backup_directory == 2 {
        PASSWORD_AGE_DAYS_AD
    } else {
        PASSWORD_AGE_DAYS_AAD
    };
    let backup = choice_instance(
        BACKUP_DIRECTORY,
        &input.backup_directory.to_string(),
        vec![integer_instance(
            age_definition,
            input.password_age_days,
            refs,
        )],
        refs,
    );

    let complexity_children = if is_passphrase(input.password_complexity) {
        vec![integer_instance(
            PASSPHRASE_LENGTH,
            input.passphrase_length,
            refs,
        )]
    } else {
        Vec::new()
    };
    let complexity = choice_instance(
        PASSWORD_COMPLEXITY,
        &input.password_complexity.to_string(),
        complexity_children,
        refs,
    );

    let mut settings = vec![
        backup,
        complexity,
        integer_instance(PASSWORD_LENGTH, input.password_length, refs),
        choice_instance(
            POST_AUTHENTICATION_ACTIONS,
            &input.post_authentication_actions.to_string(),
            Vec::new(),
            refs,
        ),
        integer_instance(
            POST_AUTHENTICATION_RESET_DELAY,
            input.post_authentication_reset_delay,
            refs,
        ),
    ];

    // A managed account name turns on automatic account management, which
    // creates and manages the account (rather than managing an existing one).
    if let Some(name) = input
        .managed_account_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        settings.push(choice_instance(
            AUTOMATIC_ACCOUNT_MANAGEMENT_ENABLED,
            "true",
            vec![
                string_instance(AUTOMATIC_ACCOUNT_MANAGEMENT_NAME_OR_PREFIX, name, refs),
                choice_instance(
                    AUTOMATIC_ACCOUNT_MANAGEMENT_ENABLE_ACCOUNT,
                    "true",
                    Vec::new(),
                    refs,
                ),
            ],
            refs,
        ));
    }

    settings
}

pub async fn create_laps_policy(
    access_token: &str,
    input: CreateLapsPolicyInput,
) -> Result<CreatedCatalogPolicy, GraphError> {
    validate(&input)?;
    let (template_id, refs) = laps_template(access_token).await?;
    let settings = laps_policy_settings(&input, &refs);
    create_policy_with_template(
        access_token,
        input.display_name.trim(),
        input.description.as_deref(),
        SettingsCatalogPlatform::Windows,
        &template_id,
        Some(TEMPLATE_FAMILY),
        &settings,
        None,
        None,
    )
    .await
}

const DEVICE_REGISTRATION_POLICY: &str = "/policies/deviceRegistrationPolicy";

/// Whether Windows LAPS is enabled for the tenant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapsTenantStatus {
    pub enabled: bool,
}

/// Read the tenant's `localAdminPassword.isEnabled` flag from the device
/// registration policy.
pub async fn fetch_laps_tenant_status(access_token: &str) -> Result<LapsTenantStatus, GraphError> {
    let raw: Value = GraphClient::new()
        .fetch_plain(access_token, DEVICE_REGISTRATION_POLICY, "beta")
        .await
        .map_err(|error| annotate_scope(error, "Policy.Read.All"))?;
    Ok(LapsTenantStatus {
        enabled: raw
            .get("localAdminPassword")
            .and_then(|value| value.get("isEnabled"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

/// Turn on Windows LAPS for the tenant. The PUT replaces the whole device
/// registration policy, so the current policy is read first and only the LAPS
/// toggle is changed.
pub async fn enable_laps_for_tenant(access_token: &str) -> Result<(), GraphError> {
    let client = GraphClient::new();
    let mut raw: Value = client
        .fetch_plain(access_token, DEVICE_REGISTRATION_POLICY, "beta")
        .await
        .map_err(|error| annotate_scope(error, "Policy.Read.All"))?;
    match raw
        .get_mut("localAdminPassword")
        .and_then(Value::as_object_mut)
    {
        Some(local_admin_password) => {
            local_admin_password.insert("isEnabled".into(), Value::Bool(true));
        }
        None => raw["localAdminPassword"] = json!({ "isEnabled": true }),
    }
    if let Some(object) = raw.as_object_mut() {
        object.remove("@odata.context");
        object.remove("@odata.type");
    }
    client
        .put_empty(access_token, DEVICE_REGISTRATION_POLICY, "beta", &raw)
        .await
        .map_err(|error| annotate_scope(error, "Policy.ReadWrite.DeviceConfiguration"))
}
