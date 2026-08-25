use serde::{Deserialize, Serialize};

/// Matches Tauri `identifier` (`com.axis.desktop`).
const SERVICE: &str = "com.axis.desktop";
const ACCOUNT: &str = "entra-device-code";
const MODE_ACCOUNT: &str = "entra-session-mode";
/// Pre-rebrand Credential Manager services. Sign-out and startup delete these
/// so leftover entries are not orphaned.
const LEGACY_SERVICES: &[&str] = &["dev.policyforge.desktop", "com.policyforge.desktop"];
const VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    #[default]
    Admin,
    Read,
}

impl SessionMode {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "read" | "readonly" | "read-only" => Ok(Self::Read),
            "admin" | "write" | "readwrite" => Ok(Self::Admin),
            other => Err(format!("Unknown session mode: {other}")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Admin => "admin",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSession {
    pub version: u32,
    pub refresh_token: String,
    pub client_id: String,
    pub tenant: String,
    pub account_name: Option<String>,
    pub tenant_id: Option<String>,
    pub access_expires_on: Option<i64>,
    #[serde(default)]
    pub mode: SessionMode,
    #[serde(default)]
    pub extra_scopes: Vec<String>,
}

impl PersistedSession {
    pub fn new(
        refresh_token: String,
        client_id: String,
        tenant: String,
        account_name: Option<String>,
        tenant_id: Option<String>,
        access_expires_on: Option<i64>,
        mode: SessionMode,
        extra_scopes: Vec<String>,
    ) -> Self {
        Self {
            version: VERSION,
            refresh_token,
            client_id,
            tenant,
            account_name,
            tenant_id,
            access_expires_on,
            mode,
            extra_scopes,
        }
    }

    /// Restore if the payload is complete and the tenant still matches.
    /// Refresh must use the stored `client_id` (the app that issued the token).
    pub fn is_restorable(&self, tenant: &str) -> bool {
        self.version == VERSION
            && !self.refresh_token.is_empty()
            && !self.client_id.is_empty()
            && Self::tenants_compatible(&self.tenant, tenant)
    }

    fn tenants_compatible(stored: &str, current: &str) -> bool {
        stored == current
            || stored.eq_ignore_ascii_case("organizations")
            || current.eq_ignore_ascii_case("organizations")
    }
}

fn entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, ACCOUNT)
}

fn log_store(message: &str) {
    eprintln!("axis auth: {message}");
}

pub fn save(session: &PersistedSession) {
    if session.refresh_token.is_empty() {
        log_store("skip save: empty refresh token");
        return;
    }
    let Ok(json) = serde_json::to_string(session) else {
        log_store("skip save: could not serialize session");
        return;
    };
    let entry = match entry() {
        Ok(entry) => entry,
        Err(error) => {
            log_store(&format!("credential store unavailable on save: {error}"));
            return;
        }
    };
    // UTF-8 secret (not set_password): Windows CredWrite caps the blob at 2560
    // bytes and set_password UTF-16-encodes, which halves the usable length.
    match entry.set_secret(json.as_bytes()) {
        Ok(()) => log_store(&format!(
            "saved device session ({} bytes, token not logged)",
            json.len()
        )),
        Err(error) => {
            log_store(&format!(
                "full session save failed ({error}); trying compact payload"
            ));
            save_compact(&entry, session);
        }
    }
}

fn save_compact(entry: &keyring::Entry, session: &PersistedSession) {
    let compact = PersistedSession::new(
        session.refresh_token.clone(),
        session.client_id.clone(),
        session.tenant.clone(),
        None,
        session.tenant_id.clone(),
        None,
        session.mode,
        session.extra_scopes.clone(),
    );
    let Ok(json) = serde_json::to_string(&compact) else {
        return;
    };
    match entry.set_secret(json.as_bytes()) {
        Ok(()) => log_store(&format!(
            "saved compact device session ({} bytes, token not logged)",
            json.len()
        )),
        Err(error) => log_store(&format!("failed to save device session: {error}")),
    }
}

