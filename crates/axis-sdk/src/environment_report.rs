use crate::assignments::{
    apply_filter_names, apply_group_metadata, drafts_from_graph_assignments, list_assignment_filters,
    resolve_directory_groups, AssignmentDraft, AssignmentTargetKind, GroupMembershipKind,
};
use crate::compliance_docs::{fetch_compliance_property_docs, CompliancePropertyDoc};
use crate::glance::fetch_tenant_glance;
use crate::graph::{GraphClient, GraphCollection, GraphError};
use crate::inventory::{
    fetch_autopilot_profiles, fetch_compliance_policies, fetch_configuration_policies,
    fetch_endpoint_security_intents, fetch_enrollment_configurations,
    fetch_group_policy_configurations, fetch_mobile_apps, fetch_tenant_scripts,
    fetch_windows_update_policies, AutopilotProfile, CatalogPolicySummary, InventoryList,
    MobileAppSummary, TenantScriptSummary, WindowsUpdatePolicy,
};
use crate::compliance_status::device_status_overview_path;
use crate::object_detail::{fetch_graph_object_detail, GraphObjectDetail};
use crate::pack_export::graph_fetch_concurrency;
use crate::policy_health::{
    fetch_app_install_health, fetch_configuration_policy_health, index_app_install,
    index_policy_health, lookup_app_install, lookup_policy_health, AppInstallHealth,
};
use crate::types::TenantGlance;
use chrono::Utc;
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use urlencoding::encode;

const SETTINGS_PAGE_MAX: usize = 1000;
const ASSIGNMENTS_MAX: usize = 200;

fn default_true() -> bool {
    true
}

/// Which chapters and content surfaces to include in an as-built.
/// Defaults match prior behaviour (everything included).
///
/// Optional ID lists narrow a content surface when that surface is enabled:
/// `None` = all objects; `Some(ids)` = only those IDs (`Some([])` = none).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReportSelection {
    #[serde(default = "default_true")]
    pub summary: bool,
    #[serde(default = "default_true")]
    pub devices: bool,
    #[serde(default = "default_true")]
    pub groups: bool,
    #[serde(default = "default_true")]
    pub policies: bool,
    #[serde(default = "default_true")]
    pub updates: bool,
    #[serde(default = "default_true")]
    pub apps: bool,
    #[serde(default = "default_true")]
    pub enrollment: bool,
    #[serde(default = "default_true")]
    pub scripts: bool,
    #[serde(default = "default_true")]
    pub cross_platform: bool,
    #[serde(default = "default_true")]
    pub windows: bool,
    #[serde(default = "default_true")]
    pub macos: bool,
    #[serde(default = "default_true")]
    pub ios: bool,
    #[serde(default = "default_true")]
    pub android: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enrollment_ids: Option<Vec<String>>,
}

impl Default for EnvironmentReportSelection {
    fn default() -> Self {
        Self {
            summary: true,
            devices: true,
            groups: true,
            policies: true,
            updates: true,
            apps: true,
            enrollment: true,
            scripts: true,
            cross_platform: true,
            windows: true,
            macos: true,
            ios: true,
            android: true,
            policy_ids: None,
            app_ids: None,
            script_ids: None,
            enrollment_ids: None,
        }
    }
}

impl EnvironmentReportSelection {
    fn includes_scope(&self, scope: &str) -> bool {
        match scope {
            CROSS_PLATFORM_SCOPE => self.cross_platform,
            "Windows" => self.windows,
            "macOS" => self.macos,
            "iOS" | "iPadOS" => self.ios,
            "Android" => self.android,
            // Rare platforms (tvOS, Linux, Unspecified, …) only when the user has not narrowed OS scope.
            _ => self.windows && self.macos && self.ios && self.android,
        }
    }

    /// `None` = unrestricted; `Some([])` = nothing; `Some(ids)` = only those ids.
    fn allows_id(filter: &Option<Vec<String>>, id: &str) -> bool {
        match filter {
            None => true,
            Some(ids) => ids.iter().any(|allowed| allowed == id),
        }
    }

    fn filter_is_empty(filter: &Option<Vec<String>>) -> bool {
        matches!(filter, Some(ids) if ids.is_empty())
    }

    fn wants_policy_objects(&self) -> bool {
        self.policies && self.any_platform() && !Self::filter_is_empty(&self.policy_ids)
    }

    fn wants_update_objects(&self) -> bool {
        self.updates && self.windows
    }

    fn wants_app_objects(&self) -> bool {
        self.apps && self.any_platform() && !Self::filter_is_empty(&self.app_ids)
    }

    fn wants_enrollment_objects(&self) -> bool {
        self.enrollment && self.any_platform() && !Self::filter_is_empty(&self.enrollment_ids)
    }

    /// Tenant enrollment connectors / APNs / ADE extras only in "all enrollment" mode.
    fn wants_enrollment_extras(&self) -> bool {
        self.wants_enrollment_objects() && self.enrollment_ids.is_none()
    }

    fn wants_script_objects(&self) -> bool {
        self.scripts && self.any_platform() && !Self::filter_is_empty(&self.script_ids)
    }

    fn any_platform(&self) -> bool {
        self.cross_platform || self.windows || self.macos || self.ios || self.android
    }

    fn any_content_surface(&self) -> bool {
        self.policies || self.updates || self.apps || self.enrollment || self.scripts
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReportProgress {
    pub phase: String,
    pub current: u32,
    pub total: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub html: String,
    pub markdown: String,
    pub organization_name: Option<String>,
    pub suggested_name: String,
    pub suggested_markdown_name: String,
    pub object_count: u32,
    pub generated_at: String,
    pub warnings: Vec<String>,
}

struct SettingRow {
    name: String,
    value: String,
    children: Vec<SettingRow>,
}

impl SettingRow {
    fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
            children: Vec::new(),
        }
    }

    fn with_children(
        name: impl Into<String>,
        value: impl Into<String>,
        children: Vec<SettingRow>,
    ) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
            children,
        }
    }
}

struct PolicyStats {
    success: u32,
    noncompliant: u32,
    error: u32,
    conflict: u32,
    not_applicable: u32,
    pending: u32,
    in_grace: u32,
    targeted: u32,
}

struct AppInstallStats {
    installed: u32,
    failed: u32,
    not_installed: u32,
    pending: u32,
    not_applicable: u32,
}

struct ReportCard {
    source_id: String,
    section: &'static str,
    scope: String,
    title: String,
    description: String,
    platform: String,
    kind_label: String,
    drafts: Vec<AssignmentDraft>,
    metadata: Vec<SettingRow>,
    settings: Vec<SettingRow>,
    code_blocks: Vec<(String, String)>,
    stats: Option<PolicyStats>,
    app_install: Option<AppInstallStats>,
    note: Option<String>,
}

struct IntuneGroupRow {
    name: String,
    membership: String,
    member_count: Option<u32>,
    uses: u32,
}

struct AppInventory {
    total: usize,
    assigned: usize,
    failed_device_total: u32,
    installed_device_total: u32,
    by_mechanism: Vec<(String, u32, u32)>,
    failing: Vec<(String, String, u32)>,
    cards: Vec<ReportCard>,
}

pub async fn generate_environment_report(
    access_token: &str,
    axis_version: &str,
    prepared_for: Option<&str>,
    prepared_by: Option<&str>,
    token_scopes: &[String],
    selection: &EnvironmentReportSelection,
    on_progress: impl Fn(EnvironmentReportProgress),
) -> Result<EnvironmentReport, GraphError> {
    let generated_at = Utc::now().to_rfc3339();
    let mut warnings = Vec::new();

    on_progress(progress("inventory", 0, 0, "Loading tenant inventory…"));
    let concurrency = graph_fetch_concurrency();
    let wants_policies = selection.wants_policy_objects();
    let wants_scripts = selection.wants_script_objects() || wants_policies;
    let wants_intents = wants_policies && selection.windows;
    let wants_updates = selection.wants_update_objects();
    let wants_autopilot = selection.wants_enrollment_objects() && selection.windows;
    let wants_gpo = wants_policies && selection.windows;
    let wants_enrollment = selection.wants_enrollment_objects();

    let (
        catalog_result,
        scripts_result,
        compliance_result,
        intents_result,
        windows_update_result,
        autopilot_result,
        group_policy_result,
        enrollment_result,
    ) = tokio::join!(
        async {
            if wants_policies {
                Some(fetch_configuration_policies(access_token).await)
            } else {
                None
            }
        },
        async {
            if wants_scripts {
                Some(fetch_tenant_scripts(access_token).await)
            } else {
                None
            }
        },
        async {
            if wants_policies {
                Some(fetch_compliance_policies(access_token).await)
            } else {
                None
            }
        },
        async {
            if wants_intents {
                Some(fetch_endpoint_security_intents(access_token).await)
            } else {
                None
            }
        },
        async {
            if wants_updates {
                Some(fetch_windows_update_policies(access_token).await)
            } else {
                None
            }
        },
        async {
            if wants_autopilot {
                Some(fetch_autopilot_profiles(access_token).await)
            } else {
                None
            }
        },
        async {
            if wants_gpo {
                Some(fetch_group_policy_configurations(access_token).await)
            } else {
                None
            }
        },
        async {
            if wants_enrollment {
                Some(fetch_enrollment_configurations(access_token).await)
            } else {
                None
            }
        },
    );

    let catalog = optional_list_or_warn("Settings Catalog", catalog_result, &mut warnings);
    let scripts = optional_list_or_warn("Scripts", scripts_result, &mut warnings);
    let compliance = optional_list_or_warn("Compliance policies", compliance_result, &mut warnings);
    let intents = optional_list_or_warn("Endpoint Security", intents_result, &mut warnings);
    let windows_update =
        optional_list_or_warn("Windows Update", windows_update_result, &mut warnings);
    let autopilot = optional_list_or_warn("Autopilot profiles", autopilot_result, &mut warnings);
    let group_policy = optional_list_or_warn("Group Policy", group_policy_result, &mut warnings);
    let enrollment = optional_list_or_warn("Enrollment", enrollment_result, &mut warnings);

    on_progress(progress(
        "posture",
        0,
        0,
        &format!("Loading posture (then up to {concurrency} parallel detail fetches)…"),
    ));
    let (glance_result, health_result, docs_result, filters_result) = tokio::join!(
        fetch_tenant_glance(access_token, token_scopes),
        async {
            if wants_policies {
                Some(fetch_configuration_policy_health(access_token).await)
            } else {
                None
            }
        },
        async {
            if wants_policies {
                Some(fetch_compliance_property_docs("").await)
            } else {
                None
            }
        },
        async {
            if selection.any_content_surface() && selection.any_platform() {
                Some(list_assignment_filters(access_token).await)
            } else {
                None
            }
        },
    );

    let glance = match glance_result {
        Ok(glance) => glance,
        Err(error) => {
            warnings.push(format!("Posture snapshot: {error}"));
            TenantGlance::empty_with_now()
        }
    };

    let health_rows = match health_result {
        Some(Ok(rows)) => rows,
        Some(Err(error)) => {
            warnings.push(format!("Policy device status: {error}"));
            Vec::new()
        }
        None => Vec::new(),
    };
    let health_index = index_policy_health(&health_rows);

    let compliance_docs: Arc<HashMap<String, CompliancePropertyDoc>> = Arc::new(match docs_result {
        Some(Ok(docs)) => docs
            .into_iter()
            .map(|doc| (doc.name.clone(), doc))
            .collect(),
        Some(Err(error)) => {
            warnings.push(format!("Compliance labels: {error}"));
            HashMap::new()
        }
        None => HashMap::new(),
    });

    let filters = match filters_result {
        Some(Ok(filters)) => filters,
        Some(Err(error)) => {
            warnings.push(format!("Assignment filters: {error}"));
            Vec::new()
        }
        None => Vec::new(),
    };

    let script_names: Arc<HashMap<String, String>> = Arc::new(
        scripts
            .iter()
            .map(|script| (script.id.clone(), script.display_name.clone()))
            .collect(),
    );

    let catalog_work: Vec<_> = catalog
        .into_iter()
        .filter(|policy| {
            let (scope, _) = platform_scope_from_catalog(policy.platforms.as_deref());
            selection.includes_scope(&scope)
                && EnvironmentReportSelection::allows_id(&selection.policy_ids, &policy.id)
        })
        .collect();
    let script_work: Vec<_> = if selection.wants_script_objects() {
        scripts
            .into_iter()
            .filter(|script| {
                selection.includes_scope(&script_platform(&script.kind))
                    && EnvironmentReportSelection::allows_id(&selection.script_ids, &script.id)
            })
            .collect()
    } else {
        Vec::new()
    };
    let compliance_work: Vec<_> = compliance
        .into_iter()
        .filter(|policy| {
            let (scope, _) = platform_scope_from_catalog(policy.platforms.as_deref());
            selection.includes_scope(&scope)
                && EnvironmentReportSelection::allows_id(&selection.policy_ids, &policy.id)
        })
        .collect();
    let intent_work: Vec<_> = intents
        .into_iter()
        .filter(|policy| EnvironmentReportSelection::allows_id(&selection.policy_ids, &policy.id))
        .collect();
    let update_work: Vec<_> = windows_update.into_iter().collect();
    let autopilot_work: Vec<_> = autopilot
        .into_iter()
        .filter(|profile| {
            EnvironmentReportSelection::allows_id(&selection.enrollment_ids, &profile.id)
        })
        .collect();
    let group_policy_work: Vec<_> = group_policy
        .into_iter()
        .filter(|policy| EnvironmentReportSelection::allows_id(&selection.policy_ids, &policy.id))
        .collect();
    let enrollment_work: Vec<_> = enrollment
        .into_iter()
        .filter(|policy| {
            EnvironmentReportSelection::allows_id(&selection.enrollment_ids, &policy.id)
        })
        .collect();

    let total = (catalog_work.len()
        + script_work.len()
        + compliance_work.len()
        + intent_work.len()
        + update_work.len()
        + autopilot_work.len()
        + group_policy_work.len()
        + enrollment_work.len()) as u32;

    enum ReportCardJob {
        Catalog(CatalogPolicySummary),
        Script(TenantScriptSummary),
        Compliance(CatalogPolicySummary),
        Intent(CatalogPolicySummary),
        Update(WindowsUpdatePolicy),
        Autopilot(AutopilotProfile),
        GroupPolicy(CatalogPolicySummary),
        Enrollment(CatalogPolicySummary),
    }

    enum CardOutcome {
        Ok(ReportCard),
        Warn(String),
        Enrollment(ReportCard),
    }

    let mut jobs = Vec::with_capacity(total as usize);
    jobs.extend(catalog_work.into_iter().map(ReportCardJob::Catalog));
    jobs.extend(script_work.into_iter().map(ReportCardJob::Script));
    jobs.extend(compliance_work.into_iter().map(ReportCardJob::Compliance));
    jobs.extend(intent_work.into_iter().map(ReportCardJob::Intent));
    jobs.extend(update_work.into_iter().map(ReportCardJob::Update));
    jobs.extend(autopilot_work.into_iter().map(ReportCardJob::Autopilot));
    jobs.extend(group_policy_work.into_iter().map(ReportCardJob::GroupPolicy));
    jobs.extend(enrollment_work.into_iter().map(ReportCardJob::Enrollment));

    on_progress(progress(
        "export",
        0,
        total.max(1),
        &format!("Fetching {total} report objects (concurrency {concurrency})…"),
    ));

    let token = access_token.to_string();
    let mut completed = 0u32;
    let outcomes: Vec<CardOutcome> = stream::iter(jobs)
        .map(|job| {
            let token = token.clone();
            let compliance_docs = Arc::clone(&compliance_docs);
            let script_names = Arc::clone(&script_names);
            async move {
                match job {
                    ReportCardJob::Catalog(policy) => {
                        let (scope, platform) =
                            platform_scope_from_catalog(policy.platforms.as_deref());
                        match load_graph_card(
                            &token,
                            "configurationPolicy",
                            &policy.id,
                            SECTION_POLICIES,
                            scope,
                            platform,
                            "Settings Catalog",
                            Some(policy.description.as_deref().unwrap_or("")),
                            None,
                            None,
                            None,
                        )
                        .await
                        {
                            Ok(card) => CardOutcome::Ok(card),
                            Err(error) => CardOutcome::Warn(format!("{}: {error}", policy.name)),
                        }
                    }
                    ReportCardJob::Script(script) => {
                        let kind = inspector_kind_for_script(&script.kind);
                        match load_script_card(&token, &script, kind).await {
                            Ok(card) => CardOutcome::Ok(card),
                            Err(error) => {
                                CardOutcome::Warn(format!("{}: {error}", script.display_name))
                            }
                        }
                    }
                    ReportCardJob::Compliance(policy) => {
                        let (scope, platform) =
                            platform_scope_from_catalog(policy.platforms.as_deref());
                        match load_graph_card(
                            &token,
                            "compliancePolicy",
                            &policy.id,
                            SECTION_POLICIES,
                            scope,
                            platform,
                            "Compliance policy",
                            Some(policy.description.as_deref().unwrap_or("")),
                            None,
                            Some(compliance_docs.as_ref()),
                            Some(script_names.as_ref()),
                        )
                        .await
                        {
                            Ok(card) => CardOutcome::Ok(card),
                            Err(error) => CardOutcome::Warn(format!("{}: {error}", policy.name)),
                        }
                    }
                    ReportCardJob::Intent(policy) => {
                        match load_endpoint_security_card(&token, &policy).await {
                            Ok(card) => CardOutcome::Ok(card),
                            Err(error) => CardOutcome::Warn(format!("{}: {error}", policy.name)),
                        }
                    }
                    ReportCardJob::Update(policy) => {
                        let kind = format!("windowsUpdate:{}", policy.family);
                        match load_graph_card(
                            &token,
                            &kind,
                            &policy.id,
                            SECTION_UPDATES,
                            "Windows".into(),
                            "Windows".into(),
                            windows_update_family_label(&policy.family),
                            Some(policy.description.as_deref().unwrap_or("")),
                            None,
                            None,
                            None,
                        )
                        .await
                        {
                            Ok(card) => CardOutcome::Ok(card),
                            Err(error) => CardOutcome::Warn(format!("{}: {error}", policy.name)),
                        }
                    }
                    ReportCardJob::Autopilot(profile) => match load_graph_card(
                        &token,
                        "autopilotProfile",
                        &profile.id,
                        SECTION_ENROLLMENT,
                        "Windows".into(),
                        "Windows".into(),
                        "Autopilot profile",
                        Some(profile.description.as_deref().unwrap_or("")),
                        None,
                        None,
                        None,
                    )
                    .await
                    {
                        Ok(card) => CardOutcome::Ok(card),
                        Err(error) => {
                            CardOutcome::Warn(format!("{}: {error}", profile.display_name))
                        }
                    },
                    ReportCardJob::GroupPolicy(policy) => match load_graph_card(
                        &token,
                        "groupPolicyConfiguration",
                        &policy.id,
                        SECTION_POLICIES,
                        "Windows".into(),
                        "Windows".into(),
                        "Group Policy",
                        Some(policy.description.as_deref().unwrap_or("")),
                        None,
                        None,
                        None,
                    )
                    .await
                    {
                        Ok(card) => CardOutcome::Ok(card),
                        Err(error) => CardOutcome::Warn(format!("{}: {error}", policy.name)),
                    },
                    ReportCardJob::Enrollment(policy) => {
                        match load_enrollment_card(&token, &policy).await {
                            Ok(card) => CardOutcome::Enrollment(card),
                            Err(error) => CardOutcome::Warn(format!("{}: {error}", policy.name)),
                        }
                    }
                }
            }
        })
        .buffer_unordered(concurrency)
        .inspect(|_| {
            completed += 1;
            on_progress(progress(
                "export",
                completed,
                total.max(1),
                &format!("Loaded {completed} of {total}"),
            ));
        })
        .collect()
        .await;

    let mut cards = Vec::new();
    let mut enrollment_loaded = 0usize;
    for outcome in outcomes {
        match outcome {
            CardOutcome::Ok(card) => cards.push(card),
            CardOutcome::Warn(message) => warnings.push(message),
            CardOutcome::Enrollment(card) => {
                if selection.includes_scope(&card.scope) {
                    enrollment_loaded += 1;
                    cards.push(card);
                }
            }
        }
    }

    let mut extra_group_ids = Vec::new();
    if selection.wants_enrollment_extras() {
        on_progress(progress(
            "enrollment",
            total,
            total.max(1),
            "Loading enrollment connectors and tenant enrollment settings…",
        ));
        let (extra_enrollment, ids) =
            collect_enrollment_extras(access_token, &on_progress, &mut warnings).await;
        for card in extra_enrollment {
            if selection.includes_scope(&card.scope) {
                enrollment_loaded += 1;
                cards.push(card);
            }
        }
        extra_group_ids = ids;
    }

    let mut app_inventory = empty_app_inventory();
    let mut app_group_ids = Vec::new();
    if selection.wants_app_objects() {
        on_progress(progress("apps", 0, 0, "Loading applications…"));
        let apps = fetch_apps_for_selection(access_token, selection, &mut warnings).await;
        let apps: Vec<_> = apps
            .into_iter()
            .filter(|app| {
                let platform = canonical_platform(app.platform.as_deref().unwrap_or(""));
                selection.includes_scope(&platform)
                    && EnvironmentReportSelection::allows_id(&selection.app_ids, &app.id)
            })
            .collect();
        let (inventory, ids) =
            collect_app_inventory(access_token, &apps, &on_progress, &mut warnings).await;
        app_inventory = inventory;
        app_group_ids = ids;
    }

    on_progress(progress("assignments", 0, 0, "Resolving group names…"));
    let mut group_ids = Vec::new();
    let mut seen = HashSet::new();
    let mut group_uses: HashMap<String, u32> = HashMap::new();
    for card in &cards {
        for draft in &card.drafts {
            if let Some(id) = draft.group_id.as_deref() {
                *group_uses.entry(id.to_string()).or_insert(0) += 1;
                if seen.insert(id.to_string()) {
                    group_ids.push(id.to_string());
                }
            }
        }
    }
    for id in &app_group_ids {
        *group_uses.entry(id.clone()).or_insert(0) += 1;
        if seen.insert(id.clone()) {
            group_ids.push(id.clone());
        }
    }
    for id in &extra_group_ids {
        *group_uses.entry(id.clone()).or_insert(0) += 1;
        if seen.insert(id.clone()) {
            group_ids.push(id.clone());
        }
    }
    let groups = if group_ids.is_empty() {
        Vec::new()
    } else {
        match resolve_directory_groups(access_token, &group_ids).await {
            Ok(groups) => groups,
            Err(error) => {
                warnings.push(format!("Directory groups: {error}"));
                Vec::new()
            }
        }
    };
    for card in &mut cards {
        apply_group_metadata(&mut card.drafts, &groups);
        apply_filter_names(&mut card.drafts, &filters);
        apply_policy_stats(card, &health_index);
    }
    for card in &mut app_inventory.cards {
        apply_group_metadata(&mut card.drafts, &groups);
        apply_filter_names(&mut card.drafts, &filters);
    }
    let app_card_count = app_inventory.cards.len() as u32;
    cards.extend(app_inventory.cards.drain(..));

    let intune_groups = if selection.groups && !groups.is_empty() {
        on_progress(progress("groups", 0, 0, "Counting group members…"));
        assemble_intune_groups(access_token, &groups, &group_uses).await
    } else {
        Vec::new()
    };

    let organization_name = glance.organization_name.clone();
    let org_slug = organization_name
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(slug)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "tenant".into());
    let suggested_name = format!("axis-{org_slug}-as-built.html");
    let suggested_markdown_name = format!("axis-{org_slug}-as-built.md");
    let org_default = glance
        .organization_name
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("This tenant");
    let prepared_for = resolve_prepared_label(prepared_for, org_default);
    let prepared_by = resolve_prepared_label(prepared_by, "Unknown");
    let object_count = total + app_card_count;
    let layout = build_report_layout(cards);
    let html = render_html(
        axis_version,
        &prepared_for,
        &prepared_by,
        &generated_at,
        selection,
        &glance,
        &layout,
        &intune_groups,
        &app_inventory,
        &health_rows,
        &warnings,
        object_count,
        enrollment_loaded,
    );
    let markdown = render_markdown(
        axis_version,
        &prepared_for,
        &prepared_by,
        &generated_at,
        selection,
        &glance,
        &layout,
        &intune_groups,
        &app_inventory,
        &health_rows,
        &warnings,
        enrollment_loaded,
    );

    Ok(EnvironmentReport {
        html,
        markdown,
        organization_name,
        suggested_name,
        suggested_markdown_name,
        object_count,
        generated_at,
        warnings,
    })
}

