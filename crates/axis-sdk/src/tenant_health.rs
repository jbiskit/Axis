//! Tenant health: the certificates, tokens, and connectors Intune depends on.
//!
//! The portal keeps these under Tenant administration → Connectors and tokens,
//! one blade each, so an expiring Apple certificate or a silent Autopilot sync
//! failure is easy to miss. This reads them all and grades each one.

use chrono::{DateTime, Duration, Utc};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::graph::{format_graph_error, GraphClient, GraphError};

/// Expiry inside this window is a warning.
const EXPIRY_WARNING_DAYS: i64 = 30;
/// A sync or heartbeat older than this is a warning.
const SYNC_WARNING_DAYS: i64 = 7;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HealthStatus {
    Ok,
    Warning,
    Error,
    /// The tenant does not use this connector.
    NotConfigured,
    /// It could not be read, usually for want of a permission.
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthItem {
    /// Stable key, e.g. `apple-mdm-push`.
    pub key: String,
    /// What it is, e.g. "Apple MDM push certificate".
    pub area: String,
    /// Which one, when there can be several (token or connector name).
    pub name: Option<String>,
    pub status: HealthStatus,
    pub detail: String,
    pub expires: Option<String>,
    pub last_sync: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantHealth {
    pub items: Vec<HealthItem>,
    pub fetched_at: String,
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty() && !text.starts_with("0001-01-01"))
        .map(str::to_string)
}

fn parse_time(value: Option<&str>) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value?).ok().map(|time| time.with_timezone(&Utc))
}

fn days_word(days: i64) -> String {
    if days == 1 { "1 day".into() } else { format!("{days} days") }
}

/// Grade an expiry date.
fn expiry_status(expires: Option<&str>) -> (HealthStatus, String) {
    let Some(expires) = parse_time(expires) else {
        return (HealthStatus::Unknown, "Expiry date not reported.".into());
    };
    let left = (expires - Utc::now()).num_days();
    if expires <= Utc::now() {
        (HealthStatus::Error, format!("Expired {} ago.", days_word(-left)))
    } else if left <= EXPIRY_WARNING_DAYS {
        (HealthStatus::Warning, format!("Expires in {}.", days_word(left)))
    } else {
        (HealthStatus::Ok, format!("Expires in {}.", days_word(left)))
    }
}

/// Grade a last sync or heartbeat.
fn sync_status(last: Option<&str>, what: &str) -> (HealthStatus, String) {
    let Some(last) = parse_time(last) else {
        return (HealthStatus::Warning, format!("No {what} recorded."));
    };
    let age = Utc::now() - last;
    if age > Duration::days(SYNC_WARNING_DAYS) {
        (HealthStatus::Warning, format!("Last {what} {} ago.", days_word(age.num_days())))
    } else {
        (HealthStatus::Ok, format!("Last {what} {}.", relative(age)))
    }
}

fn relative(age: Duration) -> String {
    if age.num_hours() < 1 {
        "under an hour ago".into()
    } else if age.num_hours() < 48 {
        format!("{}h ago", age.num_hours())
    } else {
        format!("{} ago", days_word(age.num_days()))
    }
}

/// The worse of two grades.
fn worst(a: HealthStatus, b: HealthStatus) -> HealthStatus {
    let rank = |status: HealthStatus| match status {
        HealthStatus::Error => 4,
        HealthStatus::Warning => 3,
        HealthStatus::Unknown => 2,
        HealthStatus::Ok => 1,
        HealthStatus::NotConfigured => 0,
    };
    if rank(a) >= rank(b) { a } else { b }
}

fn item(key: &str, area: &str, name: Option<String>, status: HealthStatus, detail: String) -> HealthItem {
    HealthItem {
        key: key.into(),
        area: area.into(),
        name,
        status,
        detail,
        expires: None,
        last_sync: None,
    }
}

fn not_configured(key: &str, area: &str, detail: &str) -> Vec<HealthItem> {
    vec![item(key, area, None, HealthStatus::NotConfigured, detail.into())]
}

fn unreadable(key: &str, area: &str, error: &GraphError) -> Vec<HealthItem> {
    let (message, _) = format_graph_error(area, error);
    vec![item(key, area, None, HealthStatus::Unknown, message)]
}

async fn get(path: &str, token: &str) -> Result<Value, GraphError> {
    GraphClient::new().fetch_plain(token, path, "beta").await
}

fn rows(value: &Value) -> Vec<Value> {
    value.get("value").and_then(Value::as_array).cloned().unwrap_or_default()
}

