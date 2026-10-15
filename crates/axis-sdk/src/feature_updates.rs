//! Windows feature update deployments (`windowsFeatureUpdateProfile`).
//!
//! A separate resource from update rings — it targets a specific Windows
//! version and controls how it is offered, rather than governing servicing.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::device_recovery::annotate_scope;
use crate::graph::{GraphClient, GraphError};

const COLLECTION: &str = "/deviceManagement/windowsFeatureUpdateProfiles";

/// A feature update deployment, mirroring the portal's Deployment settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureUpdateProfile {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// e.g. `Windows 11, version 26H2`.
    #[serde(default)]
    pub feature_update_version: Option<String>,
    #[serde(default)]
    pub created_date_time: Option<String>,
    #[serde(default)]
    pub last_modified_date_time: Option<String>,
    /// Graph-computed; the version's end of servicing date.
    #[serde(default)]
    pub end_of_support_date: Option<String>,
    #[serde(default)]
    pub is_assigned: bool,

    /// `true` offers the update as optional rather than required.
    #[serde(default)]
    pub install_feature_updates_optional: Option<bool>,
    /// Offers the latest Windows 10 build to devices that cannot take Windows 11.
    #[serde(default)]
    pub install_latest_windows10_on_windows11_ineligible_device: Option<bool>,

    // Rollout settings
    #[serde(default)]
    pub offer_start_date_time_in_utc: Option<String>,
    #[serde(default)]
    pub offer_end_date_time_in_utc: Option<String>,
    #[serde(default)]
    pub offer_interval_in_days: Option<i32>,

    /// Scope tags. Sent back on every save: the update service rejects a PATCH without them.
    #[serde(default)]
    pub role_scope_tag_ids: Vec<String>,
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn bool_field(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn int_field(value: &Value, key: &str) -> Option<i32> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .and_then(|number| i32::try_from(number).ok())
}

fn map_profile(raw: &Value) -> Option<FeatureUpdateProfile> {
    let id = string_field(raw, "id")?;
    let rollout = raw.get("rolloutSettings");
    Some(FeatureUpdateProfile {
        display_name: string_field(raw, "displayName").unwrap_or_else(|| id.clone()),
        description: string_field(raw, "description"),
        feature_update_version: string_field(raw, "featureUpdateVersion"),
        created_date_time: string_field(raw, "createdDateTime"),
        last_modified_date_time: string_field(raw, "lastModifiedDateTime"),
        end_of_support_date: string_field(raw, "endOfSupportDate"),
        is_assigned: bool_field(raw, "isAssigned").unwrap_or(false),
        install_feature_updates_optional: bool_field(raw, "installFeatureUpdatesOptional"),
        install_latest_windows10_on_windows11_ineligible_device: bool_field(
            raw,
            "installLatestWindows10OnWindows11IneligibleDevice",
        ),
        offer_start_date_time_in_utc: rollout
            .and_then(|value| string_field(value, "offerStartDateTimeInUTC")),
        offer_end_date_time_in_utc: rollout
            .and_then(|value| string_field(value, "offerEndDateTimeInUTC")),
        offer_interval_in_days: rollout.and_then(|value| int_field(value, "offerIntervalInDays")),
        role_scope_tag_ids: raw
            .get("roleScopeTagIds")
            .and_then(Value::as_array)
            .map(|tags| tags.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        id,
    })
}

/// Read one feature update deployment.
pub async fn fetch_feature_update_profile(
    access_token: &str,
    id: &str,
) -> Result<FeatureUpdateProfile, GraphError> {
    let id = id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "A deployment id is required.".into(),
            permission_related: false,
        });
    }
    let raw: Value = GraphClient::new()
        .fetch(
            access_token,
            &format!("{COLLECTION}/{}", urlencoding::encode(id)),
            "beta",
        )
        .await?;
    map_profile(&raw).ok_or_else(|| GraphError::Request {
        status: 404,
        code: None,
        message: "That feature update deployment could not be read.".into(),
        permission_related: false,
    })
}