fn empty_app_inventory() -> AppInventory {
    AppInventory {
        total: 0,
        assigned: 0,
        failed_device_total: 0,
        installed_device_total: 0,
        by_mechanism: Vec::new(),
        failing: Vec::new(),
        cards: Vec::new(),
    }
}

async fn fetch_apps_for_selection(
    access_token: &str,
    selection: &EnvironmentReportSelection,
    warnings: &mut Vec<String>,
) -> Vec<MobileAppSummary> {
    let all_platforms =
        selection.windows && selection.macos && selection.ios && selection.android;
    if all_platforms {
        return list_or_warn(
            "Applications",
            fetch_mobile_apps(access_token, None, None).await,
            warnings,
        );
    }

    let token = access_token.to_string();
    let mut tasks = Vec::new();
    if selection.windows {
        let token = token.clone();
        tasks.push(tokio::spawn(async move {
            (
                "windows".to_string(),
                fetch_mobile_apps(&token, Some("windows"), None).await,
            )
        }));
    }
    if selection.macos {
        let token = token.clone();
        tasks.push(tokio::spawn(async move {
            (
                "macos".to_string(),
                fetch_mobile_apps(&token, Some("macos"), None).await,
            )
        }));
    }
    if selection.ios {
        let token = token.clone();
        tasks.push(tokio::spawn(async move {
            (
                "ios".to_string(),
                fetch_mobile_apps(&token, Some("ios"), None).await,
            )
        }));
    }
    if selection.android {
        let token = token.clone();
        tasks.push(tokio::spawn(async move {
            (
                "android".to_string(),
                fetch_mobile_apps(&token, Some("android"), None).await,
            )
        }));
    }

    let mut apps = Vec::new();
    let mut seen = HashSet::new();
    for task in tasks {
        match task.await {
            Ok((platform, result)) => {
                let batch = list_or_warn(&format!("Applications ({platform})"), result, warnings);
                for app in batch {
                    if seen.insert(app.id.clone()) {
                        apps.push(app);
                    }
                }
            }
            Err(error) => warnings.push(format!("Applications: task failed: {error}")),
        }
    }
    apps
}

fn progress(phase: &str, current: u32, total: u32, message: &str) -> EnvironmentReportProgress {
    EnvironmentReportProgress {
        phase: phase.into(),
        current,
        total,
        message: message.into(),
    }
}

fn list_or_warn<T>(
    label: &str,
    result: Result<InventoryList<T>, GraphError>,
    warnings: &mut Vec<String>,
) -> Vec<T> {
    match result {
        Ok(list) => {
            if list.truncated {
                warnings.push(format!(
                    "{label}: list truncated at {} items.",
                    list.items.len()
                ));
            }
            list.items
        }
        Err(error) => {
            warnings.push(format!("{label}: {error}"));
            Vec::new()
        }
    }
}

fn optional_list_or_warn<T>(
    label: &str,
    result: Option<Result<InventoryList<T>, GraphError>>,
    warnings: &mut Vec<String>,
) -> Vec<T> {
    match result {
        Some(result) => list_or_warn(label, result, warnings),
        None => Vec::new(),
    }
}

fn inspector_kind_for_script(kind: &str) -> &str {
    match kind {
        "platform-powershell" => "script:platform-powershell",
        "platform-shell" => "script:platform-shell",
        "remediation" => "script:remediation",
        "compliance" => "script:compliance",
        other => other,
    }
}

fn windows_update_family_label(family: &str) -> &'static str {
    match family {
        "rings" => "Update rings",
        "feature" => "Feature updates",
        "quality" => "Quality updates",
        "drivers" => "Driver updates",
        _ => "Windows Update",
    }
}

fn platform_label(platforms: Option<&str>) -> String {
    canonical_platform(platforms.unwrap_or(""))
}

fn canonical_platform(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "" => "Unspecified".into(),
        "windows10" | "windows10x" | "windows" => "Windows".into(),
        "macos" | "mac" | "osx" => "macOS".into(),
        "ios" | "iphone" => "iOS".into(),
        "ipados" | "ipad" => "iPadOS".into(),
        "tvos" | "appletv" | "apple tv" => "tvOS".into(),
        "visionos" | "vision" => "visionOS".into(),
        "android" => "Android".into(),
        "linux" => "Linux".into(),
        other => title_case_words(other),
    }
}

fn platform_sort_key(name: &str) -> (u8, String) {
    let rank = match name.to_ascii_lowercase().as_str() {
        "cross-platform" => 0,
        "windows" => 1,
        "macos" => 2,
        "ios" => 3,
        "ipados" => 4,
        "tvos" => 5,
        "visionos" => 6,
        "android" => 7,
        "linux" => 8,
        "unspecified" => 10,
        _ => 9,
    };
    (rank, name.to_ascii_lowercase())
}

const SECTION_POLICIES: &str = "Policies";
const SECTION_UPDATES: &str = "Updates";
const SECTION_APPS: &str = "Apps";
const SECTION_ENROLLMENT: &str = "Enrollment";
const SECTION_SCRIPTS: &str = "Scripts";

const SECTION_ORDER: &[&str] = &[
    SECTION_POLICIES,
    SECTION_UPDATES,
    SECTION_APPS,
    SECTION_ENROLLMENT,
    SECTION_SCRIPTS,
];

const CROSS_PLATFORM_SCOPE: &str = "Cross-platform";

fn platform_scope_from_catalog(platforms: Option<&str>) -> (String, String) {
    let raw = platforms.unwrap_or("").trim();
    if raw.is_empty() || raw.contains(',') {
        let label = CROSS_PLATFORM_SCOPE.to_string();
        (label.clone(), label)
    } else {
        let platform = platform_label(Some(raw));
        (platform.clone(), platform)
    }
}

fn enrollment_scope_and_platform(object: &Value) -> (String, String) {
    if let Some(platform) = object
        .get("platformType")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        let platform = canonical_platform(platform);
        return (platform.clone(), platform);
    }
    let odata = object
        .get("@odata.type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if odata.contains("windows") {
        return ("Windows".into(), "Windows".into());
    }
    if odata.contains("ios") && !odata.contains("mac") {
        return ("iOS".into(), "iOS".into());
    }
    if odata.contains("macos") || odata.contains("mac") {
        return ("macOS".into(), "macOS".into());
    }
    if odata.contains("android") {
        return ("Android".into(), "Android".into());
    }
    let label = CROSS_PLATFORM_SCOPE.to_string();
    (label.clone(), label)
}

struct PlatformSections {
    name: String,
    sections: BTreeMap<&'static str, Vec<ReportCard>>,
}

struct ReportLayout {
    cross_platform: PlatformSections,
    platforms: Vec<PlatformSections>,
}

fn push_card(bucket: &mut PlatformSections, card: ReportCard) {
    bucket.sections.entry(card.section).or_default().push(card);
}

fn build_report_layout(mut cards: Vec<ReportCard>) -> ReportLayout {
    let mut cross_platform = PlatformSections {
        name: CROSS_PLATFORM_SCOPE.into(),
        sections: BTreeMap::new(),
    };
    let mut platforms: BTreeMap<String, PlatformSections> = BTreeMap::new();
    for card in cards.drain(..) {
        if card.scope == CROSS_PLATFORM_SCOPE {
            push_card(&mut cross_platform, card);
        } else {
            let entry = platforms
                .entry(card.scope.clone())
                .or_insert_with(|| PlatformSections {
                    name: card.scope.clone(),
                    sections: BTreeMap::new(),
                });
            push_card(entry, card);
        }
    }
    let mut platform_list: Vec<PlatformSections> = platforms.into_values().collect();
    platform_list.sort_by(|left, right| {
        platform_sort_key(&left.name).cmp(&platform_sort_key(&right.name))
    });
    ReportLayout {
        cross_platform,
        platforms: platform_list,
    }
}

fn section_count(sections: &BTreeMap<&'static str, Vec<ReportCard>>, section: &str) -> usize {
    sections.get(section).map(Vec::len).unwrap_or(0)
}

fn platform_object_count(sections: &BTreeMap<&'static str, Vec<ReportCard>>) -> usize {
    sections.values().map(Vec::len).sum()
}

fn device_count_for_platform(glance: &TenantGlance, platform: &str) -> u32 {
    let want = platform.to_ascii_lowercase();
    glance
        .devices
        .by_os
        .iter()
        .map(|(os, count)| {
            if canonical_platform(os).to_ascii_lowercase() == want {
                *count
            } else {
                0
            }
        })
        .sum()
}

fn script_kind_label(kind: &str) -> &'static str {
    match kind {
        "platform-powershell" | "script:platform-powershell" => "PowerShell",
        "platform-shell" | "script:platform-shell" => "Shell",
        "remediation" | "script:remediation" => "Remediation",
        "compliance" | "script:compliance" => "Compliance script",
        _ => "Script",
    }
}

async fn load_graph_card(
    access_token: &str,
    kind: &str,
    id: &str,
    section: &'static str,
    scope: String,
    platform: String,
    kind_label: &str,
    description: Option<&str>,
    note: Option<String>,
    docs: Option<&HashMap<String, CompliancePropertyDoc>>,
    script_names: Option<&HashMap<String, String>>,
) -> Result<ReportCard, GraphError> {
    let detail = fetch_graph_object_detail(access_token, kind, id).await?;
    let source_id = detail.id.clone();
    let mut card = card_from_detail(
        detail,
        section,
        scope,
        platform,
        kind_label,
        description,
        note,
        None,
        docs,
        script_names,
    );
    if kind == "compliancePolicy" {
        card.stats = fetch_compliance_assignment_stats(access_token, &source_id).await;
    }
    Ok(card)
}

