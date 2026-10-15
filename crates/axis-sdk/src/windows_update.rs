//! Windows Update for Business rings (`windowsUpdateForBusinessConfiguration`).
//!
//! Rings live in `deviceConfigurations` as a subtype, so the read/write paths
//! differ from the feature/quality/driver update profiles. This module covers
//! rings only; the other three families stay read-only rows.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::graph::{GraphClient, GraphError};

const COLLECTION: &str = "/deviceManagement/deviceConfigurations";
const ODATA_TYPE: &str = "#microsoft.graph.windowsUpdateForBusinessConfiguration";

/// The fields Axis surfaces. Mirrors the ring shape Intune exposes, grouped the
/// same way the portal groups them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsUpdateRing {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub created_date_time: Option<String>,
    #[serde(default)]
    pub last_modified_date_time: Option<String>,
    #[serde(default)]
    pub is_assigned: bool,

    // Servicing
    #[serde(default)]
    pub microsoft_update_service_allowed: Option<bool>,
    #[serde(default)]
    pub drivers_excluded: Option<bool>,
    #[serde(default)]
    pub allow_windows11_upgrade: Option<bool>,
    #[serde(default)]
    pub delivery_optimization_mode: Option<String>,
    #[serde(default)]
    pub automatic_update_mode: Option<String>,
    #[serde(default)]
    pub business_ready_updates_only: Option<String>,

    // Installation schedule. `installationSchedule` is polymorphic: a scheduled
    // install carries day/time, an active-hours install carries the window.
    // `updateWeeks` only applies to the scheduled variant.
    #[serde(default)]
    pub scheduled_install_day: Option<String>,
    #[serde(default)]
    pub scheduled_install_time: Option<String>,
    #[serde(default)]
    pub update_weeks: Option<String>,
    #[serde(default)]
    pub active_hours_start: Option<String>,
    #[serde(default)]
    pub active_hours_end: Option<String>,

    // Deferrals
    #[serde(default)]
    pub quality_updates_deferral_period_in_days: Option<i32>,
    #[serde(default)]
    pub feature_updates_deferral_period_in_days: Option<i32>,
    #[serde(default)]
    pub feature_updates_rollback_window_in_days: Option<i32>,

    // Pause
    #[serde(default)]
    pub quality_updates_paused: Option<bool>,
    #[serde(default)]
    pub quality_updates_pause_expiry_date_time: Option<String>,
    #[serde(default)]
    pub feature_updates_paused: Option<bool>,
    #[serde(default)]
    pub feature_updates_pause_expiry_date_time: Option<String>,

    // Uninstall: set by the Uninstall action, never by the editor.
    #[serde(default)]
    pub quality_updates_will_be_rolled_back: Option<bool>,
    #[serde(default)]
    pub feature_updates_will_be_rolled_back: Option<bool>,

    // Deadlines and restart
    #[serde(default)]
    pub deadline_for_quality_updates_in_days: Option<i32>,
    #[serde(default)]
    pub deadline_for_feature_updates_in_days: Option<i32>,
    #[serde(default)]
    pub deadline_grace_period_in_days: Option<i32>,
    #[serde(default)]
    pub postpone_reboot_until_after_deadline: Option<bool>,
    #[serde(default)]
    pub skip_checks_before_restart: Option<bool>,
    #[serde(default)]
    pub auto_restart_notification_dismissal: Option<String>,

    // User experience
    #[serde(default)]
    pub user_pause_access: Option<String>,
    #[serde(default)]
    pub user_windows_update_scan_access: Option<String>,
    #[serde(default)]
    pub update_notification_level: Option<String>,
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

