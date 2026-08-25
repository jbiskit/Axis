use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::session_store::{self, PersistedSession, SessionMode};

const GRAPH_COMMAND_LINE_TOOLS_CLIENT_ID: &str = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
const REFRESH_SKEW_SECONDS: u64 = 300;

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn resolve_public_client_id(override_id: Option<&str>) -> String {
    override_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(GRAPH_COMMAND_LINE_TOOLS_CLIENT_ID)
        .to_string()
}

/// Public device-code client. `AXIS_DEVICE_CODE_CLIENT_ID` or Graph CLI.
pub fn device_code_client_id() -> String {
    resolve_public_client_id(env_nonempty("AXIS_DEVICE_CODE_CLIENT_ID").as_deref())
}

pub fn is_graph_command_line_tools_client(client_id: &str) -> bool {
    client_id.eq_ignore_ascii_case(GRAPH_COMMAND_LINE_TOOLS_CLIENT_ID)
}

pub fn device_code_tenant() -> String {
    std::env::var("AXIS_AZURE_TENANT_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "organizations".to_string())
}

fn authority_base() -> String {
    format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0",
        device_code_tenant()
    )
}

pub fn effective_session_mode(_requested: SessionMode) -> SessionMode {
    SessionMode::Admin
}

pub fn is_write_or_privileged_scope(scope: &str) -> bool {
    scope.contains("ReadWrite") || scope.contains("PrivilegedOperations")
}

/// True when the access-token `scp` claim includes a Graph write or privileged scope.
pub fn token_scp_has_write_scopes(scp: Option<&str>) -> bool {
    scp.unwrap_or("")
        .split_whitespace()
        .any(is_write_or_privileged_scope)
}

pub fn device_code_scopes() -> Vec<String> {
    scopes_for_mode(SessionMode::Admin)
}

/// Split a Connect-MgGraph-style `-Scopes` string (comma, space, or newline).
pub fn parse_extra_scopes(raw: &str) -> Vec<String> {
    let mut scopes = raw
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .map(normalize_scope)
        .filter(|scope| !scope.is_empty())
        .filter(|scope| scope != ".default" && !scope.ends_with("/.default"))
        .collect::<Vec<_>>();
    scopes.sort();
    scopes.dedup();
    scopes
}

const GRAPH_RESOURCE: &str = "https://graph.microsoft.com/";

fn is_oidc_scope(scope: &str) -> bool {
    matches!(scope, "openid" | "profile" | "email" | "offline_access")
}

fn normalize_scope(scope: &str) -> String {
    let trimmed = scope.trim();
    trimmed
        .strip_prefix(GRAPH_RESOURCE)
        .unwrap_or(trimmed)
        .trim()
        .to_string()
}

