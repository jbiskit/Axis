//! Read-only policy reviews outside Intune (Entra, Purview).
//!
//! Rows come back as raw Graph JSON; the UI summarises them per kind, and the
//! inspector reads one object through `fetch_graph_object_detail`.

use std::collections::HashMap;

use futures::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::Value;

use crate::graph::{GraphClient, GraphError};
use crate::inventory::{InventoryList, INVENTORY_LIST_MAX};

const NAME_LOOKUP_CONCURRENCY: usize = 8;

/// Object ids a review page wants named. Conditional Access stores role
/// *template* ids and application *app* ids, not object ids.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReviewReferences {
    pub users: Vec<String>,
    pub groups: Vec<String>,
    pub roles: Vec<String>,
    pub apps: Vec<String>,
    pub locations: Vec<String>,
}

fn is_guid(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn field(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(Value::as_str).filter(|text| !text.is_empty()).map(str::to_string)
}

/// id → display name. Ids that can't be read (deleted, or no permission) are
/// left out and the UI shows the raw id.
pub async fn resolve_review_names(access_token: &str, refs: ReviewReferences) -> HashMap<String, String> {
    let client = GraphClient::new();
    let mut names = HashMap::new();
    let lists = [
        (!refs.roles.is_empty(), "/roleManagement/directory/roleDefinitions?$select=displayName,templateId", "templateId"),
        (!refs.locations.is_empty(), "/identity/conditionalAccess/namedLocations?$select=id,displayName", "id"),
    ];
    for (wanted, path, key) in lists {
        if !wanted {
            continue;
        }
        if let Ok(rows) = client.fetch_all_pages::<Value>(access_token, path, "beta", 5000).await {
            names.extend(rows.iter().filter_map(|row| Some((field(row, key)?, field(row, "displayName")?))));
        }
    }
    let guids = |ids: Vec<String>| ids.into_iter().filter(|id| is_guid(id));
    let lookups = guids(refs.users)
        .map(|id| { let path = format!("/users/{id}?$select=displayName,userPrincipalName"); (id, path) })
        .chain(guids(refs.groups).map(|id| { let path = format!("/groups/{id}?$select=displayName"); (id, path) }))
        .chain(guids(refs.apps).map(|id| { let path = format!("/servicePrincipals(appId='{id}')?$select=displayName"); (id, path) }));
    let resolved: Vec<Option<(String, String)>> = stream::iter(lookups)
        .map(|(id, path)| {
            let client = &client;
            async move {
                let row = client.fetch_plain::<Value>(access_token, &path, "beta").await.ok()?;
                let name = field(&row, "displayName")?;
                let name = match field(&row, "userPrincipalName") {
                    Some(upn) if upn != name => format!("{name} ({upn})"),
                    _ => name,
                };
                Some((id, name))
            }
        })
        .buffer_unordered(NAME_LOOKUP_CONCURRENCY)
        .collect()
        .await;
    names.extend(resolved.into_iter().flatten());
    names
}

/// Graph collection for each review kind. Kinds are fixed here so the UI never passes a path.
pub(crate) fn collection_path(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "conditionalAccessPolicy" => "/identity/conditionalAccess/policies",
        "namedLocation" => "/identity/conditionalAccess/namedLocations",
        "user" => "/users",
        "entraDevice" => "/devices",
        // Delegated calls only see labels published to the signed-in user; the
        // org-wide /security/... list needs application permission.
        "sensitivityLabel" => "/me/security/informationProtection/sensitivityLabels",
        "retentionLabel" => "/security/labels/retentionLabels",
        "secureScoreControl" => "/security/secureScoreControlProfiles",
        "authRegistration" => "/reports/authenticationMethods/userRegistrationDetails",
        "customRole" => "/roleManagement/directory/roleDefinitions",
        // Both reject $top; fetch_all_pages doesn't add one.
        "authStrength" => "/identity/conditionalAccess/authenticationStrength/policies",
        "caTemplate" => "/identity/conditionalAccess/templates",
        "assignmentFilter" => "/deviceManagement/assignmentFilters",
        "brandingProfile" => "/deviceManagement/intuneBrandingProfiles",
        "deviceCategory" => "/deviceManagement/deviceCategories",
        "termsAndConditions" => "/deviceManagement/termsAndConditions",
        "androidEnrollmentProfile" => "/deviceManagement/androidDeviceOwnerEnrollmentProfiles",
        "appleEnrollmentProfile" => "/deviceManagement/appleUserInitiatedEnrollmentProfiles",
        "authMethodConfig" => "/policies/authenticationMethodsPolicy/authenticationMethodConfigurations",
        "endpointSecurityPolicy" => "/deviceManagement/configurationPolicies",
        _ => return None,
    })
}