fn map_ring(raw: &Value) -> Option<WindowsUpdateRing> {
    let id = string_field(raw, "id")?;
    let schedule = raw.get("installationSchedule");
    let scheduled_install_day = schedule.and_then(|value| string_field(value, "scheduledInstallDay"));
    let scheduled_install_time = schedule.and_then(|value| string_field(value, "scheduledInstallTime"));
    let active_hours_start = schedule.and_then(|value| string_field(value, "activeHoursStart"));
    let active_hours_end = schedule.and_then(|value| string_field(value, "activeHoursEnd"));
    Some(WindowsUpdateRing {
        display_name: string_field(raw, "displayName").unwrap_or_else(|| id.clone()),
        description: string_field(raw, "description"),
        created_date_time: string_field(raw, "createdDateTime"),
        last_modified_date_time: string_field(raw, "lastModifiedDateTime"),
        is_assigned: bool_field(raw, "isAssigned").unwrap_or(false),
        microsoft_update_service_allowed: bool_field(raw, "microsoftUpdateServiceAllowed"),
        drivers_excluded: bool_field(raw, "driversExcluded"),
        allow_windows11_upgrade: bool_field(raw, "allowWindows11Upgrade"),
        delivery_optimization_mode: string_field(raw, "deliveryOptimizationMode"),
        automatic_update_mode: string_field(raw, "automaticUpdateMode"),
        business_ready_updates_only: string_field(raw, "businessReadyUpdatesOnly"),
        scheduled_install_day,
        scheduled_install_time,
        update_weeks: string_field(raw, "updateWeeks"),
        active_hours_start,
        active_hours_end,
        quality_updates_deferral_period_in_days: int_field(
            raw,
            "qualityUpdatesDeferralPeriodInDays",
        ),
        feature_updates_deferral_period_in_days: int_field(
            raw,
            "featureUpdatesDeferralPeriodInDays",
        ),
        feature_updates_rollback_window_in_days: int_field(
            raw,
            "featureUpdatesRollbackWindowInDays",
        ),
        quality_updates_paused: bool_field(raw, "qualityUpdatesPaused"),
        quality_updates_pause_expiry_date_time: string_field(
            raw,
            "qualityUpdatesPauseExpiryDateTime",
        ),
        feature_updates_paused: bool_field(raw, "featureUpdatesPaused"),
        feature_updates_pause_expiry_date_time: string_field(
            raw,
            "featureUpdatesPauseExpiryDateTime",
        ),
        quality_updates_will_be_rolled_back: bool_field(raw, "qualityUpdatesWillBeRolledBack"),
        feature_updates_will_be_rolled_back: bool_field(raw, "featureUpdatesWillBeRolledBack"),
        deadline_for_quality_updates_in_days: int_field(raw, "deadlineForQualityUpdatesInDays"),
        deadline_for_feature_updates_in_days: int_field(raw, "deadlineForFeatureUpdatesInDays"),
        deadline_grace_period_in_days: int_field(raw, "deadlineGracePeriodInDays"),
        postpone_reboot_until_after_deadline: bool_field(
            raw,
            "postponeRebootUntilAfterDeadline",
        ),
        skip_checks_before_restart: bool_field(raw, "skipChecksBeforeRestart"),
        auto_restart_notification_dismissal: string_field(
            raw,
            "autoRestartNotificationDismissal",
        ),
        user_pause_access: string_field(raw, "userPauseAccess"),
        user_windows_update_scan_access: string_field(raw, "userWindowsUpdateScanAccess"),
        update_notification_level: string_field(raw, "updateNotificationLevel"),
        id,
    })
}

/// Read one ring.
pub async fn fetch_windows_update_ring(
    access_token: &str,
    id: &str,
) -> Result<WindowsUpdateRing, GraphError> {
    let id = id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "A ring id is required.".into(),
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
    map_ring(&raw).ok_or_else(|| GraphError::Request {
        status: 404,
        code: None,
        message: "That ring could not be read.".into(),
        permission_related: false,
    })
}

fn optional(value: &Option<String>) -> Value {
    match value.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
        Some(text) => json!(text),
        None => Value::Null,
    }
}

/// Build the `installationSchedule` value for the chosen automatic update mode.
///
/// Graph models this as a polymorphic type: `windowsUpdateScheduledInstall`
/// carries day/time, `windowsUpdateActiveHoursInstall` carries the window. The
/// mode decides which one applies, so the other variant's fields are dropped.
fn installation_schedule(ring: &WindowsUpdateRing) -> Value {
    match ring.automatic_update_mode.as_deref() {
        Some("autoInstallAndRebootAtScheduledTime") => json!({
            "@odata.type": "#microsoft.graph.windowsUpdateScheduledInstall",
            "scheduledInstallDay": ring.scheduled_install_day,
            "scheduledInstallTime": ring.scheduled_install_time,
        }),
        Some("autoInstallAtMaintenanceTime")
        | Some("autoInstallAndRebootAtMaintenanceTime") => json!({
            "@odata.type": "#microsoft.graph.windowsUpdateActiveHoursInstall",
            "activeHoursStart": ring.active_hours_start,
            "activeHoursEnd": ring.active_hours_end,
        }),
        // Every other mode ignores the schedule entirely.
        _ => Value::Null,
    }
}

