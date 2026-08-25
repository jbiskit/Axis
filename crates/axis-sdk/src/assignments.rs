use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::graph::{GraphClient, GraphCollection, GraphError};

const GROUP_SELECT: &str = "id,displayName,groupTypes,membershipRule,membershipRuleProcessingState";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssignmentTargetKind {
    AllUsers,
    AllDevices,
    Group,
    ExclusionGroup,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssignmentFilterMode {
    Include,
    Exclude,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssignmentIntent {
    Available,
    Required,
    Uninstall,
}

/// How an Entra group is populated. Dynamic user vs device is inferred from
/// `membershipRule` (`user.` vs `device.`) because Graph has no separate
/// membership-type enum on `microsoft.graph.group`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GroupMembershipKind {
    Assigned,
    DynamicUser,
    DynamicDevice,
    Dynamic,
}

/// Membership kinds that Graph can create for an Intune assignment group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CreateGroupMembership {
    Assigned,
    DynamicUser,
    DynamicDevice,
}

pub const DYNAMIC_USER_RULE_TEMPLATE: &str = r#"(user.department -eq "Finance")"#;
pub const DYNAMIC_DEVICE_RULE_TEMPLATE: &str = r#"(device.deviceOSType -eq "Windows")"#;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDirectoryGroupInput {
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub membership: CreateGroupMembership,
    #[serde(default)]
    pub membership_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryGroup {
    pub id: String,
    pub display_name: String,
    pub membership: GroupMembershipKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentFilter {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_filter_management_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentDraft {
    pub target_kind: AssignmentTargetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_membership: Option<GroupMembershipKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_mode: Option<AssignmentFilterMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent: Option<AssignmentIntent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentCapabilities {
    pub writable: bool,
    pub supports_intent: bool,
    pub supports_filters: bool,
}

#[derive(Deserialize)]
struct GraphGroup {
    id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(default, rename = "groupTypes")]
    group_types: Vec<String>,
    #[serde(rename = "membershipRule")]
    membership_rule: Option<String>,
    #[serde(rename = "membershipRuleProcessingState")]
    membership_rule_processing_state: Option<String>,
}

impl From<GraphGroup> for DirectoryGroup {
    fn from(group: GraphGroup) -> Self {
        let membership = classify_group_membership(
            &group.group_types,
            group.membership_rule.as_deref(),
            group.membership_rule_processing_state.as_deref(),
        );
        DirectoryGroup {
            id: group.id,
            display_name: group.display_name,
            membership,
            membership_rule: group.membership_rule,
        }
    }
}

pub fn classify_group_membership(
    group_types: &[String],
    membership_rule: Option<&str>,
    processing_state: Option<&str>,
) -> GroupMembershipKind {
    let rule = membership_rule.unwrap_or("").trim();
    let dynamic = group_types
        .iter()
        .any(|value| value.eq_ignore_ascii_case("DynamicMembership"))
        || !rule.is_empty()
        || processing_state
            .is_some_and(|state| !state.eq_ignore_ascii_case("None") && !state.is_empty());
    if !dynamic {
        return GroupMembershipKind::Assigned;
    }

    let lower = rule.to_ascii_lowercase();
    let user_at = lower.find("user.");
    let device_at = lower.find("device.");
    match (user_at, device_at) {
        (Some(_), None) => GroupMembershipKind::DynamicUser,
        (None, Some(_)) => GroupMembershipKind::DynamicDevice,
        (Some(user), Some(device)) => {
            if device < user {
                GroupMembershipKind::DynamicDevice
            } else {
                GroupMembershipKind::DynamicUser
            }
        }
        (None, None) => GroupMembershipKind::Dynamic,
    }
}

pub fn assignment_capabilities(kind: &str) -> AssignmentCapabilities {
    match kind {
        "configurationPolicy"
        | "compliancePolicy"
        | "deviceConfiguration"
        | "groupPolicyConfiguration"
        | "windowsUpdate:rings"
        | "script:platform-powershell"
        | "script:platform-shell"
        | "script:remediation" => AssignmentCapabilities {
            writable: true,
            supports_intent: false,
            supports_filters: true,
        },
        "mobileApp" => AssignmentCapabilities {
            writable: true,
            supports_intent: true,
            supports_filters: true,
        },
        _ => AssignmentCapabilities {
            writable: false,
            supports_intent: false,
            supports_filters: true,
        },
    }
}

pub fn drafts_from_graph_assignments(rows: &[Value], include_intent: bool) -> Vec<AssignmentDraft> {
    rows.iter()
        .filter_map(|row| draft_from_graph_assignment(row, include_intent))
        .collect()
}

fn draft_from_graph_assignment(row: &Value, include_intent: bool) -> Option<AssignmentDraft> {
    let target = row.get("target")?;
    let odata = target
        .get("@odata.type")
        .and_then(Value::as_str)
        .unwrap_or("");
    let group_id = target
        .get("groupId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let filter_id = target
        .get("deviceAndAppManagementAssignmentFilterId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let filter_type = target
        .get("deviceAndAppManagementAssignmentFilterType")
        .and_then(Value::as_str)
        .unwrap_or("");
    let filter_mode = match filter_type {
        "include" => Some(AssignmentFilterMode::Include),
        "exclude" => Some(AssignmentFilterMode::Exclude),
        _ if filter_id.is_some() => Some(AssignmentFilterMode::Include),
        _ => None,
    };
    let intent = if include_intent {
        match row
            .get("intent")
            .and_then(Value::as_str)
            .unwrap_or("available")
        {
            "required" => Some(AssignmentIntent::Required),
            "uninstall" => Some(AssignmentIntent::Uninstall),
            _ => Some(AssignmentIntent::Available),
        }
    } else {
        None
    };

    let mut draft = if odata.contains("allLicensedUsersAssignmentTarget") {
        AssignmentDraft {
            target_kind: AssignmentTargetKind::AllUsers,
            group_id: None,
            group_name: None,
            group_membership: None,
            filter_id,
            filter_name: None,
            filter_mode,
            intent,
        }
    } else if odata.contains("allDevicesAssignmentTarget") {
        AssignmentDraft {
            target_kind: AssignmentTargetKind::AllDevices,
            group_id: None,
            group_name: None,
            group_membership: None,
            filter_id,
            filter_name: None,
            filter_mode,
            intent,
        }
    } else if odata.contains("exclusionGroupAssignmentTarget") {
        AssignmentDraft {
            target_kind: AssignmentTargetKind::ExclusionGroup,
            group_id,
            group_name: None,
            group_membership: None,
            filter_id: None,
            filter_name: None,
            filter_mode: None,
            intent,
        }
    } else if odata.contains("groupAssignmentTarget") {
        AssignmentDraft {
            target_kind: AssignmentTargetKind::Group,
            group_id,
            group_name: None,
            group_membership: None,
            filter_id,
            filter_name: None,
            filter_mode,
            intent,
        }
    } else {
        return None;
    };

    if draft.target_kind == AssignmentTargetKind::ExclusionGroup {
        draft.filter_id = None;
        draft.filter_mode = None;
    }
    Some(draft)
}

pub async fn search_directory_groups(
    access_token: &str,
    query: &str,
) -> Result<Vec<DirectoryGroup>, GraphError> {
    let q = query.trim();
    if q.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let client = GraphClient::new();
    let search_term = q.replace('"', "");
    let search = urlencoding::encode(&format!("\"displayName:{search_term}\"")).into_owned();
    let search_path =
        format!("/groups?$count=true&$search={search}&$select={GROUP_SELECT}&$top=25");
    match client
        .fetch::<GraphCollection<GraphGroup>>(access_token, &search_path, "v1.0")
        .await
    {
        Ok(page) => Ok(sort_groups(page.value)),
        Err(_) => {
            let escaped = q.replace('\'', "''");
            let filter =
                urlencoding::encode(&format!("startswith(displayName,'{escaped}')")).into_owned();
            let fallback = format!("/groups?$filter={filter}&$select={GROUP_SELECT}&$top=25");
            let page = client
                .fetch_plain::<GraphCollection<GraphGroup>>(access_token, &fallback, "v1.0")
                .await?;
            Ok(sort_groups(page.value))
        }
    }
}

pub fn sanitize_mail_nickname(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(64)
        .collect()
}

pub fn mail_nickname_from_display_name(display_name: &str) -> String {
    let cleaned = sanitize_mail_nickname(display_name);
    if cleaned.is_empty() {
        "group".to_string()
    } else {
        cleaned
    }
}

pub fn membership_rule_template(membership: CreateGroupMembership) -> Option<&'static str> {
    match membership {
        CreateGroupMembership::Assigned => None,
        CreateGroupMembership::DynamicUser => Some(DYNAMIC_USER_RULE_TEMPLATE),
        CreateGroupMembership::DynamicDevice => Some(DYNAMIC_DEVICE_RULE_TEMPLATE),
    }
}

fn input_error(message: impl Into<String>) -> GraphError {
    GraphError::Request {
        status: 400,
        code: Some("BadRequest".into()),
        message: message.into(),
        permission_related: false,
    }
}

fn resolved_membership_rule(
    membership: CreateGroupMembership,
    membership_rule: Option<&str>,
) -> Result<Option<String>, GraphError> {
    match membership {
        CreateGroupMembership::Assigned => Ok(None),
        CreateGroupMembership::DynamicUser | CreateGroupMembership::DynamicDevice => {
            let rule = membership_rule
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or_else(|| membership_rule_template(membership).map(str::to_string))
                .ok_or_else(|| input_error("A membership rule is required for dynamic groups."))?;
            let kind =
                classify_group_membership(&["DynamicMembership".into()], Some(&rule), Some("On"));
            match (membership, kind) {
                (CreateGroupMembership::DynamicUser, GroupMembershipKind::DynamicUser) => {
                    Ok(Some(rule))
                }
                (CreateGroupMembership::DynamicDevice, GroupMembershipKind::DynamicDevice) => {
                    Ok(Some(rule))
                }
                (CreateGroupMembership::DynamicUser, _) => Err(input_error(
                    "Dynamic user groups need a user.* membership rule (for example user.department).",
                )),
                (CreateGroupMembership::DynamicDevice, _) => Err(input_error(
                    "Dynamic device groups need a device.* membership rule (for example device.deviceOSType).",
                )),
                (CreateGroupMembership::Assigned, _) => Ok(None),
            }
        }
    }
}

pub fn directory_group_create_body(input: &CreateDirectoryGroupInput) -> Result<Value, GraphError> {
    let display_name = input.display_name.trim();
    if display_name.is_empty() {
        return Err(input_error("Group name is required."));
    }
    let mail_nickname = mail_nickname_from_display_name(display_name);
    let rule = resolved_membership_rule(input.membership, input.membership_rule.as_deref())?;

    let mut body = json!({
        "displayName": display_name,
        "mailEnabled": false,
        "mailNickname": mail_nickname,
        "securityEnabled": true,
    });
    if let Some(description) = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["description"] = json!(description);
    }
    if let Some(rule) = rule {
        body["groupTypes"] = json!(["DynamicMembership"]);
        body["membershipRule"] = json!(rule);
        body["membershipRuleProcessingState"] = json!("On");
    }
    Ok(body)
}

/// Create a security group for Intune assignment (assigned or dynamic).
pub async fn create_directory_group(
    access_token: &str,
    input: CreateDirectoryGroupInput,
) -> Result<DirectoryGroup, GraphError> {
    let body = directory_group_create_body(&input)?;
    let created: GraphGroup = GraphClient::new()
        .post(access_token, "/groups", "v1.0", &body)
        .await?;
    if created.id.is_empty() || created.display_name.is_empty() {
        return Err(input_error(
            "Group was created but Graph returned an incomplete response.",
        ));
    }
    let mut group = DirectoryGroup::from(created);
    group.membership = match input.membership {
        CreateGroupMembership::Assigned => GroupMembershipKind::Assigned,
        CreateGroupMembership::DynamicUser => GroupMembershipKind::DynamicUser,
        CreateGroupMembership::DynamicDevice => GroupMembershipKind::DynamicDevice,
    };
    if group.membership != GroupMembershipKind::Assigned {
        group.membership_rule = body
            .get("membershipRule")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(group.membership_rule);
    }
    Ok(group)
}

pub async fn resolve_directory_groups(
    access_token: &str,
    group_ids: &[String],
) -> Result<Vec<DirectoryGroup>, GraphError> {
    let client = GraphClient::new();
    let mut unique = Vec::new();
    for id in group_ids {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        if !unique.iter().any(|existing: &String| existing == id) {
            unique.push(id.to_string());
        }
    }
    let mut groups = Vec::new();
    for id in unique {
        let path = format!(
            "/groups/{}?$select={GROUP_SELECT}",
            urlencoding::encode(&id)
        );
        match client
            .fetch_plain::<GraphGroup>(access_token, &path, "v1.0")
            .await
        {
            Ok(group) => groups.push(DirectoryGroup::from(group)),
            Err(_) => continue,
        }
    }
    Ok(groups)
}

pub fn apply_group_metadata(drafts: &mut [AssignmentDraft], groups: &[DirectoryGroup]) {
    for draft in drafts {
        let Some(id) = draft.group_id.as_deref() else {
            continue;
        };
        if let Some(group) = groups.iter().find(|group| group.id == id) {
            draft.group_name = Some(group.display_name.clone());
            draft.group_membership = Some(group.membership);
        }
    }
}

pub fn apply_filter_names(drafts: &mut [AssignmentDraft], filters: &[AssignmentFilter]) {
    for draft in drafts {
        let Some(id) = draft.filter_id.as_deref() else {
            continue;
        };
        if let Some(filter) = filters.iter().find(|filter| filter.id == id) {
            draft.filter_name = Some(filter.display_name.clone());
        }
    }
}

pub async fn list_assignment_filters(
    access_token: &str,
) -> Result<Vec<AssignmentFilter>, GraphError> {
    let page = GraphClient::new()
        .fetch_plain::<GraphCollection<Value>>(
            access_token,
            "/deviceManagement/assignmentFilters?$select=id,displayName,platform,assignmentFilterManagementType,rule&$top=100",
            "beta",
        )
        .await?;
    let mut filters: Vec<AssignmentFilter> = page
        .value
        .into_iter()
        .filter_map(|row| {
            let id = row.get("id")?.as_str()?.to_string();
            let display_name = row.get("displayName")?.as_str()?.to_string();
            Some(AssignmentFilter {
                id,
                display_name,
                platform: row
                    .get("platform")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                assignment_filter_management_type: row
                    .get("assignmentFilterManagementType")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                rule: row.get("rule").and_then(Value::as_str).map(str::to_string),
            })
        })
        .collect();
    filters.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(filters)
}

pub async fn assign_object_assignments(
    access_token: &str,
    kind: &str,
    id: &str,
    drafts: &[AssignmentDraft],
    object_odata_type: Option<&str>,
) -> Result<(), GraphError> {
    let spec = assign_spec(kind, id, object_odata_type)?;
    let assignments: Vec<Value> = drafts
        .iter()
        .map(|draft| build_assignment_body(draft, &spec))
        .collect::<Result<_, _>>()?;
    let body = json!({ spec.collection_name: assignments });
    GraphClient::new()
        .post_no_content(access_token, &spec.path, "beta", &body)
        .await
}

struct AssignSpec {
    path: String,
    collection_name: &'static str,
    assignment_odata: &'static str,
    include_intent: bool,
    remediation: bool,
    app_settings_kind: Option<&'static str>,
}

fn assign_spec(
    kind: &str,
    id: &str,
    object_odata_type: Option<&str>,
) -> Result<AssignSpec, GraphError> {
    let enc = urlencoding::encode(id).into_owned();
    Ok(match kind {
        "configurationPolicy" => AssignSpec {
            path: format!("/deviceManagement/configurationPolicies/{enc}/assign"),
            collection_name: "assignments",
            assignment_odata: "#microsoft.graph.deviceManagementConfigurationPolicyAssignment",
            include_intent: false,
            remediation: false,
            app_settings_kind: None,
        },
        "compliancePolicy" => AssignSpec {
            path: format!("/deviceManagement/deviceCompliancePolicies/{enc}/assign"),
            collection_name: "assignments",
            assignment_odata: "#microsoft.graph.deviceCompliancePolicyAssignment",
            include_intent: false,
            remediation: false,
            app_settings_kind: None,
        },
        "deviceConfiguration" | "windowsUpdate:rings" => AssignSpec {
            path: format!("/deviceManagement/deviceConfigurations/{enc}/assign"),
            collection_name: "assignments",
            assignment_odata: "#microsoft.graph.deviceConfigurationAssignment",
            include_intent: false,
            remediation: false,
            app_settings_kind: None,
        },
        "groupPolicyConfiguration" => AssignSpec {
            path: format!("/deviceManagement/groupPolicyConfigurations/{enc}/assign"),
            collection_name: "assignments",
            assignment_odata: "#microsoft.graph.groupPolicyConfigurationAssignment",
            include_intent: false,
            remediation: false,
            app_settings_kind: None,
        },
        "mobileApp" => AssignSpec {
            path: format!("/deviceAppManagement/mobileApps/{enc}/assign"),
            collection_name: "mobileAppAssignments",
            assignment_odata: "#microsoft.graph.mobileAppAssignment",
            include_intent: true,
            remediation: false,
            app_settings_kind: Some(
                if object_odata_type
                    .is_some_and(|value| value.to_ascii_lowercase().contains("winget"))
                {
                    "winget"
                } else {
                    "win32"
                },
            ),
        },
        "script:platform-powershell" | "script:platform-shell" => AssignSpec {
            path: format!(
                "/deviceManagement/{}{enc}/assign",
                if kind.ends_with("shell") {
                    "deviceShellScripts/"
                } else {
                    "deviceManagementScripts/"
                }
            ),
            collection_name: "deviceManagementScriptAssignments",
            assignment_odata: "#microsoft.graph.deviceManagementScriptAssignment",
            include_intent: false,
            remediation: false,
            app_settings_kind: None,
        },
        "script:remediation" => AssignSpec {
            path: format!("/deviceManagement/deviceHealthScripts/{enc}/assign"),
            collection_name: "deviceHealthScriptAssignments",
            assignment_odata: "#microsoft.graph.deviceHealthScriptAssignment",
            include_intent: false,
            remediation: true,
            app_settings_kind: None,
        },
        other => {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: format!("Assignment writes are not wired for kind: {other}"),
                permission_related: false,
            });
        }
    })
}