pub async fn fetch_review_objects(
    access_token: &str,
    kind: &str,
) -> Result<InventoryList<Value>, GraphError> {
    let items = match kind {
        "secureScoreControl" => secure_score_controls(access_token).await?,
        "endpointSecurityPolicy" => endpoint_security_policies(access_token).await?,
        "defenderDevice" => defender_devices(access_token).await?,
        "assignmentFailure" => assignment_failures(access_token).await?,
        "updateAlert" => update_alerts(access_token).await?,
        "appCredential" => app_credentials(access_token).await?,
        "roleAssignment" => role_assignments(access_token).await?,
        "pimRoleSetting" => pim_role_settings(access_token).await?,
        "tenantSetting" => tenant_settings(access_token).await,
        "caTemplate" => ca_templates(access_token).await?,
        "intuneRole" => intune_roles(access_token).await?,
        "intuneConnector" => intune_connectors(access_token).await,
        "appConfig" => app_configurations(access_token).await?,
        "notificationTemplate" => GraphClient::new()
            .fetch_all_pages(access_token, "/deviceManagement/notificationMessageTemplates?$expand=localizedNotificationMessages", "beta", INVENTORY_LIST_MAX + 1)
            .await?,
        // qrCodeImage is a base64 PNG per profile; the inspector's by-id read still has it.
        "androidEnrollmentProfile" => GraphClient::new()
            .fetch_all_pages::<Value>(access_token, "/deviceManagement/androidDeviceOwnerEnrollmentProfiles", "beta", INVENTORY_LIST_MAX + 1)
            .await?
            .into_iter()
            .map(|mut row| {
                if let Some(object) = row.as_object_mut() {
                    object.remove("qrCodeImage");
                }
                row
            })
            .collect(),
        "customRole" => GraphClient::new()
            .fetch_all_pages(access_token, "/roleManagement/directory/roleDefinitions?$filter=isBuiltIn eq false", "beta", INVENTORY_LIST_MAX + 1)
            .await?,
        // signInActivity is left out: it needs Entra ID P1 and fails the whole request without it.
        "user" => users_with_licence_names(access_token).await?,
        "servicePlan" => service_plans(access_token).await?,
        // Entra device objects (not Intune managedDevices): the properties dynamic device rules read.
        "entraDevice" => GraphClient::new()
            .fetch_all_pages(
                access_token,
                "/devices?$select=id,displayName,operatingSystem,operatingSystemVersion,model,manufacturer,deviceOwnership,enrollmentProfileName,managementType,profileType,trustType,accountEnabled,physicalIds,extensionAttributes,deviceCategory,isRooted,systemLabels",
                "beta",
                INVENTORY_LIST_MAX + 1,
            )
            .await?,
        // The configurations collection can't be listed (400), only read by id; the policy embeds them.
        "authMethodConfig" => GraphClient::new()
            .fetch_plain::<Value>(access_token, "/policies/authenticationMethodsPolicy", "beta")
            .await?["authenticationMethodConfigurations"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
        _ => {
            let path = collection_path(kind).ok_or_else(|| unknown_kind(kind))?;
            GraphClient::new()
                .fetch_all_pages(access_token, path, "beta", INVENTORY_LIST_MAX + 1)
                .await?
        }
    };
    Ok(InventoryList::from_items(items))
}

/// Users with `licenceNames`: each assigned licence's product name from Microsoft's licensing CSV
/// (e.g. "Microsoft 365 E5"), else its `skuPartNumber` from `/subscribedSkus`, else the raw skuId.
async fn users_with_licence_names(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let mut users = client
        .fetch_all_pages::<Value>(
            access_token,
            "/users?$select=id,displayName,userPrincipalName,mail,accountEnabled,userType,jobTitle,department,companyName,officeLocation,usageLocation,createdDateTime,onPremisesSyncEnabled,assignedLicenses,externalUserState",
            "beta",
            INVENTORY_LIST_MAX + 1,
        )
        .await?;
    let skus: HashMap<String, String> = client
        .fetch_all_pages::<Value>(access_token, "/subscribedSkus?$select=skuId,skuPartNumber", "beta", 500)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|sku| Some((sku["skuId"].as_str()?.to_lowercase(), sku["skuPartNumber"].as_str()?.to_string())))
        .collect();
    let friendly = crate::licence_names::licence_names().await;
    let skus: HashMap<String, String> = skus
        .into_iter()
        .map(|(id, code)| {
            let name = friendly.as_ref().and_then(|names| names.products.get(&id).cloned()).unwrap_or(code);
            (id, name)
        })
        .collect();
    for user in &mut users {
        let names: Vec<Value> = user["assignedLicenses"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|licence| licence["skuId"].as_str())
            .map(|id| Value::String(skus.get(&id.to_lowercase()).cloned().unwrap_or_else(|| id.to_string())))
            .collect();
        if let Some(object) = user.as_object_mut() {
            object.insert("licenceNames".into(), Value::Array(names));
        }
    }
    Ok(users)
}