async fn apple_push(token: &str) -> Vec<HealthItem> {
    const KEY: &str = "apple-mdm-push";
    const AREA: &str = "Apple MDM push certificate";
    match get("/deviceManagement/applePushNotificationCertificate", token).await {
        Ok(cert) => {
            let expires = text(&cert, "expirationDateTime");
            if expires.is_none() && text(&cert, "appleIdentifier").is_none() {
                return not_configured(KEY, AREA, "No certificate uploaded. Apple devices cannot enroll.");
            }
            let (status, detail) = expiry_status(expires.as_deref());
            vec![HealthItem {
                expires,
                ..item(KEY, AREA, text(&cert, "appleIdentifier"), status, detail)
            }]
        }
        Err(error) if error.status() == Some(404) => {
            not_configured(KEY, AREA, "No certificate uploaded. Apple devices cannot enroll.")
        }
        Err(error) => unreadable(KEY, AREA, &error),
    }
}

async fn apple_enrollment_tokens(token: &str) -> Vec<HealthItem> {
    const KEY: &str = "apple-enrollment-token";
    const AREA: &str = "Apple Business Manager token";
    let tokens = match get("/deviceManagement/depOnboardingSettings", token).await {
        Ok(value) => rows(&value),
        Err(error) => return unreadable(KEY, AREA, &error),
    };
    if tokens.is_empty() {
        return not_configured(KEY, AREA, "No enrollment program token.");
    }
    tokens
        .iter()
        .map(|row| {
            let expires = text(row, "tokenExpirationDateTime");
            let last_sync = text(row, "lastSuccessfulSyncDateTime");
            let (expiry, expiry_detail) = expiry_status(expires.as_deref());
            let (sync, sync_detail) = sync_status(last_sync.as_deref(), "sync");
            HealthItem {
                expires,
                last_sync,
                ..item(
                    KEY,
                    AREA,
                    text(row, "tokenName").or_else(|| text(row, "appleIdentifier")),
                    worst(expiry, sync),
                    format!("{expiry_detail} {sync_detail}"),
                )
            }
        })
        .collect()
}

async fn vpp_tokens(token: &str) -> Vec<HealthItem> {
    const KEY: &str = "apple-vpp-token";
    const AREA: &str = "Apple VPP token";
    let tokens = match get("/deviceAppManagement/vppTokens", token).await {
        Ok(value) => rows(&value),
        Err(error) => return unreadable(KEY, AREA, &error),
    };
    if tokens.is_empty() {
        return not_configured(KEY, AREA, "No Apps and Books token.");
    }
    tokens
        .iter()
        .map(|row| {
            let expires = text(row, "expirationDateTime");
            let last_sync = text(row, "lastSyncDateTime");
            let (mut status, mut detail) = expiry_status(expires.as_deref());
            match text(row, "state").as_deref() {
                Some("valid") | None => {}
                Some("assignedToExternalMDM") => {
                    status = HealthStatus::Error;
                    detail = "Assigned to another MDM. Apps will not sync.".into();
                }
                Some(other) => {
                    status = HealthStatus::Error;
                    detail = format!("Token state is {other}.");
                }
            }
            if text(row, "lastSyncStatus").as_deref() == Some("failed") {
                status = worst(status, HealthStatus::Warning);
                detail = format!("{detail} Last sync failed.");
            }
            HealthItem {
                expires,
                last_sync,
                ..item(
                    KEY,
                    AREA,
                    text(row, "displayName").or_else(|| text(row, "organizationName")),
                    status,
                    detail,
                )
            }
        })
        .collect()
}

async fn managed_google_play(token: &str) -> Vec<HealthItem> {
    const KEY: &str = "managed-google-play";
    const AREA: &str = "Managed Google Play";
    match get("/deviceManagement/androidManagedStoreAccountEnterpriseSettings", token).await {
        Ok(settings) => match text(&settings, "bindStatus").as_deref() {
            None | Some("notBound") => not_configured(KEY, AREA, "Not connected. Android Enterprise is unavailable."),
            Some("unbinding") => vec![item(KEY, AREA, None, HealthStatus::Warning, "Disconnecting.".into())],
            Some(_) => {
                let last_sync = text(&settings, "lastAppSyncDateTime");
                let (mut status, mut detail) = sync_status(last_sync.as_deref(), "app sync");
                if text(&settings, "lastAppSyncStatus").as_deref() == Some("failed") {
                    status = HealthStatus::Error;
                    detail = format!("Last app sync failed. {detail}");
                }
                vec![HealthItem {
                    last_sync,
                    ..item(KEY, AREA, text(&settings, "ownerUserPrincipalName"), status, detail)
                }]
            }
        },
        Err(error) => unreadable(KEY, AREA, &error),
    }
}

