//! App preferences that the Rust side acts on, stored as `preferences.json` in
//! the app data folder. UI-only choices (theme, last folder) stay in the webview.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    /// Read each object before and after a write so it can be undone.
    pub undo_state_tracking: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            undo_state_tracking: true,
        }
    }
}

struct Store {
    path: PathBuf,
    current: Mutex<Preferences>,
}

static STORE: OnceLock<Store> = OnceLock::new();

/// Load preferences from `app_data` and apply them. Called once at startup.
pub fn init(app_data: &Path) {
    let path = app_data.join("preferences.json");
    let current = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    apply(&current);
    let _ = STORE.set(Store {
        path,
        current: Mutex::new(current),
    });
}

fn apply(preferences: &Preferences) {
    axis_sdk::set_write_state_tracking(preferences.undo_state_tracking);
}

#[tauri::command]
pub fn get_preferences_cmd() -> Preferences {
    STORE
        .get()
        .map(|store| store.current.lock().unwrap_or_else(|p| p.into_inner()).clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_preferences_cmd(preferences: Preferences) -> Result<Preferences, String> {
    let store = STORE.get().ok_or("Preferences are not available.")?;
    let text = serde_json::to_string_pretty(&preferences).map_err(|error| error.to_string())?;
    if let Some(parent) = store.path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&store.path, text).map_err(|error| error.to_string())?;
    apply(&preferences);
    *store.current.lock().unwrap_or_else(|p| p.into_inner()) = preferences.clone();
    Ok(preferences)
}