/// One row per service plan in the tenant's subscriptions: `id` is the servicePlanId (what
/// `user.assignedPlans` rules match), with its code name, its friendly name from Microsoft's
/// licensing CSV when available (`friendlyName`), and the licences (`skus`) that include it.
async fn service_plans(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let skus = GraphClient::new()
        .fetch_all_pages::<Value>(access_token, "/subscribedSkus?$select=skuId,skuPartNumber,servicePlans", "beta", 500)
        .await?;
    let friendly = crate::licence_names::licence_names().await;
    let mut plans: Vec<Value> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for sku in &skus {
        let code = sku["skuPartNumber"].as_str().unwrap_or_default();
        let product = sku["skuId"]
            .as_str()
            .and_then(|id| friendly.as_ref()?.products.get(&id.to_lowercase()).cloned());
        let sku_name = product.as_deref().unwrap_or(code);
        for plan in sku["servicePlans"].as_array().into_iter().flatten() {
            let Some(id) = plan["servicePlanId"].as_str() else { continue };
            let at = *index.entry(id.to_lowercase()).or_insert_with(|| {
                let friendly_name = friendly.as_ref().and_then(|names| names.plans.get(&id.to_lowercase()).cloned());
                plans.push(serde_json::json!({
                    "id": id,
                    "servicePlanName": plan["servicePlanName"],
                    "friendlyName": friendly_name,
                    "servicePlanType": plan["servicePlanType"],
                    "skus": [],
                }));
                plans.len() - 1
            });
            if let Some(list) = plans[at]["skus"].as_array_mut() {
                if !list.iter().any(|existing| existing == sku_name) {
                    list.push(Value::String(sku_name.to_string()));
                }
            }
        }
    }
    Ok(plans)
}

fn unknown_kind(kind: &str) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: format!("Unknown review kind: {kind}"),
        permission_related: false,
    }
}

/// Review kinds whose rows have no Graph object to GET; the inspector shows the list row.
pub fn is_row_only_review_kind(kind: &str) -> bool {
    matches!(kind, "defenderDevice" | "assignmentFailure" | "updateAlert" | "appCredential" | "roleAssignment" | "pimRoleSetting" | "tenantSetting" | "caTemplate"
            | "intuneRole" | "intuneConnector" | "appConfig" | "notificationTemplate")
}