fn build_assignment_body(draft: &AssignmentDraft, spec: &AssignSpec) -> Result<Value, GraphError> {
    let mut body = json!({
        "@odata.type": spec.assignment_odata,
        "target": target_from_draft(draft)?,
    });
    if spec.include_intent {
        let intent = draft.intent.unwrap_or(AssignmentIntent::Available);
        let intent = match intent {
            AssignmentIntent::Required => "required",
            AssignmentIntent::Uninstall => "uninstall",
            AssignmentIntent::Available => "available",
        };
        body.as_object_mut()
            .expect("object")
            .insert("intent".into(), json!(intent));
        let settings = match spec.app_settings_kind {
            Some("winget") => json!({
                "@odata.type": "#microsoft.graph.winGetAppAssignmentSettings",
                "notifications": "showAll",
            }),
            _ => json!({
                "@odata.type": "#microsoft.graph.win32LobAppAssignmentSettings",
                "notifications": "showAll",
                "deliveryOptimizationPriority": "notConfigured",
            }),
        };
        body.as_object_mut()
            .expect("object")
            .insert("settings".into(), settings);
    }
    if spec.remediation {
        let object = body.as_object_mut().expect("object");
        object.insert("runRemediationScript".into(), json!(true));
        object.insert(
            "runSchedule".into(),
            json!({
                "@odata.type": "#microsoft.graph.deviceHealthScriptDailySchedule",
                "interval": 1,
                "time": "08:00:00",
                "useUtc": false,
            }),
        );
    }
    Ok(body)
}