async fn load_enrollment_card(
    access_token: &str,
    policy: &CatalogPolicySummary,
) -> Result<ReportCard, GraphError> {
    let detail = fetch_graph_object_detail(access_token, "enrollmentConfiguration", &policy.id).await?;
    let (scope, platform) = enrollment_scope_and_platform(&detail.object);
    let kind_label = detail
        .object
        .get("@odata.type")
        .and_then(Value::as_str)
        .map(|value| {
            humanize_setting_token(
                value
                    .trim_start_matches('#')
                    .trim_start_matches("microsoft.graph."),
                None,
            )
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Enrollment".into());
    Ok(card_from_detail(
        detail,
        SECTION_ENROLLMENT,
        scope,
        platform,
        &kind_label,
        Some(policy.description.as_deref().unwrap_or("")),
        None,
        None,
        None,
        None,
    ))
}

async fn collect_enrollment_extras<F: Fn(EnvironmentReportProgress)>(
    access_token: &str,
    on_progress: &F,
    warnings: &mut Vec<String>,
) -> (Vec<ReportCard>, Vec<String>) {
    let client = GraphClient::new();
    let mut cards = Vec::new();
    let mut group_ids = Vec::new();

    on_progress(progress("enrollment", 0, 0, "Apple Push Notification certificate…"));
    match client
        .fetch_plain::<Value>(
            access_token,
            "/deviceManagement/applePushNotificationCertificate",
            "beta",
        )
        .await
    {
        Ok(object) => {
            cards.push(card_from_plain(
                object,
                SECTION_ENROLLMENT,
                CROSS_PLATFORM_SCOPE.into(),
                CROSS_PLATFORM_SCOPE.into(),
                "Apple Push Notification certificate",
                "Shared APNs certificate used by iOS, iPadOS, and macOS MDM.",
                Vec::new(),
                None,
            ));
        }
        Err(error) => {
            if !is_not_found(&error) {
                warnings.push(format!("Apple Push Notification certificate: {error}"));
            }
        }
    }

    on_progress(progress("enrollment", 0, 0, "Apple Business Manager / ADE tokens…"));
    match client
        .fetch_all_pages::<Value>(
            access_token,
            "/deviceManagement/depOnboardingSettings",
            "beta",
            ASSIGNMENTS_MAX,
        )
        .await
    {
        Ok(tokens) => {
            for token in tokens {
                let token_id = json_str(&token, "id").unwrap_or("").to_string();
                let token_name = json_str(&token, "tokenName")
                    .or_else(|| json_str(&token, "appleIdentifier"))
                    .unwrap_or("Apple ADE token");
                let token_type = json_str(&token, "tokenType").unwrap_or("dep");
                cards.push(card_from_plain(
                    token.clone(),
                    SECTION_ENROLLMENT,
                    CROSS_PLATFORM_SCOPE.into(),
                    CROSS_PLATFORM_SCOPE.into(),
                    &format!("Apple ADE / ABM token ({})", humanize_setting_token(token_type, None)),
                    token_name,
                    Vec::new(),
                    Some(format!("Connector token for Automated Device Enrollment ({token_type}).")),
                ));
                if token_id.is_empty() {
                    continue;
                }
                let enc = encode(&token_id);
                match client
                    .fetch_all_pages::<Value>(
                        access_token,
                        &format!(
                            "/deviceManagement/depOnboardingSettings/{enc}/enrollmentProfiles"
                        ),
                        "beta",
                        ASSIGNMENTS_MAX,
                    )
                    .await
                {
                    Ok(profiles) => {
                        for profile in profiles {
                            let (scope, platform) = apple_ade_profile_scope(&profile);
                            let title = json_str(&profile, "displayName")
                                .or_else(|| json_str(&profile, "profileName"))
                                .unwrap_or("ADE enrollment profile")
                                .to_string();
                            cards.push(card_from_plain(
                                profile,
                                SECTION_ENROLLMENT,
                                scope,
                                platform,
                                "Apple ADE enrollment profile",
                                &title,
                                Vec::new(),
                                Some(format!("From ADE token “{token_name}”.")),
                            ));
                        }
                    }
                    Err(error) => warnings.push(format!(
                        "ADE enrollment profiles for {token_name}: {error}"
                    )),
                }
            }
        }
        Err(error) => warnings.push(format!("Apple ADE / ABM tokens: {error}")),
    }

    on_progress(progress("enrollment", 0, 0, "Android Enterprise enrollment…"));
    match client
        .fetch_plain::<Value>(
            access_token,
            "/deviceManagement/androidManagedStoreAccountEnterpriseSettings",
            "beta",
        )
        .await
    {
        Ok(object) => {
            cards.push(card_from_plain(
                object,
                SECTION_ENROLLMENT,
                "Android".into(),
                "Android".into(),
                "Managed Google Play",
                "Android Enterprise account binding",
                Vec::new(),
                Some("Managed Google Play / Android Enterprise connector for this tenant.".into()),
            ));
        }
        Err(error) => {
            if !is_not_found(&error) {
                warnings.push(format!("Managed Google Play binding: {error}"));
            }
        }
    }
    match client
        .fetch_all_pages::<Value>(
            access_token,
            "/deviceManagement/androidDeviceOwnerEnrollmentProfiles",
            "beta",
            ASSIGNMENTS_MAX,
        )
        .await
    {
        Ok(profiles) => {
            for profile in profiles {
                let title = json_str(&profile, "displayName")
                    .unwrap_or("Android enrollment profile")
                    .to_string();
                let mode = json_str(&profile, "enrollmentMode")
                    .unwrap_or("androidDeviceOwner")
                    .to_string();
                cards.push(card_from_plain(
                    profile,
                    SECTION_ENROLLMENT,
                    "Android".into(),
                    "Android".into(),
                    &format!(
                        "Android Enterprise enrollment ({})",
                        humanize_setting_token(&mode, None)
                    ),
                    &title,
                    Vec::new(),
                    None,
                ));
            }
        }
        Err(error) => warnings.push(format!("Android Device Owner enrollment profiles: {error}")),
    }

    on_progress(progress("enrollment", 0, 0, "Company Portal branding…"));
    match client
        .fetch_plain::<Value>(access_token, "/deviceManagement/intuneBrand", "beta")
        .await
    {
        Ok(object) => {
            cards.push(card_from_plain(
                object,
                SECTION_ENROLLMENT,
                CROSS_PLATFORM_SCOPE.into(),
                CROSS_PLATFORM_SCOPE.into(),
                "Company Portal branding",
                "Intune Company Portal",
                Vec::new(),
                Some("Tenant-wide Company Portal / enrollment branding.".into()),
            ));
        }
        Err(error) => {
            if !is_not_found(&error) {
                warnings.push(format!("Company Portal branding: {error}"));
            }
        }
    }

    on_progress(progress("enrollment", 0, 0, "Terms and conditions…"));
    match client
        .fetch_all_pages::<Value>(
            access_token,
            "/deviceManagement/termsAndConditions",
            "beta",
            ASSIGNMENTS_MAX,
        )
        .await
    {
        Ok(rows) => {
            for row in rows {
                let id = json_str(&row, "id").unwrap_or("").to_string();
                let title = json_str(&row, "displayName")
                    .unwrap_or("Terms and conditions")
                    .to_string();
                let mut drafts = Vec::new();
                if !id.is_empty() {
                    let enc = encode(&id);
                    if let Ok(assignments) = client
                        .fetch_all_pages::<Value>(
                            access_token,
                            &format!("/deviceManagement/termsAndConditions/{enc}/assignments"),
                            "beta",
                            ASSIGNMENTS_MAX,
                        )
                        .await
                    {
                        drafts = drafts_from_graph_assignments(&assignments, false);
                        for draft in &drafts {
                            if let Some(gid) = draft.group_id.clone() {
                                group_ids.push(gid);
                            }
                        }
                    }
                }
                cards.push(card_from_plain(
                    row,
                    SECTION_ENROLLMENT,
                    CROSS_PLATFORM_SCOPE.into(),
                    CROSS_PLATFORM_SCOPE.into(),
                    "Terms and conditions",
                    &title,
                    drafts,
                    None,
                ));
            }
        }
        Err(error) => warnings.push(format!("Terms and conditions: {error}")),
    }

    on_progress(progress("enrollment", 0, 0, "Device categories…"));
    match client
        .fetch_all_pages::<Value>(
            access_token,
            "/deviceManagement/deviceCategories",
            "beta",
            ASSIGNMENTS_MAX,
        )
        .await
    {
        Ok(rows) if !rows.is_empty() => {
            let mut settings = Vec::new();
            for row in &rows {
                let name = json_str(row, "displayName").unwrap_or("Category");
                let description = json_str(row, "description").unwrap_or("");
                settings.push(if description.is_empty() {
                    SettingRow::new(name, "Configured")
                } else {
                    SettingRow::new(name, description)
                });
            }
            cards.push(ReportCard {
                source_id: "device-categories".into(),
                section: SECTION_ENROLLMENT,
                scope: CROSS_PLATFORM_SCOPE.into(),
                title: "Device categories".into(),
                description: "Categories available during enrollment / device inventory.".into(),
                platform: CROSS_PLATFORM_SCOPE.into(),
                kind_label: "Device categories".into(),
                drafts: Vec::new(),
                metadata: vec![
                    SettingRow::new("Type", "Device categories"),
                    SettingRow::new("Platform", CROSS_PLATFORM_SCOPE),
                    SettingRow::new("Count", rows.len().to_string()),
                ],
                settings,
                code_blocks: Vec::new(),
                stats: None,
                app_install: None,
                note: None,
            });
        }
        Ok(_) => {}
        Err(error) => warnings.push(format!("Device categories: {error}")),
    }

    on_progress(progress("enrollment", 0, 0, "Autopilot device inventory…"));
    match summarize_autopilot_devices(&client, access_token).await {
        Ok(Some(card)) => cards.push(card),
        Ok(None) => {}
        Err(error) => warnings.push(format!("Autopilot devices: {error}")),
    }

    (cards, group_ids)
}

fn is_not_found(error: &GraphError) -> bool {
    matches!(
        error,
        GraphError::Request {
            status: 404,
            ..
        }
    )
}

fn apple_ade_profile_scope(object: &Value) -> (String, String) {
    let odata = object
        .get("@odata.type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if odata.contains("macos") || odata.contains("mac") {
        return ("macOS".into(), "macOS".into());
    }
    if odata.contains("tvos") || odata.contains("appletv") {
        return ("tvOS".into(), "tvOS".into());
    }
    if odata.contains("vision") {
        return ("visionOS".into(), "visionOS".into());
    }
    if let Some(platform) = object
        .get("platform")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        let platform = canonical_platform(platform);
        return (platform.clone(), platform);
    }
    ("iOS".into(), "iOS".into())
}

fn card_from_plain(
    object: Value,
    section: &'static str,
    scope: String,
    platform: String,
    kind_label: &str,
    title: &str,
    drafts: Vec<AssignmentDraft>,
    note: Option<String>,
) -> ReportCard {
    let id = json_str(&object, "id")
        .map(str::to_string)
        .unwrap_or_else(|| slug(title));
    let description = json_str(&object, "description")
        .or_else(|| json_str(&object, "tokenName"))
        .unwrap_or("")
        .to_string();
    let settings = object_property_rows(&object, &HashMap::new(), &HashMap::new());
    ReportCard {
        source_id: id,
        section,
        scope,
        title: title.into(),
        description,
        platform: platform.clone(),
        kind_label: kind_label.into(),
        drafts,
        metadata: metadata_from_object(&object, &platform, kind_label),
        settings,
        code_blocks: Vec::new(),
        stats: None,
        app_install: None,
        note,
    }
}

async fn summarize_autopilot_devices(
    client: &GraphClient,
    access_token: &str,
) -> Result<Option<ReportCard>, GraphError> {
    let devices = client
        .fetch_all_pages::<Value>(
            access_token,
            "/deviceManagement/windowsAutopilotDeviceIdentities?$select=id,groupTag,enrollmentState,manufacturer,model,deploymentProfileAssignmentStatus",
            "beta",
            5000,
        )
        .await?;
    if devices.is_empty() {
        return Ok(None);
    }
    let mut by_state: BTreeMap<String, u32> = BTreeMap::new();
    let mut by_tag: BTreeMap<String, u32> = BTreeMap::new();
    let mut by_profile_status: BTreeMap<String, u32> = BTreeMap::new();
    for device in &devices {
        let state = json_str(device, "enrollmentState").unwrap_or("unknown");
        *by_state.entry(humanize_setting_token(state, None)).or_insert(0) += 1;
        let tag = json_str(device, "groupTag")
            .filter(|value| !value.is_empty())
            .unwrap_or("(none)");
        *by_tag.entry(tag.to_string()).or_insert(0) += 1;
        let status = json_str(device, "deploymentProfileAssignmentStatus").unwrap_or("unknown");
        *by_profile_status
            .entry(humanize_setting_token(status, None))
            .or_insert(0) += 1;
    }
    let mut settings = vec![SettingRow::new("Registered devices", devices.len().to_string())];
    let state_children = by_state
        .into_iter()
        .map(|(name, count)| SettingRow::new(name, count.to_string()))
        .collect();
    settings.push(SettingRow::with_children("Enrollment state", "", state_children));
    let status_children = by_profile_status
        .into_iter()
        .map(|(name, count)| SettingRow::new(name, count.to_string()))
        .collect();
    settings.push(SettingRow::with_children(
        "Profile assignment status",
        "",
        status_children,
    ));
    let mut tag_rows: Vec<_> = by_tag.into_iter().collect();
    tag_rows.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    tag_rows.truncate(25);
    let tag_children = tag_rows
        .into_iter()
        .map(|(name, count)| SettingRow::new(name, count.to_string()))
        .collect();
    settings.push(SettingRow::with_children("Group tags", "", tag_children));
    Ok(Some(ReportCard {
        source_id: "autopilot-devices".into(),
        section: SECTION_ENROLLMENT,
        scope: "Windows".into(),
        title: "Autopilot devices".into(),
        description: "Summary of Windows Autopilot hardware registered in this tenant.".into(),
        platform: "Windows".into(),
        kind_label: "Autopilot devices".into(),
        drafts: Vec::new(),
        metadata: vec![
            SettingRow::new("Type", "Autopilot devices"),
            SettingRow::new("Platform", "Windows"),
        ],
        settings,
        code_blocks: Vec::new(),
        stats: None,
        app_install: None,
        note: Some(
            "Device serials and hardware hashes are omitted; this is a count summary only.".into(),
        ),
    }))
}

async fn load_script_card(
    access_token: &str,
    script: &TenantScriptSummary,
    kind: &str,
) -> Result<ReportCard, GraphError> {
    let detail = fetch_graph_object_detail(access_token, kind, &script.id).await?;
    let run_as = script
        .run_as_account
        .as_deref()
        .or_else(|| {
            detail
                .object
                .get("runAsAccount")
                .and_then(Value::as_str)
        })
        .unwrap_or("system");
    let mut metadata = vec![
        SettingRow::new("Kind", script_kind_label(&script.kind)),
        SettingRow::new("Run as", title_case_words(run_as)),
    ];
    if let Some(publisher) = script.publisher.as_deref().filter(|value| !value.is_empty()) {
        metadata.push(SettingRow::new("Publisher", publisher));
    }
    if let Some(file_name) = script.file_name.as_deref().filter(|value| !value.is_empty()) {
        metadata.push(SettingRow::new("File name", file_name));
    }
    let mut code_blocks = Vec::new();
    if let Some(text) = detail.detection_script_text.as_deref().filter(|value| !value.trim().is_empty()) {
        code_blocks.push(("Detection script".into(), text.to_string()));
    }
    if let Some(text) = detail.remediation_script_text.as_deref().filter(|value| !value.trim().is_empty()) {
        code_blocks.push(("Remediation script".into(), text.to_string()));
    }
    if code_blocks.is_empty() {
        if let Some(text) = detail.script_text.as_deref().filter(|value| !value.trim().is_empty()) {
            code_blocks.push(("Script".into(), text.to_string()));
        }
    }
    let platform = script_platform(&script.kind);
    let mut card = card_from_detail(
        detail,
        SECTION_SCRIPTS,
        platform.clone(),
        platform,
        script_kind_label(&script.kind),
        Some(script.description.as_deref().unwrap_or("")),
        None,
        Some(Vec::new()),
        None,
        None,
    );
    card.metadata.extend(metadata);
    card.code_blocks = code_blocks;
    Ok(card)
}

fn script_platform(kind: &str) -> String {
    match kind {
        "platform-shell" => "macOS".into(),
        _ => "Windows".into(),
    }
}

async fn load_endpoint_security_card(
    access_token: &str,
    policy: &CatalogPolicySummary,
) -> Result<ReportCard, GraphError> {
    let client = GraphClient::new();
    let enc = encode(&policy.id);
    let object: Value = client
        .fetch_plain(
            access_token,
            &format!("/deviceManagement/intents/{enc}"),
            "beta",
        )
        .await?;
    let settings_raw = client
        .fetch_all_pages::<Value>(
            access_token,
            &format!("/deviceManagement/intents/{enc}/settings"),
            "beta",
            SETTINGS_PAGE_MAX,
        )
        .await
        .unwrap_or_default();
    let assignments = client
        .fetch_all_pages::<Value>(
            access_token,
            &format!("/deviceManagement/intents/{enc}/assignments"),
            "beta",
            ASSIGNMENTS_MAX,
        )
        .await
        .unwrap_or_default();
    let title = object
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or(&policy.name)
        .to_string();
    let description = object
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or(policy.description.as_deref().unwrap_or(""))
        .to_string();
    Ok(ReportCard {
        source_id: policy.id.clone(),
        section: SECTION_POLICIES,
        scope: "Windows".into(),
        title,
        description,
        platform: "Windows".into(),
        kind_label: "Endpoint Security".into(),
        drafts: drafts_from_graph_assignments(&assignments, false),
        metadata: metadata_from_object(&object, "Windows", "Endpoint Security"),
        settings: intent_setting_rows(&settings_raw),
        code_blocks: Vec::new(),
        stats: fetch_intent_assignment_stats(access_token, &policy.id).await,
        app_install: None,
        note: None,
    })
}

fn card_from_detail(
    detail: GraphObjectDetail,
    section: &'static str,
    scope: String,
    platform: String,
    kind_label: &str,
    description: Option<&str>,
    note: Option<String>,
    settings_override: Option<Vec<SettingRow>>,
    docs: Option<&HashMap<String, CompliancePropertyDoc>>,
    script_names: Option<&HashMap<String, String>>,
) -> ReportCard {
    let title = detail.title.clone();
    let object_description = detail
        .object
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let description = description
        .filter(|value| !value.is_empty())
        .unwrap_or(object_description)
        .to_string();
    let drafts = drafts_from_graph_assignments(&detail.assignments, false);
    let settings = if let Some(rows) = settings_override {
        rows
    } else {
        settings_from_detail(&detail, docs, script_names)
    };
    ReportCard {
        source_id: detail.id.clone(),
        section,
        scope,
        title,
        description,
        platform: platform.clone(),
        kind_label: kind_label.into(),
        drafts,
        metadata: metadata_from_object(&detail.object, &platform, kind_label),
        settings,
        code_blocks: Vec::new(),
        stats: None,
        app_install: None,
        note,
    }
}

fn metadata_from_object(object: &Value, platform: &str, kind_label: &str) -> Vec<SettingRow> {
    let mut rows = vec![
        SettingRow::new("Type", kind_label),
        SettingRow::new("Platform", platform),
    ];
    if let Some(tech) = object.get("technologies").and_then(Value::as_str).filter(|v| !v.is_empty()) {
        rows.push(SettingRow::new("Technologies", tech));
    }
    if let Some(created) = object.get("createdDateTime").and_then(Value::as_str).filter(|v| !v.is_empty()) {
        rows.push(SettingRow::new("Created", created));
    }
    if let Some(modified) = object
        .get("lastModifiedDateTime")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    {
        rows.push(SettingRow::new("Last modified", modified));
    }
    if let Some(odata) = object
        .get("@odata.type")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    {
        rows.push(SettingRow::new(
            "Graph type",
            humanize_setting_token(
                odata
                    .trim_start_matches('#')
                    .trim_start_matches("microsoft.graph."),
                None,
            ),
        ));
    }
    rows
}

fn apply_policy_stats(card: &mut ReportCard, index: &HashMap<String, crate::policy_health::PolicyHealth>) {
    if card.stats.is_some() {
        return;
    }
    let Some(row) = lookup_policy_health(index, &card.source_id, &card.title) else {
        return;
    };
    card.stats = Some(policy_stats(
        row.compliant,
        row.noncompliant,
        row.error,
        row.conflict,
        row.not_applicable,
        0,
        0,
    ));
}

fn policy_stats(
    success: u32,
    noncompliant: u32,
    error: u32,
    conflict: u32,
    not_applicable: u32,
    pending: u32,
    in_grace: u32,
) -> PolicyStats {
    PolicyStats {
        success,
        noncompliant,
        error,
        conflict,
        not_applicable,
        pending,
        in_grace,
        targeted: success
            .saturating_add(noncompliant)
            .saturating_add(error)
            .saturating_add(conflict)
            .saturating_add(pending),
    }
}

async fn fetch_compliance_assignment_stats(access_token: &str, policy_id: &str) -> Option<PolicyStats> {
    let client = GraphClient::new();
    let overview = client
        .fetch_plain::<Value>(access_token, &device_status_overview_path(policy_id), "beta")
        .await
        .ok()?;
    Some(policy_stats(
        number_u32(&overview, "successCount"),
        number_u32(&overview, "failedCount"),
        number_u32(&overview, "errorCount"),
        number_u32(&overview, "conflictCount"),
        number_u32(&overview, "notApplicableCount"),
        number_u32(&overview, "pendingCount")
            .saturating_add(number_u32(&overview, "unknownDeviceCount")),
        number_u32(&overview, "inGracePeriodCount"),
    ))
}

async fn fetch_intent_assignment_stats(access_token: &str, policy_id: &str) -> Option<PolicyStats> {
    let client = GraphClient::new();
    let enc = encode(policy_id);
    let summary = client
        .fetch_plain::<Value>(
            access_token,
            &format!("/deviceManagement/intents/{enc}/deviceStateSummary"),
            "beta",
        )
        .await
        .ok()?;
    Some(policy_stats(
        number_u32(&summary, "successCount"),
        number_u32(&summary, "failedCount"),
        number_u32(&summary, "errorCount"),
        number_u32(&summary, "conflictCount"),
        number_u32(&summary, "notApplicableCount")
            .saturating_add(number_u32(&summary, "notApplicablePlatformCount")),
        number_u32(&summary, "unknownCount"),
        0,
    ))
}

fn settings_from_detail(
    detail: &GraphObjectDetail,
    docs: Option<&HashMap<String, CompliancePropertyDoc>>,
    script_names: Option<&HashMap<String, String>>,
) -> Vec<SettingRow> {
    let empty_docs = HashMap::new();
    let empty_names = HashMap::new();
    let docs = docs.unwrap_or(&empty_docs);
    let script_names = script_names.unwrap_or(&empty_names);
    let mut rows = if let Some(settings) = &detail.settings {
        if looks_like_catalog(settings) {
            format_catalog_setting_rows(settings)
        } else if looks_like_admx(settings) {
            format_admx_rows(settings)
        } else if !settings.is_empty() {
            intent_setting_rows(settings)
        } else {
            object_property_rows(&detail.object, docs, script_names)
        }
    } else {
        object_property_rows(&detail.object, docs, script_names)
    };
    if let Some(extras) = &detail.extras {
        rows.extend(scheduled_action_rows(extras));
    }
    rows
}

fn looks_like_catalog(settings: &[Value]) -> bool {
    settings.iter().any(|row| {
        row.get("settingInstance").is_some() || row.get("settingDefinitionId").is_some()
    })
}

fn looks_like_admx(settings: &[Value]) -> bool {
    settings.iter().any(|row| {
        row.get("definition").is_some() || row.get("enabled").and_then(Value::as_bool).is_some()
    })
}

fn intent_setting_rows(settings: &[Value]) -> Vec<SettingRow> {
    settings
        .iter()
        .filter_map(|row| {
            let definition_id = json_str(row, "definitionId")
                .or_else(|| json_str(row, "settingDefinitionId"))
                .unwrap_or("");
            if definition_id.is_empty() {
                return None;
            }
            let value = row
                .get("valueJson")
                .cloned()
                .or_else(|| row.get("value").cloned())
                .unwrap_or(Value::Null);
            Some(SettingRow::new(
                humanize_setting_token(definition_id, None),
                format_json_value(&value),
            ))
        })
        .collect()
}

fn object_property_rows(
    object: &Value,
    docs: &HashMap<String, CompliancePropertyDoc>,
    script_names: &HashMap<String, String>,
) -> Vec<SettingRow> {
    collect_property_rows(object, docs, script_names, 0, skip_object_key, false)
}

fn app_property_rows(object: &Value) -> Vec<SettingRow> {
    collect_property_rows(
        object,
        &HashMap::new(),
        &HashMap::new(),
        0,
        skip_app_key,
        false,
    )
}

fn collect_property_rows(
    value: &Value,
    docs: &HashMap<String, CompliancePropertyDoc>,
    script_names: &HashMap<String, String>,
    depth: usize,
    skip_key: fn(&str) -> bool,
    decode_scripts: bool,
) -> Vec<SettingRow> {
    let Some(map) = value.as_object() else {
        return Vec::new();
    };
    let mut rows = Vec::new();
    for (key, child) in map {
        if skip_key(key) {
            continue;
        }
        if child.is_null() {
            continue;
        }
        if key == "deviceCompliancePolicyScript" {
            if let Some(row) = custom_compliance_script_row(child, script_names) {
                rows.push(row);
            }
            continue;
        }
        if decode_scripts && is_script_content_key(key) {
            if let Some(text) = decode_embedded_script(child) {
                rows.push(SettingRow::new(humanize_setting_token(key, None), text));
            }
            continue;
        }
        let label = if let Some(doc) = docs.get(key) {
            preferred_label(&[doc.label.as_deref(), Some(key)])
                .unwrap_or_else(|| app_field_label(key))
        } else {
            app_field_label(key)
        };
        if let Some(doc) = docs.get(key) {
            if let Some(option) = doc
                .options
                .iter()
                .find(|option| option_matches(option, child))
            {
                rows.push(SettingRow::new(label, option.label.clone()));
                continue;
            }
        }
        match child {
            Value::Object(_) if depth < 4 => {
                let children =
                    collect_property_rows(child, docs, script_names, depth + 1, skip_key, decode_scripts);
                if !children.is_empty() {
                    rows.push(SettingRow::with_children(label, "", children));
                }
            }
            Value::Array(items) if items.iter().any(Value::is_object) && depth < 4 => {
                let mut children = Vec::new();
                for (index, item) in items.iter().enumerate() {
                    if item.is_object() {
                        let nested = collect_property_rows(
                            item,
                            docs,
                            script_names,
                            depth + 1,
                            skip_key,
                            decode_scripts,
                        );
                        if !nested.is_empty() {
                            children.push(SettingRow::with_children(
                                array_item_label(item, index),
                                "",
                                nested,
                            ));
                        }
                    } else if let Some(formatted) = format_display_value(key, item) {
                        children.push(SettingRow::new(
                            array_item_label(item, index),
                            formatted,
                        ));
                    }
                }
                if !children.is_empty() {
                    rows.push(SettingRow::with_children(label, "", children));
                }
            }
            _ => {
                if let Some(formatted) = format_display_value(key, child) {
                    rows.push(SettingRow::new(label, formatted));
                }
            }
        }
    }
    rows
}

fn app_field_label(key: &str) -> String {
    match key {
        "rules" => "Detection and requirement rules".into(),
        "detectionRules" => "Detection rules".into(),
        "requirementRules" => "Requirement rules".into(),
        "returnCodes" => "Return codes".into(),
        "installCommandLine" => "Install command line".into(),
        "uninstallCommandLine" => "Uninstall command line".into(),
        "setupFilePath" => "Setup file".into(),
        "fileName" => "File name".into(),
        "msiInformation" => "MSI".into(),
        "installExperience" => "Install experience".into(),
        "minimumSupportedOperatingSystem" => "Minimum OS".into(),
        other => humanize_setting_token(other, None),
    }
}

fn array_item_label(item: &Value, index: usize) -> String {
    if let Some(code) = item.get("returnCode") {
        let kind = item
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("code");
        return format!("Exit {code} ({})", humanize_setting_token(kind, None));
    }
    if let Some(ty) = item
        .get("@odata.type")
        .and_then(Value::as_str)
        .or_else(|| item.get("odataType").and_then(Value::as_str))
    {
        return humanize_setting_token(
            ty.trim_start_matches('#')
                .trim_start_matches("microsoft.graph."),
            None,
        );
    }
    format!("Item {}", index + 1)
}

fn is_script_content_key(key: &str) -> bool {
    matches!(
        key,
        "scriptContent" | "detectionScriptContent" | "remediationScriptContent" | "rulesContent"
    )
}

fn decode_embedded_script(value: &Value) -> Option<String> {
    let raw = value.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(decoded) = decode_b64_text(raw) {
        return Some(decoded);
    }
    if is_base64_blob(raw) {
        return None;
    }
    Some(raw.to_string())
}

fn decode_b64_text(raw: &str) -> Option<String> {
    use base64::Engine;
    let compact: String = raw.chars().filter(|ch| !ch.is_whitespace()).collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&compact)
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(&compact))
        .ok()?;
    let text = String::from_utf8(bytes).ok()?;
    if text.chars().any(|ch| ch == '\u{0}' || (ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))) {
        return None;
    }
    Some(text)
}