/// Build the create/PATCH body, in the shape of Microsoft's documented PATCH.
/// `rolloutSettings` is always sent, since the portal requires a rollout
/// choice, and so are the scope tags (Default when the profile has none).
pub fn feature_update_body(profile: &FeatureUpdateProfile) -> Value {
    let role_scope_tag_ids = if profile.role_scope_tag_ids.is_empty() {
        vec!["0".to_string()]
    } else {
        profile.role_scope_tag_ids.clone()
    };
    json!({
        "@odata.type": "#microsoft.graph.windowsFeatureUpdateProfile",
        "roleScopeTagIds": role_scope_tag_ids,
        "displayName": profile.display_name.trim(),
        "description": profile.description.as_deref().map(str::trim).unwrap_or(""),
        "featureUpdateVersion": profile.feature_update_version,
        "installFeatureUpdatesOptional": profile.install_feature_updates_optional,
        "installLatestWindows10OnWindows11IneligibleDevice":
            profile.install_latest_windows10_on_windows11_ineligible_device,
        "rolloutSettings": {
            "offerStartDateTimeInUTC": profile.offer_start_date_time_in_utc,
            "offerEndDateTimeInUTC": profile.offer_end_date_time_in_utc,
            "offerIntervalInDays": profile.offer_interval_in_days,
        },
    })
}

pub async fn update_feature_update_profile(
    access_token: &str,
    profile: &FeatureUpdateProfile,
) -> Result<(), GraphError> {
    let id = profile.id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "A deployment id is required.".into(),
            permission_related: false,
        });
    }
    if profile.display_name.trim().is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "A deployment name is required.".into(),
            permission_related: false,
        });
    }
    let existing = fetch_feature_update_profile(access_token, id).await.ok();
    ensure_licensed(access_token, profile, existing.as_ref()).await?;
    GraphClient::new()
        .patch_no_content(
            access_token,
            &format!("{COLLECTION}/{}", urlencoding::encode(id)),
            "beta",
            &feature_update_body(profile),
        )
        .await
}

pub async fn create_feature_update_profile(
    access_token: &str,
    profile: &FeatureUpdateProfile,
) -> Result<FeatureUpdateProfile, GraphError> {
    if profile.display_name.trim().is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "A deployment name is required.".into(),
            permission_related: false,
        });
    }
    if profile
        .feature_update_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Choose the feature update to deploy.".into(),
            permission_related: false,
        });
    }
    ensure_licensed(access_token, profile, None).await?;
    let body = feature_update_body(profile);
    let created: Value = GraphClient::new()
        .post(access_token, COLLECTION, "beta", &body)
        .await?;
    map_profile(&created).ok_or_else(|| GraphError::Request {
        status: 200,
        code: None,
        message: "Deployment was created but Graph returned an incomplete response.".into(),
        permission_related: false,
    })
}

/// The service plan behind gradual rollout and optional feature updates.
/// Every qualifying subscription carries it: Windows Enterprise E3/E5,
/// Microsoft 365 F3/E3/E5, Education A3/A5, Windows VDA E3/E5, and
/// Microsoft 365 Business Premium.
const DEPLOYMENT_SERVICE_PLAN: &str = "WINDOWSUPDATEFORBUSINESS_DEPLOYMENTSERVICE";

/// Whether the tenant is licensed for the feature update options that need a
/// Windows subscription: gradual rollout and optional updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureUpdateEligibility {
    /// An active subscription includes the deployment service plan.
    pub eligible: bool,
    /// Subscriptions that include it, by `skuPartNumber`, for display.
    pub skus: Vec<String>,
}

/// Look for the deployment service plan on the tenant's active subscriptions.
pub async fn fetch_feature_update_eligibility(
    access_token: &str,
) -> Result<FeatureUpdateEligibility, GraphError> {
    let page: Value = GraphClient::new()
        .fetch_plain(
            access_token,
            "/subscribedSkus?$select=skuPartNumber,capabilityStatus,servicePlans",
            "beta",
        )
        .await
        .map_err(|error| annotate_scope(error, "Organization.Read.All"))?;

    let mut skus = Vec::new();
    for row in page.get("value").and_then(Value::as_array).into_iter().flatten() {
        // A suspended or deleted subscription does not grant the capability.
        let status = string_field(row, "capabilityStatus").unwrap_or_default();
        if !status.eq_ignore_ascii_case("enabled") {
            continue;
        }
        let has_plan = row
            .get("servicePlans")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|plan| {
                let named = string_field(plan, "servicePlanName")
                    .is_some_and(|name| name.eq_ignore_ascii_case(DEPLOYMENT_SERVICE_PLAN));
                // An admin can switch a plan off inside a licence.
                let provisioned = !string_field(plan, "provisioningStatus")
                    .is_some_and(|state| state.eq_ignore_ascii_case("Disabled"));
                named && provisioned
            });
        if has_plan {
            skus.push(string_field(row, "skuPartNumber").unwrap_or_else(|| "Unnamed subscription".into()));
        }
    }
    skus.sort();
    skus.dedup();
    Ok(FeatureUpdateEligibility {
        eligible: !skus.is_empty(),
        skus,
    })
}

