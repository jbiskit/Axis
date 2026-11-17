//! Effective user coverage for Conditional Access: who each policy's user
//! assignment actually reaches once groups (nested), role holders and guest
//! conditions are expanded and exclusions removed. Counts are enabled accounts.
//! App and condition scoping (locations, platforms, …) is not factored in.

use std::collections::{HashMap, HashSet};

use chrono::Utc;
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::graph::{GraphClient, GraphError};
use crate::review::fetch_review_objects;

/// Per user or member list. Past this the counts are a floor (`truncated`).
const MEMBER_MAX: usize = 200_000;
const LOOKUP_CONCURRENCY: usize = 6;
const SAMPLE_MAX: usize = 50;

const INCLUDE_KEYS: [&str; 4] = ["includeUsers", "includeGroups", "includeRoles", "includeGuestsOrExternalUsers"];
const EXCLUDE_KEYS: [&str; 4] = ["excludeUsers", "excludeGroups", "excludeRoles", "excludeGuestsOrExternalUsers"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyUserCoverage {
    pub id: String,
    /// Enabled accounts the policy applies to after exclusions.
    pub covered: usize,
    /// Enabled accounts the include side reaches that exclusions take out.
    pub excluded: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageGap {
    pub count: usize,
    /// Up to 50 "Name (upn)" entries, sorted.
    pub sample: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionalAccessCoverage {
    /// Enabled accounts (members and guests).
    pub user_count: usize,
    pub guest_count: usize,
    pub policies: Vec<PolicyUserCoverage>,
    /// Enabled accounts no enabled policy applies to.
    pub uncovered: CoverageGap,
    /// Enabled accounts no enabled MFA or authentication-strength policy applies to.
    pub without_mfa: CoverageGap,
    /// A user or member list hit the cap, so counts are a floor.
    pub truncated: bool,
    pub warnings: Vec<String>,
    pub fetched_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserRow {
    id: String,
    display_name: Option<String>,
    user_principal_name: Option<String>,
    user_type: Option<String>,
    account_enabled: Option<bool>,
}

fn strs(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default()
}

fn is_guid(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Graph lookups the coverage needs, keyed by group or role id.
struct Directory {
    /// Enabled user id → index into `users`.
    index: HashMap<String, usize>,
    enabled: Vec<usize>,
    guests: Vec<usize>,
    /// Group id → transitive member user ids.
    groups: HashMap<String, Vec<String>>,
    /// Role template id → active assignment principal ids (users or role-assignable groups).
    roles: HashMap<String, Vec<String>>,
}

impl Directory {
    fn add_user(&self, id: &str, out: &mut HashSet<usize>) {
        if let Some(&index) = self.index.get(id) {
            out.insert(index);
        }
    }

    fn add_group(&self, id: &str, out: &mut HashSet<usize>) {
        for member in self.groups.get(id).into_iter().flatten() {
            self.add_user(member, out);
        }
    }

    /// One side (include or exclude) of a policy's user assignment.
    fn audience(&self, users: &Value, [user_key, group_key, role_key, guest_key]: [&str; 4]) -> HashSet<usize> {
        let mut out = HashSet::new();
        let ids = strs(&users[user_key]);
        if ids.iter().any(|id| id == "All") {
            out.extend(self.enabled.iter().copied());
            return out;
        }
        // shortcut: guest/external conditions count every enabled Guest account; the per-type split isn't modelled.
        if ids.iter().any(|id| id == "GuestsOrExternalUsers") || !users[guest_key].is_null() {
            out.extend(self.guests.iter().copied());
        }
        for id in &ids {
            self.add_user(id, &mut out);
        }
        for group in strs(&users[group_key]) {
            self.add_group(&group, &mut out);
        }
        for role in strs(&users[role_key]) {
            for principal in self.roles.get(&role).into_iter().flatten() {
                self.add_user(principal, &mut out);
                self.add_group(principal, &mut out);
            }
        }
        out
    }
}

fn requires_mfa(policy: &Value) -> bool {
    let grant = &policy["grantControls"];
    strs(&grant["builtInControls"]).iter().any(|control| control == "mfa") || grant["authenticationStrength"]["id"].is_string()
}

fn gap(users: &[UserRow], enabled: &[usize], covered: &[bool]) -> CoverageGap {
    let missing: Vec<usize> = enabled.iter().copied().filter(|&index| !covered[index]).collect();
    let mut sample: Vec<String> = missing
        .iter()
        .take(SAMPLE_MAX)
        .map(|&index| {
            let user = &users[index];
            match (&user.display_name, &user.user_principal_name) {
                (Some(name), Some(upn)) if name != upn => format!("{name} ({upn})"),
                (_, Some(upn)) => upn.clone(),
                (Some(name), None) => name.clone(),
                _ => user.id.clone(),
            }
        })
        .collect();
    sample.sort_by_key(|entry| entry.to_lowercase());
    CoverageGap { count: missing.len(), sample }
}

/// One string field from every row of a paged collection.
async fn ids(client: &GraphClient, access_token: &str, path: String, key: &str) -> Result<Vec<String>, GraphError> {
    let rows: Vec<Value> = client.fetch_all_pages(access_token, &path, "beta", MEMBER_MAX + 1).await?;
    Ok(rows.iter().filter_map(|row| row[key].as_str()).map(str::to_string).collect())
}

pub async fn fetch_conditional_access_coverage(access_token: &str) -> Result<ConditionalAccessCoverage, GraphError> {
    let client = GraphClient::new();
    let mut warnings = Vec::new();
    let policies = fetch_review_objects(access_token, "conditionalAccessPolicy").await?.items;
    let users: Vec<UserRow> = client
        .fetch_all_pages(
            access_token,
            "/users?$select=id,displayName,userPrincipalName,userType,accountEnabled&$top=999",
            "beta",
            MEMBER_MAX + 1,
        )
        .await?;
    let mut truncated = users.len() > MEMBER_MAX;

    let enabled: Vec<usize> = (0..users.len()).filter(|&index| users[index].account_enabled != Some(false)).collect();
    let index: HashMap<String, usize> = enabled.iter().map(|&index| (users[index].id.clone(), index)).collect();
    let guests: Vec<usize> = enabled.iter().copied().filter(|&index| users[index].user_type.as_deref() == Some("Guest")).collect();

    let mut group_ids: HashSet<String> = HashSet::new();
    let mut role_ids: HashSet<String> = HashSet::new();
    for policy in &policies {
        let users = &policy["conditions"]["users"];
        group_ids.extend([strs(&users["includeGroups"]), strs(&users["excludeGroups"])].concat());
        role_ids.extend([strs(&users["includeRoles"]), strs(&users["excludeRoles"])].concat());
    }

    let role_results: Vec<(String, Result<Vec<String>, GraphError>)> = stream::iter(role_ids.into_iter().filter(|id| is_guid(id)))
        .map(|role| {
            let client = &client;
            async move {
                let path = format!("/roleManagement/directory/roleAssignments?$filter=roleDefinitionId eq '{role}'&$select=principalId");
                let result = ids(client, access_token, path, "principalId").await;
                (role, result)
            }
        })
        .buffer_unordered(LOOKUP_CONCURRENCY)
        .collect()
        .await;
    let mut roles = HashMap::new();
    for (role, result) in role_results {
        match result {
            Ok(principals) => {
                // Role-assignable groups hold roles too; expand any principal that isn't a user.
                group_ids.extend(principals.iter().filter(|id| !index.contains_key(*id)).cloned());
                roles.insert(role, principals);
            }
            Err(error) => warnings.push(format!("Role {role}: {error}")),
        }
    }

    let group_results: Vec<(String, Result<Vec<String>, GraphError>)> = stream::iter(group_ids.into_iter().filter(|id| is_guid(id)))
        .map(|group| {
            let client = &client;
            async move {
                let path = format!("/groups/{group}/transitiveMembers/microsoft.graph.user?$select=id&$top=999");
                let result = ids(client, access_token, path, "id").await;
                (group, result)
            }
        })
        .buffer_unordered(LOOKUP_CONCURRENCY)
        .collect()
        .await;
    let mut groups = HashMap::new();
    for (group, result) in group_results {
        match result {
            Ok(members) => {
                truncated |= members.len() > MEMBER_MAX;
                groups.insert(group, members);
            }
            // Deleted groups, and role principals that turned out to be service principals.
            Err(GraphError::Request { status: 404, .. }) => {}
            Err(error) => warnings.push(format!("Group {group}: {error}")),
        }
    }

    let directory = Directory { index, enabled, guests, groups, roles };
    let mut covered_any = vec![false; users.len()];
    let mut covered_mfa = vec![false; users.len()];
    let coverage = policies
        .iter()
        .filter_map(|policy| {
            let id = policy["id"].as_str()?.to_string();
            let assignment = &policy["conditions"]["users"];
            let include = directory.audience(assignment, INCLUDE_KEYS);
            let exclude = directory.audience(assignment, EXCLUDE_KEYS);
            let covered: Vec<usize> = include.difference(&exclude).copied().collect();
            if policy["state"] == "enabled" {
                let mfa = requires_mfa(policy);
                for &index in &covered {
                    covered_any[index] = true;
                    covered_mfa[index] |= mfa;
                }
            }
            Some(PolicyUserCoverage { id, covered: covered.len(), excluded: include.intersection(&exclude).count() })
        })
        .collect();

    Ok(ConditionalAccessCoverage {
        user_count: directory.enabled.len(),
        guest_count: directory.guests.len(),
        policies: coverage,
        uncovered: gap(&users, &directory.enabled, &covered_any),
        without_mfa: gap(&users, &directory.enabled, &covered_mfa),
        truncated,
        warnings,
        fetched_at: Utc::now().to_rfc3339(),
    })
}

/// Recent sign-ins with each policy's evaluation (`appliedConditionalAccessPolicies`).
/// `search` narrows to UPNs starting with it.
pub async fn fetch_conditional_access_sign_ins(access_token: &str, search: &str) -> Result<Vec<Value>, GraphError> {
    let search = search.trim().replace('\'', "''");
    let filter = if search.is_empty() { String::new() } else { format!("&$filter=startswith(userPrincipalName,'{search}')") };
    let path = format!("/auditLogs/signIns?$top=50{filter}");
    let page: Value = GraphClient::new().fetch_plain(access_token, &path, "beta").await?;
    Ok(page["value"].as_array().cloned().unwrap_or_default())
}

/// Microsoft's what-if evaluator. `request` is the `evaluate` body; a UPN in
/// `signInIdentity.userId` is resolved to the object id first.
pub async fn evaluate_conditional_access(access_token: &str, mut request: Value) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    if let Some(user) = request["signInIdentity"]["userId"].as_str().filter(|id| id.contains('@')).map(str::to_string) {
        let user = user.replace('#', "%23");
        let found: Value = client.fetch_plain(access_token, &format!("/users/{user}?$select=id"), "beta").await?;
        request["signInIdentity"]["userId"] = found["id"].clone();
    }
    let result: Value = client.post(access_token, "/identity/conditionalAccess/evaluate", "beta", &request).await?;
    Ok(result["value"].as_array().cloned().unwrap_or_default())
}
