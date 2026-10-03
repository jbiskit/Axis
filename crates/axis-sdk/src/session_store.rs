use serde::{Deserialize, Serialize};

/// Matches Tauri `identifier` (`com.axis.desktop`).
const SERVICE: &str = "com.axis.desktop";
const ACCOUNT: &str = "entra-device-code";
const MODE_ACCOUNT: &str = "entra-session-mode";
const INDEX_ACCOUNT: &str = "entra-session-index";
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

/// A saved sign-in without the refresh token. The landing page lists these.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredClient {
    pub client_id: String,
    #[serde(default)]
    pub account_name: Option<String>,
    #[serde(default)]
    pub tenant_id: Option<String>,
    #[serde(default)]
    pub tenant_name: Option<String>,
    /// Default verified domain, such as `contoso.onmicrosoft.com`.
    #[serde(default)]
    pub tenant_domain: Option<String>,
    #[serde(default)]
    pub mode: SessionMode,
    #[serde(default)]
    pub extra_scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionIndex {
    version: u32,
    #[serde(default)]
    signed_out: bool,
    #[serde(default)]
    last_client_id: Option<String>,
    #[serde(default)]
    clients: Vec<StoredClient>,
}

impl Default for SessionIndex {
    fn default() -> Self {
        Self {
            version: VERSION,
            signed_out: false,
            last_client_id: None,
            clients: Vec::new(),
        }
    }
}

fn log_store(message: &str) {
    eprintln!("axis auth: {message}");
}