/// Build the PATCH body. Only the surfaced fields are sent, so a partial edit
/// cannot clobber anything the editor does not know about.
pub fn ring_update_body(ring: &WindowsUpdateRing) -> Value {
    json!({
        "@odata.type": ODATA_TYPE,
        "displayName": ring.display_name.trim(),
        "description": optional(&ring.description),
        "microsoftUpdateServiceAllowed": ring.microsoft_update_service_allowed,
        "driversExcluded": ring.drivers_excluded,
        "allowWindows11Upgrade": ring.allow_windows11_upgrade,
        "deliveryOptimizationMode": ring.delivery_optimization_mode,
        "automaticUpdateMode": ring.automatic_update_mode,
        "businessReadyUpdatesOnly": ring.business_ready_updates_only,
        "installationSchedule": installation_schedule(ring),
        "updateWeeks": if ring.automatic_update_mode.as_deref()
            == Some("autoInstallAndRebootAtScheduledTime")
        {
            ring.update_weeks.clone()
        } else {
            None
        },
        "qualityUpdatesDeferralPeriodInDays": ring.quality_updates_deferral_period_in_days,
        "featureUpdatesDeferralPeriodInDays": ring.feature_updates_deferral_period_in_days,
        "featureUpdatesRollbackWindowInDays": ring.feature_updates_rollback_window_in_days,
        "deadlineForQualityUpdatesInDays": ring.deadline_for_quality_updates_in_days,
        "deadlineForFeatureUpdatesInDays": ring.deadline_for_feature_updates_in_days,
        "deadlineGracePeriodInDays": ring.deadline_grace_period_in_days,
        "postponeRebootUntilAfterDeadline": ring.postpone_reboot_until_after_deadline,
        "skipChecksBeforeRestart": ring.skip_checks_before_restart,
        "autoRestartNotificationDismissal": ring.auto_restart_notification_dismissal,
        "userPauseAccess": ring.user_pause_access,
        "userWindowsUpdateScanAccess": ring.user_windows_update_scan_access,
        "updateNotificationLevel": ring.update_notification_level,
    })
}

pub async fn update_windows_update_ring(
    access_token: &str,
    ring: &WindowsUpdateRing,
) -> Result<(), GraphError> {
    let id = ring.id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "A ring id is required.".into(),
            permission_related: false,
        });
    }
    if ring.display_name.trim().is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "A ring name is required.".into(),
            permission_related: false,
        });
    }
    GraphClient::new()
        .patch_no_content(
            access_token,
            &format!("{COLLECTION}/{}", urlencoding::encode(id)),
            "beta",
            &ring_update_body(ring),
        )
        .await
}

/// Create a ring. Everything the editor surfaces is optional on create, so a
/// new ring starts from Graph's own defaults plus whatever was supplied.
pub async fn create_windows_update_ring(
    access_token: &str,
    ring: &WindowsUpdateRing,
) -> Result<WindowsUpdateRing, GraphError> {
    if ring.display_name.trim().is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "A ring name is required.".into(),
            permission_related: false,
        });
    }
    let mut body = ring_update_body(ring);
    body["roleScopeTagIds"] = json!(["0"]);
    let created: Value = GraphClient::new()
        .post(access_token, COLLECTION, "beta", &body)
        .await?;
    map_ring(&created).ok_or_else(|| GraphError::Request {
        status: 200,
        code: None,
        message: "Ring was created but Graph returned an incomplete response.".into(),
        permission_related: false,
    })
}

/* ── Pause, resume, extend, uninstall ─────────────────────────────── */

/// Quality or feature updates on a ring. The portal acts on one at a time.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RingChannel {
    Quality,
    Feature,
}

