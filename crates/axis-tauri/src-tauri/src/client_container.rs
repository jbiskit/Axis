//! Active client container path — persisted under the app data directory.

use axis_sdk::{
    build_client_container_status, create_container, open_container, snooze_stale_prompt,
    ClientContainerManifest, ClientContainerStatus, DEFAULT_STALE_DAYS,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const STATE_FILE: &str = "active-client-container.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ActiveContainerState {
    #[serde(default)]
    path: Option<String>,
}

pub struct ClientContainerRuntime {
    state_file: PathBuf,
    active: Mutex<Option<PathBuf>>,
    stale_after_days: u32,
}

impl ClientContainerRuntime {
    pub fn new(app_data: &Path) -> Self {
        let state_file = app_data.join(STATE_FILE);
        let active = load_active_path(&state_file);
        Self {
            state_file,
            active: Mutex::new(active),
            stale_after_days: DEFAULT_STALE_DAYS,
        }
    }

    pub fn active_path(&self) -> Option<PathBuf> {
        self.active.lock().ok()?.clone()
    }

    fn persist(&self, path: Option<&Path>) {
        let payload = ActiveContainerState {
            path: path.map(|p| p.to_string_lossy().into_owned()),
        };
        if let Some(parent) = self.state_file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&payload) {
            let _ = fs::write(&self.state_file, format!("{text}\n"));
        }
    }

    pub fn set_active(&self, path: PathBuf) -> Result<ClientContainerManifest, String> {
        let manifest = open_container(&path).map_err(|error| error.to_string())?;
        if let Ok(mut guard) = self.active.lock() {
            *guard = Some(path.clone());
        }
        self.persist(Some(&path));
        Ok(manifest)
    }

    pub fn create_and_activate(
        &self,
        path: PathBuf,
        name: &str,
        tenant_id: &str,
        primary_domain: Option<&str>,
    ) -> Result<ClientContainerManifest, String> {
        let manifest =
            create_container(&path, name, tenant_id, primary_domain).map_err(|e| e.to_string())?;
        if let Ok(mut guard) = self.active.lock() {
            *guard = Some(path.clone());
        }
        self.persist(Some(&path));
        Ok(manifest)
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.active.lock() {
            *guard = None;
        }
        self.persist(None);
    }

    pub fn status(&self, session_tenant_id: Option<&str>) -> Result<ClientContainerStatus, String> {
        let path = self.active_path();
        match build_client_container_status(
            path.as_deref(),
            session_tenant_id,
            self.stale_after_days,
        ) {
            Ok(status) => Ok(status),
            Err(error) => {
                // Sticky path broken or corrupt — drop it and report inactive.
                self.clear();
                let _ = error;
                build_client_container_status(None, session_tenant_id, self.stale_after_days)
                    .map_err(|e| e.to_string())
            }
        }
    }

    pub fn snooze(&self, days: u32) -> Result<ClientContainerManifest, String> {
        let path = self
            .active_path()
            .ok_or_else(|| "No client container is open.".to_string())?;
        snooze_stale_prompt(&path, days).map_err(|e| e.to_string())
    }
}

fn load_active_path(state_file: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(state_file).ok()?;
    let state: ActiveContainerState = serde_json::from_str(text.trim_start_matches('\u{FEFF}')).ok()?;
    let path = state.path?.trim().to_string();
    if path.is_empty() {
        return None;
    }
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return None;
    }
    // Must still look like a container.
    if !path.join(axis_sdk::CLIENT_MANIFEST_FILE).is_file() {
        return None;
    }
    Some(path)
}