fn target_from_draft(draft: &AssignmentDraft) -> Result<Value, GraphError> {
    let filter = filter_fields(draft);
    Ok(match draft.target_kind {
        AssignmentTargetKind::AllUsers => json!({
            "@odata.type": "#microsoft.graph.allLicensedUsersAssignmentTarget",
            "deviceAndAppManagementAssignmentFilterId": filter.0,
            "deviceAndAppManagementAssignmentFilterType": filter.1,
        }),
        AssignmentTargetKind::AllDevices => json!({
            "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget",
            "deviceAndAppManagementAssignmentFilterId": filter.0,
            "deviceAndAppManagementAssignmentFilterType": filter.1,
        }),
        AssignmentTargetKind::ExclusionGroup => {
            let group_id = draft
                .group_id
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| GraphError::Request {
                    status: 400,
                    code: None,
                    message: "Exclusion group requires a group id.".into(),
                    permission_related: false,
                })?;
            json!({
                "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget",
                "groupId": group_id,
                "deviceAndAppManagementAssignmentFilterId": Value::Null,
                "deviceAndAppManagementAssignmentFilterType": "none",
            })
        }
        AssignmentTargetKind::Group => {
            let group_id = draft
                .group_id
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| GraphError::Request {
                    status: 400,
                    code: None,
                    message: "Group assignment requires a group id.".into(),
                    permission_related: false,
                })?;
            json!({
                "@odata.type": "#microsoft.graph.groupAssignmentTarget",
                "groupId": group_id,
                "deviceAndAppManagementAssignmentFilterId": filter.0,
                "deviceAndAppManagementAssignmentFilterType": filter.1,
            })
        }
    })
}