/// v2 `scope` parameter: OIDC names stay bare; Graph delegated permissions use
/// `https://graph.microsoft.com/{name}`. Omitting the resource URI also defaults
/// to Graph — the forms are equivalent — but the resource-qualified form is the
/// documented construction. Never emit `.default`.
fn scope_parameter(scopes: &[String]) -> String {
    scopes
        .iter()
        .filter(|scope| *scope != ".default" && !scope.ends_with("/.default"))
        .map(|scope| {
            if is_oidc_scope(scope) || scope.contains("://") {
                scope.clone()
            } else {
                format!("{GRAPH_RESOURCE}{scope}")
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn scopes_for_mode_with_extras(mode: SessionMode, extras: &[String]) -> Vec<String> {
    let mut scopes = scopes_for_mode(mode);
    scopes.extend(extras.iter().cloned());
    scopes.sort();
    scopes.dedup();
    scopes
}

/// Delegated scopes for device-code and refresh. Mapped from the Microsoft
/// Graph permissions-reference Intune (`DeviceManagement*`) rows this app
/// calls, plus the directory / Conditional Access / recovery reads those
/// screens need. Always requests the write-capable set; Graph returns whatever
/// Entra has already granted for this public client.
///
/// v2 requires an explicit `offline_access` to receive refresh tokens. Never
/// request `.default`.
pub fn scopes_for_mode(_mode: SessionMode) -> Vec<String> {
    let mut scopes = vec![
        "openid".to_string(),
        "profile".to_string(),
        "offline_access".to_string(),
        "User.Read".to_string(),
        "Organization.Read.All".to_string(),
        "Device.Read.All".to_string(),
        "User.Read.All".to_string(),
        "GroupMember.Read.All".to_string(),
        "Group.Read.All".to_string(),
        "Policy.Read.All".to_string(),
        "AuditLog.Read.All".to_string(),
        "BitlockerKey.Read.All".to_string(),
        "DeviceLocalCredential.Read.All".to_string(),
        "DeviceManagementConfiguration.Read.All".to_string(),
        "DeviceManagementApps.Read.All".to_string(),
        "DeviceManagementServiceConfig.Read.All".to_string(),
        "DeviceManagementScripts.Read.All".to_string(),
        "DeviceManagementManagedDevices.Read.All".to_string(),
        "DeviceManagementConfiguration.ReadWrite.All".to_string(),
        "DeviceManagementApps.ReadWrite.All".to_string(),
        "DeviceManagementServiceConfig.ReadWrite.All".to_string(),
        "DeviceManagementScripts.ReadWrite.All".to_string(),
        "DeviceManagementManagedDevices.ReadWrite.All".to_string(),
        "DeviceManagementManagedDevices.PrivilegedOperations.All".to_string(),
        "Group.ReadWrite.All".to_string(),
    ];
    scopes.sort();
    scopes.dedup();
    scopes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodePrompt {
    pub flow_id: String,
    pub user_code: String,
    pub verification_uri: String,
    pub message: String,
    pub interval_seconds: u64,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeTokens {
    pub access_token: String,
    pub expires_on: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PollResult {
    Pending,
    Failed {
        error: String,
    },
    #[serde(rename_all = "camelCase")]
    SignedIn {
        access_token: String,
        expires_on: i64,
        account_name: Option<String>,
        tenant_id: Option<String>,
        mode: SessionMode,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenClaims {
    pub name: Option<String>,
    pub upn: Option<String>,
    pub tid: Option<String>,
    pub scp: Option<String>,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
}

#[derive(Clone)]
struct PendingFlow {
    device_code: String,
    expires_at: i64,
    client_id: String,
    extra_scopes: Vec<String>,
}

#[derive(Clone)]
struct DeviceSession {
    refresh_token: String,
    access_token: Option<String>,
    access_token_expires_on: Option<i64>,
    account_name: Option<String>,
    tenant_id: Option<String>,
    mode: SessionMode,
    client_id: String,
    extra_scopes: Vec<String>,
}

pub struct AuthManager {
    pending: Mutex<HashMap<String, PendingFlow>>,
    session: Mutex<Option<DeviceSession>>,
    client: reqwest::Client,
}

impl Default for AuthManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthManager {
    pub fn new() -> Self {
        session_store::purge_legacy();
        Self {
            pending: Mutex::new(HashMap::new()),
            session: Mutex::new(load_persisted_session()),
            client: reqwest::Client::new(),
        }
    }

    pub fn preferred_mode(&self) -> SessionMode {
        effective_session_mode(session_store::load_preferred_mode())
    }

    pub async fn session_mode(&self) -> SessionMode {
        let current = self.session.lock().await;
        effective_session_mode(
            current
                .as_ref()
                .map(|session| session.mode)
                .unwrap_or_else(|| session_store::load_preferred_mode()),
        )
    }

    pub async fn start_device_code_flow(
        &self,
        _requested: Option<SessionMode>,
        extra_scopes: Option<&str>,
    ) -> Result<DeviceCodePrompt, AuthError> {
        let mode = SessionMode::Admin;
        let extra_scopes = parse_extra_scopes(extra_scopes.unwrap_or(""));
        let client_id = device_code_client_id();
        let response = self
            .client
            .post(format!("{}/devicecode", authority_base()))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "client_id={}&scope={}",
                urlencoding_helper(&client_id),
                urlencoding_helper(&scope_parameter(&scopes_for_mode_with_extras(
                    mode,
                    &extra_scopes,
                )))
            ))
            .send()
            .await?;

        let status = response.status();
        let json: serde_json::Value = response.json().await?;
        if !status.is_success() {
            return Err(AuthError::Message(describe_error(&json, "unknown error")));
        }

        let device_code = json["device_code"]
            .as_str()
            .ok_or_else(|| AuthError::Message("Missing device_code".into()))?
            .to_string();
        let user_code = json["user_code"]
            .as_str()
            .ok_or_else(|| AuthError::Message("Missing user_code".into()))?
            .to_string();
        let verification_uri = json["verification_uri"]
            .as_str()
            .ok_or_else(|| AuthError::Message("Missing verification_uri".into()))?
            .to_string();
        let message = json["message"].as_str().unwrap_or("").to_string();
        let interval_seconds = json["interval"].as_u64().unwrap_or(5);
        let expires_in_seconds = json["expires_in"].as_u64().unwrap_or(900);

        let flow_id = Uuid::new_v4().to_string();
        let expires_at = now_ms() + (expires_in_seconds * 1000) as i64;
        self.pending.lock().await.insert(
            flow_id.clone(),
            PendingFlow {
                device_code,
                expires_at,
                client_id,
                extra_scopes,
            },
        );

        Ok(DeviceCodePrompt {
            flow_id,
            user_code,
            verification_uri,
            message,
            interval_seconds,
            expires_in_seconds,
        })
    }

    pub async fn poll_device_code_flow(&self, flow_id: &str) -> Result<PollResult, AuthError> {
        let flow = {
            let pending = self.pending.lock().await;
            pending.get(flow_id).cloned()
        };

        let Some(flow) = flow else {
            return Ok(PollResult::Failed {
                error: "Sign-in request expired. Try again.".into(),
            });
        };

        if now_ms() > flow.expires_at {
            self.pending.lock().await.remove(flow_id);
            return Ok(PollResult::Failed {
                error: "The sign-in code expired. Try again.".into(),
            });
        }

        let response = self
            .client
            .post(format!("{}/token", authority_base()))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&client_id={}&device_code={}",
                urlencoding_helper(&flow.client_id),
                urlencoding_helper(&flow.device_code)
            ))
            .send()
            .await?;

        let status = response.status();
        let json: serde_json::Value = response.json().await?;

        if !status.is_success() {
            let error = json["error"].as_str().unwrap_or("");
            if error == "authorization_pending" || error == "slow_down" {
                return Ok(PollResult::Pending);
            }
            self.pending.lock().await.remove(flow_id);
            return Ok(PollResult::Failed {
                error: describe_error(&json, "Device sign-in failed."),
            });
        }

        self.pending.lock().await.remove(flow_id);
        let access_token = json["access_token"]
            .as_str()
            .ok_or_else(|| AuthError::Message("Missing access_token".into()))?
            .to_string();
        let refresh_token = json["refresh_token"].as_str().unwrap_or("").to_string();
        let expires_in = json["expires_in"].as_u64().unwrap_or(3600);
        let expires_on = now_ms() + (expires_in * 1000) as i64;

        let claims = decode_access_token_claims(&access_token);
        let account_name = claims.name.clone().or(claims.upn.clone());
        let tenant_id = claims.tid.clone();

        self.commit_session(DeviceSession {
            refresh_token,
            access_token: Some(access_token.clone()),
            access_token_expires_on: Some(expires_on),
            account_name: account_name.clone(),
            tenant_id: tenant_id.clone(),
            mode: SessionMode::Admin,
            client_id: flow.client_id,
            extra_scopes: flow.extra_scopes,
        })
        .await;

        Ok(PollResult::SignedIn {
            access_token,
            expires_on,
            account_name,
            tenant_id,
            mode: SessionMode::Admin,
        })
    }

    pub async fn cancel_device_code_flow(&self, flow_id: &str) {
        self.pending.lock().await.remove(flow_id);
    }

    pub async fn get_session_token(&self) -> Result<Option<DeviceCodeTokens>, AuthError> {
        let current = self.session.lock().await.clone();
        let Some(current) = current else {
            return Ok(None);
        };

        if let Some(tokens) = cached_fresh_access_token(&current) {
            return Ok(Some(tokens));
        }

        let mode = effective_session_mode(current.mode);

        if current.refresh_token.is_empty() {
            self.clear_session().await;
            return Ok(None);
        }

        let response = self
            .client
            .post(format!("{}/token", authority_base()))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "grant_type=refresh_token&client_id={}&refresh_token={}&scope={}",
                urlencoding_helper(&current.client_id),
                urlencoding_helper(&current.refresh_token),
                urlencoding_helper(&scope_parameter(&scopes_for_mode_with_extras(
                    mode,
                    &current.extra_scopes,
                )))
            ))
            .send()
            .await?;

        let status = response.status();
        let json: serde_json::Value = response.json().await?;
        if !status.is_success() {
            let error = json["error"].as_str().unwrap_or("");
            let description = describe_error(&json, "refresh failed");
            if is_fatal_refresh_error(error) {
                eprintln!(
                    "axis auth: refresh token rejected ({error}); clearing stored session"
                );
                self.clear_session().await;
            } else {
                eprintln!(
                    "axis auth: refresh failed but keeping stored session: {description}"
                );
            }
            return Err(AuthError::Message(format!(
                "Session expired: {description}. Sign in again."
            )));
        }

        let access_token = json["access_token"]
            .as_str()
            .ok_or_else(|| AuthError::Message("Missing access_token".into()))?
            .to_string();
        let refresh_token = json["refresh_token"]
            .as_str()
            .unwrap_or(&current.refresh_token)
            .to_string();
        let expires_in = json["expires_in"].as_u64().unwrap_or(3600);
        let expires_on = now_ms() + (expires_in * 1000) as i64;

        let claims = decode_access_token_claims(&access_token);
        let account_name = claims
            .name
            .clone()
            .or(claims.upn.clone())
            .or(current.account_name.clone());
        let tenant_id = claims.tid.or(current.tenant_id.clone());

        self.commit_session(DeviceSession {
            refresh_token,
            access_token: Some(access_token.clone()),
            access_token_expires_on: Some(expires_on),
            account_name,
            tenant_id,
            mode,
            client_id: current.client_id,
            extra_scopes: current.extra_scopes,
        })
        .await;

        Ok(Some(DeviceCodeTokens {
            access_token,
            expires_on,
        }))
    }

    pub async fn restore_session(&self) -> (bool, Option<String>) {
        {
            let session = self.session.lock().await;
            if let Some(current) = session.as_ref() {
                if cached_fresh_access_token(current).is_some() {
                    return (true, current.account_name.clone());
                }
            }
        }

        match self.get_session_token().await {
            Ok(Some(tokens)) => {
                let claims = decode_access_token_claims(&tokens.access_token);
                let account_name = {
                    let session = self.session.lock().await;
                    session.as_ref().and_then(|s| s.account_name.clone())
                };
                (true, account_name.or(claims.name).or(claims.upn))
            }
            Ok(None) => (false, None),
            Err(_) => {
                let session = self.session.lock().await;
                match session.as_ref() {
                    Some(current) => (true, current.account_name.clone()),
                    None => (false, None),
                }
            }
        }
    }

    pub async fn end_session(&self) {
        self.clear_session().await;
    }

    pub async fn is_signed_in(&self) -> bool {
        self.session.lock().await.is_some()
    }

    async fn commit_session(&self, session: DeviceSession) {
        persist_session(&session);
        *self.session.lock().await = Some(session);
    }

    async fn clear_session(&self) {
        session_store::delete();
        *self.session.lock().await = None;
    }
}

fn load_persisted_session() -> Option<DeviceSession> {
    let stored = session_store::load()?;
    let tenant = device_code_tenant();
    if !stored.is_restorable(&tenant) {
        eprintln!(
            "axis auth: stored session not restorable (stored client_id={}, tenant={}; current tenant={})",
            stored.client_id, stored.tenant, tenant
        );
        session_store::delete();
        return None;
    }
    eprintln!(
        "axis auth: restored device session from credential store for tenant {} (client_id={})",
        stored.tenant, stored.client_id
    );
    Some(DeviceSession {
        refresh_token: stored.refresh_token,
        access_token: None,
        access_token_expires_on: stored.access_expires_on,
        account_name: stored.account_name,
        tenant_id: stored.tenant_id,
        mode: SessionMode::Admin,
        client_id: stored.client_id,
        extra_scopes: stored.extra_scopes,
    })
}

fn persist_session(session: &DeviceSession) {
    session_store::save_preferred_mode(session.mode);
    session_store::save(&PersistedSession::new(
        session.refresh_token.clone(),
        session.client_id.clone(),
        device_code_tenant(),
        session.account_name.clone(),
        session.tenant_id.clone(),
        session.access_token_expires_on,
        session.mode,
        session.extra_scopes.clone(),
    ));
}

pub fn decode_access_token_claims(access_token: &str) -> TokenClaims {
    let payload = access_token.split('.').nth(1).unwrap_or("");
    if payload.is_empty() {
        return TokenClaims::default();
    }
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(payload) else {
        return TokenClaims::default();
    };
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return TokenClaims::default();
    };
    TokenClaims {
        name: json["name"].as_str().map(str::to_string),
        upn: json["upn"].as_str().map(str::to_string),
        tid: json["tid"].as_str().map(str::to_string),
        scp: json["scp"].as_str().map(str::to_string),
    }
}

fn is_fatal_refresh_error(error: &str) -> bool {
    matches!(
        error,
        "invalid_grant" | "invalid_client" | "unauthorized_client" | "interaction_required"
    )
}

fn describe_error(json: &serde_json::Value, fallback: &str) -> String {
    json["error_description"]
        .as_str()
        .or_else(|| json["error"].as_str())
        .unwrap_or(fallback)
        .to_string()
}

fn cached_fresh_access_token(session: &DeviceSession) -> Option<DeviceCodeTokens> {
    let access_token = session.access_token.as_ref()?;
    let expires_on = session.access_token_expires_on?;
    let still_fresh = expires_on - now_ms() > (REFRESH_SKEW_SECONDS * 1000) as i64;
    if still_fresh {
        Some(DeviceCodeTokens {
            access_token: access_token.clone(),
            expires_on,
        })
    } else {
        None
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as i64
}

fn urlencoding_helper(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => ch.to_string(),
            ' ' => "+".to_string(),
            _ => format!("%{:02X}", ch as u8),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_scopes() -> [&'static str; 7] {
        [
            "DeviceManagementManagedDevices.ReadWrite.All",
            "DeviceManagementManagedDevices.PrivilegedOperations.All",
            "DeviceManagementConfiguration.ReadWrite.All",
            "DeviceManagementApps.ReadWrite.All",
            "DeviceManagementScripts.ReadWrite.All",
            "DeviceManagementServiceConfig.ReadWrite.All",
            "Group.ReadWrite.All",
        ]
    }

    #[test]
    fn device_code_scopes_include_write_scopes() {
        let scopes = device_code_scopes();
        assert_eq!(scopes, scopes_for_mode(SessionMode::Admin));
        for write in write_scopes() {
            assert!(
                scopes.iter().any(|scope| scope == write),
                "device-code missing {write}"
            );
        }
        assert!(!scopes
            .iter()
            .any(|scope| *scope == ".default" || scope.ends_with("/.default")));
    }

    #[test]
    fn admin_mode_includes_write_scopes() {
        let scopes = scopes_for_mode(SessionMode::Admin);
        for write in write_scopes() {
            assert!(
                scopes.iter().any(|scope| scope == write),
                "admin mode missing {write}"
            );
        }
    }

    #[test]
    fn extra_scopes_parse_like_connect_mggraph() {
        let extras = parse_extra_scopes(
            "DeviceManagementConfiguration.Read.All, https://graph.microsoft.com/Policy.ReadWrite.ConditionalAccess\n.default",
        );
        assert_eq!(
            extras,
            vec![
                "DeviceManagementConfiguration.Read.All".to_string(),
                "Policy.ReadWrite.ConditionalAccess".to_string(),
            ]
        );
    }

    #[test]
    fn scope_parameter_uses_graph_resource_uri_not_default() {
        let scopes = scopes_for_mode(SessionMode::Admin);
        let parameter = scope_parameter(&scopes);
        assert!(parameter.contains("openid"));
        assert!(parameter.contains("offline_access"));
        assert!(parameter
            .contains("https://graph.microsoft.com/DeviceManagementConfiguration.Read.All"));
        assert!(!parameter.contains(".default"));
        assert!(!parameter
            .split_whitespace()
            .any(|part| part == "DeviceManagementConfiguration.Read.All"));
    }

    #[test]
    fn extras_append_to_preset_and_dedup() {
        let extras = parse_extra_scopes("User.Read, Policy.ReadWrite.ConditionalAccess");
        let scopes = scopes_for_mode_with_extras(SessionMode::Admin, &extras);
        assert!(scopes
            .iter()
            .any(|scope| scope == "Policy.ReadWrite.ConditionalAccess"));
        assert_eq!(
            scopes.iter().filter(|scope| *scope == "User.Read").count(),
            1
        );
        assert!(!scopes.iter().any(|scope| scope == ".default"));
    }

    #[test]
    fn scp_write_detection() {
        assert!(!token_scp_has_write_scopes(None));
        assert!(!token_scp_has_write_scopes(Some(
            "User.Read DeviceManagementConfiguration.Read.All BitlockerKey.Read.All"
        )));
        assert!(token_scp_has_write_scopes(Some(
            "User.Read DeviceManagementConfiguration.ReadWrite.All"
        )));
        assert!(token_scp_has_write_scopes(Some(
            "DeviceManagementManagedDevices.PrivilegedOperations.All"
        )));
    }

    #[test]
    fn resolve_public_client_id_defaults_to_graph_cli() {
        assert_eq!(
            resolve_public_client_id(None),
            GRAPH_COMMAND_LINE_TOOLS_CLIENT_ID
        );
        assert_eq!(
            resolve_public_client_id(Some("")),
            GRAPH_COMMAND_LINE_TOOLS_CLIENT_ID
        );
        assert_eq!(
            resolve_public_client_id(Some("  ")),
            GRAPH_COMMAND_LINE_TOOLS_CLIENT_ID
        );
        assert_eq!(
            resolve_public_client_id(Some("  aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee  ")),
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        );
        assert!(is_graph_command_line_tools_client(
            GRAPH_COMMAND_LINE_TOOLS_CLIENT_ID
        ));
        assert!(!is_graph_command_line_tools_client(
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        ));
    }
}
