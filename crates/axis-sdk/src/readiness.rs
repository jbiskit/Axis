//! Tenant and per-user checks for the conditions Intune needs before enrollment.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{json, Value};

use crate::assignments::resolve_directory_groups;
use crate::graph::{GraphClient, GraphCollection, GraphError};

const INTUNE_MDM_ID: &str = "0000000a-0000-0000-c000-000000000000";

const PORTAL_PLATFORMS: &[(&str, &str)] = &[
    ("androidRestriction", "Android (device administrator)"),
    ("androidForWorkRestriction", "Android Enterprise"),
    ("iosRestriction", "iOS/iPadOS"),
    ("macOSRestriction", "macOS"),
    ("windowsRestriction", "Windows"),
    ("visionOSRestriction", "visionOS"),
    ("tvosRestriction", "tvOS"),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessReport {
    pub automatic_enrollment: ReadinessSection,
    pub cname: ReadinessSection,
    pub platform_restrictions: ReadinessSection,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserReadinessReport {
    pub id: String,
    pub display_name: String,
    pub user_principal_name: String,
    pub result: ReadinessSection,
    pub automatic_enrollment: ReadinessSection,
    pub device_limit: ReadinessSection,
    pub platform_restrictions: ReadinessSection,
    pub licenses: ReadinessSection,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessUserHit {
    pub id: String,
    pub display_name: String,
    pub user_principal_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessSection {
    /// `pass`, `warn`, or `fail`.
    pub status: String,
    pub title: String,
    pub summary: String,
    pub rows: Vec<ReadinessRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessRow {
    pub label: String,
    pub value: String,
    /// `pass`, `warn`, `fail`, or `info`.
    pub status: String,
    /// `fact`, `stat`, `group`, `domain`, `platform`, `userPlatform`, `override`, or `license`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

fn readiness_row(
    kind: &str,
    label: impl Into<String>,
    value: impl Into<String>,
    status: &str,
    detail: Option<String>,
) -> ReadinessRow {
    ReadinessRow {
        label: label.into(),
        value: value.into(),
        status: status.into(),
        kind: kind.into(),
        detail,
    }
}

#[derive(Clone)]
struct MdmPolicy {
    applies_to: String,
    groups: Vec<(String, String)>,
    prompt_during_registration: bool,
}

enum AssignmentHit {
    AllUsers,
    Group(String),
    Exclude(String),
}

struct LimitConfig {
    name: String,
    limit: i64,
    priority: i64,
    is_default: bool,
    targets: Vec<AssignmentHit>,
}

pub async fn fetch_intune_readiness(access_token: &str) -> Result<ReadinessReport, GraphError> {
    let (mdm, domains, configs) = tokio::join!(
        load_mdm_policy(access_token),
        load_verified_domains(access_token),
        load_enrollment_configs(access_token),
    );
    let cname = match domains {
        Ok(domains) => check_cnames(access_token, &domains).await,
        Err(error) => failed_section("CNAME Validation", error),
    };
    let platform_restrictions = match configs {
        Ok(configs) => platform_section(access_token, &configs).await,
        Err(error) => failed_section("Device platform restrictions", error),
    };
    Ok(ReadinessReport {
        automatic_enrollment: match mdm {
            Ok(policy) => enrollment_section(&policy),
            Err(error) => failed_section("Automatic enrollment", error),
        },
        cname,
        platform_restrictions,
    })
}

pub async fn search_readiness_users(
    access_token: &str,
    query: &str,
) -> Result<Vec<ReadinessUserHit>, GraphError> {
    let q = query.trim().replace(['"', '\\', '\n', '\r'], "");
    if q.chars().count() < 2 {
        return Err(input_error("Enter at least two characters."));
    }
    let search = format!(
        "\"displayName:{q}\" OR \"userPrincipalName:{q}\" OR \"mail:{q}\""
    );
    let path = format!(
        "/users?$search={}&$select=id,displayName,userPrincipalName&$top=15&$count=true",
        urlencoding::encode(&search)
    );
    let page: GraphCollection<Value> = GraphClient::new()
        .fetch(access_token, &path, "v1.0")
        .await?;
    let mut users = Vec::new();
    for row in page.value {
        let Some(id) = text(&row, "id") else { continue };
        users.push(ReadinessUserHit {
            id,
            display_name: text(&row, "displayName").unwrap_or_else(|| "Untitled".into()),
            user_principal_name: text(&row, "userPrincipalName").unwrap_or_default(),
        });
    }
    Ok(users)
}

pub async fn fetch_user_readiness(
    access_token: &str,
    user_id: &str,
) -> Result<UserReadinessReport, GraphError> {
    let user_id = user_id.trim();
    if !is_guid(user_id) {
        return Err(input_error("Choose a user from the search results."));
    }
    let encoded = urlencoding::encode(user_id);
    let user: Value = GraphClient::new()
        .fetch_plain(
            access_token,
            &format!("/users/{encoded}?$select=id,displayName,userPrincipalName"),
            "v1.0",
        )
        .await?;
    let user_principal_name = text(&user, "userPrincipalName").unwrap_or_default();
    let (mdm, configs, licenses, devices) = tokio::join!(
        load_mdm_policy(access_token),
        load_enrollment_configs(access_token),
        load_license_details(access_token, user_id),
        load_enrolled_count(access_token, &user_principal_name),
    );
    let limits = configs
        .as_ref()
        .map(|rows| limit_configs(rows))
        .unwrap_or_default();
    let mut group_ids = Vec::new();
    if let Ok(policy) = &mdm {
        if policy.applies_to == "selected" {
            group_ids.extend(policy.groups.iter().map(|(id, _)| id.clone()));
        }
    }
    for limit in &limits {
        for target in &limit.targets {
            match target {
                AssignmentHit::Group(id) | AssignmentHit::Exclude(id) => group_ids.push(id.clone()),
                AssignmentHit::AllUsers => {}
            }
        }
    }
    if let Ok(rows) = configs.as_ref() {
        for config in rows {
            if !(is_single_platform(config) || is_default_platform(config)) {
                continue;
            }
            for target in assignment_hits(config) {
                match target {
                    AssignmentHit::Group(id) | AssignmentHit::Exclude(id) => group_ids.push(id),
                    AssignmentHit::AllUsers => {}
                }
            }
        }
    }
    let membership = match member_group_ids(access_token, user_id, &group_ids).await {
        Ok(ids) => Ok(ids),
        Err(error) => Err(error.to_string()),
    };
    let membership_view = membership.as_ref().map_err(String::as_str);
    let config_error = configs.as_ref().err().map(ToString::to_string);
    let names = match configs.as_ref() {
        Ok(rows) => group_names(access_token, rows).await,
        Err(_) => HashMap::new(),
    };
    let platform_rules = configs
        .as_ref()
        .map(|rows| platform_rules(rows))
        .unwrap_or_default();

    let automatic_enrollment = user_enrollment_section(mdm, membership_view);
    let device_limit = user_limit_section(config_error.as_deref(), &limits, membership_view, devices);
    let platform_restrictions = user_platform_section(
        config_error.as_deref(),
        &platform_rules,
        membership_view,
        &names,
    );
    let licenses = license_section(licenses);
    let result = user_result(
        &automatic_enrollment,
        &device_limit,
        &platform_restrictions,
        &licenses,
    );
    Ok(UserReadinessReport {
        id: text(&user, "id").unwrap_or_else(|| user_id.to_string()),
        display_name: text(&user, "displayName").unwrap_or_else(|| "Untitled".into()),
        user_principal_name: text(&user, "userPrincipalName").unwrap_or_default(),
        result,
        automatic_enrollment,
        device_limit,
        platform_restrictions,
        licenses,
    })
}

fn user_result(
    enrollment: &ReadinessSection,
    limit: &ReadinessSection,
    platforms: &ReadinessSection,
    licenses: &ReadinessSection,
) -> ReadinessSection {
    let checks = [
        ("Automatic enrollment", enrollment),
        ("Device limit", limit),
        ("Device platform restrictions", platforms),
        ("Licenses", licenses),
    ];
    let fails = checks.iter().any(|(_, section)| section.status == "fail");
    let warns = checks.iter().any(|(_, section)| section.status == "warn");
    let (status, summary) = if fails {
        ("fail", "This user cannot enroll.")
    } else if warns {
        ("warn", "This user needs a review before enrollment.")
    } else {
        ("pass", "This user can enroll.")
    };
    let rows = checks
        .iter()
        .map(|(title, section)| {
            let value = match section.status.as_str() {
                "pass" => "Ready",
                "warn" => "Review",
                _ => "Not ready",
            };
            readiness_row("result", *title, value, &section.status, Some(section.summary.clone()))
        })
        .collect();
    ReadinessSection {
        status: status.into(),
        title: "Result".into(),
        summary: summary.into(),
        rows,
    }
}

fn enrollment_section(policy: &MdmPolicy) -> ReadinessSection {
    let scope = scope_label(&policy.applies_to);
    let mut rows = vec![readiness_row(
        "fact",
        "MDM user scope",
        scope.clone(),
        if policy.applies_to == "none" { "fail" } else { "pass" },
        None,
    )];
    for (_id, name) in &policy.groups {
        rows.push(readiness_row("group", name, "Included", "info", None));
    }
    rows.push(readiness_row(
        "fact",
        "Prompt to enroll during registration",
        if policy.prompt_during_registration { "Yes" } else { "No" },
        "info",
        None,
    ));
    let (status, summary) = match policy.applies_to.as_str() {
        "all" => ("pass", "MDM user scope is All.".to_string()),
        "selected" if policy.groups.is_empty() => (
            "fail",
            "MDM user scope is Some, and no groups are included.".to_string(),
        ),
        "selected" => (
            "pass",
            format!(
                "MDM user scope is Some, covering {} group{}.",
                policy.groups.len(),
                if policy.groups.len() == 1 { "" } else { "s" }
            ),
        ),
        "none" => ("fail", "MDM user scope is None.".to_string()),
        _ => ("warn", format!("MDM user scope is {scope}.")),
    };
    ReadinessSection {
        status: status.into(),
        title: "Automatic enrollment".into(),
        summary,
        rows,
    }
}

async fn check_cnames(access_token: &str, domains: &[VerifiedDomain]) -> ReadinessSection {
    let mut rows = Vec::new();
    let mut custom = 0usize;
    let mut failed = 0usize;
    for domain in domains {
        if domain.name.to_ascii_lowercase().ends_with(".onmicrosoft.com") {
            if domain.is_initial {
                rows.push(readiness_row(
                    "domain",
                    domain.name.clone(),
                    "Not required",
                    "info",
                    Some("Initial domain. A CNAME is not used.".into()),
                ));
            }
            continue;
        }
        custom += 1;
        if !domain_name_ok(&domain.name) {
            failed += 1;
            rows.push(readiness_row(
                "domain",
                domain.name.clone(),
                "Not valid",
                "fail",
                Some("Domain name cannot be sent to CNAME validation.".into()),
            ));
            continue;
        }
        match verify_cname(access_token, &domain.name).await {
            Ok(true) => rows.push(readiness_row("domain", domain.name.clone(), "Valid", "pass", None)),
            Ok(false) => {
                failed += 1;
                rows.push(readiness_row(
                    "domain",
                    domain.name.clone(),
                    "Not valid",
                    "fail",
                    Some(format!(
                        "EnterpriseEnrollment.{} should point to EnterpriseEnrollment-s.manage.microsoft.com. EnterpriseRegistration.{} should point to EnterpriseRegistration.windows.net.",
                        domain.name, domain.name
                    )),
                ));
            }
            Err(error) => {
                failed += 1;
                rows.push(readiness_row(
                    "domain",
                    domain.name.clone(),
                    "Not valid",
                    "fail",
                    Some(error.to_string()),
                ));
            }
        }
    }
    let (status, summary) = if custom == 0 {
        (
            "pass",
            "No custom verified domain. CNAME records are only required for custom domains.".into(),
        )
    } else if failed == 0 {
        (
            "pass",
            format!(
                "CNAME validation passed for {custom} custom domain{}.",
                if custom == 1 { "" } else { "s" }
            ),
        )
    } else {
        (
            "fail",
            format!(
                "CNAME validation failed for {failed} of {custom} custom domain{}.",
                if custom == 1 { "" } else { "s" }
            ),
        )
    };
    ReadinessSection {
        status: status.into(),
        title: "CNAME Validation".into(),
        summary,
        rows,
    }
}

async fn platform_section(access_token: &str, configs: &[Value]) -> ReadinessSection {
    let names = group_names(access_token, configs).await;
    let mut rows = Vec::new();
    let mut windows_blocked = false;
    let mut windows_seen = false;
    let mut windows_override_blocks = 0usize;
    let mut all_users_windows_block = false;

    let defaults: Vec<_> = configs.iter().filter(|row| is_default_platform(row)).collect();
    let many_defaults = defaults.len() > 1;
    for config in defaults {
        let name = text(config, "displayName").unwrap_or_else(|| "Default".into());
        for (key, label) in PORTAL_PLATFORMS {
            let Some(blob) = config.get(*key).filter(|value| value.is_object()) else {
                continue;
            };
            let blocked = blob.get("platformBlocked").and_then(Value::as_bool) == Some(true);
            let personal = blob
                .get("personalDeviceEnrollmentBlocked")
                .and_then(Value::as_bool)
                == Some(true);
            if *key == "windowsRestriction" {
                windows_seen = true;
                windows_blocked = blocked;
            }
            let shown = if many_defaults {
                format!("{name} · {label}")
            } else {
                (*label).to_string()
            };
            rows.push(readiness_row(
                "platform",
                shown,
                if blocked { "Block" } else { "Allow" },
                if *key == "windowsRestriction" && blocked { "fail" } else { "info" },
                Some(if personal { "Block" } else { "Allow" }.into()),
            ));
        }
    }

    for config in configs.iter().filter(|row| is_single_platform(row)) {
        let platform = text(config, "platformType").unwrap_or_default();
        let label = platform_type_label(&platform);
        let blocked = config
            .get("platformRestriction")
            .and_then(|blob| blob.get("platformBlocked"))
            .and_then(Value::as_bool)
            == Some(true);
        let name = text(config, "displayName").unwrap_or_else(|| label.clone());
        let targets = assignment_hits(config);
        let audience = audience_label(&targets, &names);
        let windows = platform.eq_ignore_ascii_case("windows");
        if windows && blocked {
            windows_override_blocks += 1;
            if targets.iter().any(|hit| matches!(hit, AssignmentHit::AllUsers)) {
                all_users_windows_block = true;
            }
        }
        rows.push(readiness_row(
            "override",
            name,
            if blocked { "Block" } else { "Allow" },
            if windows && blocked { "warn" } else { "info" },
            Some(format!("{label} · {audience}")),
        ));
    }

    let (status, summary) = if !windows_seen {
        (
            "warn",
            "The default device platform restriction did not include Windows.".into(),
        )
    } else if windows_blocked || all_users_windows_block {
        (
            "fail",
            "Windows MDM is blocked.".into(),
        )
    } else if windows_override_blocks > 0 {
        (
            "pass",
            format!(
                "Windows MDM is allowed on the default restriction. {windows_override_blocks} restriction{} block Windows for a narrower assignment.",
                if windows_override_blocks == 1 { "" } else { "s" }
            ),
        )
    } else {
        ("pass", "Windows MDM is allowed on the default restriction.".into())
    };
    ReadinessSection {
        status: status.into(),
        title: "Device platform restrictions".into(),
        summary,
        rows,
    }
}

fn user_enrollment_section(
    mdm: Result<MdmPolicy, GraphError>,
    membership: Result<&HashSet<String>, &str>,
) -> ReadinessSection {
    let policy = match mdm {
        Ok(policy) => policy,
        Err(error) => return failed_section("Automatic enrollment", error),
    };
    match policy.applies_to.as_str() {
        "all" => ReadinessSection {
            status: "pass".into(),
            title: "Automatic enrollment".into(),
            summary: "MDM user scope is All. This user is included.".into(),
            rows: vec![readiness_row("fact", "MDM user scope", "All", "pass", None)],
        },
        "none" => ReadinessSection {
            status: "fail".into(),
            title: "Automatic enrollment".into(),
            summary: "MDM user scope is None. This user will not automatically enroll.".into(),
            rows: vec![readiness_row("fact", "MDM user scope", "None", "fail", None)],
        },
        "selected" => {
            let members = match membership {
                Ok(ids) => ids,
                Err(error) => {
                    return ReadinessSection {
                        status: "warn".into(),
                        title: "Automatic enrollment".into(),
                        summary: format!("MDM user scope is Some. Group membership could not be checked. {error}"),
                        rows: policy
                            .groups
                            .iter()
                            .map(|(_, name)| readiness_row("group", name, "Included", "info", None))
                            .collect(),
                    };
                }
            };
            let matched: Vec<_> = policy
                .groups
                .iter()
                .filter(|(id, _)| group_hit(members, id))
                .map(|(_, name)| name.clone())
                .collect();
            let mut rows: Vec<_> = policy
                .groups
                .iter()
                .map(|(id, name)| {
                    let member = group_hit(members, id);
                    readiness_row(
                        "group",
                        name,
                        if member { "In group" } else { "Not in group" },
                        if member { "pass" } else { "info" },
                        None,
                    )
                })
                .collect();
            if policy.groups.is_empty() {
                rows.push(readiness_row("group", "Some groups", "None included", "fail", None));
            }
            let (status, summary) = if !matched.is_empty() {
                (
                    "pass",
                    format!(
                        "This user is in {} for automatic enrollment.",
                        matched.join(", ")
                    ),
                )
            } else if policy.groups.is_empty() {
                (
                    "fail",
                    "MDM user scope is Some, and no groups are included.".into(),
                )
            } else {
                (
                    "fail",
                    "This user is not in the Some groups for automatic enrollment.".into(),
                )
            };
            ReadinessSection {
                status: status.into(),
                title: "Automatic enrollment".into(),
                summary,
                rows,
            }
        }
        other => ReadinessSection {
            status: "warn".into(),
            title: "Automatic enrollment".into(),
            summary: format!("MDM user scope is {}.", scope_label(other)),
            rows: vec![],
        },
    }
}

fn user_limit_section(
    config_error: Option<&str>,
    limits: &[LimitConfig],
    membership: Result<&HashSet<String>, &str>,
    devices: Result<DeviceCount, GraphError>,
) -> ReadinessSection {
    if let Some(error) = config_error {
        return ReadinessSection {
            status: "fail".into(),
            title: "Device limit".into(),
            summary: error.to_string(),
            rows: vec![],
        };
    }
    let (members, membership_error) = match membership {
        Ok(ids) => (ids.clone(), None),
        Err(error) => (HashSet::new(), Some(error)),
    };
    let Some(applicable) = applicable_limit(limits, &members) else {
        return ReadinessSection {
            status: "warn".into(),
            title: "Device limit".into(),
            summary: "No device limit restriction was found.".into(),
            rows: vec![],
        };
    };
    let why = if membership_error.is_some() && applicable.is_default {
        "Default restriction. A group assignment could not be checked, so a higher-priority limit may still apply.".to_string()
    } else if applicable.is_default {
        "Default restriction".to_string()
    } else if applicable
        .targets
        .iter()
        .any(|hit| matches!(hit, AssignmentHit::AllUsers))
    {
        "Assigned to all users".to_string()
    } else {
        "Assigned to a group this user is in".to_string()
    };
    let mut rows = vec![
        readiness_row("stat", "Limit", applicable.limit.to_string(), "info", None),
        readiness_row("fact", "Restriction", applicable.name.clone(), "info", None),
        readiness_row("fact", "Applies because", why, "info", None),
    ];
    match devices {
        Ok(count) => {
            let at_limit = applicable.limit > 0 && count.at_least >= applicable.limit;
            let value = if count.truncated {
                format!("{} or more", count.at_least)
            } else {
                count.at_least.to_string()
            };
            rows.insert(
                0,
                readiness_row(
                    "stat",
                    "Enrolled",
                    value,
                    if at_limit { "fail" } else { "pass" },
                    None,
                ),
            );
            let summary = if at_limit {
                format!(
                    "This user has {} enrolled devices. The limit on {} is {}.",
                    if count.truncated {
                        format!("{} or more", count.at_least)
                    } else {
                        count.at_least.to_string()
                    },
                    applicable.name,
                    applicable.limit
                )
            } else {
                format!(
                    "This user has {} enrolled device{}. The limit on {} is {}.",
                    count.at_least,
                    if count.at_least == 1 { "" } else { "s" },
                    applicable.name,
                    applicable.limit
                )
            };
            ReadinessSection {
                status: if membership_error.is_some() {
                    "warn"
                } else if at_limit {
                    "fail"
                } else {
                    "pass"
                }
                .into(),
                title: "Device limit".into(),
                summary,
                rows,
            }
        }
        Err(error) => {
            rows.insert(
                0,
                readiness_row("stat", "Enrolled", "Unknown", "warn", Some(error.to_string())),
            );
            ReadinessSection {
                status: "warn".into(),
                title: "Device limit".into(),
                summary: format!(
                    "The applicable limit on {} is {}. The enrolled device count could not be loaded.",
                    applicable.name, applicable.limit
                ),
                rows,
            }
        }
    }
}

fn license_section(licenses: Result<Vec<Value>, GraphError>) -> ReadinessSection {
    let details = match licenses {
        Ok(details) => details,
        Err(error) => return failed_section("Licenses", error),
    };
    let mut rows = Vec::new();
    let mut full = false;
    let mut office = false;
    for detail in &details {
        let sku = text(detail, "skuPartNumber").unwrap_or_else(|| "License".into());
        let Some(plans) = detail.get("servicePlans").and_then(Value::as_array) else {
            continue;
        };
        for plan in plans {
            let name = text(plan, "servicePlanName").unwrap_or_default();
            let upper = name.to_ascii_uppercase();
            if !upper.starts_with("INTUNE") {
                continue;
            }
            let status = text(plan, "provisioningStatus").unwrap_or_default();
            let active = status.eq_ignore_ascii_case("Success");
            if active && upper == "INTUNE_A" {
                full = true;
            } else if active && upper == "INTUNE_O365" {
                office = true;
            } else if active {
                full = true;
            }
            rows.push(readiness_row(
                "license",
                sku.clone(),
                intune_plan_label(&upper),
                if active { "pass" } else { "info" },
                Some(status),
            ));
        }
    }
    let (status, summary) = if full {
        ("pass", "An Intune license is assigned.".into())
    } else if office {
        (
            "warn",
            "Mobile Device Management for Office 365 is assigned. Microsoft Intune (INTUNE_A) is not.".into(),
        )
    } else if rows.is_empty() {
        ("fail", "No Intune license is assigned.".into())
    } else {
        ("fail", "An Intune service plan is on the user, and it is not active.".into())
    };
    ReadinessSection {
        status: status.into(),
        title: "Licenses".into(),
        summary,
        rows,
    }
}

fn applicable_limit<'a>(limits: &'a [LimitConfig], members: &HashSet<String>) -> Option<&'a LimitConfig> {
    let mut matches: Vec<_> = limits
        .iter()
        .filter(|config| !config.is_default && config_applies(config, members))
        .collect();
    matches.sort_by(|a, b| {
        a.priority
            .cmp(&b.priority)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    if let Some(config) = matches.first() {
        return Some(*config);
    }
    limits.iter().find(|config| config.is_default)
}

fn config_applies(config: &LimitConfig, members: &HashSet<String>) -> bool {
    targets_apply(&config.targets, members)
}

fn targets_apply(targets: &[AssignmentHit], members: &HashSet<String>) -> bool {
    let excluded = targets.iter().any(|hit| match hit {
        AssignmentHit::Exclude(id) => group_hit(members, id),
        _ => false,
    });
    if excluded {
        return false;
    }
    targets.iter().any(|hit| match hit {
        AssignmentHit::AllUsers => true,
        AssignmentHit::Group(id) => group_hit(members, id),
        AssignmentHit::Exclude(_) => false,
    })
}

fn group_hit(members: &HashSet<String>, id: &str) -> bool {
    members.contains(&id.to_ascii_lowercase())
}

struct PlatformRule {
    name: String,
    platform_label: String,
    windows: bool,
    blocked: bool,
    priority: i64,
    is_default: bool,
    targets: Vec<AssignmentHit>,
}

fn platform_rules(configs: &[Value]) -> Vec<PlatformRule> {
    let mut rules = Vec::new();
    for config in configs.iter().filter(|row| is_default_platform(row)) {
        let name = text(config, "displayName").unwrap_or_else(|| "Default".into());
        for (key, label) in PORTAL_PLATFORMS {
            let Some(blob) = config.get(*key).filter(|value| value.is_object()) else {
                continue;
            };
            rules.push(PlatformRule {
                name: name.clone(),
                platform_label: (*label).to_string(),
                windows: *key == "windowsRestriction",
                blocked: blob.get("platformBlocked").and_then(Value::as_bool) == Some(true),
                priority: i64::MAX,
                is_default: true,
                targets: assignment_hits(config),
            });
        }
    }
    for config in configs.iter().filter(|row| is_single_platform(row)) {
        let platform = text(config, "platformType").unwrap_or_default();
        let label = platform_type_label(&platform);
        let blocked = config
            .get("platformRestriction")
            .and_then(|blob| blob.get("platformBlocked"))
            .and_then(Value::as_bool)
            == Some(true);
        rules.push(PlatformRule {
            name: text(config, "displayName").unwrap_or_else(|| label.clone()),
            windows: platform.eq_ignore_ascii_case("windows"),
            platform_label: label,
            blocked,
            priority: config.get("priority").and_then(Value::as_i64).unwrap_or(i64::MAX),
            is_default: false,
            targets: assignment_hits(config),
        });
    }
    rules
}

/// Portal priority 1 outranks 2. Priority 0 is the default and only applies when no
/// higher-priority restriction targets this user. A higher-priority Block wins over
/// a default Allow.
fn platform_precedence(rule: &PlatformRule) -> i64 {
    if rule.is_default || rule.priority <= 0 {
        i64::MAX
    } else {
        rule.priority
    }
}

fn applicable_platform<'a>(
    rules: &'a [PlatformRule],
    platform: &str,
    members: &HashSet<String>,
) -> Option<&'a PlatformRule> {
    let mut matches: Vec<_> = rules
        .iter()
        .filter(|rule| rule.platform_label == platform && platform_rule_applies(rule, members))
        .collect();
    matches.sort_by(|a, b| {
        platform_precedence(a)
            .cmp(&platform_precedence(b))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    matches.first().copied()
}

fn platform_rule_applies(rule: &PlatformRule, members: &HashSet<String>) -> bool {
    if rule.is_default {
        return true;
    }
    targets_apply(&rule.targets, members)
}

fn user_platform_section(
    config_error: Option<&str>,
    rules: &[PlatformRule],
    membership: Result<&HashSet<String>, &str>,
    names: &HashMap<String, String>,
) -> ReadinessSection {
    if let Some(error) = config_error {
        return ReadinessSection {
            status: "fail".into(),
            title: "Device platform restrictions".into(),
            summary: error.to_string(),
            rows: vec![],
        };
    }
    let (members, membership_error) = match membership {
        Ok(ids) => (ids.clone(), None),
        Err(error) => (HashSet::new(), Some(error)),
    };
    let labels: Vec<String> = PORTAL_PLATFORMS
        .iter()
        .map(|(_, label)| (*label).to_string())
        .filter(|label| rules.iter().any(|rule| rule.platform_label == *label))
        .collect();
    let mut rows = Vec::new();
    let mut blocked_for_user = Vec::new();
    for label in labels {
        let Some(rule) = applicable_platform(rules, &label, &members) else {
            continue;
        };
        let blocks_user = rule.blocked && (!rule.is_default || rule.windows);
        if blocks_user {
            blocked_for_user.push(label.clone());
        }
        rows.push(readiness_row(
            "userPlatform",
            label,
            if rule.blocked { "Block" } else { "Allow" },
            if blocks_user { "fail" } else { "info" },
            Some(platform_applies_because(rule, &members, names)),
        ));
    }
    let (mut status, summary) = if blocked_for_user.is_empty() {
        (
            "pass",
            "No restriction assigned to this user blocks MDM enrollment.".into(),
        )
    } else {
        (
            "fail",
            format!(
                "MDM enrollment is blocked for {}.",
                blocked_for_user.join(", ")
            ),
        )
    };
    if membership_error.is_some() && status == "pass" {
        status = "warn";
    }
    let summary = if let Some(error) = membership_error {
        format!("{summary} Group membership could not be checked. {error}")
    } else {
        summary
    };
    ReadinessSection {
        status: status.into(),
        title: "Device platform restrictions".into(),
        summary,
        rows,
    }
}

fn platform_applies_because(
    rule: &PlatformRule,
    members: &HashSet<String>,
    names: &HashMap<String, String>,
) -> String {
    if rule.is_default {
        return format!("{} · Default restriction", rule.name);
    }
    if rule.targets.iter().any(|hit| matches!(hit, AssignmentHit::AllUsers)) {
        return format!("{} · priority {} · All users", rule.name, rule.priority);
    }
    let groups: Vec<String> = rule
        .targets
        .iter()
        .filter_map(|hit| match hit {
            AssignmentHit::Group(id) if group_hit(members, id) => {
                Some(names.get(id).cloned().unwrap_or_else(|| "a group".into()))
            }
            _ => None,
        })
        .collect();
    if groups.is_empty() {
        rule.name.clone()
    } else {
        format!("{} · priority {} · {}", rule.name, rule.priority, groups.join(", "))
    }
}

async fn load_mdm_policy(access_token: &str) -> Result<MdmPolicy, GraphError> {
    let page: GraphCollection<Value> = GraphClient::new()
        .fetch_plain(
            access_token,
            "/policies/mobileDeviceManagementPolicies?$expand=includedGroups",
            "beta",
        )
        .await?;
    let policy = page
        .value
        .iter()
        .filter(|row| is_intune_mdm(row))
        .min_by_key(|row| mdm_rank(row))
        .cloned()
        .ok_or_else(|| input_error("Microsoft Intune automatic enrollment policy was not found."))?;
    let applies_to = text(&policy, "appliesTo")
        .unwrap_or_else(|| "none".into())
        .to_ascii_lowercase();
    let mut groups = included_groups(&policy);
    if applies_to == "selected" && groups.is_empty() {
        if let Some(id) = text(&policy, "id") {
            if let Ok(extra) = load_included_groups(access_token, &id).await {
                groups = extra;
            }
        }
    }
    let prompt_during_registration =
        policy.get("isMdmEnrollmentDuringRegistrationDisabled").and_then(Value::as_bool) != Some(true);
    Ok(MdmPolicy {
        applies_to,
        groups,
        prompt_during_registration,
    })
}

async fn load_included_groups(
    access_token: &str,
    policy_id: &str,
) -> Result<Vec<(String, String)>, GraphError> {
    let page: GraphCollection<Value> = GraphClient::new()
        .fetch_plain(
            access_token,
            &format!(
                "/policies/mobileDeviceManagementPolicies/{}/includedGroups?$select=id,displayName",
                urlencoding::encode(policy_id)
            ),
            "beta",
        )
        .await?;
    Ok(page
        .value
        .iter()
        .filter_map(|row| {
            let id = text(row, "id")?;
            let name = text(row, "displayName").unwrap_or_else(|| id.clone());
            Some((id, name))
        })
        .collect())
}

struct VerifiedDomain {
    name: String,
    is_initial: bool,
}

async fn load_verified_domains(access_token: &str) -> Result<Vec<VerifiedDomain>, GraphError> {
    let page: GraphCollection<Value> = GraphClient::new()
        .fetch_plain(access_token, "/organization?$select=verifiedDomains", "v1.0")
        .await?;
    let mut domains = Vec::new();
    for org in &page.value {
        let Some(rows) = org.get("verifiedDomains").and_then(Value::as_array) else {
            continue;
        };
        for row in rows {
            let Some(name) = text(row, "name") else { continue };
            domains.push(VerifiedDomain {
                name,
                is_initial: row.get("isInitial").and_then(Value::as_bool) == Some(true),
            });
        }
    }
    domains.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    domains.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    Ok(domains)
}

async fn verify_cname(access_token: &str, domain: &str) -> Result<bool, GraphError> {
    let path = format!(
        "/deviceManagement/verifyWindowsEnrollmentAutoDiscovery(domainName='{domain}')"
    );
    let client = GraphClient::new();
    let body: Value = match client.fetch_plain(access_token, &path, "beta").await {
        Ok(body) => body,
        Err(error) if error.status() == Some(404) => {
            client.fetch_plain(access_token, &path, "v1.0").await?
        }
        Err(error) => return Err(error),
    };
    if let Some(value) = body.as_bool() {
        return Ok(value);
    }
    body.get("value")
        .and_then(Value::as_bool)
        .ok_or_else(|| input_error("CNAME validation did not return a result."))
}

async fn load_enrollment_configs(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let platform_filter =
        urlencoding::encode("deviceEnrollmentConfigurationType eq 'SinglePlatformRestriction'");
    let limit_filter = urlencoding::encode(
        "(deviceEnrollmentConfigurationType eq 'Limit' or deviceEnrollmentConfigurationType eq 'DefaultLimit')",
    );
    let platform_path = format!(
        "/deviceManagement/deviceEnrollmentConfigurations?$expand=assignments&$orderby=priority&$filter={platform_filter}"
    );
    let limit_path = format!(
        "/deviceManagement/deviceEnrollmentConfigurations?$expand=assignments&$orderby=priority&$filter={limit_filter}"
    );
    let (platforms, limits) = tokio::join!(
        client.fetch_all_pages(access_token, &platform_path, "beta", 200),
        client.fetch_all_pages(access_token, &limit_path, "beta", 200),
    );
    let mut rows = platforms?;
    rows.extend(limits?);
    Ok(rows)
}

struct DeviceCount {
    at_least: i64,
    truncated: bool,
}

async fn load_enrolled_count(
    access_token: &str,
    user_principal_name: &str,
) -> Result<DeviceCount, GraphError> {
    // DeviceFE rejects `$filter=userId eq '...'` as an unsupported parameter.
    // `userPrincipalName` is the filter that list accepts.
    let upn = user_principal_name.trim().replace('\'', "''");
    if upn.is_empty() {
        return Err(input_error(
            "This user has no user principal name, so enrolled devices cannot be counted.",
        ));
    }
    let filter = format!("userPrincipalName eq '{upn}'");
    let path = format!(
        "/deviceManagement/managedDevices?$filter={}&$top=16",
        urlencoding::encode(&filter)
    );
    let page: GraphCollection<Value> = GraphClient::new()
        .fetch_plain_collection(access_token, &path, "beta")
        .await?;
    let at_least = page.value.len() as i64;
    Ok(DeviceCount {
        at_least,
        truncated: page.next_link.is_some() || at_least >= 16,
    })
}

async fn load_license_details(access_token: &str, user_id: &str) -> Result<Vec<Value>, GraphError> {
    GraphClient::new()
        .fetch_all_pages(
            access_token,
            &format!(
                "/users/{}/licenseDetails?$select=skuPartNumber,servicePlans",
                urlencoding::encode(user_id)
            ),
            "v1.0",
            40,
        )
        .await
}

async fn member_group_ids(
    access_token: &str,
    user_id: &str,
    group_ids: &[String],
) -> Result<HashSet<String>, GraphError> {
    let mut unique = Vec::new();
    for id in group_ids {
        let id = id.trim();
        if id.is_empty() || unique.iter().any(|existing: &String| existing == id) {
            continue;
        }
        unique.push(id.to_string());
    }
    let mut members = HashSet::new();
    if unique.is_empty() {
        return Ok(members);
    }
    let client = GraphClient::new();
    let path = format!(
        "/users/{}/checkMemberGroups",
        urlencoding::encode(user_id)
    );
    for chunk in unique.chunks(20) {
        let page: GraphCollection<String> = client
            .post(access_token, &path, "v1.0", &json!({ "groupIds": chunk }))
            .await?;
        members.extend(page.value.into_iter().map(|id| id.to_ascii_lowercase()));
    }
    Ok(members)
}

async fn group_names(access_token: &str, configs: &[Value]) -> HashMap<String, String> {
    let mut ids = Vec::new();
    for config in configs {
        for hit in assignment_hits(config) {
            if let AssignmentHit::Group(id) | AssignmentHit::Exclude(id) = hit {
                ids.push(id);
            }
        }
    }
    let Ok(groups) = resolve_directory_groups(access_token, &ids).await else {
        return HashMap::new();
    };
    groups
        .into_iter()
        .map(|group| (group.id.to_ascii_lowercase(), group.display_name))
        .collect()
}

fn limit_configs(configs: &[Value]) -> Vec<LimitConfig> {
    configs
        .iter()
        .filter(|row| is_limit(row))
        .map(|row| LimitConfig {
            name: text(row, "displayName").unwrap_or_else(|| "Device limit".into()),
            limit: row.get("limit").and_then(Value::as_i64).unwrap_or(0),
            priority: row.get("priority").and_then(Value::as_i64).unwrap_or(i64::MAX),
            is_default: is_default_limit(row),
            targets: assignment_hits(row),
        })
        .collect()
}

fn assignment_hits(config: &Value) -> Vec<AssignmentHit> {
    let Some(rows) = config.get("assignments").and_then(Value::as_array) else {
        return Vec::new();
    };
    rows.iter()
        .filter_map(|row| {
            let target = row.get("target").unwrap_or(row);
            let odata = text(target, "@odata.type")
                .unwrap_or_default()
                .to_ascii_lowercase();
            if odata.contains("exclusiongroup") {
                return assignment_group_id(row, target).map(AssignmentHit::Exclude);
            }
            if odata.contains("alllicensedusers") || odata.contains("allusers") {
                return Some(AssignmentHit::AllUsers);
            }
            assignment_group_id(row, target).map(AssignmentHit::Group)
        })
        .collect()
}

fn assignment_group_id(row: &Value, target: &Value) -> Option<String> {
    if let Some(id) = text(target, "groupId").or_else(|| text(row, "groupId")) {
        return Some(id.to_ascii_lowercase());
    }
    let raw = text(row, "id")?;
    let guids: Vec<String> = raw
        .split('_')
        .filter(|part| is_guid(part))
        .map(|part| part.to_ascii_lowercase())
        .collect();
    if guids.len() >= 2 {
        guids.last().cloned()
    } else {
        None
    }
}

fn audience_label(targets: &[AssignmentHit], names: &HashMap<String, String>) -> String {
    if targets.is_empty() {
        return "Not assigned".into();
    }
    let mut parts = Vec::new();
    if targets.iter().any(|hit| matches!(hit, AssignmentHit::AllUsers)) {
        parts.push("All users".to_string());
    }
    for target in targets {
        if let AssignmentHit::Group(id) = target {
            parts.push(names.get(id).cloned().unwrap_or_else(|| "Group".into()));
        }
    }
    for target in targets {
        if let AssignmentHit::Exclude(id) = target {
            let name = names.get(id).cloned().unwrap_or_else(|| "group".into());
            parts.push(format!("Exclude {name}"));
        }
    }
    if parts.is_empty() {
        "Not assigned".into()
    } else {
        parts.join(", ")
    }
}

fn included_groups(policy: &Value) -> Vec<(String, String)> {
    policy
        .get("includedGroups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let id = text(row, "id")?;
            let name = text(row, "displayName").unwrap_or_else(|| id.clone());
            Some((id, name))
        })
        .collect()
}

fn is_intune_mdm(policy: &Value) -> bool {
    if text(policy, "id").is_some_and(|id| id.eq_ignore_ascii_case(INTUNE_MDM_ID)) {
        return true;
    }
    if text(policy, "displayName").is_some_and(|name| name.eq_ignore_ascii_case("Microsoft Intune")) {
        return true;
    }
    text(policy, "discoveryUrl").is_some_and(|url| {
        url.to_ascii_lowercase()
            .contains("enrollment.manage.microsoft.com")
    })
}

fn mdm_rank(policy: &Value) -> u8 {
    if text(policy, "id").is_some_and(|id| id.eq_ignore_ascii_case(INTUNE_MDM_ID)) {
        0
    } else if text(policy, "displayName")
        .is_some_and(|name| name.eq_ignore_ascii_case("Microsoft Intune"))
    {
        1
    } else {
        2
    }
}

fn is_default_platform(row: &Value) -> bool {
    let id = text(row, "id").unwrap_or_default().to_ascii_lowercase();
    if id.contains("defaultplatformrestrictions") {
        return true;
    }
    let odata = text(row, "@odata.type").unwrap_or_default().to_ascii_lowercase();
    // Plural `PlatformRestrictionsConfiguration` is the default profile. The
    // singular type is a prioritized single-platform restriction. Graph still
    // labels the default row `singlePlatformRestriction`.
    if odata.contains("platformrestrictionsconfiguration") {
        return true;
    }
    if odata.contains("platformrestrictionconfiguration") || id.contains("singleplatformrestriction") {
        return false;
    }
    config_type(row) == "defaultplatformrestrictions"
        || (text(row, "platformType").is_none()
            && row.get("windowsRestriction").is_some_and(Value::is_object))
}

fn is_single_platform(row: &Value) -> bool {
    if is_default_platform(row) {
        return false;
    }
    let id = text(row, "id").unwrap_or_default().to_ascii_lowercase();
    let odata = text(row, "@odata.type").unwrap_or_default().to_ascii_lowercase();
    let kind = config_type(row);
    id.contains("singleplatformrestriction")
        || odata.contains("platformrestrictionconfiguration")
        || kind == "singleplatformrestriction"
        || text(row, "platformType").is_some()
}

fn is_limit(row: &Value) -> bool {
    let haystack = config_haystack(row);
    haystack.contains("deviceenrollmentlimitconfiguration")
        || haystack.contains("defaultlimit")
        || config_type(row) == "limit"
}

fn is_default_limit(row: &Value) -> bool {
    let kind = config_type(row);
    kind == "defaultlimit" || kind.contains("default")
}

fn config_type(row: &Value) -> String {
    text(row, "deviceEnrollmentConfigurationType")
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn config_haystack(row: &Value) -> String {
    format!(
        "{} {} {}",
        text(row, "@odata.type").unwrap_or_default(),
        text(row, "deviceEnrollmentConfigurationType").unwrap_or_default(),
        text(row, "id").unwrap_or_default()
    )
    .to_ascii_lowercase()
}

fn platform_type_label(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "windows" => "Windows".into(),
        "android" => "Android (device administrator)".into(),
        "androidforwork" => "Android Enterprise".into(),
        "ios" => "iOS/iPadOS".into(),
        "macos" | "mac" => "macOS".into(),
        "visionos" => "visionOS".into(),
        "tvos" => "tvOS".into(),
        "" => "Platform".into(),
        other => other.to_string(),
    }
}

fn intune_plan_label(upper: &str) -> String {
    match upper {
        "INTUNE_A" => "Microsoft Intune".into(),
        "INTUNE_O365" => "Mobile Device Management for Office 365".into(),
        other => other.to_string(),
    }
}

fn scope_label(applies_to: &str) -> String {
    match applies_to {
        "none" => "None".into(),
        "all" => "All".into(),
        "selected" => "Some".into(),
        other => other.to_string(),
    }
}

fn domain_name_ok(domain: &str) -> bool {
    !domain.is_empty()
        && domain.len() <= 253
        && !domain.contains("..")
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && domain
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-')
}

fn is_guid(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() || ch == '-')
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn failed_section(title: &str, error: GraphError) -> ReadinessSection {
    ReadinessSection {
        status: "fail".into(),
        title: title.into(),
        summary: error.to_string(),
        rows: vec![],
    }
}

fn input_error(message: impl Into<String>) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: message.into(),
        permission_related: false,
    }
}