fn filter_fields(draft: &AssignmentDraft) -> (Value, &'static str) {
    if draft.target_kind == AssignmentTargetKind::ExclusionGroup || draft.filter_id.is_none() {
        return (Value::Null, "none");
    }
    let mode = match draft.filter_mode.unwrap_or(AssignmentFilterMode::Include) {
        AssignmentFilterMode::Exclude => "exclude",
        AssignmentFilterMode::Include => "include",
    };
    (json!(draft.filter_id.clone()), mode)
}

fn sort_groups(groups: Vec<GraphGroup>) -> Vec<DirectoryGroup> {
    let mut mapped: Vec<DirectoryGroup> = groups
        .into_iter()
        .filter(|group| !group.id.is_empty() && !group.display_name.is_empty())
        .map(DirectoryGroup::from)
        .collect();
    mapped.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    mapped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assigned_when_no_dynamic_markers() {
        assert_eq!(
            classify_group_membership(&["Unified".into()], None, None),
            GroupMembershipKind::Assigned
        );
    }

    #[test]
    fn dynamic_user_from_rule() {
        assert_eq!(
            classify_group_membership(
                &["DynamicMembership".into()],
                Some(r#"(user.department -eq "Finance")"#),
                Some("On"),
            ),
            GroupMembershipKind::DynamicUser
        );
    }

    #[test]
    fn dynamic_device_from_rule() {
        assert_eq!(
            classify_group_membership(
                &["DynamicMembership".into()],
                Some(r#"(device.deviceOSType -eq "Windows")"#),
                Some("On"),
            ),
            GroupMembershipKind::DynamicDevice
        );
    }

    #[test]
    fn dynamic_unknown_without_user_or_device_token() {
        assert_eq!(
            classify_group_membership(
                &["DynamicMembership".into()],
                Some("(true -eq true)"),
                Some("On"),
            ),
            GroupMembershipKind::Dynamic
        );
    }

    #[test]
    fn parse_include_group_and_all_users() {
        let rows = vec![
            json!({
                "target": {
                    "@odata.type": "#microsoft.graph.allLicensedUsersAssignmentTarget",
                    "deviceAndAppManagementAssignmentFilterId": "filter-1",
                    "deviceAndAppManagementAssignmentFilterType": "include"
                }
            }),
            json!({
                "target": {
                    "@odata.type": "#microsoft.graph.groupAssignmentTarget",
                    "groupId": "g1"
                }
            }),
            json!({
                "target": {
                    "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget",
                    "groupId": "g2",
                    "deviceAndAppManagementAssignmentFilterId": "should-ignore"
                }
            }),
        ];
        let drafts = drafts_from_graph_assignments(&rows, false);
        assert_eq!(drafts.len(), 3);
        assert_eq!(drafts[0].target_kind, AssignmentTargetKind::AllUsers);
        assert_eq!(drafts[0].filter_id.as_deref(), Some("filter-1"));
        assert_eq!(drafts[1].target_kind, AssignmentTargetKind::Group);
        assert_eq!(drafts[1].group_id.as_deref(), Some("g1"));
        assert_eq!(drafts[2].target_kind, AssignmentTargetKind::ExclusionGroup);
        assert!(drafts[2].filter_id.is_none());
    }

    #[test]
    fn configuration_policy_is_writable() {
        let caps = assignment_capabilities("configurationPolicy");
        assert!(caps.writable);
        assert!(!caps.supports_intent);
    }

    #[test]
    fn assigned_create_body_is_security_group() {
        let body = directory_group_create_body(&CreateDirectoryGroupInput {
            display_name: "  Contoso pilots  ".into(),
            description: Some("Pilot ring".into()),
            membership: CreateGroupMembership::Assigned,
            membership_rule: Some("ignored".into()),
        })
        .unwrap();
        assert_eq!(body["displayName"], "Contoso pilots");
        assert_eq!(body["mailNickname"], "Contosopilots");
        assert_eq!(body["mailEnabled"], false);
        assert_eq!(body["securityEnabled"], true);
        assert_eq!(body["description"], "Pilot ring");
        assert!(body.get("groupTypes").is_none());
        assert!(body.get("membershipRule").is_none());
    }

    #[test]
    fn create_body_derives_mail_nickname_fallback() {
        let body = directory_group_create_body(&CreateDirectoryGroupInput {
            display_name: " — ".into(),
            description: None,
            membership: CreateGroupMembership::Assigned,
            membership_rule: None,
        })
        .unwrap();
        assert_eq!(body["mailNickname"], "group");
    }

    #[test]
    fn dynamic_user_create_uses_user_template() {
        let body = directory_group_create_body(&CreateDirectoryGroupInput {
            display_name: "Finance users".into(),
            description: None,
            membership: CreateGroupMembership::DynamicUser,
            membership_rule: None,
        })
        .unwrap();
        assert_eq!(body["groupTypes"], json!(["DynamicMembership"]));
        assert_eq!(body["membershipRule"], DYNAMIC_USER_RULE_TEMPLATE);
        assert_eq!(body["membershipRuleProcessingState"], "On");
    }

    #[test]
    fn dynamic_device_rejects_user_rule() {
        let error = directory_group_create_body(&CreateDirectoryGroupInput {
            display_name: "Windows devices".into(),
            description: None,
            membership: CreateGroupMembership::DynamicDevice,
            membership_rule: Some(r#"(user.department -eq "Finance")"#.into()),
        })
        .unwrap_err();
        assert!(error.to_string().contains("device.*"));
    }
}