pub async fn fetch_review_row(access_token: &str, kind: &str, id: &str) -> Result<Value, GraphError> {
    fetch_review_objects(access_token, kind)
        .await?
        .items
        .into_iter()
        .find(|row| row["id"].as_str() == Some(id))
        .ok_or_else(|| GraphError::Request {
            status: 404,
            code: None,
            message: format!("{id} was not found."),
            permission_related: false,
        })
}

/// Control profiles with this tenant's latest score for each, under `current`.
/// Only controls in the latest `controlScores` count toward the tenant's maximum
/// (others are deprecated or for services the tenant doesn't have), so the rest are left out.
async fn secure_score_controls(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let profiles: Vec<Value> = client
        .fetch_all_pages(access_token, "/security/secureScoreControlProfiles", "beta", 2000)
        .await?;
    let latest: Vec<Value> = client
        .fetch_plain::<crate::graph::GraphCollection<Value>>(access_token, "/security/secureScores?$top=1", "beta")
        .await?
        .value;
    let mut current: HashMap<String, Value> = latest
        .first()
        .and_then(|score| score["controlScores"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|control| Some((field(control, "controlName")?, control.clone())))
        .collect();
    Ok(profiles
        .into_iter()
        .filter_map(|mut profile| {
            let score = current.remove(&field(&profile, "id")?)?;
            profile.as_object_mut()?.insert("current".into(), score);
            Some(profile)
        })
        .collect())
}

/// Endpoint security policies (Settings Catalog families `endpointSecurity*`). Policies made in
/// the Defender portal live here too; `technologies` and `creationSource` say where they came from.
async fn endpoint_security_policies(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let rows: Vec<Value> = GraphClient::new()
        .fetch_all_pages(
            access_token,
            "/deviceManagement/configurationPolicies?$select=id,name,description,platforms,technologies,creationSource,isAssigned,lastModifiedDateTime,roleScopeTagIds,templateReference",
            "beta",
            INVENTORY_LIST_MAX + 1,
        )
        .await?;
    Ok(rows
        .into_iter()
        .filter(|row| {
            row["templateReference"]["templateFamily"]
                .as_str()
                .is_some_and(|family| family.starts_with("endpointSecurity"))
        })
        .collect())
}

/// Per-policy device counts (error, conflict, compliant...) from the report behind Endpoint security >
/// Assignment failures. Only policies with device status appear; failures sort first.
async fn assignment_failures(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let mut rows = crate::policy_health::fetch_report_rows(
        access_token,
        "/deviceManagement/reports/getConfigurationPolicyNonComplianceSummaryReport",
        "",
    )
    .await?;
    let failures = |row: &Value| {
        row["NumberOfErrorDevices"].as_u64().unwrap_or(0) + row["NumberOfConflictDevices"].as_u64().unwrap_or(0)
    };
    for row in &mut rows {
        let failed = failures(row);
        if let Some(object) = row.as_object_mut() {
            object.insert("id".into(), object.get("PolicyId").cloned().unwrap_or(Value::Null));
            object.insert("FailedDevices".into(), failed.into());
        }
    }
    rows.sort_by_key(|row| std::cmp::Reverse(failures(row)));
    Ok(rows)
}

/// Feature, quality and driver update alert summaries (Reports > Windows updates), one row per
/// policy with the number of devices reporting errors. `id` is `{type}:{PolicyId}`.
async fn update_alerts(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let mut out = Vec::new();
    for (update_type, report) in [
        ("Feature", "getWindowsUpdateAlertSummaryReport"),
        ("Quality", "getWindowsQualityUpdateAlertSummaryReport"),
        ("Driver", "getWindowsDriverUpdateAlertSummaryReport"),
    ] {
        let rows = crate::policy_health::fetch_report_rows(access_token, &format!("/deviceManagement/reports/{report}"), "").await?;
        out.extend(rows.into_iter().map(|mut row| {
            if let Some(object) = row.as_object_mut() {
                let id = format!("{update_type}:{}", object.get("PolicyId").and_then(Value::as_str).unwrap_or_default());
                object.insert("id".into(), id.into());
                object.insert("UpdateType".into(), update_type.into());
            }
            row
        }));
    }
    Ok(out)
}

/// One row per client secret or certificate on app registrations, plus the signing certificates on
/// SAML enterprise apps (those live on the service principal). `id` is `{objectId}:{keyId}`.
async fn app_credentials(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let apps: Vec<Value> = client
        .fetch_all_pages(access_token, "/applications?$select=id,appId,displayName,passwordCredentials,keyCredentials", "beta", 5000)
        .await?;
    let saml: Vec<Value> = client
        .fetch_all_pages(
            access_token,
            "/servicePrincipals?$filter=preferredSingleSignOnMode eq 'saml'&$select=id,appId,displayName,keyCredentials,passwordCredentials",
            "beta",
            5000,
        )
        .await?;
    let mut out = Vec::new();
    for (source, owners) in [("App registration", apps), ("Enterprise app (SAML)", saml)] {
        for owner in owners {
            for (credential_type, key) in [("Secret", "passwordCredentials"), ("Certificate", "keyCredentials")] {
                for credential in owner[key].as_array().into_iter().flatten() {
                    let mut row = credential.clone();
                    let Some(object) = row.as_object_mut() else { continue };
                    object.remove("key"); // certificate bytes; large and not needed to judge expiry
                    let key_id = credential["keyId"].as_str().unwrap_or_default();
                    object.insert("id".into(), format!("{}:{key_id}", owner["id"].as_str().unwrap_or_default()).into());
                    object.insert("credentialType".into(), credential_type.into());
                    object.insert("source".into(), source.into());
                    object.insert("appName".into(), owner["displayName"].clone());
                    object.insert("appId".into(), owner["appId"].clone());
                    object.insert("objectId".into(), owner["id"].clone());
                    out.push(row);
                }
            }
        }
    }
    out.sort_by(|a, b| a["endDateTime"].as_str().cmp(&b["endDateTime"].as_str()));
    Ok(out)
}

/// Active and eligible directory role assignments (PIM schedules), with principal and role trimmed
/// to what the list needs. Without Entra ID P2 the schedule APIs fail; active assignments then come
/// from `roleAssignments` and eligibility is unknown.
async fn role_assignments(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let base = "/roleManagement/directory";
    let active: Result<Vec<Value>, GraphError> = client
        .fetch_all_pages(access_token, &format!("{base}/roleAssignmentSchedules?$expand=principal,roleDefinition"), "beta", 5000)
        .await;
    let mut rows: Vec<(String, Value)> = match active {
        Ok(rows) => rows.into_iter().map(|row| ("Active".to_string(), row)).collect(),
        Err(_) => {
            // shortcut: only one $expand is allowed here, so role names come from a second call.
            let roles: Vec<Value> = client
                .fetch_all_pages(access_token, &format!("{base}/roleDefinitions?$select=id,displayName,isBuiltIn,isPrivileged"), "beta", 5000)
                .await?;
            let roles: HashMap<String, Value> =
                roles.into_iter().filter_map(|role| Some((field(&role, "id")?, role))).collect();
            client
                .fetch_all_pages::<Value>(access_token, &format!("{base}/roleAssignments?$expand=principal"), "beta", 5000)
                .await?
                .into_iter()
                .map(|mut row| {
                    if let Some(role) = field(&row, "roleDefinitionId").and_then(|id| roles.get(&id)) {
                        row["roleDefinition"] = role.clone();
                    }
                    ("Active".to_string(), row)
                })
                .collect()
        }
    };
    if let Ok(eligible) = client
        .fetch_all_pages::<Value>(access_token, &format!("{base}/roleEligibilitySchedules?$expand=principal,roleDefinition"), "beta", 5000)
        .await
    {
        rows.extend(eligible.into_iter().map(|row| ("Eligible".to_string(), row)));
    }
    Ok(rows
        .into_iter()
        .map(|(state, mut row)| {
            let principal = &row["principal"];
            let trimmed_principal = serde_json::json!({
                "id": principal["id"],
                "displayName": principal["displayName"],
                "userPrincipalName": principal["userPrincipalName"],
                "appId": principal["appId"],
                "accountEnabled": principal["accountEnabled"],
                "type": principal["@odata.type"].as_str().unwrap_or_default().trim_start_matches("#microsoft.graph."),
            });
            let role = &row["roleDefinition"];
            let trimmed_role = serde_json::json!({
                "id": role["id"],
                "displayName": role["displayName"],
                "isBuiltIn": role["isBuiltIn"],
                "isPrivileged": role["isPrivileged"],
            });
            if let Some(object) = row.as_object_mut() {
                object.insert("principal".into(), trimmed_principal);
                object.insert("roleDefinition".into(), trimmed_role);
                object.insert("state".into(), state.into());
            }
            row
        })
        .collect())
}

/// PIM settings for each directory role: the role's policy with its rules, plus the role's name.
/// `id` is the role definition id.
async fn pim_role_settings(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let roles: Vec<Value> = client
        .fetch_all_pages(access_token, "/roleManagement/directory/roleDefinitions?$select=id,displayName,isBuiltIn,isPrivileged", "beta", 5000)
        .await?;
    let roles: HashMap<String, Value> = roles.into_iter().filter_map(|role| Some((field(&role, "id")?, role))).collect();
    let assignments: Vec<Value> = client
        .fetch_all_pages(
            access_token,
            "/policies/roleManagementPolicyAssignments?$filter=scopeId eq '/' and scopeType eq 'DirectoryRole'&$expand=policy($expand=rules)",
            "beta",
            5000,
        )
        .await?;
    Ok(assignments
        .into_iter()
        .filter_map(|assignment| {
            let role_id = field(&assignment, "roleDefinitionId")?;
            let role = roles.get(&role_id);
            let mut policy = assignment["policy"].clone();
            let object = policy.as_object_mut()?;
            object.insert("policyId".into(), object.get("id").cloned().unwrap_or(Value::Null));
            object.insert("id".into(), role_id.into());
            object.insert("roleName".into(), role.map_or(Value::Null, |role| role["displayName"].clone()));
            object.insert("isBuiltIn".into(), role.map_or(Value::Null, |role| role["isBuiltIn"].clone()));
            object.insert("isPrivileged".into(), role.map_or(Value::Null, |role| role["isPrivileged"].clone()));
            Some(policy)
        })
        .collect())
}

/// Tenant-wide Entra policies that are single objects, one row each. `id` is the row key below,
/// `settingName` its label. A policy that can't be read stays as a row with `error`, so one
/// missing role doesn't hide the rest.
async fn tenant_settings(access_token: &str) -> Vec<Value> {
    const SETTINGS: &[(&str, &str, &str)] = &[
        ("authorization", "Authorization policy", "/policies/authorizationPolicy"),
        ("securityDefaults", "Security defaults", "/policies/identitySecurityDefaultsEnforcementPolicy"),
        ("crossTenantDefault", "Cross-tenant access defaults", "/policies/crossTenantAccessPolicy/default"),
        ("deviceRegistration", "Device registration", "/policies/deviceRegistrationPolicy"),
        ("adminConsent", "Admin consent requests", "/policies/adminConsentRequestPolicy"),
        ("authenticationFlows", "Authentication flows", "/policies/authenticationFlowsPolicy"),
        ("externalIdentities", "External identities", "/policies/externalIdentitiesPolicy"),
    ];
    let client = GraphClient::new();
    let mut rows = Vec::new();
    for (key, name, path) in SETTINGS {
        let mut row = match client.fetch_plain::<Value>(access_token, path, "beta").await {
            // authorizationPolicy answers as a one-item collection in beta.
            Ok(body) => body["value"].get(0).cloned().unwrap_or(body),
            Err(error) => serde_json::json!({ "error": error.to_string() }),
        };
        if let Some(object) = row.as_object_mut() {
            object.retain(|field, _| !field.starts_with("@odata.context"));
            object.insert("policyId".into(), object.get("id").cloned().unwrap_or(Value::Null));
            object.insert("id".into(), (*key).into());
            object.insert("settingName".into(), (*name).into());
            object.insert("graphPath".into(), (*path).into());
        }
        rows.push(row);
    }
    rows
}

/// Microsoft CA templates, each with the policies that came from it (`matchedPolicies`).
// shortcut: matches templateId, else the template name as the policy name (the portal's default); renamed or hand-built equivalents read as missing. Compare conditions and grants if that misleads.
async fn ca_templates(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let mut templates: Vec<Value> =
        client.fetch_all_pages(access_token, "/identity/conditionalAccess/templates", "beta", INVENTORY_LIST_MAX + 1).await?;
    let policies: Vec<Value> = client
        .fetch_all_pages(access_token, "/identity/conditionalAccess/policies?$select=id,displayName,state,templateId", "beta", INVENTORY_LIST_MAX + 1)
        .await?;
    for template in &mut templates {
        let id = template["id"].as_str().unwrap_or_default().to_string();
        let name = template["name"].as_str().unwrap_or_default().to_lowercase();
        let matched: Vec<Value> = policies
            .iter()
            .filter(|policy| {
                policy["templateId"].as_str() == Some(id.as_str())
                    || policy["displayName"].as_str().is_some_and(|value| value.to_lowercase() == name)
            })
            .map(|policy| serde_json::json!({ "id": policy["id"], "displayName": policy["displayName"], "state": policy["state"] }))
            .collect();
        template["matchedPolicies"] = Value::Array(matched);
    }
    Ok(templates)
}

/// Intune RBAC roles, each with its assignments (`assignments`: members, scopeMembers, scopeType).
async fn intune_roles(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let mut roles: Vec<Value> =
        client.fetch_all_pages(access_token, "/deviceManagement/roleDefinitions", "beta", INVENTORY_LIST_MAX + 1).await?;
    let assignments: Vec<Value> = client
        .fetch_all_pages(access_token, "/deviceManagement/roleAssignments?$expand=roleDefinition", "beta", INVENTORY_LIST_MAX + 1)
        .await?;
    for role in &mut roles {
        let mine: Vec<Value> = assignments
            .iter()
            .filter(|assignment| assignment["roleDefinition"]["id"] == role["id"])
            .map(|assignment| {
                let mut assignment = assignment.clone();
                if let Some(object) = assignment.as_object_mut() {
                    object.remove("roleDefinition");
                }
                assignment
            })
            .collect();
        role["assignments"] = Value::Array(mine);
    }
    Ok(roles)
}

/// Intune partner connectors in one list. `connectorType`, `name`, `state` and `lastSeen` are
/// normalised across the sources; `id` is `{connectorType}:{id}`.
// shortcut: a source that fails is skipped silently; show an error row like tenant_settings if a missing connector confuses anyone.
async fn intune_connectors(access_token: &str) -> Vec<Value> {
    const SOURCES: &[(&str, &str)] = &[
        ("Mobile Threat Defense", "/deviceManagement/mobileThreatDefenseConnectors"),
        ("Device management partner", "/deviceManagement/deviceManagementPartners"),
        ("Remote assistance", "/deviceManagement/remoteAssistancePartners"),
        ("Certificate connector (NDES)", "/deviceManagement/ndesConnectors"),
    ];
    let client = GraphClient::new();
    let mut rows = Vec::new();
    for (kind, path) in SOURCES {
        let Ok(items) = client.fetch_all_pages::<Value>(access_token, path, "beta", INVENTORY_LIST_MAX + 1).await else {
            continue;
        };
        for mut row in items {
            let pick = |keys: &[&str]| keys.iter().find_map(|key| row.get(*key).filter(|value| !value.is_null()).cloned()).unwrap_or(Value::Null);
            let name = pick(&["partnerDisplayName", "displayName", "machineName"]);
            let state = pick(&["partnerState", "onboardingStatus", "state"]);
            let last_seen = pick(&["lastHeartbeatDateTime", "lastConnectionDateTime"]);
            let id = format!("{kind}:{}", row["id"].as_str().unwrap_or_default());
            if let Some(object) = row.as_object_mut() {
                object.insert("connectorId".into(), object.get("id").cloned().unwrap_or(Value::Null));
                object.insert("id".into(), id.into());
                object.insert("connectorType".into(), (*kind).into());
                object.insert("name".into(), name);
                object.insert("state".into(), state);
                object.insert("lastSeen".into(), last_seen);
            }
            rows.push(row);
        }
    }
    rows
}

/// App configuration policies for managed devices and managed apps, tagged with `configType`.
async fn app_configurations(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let mut rows = Vec::new();
    for (kind, path) in [
        ("Managed devices", "/deviceAppManagement/mobileAppConfigurations"),
        ("Managed apps", "/deviceAppManagement/targetedManagedAppConfigurations"),
    ] {
        for mut row in client.fetch_all_pages::<Value>(access_token, path, "beta", INVENTORY_LIST_MAX + 1).await? {
            row["configType"] = kind.into();
            rows.push(row);
        }
    }
    Ok(rows)
}

/// True when an enabled subscription has an enabled service plan starting with one of `prefixes`.
async fn has_service_plan(access_token: &str, prefixes: &[&str]) -> Result<bool, GraphError> {
    let skus: Vec<Value> = GraphClient::new()
        .fetch_all_pages(access_token, "/subscribedSkus?$select=capabilityStatus,servicePlans", "beta", 500)
        .await?;
    Ok(skus.iter().filter(|sku| sku["capabilityStatus"] == "Enabled").any(|sku| {
        sku["servicePlans"].as_array().into_iter().flatten().any(|plan| {
            plan["provisioningStatus"] != "Disabled"
                && plan["servicePlanName"]
                    .as_str()
                    .is_some_and(|name| prefixes.iter().any(|prefix| name.starts_with(prefix)))
        })
    }))
}

/// Latest DeviceInfo row per Defender for Endpoint device, through advanced hunting
/// (a Graph token, unlike the WindowsDefenderATP API). Hunting keeps 30 days.
async fn defender_devices(access_token: &str) -> Result<Vec<Value>, GraphError> {
    // Without Defender for Endpoint the DeviceInfo table doesn't exist and hunting answers a bare 400.
    if !has_service_plan(access_token, &["WINDEFATP", "MDE_"]).await? {
        return Err(GraphError::Request {
            status: 403,
            code: Some("NotLicensed".into()),
            message: "This tenant has no Defender for Endpoint licence (WINDEFATP or MDE service plan), so there is no device inventory to read.".into(),
            permission_related: false,
        });
    }
    const QUERY: &str = "DeviceInfo
| where Timestamp > ago(30d)
| summarize arg_max(Timestamp, *) by DeviceId
| project DeviceId, DeviceName, OSPlatform, OSVersion, OSBuild, OnboardingStatus, SensorHealthState, ExposureLevel, DeviceType, DeviceCategory, JoinType, AadDeviceId, MachineGroup, PublicIP, LoggedOnUsers, LastSeen = Timestamp
| order by DeviceName asc";
    let response: Value = GraphClient::new()
        .post(access_token, "/security/runHuntingQuery", "v1.0", &serde_json::json!({ "Query": QUERY }))
        .await?;
    Ok(response["results"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|mut row| {
            if let (Some(id), Some(object)) = (field(&row, "DeviceId"), row.as_object_mut()) {
                object.insert("id".into(), Value::String(id));
            }
            row
        })
        .take(INVENTORY_LIST_MAX + 1)
        .collect())
}