fn custom_compliance_script_row(
    value: &Value,
    script_names: &HashMap<String, String>,
) -> Option<SettingRow> {
    let id = json_str(value, "deviceComplianceScriptId")?;
    let name = script_names
        .get(id)
        .cloned()
        .unwrap_or_else(|| "Custom compliance script".into());
    Some(SettingRow::new("Custom compliance script", name))
}

fn scheduled_action_rows(extras: &Value) -> Vec<SettingRow> {
    let Some(actions) = extras.get("scheduledActions").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut rows = Vec::new();
    for action in actions {
        let configs = action
            .get("scheduledActionConfigurations")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for config in configs {
            let action_type = json_str(&config, "actionType").unwrap_or("action");
            let hours = config
                .get("gracePeriodHours")
                .and_then(Value::as_u64)
                .or_else(|| {
                    config
                        .get("gracePeriodHours")
                        .and_then(Value::as_i64)
                        .map(|value| value.max(0) as u64)
                })
                .unwrap_or(0);
            let when = if hours == 0 {
                "immediately".into()
            } else if hours == 1 {
                "after 1 hour".into()
            } else if hours % 24 == 0 {
                let days = hours / 24;
                format!("after {days} day{}", if days == 1 { "" } else { "s" })
            } else {
                format!("after {hours} hours")
            };
            rows.push(SettingRow::new(
                "Noncompliance action",
                format!("{} {when}", humanize_setting_token(action_type, None)),
            ));
        }
    }
    rows
}

fn option_matches(option: &crate::compliance_docs::CompliancePropertyOption, value: &Value) -> bool {
    match value {
        Value::String(raw) => option.value == *raw || option.label.eq_ignore_ascii_case(raw),
        Value::Bool(flag) => {
            option.value.eq_ignore_ascii_case(if *flag { "true" } else { "false" })
        }
        Value::Number(number) => option.value == number.to_string(),
        _ => false,
    }
}

fn skip_object_key(key: &str) -> bool {
    if key.contains('@') || key.starts_with("odata") {
        return true;
    }
    matches!(
        key,
        "id" | "displayName"
            | "name"
            | "description"
            | "createdDateTime"
            | "lastModifiedDateTime"
            | "version"
            | "roleScopeTagIds"
            | "roleScopeTags"
            | "assignments"
            | "scheduledActionsForRule"
            | "settingCount"
            | "technologies"
            | "templateReference"
            | "priority"
            | "scriptContent"
            | "detectionScriptContent"
            | "remediationScriptContent"
            | "rulesContent"
            | "notificationTemplateId"
            | "certificate"
            | "tokenValue"
            | "token"
            | "wifiPassword"
            | "qrCodeImage"
            | "qrCodeContent"
            | "enrollmentToken"
            | "secretReferenceValueId"
    )
}

fn skip_app_key(key: &str) -> bool {
    if is_script_content_key(key) {
        return true;
    }
    if skip_object_key(key) {
        return true;
    }
    matches!(
        key,
        "largeIcon"
            | "isAssigned"
            | "committedContentVersion"
            | "uploadState"
            | "publishingState"
            | "size"
            | "isFeatured"
            | "dependentAppCount"
            | "supersedingAppCount"
            | "supersededAppCount"
            | "usedLicenseCount"
            | "totalLicenseCount"
            | "appAvailability"
    )
}

fn skip_display_value(key: &str, value: &Value) -> bool {
    match value {
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return true;
            }
            if trimmed.contains("$metadata") || trimmed.contains("graph.microsoft.com/") {
                return true;
            }
            if key.ends_with("Id") || key.ends_with("Ids") {
                return is_guid(trimmed) || trimmed.len() > 80;
            }
            is_base64_blob(trimmed)
        }
        Value::Array(items) if items.is_empty() => true,
        Value::Object(map) if map.is_empty() => true,
        _ => false,
    }
}

fn is_guid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && bytes.iter().enumerate().all(|(index, ch)| {
            matches!(index, 8 | 13 | 18 | 23) || ch.is_ascii_hexdigit()
        })
}

fn is_base64_blob(value: &str) -> bool {
    if value.len() < 48 {
        return false;
    }
    value.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '=' | '\n' | '\r')
    }) && !value.contains(' ')
}

fn format_display_value(key: &str, value: &Value) -> Option<String> {
    if skip_display_value(key, value) {
        return None;
    }
    match value {
        Value::Bool(flag) => Some(format_bool_for_key(key, *flag)),
        Value::String(raw) => {
            let trimmed = raw.trim();
            Some(humanize_enum_token(trimmed))
        }
        other => {
            let formatted = format_json_value(other);
            if formatted.is_empty() || formatted == "{}" || formatted == "[]" {
                None
            } else {
                Some(formatted)
            }
        }
    }
}

fn format_bool_for_key(key: &str, flag: bool) -> String {
    let lower = key.to_ascii_lowercase();
    if lower.contains("hidden") || lower.contains("skip") {
        if flag {
            "Yes".into()
        } else {
            "No".into()
        }
    } else if flag {
        "Enabled".into()
    } else {
        "Disabled".into()
    }
}

fn humanize_enum_token(value: &str) -> String {
    if value.contains(' ') || value.contains('/') || value.contains(':') {
        return value.to_string();
    }
    humanize_setting_token(value, None)
}

fn json_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn format_json_value(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(flag) => {
            if *flag {
                "Enabled".into()
            } else {
                "Disabled".into()
            }
        }
        Value::Number(number) => number.to_string(),
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                String::new()
            } else if trimmed.starts_with('{') || trimmed.starts_with('[') {
                serde_json::from_str::<Value>(trimmed)
                    .map(|parsed| format_json_value(&parsed))
                    .unwrap_or_else(|_| trimmed.to_string())
            } else {
                trimmed.to_string()
            }
        }
        Value::Array(items) => {
            let parts: Vec<String> = items
                .iter()
                .map(format_json_value)
                .filter(|part| !part.is_empty())
                .collect();
            if parts.is_empty() {
                String::new()
            } else if parts.len() <= 4 {
                parts.join(", ")
            } else {
                format!(
                    "{} (+{} more)",
                    parts[..4].join(", "),
                    parts.len() - 4
                )
            }
        }
        Value::Object(map) => {
            let parts: Vec<String> = map
                .iter()
                .filter(|(key, _)| !skip_object_key(key))
                .filter_map(|(key, item)| {
                    let formatted = format_display_value(key, item)?;
                    Some(format!("{}: {formatted}", humanize_setting_token(key, None)))
                })
                .take(8)
                .collect();
            parts.join("; ")
        }
    }
}

struct CatalogDefinition {
    display_name: Option<String>,
    name: Option<String>,
    options: Vec<(String, Option<String>, Option<String>)>,
}

fn format_catalog_setting_rows(settings: &[Value]) -> Vec<SettingRow> {
    let definitions = collect_definitions(settings);
    settings
        .iter()
        .filter_map(|row| {
            let instance = row
                .get("settingInstance")
                .cloned()
                .or_else(|| {
                    if row.get("settingDefinitionId").is_some() {
                        Some(row.clone())
                    } else {
                        None
                    }
                })?;
            Some(summarize_instance(&instance, &definitions))
        })
        .collect()
}

fn collect_definitions(settings: &[Value]) -> HashMap<String, CatalogDefinition> {
    let mut definitions = HashMap::new();
    for row in settings {
        let Some(Value::Array(defs)) = row.get("settingDefinitions") else {
            continue;
        };
        for def in defs {
            let Some(id) = json_str(def, "id") else {
                continue;
            };
            let options = def
                .get("options")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|option| {
                            let item_id = json_str(option, "itemId")
                                .or_else(|| json_str(option, "name"))?
                                .to_string();
                            Some((
                                item_id,
                                json_str(option, "name").map(str::to_string),
                                json_str(option, "displayName").map(str::to_string),
                            ))
                        })
                        .collect()
                })
                .unwrap_or_default();
            definitions.insert(
                id.to_string(),
                CatalogDefinition {
                    display_name: json_str(def, "displayName").map(str::to_string),
                    name: json_str(def, "name").map(str::to_string),
                    options,
                },
            );
        }
    }
    definitions
}

fn summarize_instance(
    instance: &Value,
    definitions: &HashMap<String, CatalogDefinition>,
) -> SettingRow {
    let definition_id = json_str(instance, "settingDefinitionId").unwrap_or("unknown");
    let def = definitions.get(definition_id);
    let name = preferred_label(&[
        def.and_then(|item| item.display_name.as_deref()),
        def.and_then(|item| item.name.as_deref()),
    ])
    .unwrap_or_else(|| {
        if definition_id == "unknown" {
            "Unknown setting".into()
        } else {
            humanize_setting_token(definition_id, None)
        }
    });

    if let Some(choice) = instance.get("choiceSettingValue") {
        if let Some(value) = json_str(choice, "value") {
            let option = option_label(value, def, definition_id);
            let children = child_setting_rows(choice.get("children"), definitions);
            return SettingRow::with_children(name, option, children);
        }
    }
    if let Some(simple) = instance.get("simpleSettingValue") {
        if simple.get("value").is_some() {
            return SettingRow::new(name, format_primitive(simple.get("value")));
        }
    }
    if let Some(group) = instance.get("groupSettingValue") {
        let children = child_setting_rows(group.get("children"), definitions);
        let value = if children.is_empty() {
            "Empty group".into()
        } else {
            format!("{} nested", children.len())
        };
        return SettingRow::with_children(name, value, children);
    }
    if instance.get("simpleSettingCollectionValue").is_some() {
        let children: Vec<SettingRow> = collection_entries(instance.get("simpleSettingCollectionValue"))
            .iter()
            .enumerate()
            .map(|(index, item)| {
                SettingRow::new(
                    format!("Value {}", index + 1),
                    format_primitive(item.get("value").or(Some(item))),
                )
            })
            .collect();
        let value = if children.is_empty() {
            "No values".into()
        } else {
            format!("{} values", children.len())
        };
        return SettingRow::with_children(name, value, children);
    }
    if instance.get("choiceSettingCollectionValue").is_some() {
        let children: Vec<SettingRow> = collection_entries(instance.get("choiceSettingCollectionValue"))
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let raw = json_str(item, "value").unwrap_or("");
                SettingRow::new(format!("Selection {}", index + 1), option_label(raw, def, definition_id))
            })
            .collect();
        let value = if children.is_empty() {
            "No selections".into()
        } else {
            format!("{} selections", children.len())
        };
        return SettingRow::with_children(name, value, children);
    }
    if instance.get("groupSettingCollectionValue").is_some() {
        let groups = collection_entries(instance.get("groupSettingCollectionValue"));
        let children: Vec<SettingRow> = groups
            .iter()
            .enumerate()
            .map(|(index, group)| {
                let nested = child_setting_rows(group.get("children"), definitions);
                SettingRow::with_children(
                    format!("Group {}", index + 1),
                    if nested.is_empty() {
                        "Empty group".into()
                    } else {
                        format!("{} nested", nested.len())
                    },
                    nested,
                )
            })
            .collect();
        let value = if children.is_empty() {
            "No groups".into()
        } else {
            format!("{} groups", children.len())
        };
        return SettingRow::with_children(name, value, children);
    }
    SettingRow::new(name, "Configured")
}

fn child_setting_rows(
    children: Option<&Value>,
    definitions: &HashMap<String, CatalogDefinition>,
) -> Vec<SettingRow> {
    let Some(Value::Array(items)) = children else {
        return Vec::new();
    };
    items
        .iter()
        .map(|child| summarize_instance(child.get("settingInstance").unwrap_or(child), definitions))
        .collect()
}

fn collection_entries(value: Option<&Value>) -> Vec<Value> {
    match value {
        Some(Value::Array(items)) => items.clone(),
        Some(Value::Object(map)) => map
            .get("value")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn option_label(
    option_id: &str,
    definition: Option<&CatalogDefinition>,
    definition_id: &str,
) -> String {
    if let Some(definition) = definition {
        if let Some((_, name, display_name)) = definition.options.iter().find(|(item_id, name, _)| {
            item_id.eq_ignore_ascii_case(option_id) || name.as_deref() == Some(option_id)
        }) {
            if let Some(label) = preferred_label(&[display_name.as_deref(), name.as_deref()]) {
                return label;
            }
        }
    }
    humanize_setting_token(option_id, Some(definition_id))
}

fn format_admx_rows(settings: &[Value]) -> Vec<SettingRow> {
    settings
        .iter()
        .map(|row| {
            let definition = row.get("definition");
            let name = preferred_label(&[
                definition.and_then(|item| json_str(item, "displayName")),
                definition.and_then(|item| json_str(item, "name")),
            ])
            .unwrap_or_else(|| {
                json_str(row, "id")
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "Setting".into())
            });
            let state = match row.get("enabled").and_then(Value::as_bool) {
                Some(true) => "Enabled",
                Some(false) => "Disabled",
                None => "Configured",
            };
            let presentations = row
                .get("presentationValues")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let children: Vec<SettingRow> = presentations
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    let presentation = item.get("presentation");
                    let label = preferred_label(&[
                        presentation.and_then(|value| json_str(value, "label")),
                        presentation.and_then(|value| json_str(value, "displayName")),
                    ])
                    .unwrap_or_else(|| format!("Value {}", index + 1));
                    SettingRow::new(label, format_primitive(item.get("value")))
                })
                .collect();
            SettingRow::with_children(name, state, children)
        })
        .collect()
}

fn format_primitive(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => "(empty)".into(),
        Some(Value::Bool(true)) => "Enabled".into(),
        Some(Value::Bool(false)) => "Disabled".into(),
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::String(raw)) if raw.trim().is_empty() => "(empty)".into(),
        Some(Value::String(raw)) => raw.trim().to_string(),
        Some(other) => format_json_value(other),
    }
}

fn is_localization_key(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("l_") || lower.starts_with("l/") || {
        trimmed.starts_with('l') && trimmed.chars().nth(1).is_some_and(|ch| ch.is_ascii_uppercase())
    }
}

fn is_admx_placeholder(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return true;
    }
    let compact = trimmed.replace(' ', "");
    let lower = compact.to_ascii_lowercase();
    lower.starts_with("l_empty")
        || (lower.starts_with("empty") && lower.chars().skip(5).all(|ch| ch.is_ascii_digit()))
}

