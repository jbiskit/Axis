use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};
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

/// Microsoft Graph Command Line Tools, or `AXIS_DEVICE_CODE_CLIENT_ID`.
pub fn device_code_client_id() -> String {
    resolve_public_client_id(env_nonempty("AXIS_DEVICE_CODE_CLIENT_ID").as_deref())
}

pub fn is_graph_command_line_tools_client(client_id: &str) -> bool {
    client_id.eq_ignore_ascii_case(GRAPH_COMMAND_LINE_TOOLS_CLIENT_ID)
}

/// Application (client) id of a public client app registration. No secret.
pub fn parse_app_registration_client_id(raw: &str) -> Result<String, AuthError> {
    let trimmed = raw.trim();
    let Ok(parsed) = Uuid::parse_str(trimmed) else {
        return Err(AuthError::Message(
            "App registration client id must be the application (client) id from Entra.".into(),
        ));
    };
    Ok(parsed.hyphenated().to_string())
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

/**
 * Honour the requested mode. Read-only sessions must hold read-only tokens, so
 * the mode now decides which scope set is requested (see `scopes_for_mode`).
 */
pub fn effective_session_mode(requested: SessionMode) -> SessionMode {
    requested
}

pub fn is_write_or_privileged_scope(scope: &str) -> bool {
    scope.contains("ReadWrite")
        || scope.contains("PrivilegedOperations")
        || scope.ends_with(".Write")
        || scope.contains(".Write.")
        || scope.contains(".Manage.")
        || scope.ends_with(".Manage")
        || scope.eq_ignore_ascii_case("Directory.AccessAsUser.All")
}

/// True when the access-token `scp` claim includes a Graph write or privileged scope.
pub fn token_scp_has_write_scopes(scp: Option<&str>) -> bool {
    scp.unwrap_or("")
        .split_whitespace()
        .any(is_write_or_privileged_scope)
}

/// Extracts all write or privileged scopes present in the access-token `scp` claim.
pub fn token_write_scopes(scp: Option<&str>) -> Vec<String> {
    let mut write_scopes: Vec<String> = scp
        .unwrap_or("")
        .split_whitespace()
        .filter(|scope| is_write_or_privileged_scope(scope))
        .map(str::to_string)
        .collect();
    write_scopes.sort();
    write_scopes.dedup();
    write_scopes
}

pub fn device_code_scopes() -> Vec<String> {
    scopes_for_mode(SessionMode::Admin)
}

/** Scopes every session needs regardless of mode (identity, tenant, refresh). */
fn base_scopes() -> Vec<String> {
    vec![
        "openid".to_string(),
        "profile".to_string(),
        // v2 requires an explicit `offline_access` to receive refresh tokens.
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
        "DeviceManagementRBAC.Read.All".to_string(),
        "DeviceManagementServiceConfig.Read.All".to_string(),
        "DeviceManagementScripts.Read.All".to_string(),
        "DeviceManagementManagedDevices.Read.All".to_string(),
    ]
}

/** Scopes only a write session requests. Never requested in Read mode. */
fn write_scopes() -> Vec<String> {
    vec![
        "DeviceManagementConfiguration.ReadWrite.All".to_string(),
        "DeviceManagementApps.ReadWrite.All".to_string(),
        "DeviceManagementServiceConfig.ReadWrite.All".to_string(),
        "DeviceManagementScripts.ReadWrite.All".to_string(),
        "DeviceManagementManagedDevices.ReadWrite.All".to_string(),
        "DeviceManagementManagedDevices.PrivilegedOperations.All".to_string(),
        "DeviceManagementRBAC.ReadWrite.All".to_string(),
        "Group.ReadWrite.All".to_string(),
        "Policy.ReadWrite.DeviceConfiguration".to_string(),
    ]
}

/// Delegated scopes for browser sign-in and refresh. Mapped from the Microsoft
/// Graph permissions-reference Intune (`DeviceManagement*`) rows this app
/// calls, plus the directory / Conditional Access / recovery reads those
/// screens need.
///
/// Read mode requests the read-only set, so the issued token's `scp` claim
/// carries no write scope. Note that a public client receives whatever Entra has
/// already consented for the app, which can exceed the request — callers must
/// check the returned token with `token_scp_has_write_scopes` rather than
/// assuming the request was honoured. Never request `.default`.
pub fn scopes_for_mode(mode: SessionMode) -> Vec<String> {
    let mut scopes = base_scopes();
    if mode == SessionMode::Admin {
        scopes.extend(write_scopes());
    }
    scopes.sort();
    scopes.dedup();
    scopes
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
    if mode == SessionMode::Read {
        // Enforce strictly read-only: do not request write scopes even if provided in extras
        scopes.extend(
            extras
                .iter()
                .filter(|scope| !is_write_or_privileged_scope(scope))
                .cloned(),
        );
    } else {
        scopes.extend(extras.iter().cloned());
    }
    scopes.sort();
    scopes.dedup();
    scopes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSignIn {
    pub flow_id: String,
    pub authorize_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSignIn {
    pub client_id: String,
    pub account_name: Option<String>,
    pub tenant_id: Option<String>,
    pub tenant_name: Option<String>,
    pub tenant_domain: Option<String>,
    pub mode: SessionMode,
    pub extra_scopes: Vec<String>,
    pub graph_command_line: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum StoredSignInOutcome {
    #[serde(rename_all = "camelCase")]
    SignedIn {
        account_name: Option<String>,
        mode: SessionMode,
    },
    #[serde(rename_all = "camelCase")]
    NeedsBrowser {
        client_id: String,
        mode: SessionMode,
        extra_scopes: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTokens {
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

struct BrowserFlow {
    cancel: Option<oneshot::Sender<()>>,
    callback: Option<oneshot::Receiver<Result<String, String>>>,
    redirect_uri: String,
    code_verifier: String,
    client_id: String,
    extra_scopes: Vec<String>,
    mode: SessionMode,
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
    pending: Mutex<HashMap<String, BrowserFlow>>,
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

    pub async fn session_client_id(&self) -> Option<String> {
        self.session
            .lock()
            .await
            .as_ref()
            .map(|session| session.client_id.clone())
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

    ///
    /// True when the session is read-only but the token Entra issued still
    /// carries write or privileged scopes.
    ///
    /// This happens because Axis is a public client using a well-known app id:
    /// Entra returns whatever the tenant has already consented for that app, not
    /// strictly what was requested. Axis still gates its own writes, but the
    /// caller should surface this so the user knows the grant exceeds the ask.
    pub async fn read_only_scope_exceeds_request(&self) -> bool {
        let current = self.session.lock().await;
        let Some(session) = current.as_ref() else {
            return false;
        };
        if effective_session_mode(session.mode) != SessionMode::Read {
            return false;
        }
        let Some(access_token) = session.access_token.as_deref() else {
            return false;
        };
        let claims = decode_access_token_claims(access_token);
        token_scp_has_write_scopes(claims.scp.as_deref())
    }

    /// Returns any write or privileged scopes on the current access token.
    pub async fn token_write_scopes(&self) -> Vec<String> {
        let current = self.session.lock().await;
        let Some(session) = current.as_ref() else {
            return Vec::new();
        };
        let Some(access_token) = session.access_token.as_deref() else {
            return Vec::new();
        };
        let claims = decode_access_token_claims(access_token);
        token_write_scopes(claims.scp.as_deref())
    }

    /// Opens a loopback sign-in. The caller opens `authorize_url` in the system browser.
    /// `http://localhost` matches any port, which is what Microsoft Graph Command Line Tools
    /// and a customer public client with that redirect both accept.
    pub async fn start_browser_sign_in(
        &self,
        requested: Option<SessionMode>,
        extra_scopes: Option<&str>,
        client_id: Option<&str>,
    ) -> Result<BrowserSignIn, AuthError> {
        let mode = effective_session_mode(requested.unwrap_or_default());
        let extra_scopes = parse_extra_scopes(extra_scopes.unwrap_or(""));
        let client_id = match client_id.map(str::trim).filter(|value| !value.is_empty()) {
            Some(value) => parse_app_registration_client_id(value)?,
            None => device_code_client_id(),
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|error| {
            AuthError::Message(format!("Could not listen for the sign-in reply: {error}"))
        })?;
        let port = listener
            .local_addr()
            .map_err(|error| {
                AuthError::Message(format!("Could not listen for the sign-in reply: {error}"))
            })?
            .port();
        let v6 = TcpListener::bind(format!("[::1]:{port}")).await.ok();
        let redirect_uri = format!("http://localhost:{port}");
        let code_verifier = pkce_verifier();
        let code_challenge = pkce_challenge(&code_verifier);
        let state = Uuid::new_v4().simple().to_string();
        let scope = scope_parameter(&scopes_for_mode_with_extras(mode, &extra_scopes));
        let authorize_url = format!(
            "{}/authorize?client_id={}&response_type=code&redirect_uri={}&response_mode=query&scope={}&code_challenge={}&code_challenge_method=S256&state={}&prompt=select_account",
            authority_base(),
            urlencoding_helper(&client_id),
            urlencoding_helper(&redirect_uri),
            urlencoding_helper(&scope),
            urlencoding_helper(&code_challenge),
            urlencoding_helper(&state),
        );

        let (cancel_tx, cancel_rx) = oneshot::channel();
        let (done_tx, done_rx) = oneshot::channel();
        tokio::spawn(async move {
            let outcome = tokio::select! {
                _ = cancel_rx => Err("Sign-in cancelled.".to_string()),
                _ = tokio::time::sleep(Duration::from_secs(600)) => {
                    Err("Sign-in timed out. Try again.".to_string())
                }
                result = accept_loopback(listener, v6, &state) => result,
            };
            let _ = done_tx.send(outcome);
        });

        let flow_id = Uuid::new_v4().to_string();
        self.pending.lock().await.insert(
            flow_id.clone(),
            BrowserFlow {
                cancel: Some(cancel_tx),
                callback: Some(done_rx),
                redirect_uri,
                code_verifier,
                client_id,
                extra_scopes,
                mode,
            },
        );

        Ok(BrowserSignIn {
            flow_id,
            authorize_url,
        })
    }

    pub async fn wait_browser_sign_in(&self, flow_id: &str) -> Result<PollResult, AuthError> {
        let callback = {
            let mut pending = self.pending.lock().await;
            let Some(flow) = pending.get_mut(flow_id) else {
                return Ok(PollResult::Failed {
                    error: "Sign-in request expired. Try again.".into(),
                });
            };
            let Some(callback) = flow.callback.take() else {
                return Ok(PollResult::Failed {
                    error: "Sign-in request expired. Try again.".into(),
                });
            };
            callback
        };

        let code = match callback.await {
            Ok(Ok(code)) => code,
            Ok(Err(error)) => {
                self.pending.lock().await.remove(flow_id);
                return Ok(PollResult::Failed { error });
            }
            Err(_) => {
                self.pending.lock().await.remove(flow_id);
                return Ok(PollResult::Failed {
                    error: "Sign-in cancelled.".into(),
                });
            }
        };
        let Some(flow) = self.pending.lock().await.remove(flow_id) else {
            return Ok(PollResult::Failed {
                error: "Sign-in cancelled.".into(),
            });
        };

        let response = self
            .client
            .post(format!("{}/token", authority_base()))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "grant_type=authorization_code&client_id={}&code={}&redirect_uri={}&code_verifier={}",
                urlencoding_helper(&flow.client_id),
                urlencoding_helper(&code),
                urlencoding_helper(&flow.redirect_uri),
                urlencoding_helper(&flow.code_verifier),
            ))
            .send()
            .await?;

        let status = response.status();
        let json: serde_json::Value = response.json().await?;
        if !status.is_success() {
            return Ok(PollResult::Failed {
                error: describe_error(&json, "Sign-in failed."),
            });
        }

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
            mode: flow.mode,
            client_id: flow.client_id,
            extra_scopes: flow.extra_scopes,
        })
        .await;

        Ok(PollResult::SignedIn {
            access_token,
            expires_on,
            account_name,
            tenant_id,
            mode: flow.mode,
        })
    }

    pub async fn cancel_browser_sign_in(&self, flow_id: &str) {
        if let Some(flow) = self.pending.lock().await.remove(flow_id) {
            if let Some(cancel) = flow.cancel {
                let _ = cancel.send(());
            }
        }
    }

    pub async fn get_session_token(&self) -> Result<Option<SessionTokens>, AuthError> {
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
                eprintln!("axis auth: refresh token rejected ({error}); clearing stored session");
                self.clear_session().await;
            } else {
                eprintln!("axis auth: refresh failed but keeping stored session: {description}");
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

        Ok(Some(SessionTokens {
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
        session_store::mark_signed_out();
        *self.session.lock().await = None;
    }

    pub fn remember_tenant_name(&self, tenant_id: &str, tenant_name: &str) {
        session_store::set_tenant_name(tenant_id, tenant_name);
    }

    pub async fn list_stored_sign_ins(&self) -> Vec<StoredSignIn> {
        self.backfill_tenant_labels().await;
        session_store::list_clients()
            .into_iter()
            .map(|client| StoredSignIn {
                graph_command_line: is_graph_command_line_tools_client(&client.client_id),
                client_id: client.client_id,
                account_name: client.account_name,
                tenant_id: client.tenant_id,
                tenant_name: client.tenant_name,
                tenant_domain: client.tenant_domain,
                mode: client.mode,
                extra_scopes: client.extra_scopes,
            })
            .collect()
    }

    pub async fn forget_stored_sign_in(&self, client_id: &str) {
        let active = self
            .session
            .lock()
            .await
            .as_ref()
            .map(|session| session.client_id.clone());
        session_store::forget_client(client_id);
        if active
            .as_deref()
            .is_some_and(|current| current.eq_ignore_ascii_case(client_id))
        {
            *self.session.lock().await = None;
        }
    }

    /// Use a saved app's refresh token. When that credential is gone or rejected,
    /// the caller opens the browser for the same client id.
    pub async fn use_stored_sign_in(
        &self,
        client_id: &str,
    ) -> Result<StoredSignInOutcome, AuthError> {
        let Some(saved) = session_store::find_client(client_id) else {
            return Err(AuthError::Message(
                "That saved sign-in is no longer stored.".into(),
            ));
        };
        let needs_browser = || StoredSignInOutcome::NeedsBrowser {
            client_id: saved.client_id.clone(),
            mode: saved.mode,
            extra_scopes: saved.extra_scopes.clone(),
        };
        let Some(stored) = session_store::load_client(client_id) else {
            return Ok(needs_browser());
        };
        if stored.refresh_token.is_empty() || !stored.is_restorable(&device_code_tenant()) {
            return Ok(needs_browser());
        }

        *self.session.lock().await = Some(DeviceSession {
            refresh_token: stored.refresh_token,
            access_token: None,
            access_token_expires_on: stored.access_expires_on,
            account_name: stored.account_name,
            tenant_id: stored.tenant_id,
            mode: stored.mode,
            client_id: stored.client_id,
            extra_scopes: stored.extra_scopes,
        });

        match self.get_session_token().await {
            Ok(Some(_)) => {
                let session = self.session.lock().await;
                let current = session.as_ref();
                Ok(StoredSignInOutcome::SignedIn {
                    account_name: current.and_then(|session| session.account_name.clone()),
                    mode: current.map(|session| session.mode).unwrap_or(saved.mode),
                })
            }
            Ok(None) => {
                *self.session.lock().await = None;
                Ok(needs_browser())
            }
            Err(error) => {
                let still_stored = session_store::load_client(client_id).is_some();
                *self.session.lock().await = None;
                if still_stored {
                    session_store::mark_signed_out();
                    Err(error)
                } else {
                    Ok(needs_browser())
                }
            }
        }
    }

    pub async fn is_signed_in(&self) -> bool {
        self.session.lock().await.is_some()
    }

    pub async fn session_tenant_id(&self) -> Option<String> {
        self.session
            .lock()
            .await
            .as_ref()
            .and_then(|session| session.tenant_id.clone())
    }

    async fn commit_session(&self, session: DeviceSession) {
        persist_session(&session);
        if let Some(tenant_id) = session.tenant_id.clone() {
            if let Some(access_token) = session.access_token.as_deref() {
                self.remember_readable_tenant(&tenant_id, access_token)
                    .await;
            }
        }
        *self.session.lock().await = Some(session);
    }

    async fn remember_readable_tenant(&self, tenant_id: &str, access_token: &str) {
        let claims = decode_access_token_claims(access_token);
        if let Some(domain) = claims.upn.as_deref().and_then(upn_domain) {
            session_store::set_tenant_label(tenant_id, None, Some(&domain));
        }
        if let Some(label) = fetch_tenant_label(&self.client, access_token).await {
            session_store::set_tenant_label(
                tenant_id,
                label.name.as_deref(),
                label.domain.as_deref(),
            );
        }
    }

    async fn backfill_tenant_labels(&self) {
        let pending: Vec<_> = session_store::list_clients()
            .into_iter()
            .filter(|client| {
                client.tenant_name.as_deref().unwrap_or("").is_empty()
                    && client.tenant_domain.as_deref().unwrap_or("").is_empty()
            })
            .collect();
        for client in pending {
            let Some(access_token) = self.access_token_for_saved_client(&client.client_id).await
            else {
                continue;
            };
            let tenant_id = client
                .tenant_id
                .clone()
                .or_else(|| decode_access_token_claims(&access_token).tid);
            let Some(tenant_id) = tenant_id else {
                continue;
            };
            self.remember_readable_tenant(&tenant_id, &access_token)
                .await;
        }
    }

    async fn access_token_for_saved_client(&self, client_id: &str) -> Option<String> {
        let stored = session_store::load_client(client_id)?;
        if stored.refresh_token.is_empty() {
            return None;
        }
        let mode = effective_session_mode(stored.mode);
        let response = self
            .client
            .post(format!("{}/token", authority_base()))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "grant_type=refresh_token&client_id={}&refresh_token={}&scope={}",
                urlencoding_helper(&stored.client_id),
                urlencoding_helper(&stored.refresh_token),
                urlencoding_helper(&scope_parameter(&scopes_for_mode_with_extras(
                    mode,
                    &stored.extra_scopes,
                )))
            ))
            .send()
            .await
            .ok()?;
        let status = response.status();
        let json: serde_json::Value = response.json().await.ok()?;
        if !status.is_success() {
            return None;
        }
        let access_token = json["access_token"].as_str()?.to_string();
        let refresh_token = json["refresh_token"]
            .as_str()
            .unwrap_or(&stored.refresh_token)
            .to_string();
        let expires_in = json["expires_in"].as_u64().unwrap_or(3600);
        let claims = decode_access_token_claims(&access_token);
        session_store::replace_client_token(&PersistedSession::new(
            refresh_token,
            stored.client_id,
            stored.tenant,
            claims
                .name
                .clone()
                .or(claims.upn.clone())
                .or(stored.account_name),
            claims.tid.or(stored.tenant_id),
            Some(now_ms() + (expires_in * 1000) as i64),
            mode,
            stored.extra_scopes,
        ));
        Some(access_token)
    }

    async fn clear_session(&self) {
        let client_id = self
            .session
            .lock()
            .await
            .as_ref()
            .map(|session| session.client_id.clone());
        if let Some(client_id) = client_id {
            session_store::drop_refresh_token(&client_id);
        } else {
            session_store::mark_signed_out();
        }
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
        mode: stored.mode,
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

fn cached_fresh_access_token(session: &DeviceSession) -> Option<SessionTokens> {
    let access_token = session.access_token.as_ref()?;
    let expires_on = session.access_token_expires_on?;
    let still_fresh = expires_on - now_ms() > (REFRESH_SKEW_SECONDS * 1000) as i64;
    if still_fresh {
        Some(SessionTokens {
            access_token: access_token.clone(),
            expires_on,
        })
    } else {
        None
    }
}

fn pkce_verifier() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

async fn accept_loopback(
    v4: TcpListener,
    v6: Option<TcpListener>,
    expected_state: &str,
) -> Result<String, String> {
    loop {
        let mut socket = match &v6 {
            Some(v6) => {
                tokio::select! {
                    accepted = v4.accept() => accepted.map(|(socket, _)| socket),
                    accepted = v6.accept() => accepted.map(|(socket, _)| socket),
                }
            }
            None => v4.accept().await.map(|(socket, _)| socket),
        }
        .map_err(|error| format!("Sign-in reply failed: {error}"))?;

        let head = read_http_head(&mut socket).await;
        let request_line = head.lines().next().unwrap_or("");
        if request_line.contains(" /favicon.ico") {
            let _ = write_http(&mut socket, "404 Not Found", "No favicon.").await;
            continue;
        }
        let outcome = authorization_code_from_request(request_line, expected_state);
        let page = match &outcome {
            Ok(_) => "Signed in to Axis. You can close this window.".to_string(),
            Err(error) => html_escape(error),
        };
        let _ = write_http(&mut socket, "200 OK", &page).await;
        return outcome;
    }
}

async fn read_http_head(socket: &mut tokio::net::TcpStream) -> String {
    let mut buf = vec![0u8; 8192];
    let mut filled = 0;
    while filled < buf.len() {
        match socket.read(&mut buf[filled..]).await {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                filled += read;
                if buf[..filled].windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
        }
    }
    String::from_utf8_lossy(&buf[..filled]).into_owned()
}

async fn write_http(
    socket: &mut tokio::net::TcpStream,
    status: &str,
    message: &str,
) -> std::io::Result<()> {
    let body = format!(
        "<!DOCTYPE html><html><body style=\"font-family:sans-serif\"><p>{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    socket.write_all(response.as_bytes()).await?;
    let _ = socket.shutdown().await;
    Ok(())
}

fn authorization_code_from_request(
    request_line: &str,
    expected_state: &str,
) -> Result<String, String> {
    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = path.split_once('?').map(|(_, query)| query).unwrap_or("");
    let mut code = None;
    let mut state = None;
    let mut error = None;
    let mut error_description = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let value = percent_decode(value);
        match key {
            "code" => code = Some(value),
            "state" => state = Some(value),
            "error" => error = Some(value),
            "error_description" => error_description = Some(value),
            _ => {}
        }
    }
    if let Some(error) = error {
        return Err(error_description.unwrap_or(error));
    }
    if state.as_deref() != Some(expected_state) {
        return Err("Sign-in reply did not match this request. Try again.".into());
    }
    code.ok_or_else(|| "Microsoft did not return a sign-in code.".into())
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn percent_decode(value: &str) -> String {
    let mut out = Vec::new();
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = &value[index + 1..index + 3];
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    index += 3;
                } else {
                    out.push(bytes[index]);
                    index += 1;
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as i64
}

struct TenantLabel {
    name: Option<String>,
    domain: Option<String>,
}

fn upn_domain(upn: &str) -> Option<String> {
    let domain = upn.rsplit_once('@')?.1.trim();
    if domain.is_empty() {
        None
    } else {
        Some(domain.to_string())
    }
}

async fn fetch_tenant_label(client: &reqwest::Client, access_token: &str) -> Option<TenantLabel> {
    let response = client
        .get("https://graph.microsoft.com/v1.0/organization?$select=displayName,verifiedDomains")
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let json: serde_json::Value = response.json().await.ok()?;
    let row = json.get("value")?.as_array()?.first()?;
    let name = row
        .get("displayName")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let domain = row
        .get("verifiedDomains")
        .and_then(|value| value.as_array())
        .and_then(|domains| {
            domains
                .iter()
                .find(|domain| {
                    domain.get("isDefault").and_then(|flag| flag.as_bool()) == Some(true)
                })
                .or_else(|| {
                    domains.iter().find(|domain| {
                        domain.get("isInitial").and_then(|flag| flag.as_bool()) == Some(true)
                    })
                })
                .or_else(|| domains.first())
        })
        .and_then(|domain| domain.get("name"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if name.is_none() && domain.is_none() {
        None
    } else {
        Some(TenantLabel { name, domain })
    }
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

    fn write_scopes() -> [&'static str; 8] {
        [
            "DeviceManagementManagedDevices.ReadWrite.All",
            "DeviceManagementManagedDevices.PrivilegedOperations.All",
            "DeviceManagementConfiguration.ReadWrite.All",
            "DeviceManagementApps.ReadWrite.All",
            "DeviceManagementScripts.ReadWrite.All",
            "DeviceManagementServiceConfig.ReadWrite.All",
            "Group.ReadWrite.All",
            "Policy.ReadWrite.DeviceConfiguration",
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

        // In Read mode, write scopes in extras must be ignored
        let read_scopes = scopes_for_mode_with_extras(SessionMode::Read, &extras);
        assert!(!read_scopes
            .iter()
            .any(|scope| scope == "Policy.ReadWrite.ConditionalAccess"));
        assert!(read_scopes.iter().any(|scope| scope == "User.Read"));
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

        let write_scopes = token_write_scopes(Some(
            "User.Read DeviceManagementConfiguration.ReadWrite.All Directory.AccessAsUser.All",
        ));
        assert_eq!(
            write_scopes,
            vec![
                "DeviceManagementConfiguration.ReadWrite.All".to_string(),
                "Directory.AccessAsUser.All".to_string(),
            ]
        );
    }

    #[test]
    fn read_mode_requests_no_write_scopes() {
        let scopes = scopes_for_mode(SessionMode::Read);
        assert!(
            !scopes
                .iter()
                .any(|scope| is_write_or_privileged_scope(scope)),
            "read mode must not request write scopes: {scopes:?}"
        );
        // Identity and reads still present.
        assert!(scopes.iter().any(|scope| scope == "offline_access"));
        assert!(scopes
            .iter()
            .any(|scope| scope == "DeviceManagementConfiguration.Read.All"));
    }

    #[test]
    fn admin_mode_requests_write_scopes() {
        let scopes = scopes_for_mode(SessionMode::Admin);
        assert!(scopes
            .iter()
            .any(|scope| scope == "DeviceManagementConfiguration.ReadWrite.All"));
        assert!(scopes
            .iter()
            .any(|scope| scope == "DeviceManagementManagedDevices.PrivilegedOperations.All"));
    }

    #[test]
    fn requested_mode_is_honoured() {
        assert_eq!(effective_session_mode(SessionMode::Read), SessionMode::Read);
        assert_eq!(
            effective_session_mode(SessionMode::Admin),
            SessionMode::Admin
        );
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
