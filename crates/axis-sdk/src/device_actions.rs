use serde_json::json;

use crate::graph::{GraphClient, GraphError};

fn device_action_path(device_id: &str, action: &str) -> String {
    format!(
        "/deviceManagement/managedDevices/{}/{action}",
        urlencoding::encode(device_id)
    )
}

async fn post_action(
    access_token: &str,
    device_id: &str,
    action: &str,
    version: &str,
    body: serde_json::Value,
) -> Result<(), GraphError> {
    GraphClient::new()
        .post_no_content(
            access_token,
            &device_action_path(device_id, action),
            version,
            &body,
        )
        .await
}

pub async fn sync_managed_device(access_token: &str, device_id: &str) -> Result<(), GraphError> {
    post_action(access_token, device_id, "syncDevice", "v1.0", json!({})).await
}

pub async fn reboot_managed_device(access_token: &str, device_id: &str) -> Result<(), GraphError> {
    post_action(access_token, device_id, "rebootNow", "beta", json!({})).await
}

pub async fn remote_lock_managed_device(
    access_token: &str,
    device_id: &str,
) -> Result<(), GraphError> {
    post_action(access_token, device_id, "remoteLock", "beta", json!({})).await
}

pub async fn rotate_local_admin_password(
    access_token: &str,
    device_id: &str,
) -> Result<(), GraphError> {
    post_action(
        access_token,
        device_id,
        "rotateLocalAdminPassword",
        "beta",
        json!({}),
    )
    .await
}

pub async fn collect_managed_device_diagnostics(
    access_token: &str,
    device_id: &str,
) -> Result<(), GraphError> {
    post_action(
        access_token,
        device_id,
        "createDeviceLogCollectionRequest",
        "beta",
        json!({
            "templateType": {
                "@odata.type": "#microsoft.graph.deviceLogCollectionRequest",
                "templateType": "predefined"
            }
        }),
    )
    .await
}

pub async fn initiate_on_demand_remediation(
    access_token: &str,
    device_id: &str,
    script_policy_id: &str,
) -> Result<(), GraphError> {
    post_action(
        access_token,
        device_id,
        "initiateOnDemandProactiveRemediation",
        "beta",
        json!({ "scriptPolicyId": script_policy_id }),
    )
    .await
}

pub async fn retire_managed_device(access_token: &str, device_id: &str) -> Result<(), GraphError> {
    post_action(access_token, device_id, "retire", "beta", json!({})).await
}

pub async fn wipe_managed_device(access_token: &str, device_id: &str) -> Result<(), GraphError> {
    post_action(
        access_token,
        device_id,
        "wipe",
        "beta",
        json!({
            "keepEnrollmentData": false,
            "keepUserData": false,
            "persistEsimDataPlan": true
        }),
    )
    .await
}

pub async fn delete_managed_device(access_token: &str, device_id: &str) -> Result<(), GraphError> {
    GraphClient::new()
        .delete(
            access_token,
            &format!(
                "/deviceManagement/managedDevices/{}",
                urlencoding::encode(device_id)
            ),
            "beta",
        )
        .await
}