/// Options in `profile` that need [`FeatureUpdateEligibility::eligible`].
fn licensed_options(profile: &FeatureUpdateProfile) -> Vec<&'static str> {
    let mut options = Vec::new();
    // `0001-01-01` is Graph's unset date.
    let has_end = profile
        .offer_end_date_time_in_utc
        .as_deref()
        .is_some_and(|value| !value.starts_with("0001-01-01"));
    if profile.offer_interval_in_days.is_some() || has_end {
        options.push("gradual rollout");
    }
    if profile.install_feature_updates_optional == Some(true) {
        options.push("optional updates");
    }
    options
}

/// Refuse to turn on a licensed option when the tenant is known not to be
/// eligible. Options `existing` already uses are left alone, so an older
/// deployment can still be edited or moved off them. When eligibility cannot be
/// read, Graph decides.
async fn ensure_licensed(
    access_token: &str,
    profile: &FeatureUpdateProfile,
    existing: Option<&FeatureUpdateProfile>,
) -> Result<(), GraphError> {
    let already = existing.map(licensed_options).unwrap_or_default();
    let added: Vec<&str> = licensed_options(profile)
        .into_iter()
        .filter(|option| !already.contains(option))
        .collect();
    if added.is_empty() {
        return Ok(());
    }
    let Ok(eligibility) = fetch_feature_update_eligibility(access_token).await else {
        return Ok(());
    };
    if eligibility.eligible {
        return Ok(());
    }
    Err(GraphError::Request {
        status: 400,
        code: None,
        message: format!(
            "This tenant is not licensed for {}. It needs Windows Enterprise E3 or E5, Microsoft 365 F3, E3, or E5, Education A3 or A5, Windows VDA E3 or E5, or Microsoft 365 Business Premium.",
            added.join(" or ")
        ),
        permission_related: false,
    })
}

/// A Windows version Intune can deploy, from its update catalog. Intune checks
/// a deployment's `featureUpdateVersion` against `version`, so the picker only
/// offers these.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureUpdateCatalogItem {
    pub id: String,
    /// Label for the picker.
    pub display_name: String,
    /// The value a deployment sends as `featureUpdateVersion`.
    pub version: String,
    #[serde(default)]
    pub release_date_time: Option<String>,
    #[serde(default)]
    pub end_of_support_date: Option<String>,
}

/// Feature update versions in Intune's catalog, newest release first.
pub async fn fetch_feature_update_catalog(
    access_token: &str,
) -> Result<Vec<FeatureUpdateCatalogItem>, GraphError> {
    let rows: Vec<Value> = GraphClient::new()
        .fetch_all_pages(access_token, "/deviceManagement/windowsUpdateCatalogItems", "beta", 1000)
        .await
        .map_err(|error| annotate_scope(error, "DeviceManagementConfiguration.Read.All"))?;
    let mut items: Vec<FeatureUpdateCatalogItem> = rows
        .iter()
        // The collection also holds quality update items.
        .filter(|row| {
            row.get("@odata.type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.eq_ignore_ascii_case("#microsoft.graph.windowsFeatureUpdateCatalogItem"))
        })
        .filter_map(|row| {
            let version = string_field(row, "version")?;
            Some(FeatureUpdateCatalogItem {
                id: string_field(row, "id").unwrap_or_else(|| version.clone()),
                display_name: string_field(row, "displayName").unwrap_or_else(|| version.clone()),
                release_date_time: string_field(row, "releaseDateTime"),
                end_of_support_date: string_field(row, "endOfSupportDate"),
                version,
            })
        })
        .collect();
    items.sort_by(|a, b| {
        b.release_date_time
            .cmp(&a.release_date_time)
            .then_with(|| b.version.cmp(&a.version))
    });
    items.dedup_by(|a, b| a.version == b.version);
    Ok(items)
}
