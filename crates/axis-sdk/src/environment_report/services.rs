//! Entra and Purview chapters for the as-built report. Same Graph data as the
//! review pages (`crate::review`), laid out as report cards: metadata, then
//! settings grouped by topic.

use std::collections::HashMap;

use serde_json::Value;

use super::{
    progress, EnvironmentReportProgress, EnvironmentReportSelection, ReportCard, SettingRow, ENTRA_SCOPE,
    PURVIEW_SCOPE, SECTION_CONDITIONAL_ACCESS, SECTION_NAMED_LOCATIONS, SECTION_RETENTION_LABELS,
    SECTION_SENSITIVITY_LABELS, SECTION_SERVICE_OVERVIEW,
};
use crate::ca_coverage::{fetch_conditional_access_coverage, ConditionalAccessCoverage, CoverageGap};
use crate::graph::GraphError;
use crate::review::{fetch_review_objects, resolve_review_names, ReviewReferences};

/// Structural values Graph puts in CA include/exclude lists instead of object ids.
const USER_SPECIAL: &[(&str, &str)] = &[("All", "All users"), ("None", "None"), ("GuestsOrExternalUsers", "Guests or external users")];
const APP_SPECIAL: &[(&str, &str)] = &[
    ("All", "All resources"),
    ("None", "None"),
    ("Office365", "Office 365"),
    ("MicrosoftAdminPortals", "Microsoft admin portals"),
];
const LOCATION_SPECIAL: &[(&str, &str)] = &[
    ("All", "Any location"),
    ("AllTrusted", "All trusted locations"),
    ("00000000-0000-0000-0000-000000000000", "MFA trusted IPs"),
];
const NOT_CONFIGURED: &str = "Not configured";