pub fn save(session: &PersistedSession) {
    if session.refresh_token.is_empty() || session.client_id.is_empty() {
        log_store("skip save: empty refresh token or client id");
        return;
    }
    write_session_secret(&client_account(&session.client_id), session);
    let mut index = load_index();
    index.signed_out = false;
    index.last_client_id = Some(session.client_id.clone());
    upsert_client(&mut index, session);
    if write_index(&index).is_err() {
        log_store("failed to save the sign-in list");
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
    let index = load_index();
    if index.signed_out {
        log_store("stored sign-ins kept; startup stays signed out");
        return None;
    }
    let id = index.last_client_id?;
    load_client(&id)
}

pub fn load_client(client_id: &str) -> Option<PersistedSession> {
    read_session_secret(&client_account(client_id))
}

pub fn list_clients() -> Vec<StoredClient> {
    let index = load_index();
    let mut clients = index.clients;
    if let Some(last) = index.last_client_id {
        clients.sort_by(|left, right| {
            let left_last = left.client_id.eq_ignore_ascii_case(&last);
            let right_last = right.client_id.eq_ignore_ascii_case(&last);
            right_last.cmp(&left_last)
        });
    }
    clients
}

pub fn find_client(client_id: &str) -> Option<StoredClient> {
    load_index().clients.into_iter().find(|client| {
        client.client_id.eq_ignore_ascii_case(client_id)
    })
}

pub fn mark_signed_out() {
    let mut index = load_index();
    index.signed_out = true;
    if write_index(&index).is_err() {
        log_store("failed to record sign-out");
    }
}

/// Drop one app's refresh token and keep it on the sign-in list.
pub fn drop_refresh_token(client_id: &str) {
    delete_account(SERVICE, &client_account(client_id));
    delete_legacy_if_client(client_id);
    let mut index = load_index();
    index.signed_out = true;
    if write_index(&index).is_err() {
        log_store("failed to record a dropped refresh token");
    }
}

pub fn forget_client(client_id: &str) {
    delete_account(SERVICE, &client_account(client_id));
    delete_legacy_if_client(client_id);
    let mut index = load_index();
    index.clients.retain(|client| !client.client_id.eq_ignore_ascii_case(client_id));
    if index
        .last_client_id
        .as_deref()
        .is_some_and(|id| id.eq_ignore_ascii_case(client_id))
    {
        index.last_client_id = index.clients.first().map(|client| client.client_id.clone());
    }
    if write_index(&index).is_err() {
        log_store("failed to update the sign-in list after remove");
    }
}

/// Legacy single-session accounts. Each app now has its own credential.
fn stored_accounts() -> [&'static str; 2] {
    [ACCOUNT, MODE_ACCOUNT]
}

fn client_account(client_id: &str) -> String {
    format!("entra-client-{}", client_id.trim().to_ascii_lowercase())
}

fn upsert_client(index: &mut SessionIndex, session: &PersistedSession) {
    let previous = index.clients.iter().find(|client| {
        client.client_id.eq_ignore_ascii_case(&session.client_id)
    });
    let record = StoredClient {
        client_id: session.client_id.clone(),
        account_name: session
            .account_name
            .clone()
            .or_else(|| previous.and_then(|client| client.account_name.clone())),
        tenant_id: session.tenant_id.clone(),
        tenant_name: previous.and_then(|client| client.tenant_name.clone()),
        tenant_domain: previous.and_then(|client| client.tenant_domain.clone()),
        mode: session.mode,
        extra_scopes: session.extra_scopes.clone(),
    };
    if let Some(existing) = index.clients.iter_mut().find(|client| {
        client.client_id.eq_ignore_ascii_case(&record.client_id)
    }) {
        *existing = record;
    } else {
        index.clients.push(record);
    }
}

pub fn set_tenant_name(tenant_id: &str, tenant_name: &str) {
    set_tenant_label(tenant_id, Some(tenant_name), None);
}

/// Remember a readable tenant name and default domain for every saved app in that tenant.
pub fn set_tenant_label(tenant_id: &str, tenant_name: Option<&str>, tenant_domain: Option<&str>) {
    let name = tenant_name.map(str::trim).filter(|value| !value.is_empty());
    let domain = tenant_domain.map(str::trim).filter(|value| !value.is_empty());
    if tenant_id.trim().is_empty() || (name.is_none() && domain.is_none()) {
        return;
    }
    let mut index = load_index();
    let mut changed = false;
    for client in &mut index.clients {
        if client
            .tenant_id
            .as_deref()
            .is_some_and(|stored| stored.eq_ignore_ascii_case(tenant_id))
        {
            if let Some(name) = name {
                if client.tenant_name.as_deref() != Some(name) {
                    client.tenant_name = Some(name.to_string());
                    changed = true;
                }
            }
            if let Some(domain) = domain {
                if client.tenant_domain.as_deref() != Some(domain) {
                    client.tenant_domain = Some(domain.to_string());
                    changed = true;
                }
            }
        }
    }
    if changed && write_index(&index).is_err() {
        log_store("failed to save the tenant name on saved sign-ins");
    }
}

/// Replace one app's refresh token without changing which session is active.
pub fn replace_client_token(session: &PersistedSession) {
    if session.refresh_token.is_empty() || session.client_id.is_empty() {
        return;
    }
    write_session_secret(&client_account(&session.client_id), session);
    let mut index = load_index();
    let signed_out = index.signed_out;
    let last_client_id = index.last_client_id.clone();
    upsert_client(&mut index, session);
    index.signed_out = signed_out;
    index.last_client_id = last_client_id;
    if write_index(&index).is_err() {
        log_store("failed to update a saved sign-in token");
    }
}

fn write_session_secret(account: &str, session: &PersistedSession) {
    let Ok(json) = serde_json::to_string(session) else {
        log_store("skip save: could not serialize session");
        return;
    };
    let entry = match keyring::Entry::new(SERVICE, account) {
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

fn read_session_secret(account: &str) -> Option<PersistedSession> {
    let entry = match keyring::Entry::new(SERVICE, account) {
        Ok(entry) => entry,
        Err(error) => {
            log_store(&format!("credential store unavailable on load: {error}"));
            return None;
        }
    };
    let bytes = match entry.get_secret() {
        Ok(bytes) => bytes,
        Err(keyring::Error::NoEntry) => return None,
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
        Ok(session) => Some(session),
        Err(error) => {
            log_store(&format!("stored session JSON is invalid: {error}"));
            None
        }
    }
}

fn load_legacy() -> Option<PersistedSession> {
    read_session_secret(ACCOUNT)
}

fn delete_legacy_if_client(client_id: &str) {
    if let Some(legacy) = load_legacy() {
        if legacy.client_id.eq_ignore_ascii_case(client_id) {
            delete_account(SERVICE, ACCOUNT);
        }
    }
}

fn load_index() -> SessionIndex {
    if let Some(index) = read_index() {
        return index;
    }
    let mut index = SessionIndex::default();
    if let Some(legacy) = load_legacy() {
        if !legacy.client_id.is_empty() && !legacy.refresh_token.is_empty() {
            write_session_secret(&client_account(&legacy.client_id), &legacy);
            index.signed_out = false;
            index.last_client_id = Some(legacy.client_id.clone());
            upsert_client(&mut index, &legacy);
            if write_index(&index).is_ok() {
                delete_account(SERVICE, ACCOUNT);
                log_store("moved the saved sign-in onto the app list");
            }
        }
    }
    index
}

fn read_index() -> Option<SessionIndex> {
    let entry = keyring::Entry::new(SERVICE, INDEX_ACCOUNT).ok()?;
    let bytes = entry.get_secret().ok()?;
    let json = String::from_utf8(bytes).ok()?;
    serde_json::from_str(&json).ok()
}

fn write_index(index: &SessionIndex) -> Result<(), ()> {
    let json = serde_json::to_string(index).map_err(|_| ())?;
    let entry = keyring::Entry::new(SERVICE, INDEX_ACCOUNT).map_err(|_| ())?;
    entry.set_secret(json.as_bytes()).map_err(|_| ())
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

/// Full wipe of saved sign-ins. Sign-out does not call this; the landing page
/// keeps each app's credential.
#[allow(dead_code)]
pub fn delete() {
    let index = load_index();
    for client in &index.clients {
        delete_account(SERVICE, &client_account(&client.client_id));
    }
    delete_account(SERVICE, INDEX_ACCOUNT);
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