async fn autopilot_sync(token: &str) -> Vec<HealthItem> {
    const KEY: &str = "autopilot-sync";
    const AREA: &str = "Windows Autopilot sync";
    match get("/deviceManagement/windowsAutopilotSettings", token).await {
        Ok(settings) => {
            let last_sync = text(&settings, "lastSyncDateTime");
            let (mut status, mut detail) = sync_status(last_sync.as_deref(), "sync");
            if text(&settings, "syncStatus").as_deref() == Some("failed") {
                status = HealthStatus::Error;
                detail = format!("Last sync failed. {detail}");
            }
            vec![HealthItem {
                last_sync,
                ..item(KEY, AREA, None, status, detail)
            }]
        }
        Err(error) => unreadable(KEY, AREA, &error),
    }
}

/// Connectors listed as a collection with a state and a last connection time.
async fn connectors(token: &str, path: &str, key: &str, area: &str, none: &str) -> Vec<HealthItem> {
    let connectors = match get(path, token).await {
        Ok(value) => rows(&value),
        Err(error) => return unreadable(key, area, &error),
    };
    if connectors.is_empty() {
        return not_configured(key, area, none);
    }
    connectors
        .iter()
        .map(|row| {
            let last_sync = text(row, "lastConnectionDateTime");
            let (mut status, mut detail) = sync_status(last_sync.as_deref(), "connection");
            match text(row, "state").as_deref() {
                Some("active") | None => {}
                Some(other) => {
                    status = HealthStatus::Error;
                    detail = format!("State is {other}. {detail}");
                }
            }
            if let Some(version) = text(row, "version") {
                detail = format!("{detail} Version {version}.");
            }
            HealthItem {
                last_sync,
                ..item(key, area, text(row, "displayName"), status, detail)
            }
        })
        .collect()
}

async fn threat_defense(token: &str) -> Vec<HealthItem> {
    const KEY: &str = "mobile-threat-defense";
    const AREA: &str = "Mobile Threat Defense connector";
    let connectors = match get("/deviceManagement/mobileThreatDefenseConnectors", token).await {
        Ok(value) => rows(&value),
        Err(error) => return unreadable(KEY, AREA, &error),
    };
    if connectors.is_empty() {
        return not_configured(KEY, AREA, "No partner connected.");
    }
    connectors
        .iter()
        .map(|row| {
            let last_sync = text(row, "lastHeartbeatDateTime");
            let (mut status, mut detail) = sync_status(last_sync.as_deref(), "heartbeat");
            match text(row, "partnerState").as_deref() {
                Some("enabled") | Some("available") | None => {}
                Some("notSetUp") => {
                    status = HealthStatus::NotConfigured;
                    detail = "Not set up.".into();
                }
                Some(other) => {
                    status = HealthStatus::Error;
                    detail = format!("Partner state is {other}. {detail}");
                }
            }
            HealthItem {
                last_sync,
                // Graph does not name the partner; the id is its well-known GUID.
                ..item(KEY, AREA, text(row, "id"), status, detail)
            }
        })
        .collect()
}

/// Read every connector and token at once. Each failure stays on its own item.
pub async fn fetch_tenant_health(access_token: &str) -> TenantHealth {
    let token = access_token;
    let (push, enrollment, vpp, google, autopilot, ad, certificates, threat) = tokio::join!(
        apple_push(token),
        apple_enrollment_tokens(token),
        vpp_tokens(token),
        managed_google_play(token),
        autopilot_sync(token),
        connectors(
            token,
            "/deviceManagement/domainJoinConnectors",
            "ad-connector",
            "Intune Connector for Active Directory",
            "None installed. Needed only for hybrid-joined Autopilot.",
        ),
        connectors(
            token,
            "/deviceManagement/ndesConnectors",
            "certificate-connector",
            "Certificate connector",
            "None installed. Needed only for SCEP or PKCS certificates.",
        ),
        threat_defense(token),
    );
    TenantHealth {
        items: [push, enrollment, vpp, google, autopilot, ad, certificates, threat]
            .into_iter()
            .flatten()
            .collect(),
        fetched_at: Utc::now().to_rfc3339(),
    }
}