impl RingChannel {
    fn prefix(self) -> &'static str {
        match self {
            RingChannel::Quality => "quality",
            RingChannel::Feature => "feature",
        }
    }

    fn action_name(self) -> &'static str {
        match self {
            RingChannel::Quality => "Quality",
            RingChannel::Feature => "Feature",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RingAction {
    /// Stop offering updates for 35 days.
    Pause,
    /// End a pause early.
    Resume,
    /// Restart a running pause's 35 days.
    Extend,
    /// Roll back the latest update on each device's next check-in.
    Uninstall,
}

/// Pause and uninstall state of one channel, for list columns.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RingChannelState {
    pub paused: bool,
    pub pause_expiry: Option<String>,
    pub rolling_back: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RingUpdateState {
    pub quality: RingChannelState,
    pub feature: RingChannelState,
}

impl RingUpdateState {
    /// Read from a ring as Graph returns it.
    pub fn from_raw(raw: &Value) -> Self {
        let channel = |prefix: &str| RingChannelState {
            paused: bool_field(raw, &format!("{prefix}UpdatesPaused")).unwrap_or(false),
            pause_expiry: string_field(raw, &format!("{prefix}UpdatesPauseExpiryDateTime")),
            rolling_back: bool_field(raw, &format!("{prefix}UpdatesWillBeRolledBack")).unwrap_or(false),
        };
        Self {
            quality: channel("quality"),
            feature: channel("feature"),
        }
    }

    fn channel(&self, channel: RingChannel) -> &RingChannelState {
        match channel {
            RingChannel::Quality => &self.quality,
            RingChannel::Feature => &self.feature,
        }
    }
}

/// Why `action` does nothing on a ring in `state`, if it does nothing.
pub fn ring_action_skip_reason(state: &RingUpdateState, channel: RingChannel, action: RingAction) -> Option<&'static str> {
    let current = state.channel(channel);
    match action {
        RingAction::Pause if current.paused => Some("Already paused."),
        RingAction::Resume if !current.paused => Some("Not paused."),
        RingAction::Extend if !current.paused => Some("Not paused, so there is no pause to extend."),
        RingAction::Uninstall if current.rolling_back => Some("Already uninstalling."),
        _ => None,
    }
}

/// Apply one action to one ring. Pause, resume, and uninstall are property
/// writes on the ring; extend is a Graph action.
pub async fn apply_ring_action(
    access_token: &str,
    ring_id: &str,
    channel: RingChannel,
    action: RingAction,
) -> Result<(), GraphError> {
    let path = format!("{COLLECTION}/{}", urlencoding::encode(ring_id.trim()));
    let client = GraphClient::new();
    let prefix = channel.prefix();
    let property = |name: &str, value: bool| {
        let mut body = serde_json::Map::new();
        body.insert("@odata.type".into(), json!(ODATA_TYPE));
        body.insert(format!("{prefix}{name}"), json!(value));
        Value::Object(body)
    };
    match action {
        RingAction::Pause => {
            client
                .patch_no_content(access_token, &path, "beta", &property("UpdatesPaused", true))
                .await
        }
        RingAction::Resume => {
            client
                .patch_no_content(access_token, &path, "beta", &property("UpdatesPaused", false))
                .await
        }
        RingAction::Uninstall => {
            client
                .patch_no_content(access_token, &path, "beta", &property("UpdatesWillBeRolledBack", true))
                .await
        }
        RingAction::Extend => {
            client
                .post_empty(
                    access_token,
                    &format!("{path}/extend{}UpdatesPause", channel.action_name()),
                    "beta",
                )
                .await
        }
    }
}

/// Read the ring, then apply `action` unless it would do nothing there.
/// Returns the reason when the ring is skipped.
pub async fn apply_ring_action_checked(
    access_token: &str,
    ring_id: &str,
    channel: RingChannel,
    action: RingAction,
) -> Result<Option<String>, GraphError> {
    let path = format!("{COLLECTION}/{}", urlencoding::encode(ring_id.trim()));
    let raw: Value = GraphClient::new().fetch_plain(access_token, &path, "beta").await?;
    let state = RingUpdateState::from_raw(&raw);
    if let Some(reason) = ring_action_skip_reason(&state, channel, action) {
        return Ok(Some(reason.to_string()));
    }
    apply_ring_action(access_token, ring_id, channel, action).await?;
    Ok(None)
}