fn preferred_label(candidates: &[Option<&str>]) -> Option<String> {
    for candidate in candidates {
        if let Some(value) = candidate.map(str::trim).filter(|value| !value.is_empty()) {
            if !is_localization_key(value) && !is_admx_placeholder(value) {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn humanize_setting_token(value: &str, definition_id: Option<&str>) -> String {
    let mut token = value.trim().to_string();
    if token.is_empty() {
        return "(empty)".into();
    }
    if let Some(definition_id) = definition_id {
        if let Some(rest) = token.strip_prefix(&format!("{definition_id}_")) {
            token = rest.to_string();
        } else if let Some(rest) = token.strip_prefix(definition_id) {
            token = rest.trim_start_matches('_').to_string();
        }
    }
    token = split_ident(&token);
    let parts: Vec<&str> = token
        .split(|ch| ch == '_' || ch == '/' || ch == '~' || ch == ' ')
        .filter(|part| !part.is_empty())
        .filter(|part| {
            let lower = part.to_ascii_lowercase();
            if lower.starts_with("l_") || lower == "l" {
                return false;
            }
            if definition_id.is_some()
                && matches!(
                    lower.as_str(),
                    "device"
                        | "user"
                        | "machine"
                        | "vendor"
                        | "msft"
                        | "microsoft"
                        | "config"
                        | "admx"
                        | "grouppolicy"
                        | "policy"
                )
            {
                return false;
            }
            true
        })
        .collect();
    let words = if parts.is_empty() {
        token
    } else {
        parts.join(" ")
    };
    match words.to_ascii_lowercase().as_str() {
        "true" | "enabled" => "Enabled".into(),
        "false" | "disabled" => "Disabled".into(),
        "allow" => "Allow".into(),
        "block" => "Block".into(),
        "none" => "None".into(),
        "singleuser" | "single user" => "Single user".into(),
        "shared" => "Shared".into(),
        "standard" => "Standard".into(),
        "administrator" | "admin" => "Administrator".into(),
        "notconfigured" | "not configured" => "Not configured".into(),
        _ => title_case_words(&words),
    }
}

fn split_ident(value: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = value.chars().collect();
    for (i, &ch) in chars.iter().enumerate() {
        if i > 0 && ch.is_ascii_uppercase() {
            let prev = chars[i - 1];
            let next_lower = chars.get(i + 1).is_some_and(|c| c.is_ascii_lowercase());
            if prev.is_ascii_lowercase() || prev.is_ascii_digit() || next_lower {
                out.push(' ');
            }
        }
        out.push(ch);
    }
    out
}

fn title_case_words(input: &str) -> String {
    input
        .split(|ch: char| ch == ' ' || ch == '_' || ch == '-')
        .filter(|part| !part.is_empty())
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            match lower.as_str() {
                "mdm" => "MDM".into(),
                "id" => "ID".into(),
                "url" => "URL".into(),
                "os" => "OS".into(),
                "vpn" => "VPN".into(),
                "wifi" => "Wi-Fi".into(),
                "bitlocker" => "BitLocker".into(),
                "defender" => "Defender".into(),
                _ if word.chars().all(|ch| ch.is_ascii_digit()) => word.to_string(),
                _ => {
                    let mut chars = word.chars();
                    match chars.next() {
                        Some(first) => {
                            format!("{}{}", first.to_ascii_uppercase(), chars.as_str().to_ascii_lowercase())
                        }
                        None => String::new(),
                    }
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn assignment_target_label(draft: &AssignmentDraft) -> String {
    let group = draft
        .group_name
        .as_deref()
        .or(draft.group_id.as_deref())
        .unwrap_or("group");
    let base = match draft.target_kind {
        AssignmentTargetKind::AllUsers => "All users".into(),
        AssignmentTargetKind::AllDevices => "All devices".into(),
        AssignmentTargetKind::ExclusionGroup => format!("Exclude · {group}"),
        AssignmentTargetKind::Group => format!("Include · {group}"),
    };
    match (
        draft.filter_name.as_deref().or(draft.filter_id.as_deref()),
        draft.filter_mode,
    ) {
        (Some(filter), Some(crate::assignments::AssignmentFilterMode::Exclude)) => {
            format!("{base} (exclude filter {filter})")
        }
        (Some(filter), _) => format!("{base} (include filter {filter})"),
        _ => base,
    }
}

fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Escape Markdown-significant characters in tenant / user content.
fn escape_markdown(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' | '`' | '*' | '_' | '{' | '}' | '[' | ']' | '(' | ')' | '#' | '+' | '-' | '.'
            | '!' | '|' | '<' | '>' => {
                out.push('\\');
                out.push(ch);
            }
            '\n' | '\r' => out.push(' '),
            _ => out.push(ch),
        }
    }
    out
}

/// Table cells only need pipe / backtick / angle escapes so dates stay readable.
fn escape_markdown_cell(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' | '`' | '|' | '<' | '>' => {
                out.push('\\');
                out.push(ch);
            }
            '\n' | '\r' => out.push(' '),
            _ => out.push(ch),
        }
    }
    out
}

fn resolve_prepared_label(value: Option<&str>, fallback: &str) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn slug(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

fn membership_label(kind: GroupMembershipKind) -> &'static str {
    match kind {
        GroupMembershipKind::Assigned => "Assigned",
        GroupMembershipKind::DynamicUser => "Dynamic user",
        GroupMembershipKind::DynamicDevice => "Dynamic device",
        GroupMembershipKind::Dynamic => "Dynamic",
    }
}

fn app_mechanism(app: &MobileAppSummary) -> String {
    if let Some(label) = app.app_type_label.as_deref().filter(|value| !value.is_empty()) {
        return label.to_string();
    }
    app.odata_type
        .as_deref()
        .map(|raw| {
            humanize_setting_token(
                raw.trim_start_matches('#')
                    .trim_start_matches("microsoft.graph."),
                None,
            )
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "App".into())
}

async fn collect_app_inventory<F: Fn(EnvironmentReportProgress)>(
    access_token: &str,
    apps: &[MobileAppSummary],
    on_progress: &F,
    warnings: &mut Vec<String>,
) -> (AppInventory, Vec<String>) {
    let concurrency = graph_fetch_concurrency();
    on_progress(progress("apps", 0, 0, "Loading app install status…"));
    let install_rows = match fetch_app_install_health(access_token).await {
        Ok(rows) => rows,
        Err(error) => {
            warnings.push(format!("App install status: {error}"));
            Vec::new()
        }
    };
    let install_index = Arc::new(index_app_install(&install_rows));
    let mut mechanisms: BTreeMap<String, (u32, u32)> = BTreeMap::new();
    for app in apps {
        let label = app_mechanism(app);
        let entry = mechanisms.entry(label).or_insert((0, 0));
        entry.0 += 1;
        if app.is_assigned == Some(true) {
            entry.1 += 1;
        }
    }
    let total = apps.len() as u32;
    on_progress(progress(
        "apps",
        0,
        total.max(1),
        &format!("Fetching {total} apps (concurrency {concurrency})…"),
    ));

    let token = access_token.to_string();
    let mut completed = 0u32;
    let results: Vec<AppFetchResult> = stream::iter(apps.iter().cloned())
        .map(|app| {
            let token = token.clone();
            let install_index = Arc::clone(&install_index);
            async move { load_app_card(&token, app, install_index.as_ref()).await }
        })
        .buffer_unordered(concurrency)
        .inspect(|_| {
            completed += 1;
            on_progress(progress(
                "apps",
                completed,
                total.max(1),
                &format!("Loaded {completed} of {total} apps"),
            ));
        })
        .collect()
        .await;

    let mut failed_device_total = 0u32;
    let mut installed_device_total = 0u32;
    let mut failing = Vec::new();
    let mut group_ids = Vec::new();
    let mut summary_errors = 0u32;
    let mut detail_errors = 0u32;
    let mut assigned_count = 0usize;
    let mut cards = Vec::new();
    for result in results {
        if result.detail_error {
            detail_errors += 1;
        }
        if result.summary_error {
            summary_errors += 1;
        }
        if result.assigned {
            assigned_count += 1;
        }
        failed_device_total += result.failed;
        installed_device_total += result.installed;
        group_ids.extend(result.group_ids);
        if let Some(row) = result.failing {
            failing.push(row);
        }
        cards.push(result.card);
    }
    if detail_errors > 0 {
        warnings.push(format!(
            "App settings unavailable for {detail_errors} applications."
        ));
    }
    if summary_errors > 0 {
        warnings.push(format!(
            "App install summaries unavailable for {summary_errors} assigned apps."
        ));
    }
    failing.sort_by(|left, right| {
        right
            .2
            .cmp(&left.2)
            .then(left.0.to_lowercase().cmp(&right.0.to_lowercase()))
    });
    failing.truncate(25);
    let by_mechanism = mechanisms
        .into_iter()
        .map(|(label, (count, assigned))| (label, count, assigned))
        .collect();
    (
        AppInventory {
            total: apps.len(),
            assigned: assigned_count.max(
                apps.iter()
                    .filter(|app| app.is_assigned == Some(true))
                    .count(),
            ),
            failed_device_total,
            installed_device_total,
            by_mechanism,
            failing,
            cards,
        },
        group_ids,
    )
}

struct AppFetchResult {
    card: ReportCard,
    group_ids: Vec<String>,
    assigned: bool,
    failed: u32,
    installed: u32,
    failing: Option<(String, String, u32)>,
    detail_error: bool,
    summary_error: bool,
}

async fn load_app_card(
    access_token: &str,
    app: MobileAppSummary,
    install_index: &HashMap<String, AppInstallHealth>,
) -> AppFetchResult {
    let client = GraphClient::new();
    let mut drafts = Vec::new();
    let mut settings = Vec::new();
    let mut code_blocks = Vec::new();
    let mut object_assigned = app.is_assigned == Some(true);
    let mut detail_error = false;
    let mut summary_error = false;
    let mut group_ids = Vec::new();
    let enc = encode(&app.id);
    match client
        .fetch_plain::<Value>(
            access_token,
            &format!("/deviceAppManagement/mobileApps/{enc}"),
            "beta",
        )
        .await
    {
        Ok(object) => {
            if let Some(flag) = object.get("isAssigned").and_then(Value::as_bool) {
                object_assigned = flag;
            }
            settings = app_property_rows(&object);
            if let Some(notes) = object
                .get("notes")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
            {
                if !settings.iter().any(|row| row.name == "Notes") {
                    settings.push(SettingRow::new("Notes", notes));
                }
            }
            collect_app_scripts(&object, &mut code_blocks);
        }
        Err(_) => detail_error = true,
    }
    let report_row = lookup_app_install(install_index, &app.id, &app.display_name);
    let assigned = object_assigned || report_row.is_some();
    if assigned {
        match client
            .fetch_all_pages::<Value>(
                access_token,
                &format!("/deviceAppManagement/mobileApps/{enc}/assignments"),
                "beta",
                ASSIGNMENTS_MAX,
            )
            .await
        {
            Ok(rows) => {
                drafts = drafts_from_graph_assignments(&rows, true);
                for draft in &drafts {
                    if let Some(id) = draft.group_id.clone() {
                        group_ids.push(id);
                    }
                }
            }
            Err(_) => {}
        }
    }
    let app_install = if let Some(row) = report_row {
        Some(AppInstallStats {
            installed: row.installed,
            failed: row.failed,
            not_installed: row.not_installed,
            pending: row.pending,
            not_applicable: row.not_applicable,
        })
    } else if assigned {
        match client
            .fetch_plain::<Value>(
                access_token,
                &format!("/deviceAppManagement/mobileApps/{enc}/installSummary"),
                "beta",
            )
            .await
        {
            Ok(summary) => Some(AppInstallStats {
                installed: number_u32(&summary, "installedDeviceCount"),
                failed: number_u32(&summary, "failedDeviceCount"),
                not_installed: number_u32(&summary, "notInstalledDeviceCount"),
                pending: number_u32(&summary, "pendingInstallDeviceCount"),
                not_applicable: number_u32(&summary, "notApplicableDeviceCount"),
            }),
            Err(_) => {
                summary_error = true;
                None
            }
        }
    } else {
        None
    };
    let mut failed = 0u32;
    let mut installed = 0u32;
    let mut failing = None;
    if let Some(stats) = &app_install {
        failed = stats.failed;
        installed = stats.installed;
        if stats.failed > 0 {
            failing = Some((
                app.display_name.clone(),
                app_mechanism(&app),
                stats.failed,
            ));
        }
    }
    let platform = canonical_platform(app.platform.as_deref().unwrap_or(""));
    let mut metadata = vec![
        SettingRow::new("Mechanism", app_mechanism(&app)),
        SettingRow::new("Assigned", if assigned { "Yes" } else { "No" }),
    ];
    if let Some(publisher) = app.publisher.as_deref().filter(|value| !value.is_empty()) {
        metadata.push(SettingRow::new("Publisher", publisher));
    }
    if let Some(version) = app.display_version.as_deref().filter(|value| !value.is_empty()) {
        metadata.push(SettingRow::new("Version", version));
    }
    if let Some(package) = app
        .package_identifier
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        metadata.push(SettingRow::new("Package", package));
    }
    let card = ReportCard {
        source_id: app.id.clone(),
        section: SECTION_APPS,
        scope: platform.clone(),
        title: app.display_name.clone(),
        description: String::new(),
        platform,
        kind_label: app_mechanism(&app),
        drafts,
        metadata,
        settings,
        code_blocks,
        stats: None,
        app_install,
        note: None,
    };
    AppFetchResult {
        card,
        group_ids,
        assigned,
        failed,
        installed,
        failing,
        detail_error,
        summary_error,
    }
}

fn collect_app_scripts(value: &Value, out: &mut Vec<(String, String)>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if is_script_content_key(key) {
                    if let Some(text) = decode_embedded_script(child) {
                        if !text.trim().is_empty() {
                            out.push((app_field_label(key), text));
                        }
                    }
                } else {
                    collect_app_scripts(child, out);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_app_scripts(item, out);
            }
        }
        _ => {}
    }
}

fn number_u32(value: &Value, key: &str) -> u32 {
    value
        .get(key)
        .and_then(Value::as_u64)
        .or_else(|| value.get(key).and_then(Value::as_i64).map(|n| n.max(0) as u64))
        .unwrap_or(0) as u32
}

async fn assemble_intune_groups(
    access_token: &str,
    groups: &[crate::assignments::DirectoryGroup],
    uses: &HashMap<String, u32>,
) -> Vec<IntuneGroupRow> {
    let client = GraphClient::new();
    let mut rows = Vec::new();
    for group in groups {
        let member_count = group_member_count(&client, access_token, &group.id).await;
        rows.push(IntuneGroupRow {
            name: group.display_name.clone(),
            membership: membership_label(group.membership).into(),
            member_count,
            uses: uses.get(&group.id).copied().unwrap_or(0),
        });
    }
    rows.sort_by(|left, right| {
        right
            .uses
            .cmp(&left.uses)
            .then(left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    rows
}

async fn group_member_count(client: &GraphClient, access_token: &str, id: &str) -> Option<u32> {
    let path = format!("/groups/{}/members?$count=true&$top=1", encode(id));
    client
        .fetch::<GraphCollection<Value>>(access_token, &path, "v1.0")
        .await
        .ok()
        .and_then(|page| page.odata_count)
}

fn render_html(
    axis_version: &str,
    prepared_for: &str,
    prepared_by: &str,
    generated_at: &str,
    selection: &EnvironmentReportSelection,
    glance: &TenantGlance,
    layout: &ReportLayout,
    intune_groups: &[IntuneGroupRow],
    apps: &AppInventory,
    health_rows: &[crate::policy_health::PolicyHealth],
    warnings: &[String],
    object_count: u32,
    enrollment_count: usize,
) -> String {
    let org = glance
        .organization_name
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("This tenant");

    let mut body = String::new();
    body.push_str(&render_title_page(
        prepared_for,
        prepared_by,
        generated_at,
        axis_version,
        selection,
        glance.devices.total as usize,
        apps.total,
        section_total(layout, SECTION_POLICIES),
        section_total(layout, SECTION_UPDATES),
        section_total(layout, SECTION_APPS),
        section_total(layout, SECTION_ENROLLMENT).max(enrollment_count),
        section_total(layout, SECTION_SCRIPTS),
        platform_object_count(&layout.cross_platform.sections),
        layout.platforms.len(),
    ));

    body.push_str(&render_table_of_contents(
        selection,
        layout,
        intune_groups.len(),
        !warnings.is_empty(),
        warnings.len(),
    ));

    if selection.summary {
        body.push_str(&render_summary_section(glance, layout, apps, health_rows));
    }
    if selection.devices {
        body.push_str(&render_devices_section(glance));
    }
    if selection.groups {
        body.push_str(&render_groups_section(intune_groups));
    }

    if platform_object_count(&layout.cross_platform.sections) > 0 {
        body.push_str(&render_platform_chapter(&layout.cross_platform, glance, true));
    }
    for platform in &layout.platforms {
        body.push_str(&render_platform_chapter(platform, glance, false));
    }

    if !warnings.is_empty() {
        let mut notes = String::from("<ul>");
        for warning in warnings {
            notes.push_str(&format!("<li>{}</li>", escape_html(warning)));
        }
        notes.push_str("</ul>");
        body.push_str(&render_fold(
            "fold chapter",
            "notes",
            "Notes",
            Some(warnings.len()),
            true,
            &notes,
        ));
    }

    let _ = object_count;
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{} — Axis as-built</title>
<style>{}</style>
</head>
<body>
{}
<footer><p>Generated by Axis {axis_version}. Assignments and script source are included. This file is a point-in-time as-built, not live Graph.</p></footer>
<script>{}</script>
</body>
</html>"#,
        escape_html(org),
        REPORT_CSS,
        body,
        REPORT_JS
    )
}

fn section_total(layout: &ReportLayout, section: &str) -> usize {
    section_count(&layout.cross_platform.sections, section)
        + layout
            .platforms
            .iter()
            .map(|platform| section_count(&platform.sections, section))
            .sum::<usize>()
}

fn ordered_section_names(sections: &BTreeMap<&'static str, Vec<ReportCard>>) -> Vec<&'static str> {
    let mut names = Vec::new();
    for name in SECTION_ORDER {
        if sections.contains_key(name) {
            names.push(*name);
        }
    }
    for name in sections.keys() {
        if !names.contains(name) {
            names.push(*name);
        }
    }
    names
}

fn render_title_page(
    prepared_for: &str,
    prepared_by: &str,
    generated_at: &str,
    axis_version: &str,
    selection: &EnvironmentReportSelection,
    devices: usize,
    apps: usize,
    policies: usize,
    updates: usize,
    apps_section: usize,
    enrollment: usize,
    scripts: usize,
    cross_platform: usize,
    platforms: usize,
) -> String {
    let _ = apps_section;
    let mut chips = String::new();
    if selection.devices {
        chips.push_str(&count_chip("Devices", devices));
    }
    if selection.any_platform() && selection.any_content_surface() {
        chips.push_str(&count_chip("Platforms", platforms));
        if selection.cross_platform {
            chips.push_str(&count_chip("Cross-platform", cross_platform));
        }
    }
    if selection.policies {
        chips.push_str(&count_chip("Policies", policies));
    }
    if selection.apps {
        chips.push_str(&count_chip("Apps", apps));
    }
    if selection.updates {
        chips.push_str(&count_chip("Updates", updates));
    }
    if selection.enrollment {
        chips.push_str(&count_chip("Enrollment", enrollment));
    }
    if selection.scripts {
        chips.push_str(&count_chip("Scripts", scripts));
    }
    format!(
        r#"<header class="title-page" id="title-page">
<p class="eyebrow">Axis as-built</p>
<h1>Intune environment as-built</h1>
<p class="lede">Point-in-time snapshot of Intune configuration, organised by platform. This file is not live Graph.</p>
<dl class="prepared">
<dt>Prepared for</dt><dd>{}</dd>
<dt>Prepared by</dt><dd>{}</dd>
<dt>Generated</dt><dd>{}</dd>
<dt>Axis</dt><dd>{}</dd>
</dl>
<div class="counts">
{}
</div>
</header>"#,
        escape_html(prepared_for),
        escape_html(prepared_by),
        escape_html(generated_at),
        escape_html(axis_version),
        chips,
    )
}

fn render_table_of_contents(
    selection: &EnvironmentReportSelection,
    layout: &ReportLayout,
    group_count: usize,
    has_notes: bool,
    note_count: usize,
) -> String {
    let mut html = String::from(r#"<nav class="toc" id="contents"><h2>Contents</h2><ol>"#);
    if selection.summary {
        html.push_str("<li><a href=\"#summary\">Summary</a></li>");
    }
    if selection.devices {
        html.push_str("<li><a href=\"#devices\">Devices</a></li>");
    }
    if selection.groups {
        html.push_str(&format!(
            "<li><a href=\"#intune-groups\">Intune groups <span>{}</span></a></li>",
            group_count
        ));
    }
    let cross_count = platform_object_count(&layout.cross_platform.sections);
    if cross_count > 0 {
        html.push_str(&toc_platform_item(&layout.cross_platform));
    }
    for platform in &layout.platforms {
        html.push_str(&toc_platform_item(platform));
    }
    if has_notes {
        html.push_str(&format!(
            "<li><a href=\"#notes\">Notes <span>{}</span></a></li>",
            note_count
        ));
    }
    html.push_str("</ol></nav>");
    html
}

fn toc_platform_item(platform: &PlatformSections) -> String {
    let id = slug(&platform.name);
    let count = platform_object_count(&platform.sections);
    let mut html = format!(
        "<li><a href=\"#{}\">{} <span>{}</span></a>",
        id,
        escape_html(&platform.name),
        count
    );
    let sections = ordered_section_names(&platform.sections);
    if !sections.is_empty() {
        html.push_str("<ol>");
        for section in sections {
            html.push_str(&format!(
                "<li><a href=\"#{}-{}\">{} <span>{}</span></a></li>",
                id,
                slug(section),
                escape_html(section),
                section_count(&platform.sections, section)
            ));
        }
        html.push_str("</ol>");
    }
    html.push_str("</li>");
    html
}

fn render_summary_section(
    glance: &TenantGlance,
    layout: &ReportLayout,
    apps: &AppInventory,
    health_rows: &[crate::policy_health::PolicyHealth],
) -> String {
    let conflict_policies = if health_rows.is_empty() {
        glance.conflicts.summary_count
    } else {
        health_rows.iter().filter(|row| row.has_conflict()).count() as u32
    };
    let conflict_devices = if health_rows.is_empty() {
        glance.conflicts.devices_impacted
    } else {
        health_rows.iter().map(|row| row.conflict).sum::<u32>()
    };
    let compliance_rate = glance
        .compliance
        .rate_percent
        .map(|value| format!("{value}%"))
        .unwrap_or_else(|| "—".into());

    let mut inner = format!(
        r#"<p class="narrative">{} devices in inventory: {} checking in within 7 days, {} stale. Compliance mix is {} compliant, {} noncompliant, {} in grace, {} unknown ({} rate). {} configuration policies report conflicts ({} conflicted device records). App install failures: {} devices.</p>
<div class="strip">
{}{}{}{}{}{}{}
</div>"#,
        glance.devices.total,
        glance.devices.active,
        glance.devices.stale,
        glance.compliance.compliant,
        glance.compliance.noncompliant,
        glance.compliance.in_grace_period,
        glance.compliance.unknown,
        escape_html(&compliance_rate),
        conflict_policies,
        conflict_devices,
        apps.failed_device_total,
        stat("Active devices", &glance.devices.active.to_string()),
        stat("Stale devices", &glance.devices.stale.to_string()),
        stat("Compliant", &glance.compliance.compliant.to_string()),
        stat("Conflict policies", &conflict_policies.to_string()),
        stat("App failures", &apps.failed_device_total.to_string()),
        stat("Apps assigned", &apps.assigned.to_string()),
        stat("Apps installed", &apps.installed_device_total.to_string()),
    );

    let mut platform_rows = Vec::new();
    let cross_count = platform_object_count(&layout.cross_platform.sections);
    if cross_count > 0 {
        platform_rows.push(vec![
            CROSS_PLATFORM_SCOPE.into(),
            "—".into(),
            section_count(&layout.cross_platform.sections, SECTION_POLICIES).to_string(),
            section_count(&layout.cross_platform.sections, SECTION_APPS).to_string(),
            section_count(&layout.cross_platform.sections, SECTION_ENROLLMENT).to_string(),
            section_count(&layout.cross_platform.sections, SECTION_UPDATES).to_string(),
            section_count(&layout.cross_platform.sections, SECTION_SCRIPTS).to_string(),
            cross_count.to_string(),
        ]);
    }
    for platform in &layout.platforms {
        platform_rows.push(vec![
            platform.name.clone(),
            device_count_for_platform(glance, &platform.name).to_string(),
            section_count(&platform.sections, SECTION_POLICIES).to_string(),
            section_count(&platform.sections, SECTION_APPS).to_string(),
            section_count(&platform.sections, SECTION_ENROLLMENT).to_string(),
            section_count(&platform.sections, SECTION_UPDATES).to_string(),
            section_count(&platform.sections, SECTION_SCRIPTS).to_string(),
            platform_object_count(&platform.sections).to_string(),
        ]);
    }
    inner.push_str(&render_fold(
        "fold platform-block",
        "summary-platforms",
        "By platform",
        Some(platform_rows.len()),
        true,
        &simple_table(
            &[
                "Platform",
                "Devices",
                "Policies",
                "Apps",
                "Enrollment",
                "Updates",
                "Scripts",
                "Objects",
            ],
            &platform_rows,
        ),
    ));

    if !apps.by_mechanism.is_empty() {
        inner.push_str(&render_fold(
            "fold platform-block",
            "summary-app-mechanism",
            "App install mechanism",
            Some(apps.by_mechanism.len()),
            false,
            &simple_table(
                &["Mechanism", "Apps", "Assigned"],
                &apps
                    .by_mechanism
                    .iter()
                    .map(|(label, count, assigned)| {
                        vec![label.clone(), count.to_string(), assigned.to_string()]
                    })
                    .collect::<Vec<_>>(),
            ),
        ));
    }
    if !apps.failing.is_empty() {
        inner.push_str(&render_fold(
            "fold platform-block",
            "summary-app-failures",
            "Highest install failures",
            Some(apps.failing.len()),
            false,
            &simple_table(
                &["App", "Mechanism", "Failed devices"],
                &apps
                    .failing
                    .iter()
                    .map(|(name, mechanism, failed)| {
                        vec![name.clone(), mechanism.clone(), failed.to_string()]
                    })
                    .collect::<Vec<_>>(),
            ),
        ));
    }

    render_fold("fold chapter", "summary", "Summary", None, true, &inner)
}

fn render_platform_chapter(
    platform: &PlatformSections,
    glance: &TenantGlance,
    is_cross: bool,
) -> String {
    let id = slug(&platform.name);
    let count = platform_object_count(&platform.sections);
    let mut inner = String::new();
    if is_cross {
        inner.push_str(
            "<p class=\"narrative\">Settings that apply across platforms or are not tied to a single OS — enrollment restrictions, multi-platform policies, and similar tenant-wide configuration.</p>",
        );
    } else {
        let devices = device_count_for_platform(glance, &platform.name);
        inner.push_str(&format!(
            r#"<p class="narrative">{} managed devices on {}. Objects below are scoped to this platform.</p>
<div class="strip">{}{}{}{}{}</div>"#,
            devices,
            escape_html(&platform.name),
            stat("Devices", &devices.to_string()),
            stat(
                "Policies",
                &section_count(&platform.sections, SECTION_POLICIES).to_string()
            ),
            stat(
                "Apps",
                &section_count(&platform.sections, SECTION_APPS).to_string()
            ),
            stat(
                "Enrollment",
                &section_count(&platform.sections, SECTION_ENROLLMENT).to_string()
            ),
            stat(
                "Scripts",
                &section_count(&platform.sections, SECTION_SCRIPTS).to_string()
            ),
        ));
    }
    for section in ordered_section_names(&platform.sections) {
        let Some(cards) = platform.sections.get(section) else {
            continue;
        };
        let mut section_body = String::new();
        for card in cards {
            section_body.push_str(&render_card(card));
        }
        inner.push_str(&render_fold(
            "fold platform-block",
            &format!("{}-{}", id, slug(section)),
            section,
            Some(cards.len()),
            true,
            &section_body,
        ));
    }
    render_fold("fold chapter", &id, &platform.name, Some(count), true, &inner)
}

fn render_devices_section(glance: &TenantGlance) -> String {
    let mut os_rows = glance
        .devices
        .by_os
        .iter()
        .map(|(os, count)| (os.clone(), *count))
        .collect::<Vec<_>>();
    os_rows.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.to_lowercase().cmp(&right.0.to_lowercase())));
    let mut inner = format!(
        r#"<p class="narrative">{} managed devices: {} active (check-in within 7 days) and {} stale.</p>
<div class="strip">{}{}{}</div>"#,
        glance.devices.total,
        glance.devices.active,
        glance.devices.stale,
        stat("Total", &glance.devices.total.to_string()),
        stat("Active", &glance.devices.active.to_string()),
        stat("Stale", &glance.devices.stale.to_string()),
    );
    inner.push_str(&render_fold(
        "fold platform-block",
        "devices-os",
        "By operating system",
        Some(os_rows.len()),
        true,
        &simple_table(
            &["Platform", "Devices"],
            &os_rows
                .iter()
                .map(|(os, count)| vec![os.clone(), count.to_string()])
                .collect::<Vec<_>>(),
        ),
    ));
    inner.push_str(&render_fold(
        "fold platform-block",
        "devices-compliance",
        "Compliance mix",
        None,
        true,
        &simple_table(
            &["State", "Devices"],
            &[
                vec!["Compliant".into(), glance.compliance.compliant.to_string()],
                vec!["Noncompliant".into(), glance.compliance.noncompliant.to_string()],
                vec!["Grace period".into(), glance.compliance.in_grace_period.to_string()],
                vec!["Unknown".into(), glance.compliance.unknown.to_string()],
            ],
        ),
    ));
    render_fold(
        "fold chapter",
        "devices",
        "Devices",
        Some(glance.devices.total as usize),
        true,
        &inner,
    )
}

fn render_groups_section(groups: &[IntuneGroupRow]) -> String {
    let inner = if groups.is_empty() {
        "<p class=\"empty\">No Entra groups are targeted by the Intune objects in this as-built.</p>"
            .to_string()
    } else {
        let mut html = format!(
            "<p class=\"narrative\">{} Entra groups are used as include or exclude targets on Intune policies, scripts, or apps in this snapshot.</p>",
            groups.len()
        );
        let rows = groups
            .iter()
            .map(|group| {
                vec![
                    group.name.clone(),
                    group.membership.clone(),
                    group
                        .member_count
                        .map(|count| count.to_string())
                        .unwrap_or_else(|| "—".into()),
                    group.uses.to_string(),
                ]
            })
            .collect::<Vec<_>>();
        html.push_str(&simple_table(
            &["Group", "Membership", "Members", "Intune uses"],
            &rows,
        ));
        html
    };
    render_fold(
        "fold chapter",
        "intune-groups",
        "Intune groups",
        Some(groups.len()),
        true,
        &inner,
    )
}

fn simple_table(headers: &[&str], rows: &[Vec<String>]) -> String {
    if rows.is_empty() {
        return "<p class=\"empty\">None.</p>".into();
    }
    let mut html = String::from("<table><thead><tr>");
    for header in headers {
        html.push_str(&format!("<th>{}</th>", escape_html(header)));
    }
    html.push_str("</tr></thead><tbody>");
    for row in rows {
        html.push_str("<tr>");
        for (index, cell) in row.iter().enumerate() {
            if index == 0 {
                html.push_str(&format!("<th>{}</th>", escape_html(cell)));
            } else {
                html.push_str(&format!("<td>{}</td>", escape_html(cell)));
            }
        }
        html.push_str("</tr>");
    }
    html.push_str("</tbody></table>");
    html
}

fn count_chip(label: &str, count: usize) -> String {
    format!(
        "<div class=\"chip\"><span>{}</span><strong>{}</strong></div>",
        escape_html(label),
        count
    )
}

fn stat(label: &str, value: &str) -> String {
    format!(
        "<div class=\"stat\"><span>{}</span><strong>{}</strong></div>",
        escape_html(label),
        escape_html(value)
    )
}

fn render_card(card: &ReportCard) -> String {
    let mut html = format!(
        r#"<article class="card">
<header>
<p class="kind">{} · {}</p>
<h4>{}</h4>
{}
</header>"#,
        escape_html(&card.kind_label),
        escape_html(&card.platform),
        escape_html(&card.title),
        if card.description.trim().is_empty() {
            String::new()
        } else {
            format!("<p class=\"desc\">{}</p>", escape_html(&card.description))
        },
    );
    html.push_str(&render_card_status_strip(card));
    if let Some(note) = &card.note {
        html.push_str(&format!("<p class=\"note\">{}</p>", escape_html(note)));
    }
    html.push_str(&render_details(
        "Metadata",
        card.metadata.len(),
        false,
        &render_setting_tree(&card.metadata),
    ));
    let setting_count = count_setting_rows(&card.settings);
    let mut settings_body = render_setting_tree(&card.settings);
    for (label, source) in &card.code_blocks {
        settings_body.push_str(&format!(
            "<h5 class=\"code-label\">{}</h5><pre class=\"code\">{}</pre>",
            escape_html(label),
            escape_html(source)
        ));
    }
    if settings_body.trim().is_empty() {
        settings_body = "<p class=\"empty\">No settings captured.</p>".into();
    }
    html.push_str(&render_details(
        "Settings",
        setting_count,
        true,
        &settings_body,
    ));
    html.push_str(&render_details(
        "Assignments",
        card.drafts.len(),
        false,
        &render_assignments(card),
    ));
    html.push_str("</article>");
    html
}

fn count_setting_rows(rows: &[SettingRow]) -> usize {
    rows.iter()
        .map(|row| 1 + count_setting_rows(&row.children))
        .sum()
}

fn render_details(title: &str, count: usize, open: bool, inner: &str) -> String {
    format!(
        r#"<details class="block"{}><summary>{} <span>{}</span></summary><div class="block-body">{}</div></details>"#,
        if open { " open" } else { "" },
        escape_html(title),
        count,
        inner
    )
}

fn render_fold(
    class: &str,
    id: &str,
    title: &str,
    count: Option<usize>,
    open: bool,
    inner: &str,
) -> String {
    let count_html = count
        .map(|value| format!(" <span>{}</span>", value))
        .unwrap_or_default();
    format!(
        r#"<details class="{}" id="{}"{}><summary>{}{}</summary><div class="fold-body">{}</div></details>"#,
        class,
        id,
        if open { " open" } else { "" },
        escape_html(title),
        count_html,
        inner
    )
}

fn render_setting_tree(rows: &[SettingRow]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let mut html = String::from("<table><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>");
    for row in rows {
        html.push_str(&format!(
            "<tr><th>{}</th><td>{}</td></tr>",
            escape_html(&row.name),
            escape_html(&row.value)
        ));
        if !row.children.is_empty() {
            html.push_str("<tr class=\"nested\"><td colspan=\"2\">");
            html.push_str(&render_details(
                &row.name,
                row.children.len(),
                false,
                &render_setting_tree(&row.children),
            ));
            html.push_str("</td></tr>");
        }
    }
    html.push_str("</tbody></table>");
    html
}

fn render_card_status_strip(card: &ReportCard) -> String {
    if let Some(stats) = &card.stats {
        return format!(
            r#"<div class="strip tight">{}{}{}{}{}{}{}{}</div>"#,
            stat("Targeted", &stats.targeted.to_string()),
            stat("Success", &stats.success.to_string()),
            stat("Conflict", &stats.conflict.to_string()),
            stat("Error", &stats.error.to_string()),
            stat("Noncompliant", &stats.noncompliant.to_string()),
            stat("Not applicable", &stats.not_applicable.to_string()),
            stat("Pending", &stats.pending.to_string()),
            if stats.in_grace > 0 {
                stat("In grace", &stats.in_grace.to_string())
            } else {
                String::new()
            },
        );
    }
    if let Some(stats) = &card.app_install {
        return format!(
            r#"<div class="strip tight">{}{}{}{}{}</div>"#,
            stat("Installed", &stats.installed.to_string()),
            stat("Failed", &stats.failed.to_string()),
            stat("Not installed", &stats.not_installed.to_string()),
            stat("Pending", &stats.pending.to_string()),
            stat("Not applicable", &stats.not_applicable.to_string()),
        );
    }
    String::new()
}

fn render_assignments(card: &ReportCard) -> String {
    let mut html = String::new();
    if let Some(stats) = &card.stats {
        html.push_str("<h5 class=\"code-label\">Assignment status</h5>");
        html.push_str(&simple_table(
            &["Status", "Devices"],
            &[
                vec!["Success".into(), stats.success.to_string()],
                vec!["Conflict".into(), stats.conflict.to_string()],
                vec!["Error".into(), stats.error.to_string()],
                vec!["Noncompliant".into(), stats.noncompliant.to_string()],
                vec!["Not applicable".into(), stats.not_applicable.to_string()],
                vec!["Pending".into(), stats.pending.to_string()],
            ],
        ));
        if stats.in_grace > 0 {
            html.push_str(&simple_table(
                &["Status", "Devices"],
                &[vec!["In grace period".into(), stats.in_grace.to_string()]],
            ));
        }
    }
    if let Some(stats) = &card.app_install {
        html.push_str("<h5 class=\"code-label\">Install status</h5>");
        html.push_str(&simple_table(
            &["Status", "Devices"],
            &[
                vec!["Installed".into(), stats.installed.to_string()],
                vec!["Failed".into(), stats.failed.to_string()],
                vec!["Not installed".into(), stats.not_installed.to_string()],
                vec!["Pending".into(), stats.pending.to_string()],
                vec!["Not applicable".into(), stats.not_applicable.to_string()],
            ],
        ));
    }
    if card.drafts.is_empty() {
        html.push_str("<p class=\"empty\">Not assigned.</p>");
        return html;
    }
    html.push_str("<h5 class=\"code-label\">Targets</h5>");
    let rows = card
        .drafts
        .iter()
        .map(|draft| vec![assignment_target_label(draft)])
        .collect::<Vec<_>>();
    html.push_str(&simple_table(&["Target"], &rows));
    html
}

fn render_markdown(
    axis_version: &str,
    prepared_for: &str,
    prepared_by: &str,
    generated_at: &str,
    selection: &EnvironmentReportSelection,
    glance: &TenantGlance,
    layout: &ReportLayout,
    intune_groups: &[IntuneGroupRow],
    apps: &AppInventory,
    health_rows: &[crate::policy_health::PolicyHealth],
    warnings: &[String],
    enrollment_count: usize,
) -> String {
    let mut out = String::new();
    out.push_str(&md_title_page(
        prepared_for,
        prepared_by,
        generated_at,
        axis_version,
        selection,
        glance.devices.total as usize,
        apps.total,
        section_total(layout, SECTION_POLICIES),
        section_total(layout, SECTION_UPDATES),
        section_total(layout, SECTION_ENROLLMENT).max(enrollment_count),
        section_total(layout, SECTION_SCRIPTS),
        platform_object_count(&layout.cross_platform.sections),
        layout.platforms.len(),
    ));
    out.push('\n');
    out.push_str(&md_table_of_contents(
        selection,
        layout,
        intune_groups.len(),
        !warnings.is_empty(),
        warnings.len(),
    ));
    out.push('\n');

    if selection.summary {
        out.push_str(&md_summary_section(glance, layout, apps, health_rows));
        out.push('\n');
    }
    if selection.devices {
        out.push_str(&md_devices_section(glance));
        out.push('\n');
    }
    if selection.groups {
        out.push_str(&md_groups_section(intune_groups));
        out.push('\n');
    }

    if platform_object_count(&layout.cross_platform.sections) > 0 {
        out.push_str(&md_platform_chapter(&layout.cross_platform, glance, true));
        out.push('\n');
    }
    for platform in &layout.platforms {
        out.push_str(&md_platform_chapter(platform, glance, false));
        out.push('\n');
    }

    if !warnings.is_empty() {
        out.push_str("## Notes\n\n");
        for warning in warnings {
            out.push_str(&format!("- {}\n", escape_markdown(warning)));
        }
        out.push('\n');
    }

    out.push_str(&format!(
        "---\n\nGenerated by Axis {}. Assignments and script source are included. This file is a point-in-time as-built, not live Graph.\n",
        escape_markdown(axis_version)
    ));
    out
}

fn md_title_page(
    prepared_for: &str,
    prepared_by: &str,
    generated_at: &str,
    axis_version: &str,
    selection: &EnvironmentReportSelection,
    devices: usize,
    apps: usize,
    policies: usize,
    updates: usize,
    enrollment: usize,
    scripts: usize,
    cross_platform: usize,
    platforms: usize,
) -> String {
    let mut counts = Vec::new();
    if selection.devices {
        counts.push(("Devices", devices));
    }
    if selection.any_platform() && selection.any_content_surface() {
        counts.push(("Platforms", platforms));
        if selection.cross_platform {
            counts.push(("Cross-platform", cross_platform));
        }
    }
    if selection.policies {
        counts.push(("Policies", policies));
    }
    if selection.apps {
        counts.push(("Apps", apps));
    }
    if selection.updates {
        counts.push(("Updates", updates));
    }
    if selection.enrollment {
        counts.push(("Enrollment", enrollment));
    }
    if selection.scripts {
        counts.push(("Scripts", scripts));
    }

    let mut out = String::from(
        "# Intune environment as-built\n\nAxis as-built — point-in-time snapshot of Intune configuration, organised by platform. This file is not live Graph.\n\n",
    );
    out.push_str(&format!(
        "| | |\n| --- | --- |\n| Prepared for | {} |\n| Prepared by | {} |\n| Generated | {} |\n| Axis | {} |\n\n",
        escape_markdown_cell(prepared_for),
        escape_markdown_cell(prepared_by),
        escape_markdown_cell(generated_at),
        escape_markdown_cell(axis_version),
    ));
    if !counts.is_empty() {
        out.push_str("| Metric | Count |\n| --- | --- |\n");
        for (label, count) in counts {
            out.push_str(&format!(
                "| {} | {} |\n",
                escape_markdown_cell(label),
                count
            ));
        }
        out.push('\n');
    }
    out
}

fn md_table_of_contents(
    selection: &EnvironmentReportSelection,
    layout: &ReportLayout,
    group_count: usize,
    has_notes: bool,
    note_count: usize,
) -> String {
    let mut out = String::from("## Contents\n\n");
    if selection.summary {
        out.push_str("- [Summary](#summary)\n");
    }
    if selection.devices {
        out.push_str("- [Devices](#devices)\n");
    }
    if selection.groups {
        out.push_str(&format!(
            "- [Intune groups](#intune-groups) ({group_count})\n"
        ));
    }
    let cross_count = platform_object_count(&layout.cross_platform.sections);
    if cross_count > 0 {
        out.push_str(&md_toc_platform_item(&layout.cross_platform));
    }
    for platform in &layout.platforms {
        out.push_str(&md_toc_platform_item(platform));
    }
    if has_notes {
        out.push_str(&format!("- [Notes](#notes) ({note_count})\n"));
    }
    out.push('\n');
    out
}

fn md_toc_platform_item(platform: &PlatformSections) -> String {
    let id = slug(&platform.name);
    let count = platform_object_count(&platform.sections);
    let mut out = format!(
        "- [{}](#{}) ({count})\n",
        escape_markdown(&platform.name),
        id
    );
    for section in ordered_section_names(&platform.sections) {
        out.push_str(&format!(
            "  - [{section}](#{id}-{}) ({})\n",
            slug(section),
            section_count(&platform.sections, section)
        ));
    }
    out
}

fn md_summary_section(
    glance: &TenantGlance,
    layout: &ReportLayout,
    apps: &AppInventory,
    health_rows: &[crate::policy_health::PolicyHealth],
) -> String {
    let conflict_policies = if health_rows.is_empty() {
        glance.conflicts.summary_count
    } else {
        health_rows.iter().filter(|row| row.has_conflict()).count() as u32
    };
    let conflict_devices = if health_rows.is_empty() {
        glance.conflicts.devices_impacted
    } else {
        health_rows.iter().map(|row| row.conflict).sum::<u32>()
    };
    let compliance_rate = glance
        .compliance
        .rate_percent
        .map(|value| format!("{value}%"))
        .unwrap_or_else(|| "—".into());

    let mut out = format!(
        "## Summary\n\n{} devices in inventory: {} checking in within 7 days, {} stale. Compliance mix is {} compliant, {} noncompliant, {} in grace, {} unknown ({} rate). {} configuration policies report conflicts ({} conflicted device records). App install failures: {} devices.\n\n",
        glance.devices.total,
        glance.devices.active,
        glance.devices.stale,
        glance.compliance.compliant,
        glance.compliance.noncompliant,
        glance.compliance.in_grace_period,
        glance.compliance.unknown,
        escape_markdown(&compliance_rate),
        conflict_policies,
        conflict_devices,
        apps.failed_device_total,
    );
    out.push_str(&md_simple_table(
        &["Metric", "Value"],
        &[
            vec!["Active devices".into(), glance.devices.active.to_string()],
            vec!["Stale devices".into(), glance.devices.stale.to_string()],
            vec!["Compliant".into(), glance.compliance.compliant.to_string()],
            vec!["Conflict policies".into(), conflict_policies.to_string()],
            vec!["App failures".into(), apps.failed_device_total.to_string()],
            vec!["Apps assigned".into(), apps.assigned.to_string()],
            vec![
                "Apps installed".into(),
                apps.installed_device_total.to_string(),
            ],
        ],
    ));
    out.push('\n');

    let mut platform_rows = Vec::new();
    let cross_count = platform_object_count(&layout.cross_platform.sections);
    if cross_count > 0 {
        platform_rows.push(vec![
            CROSS_PLATFORM_SCOPE.into(),
            "—".into(),
            section_count(&layout.cross_platform.sections, SECTION_POLICIES).to_string(),
            section_count(&layout.cross_platform.sections, SECTION_APPS).to_string(),
            section_count(&layout.cross_platform.sections, SECTION_ENROLLMENT).to_string(),
            section_count(&layout.cross_platform.sections, SECTION_UPDATES).to_string(),
            section_count(&layout.cross_platform.sections, SECTION_SCRIPTS).to_string(),
            cross_count.to_string(),
        ]);
    }
    for platform in &layout.platforms {
        platform_rows.push(vec![
            platform.name.clone(),
            device_count_for_platform(glance, &platform.name).to_string(),
            section_count(&platform.sections, SECTION_POLICIES).to_string(),
            section_count(&platform.sections, SECTION_APPS).to_string(),
            section_count(&platform.sections, SECTION_ENROLLMENT).to_string(),
            section_count(&platform.sections, SECTION_UPDATES).to_string(),
            section_count(&platform.sections, SECTION_SCRIPTS).to_string(),
            platform_object_count(&platform.sections).to_string(),
        ]);
    }
    out.push_str("### By platform\n\n");
    out.push_str(&md_simple_table(
        &[
            "Platform",
            "Devices",
            "Policies",
            "Apps",
            "Enrollment",
            "Updates",
            "Scripts",
            "Objects",
        ],
        &platform_rows,
    ));
    out.push('\n');

    if !apps.by_mechanism.is_empty() {
        out.push_str("### App install mechanism\n\n");
        out.push_str(&md_simple_table(
            &["Mechanism", "Apps", "Assigned"],
            &apps
                .by_mechanism
                .iter()
                .map(|(label, count, assigned)| {
                    vec![label.clone(), count.to_string(), assigned.to_string()]
                })
                .collect::<Vec<_>>(),
        ));
        out.push('\n');
    }
    if !apps.failing.is_empty() {
        out.push_str("### Highest install failures\n\n");
        out.push_str(&md_simple_table(
            &["App", "Mechanism", "Failed devices"],
            &apps
                .failing
                .iter()
                .map(|(name, mechanism, failed)| {
                    vec![name.clone(), mechanism.clone(), failed.to_string()]
                })
                .collect::<Vec<_>>(),
        ));
        out.push('\n');
    }
    out
}

fn md_platform_chapter(
    platform: &PlatformSections,
    glance: &TenantGlance,
    is_cross: bool,
) -> String {
    let id = slug(&platform.name);
    let count = platform_object_count(&platform.sections);
    let mut out = format!(
        "## {} ({count})\n\n<a id=\"{id}\"></a>\n\n",
        escape_markdown(&platform.name)
    );
    if is_cross {
        out.push_str(
            "Settings that apply across platforms or are not tied to a single OS — enrollment restrictions, multi-platform policies, and similar tenant-wide configuration.\n\n",
        );
    } else {
        let devices = device_count_for_platform(glance, &platform.name);
        out.push_str(&format!(
            "{} managed devices on {}. Objects below are scoped to this platform.\n\n",
            devices,
            escape_markdown(&platform.name)
        ));
        out.push_str(&md_simple_table(
            &["Metric", "Value"],
            &[
                vec!["Devices".into(), devices.to_string()],
                vec![
                    "Policies".into(),
                    section_count(&platform.sections, SECTION_POLICIES).to_string(),
                ],
                vec![
                    "Apps".into(),
                    section_count(&platform.sections, SECTION_APPS).to_string(),
                ],
                vec![
                    "Enrollment".into(),
                    section_count(&platform.sections, SECTION_ENROLLMENT).to_string(),
                ],
                vec![
                    "Scripts".into(),
                    section_count(&platform.sections, SECTION_SCRIPTS).to_string(),
                ],
            ],
        ));
        out.push('\n');
    }
    for section in ordered_section_names(&platform.sections) {
        let Some(cards) = platform.sections.get(section) else {
            continue;
        };
        out.push_str(&format!(
            "### {section} ({})\n\n<a id=\"{id}-{}\"></a>\n\n",
            cards.len(),
            slug(section)
        ));
        for card in cards {
            out.push_str(&md_card(card));
            out.push('\n');
        }
    }
    out
}

fn md_devices_section(glance: &TenantGlance) -> String {
    let mut os_rows = glance
        .devices
        .by_os
        .iter()
        .map(|(os, count)| (os.clone(), *count))
        .collect::<Vec<_>>();
    os_rows.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then(left.0.to_lowercase().cmp(&right.0.to_lowercase()))
    });
    let mut out = format!(
        "## Devices ({})\n\n{} managed devices: {} active (check-in within 7 days) and {} stale.\n\n",
        glance.devices.total,
        glance.devices.total,
        glance.devices.active,
        glance.devices.stale,
    );
    out.push_str(&md_simple_table(
        &["Metric", "Value"],
        &[
            vec!["Total".into(), glance.devices.total.to_string()],
            vec!["Active".into(), glance.devices.active.to_string()],
            vec!["Stale".into(), glance.devices.stale.to_string()],
        ],
    ));
    out.push_str("\n### By operating system\n\n");
    out.push_str(&md_simple_table(
        &["Platform", "Devices"],
        &os_rows
            .iter()
            .map(|(os, count)| vec![os.clone(), count.to_string()])
            .collect::<Vec<_>>(),
    ));
    out.push_str("\n### Compliance mix\n\n");
    out.push_str(&md_simple_table(
        &["State", "Devices"],
        &[
            vec!["Compliant".into(), glance.compliance.compliant.to_string()],
            vec![
                "Noncompliant".into(),
                glance.compliance.noncompliant.to_string(),
            ],
            vec![
                "Grace period".into(),
                glance.compliance.in_grace_period.to_string(),
            ],
            vec!["Unknown".into(), glance.compliance.unknown.to_string()],
        ],
    ));
    out.push('\n');
    out
}

fn md_groups_section(groups: &[IntuneGroupRow]) -> String {
    let mut out = format!("## Intune groups ({})\n\n", groups.len());
    if groups.is_empty() {
        out.push_str(
            "No Entra groups are targeted by the Intune objects in this as-built.\n\n",
        );
        return out;
    }
    out.push_str(&format!(
        "{} Entra groups are used as include or exclude targets on Intune policies, scripts, or apps in this snapshot.\n\n",
        groups.len()
    ));
    let rows = groups
        .iter()
        .map(|group| {
            vec![
                group.name.clone(),
                group.membership.clone(),
                group
                    .member_count
                    .map(|count| count.to_string())
                    .unwrap_or_else(|| "—".into()),
                group.uses.to_string(),
            ]
        })
        .collect::<Vec<_>>();
    out.push_str(&md_simple_table(
        &["Group", "Membership", "Members", "Intune uses"],
        &rows,
    ));
    out.push('\n');
    out
}

fn md_simple_table(headers: &[&str], rows: &[Vec<String>]) -> String {
    if rows.is_empty() {
        return "None.\n".into();
    }
    let mut out = String::from("| ");
    out.push_str(
        &headers
            .iter()
            .map(|header| escape_markdown_cell(header))
            .collect::<Vec<_>>()
            .join(" | "),
    );
    out.push_str(" |\n| ");
    out.push_str(
        &headers
            .iter()
            .map(|_| "---")
            .collect::<Vec<_>>()
            .join(" | "),
    );
    out.push_str(" |\n");
    for row in rows {
        out.push_str("| ");
        let cells: Vec<String> = (0..headers.len())
            .map(|index| {
                row.get(index)
                    .map(|cell| escape_markdown_cell(cell))
                    .unwrap_or_default()
            })
            .collect();
        out.push_str(&cells.join(" | "));
        out.push_str(" |\n");
    }
    out
}

fn md_card(card: &ReportCard) -> String {
    let mut out = format!(
        "#### {}\n\n*{} · {}*\n\n",
        escape_markdown(&card.title),
        escape_markdown(&card.kind_label),
        escape_markdown(&card.platform)
    );
    if !card.description.trim().is_empty() {
        out.push_str(&format!("{}\n\n", escape_markdown(&card.description)));
    }
    out.push_str(&md_card_status_strip(card));
    if let Some(note) = &card.note {
        out.push_str(&format!("> {}\n\n", escape_markdown(note)));
    }

    out.push_str(&format!(
        "##### Metadata ({})\n\n",
        card.metadata.len()
    ));
    if card.metadata.is_empty() {
        out.push_str("None.\n\n");
    } else {
        out.push_str(&md_setting_tree(&card.metadata));
        out.push('\n');
    }

    let setting_count = count_setting_rows(&card.settings);
    out.push_str(&format!("##### Settings ({setting_count})\n\n"));
    if card.settings.is_empty() && card.code_blocks.is_empty() {
        out.push_str("No settings captured.\n\n");
    } else {
        if !card.settings.is_empty() {
            out.push_str(&md_setting_tree(&card.settings));
            out.push('\n');
        }
        for (label, source) in &card.code_blocks {
            out.push_str(&format!("**{}**\n\n", escape_markdown(label)));
            out.push_str(&md_fenced_code(source));
            out.push('\n');
        }
    }

    out.push_str(&format!(
        "##### Assignments ({})\n\n",
        card.drafts.len()
    ));
    out.push_str(&md_assignments(card));
    out
}

fn md_card_status_strip(card: &ReportCard) -> String {
    if let Some(stats) = &card.stats {
        let mut rows = vec![
            vec!["Targeted".into(), stats.targeted.to_string()],
            vec!["Success".into(), stats.success.to_string()],
            vec!["Conflict".into(), stats.conflict.to_string()],
            vec!["Error".into(), stats.error.to_string()],
            vec!["Noncompliant".into(), stats.noncompliant.to_string()],
            vec!["Not applicable".into(), stats.not_applicable.to_string()],
            vec!["Pending".into(), stats.pending.to_string()],
        ];
        if stats.in_grace > 0 {
            rows.push(vec!["In grace".into(), stats.in_grace.to_string()]);
        }
        let mut out = md_simple_table(&["Status", "Devices"], &rows);
        out.push('\n');
        return out;
    }
    if let Some(stats) = &card.app_install {
        let mut out = md_simple_table(
            &["Status", "Devices"],
            &[
                vec!["Installed".into(), stats.installed.to_string()],
                vec!["Failed".into(), stats.failed.to_string()],
                vec!["Not installed".into(), stats.not_installed.to_string()],
                vec!["Pending".into(), stats.pending.to_string()],
                vec!["Not applicable".into(), stats.not_applicable.to_string()],
            ],
        );
        out.push('\n');
        return out;
    }
    String::new()
}

fn md_setting_tree(rows: &[SettingRow]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let mut flat = Vec::new();
    flatten_setting_rows(rows, 0, &mut flat);
    md_simple_table(
        &["Setting", "Value"],
        &flat
            .into_iter()
            .map(|(name, value)| vec![name, value])
            .collect::<Vec<_>>(),
    )
}

fn flatten_setting_rows(rows: &[SettingRow], depth: usize, out: &mut Vec<(String, String)>) {
    let prefix = if depth == 0 {
        String::new()
    } else {
        format!("{} ", "↳".repeat(depth))
    };
    for row in rows {
        out.push((format!("{prefix}{}", row.name), row.value.clone()));
        if !row.children.is_empty() {
            flatten_setting_rows(&row.children, depth + 1, out);
        }
    }
}

fn md_fenced_code(source: &str) -> String {
    let mut ticks = 3;
    while source.contains(&"`".repeat(ticks)) {
        ticks += 1;
    }
    let fence = "`".repeat(ticks);
    format!("{fence}\n{source}\n{fence}\n")
}

fn md_assignments(card: &ReportCard) -> String {
    let mut out = String::new();
    if let Some(stats) = &card.stats {
        out.push_str("**Assignment status**\n\n");
        let mut rows = vec![
            vec!["Success".into(), stats.success.to_string()],
            vec!["Conflict".into(), stats.conflict.to_string()],
            vec!["Error".into(), stats.error.to_string()],
            vec!["Noncompliant".into(), stats.noncompliant.to_string()],
            vec!["Not applicable".into(), stats.not_applicable.to_string()],
            vec!["Pending".into(), stats.pending.to_string()],
        ];
        if stats.in_grace > 0 {
            rows.push(vec!["In grace period".into(), stats.in_grace.to_string()]);
        }
        out.push_str(&md_simple_table(&["Status", "Devices"], &rows));
        out.push('\n');
    }
    if let Some(stats) = &card.app_install {
        out.push_str("**Install status**\n\n");
        out.push_str(&md_simple_table(
            &["Status", "Devices"],
            &[
                vec!["Installed".into(), stats.installed.to_string()],
                vec!["Failed".into(), stats.failed.to_string()],
                vec!["Not installed".into(), stats.not_installed.to_string()],
                vec!["Pending".into(), stats.pending.to_string()],
                vec!["Not applicable".into(), stats.not_applicable.to_string()],
            ],
        ));
        out.push('\n');
    }
    if card.drafts.is_empty() {
        out.push_str("Not assigned.\n\n");
        return out;
    }
    out.push_str("**Targets**\n\n");
    let rows = card
        .drafts
        .iter()
        .map(|draft| vec![assignment_target_label(draft)])
        .collect::<Vec<_>>();
    out.push_str(&md_simple_table(&["Target"], &rows));
    out.push('\n');
    out
}

const REPORT_CSS: &str = r#"
:root {
  --crust: #11111b;
  --mantle: #181825;
  --base: #1e1e2e;
  --surface: #313244;
  --overlay: #585b70;
  --text: #cdd6f4;
  --muted: #7f849c;
  --sub: #a6adc8;
  --blue: #89b4fa;
  --peach: #fab387;
  --green: #a6e3a1;
  --red: #f38ba8;
  --yellow: #f9e2af;
}
* { box-sizing: border-box; }
html { background: var(--crust); color: var(--text); }
body {
  margin: 0 auto;
  max-width: 52rem;
  padding: 2.5rem 1.5rem 4rem;
  font: 15px/1.5 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  background: var(--crust);
  color: var(--text);
}
.cover, .title-page { margin-bottom: 2.5rem; }
.title-page {
  padding: 2.5rem 0 2rem;
  border-bottom: 1px solid var(--surface);
}
.title-page h1 { font-size: 2.15rem; margin-bottom: .65rem; }
.prepared {
  display: grid;
  grid-template-columns: 9rem 1fr;
  gap: .35rem 1rem;
  margin: 1.5rem 0 1.25rem;
}
.prepared dt {
  color: var(--muted);
  font-size: .78rem;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.prepared dd { margin: 0; font-size: 1rem; }
.eyebrow {
  margin: 0 0 .35rem;
  color: var(--blue);
  letter-spacing: .12em;
  text-transform: uppercase;
  font-size: .72rem;
  font-weight: 650;
}
h1 { font-size: 2rem; line-height: 1.15; margin: 0 0 .5rem; }
.lede, .narrative, .desc, .assign, .note, .empty { color: var(--sub); }
.lede { margin: 0 0 1.25rem; max-width: 40rem; }
.meta { display: grid; grid-template-columns: 8rem 1fr; gap: .25rem 1rem; margin: 0 0 1.25rem; }
.meta dt { color: var(--muted); font-size: .8rem; }
.meta dd { margin: 0; }
.counts, .strip { display: flex; flex-wrap: wrap; gap: .6rem; }
.chip, .stat {
  background: var(--mantle);
  border: 1px solid var(--surface);
  border-radius: .7rem;
  padding: .55rem .8rem;
  min-width: 7.5rem;
}
.chip span, .stat span { display: block; color: var(--muted); font-size: .72rem; }
.chip strong, .stat strong { font-size: 1.15rem; }
.posture, .chapter, .warnings, .toc, details.fold.chapter { margin: 2.25rem 0; }
.toc {
  margin-top: 0;
  margin-bottom: 2.75rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--surface);
}
.toc h2 { margin-bottom: .85rem; }
h2 { font-size: 1.15rem; margin: 0 0 .75rem; }
details.fold { margin: 1.15rem 0; }
details.fold > summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: baseline;
  gap: .55rem;
  font-weight: 650;
}
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::before {
  content: "▸";
  color: var(--muted);
  font-size: .85em;
  width: .9rem;
  flex: none;
  transform: translateY(-.05rem);
}
details.fold[open] > summary::before { content: "▾"; }
details.fold.chapter > summary { font-size: 1.15rem; }
details.fold.platform-block > summary {
  color: var(--blue);
  font-size: 1.02rem;
  font-weight: 600;
}
details.fold > summary span { color: var(--muted); font-size: .8rem; font-weight: 500; }
details.fold.platform-block {
  margin: 1.15rem 0 1.4rem;
  padding-top: .85rem;
  border-top: 1px solid var(--surface);
}
details.fold.chapter > .fold-body > details.fold.platform-block:first-child {
  border-top: 0;
  padding-top: 0;
}
.fold-body { padding: .35rem 0 .15rem .2rem; }
.toc ol { padding-left: 1.1rem; }
.toc ol ol { margin: .25rem 0 .4rem; }
.toc a { color: var(--text); text-decoration: none; }
.toc span { color: var(--muted); }
.warnings { color: var(--yellow); }
.card {
  background: var(--base);
  border: 1px solid var(--surface);
  border-radius: .85rem;
  padding: 1rem 1.1rem 1.15rem;
  margin: 0 0 .85rem;
}
.strip.tight { margin: .55rem 0 .15rem; }
details.block {
  margin: .55rem 0 0;
  border: 1px solid var(--surface);
  border-radius: .65rem;
  background: var(--mantle);
}
details.block > summary {
  cursor: pointer;
  padding: .45rem .75rem;
  font-weight: 600;
  list-style: none;
}
details.block > summary::-webkit-details-marker { display: none; }
details.block > summary span { color: var(--muted); font-weight: 500; }
.block-body { padding: .1rem .7rem .65rem; }
tr.nested td { padding-left: .2rem; }
.card h4 { margin: .15rem 0 .35rem; font-size: 1.05rem; }
.card .desc { margin: 0 0 .4rem; font-size: .9rem; }
.card .assign { margin: 0; font-size: .85rem; }
.card .note { margin: .5rem 0 0; font-size: .8rem; color: var(--muted); }
.card .empty { margin: .7rem 0 0; font-size: .85rem; }
.card .code-label { margin: .9rem 0 .35rem; font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--peach); }
pre.code {
  margin: 0;
  padding: .7rem .8rem;
  background: var(--mantle);
  border: 1px solid var(--surface);
  border-radius: .55rem;
  font: 0.75rem/1.4 ui-monospace, "Cascadia Mono", Consolas, monospace;
  white-space: pre-wrap;
  overflow: auto;
  max-height: 28rem;
}
table { width: 100%; border-collapse: collapse; margin-top: .75rem; font-size: .82rem; }
th, td { text-align: left; vertical-align: top; padding: .35rem .4rem; border-top: 1px solid var(--surface); }
tbody th { width: 42%; font-weight: 550; color: var(--sub); }
footer { margin-top: 3rem; color: var(--muted); font-size: .78rem; }
a:focus { outline: 2px solid var(--blue); outline-offset: 2px; }
@media print {
  html, body { background: #fff; color: #1b1b1b; }
  body { max-width: none; padding: 0; font-size: 11pt; }
  .cover, .title-page, .card, .chip, .stat { background: #fff; border-color: #ccc; }
  .eyebrow, .card .kind { color: #333; }
  details.fold.platform-block > summary { color: #333; }
  .lede, .narrative, .desc, .assign, .note, .empty, tbody th, footer { color: #444; }
  pre.code { background: #f6f6f6; border-color: #ddd; color: #111; max-height: none; }
  details.block { background: #fff; border-color: #ccc; }
  details.block > .block-body,
  details.fold > .fold-body { display: block !important; }
  details.fold > summary::before { content: none; }
  .card { break-inside: avoid; box-shadow: none; }
  .toc a { color: #000; }
  table th, table td { border-top-color: #ddd; }
}
"#;

const REPORT_JS: &str = r#"
(function () {
  function reveal(el) {
    var node = el;
    while (node) {
      if (node.tagName === "DETAILS") node.open = true;
      node = node.parentElement;
    }
    el.scrollIntoView({ block: "start" });
  }
  function revealHash() {
    var id = location.hash.replace(/^#/, "");
    if (!id) return;
    var el = document.getElementById(id);
    if (el) reveal(el);
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest("a[href^='#']");
    if (!link) return;
    var id = (link.getAttribute("href") || "").replace(/^#/, "");
    var el = id ? document.getElementById(id) : null;
    if (el) reveal(el);
  });
  window.addEventListener("hashchange", revealHash);
  revealHash();
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn escapes_html() {
        assert_eq!(escape_html("<x & \"y\">"), "&lt;x &amp; &quot;y&quot;&gt;");
    }

    #[test]
    fn escapes_markdown_specials() {
        assert_eq!(
            escape_markdown("A *B* | C_ [link](x)"),
            r#"A \*B\* \| C\_ \[link\]\(x\)"#
        );
        assert!(!escape_markdown("line\nbreak").contains('\n'));
    }

    #[test]
    fn markdown_title_page_includes_prepared_for_and_by() {
        let md = md_title_page(
            "Contoso Ltd",
            "jane@contoso.com",
            "2026-09-04T00:00:00Z",
            "0.1.5",
            &EnvironmentReportSelection::default(),
            120,
            45,
            10,
            5,
            2,
            1,
            3,
            4,
        );
        assert!(md.contains("Prepared for"));
        assert!(md.contains("Prepared by"));
        assert!(md.contains("Contoso Ltd"));
        assert!(md.contains("jane@contoso.com"));
        assert!(md.contains("Platforms"));
        assert!(md.starts_with("# Intune environment as-built"));
    }

    #[test]
    fn markdown_toc_lists_summary_before_platforms() {
        let layout = build_report_layout(vec![
            sample_card(SECTION_POLICIES, "Windows", "BitLocker"),
            sample_card(SECTION_APPS, "macOS", "Company Portal"),
            sample_card(SECTION_ENROLLMENT, CROSS_PLATFORM_SCOPE, "Enrollment restrictions"),
        ]);
        let md = md_table_of_contents(
            &EnvironmentReportSelection::default(),
            &layout,
            2,
            false,
            0,
        );
        let summary = md.find("#summary").unwrap_or(0);
        let devices = md.find("#devices").unwrap_or(0);
        let cross = md.find("#cross-platform").unwrap_or(0);
        let windows = md.find("#windows").unwrap_or(0);
        assert!(summary < devices);
        assert!(devices < cross);
        assert!(cross < windows);
        assert!(md.contains("Policies"));
        assert!(md.contains("Apps"));
    }

    #[test]
    fn markdown_card_uses_setting_rows_and_escapes_title() {
        let card = ReportCard {
            source_id: "p1".into(),
            section: SECTION_POLICIES,
            scope: "Windows".into(),
            title: "BitLocker *strict*".into(),
            description: String::new(),
            platform: "Windows".into(),
            kind_label: "Settings Catalog".into(),
            drafts: Vec::new(),
            metadata: vec![SettingRow::new("Type", "Settings Catalog")],
            settings: vec![SettingRow::with_children(
                "Require device encryption",
                "Enabled",
                vec![SettingRow::new("Nested | pipe", "value")],
            )],
            code_blocks: Vec::new(),
            stats: Some(policy_stats(80, 2, 1, 4, 3, 5, 0)),
            app_install: None,
            note: None,
        };
        let md = md_card(&card);
        assert!(md.contains(r#"BitLocker \*strict\*"#));
        assert!(md.contains("Require device encryption"));
        assert!(md.contains("Enabled"));
        assert!(md.contains(r#"Nested \| pipe"#));
        assert!(md.contains("Assignment status") || md.contains("Success"));
        assert!(md.contains("Not assigned."));
    }

    #[test]
    fn skips_loc_labels() {
        assert!(preferred_label(&[Some("L_Empty"), Some("Require password")]).as_deref() == Some("Require password"));
        assert!(is_localization_key("l_FooBar"));
    }

    #[test]
    fn formats_choice_setting() {
        let settings = vec![json!({
            "settingInstance": {
                "settingDefinitionId": "device_vendor_msft_bitlocker_requiredeviceencryption",
                "choiceSettingValue": { "value": "device_vendor_msft_bitlocker_requiredeviceencryption_1" }
            },
            "settingDefinitions": [{
                "id": "device_vendor_msft_bitlocker_requiredeviceencryption",
                "displayName": "Require device encryption",
                "options": [{ "itemId": "device_vendor_msft_bitlocker_requiredeviceencryption_1", "displayName": "Enabled" }]
            }]
        })];
        let rows = format_catalog_setting_rows(&settings);
        assert_eq!(rows[0].name, "Require device encryption");
        assert_eq!(rows[0].value, "Enabled");
    }

    #[test]
    fn flattens_autopilot_oobe_and_skips_graph_noise() {
        let object = json!({
            "displayName": "Autopilot",
            "outOfBoxExperienceSettings": {
                "deviceUsageType": "singleUser",
                "escapeLinkHidden": true,
                "eulaHidden": true,
                "keyboardSelectionPageSkipped": true,
                "privacySettingsHidden": true,
                "userType": "standard"
            },
            "scheduledActionsForRule@odata.context": "https://graph.microsoft.com/beta/$metadata#deviceManagement/deviceCompliancePolicies('x')/scheduledActionsForRule",
            "deviceCompliancePolicyScript": {
                "deviceComplianceScriptId": "61937b2c-069c-4c75-af3e-6e24f0e6fd02",
                "rulesContent": "ew0KICAgICJSdWxlcyI6Ww0K"
            }
        });
        let mut names = HashMap::new();
        names.insert(
            "61937b2c-069c-4c75-af3e-6e24f0e6fd02".into(),
            "Require disk encryption".into(),
        );
        let rows = object_property_rows(&object, &HashMap::new(), &names);
        let names_joined = rows.iter().map(|row| row.name.as_str()).collect::<Vec<_>>().join("|");
        assert!(!names_joined.to_ascii_lowercase().contains("odata"));
        assert!(!rows.iter().any(|row| row.value.contains("$metadata")));
        assert!(!rows.iter().any(|row| row.value.contains("ew0K")));
        let oobe = rows
            .iter()
            .find(|row| !row.children.is_empty())
            .expect("nested oobe");
        let usage = oobe
            .children
            .iter()
            .find(|row| row.name.contains("Usage"))
            .expect("usage");
        assert_eq!(usage.value, "Single user");
        let script = rows.iter().find(|row| row.name.contains("Custom compliance")).expect("script");
        assert_eq!(script.value, "Require disk encryption");
    }

    #[test]
    fn extracts_win32_app_payload_and_scripts() {
        let object = json!({
            "displayName": "Company Portal",
            "installCommandLine": "CompanyPortal.exe /install /quiet",
            "uninstallCommandLine": "CompanyPortal.exe /uninstall /quiet",
            "setupFilePath": "CompanyPortal.exe",
            "fileName": "CompanyPortal.intunewin",
            "largeIcon": { "type": "image/png", "value": "iVBORw0KGgo=" },
            "committedContentVersion": "2",
            "installExperience": {
                "runAsAccount": "system",
                "deviceRestartBehavior": "suppress"
            },
            "returnCodes": [{ "returnCode": 0, "type": "success" }],
            "rules": [{
                "@odata.type": "#microsoft.graph.win32LobAppRegistryDetection",
                "keyPath": "HKEY_LOCAL_MACHINE\\Software\\Company",
                "valueName": "Installed",
                "detectionType": "exists"
            }],
            "detectionRules": [{
                "@odata.type": "#microsoft.graph.win32LobAppPowerShellScriptDetection",
                "enforceSignatureCheck": false,
                "scriptContent": "V3JpdGUtT3V0cHV0ICJvayI="
            }]
        });
        let rows = app_property_rows(&object);
        let names = rows.iter().map(|row| row.name.as_str()).collect::<Vec<_>>();
        assert!(names.contains(&"Install command line"));
        assert!(names.contains(&"Uninstall command line"));
        assert!(names.contains(&"Detection and requirement rules"));
        assert!(!names.iter().any(|name| name.to_ascii_lowercase().contains("icon")));
        let install = rows.iter().find(|row| row.name == "Install command line").unwrap();
        assert_eq!(install.value, "CompanyPortal.exe /install /quiet");
        let mut scripts = Vec::new();
        collect_app_scripts(&object, &mut scripts);
        assert_eq!(scripts.len(), 1);
        assert!(scripts[0].1.contains("Write-Output"));
    }

    #[test]
    fn assignment_status_table_uses_success_label() {
        let card = ReportCard {
            source_id: "p1".into(),
            section: SECTION_POLICIES,
            scope: "Windows".into(),
            title: "BitLocker".into(),
            description: String::new(),
            platform: "Windows".into(),
            kind_label: "Settings Catalog".into(),
            drafts: Vec::new(),
            metadata: Vec::new(),
            settings: Vec::new(),
            code_blocks: Vec::new(),
            stats: Some(policy_stats(80, 2, 1, 4, 3, 5, 0)),
            app_install: None,
            note: None,
        };
        let html = render_assignments(&card);
        assert!(html.contains("Assignment status"));
        assert!(html.contains("Success"));
        assert!(html.contains("80"));
        assert!(html.contains("Pending"));
        assert!(html.contains("Not assigned"));
        let strip = render_card_status_strip(&card);
        assert!(strip.contains("<span>Success</span>"));
        assert!(!strip.contains("<span>Compliant</span>"));
    }

    fn sample_card(section: &'static str, scope: &str, title: &str) -> ReportCard {
        ReportCard {
            source_id: title.to_string(),
            section,
            scope: scope.into(),
            title: title.into(),
            description: String::new(),
            platform: scope.into(),
            kind_label: section.into(),
            drafts: Vec::new(),
            metadata: Vec::new(),
            settings: Vec::new(),
            code_blocks: Vec::new(),
            stats: None,
            app_install: None,
            note: None,
        }
    }

    #[test]
    fn resolve_prepared_label_uses_fallback_when_blank() {
        assert_eq!(
            resolve_prepared_label(Some("  "), "Contoso"),
            "Contoso"
        );
        assert_eq!(
            resolve_prepared_label(Some("Jane Doe"), "Unknown"),
            "Jane Doe"
        );
    }

    #[test]
    fn title_page_includes_prepared_for_and_by() {
        let html = render_title_page(
            "Contoso Ltd",
            "jane@contoso.com",
            "2026-09-04T00:00:00Z",
            "0.1.5",
            &EnvironmentReportSelection::default(),
            120,
            45,
            10,
            5,
            45,
            2,
            1,
            3,
            4,
        );
        assert!(html.contains("Prepared for"));
        assert!(html.contains("Prepared by"));
        assert!(html.contains("Contoso Ltd"));
        assert!(html.contains("jane@contoso.com"));
        assert!(html.contains("Platforms"));
    }

    #[test]
    fn selection_id_filters_default_to_all() {
        let selection = EnvironmentReportSelection::default();
        assert!(EnvironmentReportSelection::allows_id(&selection.policy_ids, "any"));
        assert!(selection.wants_policy_objects());
        assert!(selection.wants_enrollment_extras());

        let narrowed = EnvironmentReportSelection {
            policy_ids: Some(vec!["a".into(), "b".into()]),
            enrollment_ids: Some(vec!["e1".into()]),
            ..EnvironmentReportSelection::default()
        };
        assert!(EnvironmentReportSelection::allows_id(&narrowed.policy_ids, "a"));
        assert!(!EnvironmentReportSelection::allows_id(&narrowed.policy_ids, "c"));
        assert!(narrowed.wants_policy_objects());
        assert!(!narrowed.wants_enrollment_extras());

        let none = EnvironmentReportSelection {
            policy_ids: Some(vec![]),
            app_ids: Some(vec![]),
            script_ids: Some(vec![]),
            enrollment_ids: Some(vec![]),
            ..EnvironmentReportSelection::default()
        };
        assert!(!none.wants_policy_objects());
        assert!(!none.wants_app_objects());
        assert!(!none.wants_script_objects());
        assert!(!none.wants_enrollment_objects());
    }

    #[test]
    fn table_of_contents_lists_summary_before_platforms() {
        let layout = build_report_layout(vec![
            sample_card(SECTION_POLICIES, "Windows", "BitLocker"),
            sample_card(SECTION_APPS, "macOS", "Company Portal"),
            sample_card(SECTION_ENROLLMENT, CROSS_PLATFORM_SCOPE, "Enrollment restrictions"),
        ]);
        let html = render_table_of_contents(
            &EnvironmentReportSelection::default(),
            &layout,
            2,
            false,
            0,
        );
        let summary = html.find("#summary").unwrap_or(0);
        let devices = html.find("#devices").unwrap_or(0);
        let cross = html.find("#cross-platform").unwrap_or(0);
        let windows = html.find("#windows").unwrap_or(0);
        assert!(summary < devices);
        assert!(devices < cross);
        assert!(cross < windows);
        assert!(html.contains("Policies"));
        assert!(html.contains("Apps"));
    }

    #[test]
    fn folds_include_id_and_count() {
        let html = render_fold("fold chapter", "settings-catalog", "Settings Catalog", Some(4), true, "<p>inner</p>");
        assert!(html.contains("id=\"settings-catalog\""));
        assert!(html.contains("Settings Catalog"));
        assert!(html.contains("<span>4</span>"));
        assert!(html.contains(" open"));
        assert!(html.contains("<p>inner</p>"));
    }

    #[test]
    fn layout_groups_by_platform_then_section() {
        let layout = build_report_layout(vec![
            sample_card(SECTION_APPS, "Android", "Authenticator"),
            sample_card(SECTION_POLICIES, "Windows", "BitLocker"),
            sample_card(SECTION_APPS, "Windows", "Portal"),
            sample_card(SECTION_ENROLLMENT, CROSS_PLATFORM_SCOPE, "Restrictions"),
        ]);
        assert_eq!(layout.cross_platform.sections.get(SECTION_ENROLLMENT).unwrap().len(), 1);
        assert_eq!(layout.platforms[0].name, "Windows");
        assert_eq!(layout.platforms[1].name, "Android");
        assert_eq!(
            section_count(&layout.platforms[0].sections, SECTION_POLICIES),
            1
        );
        assert_eq!(section_count(&layout.platforms[0].sections, SECTION_APPS), 1);
    }

    #[test]
    fn apple_ade_profile_scopes_to_platform() {
        let macos = serde_json::json!({
            "@odata.type": "#microsoft.graph.depMacOSEnrollmentProfile",
            "displayName": "Mac ADE"
        });
        let ios = serde_json::json!({
            "@odata.type": "#microsoft.graph.depIOSEnrollmentProfile",
            "displayName": "iPhone ADE"
        });
        assert_eq!(apple_ade_profile_scope(&macos).0, "macOS");
        assert_eq!(apple_ade_profile_scope(&ios).0, "iOS");
    }

    #[test]
    fn enrollment_plain_card_skips_certificate_blob() {
        let object = serde_json::json!({
            "id": "apns-1",
            "appleIdentifier": "admin@contoso.com",
            "expirationDateTime": "2027-01-01T00:00:00Z",
            "certificate": "AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNNOOOOPPPPQQQQ"
        });
        let card = card_from_plain(
            object,
            SECTION_ENROLLMENT,
            CROSS_PLATFORM_SCOPE.into(),
            CROSS_PLATFORM_SCOPE.into(),
            "Apple Push Notification certificate",
            "APNs",
            Vec::new(),
            None,
        );
        assert!(card.settings.iter().any(|row| row.name.contains("Apple")));
        assert!(!card.settings.iter().any(|row| row.name.to_ascii_lowercase().contains("certificate") && row.value.len() > 20));
    }

    #[test]
    fn app_install_status_appears_on_card() {
        let mut card = sample_card(SECTION_APPS, "Windows", "Company Portal");
        card.app_install = Some(AppInstallStats {
            installed: 40,
            failed: 2,
            not_installed: 5,
            pending: 1,
            not_applicable: 8,
        });
        let strip = render_card_status_strip(&card);
        assert!(strip.contains("<span>Installed</span>"));
        assert!(strip.contains("40"));
        let assignments = render_assignments(&card);
        assert!(assignments.contains("Install status"));
        assert!(assignments.contains("Failed"));
        assert!(assignments.contains("2"));
    }
}