pub fn load() -> Option<PersistedSession> {
    let entry = match entry() {
        Ok(entry) => entry,
        Err(error) => {
            log_store(&format!("credential store unavailable on load: {error}"));
            return None;
        }
    };
    let bytes = match entry.get_secret() {
        Ok(bytes) => bytes,
        Err(keyring::Error::NoEntry) => {
            log_store("no stored device session");
            return None;
        }
        Err(error) => {
            log_store(&format!("failed to load device session: {error}"));
            return None;
        }
    };
    let json = match String::from_utf8(bytes) {
        Ok(json) => json,
        Err(_) => {
            log_store("stored session is not valid UTF-8");
            return None;
        }
    };
    match serde_json::from_str(&json) {
        Ok(session) => {
            log_store("loaded device session from credential store");
            Some(session)
        }
        Err(error) => {
            log_store(&format!("stored session JSON is invalid: {error}"));
            None
        }
    }
}

/// Keyring accounts this app writes under a service. Sign-out must delete all of them.
fn stored_accounts() -> [&'static str; 2] {
    [ACCOUNT, MODE_ACCOUNT]
}

fn delete_account(service: &str, account: &str) {
    let entry = match keyring::Entry::new(service, account) {
        Ok(entry) => entry,
        Err(error) => {
            log_store(&format!(
                "credential store unavailable on delete ({service}/{account}): {error}"
            ));
            return;
        }
    };
    match entry.delete_credential() {
        Ok(()) => log_store(&format!("deleted stored credential ({service}/{account})")),
        Err(keyring::Error::NoEntry) => {
            log_store(&format!(
                "no stored credential to delete ({service}/{account})"
            ))
        }
        Err(error) => log_store(&format!(
            "failed to delete stored credential ({service}/{account}): {error}"
        )),
    }
}

/// Remove pre-rebrand Credential Manager entries.
pub fn purge_legacy() {
    for service in LEGACY_SERVICES {
        for account in stored_accounts() {
            delete_account(service, account);
        }
    }
}

pub fn delete() {
    for account in stored_accounts() {
        delete_account(SERVICE, account);
    }
    purge_legacy();
}

fn mode_entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, MODE_ACCOUNT)
}

pub fn save_preferred_mode(mode: SessionMode) {
    let entry = match mode_entry() {
        Ok(entry) => entry,
        Err(error) => {
            log_store(&format!(
                "credential store unavailable on mode save: {error}"
            ));
            return;
        }
    };
    match entry.set_secret(mode.as_str().as_bytes()) {
        Ok(()) => log_store(&format!("saved preferred session mode ({})", mode.as_str())),
        Err(error) => log_store(&format!("failed to save session mode: {error}")),
    }
}

pub fn load_preferred_mode() -> SessionMode {
    let entry = match mode_entry() {
        Ok(entry) => entry,
        Err(error) => {
            log_store(&format!(
                "credential store unavailable on mode load: {error}"
            ));
            return SessionMode::Admin;
        }
    };
    let bytes = match entry.get_secret() {
        Ok(bytes) => bytes,
        Err(keyring::Error::NoEntry) => return SessionMode::Admin,
        Err(error) => {
            log_store(&format!("failed to load session mode: {error}"));
            return SessionMode::Admin;
        }
    };
    let Ok(text) = String::from_utf8(bytes) else {
        return SessionMode::Admin;
    };
    SessionMode::parse(&text).unwrap_or(SessionMode::Admin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_uses_stored_client_id_not_current_env_default() {
        let session = PersistedSession::new(
            "refresh".into(),
            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into(),
            "organizations".into(),
            None,
            None,
            None,
            SessionMode::Admin,
            Vec::new(),
        );
        assert!(session.is_restorable("organizations"));
        assert_ne!(session.client_id, "14d82eec-204b-4c2f-b7e8-296a70dab67e");
        let empty_client = PersistedSession::new(
            "refresh".into(),
            String::new(),
            "organizations".into(),
            None,
            None,
            None,
            SessionMode::Admin,
            Vec::new(),
        );
        assert!(!empty_client.is_restorable("organizations"));
    }

    #[test]
    fn delete_clears_refresh_token_and_session_mode_accounts() {
        let accounts = stored_accounts();
        assert_eq!(accounts, [ACCOUNT, MODE_ACCOUNT]);
        assert_eq!(ACCOUNT, "entra-device-code");
        assert_eq!(MODE_ACCOUNT, "entra-session-mode");
        assert_eq!(SERVICE, "com.axis.desktop");
        assert_eq!(
            LEGACY_SERVICES,
            &["dev.policyforge.desktop", "com.policyforge.desktop"]
        );
    }
}