pub(super) async fn service_cards(
    access_token: &str,
    selection: &EnvironmentReportSelection,
    warnings: &mut Vec<String>,
    on_progress: &impl Fn(EnvironmentReportProgress),
) -> Vec<ReportCard> {
    if !selection.entra && !selection.purview {
        return Vec::new();
    }
    on_progress(progress("services", 0, 0, "Loading Entra and Purview…"));
    let (policies, locations, sensitivity, retention) = tokio::join!(
        list(access_token, selection.entra, "conditionalAccessPolicy"),
        list(access_token, selection.entra, "namedLocation"),
        list(access_token, selection.purview, "sensitivityLabel"),
        list(access_token, selection.purview, "retentionLabel"),
    );
    let policies = rows_or_warn("Conditional Access", policies, warnings);
    let locations = rows_or_warn("Named locations", locations, warnings);
    let sensitivity = rows_or_warn("Sensitivity labels", sensitivity, warnings);
    let retention = rows_or_warn("Retention labels", retention, warnings);
    let wants_coverage = selection.entra && selection.entra_coverage && !policies.is_empty();
    if wants_coverage {
        on_progress(progress("services", 0, 0, "Calculating Conditional Access user coverage…"));
    }
    let (names, coverage) = tokio::join!(
        async {
            if policies.is_empty() {
                HashMap::new()
            } else {
                resolve_review_names(access_token, references(&policies)).await
            }
        },
        async {
            if wants_coverage {
                Some(fetch_conditional_access_coverage(access_token).await)
            } else {
                None
            }
        },
    );
    let coverage = match coverage {
        Some(Ok(coverage)) => {
            warnings.extend(coverage.warnings.iter().map(|warning| format!("User coverage: {warning}")));
            Some(coverage)
        }
        Some(Err(error)) => {
            warnings.push(format!("User coverage: {error}"));
            None
        }
        None => None,
    };

    let overview = (selection.entra && !(policies.is_empty() && locations.is_empty()))
        .then(|| overview_card(&policies, &locations, &names, coverage.as_ref(), wants_coverage));
    let mut cards: Vec<ReportCard> = overview
        .into_iter()
        .chain(policies.iter().map(|policy| policy_card(policy, &names, coverage.as_ref())))
        .chain(locations.iter().map(location_card))
        .chain(sensitivity.iter().map(sensitivity_card))
        .chain(retention.iter().map(retention_card))
        .collect();
    cards.sort_by(|a, b| a.section.cmp(b.section).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    cards
}

async fn list(access_token: &str, wanted: bool, kind: &str) -> Option<Result<Vec<Value>, GraphError>> {
    if !wanted {
        return None;
    }
    Some(fetch_review_objects(access_token, kind).await.map(|list| list.items))
}

fn rows_or_warn(label: &str, result: Option<Result<Vec<Value>, GraphError>>, warnings: &mut Vec<String>) -> Vec<Value> {
    match result {
        Some(Ok(rows)) => rows,
        Some(Err(error)) => {
            warnings.push(format!("{label}: {error}"));
            Vec::new()
        }
        None => Vec::new(),
    }
}

fn references(policies: &[Value]) -> ReviewReferences {
    let mut refs = ReviewReferences::default();
    for policy in policies {
        let conditions = &policy["conditions"];
        let (users, apps, locations) = (&conditions["users"], &conditions["applications"], &conditions["locations"]);
        refs.users.extend([strs(&users["includeUsers"]), strs(&users["excludeUsers"])].concat());
        refs.groups.extend([strs(&users["includeGroups"]), strs(&users["excludeGroups"])].concat());
        refs.roles.extend([strs(&users["includeRoles"]), strs(&users["excludeRoles"])].concat());
        refs.apps.extend([strs(&apps["includeApplications"]), strs(&apps["excludeApplications"])].concat());
        refs.locations.extend([strs(&locations["includeLocations"]), strs(&locations["excludeLocations"])].concat());
    }
    for ids in [&mut refs.users, &mut refs.groups, &mut refs.roles, &mut refs.apps, &mut refs.locations] {
        ids.sort();
        ids.dedup();
    }
    refs
}

fn strs(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default()
}

fn text(row: &Value, key: &str) -> String {
    row[key].as_str().unwrap_or("").to_string()
}

fn date(row: &Value, key: &str) -> String {
    text(row, key).get(..10).unwrap_or("").to_string()
}

fn yes_no(value: bool) -> String {
    (if value { "Yes" } else { "No" }).to_string()
}

/// Graph enum token → words ("retainAsRecord" → "Retain as record", "mfa" → "MFA").
fn humanize(token: &str) -> String {
    let token = token.trim();
    if token.len() <= 3 && token.chars().all(|c| c.is_ascii_lowercase()) {
        return token.to_ascii_uppercase();
    }
    let mut words = String::new();
    let mut prev_lower = false;
    for c in token.chars() {
        if c.is_ascii_uppercase() && prev_lower {
            words.push(' ');
        }
        prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
        words.push(c.to_ascii_lowercase());
    }
    let mut chars = words.chars();
    chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

fn named(ids: &Value, names: &HashMap<String, String>, special: &[(&str, &str)]) -> Vec<String> {
    strs(ids)
        .into_iter()
        .map(|id| {
            special
                .iter()
                .find(|(key, _)| *key == id)
                .map(|(_, label)| label.to_string())
                .or_else(|| names.get(&id).cloned())
                .unwrap_or(id)
        })
        .collect()
}

fn joined(items: &[String]) -> String {
    if items.is_empty() { NOT_CONFIGURED.to_string() } else { items.join(", ") }
}

fn short(items: &[String]) -> String {
    match items.len() {
        0 => "None".into(),
        1..=3 => items.join(", "),
        n => format!("{} +{} more", items[..3].join(", "), n - 3),
    }
}

fn include_exclude(include: Vec<String>, exclude: Vec<String>) -> String {
    [include.join(", "), if exclude.is_empty() { String::new() } else { format!("excluding {}", exclude.join(", ")) }]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("; ")
}

fn guests(value: &Value) -> Vec<String> {
    value["guestOrExternalUserTypes"]
        .as_str()
        .filter(|types| !types.is_empty())
        .map(|types| vec![format!("Guests: {}", types.split(',').map(humanize).collect::<Vec<_>>().join(", "))])
        .unwrap_or_default()
}

fn card(section: &'static str, scope: &str, kind_label: &str, row: &Value, title: String, metadata: Vec<SettingRow>, settings: Vec<SettingRow>) -> ReportCard {
    ReportCard {
        source_id: text(row, "id"),
        section,
        scope: scope.to_string(),
        title,
        description: String::new(),
        platform: scope.to_string(),
        kind_label: kind_label.to_string(),
        drafts: Vec::new(),
        metadata,
        settings,
        code_blocks: Vec::new(),
        stats: None,
        app_install: None,
        note: None,
    }
}

fn condition_rows(conditions: &Value, names: &HashMap<String, String>) -> Vec<SettingRow> {
    let levels = |key: &str| {
        strs(&conditions[key]).iter().filter(|level| *level != "all").map(|level| humanize(level)).collect::<Vec<_>>().join(", ")
    };
    let filter = &conditions["devices"]["deviceFilter"];
    let rows = [
        ("User risk", levels("userRiskLevels")),
        ("Sign-in risk", levels("signInRiskLevels")),
        ("Insider risk", levels("insiderRiskLevels")),
        ("Workload risk", levels("servicePrincipalRiskLevels")),
        ("Client apps", levels("clientAppTypes")),
        (
            "Device platforms",
            include_exclude(strs(&conditions["platforms"]["includePlatforms"]), strs(&conditions["platforms"]["excludePlatforms"])),
        ),
        (
            "Locations",
            include_exclude(
                named(&conditions["locations"]["includeLocations"], names, LOCATION_SPECIAL),
                named(&conditions["locations"]["excludeLocations"], names, LOCATION_SPECIAL),
            ),
        ),
        (
            "Filter for devices",
            filter["rule"]
                .as_str()
                .map(|rule| format!("{} devices matching {rule}", humanize(filter["mode"].as_str().unwrap_or(""))))
                .unwrap_or_default(),
        ),
        ("Authentication flows", conditions["authenticationFlows"]["transferMethods"].as_str().map(humanize).unwrap_or_default()),
    ];
    rows.into_iter().filter(|(_, value)| !value.is_empty()).map(|(name, value)| SettingRow::new(name, value)).collect()
}

fn grant_text(grant: &Value) -> String {
    let controls = strs(&grant["builtInControls"]);
    if controls.iter().any(|control| control == "block") {
        return "Block access".into();
    }
    let mut items: Vec<String> = controls.iter().map(|control| humanize(control)).collect();
    if let Some(name) = grant["authenticationStrength"]["displayName"].as_str() {
        items.push(format!("Authentication strength: {name}"));
    }
    if !strs(&grant["termsOfUse"]).is_empty() {
        items.push("Terms of use".into());
    }
    if !strs(&grant["customAuthenticationFactors"]).is_empty() {
        items.push("Custom controls".into());
    }
    if items.is_empty() {
        return String::new();
    }
    format!("Require {}", items.join(if grant["operator"] == "AND" { " and " } else { " or " }))
}

fn session_items(session: &Value) -> Vec<String> {
    let Some(controls) = session.as_object() else {
        return Vec::new();
    };
    controls
        .iter()
        .filter(|(key, value)| {
            !key.starts_with('@') && !value.is_null() && **value != Value::Bool(false) && value["isEnabled"] != Value::Bool(false)
        })
        .map(|(key, value)| {
            let detail = match (&value["value"], value["type"].as_str()) {
                (amount, Some(unit)) if !amount.is_null() => format!("{amount} {unit}"),
                _ if value["frequencyInterval"] == "everyTime" => "Every time".into(),
                _ => humanize(value["mode"].as_str().or(value["cloudAppSecurityType"].as_str()).unwrap_or("")),
            };
            if detail.is_empty() { humanize(key) } else { format!("{}: {detail}", humanize(key)) }
        })
        .collect()
}

fn thousands(value: usize) -> String {
    let digits = value.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{} {}", thousands(count), if count == 1 { one } else { many })
}

fn policy_label(policy: &Value) -> String {
    text(policy, "displayName")
}

/// How a check reads in the report: a problem when it finds something, or when it finds nothing.
enum Check {
    /// Finding anything needs attention (e.g. all-users policies with no exclusions).
    Problem,
    /// Finding nothing needs attention (e.g. no policy blocks legacy authentication).
    Expected,
    /// Inventory only.
    Info,
}

/// One review check: the parent row carries the verdict, children list what it found.
fn check_row(title: &str, check: Check, rows: Vec<(String, String)>, one: &str, many: &str) -> SettingRow {
    let count = plural(rows.len(), one, many);
    let verdict = match (check, rows.is_empty()) {
        (Check::Problem, true) => "OK: none".to_string(),
        (Check::Problem, false) => format!("Needs attention: {count}"),
        (Check::Expected, true) => "Needs attention: none found".to_string(),
        (Check::Expected, false) => format!("OK: {count}"),
        (Check::Info, _) => count,
    };
    SettingRow::with_children(title, verdict, rows.into_iter().map(|(name, value)| SettingRow::new(name, value)).collect())
}

fn gap_row(title: &str, gap: &CoverageGap) -> SettingRow {
    let mut rows: Vec<SettingRow> = gap.sample.iter().map(|name| SettingRow::new(name.clone(), "")).collect();
    if gap.count > gap.sample.len() {
        rows.push(SettingRow::new(format!("+{} more", thousands(gap.count - gap.sample.len())), ""));
    }
    let verdict = if gap.count == 0 { "OK: none".to_string() } else { format!("Needs attention: {}", plural(gap.count, "user", "users")) };
    SettingRow::with_children(title, verdict, rows)
}

/// Every id a policy references. Mirrors `referencedIds` in the Entra overview.
fn referenced_ids(policy: &Value) -> Vec<String> {
    let conditions = &policy["conditions"];
    let (users, apps, locations) = (&conditions["users"], &conditions["applications"], &conditions["locations"]);
    [
        &users["includeUsers"], &users["excludeUsers"], &users["includeGroups"], &users["excludeGroups"],
        &users["includeRoles"], &users["excludeRoles"], &apps["includeApplications"], &apps["excludeApplications"],
        &locations["includeLocations"], &locations["excludeLocations"],
    ]
    .into_iter()
    .flat_map(strs)
    .collect()
}

fn is_guid(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// The Entra overview as one card: state counts, review checks, and user coverage. Same checks as the app's overview page.
fn overview_card(
    policies: &[Value],
    locations: &[Value],
    names: &HashMap<String, String>,
    coverage: Option<&ConditionalAccessCoverage>,
    coverage_requested: bool,
) -> ReportCard {
    let state = |policy: &Value| policy["state"].as_str().unwrap_or("").to_string();
    let grant = |policy: &Value| strs(&policy["grantControls"]["builtInControls"]);
    let active: Vec<&Value> = policies.iter().filter(|policy| state(policy) != "disabled").collect();
    let listed = |rows: Vec<&Value>| -> Vec<(String, String)> {
        rows.into_iter().map(|policy| (policy_label(policy), humanize(&state(policy)))).collect()
    };
    let count = |value: &str| policies.iter().filter(|policy| state(policy) == value).count();

    let no_exclusions = active
        .iter()
        .copied()
        .filter(|policy| {
            let users = &policy["conditions"]["users"];
            strs(&users["includeUsers"]).iter().any(|id| id == "All")
                && ["excludeUsers", "excludeGroups", "excludeRoles"].iter().all(|key| strs(&users[*key]).is_empty())
        })
        .collect();
    let legacy_block = policies
        .iter()
        .filter(|policy| {
            let clients = strs(&policy["conditions"]["clientAppTypes"]);
            state(policy) == "enabled"
                && grant(policy).iter().any(|control| control == "block")
                && clients.iter().any(|client| client == "exchangeActiveSync" || client == "other")
        })
        .collect();
    let unresolved = policies
        .iter()
        .filter(|policy| {
            referenced_ids(policy).iter().any(|id| {
                is_guid(id) && !LOCATION_SPECIAL.iter().any(|(key, _)| *key == id.as_str()) && !names.contains_key(id)
            })
        })
        .collect();
    let approved_app = policies.iter().filter(|policy| grant(policy).iter().any(|control| control == "approvedApplication")).collect();
    let used_locations: std::collections::HashSet<String> = policies
        .iter()
        .flat_map(|policy| {
            let locations = &policy["conditions"]["locations"];
            [strs(&locations["includeLocations"]), strs(&locations["excludeLocations"])].concat()
        })
        .collect();
    let unused_locations: Vec<(String, String)> = locations
        .iter()
        .filter(|location| location["id"].as_str().is_some_and(|id| !used_locations.contains(id)))
        .map(|location| (text(location, "displayName"), String::new()))
        .collect();
    let mfa = active
        .iter()
        .copied()
        .filter(|policy| {
            grant(policy).iter().any(|control| control == "mfa") || policy["grantControls"]["authenticationStrength"]["id"].is_string()
        })
        .collect();
    let block = active.iter().copied().filter(|policy| grant(policy).iter().any(|control| control == "block")).collect();
    let report_only = policies.iter().filter(|policy| state(policy) == "enabledForReportingButNotEnforced").collect();
    let device_filters = policies.iter().filter(|policy| policy["conditions"]["devices"]["deviceFilter"]["rule"].is_string()).collect();

    let mut settings = Vec::new();
    if let Some(coverage) = coverage {
        settings.push(gap_row("Not covered by any enabled policy", &coverage.uncovered));
        settings.push(gap_row("No enabled MFA policy", &coverage.without_mfa));
    }
    settings.extend([
        check_row("All-users policies with no exclusions", Check::Problem, listed(no_exclusions), "policy", "policies"),
        check_row("Legacy authentication blocked", Check::Expected, listed(legacy_block), "policy", "policies"),
        check_row("References Graph couldn't resolve", Check::Problem, listed(unresolved), "policy", "policies"),
        check_row("Require approved client app (retiring)", Check::Problem, listed(approved_app), "policy", "policies"),
        check_row("Named locations no policy uses", Check::Problem, unused_locations, "location", "locations"),
        check_row("Report-only policies", Check::Info, listed(report_only), "policy", "policies"),
        check_row("Require MFA or an authentication strength", Check::Info, listed(mfa), "policy", "policies"),
        check_row("Block access", Check::Info, listed(block), "policy", "policies"),
        check_row("Use filters for devices", Check::Info, listed(device_filters), "policy", "policies"),
    ]);

    let trusted = locations.iter().filter(|location| location["isTrusted"].as_bool() == Some(true)).count();
    let mut description = format!(
        "{}: {} on, {} report-only, {} off. {} ({} trusted).",
        plural(policies.len(), "Conditional Access policy", "Conditional Access policies"),
        thousands(count("enabled")),
        thousands(count("enabledForReportingButNotEnforced")),
        thousands(count("disabled")),
        plural(locations.len(), "named location", "named locations"),
        thousands(trusted),
    );
    if let Some(coverage) = coverage {
        description.push_str(&format!(
            " {} ({} guests): {} not covered by any enabled policy, {} without an enabled MFA policy.",
            plural(coverage.user_count, "enabled account", "enabled accounts"),
            thousands(coverage.guest_count),
            thousands(coverage.uncovered.count),
            thousands(coverage.without_mfa.count),
        ));
    }
    let note = match coverage {
        Some(coverage) if coverage.truncated => {
            Some("A user or group list passed 200,000 entries, so user coverage counts are a minimum.".to_string())
        }
        Some(_) => Some(
            "User coverage expands nested groups and active role holders, removes exclusions, and counts enabled accounts. It does not factor in target resources or conditions, so \"covered\" means the user assignment reaches the account."
                .to_string(),
        ),
        None if coverage_requested => Some("User coverage could not be calculated; see Notes.".to_string()),
        None => Some("User coverage was not included in this report.".to_string()),
    };

    let mut card = card(SECTION_SERVICE_OVERVIEW, ENTRA_SCOPE, "Conditional Access review", &Value::Null, "Conditional Access overview".into(), Vec::new(), settings);
    card.description = description;
    card.note = note;
    card
}

fn policy_card(policy: &Value, names: &HashMap<String, String>, coverage: Option<&ConditionalAccessCoverage>) -> ReportCard {
    let conditions = &policy["conditions"];
    let (users, apps) = (&conditions["users"], &conditions["applications"]);
    let user_include = [
        named(&users["includeUsers"], names, USER_SPECIAL),
        named(&users["includeGroups"], names, &[]),
        named(&users["includeRoles"], names, &[]),
        guests(&users["includeGuestsOrExternalUsers"]),
    ]
    .concat();
    let user_exclude = [
        named(&users["excludeUsers"], names, USER_SPECIAL),
        named(&users["excludeGroups"], names, &[]),
        named(&users["excludeRoles"], names, &[]),
        guests(&users["excludeGuestsOrExternalUsers"]),
    ]
    .concat();
    let mut resource_include = named(&apps["includeApplications"], names, APP_SPECIAL);
    resource_include.extend(
        strs(&apps["includeUserActions"])
            .iter()
            .map(|action| format!("User action: {}", humanize(action.trim_start_matches("urn:user:")))),
    );
    resource_include.extend(strs(&apps["includeAuthenticationContextClassReferences"]).iter().map(|id| format!("Auth context: {id}")));
    let resource_exclude = named(&apps["excludeApplications"], names, APP_SPECIAL);
    let conditions = condition_rows(conditions, names);
    let grant = grant_text(&policy["grantControls"]);
    let session = session_items(&policy["sessionControls"]);

    let condition_summary = conditions.iter().map(|row| row.name.clone()).collect::<Vec<_>>();
    let settings = vec![
        SettingRow::with_children(
            "Assignments",
            format!("{} → {}", short(&user_include), short(&resource_include)),
            vec![
                SettingRow::new("Users", joined(&user_include)),
                SettingRow::new("Excluded users", joined(&user_exclude)),
                SettingRow::new("Target resources", joined(&resource_include)),
                SettingRow::new("Excluded resources", joined(&resource_exclude)),
            ],
        ),
        SettingRow::with_children(
            "Conditions",
            if condition_summary.is_empty() { "None".into() } else { condition_summary.join(", ") },
            conditions,
        ),
        SettingRow::with_children(
            "Access controls",
            if grant.is_empty() { NOT_CONFIGURED.to_string() } else { grant.clone() },
            vec![
                SettingRow::new("Grant", if grant.is_empty() { NOT_CONFIGURED.to_string() } else { grant }),
                SettingRow::new("Session", joined(&session)),
            ],
        ),
    ];
    let modified = date(policy, "modifiedDateTime");
    let metadata = vec![
        SettingRow::new("State", humanize(&text(policy, "state"))),
        SettingRow::new("Created", date(policy, "createdDateTime")),
        SettingRow::new("Modified", if modified.is_empty() { "Never".into() } else { modified }),
        SettingRow::new("Id", text(policy, "id")),
    ];
    let mut card = card(SECTION_CONDITIONAL_ACCESS, ENTRA_SCOPE, "Conditional Access policy", policy, text(policy, "displayName"), metadata, settings);
    let scope = coverage.and_then(|coverage| {
        let id = policy["id"].as_str()?;
        let result = coverage.policies.iter().find(|entry| entry.id == id)?;
        Some((result, coverage.user_count))
    });
    if let Some((result, total)) = scope {
        let share = if total == 0 { 0 } else { result.covered * 100 / total };
        card.description = format!(
            "Users in scope: {} of {} enabled accounts ({share}%), {} removed by exclusions.",
            thousands(result.covered),
            thousands(total),
            thousands(result.excluded),
        );
    }
    card
}

fn location_card(row: &Value) -> ReportCard {
    let kind = text(row, "@odata.type").trim_start_matches("#microsoft.graph.").to_string();
    let mut metadata = vec![SettingRow::new("Type", humanize(&kind))];
    let mut settings = Vec::new();
    match kind.as_str() {
        "ipNamedLocation" => {
            metadata.push(SettingRow::new("Trusted", yes_no(row["isTrusted"].as_bool().unwrap_or(false))));
            let ranges: Vec<String> = row["ipRanges"]
                .as_array()
                .map(|ranges| ranges.iter().filter_map(|range| range["cidrAddress"].as_str()).map(str::to_string).collect())
                .unwrap_or_default();
            settings.push(SettingRow::new("IP ranges", joined(&ranges)));
        }
        "countryNamedLocation" => {
            metadata.push(SettingRow::new("Lookup method", humanize(&text(row, "countryLookupMethod"))));
            settings.push(SettingRow::new("Countries and regions", joined(&strs(&row["countriesAndRegions"]))));
            settings.push(SettingRow::new(
                "Unknown countries",
                if row["includeUnknownCountriesAndRegions"].as_bool().unwrap_or(false) { "Included" } else { "Not included" },
            ));
        }
        _ => {}
    }
    metadata.push(SettingRow::new("Modified", date(row, "modifiedDateTime")));
    metadata.push(SettingRow::new("Id", text(row, "id")));
    card(SECTION_NAMED_LOCATIONS, ENTRA_SCOPE, "Named location", row, text(row, "displayName"), metadata, settings)
}

fn sensitivity_card(row: &Value) -> ReportCard {
    let name = text(row, "name");
    let title = match row["parent"]["name"].as_str() {
        Some(parent) => format!("{parent} / {name}"),
        None => name,
    };
    let metadata = vec![
        SettingRow::new("Priority", row["sensitivity"].as_i64().map(|value| value.to_string()).unwrap_or_default()),
        SettingRow::new("Active", yes_no(row["isActive"].as_bool().unwrap_or(false))),
        SettingRow::new("Can be applied", yes_no(row["isAppliable"].as_bool().unwrap_or(false))),
        SettingRow::new("Id", text(row, "id")),
    ];
    let formats: Vec<String> = strs(&row["contentFormats"]).iter().map(|format| humanize(format)).collect();
    let settings = vec![
        SettingRow::new("Applies to", joined(&formats)),
        SettingRow::new("Encryption", yes_no(row["hasProtection"].as_bool().unwrap_or(false))),
        SettingRow::new("Tooltip", text(row, "tooltip")),
        SettingRow::new("Description", text(row, "description")),
    ];
    card(SECTION_SENSITIVITY_LABELS, PURVIEW_SCOPE, "Sensitivity label", row, title, metadata, settings)
}

fn retention_card(row: &Value) -> ReportCard {
    let duration = &row["retentionDuration"];
    let retain_for = if duration["@odata.type"].as_str().is_some_and(|kind| kind.ends_with("Forever")) {
        "Forever".to_string()
    } else {
        match &duration["days"] {
            Value::Null => String::new(),
            Value::String(days) => format!("{days} days"),
            days => format!("{days} days"),
        }
    };
    let by = |key: &str| row[key]["user"]["displayName"].as_str().map(|name| format!(" by {name}")).unwrap_or_default();
    let metadata = vec![
        SettingRow::new("In use", yes_no(row["isInUse"].as_bool().unwrap_or(false))),
        SettingRow::new("Created", format!("{}{}", date(row, "createdDateTime"), by("createdBy"))),
        SettingRow::new("Modified", format!("{}{}", date(row, "lastModifiedDateTime"), by("lastModifiedBy"))),
        SettingRow::new("Id", text(row, "id")),
    ];
    let settings = vec![
        SettingRow::new("Retain for", retain_for),
        SettingRow::new("Starts", humanize(&text(row, "retentionTrigger"))),
        SettingRow::new("During retention", humanize(&text(row, "behaviorDuringRetentionPeriod"))),
        SettingRow::new("After retention", humanize(&text(row, "actionAfterRetentionPeriod"))),
        SettingRow::new("Label applied afterwards", text(row, "labelToBeApplied")),
        SettingRow::new("Record behavior", humanize(&text(row, "defaultRecordBehavior"))),
        SettingRow::new("Description for admins", text(row, "descriptionForAdmins")),
        SettingRow::new("Description for users", text(row, "descriptionForUsers")),
    ];
    card(SECTION_RETENTION_LABELS, PURVIEW_SCOPE, "Retention label", row, text(row, "displayName"), metadata, settings)
}
