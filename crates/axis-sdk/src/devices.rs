use chrono::Utc;

use crate::graph::{GraphClient, GraphError};
use crate::types::{
    ManagedDeviceList, ManagedDeviceSummary, MANAGED_DEVICE_LIST_MAX, MANAGED_DEVICE_LIST_PAGE_SIZE,
};

const DEVICE_SELECT: &str = "id,deviceName,userPrincipalName,operatingSystem,osVersion,complianceState,lastSyncDateTime,managementAgent,model,manufacturer,isEncrypted,azureADDeviceId,managedDeviceOwnerType,enrolledDateTime";

pub async fn fetch_managed_device_list(
    access_token: &str,
) -> Result<ManagedDeviceList, GraphError> {
    let client = GraphClient::new();
    let path = format!(
        "/deviceManagement/managedDevices?$select={DEVICE_SELECT}&$top={MANAGED_DEVICE_LIST_PAGE_SIZE}"
    );
    let mut devices = client
        .fetch_all_pages::<ManagedDeviceSummary>(
            access_token,
            &path,
            "beta",
            MANAGED_DEVICE_LIST_MAX + 1,
        )
        .await?;

    devices.retain(|device| !device.id.is_empty());
    for device in &mut devices {
        if device.device_name.trim().is_empty() {
            device.device_name = "Unnamed device".into();
        }
    }

    let truncated = devices.len() > MANAGED_DEVICE_LIST_MAX;
    if truncated {
        devices.truncate(MANAGED_DEVICE_LIST_MAX);
    }

    devices.sort_by(|a, b| {
        a.device_name
            .to_lowercase()
            .cmp(&b.device_name.to_lowercase())
    });

    Ok(ManagedDeviceList {
        devices,
        truncated,
        fetched_at: Utc::now().to_rfc3339(),
    })
}
