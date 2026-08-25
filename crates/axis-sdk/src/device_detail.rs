use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::device_policies::{
    fetch_managed_device_policies, DevicePolicyState, PolicyConflictSummary, PolicyDiagnostics,
};
use crate::graph::{GraphClient, GraphError};
use crate::types::ManagedDeviceSummary;

const DETAIL_SELECT: &str = "id,deviceName,userPrincipalName,operatingSystem,osVersion,complianceState,lastSyncDateTime,managementAgent,model,manufacturer,isEncrypted,azureADDeviceId,managedDeviceOwnerType,enrolledDateTime,emailAddress,jailBroken,userId,managedDeviceName,serialNumber,azureADRegistered,enrollmentProfileName,userDisplayName,subscriberCarrier,meid,imei,totalStorageSpaceInBytes,freeStorageSpaceInBytes,physicalMemoryInBytes,ethernetMacAddress,wiFiMacAddress,iccid,easActivated,easDeviceId,easActivationDateTime,isSupervised,skuFamily,skuNumber,activationLockBypassCode";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ManagedDeviceHardwareDetails {
    pub managed_device_name: Option<String>,
    pub azure_ad_registered: Option<bool>,
    pub serial_number: Option<String>,
    pub enrollment_profile_name: Option<String>,
    pub user_display_name: Option<String>,
    pub operating_system_language: Option<String>,
    pub operating_system_edition: Option<String>,
    pub sku_family: Option<String>,
    pub sku_number: Option<i64>,
    pub subscriber_carrier: Option<String>,
    pub cellular_technology: Option<String>,
    pub wifi_mac_address: Option<String>,
    pub ethernet_mac_address: Option<String>,
    pub iccid: Option<String>,
    pub ip_address_v4: Option<String>,
    pub subnet_address: Option<String>,
    pub wired_ipv4_addresses: Vec<String>,
    pub total_storage_space_in_bytes: Option<i64>,
    pub free_storage_space_in_bytes: Option<i64>,
    pub physical_memory_in_bytes: Option<i64>,
    pub imei: Option<String>,
    pub meid: Option<String>,
    pub processor_architecture: Option<String>,
    pub tpm_specification_version: Option<String>,
    pub tpm_manufacturer: Option<String>,
    pub tpm_version: Option<String>,
    pub system_management_bios_version: Option<String>,
    pub activation_lock_bypass_code: Option<String>,
    pub eas_activated: Option<bool>,
    pub eas_device_id: Option<String>,
    pub eas_activation_date_time: Option<String>,
    pub is_supervised: Option<bool>,
    pub managed_device_owner_type: Option<String>,
    pub subscription_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedApp {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedApp {
    pub application_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mobile_app_intent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryGroupMembership {
    pub id: String,
    pub display_name: String,
    pub group_types: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mail_enabled: Option<bool>,
    pub membership_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedDeviceDetail {
    #[serde(flatten)]
    pub summary: ManagedDeviceSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jail_broken: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    pub hardware: ManagedDeviceHardwareDetails,
    pub configuration_states: Vec<DevicePolicyState>,
    pub compliance_policy_states: Vec<DevicePolicyState>,
    pub policy_conflicts: Vec<PolicyConflictSummary>,
    pub policy_diagnostics: PolicyDiagnostics,
    pub detected_apps: Vec<DetectedApp>,
    pub managed_apps: Vec<ManagedApp>,
    pub device_groups: Vec<DirectoryGroupMembership>,
    pub user_groups: Vec<DirectoryGroupMembership>,
    pub enrichment_warnings: Vec<String>,
}

fn json_str(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn json_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn json_i64(value: &Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(|item| item.as_i64().or_else(|| item.as_f64().map(|n| n as i64)))
}

fn json_obj<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).filter(|item| item.is_object())
}

fn encode_id(id: &str) -> String {
    urlencoding::encode(id).into_owned()
}

fn map_summary(raw: &Value) -> ManagedDeviceSummary {
    let mut name = json_str(raw, "deviceName").unwrap_or_default();
    if name.is_empty() {
        name = "Unnamed device".into();
    }
    ManagedDeviceSummary {
        id: json_str(raw, "id").unwrap_or_default(),
        device_name: name,
        user_principal_name: json_str(raw, "userPrincipalName"),
        operating_system: json_str(raw, "operatingSystem"),
        os_version: json_str(raw, "osVersion"),
        compliance_state: json_str(raw, "complianceState"),
        last_sync_date_time: json_str(raw, "lastSyncDateTime"),
        management_agent: json_str(raw, "managementAgent"),
        model: json_str(raw, "model"),
        manufacturer: json_str(raw, "manufacturer"),
        is_encrypted: json_bool(raw, "isEncrypted"),
        azure_ad_device_id: json_str(raw, "azureADDeviceId"),
        managed_device_owner_type: json_str(raw, "managedDeviceOwnerType"),
        enrolled_date_time: json_str(raw, "enrolledDateTime"),
    }
}

fn map_hardware(raw: &Value) -> ManagedDeviceHardwareDetails {
    let hw = json_obj(raw, "hardwareInformation")
        .cloned()
        .unwrap_or(Value::Null);
    let wired = hw
        .get("wiredIPv4Addresses")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();

    ManagedDeviceHardwareDetails {
        managed_device_name: json_str(raw, "managedDeviceName"),
        azure_ad_registered: json_bool(raw, "azureADRegistered"),
        serial_number: json_str(raw, "serialNumber").or_else(|| json_str(&hw, "serialNumber")),
        enrollment_profile_name: json_str(raw, "enrollmentProfileName"),
        user_display_name: json_str(raw, "userDisplayName"),
        operating_system_language: json_str(&hw, "operatingSystemLanguage"),
        operating_system_edition: json_str(&hw, "operatingSystemEdition"),
        sku_family: json_str(raw, "skuFamily"),
        sku_number: json_i64(raw, "skuNumber")
            .or_else(|| json_i64(&hw, "operatingSystemProductType")),
        subscriber_carrier: json_str(raw, "subscriberCarrier")
            .or_else(|| json_str(&hw, "subscriberCarrier")),
        cellular_technology: json_str(&hw, "cellularTechnology"),
        wifi_mac_address: json_str(raw, "wiFiMacAddress").or_else(|| json_str(&hw, "wifiMac")),
        ethernet_mac_address: json_str(raw, "ethernetMacAddress")
            .or_else(|| json_str(&hw, "ethernetMacAddress")),
        iccid: json_str(raw, "iccid").or_else(|| json_str(&hw, "iccid")),
        ip_address_v4: json_str(&hw, "ipAddressV4"),
        subnet_address: json_str(&hw, "subnetAddress"),
        wired_ipv4_addresses: wired,
        total_storage_space_in_bytes: json_i64(raw, "totalStorageSpaceInBytes")
            .or_else(|| json_i64(&hw, "totalStorageSpace")),
        free_storage_space_in_bytes: json_i64(raw, "freeStorageSpaceInBytes")
            .or_else(|| json_i64(&hw, "freeStorageSpace")),
        physical_memory_in_bytes: json_i64(raw, "physicalMemoryInBytes"),
        imei: json_str(raw, "imei").or_else(|| json_str(&hw, "imei")),
        meid: json_str(raw, "meid").or_else(|| json_str(&hw, "meid")),
        processor_architecture: json_str(&hw, "processorArchitecture"),
        tpm_specification_version: json_str(&hw, "tpmSpecificationVersion"),
        tpm_manufacturer: json_str(&hw, "tpmManufacturer"),
        tpm_version: json_str(&hw, "tpmVersion"),
        system_management_bios_version: json_str(&hw, "systemManagementBIOSVersion"),
        activation_lock_bypass_code: json_str(raw, "activationLockBypassCode"),
        eas_activated: json_bool(raw, "easActivated"),
        eas_device_id: json_str(raw, "easDeviceId"),
        eas_activation_date_time: json_str(raw, "easActivationDateTime"),
        is_supervised: json_bool(raw, "isSupervised").or_else(|| json_bool(&hw, "isSupervised")),
        managed_device_owner_type: json_str(raw, "managedDeviceOwnerType"),
        subscription_state: json_str(&hw, "deviceLicensingStatus")
            .or_else(|| json_str(raw, "subscriptionState")),
    }
}

fn map_detected_app(raw: &Value) -> Option<DetectedApp> {
    let id = json_str(raw, "id").unwrap_or_default();
    let display_name = json_str(raw, "displayName").unwrap_or_default();
    if id.is_empty() && display_name.is_empty() {
        return None;
    }
    Some(DetectedApp {
        id: if id.is_empty() {
            display_name.clone()
        } else {
            id
        },
        display_name: if display_name.is_empty() {
            "App".into()
        } else {
            display_name
        },
        version: json_str(raw, "version"),
        publisher: json_str(raw, "publisher"),
    })
}

fn map_managed_app(raw: &Value) -> Option<ManagedApp> {
    let application_id = json_str(raw, "applicationId").unwrap_or_default();
    let display_name = json_str(raw, "displayName").unwrap_or_default();
    if application_id.is_empty() && display_name.is_empty() {
        return None;
    }
    Some(ManagedApp {
        application_id: if application_id.is_empty() {
            display_name.clone()
        } else {
            application_id
        },
        display_name: if display_name.is_empty() {
            json_str(raw, "applicationId").unwrap_or_else(|| "App".into())
        } else {
            display_name
        },
        display_version: json_str(raw, "displayVersion"),
        install_state: json_str(raw, "installState"),
        mobile_app_intent: json_str(raw, "mobileAppIntent"),
    })
}

fn map_group(raw: &Value, membership_kind: &str) -> Option<DirectoryGroupMembership> {
    if let Some(odata_type) = json_str(raw, "@odata.type") {
        if !odata_type.to_ascii_lowercase().contains("group") {
            return None;
        }
    }
    let id = json_str(raw, "id").unwrap_or_default();
    let display_name = json_str(raw, "displayName").unwrap_or_default();
    if id.is_empty() && display_name.is_empty() {
        return None;
    }
    let group_types = raw
        .get("groupTypes")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    Some(DirectoryGroupMembership {
        id: if id.is_empty() {
            display_name.clone()
        } else {
            id
        },
        display_name: if display_name.is_empty() {
            json_str(raw, "id").unwrap_or_else(|| "Group".into())
        } else {
            display_name
        },
        group_types,
        security_enabled: json_bool(raw, "securityEnabled"),
        mail_enabled: json_bool(raw, "mailEnabled"),
        membership_kind: membership_kind.into(),
    })
}

async fn fetch_detected_apps(
    client: &GraphClient,
    access_token: &str,
    device_id: &str,
) -> (Vec<DetectedApp>, Option<String>) {
    let encoded = encode_id(device_id);
    match client
        .fetch::<Value>(
            access_token,
            &format!("/deviceManagement/managedDevices/{encoded}?$select=id&$expand=detectedApps"),
            "beta",
        )
        .await
    {
        Ok(expanded) => {
            let from_expand = expanded
                .get("detectedApps")
                .and_then(Value::as_array)
                .map(|rows| rows.iter().filter_map(map_detected_app).collect::<Vec<_>>())
                .unwrap_or_default();
            if !from_expand.is_empty() {
                return (from_expand, None);
            }
        }
        Err(error) => {
            if error.permission_related() {
                return (vec![], Some(format!("Detected apps: {error}")));
            }
        }
    }

    match client
        .fetch_all_pages::<Value>(
            access_token,
            &format!("/deviceManagement/managedDevices/{encoded}/detectedApps"),
            "beta",
            200,
        )
        .await
    {
        Ok(rows) => (rows.iter().filter_map(map_detected_app).collect(), None),
        Err(error) => (vec![], Some(format!("Detected apps: {error}"))),
    }
}

async fn fetch_managed_apps(
    client: &GraphClient,
    access_token: &str,
    device_id: &str,
    user_id: Option<&str>,
    user_principal_name: Option<&str>,
) -> (Vec<ManagedApp>, Option<String>) {
    let user_key = user_id
        .filter(|value| !value.is_empty())
        .or(user_principal_name.filter(|value| !value.is_empty()));
    let Some(user_key) = user_key else {
        return (
            vec![],
            Some(
                "Managed apps unavailable — device has no primary user id/UPN to query mobileAppIntentAndStates."
                    .into(),
            ),
        );
    };
    let encoded_user = encode_id(user_key);
    let encoded_device = encode_id(device_id);
    match client
        .fetch::<Value>(
            access_token,
            &format!("/users/{encoded_user}/mobileAppIntentAndStates/{encoded_device}"),
            "beta",
        )
        .await
    {
        Ok(payload) => {
            let apps = payload
                .get("mobileAppList")
                .and_then(Value::as_array)
                .map(|rows| rows.iter().filter_map(map_managed_app).collect())
                .unwrap_or_default();
            return (apps, None);
        }
        Err(error) => {
            match client
                .fetch_all_pages::<Value>(
                    access_token,
                    &format!("/users/{encoded_user}/mobileAppIntentAndStates"),
                    "beta",
                    50,
                )
                .await
            {
                Ok(all) => {
                    let match_row = all.iter().find(|item| {
                        json_str(item, "managedDeviceIdentifier").as_deref() == Some(device_id)
                            || json_str(item, "id").as_deref() == Some(device_id)
                    });
                    if let Some(row) = match_row {
                        let apps = row
                            .get("mobileAppList")
                            .and_then(Value::as_array)
                            .map(|rows| rows.iter().filter_map(map_managed_app).collect())
                            .unwrap_or_default();
                        return (apps, None);
                    }
                    (vec![], Some(format!("Managed apps: {error}")))
                }
                Err(fallback) => (vec![], Some(format!("Managed apps: {fallback}"))),
            }
        }
    }
}

async fn resolve_entra_device_object_id(
    client: &GraphClient,
    access_token: &str,
    azure_ad_device_id: &str,
) -> Result<Option<String>, GraphError> {
    let filter = urlencoding::encode(&format!("deviceId eq '{azure_ad_device_id}'")).into_owned();
    let page: Value = client
        .fetch(
            access_token,
            &format!("/devices?$select=id,deviceId,displayName&$filter={filter}"),
            "v1.0",
        )
        .await?;
    Ok(page
        .get("value")
        .and_then(Value::as_array)
        .and_then(|rows| rows.first())
        .and_then(|row| json_str(row, "id")))
}

async fn fetch_member_of_groups(
    client: &GraphClient,
    access_token: &str,
    directory_path: &str,
    membership_kind: &str,
) -> Result<Vec<DirectoryGroupMembership>, GraphError> {
    let rows = client
        .fetch_all_pages::<Value>(
            access_token,
            &format!("{directory_path}/memberOf?$select=id,displayName,groupTypes,securityEnabled,mailEnabled"),
            "v1.0",
            100,
        )
        .await?;
    Ok(rows
        .iter()
        .filter_map(|row| map_group(row, membership_kind))
        .collect())
}

async fn fetch_device_and_user_groups(
    client: &GraphClient,
    access_token: &str,
    summary: &ManagedDeviceSummary,
) -> (
    Vec<DirectoryGroupMembership>,
    Vec<DirectoryGroupMembership>,
    Vec<String>,
) {
    let mut warnings = Vec::new();
    let mut device_groups = Vec::new();
    let mut user_groups = Vec::new();

    if let Some(azure_id) = summary.azure_ad_device_id.as_deref() {
        match resolve_entra_device_object_id(client, access_token, azure_id).await {
            Ok(None) => warnings.push(
                "Entra device object was not found for this azureADDeviceId — device group memberships unavailable."
                    .into(),
            ),
            Ok(Some(object_id)) => {
                match fetch_member_of_groups(
                    client,
                    access_token,
                    &format!("/devices/{}", encode_id(&object_id)),
                    "device",
                )
                .await
                {
                    Ok(groups) => device_groups = groups,
                    Err(error) => warnings.push(format!(
                        "Device groups: {error} (needs Device.Read.All on the token)"
                    )),
                }
            }
            Err(error) => warnings.push(format!(
                "Device groups: {error} (needs Device.Read.All on the token)"
            )),
        }
    } else {
        warnings
            .push("Device has no azureADDeviceId — device group memberships unavailable.".into());
    }

    if let Some(upn) = summary.user_principal_name.as_deref() {
        match fetch_member_of_groups(
            client,
            access_token,
            &format!("/users/{}", encode_id(upn)),
            "user",
        )
        .await
        {
            Ok(groups) => user_groups = groups,
            Err(error) => warnings.push(format!(
                "User groups: {error} (needs User.Read.All or GroupMember.Read.All on the token)"
            )),
        }
    }

    (device_groups, user_groups, warnings)
}

pub async fn fetch_managed_device_detail(
    access_token: &str,
    device_id: &str,
) -> Result<ManagedDeviceDetail, GraphError> {
    let client = GraphClient::new();
    let encoded = encode_id(device_id);
    let base = format!("/deviceManagement/managedDevices/{encoded}?$select={DETAIL_SELECT}");
    let raw = match client
        .fetch::<Value>(
            access_token,
            &format!("{base}&$expand=hardwareInformation"),
            "beta",
        )
        .await
    {
        Ok(value) => value,
        Err(_) => client.fetch::<Value>(access_token, &base, "beta").await?,
    };

    let summary = map_summary(&raw);
    let hardware = map_hardware(&raw);
    let user_id = json_str(&raw, "userId");

    let (detected, managed, groups, policies) = tokio::join!(
        fetch_detected_apps(&client, access_token, device_id),
        fetch_managed_apps(
            &client,
            access_token,
            device_id,
            user_id.as_deref(),
            summary.user_principal_name.as_deref(),
        ),
        fetch_device_and_user_groups(&client, access_token, &summary),
        fetch_managed_device_policies(access_token, device_id),
    );

    let (detected_apps, detected_warning) = detected;
    let (managed_apps, managed_warning) = managed;
    let (device_groups, user_groups, group_warnings) = groups;

    let mut enrichment_warnings = Vec::new();
    if let Some(warning) = managed_warning {
        enrichment_warnings.push(warning);
    }
    if let Some(warning) = detected_warning {
        enrichment_warnings.push(warning);
    }
    enrichment_warnings.extend(group_warnings);
    if let Some(warning) = policies.warning {
        enrichment_warnings.push(warning);
    }

    Ok(ManagedDeviceDetail {
        email_address: json_str(&raw, "emailAddress"),
        jail_broken: json_str(&raw, "jailBroken"),
        user_id,
        hardware,
        configuration_states: policies.configuration_states,
        compliance_policy_states: policies.compliance_policy_states,
        policy_conflicts: policies.policy_conflicts,
        policy_diagnostics: policies.policy_diagnostics,
        detected_apps,
        managed_apps,
        device_groups,
        user_groups,
        enrichment_warnings,
        summary,
    })
}
