use crate::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const DEFAULT_GITHUB_REPO: &str = "jbiskit/policy-axis";
const PROGRESS_EVENT: &str = "axis-updater-progress";
const HTTPS_PREFIX: &str = "https://";

pub struct UpdaterRuntime {
    pending: Mutex<Option<PendingUpdate>>,
}

impl UpdaterRuntime {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
        }
    }
}

#[derive(Clone)]
struct PendingUpdate {
    version: String,
    notes: Option<String>,
    url: String,
    sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub available: bool,
    pub downloaded: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct FeedFile {
    version: String,
    notes: Option<String>,
    url: Option<String>,
    sha256: Option<String>,
    platforms: Option<HashMap<String, FeedPlatform>>,
}

#[derive(Debug, Deserialize)]
struct FeedPlatform {
    url: String,
    sha256: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
}

struct RemoteRelease {
    version: String,
    notes: Option<String>,
    url: String,
    sha256: Option<String>,
}

pub fn cleanup_previous_install() {
    let Ok((current, staged, backup, partial)) = exe_paths() else {
        return;
    };
    let _ = std::fs::remove_file(&backup);
    let _ = std::fs::remove_file(&partial);
    if let Some(parent) = current.parent() {
        let marker = parent.join("axis-update-staged.json");
        if !staged.exists() {
            let _ = std::fs::remove_file(marker);
        }
    }
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateCheck, String> {
    let current_version = app_version(&app);
    if !updater_enabled() {
        return Ok(UpdateCheck {
            current_version,
            available: false,
            downloaded: false,
            version: None,
            notes: None,
        });
    }

    let remote = match fetch_remote_release().await {
        Ok(Some(remote)) => remote,
        Ok(None) | Err(_) => {
            return Ok(UpdateCheck {
                current_version,
                available: false,
                downloaded: false,
                version: None,
                notes: None,
            });
        }
    };

    if !is_newer(&remote.version, &current_version) {
        let _ = clear_staged();
        *state.updater.pending.lock().await = None;
        return Ok(UpdateCheck {
            current_version,
            available: false,
            downloaded: false,
            version: Some(remote.version),
            notes: remote.notes,
        });
    }

    let downloaded = staged_matches(&remote.version);
    *state.updater.pending.lock().await = Some(PendingUpdate {
        version: remote.version.clone(),
        notes: remote.notes.clone(),
        url: remote.url,
        sha256: remote.sha256,
    });

    Ok(UpdateCheck {
        current_version,
        available: true,
        downloaded,
        version: Some(remote.version),
        notes: remote.notes,
    })
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateCheck, String> {
    if !updater_enabled() {
        return Err("Updates are disabled in this build.".into());
    }

    let pending = state
        .updater
        .pending
        .lock()
        .await
        .clone()
        .ok_or_else(|| "No update is ready to download. Check for updates first.".to_string())?;

    let (_, staged, _, partial) = exe_paths()?;
    assert_https_url(&pending.url)?;

    if staged_matches(&pending.version) {
        return Ok(UpdateCheck {
            current_version: app_version(&app),
            available: true,
            downloaded: true,
            version: Some(pending.version),
            notes: pending.notes,
        });
    }

    let _ = std::fs::remove_file(&staged);
    let _ = std::fs::remove_file(&partial);

    let client = http_client()?;
    let response = client
        .get(&pending.url)
        .send()
        .await
        .map_err(|error| format!("Could not start the download: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Update download failed ({})",
            response.status()
        ));
    }

    let total = response.content_length();
    let parent = partial
        .parent()
        .ok_or_else(|| "Could not resolve the Axis folder.".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let mut file = tokio::fs::File::create(&partial)
        .await
        .map_err(|error| format!("Could not write the update file: {error}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let mut last_emit = 0u64;
    emit_progress(&app, downloaded, total);

    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Download interrupted: {error}"))?
    {
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Could not write the update file: {error}"))?;
        downloaded += chunk.len() as u64;
        if downloaded.saturating_sub(last_emit) >= 256 * 1024 {
            emit_progress(&app, downloaded, total);
            last_emit = downloaded;
        }
    }
    file.flush()
        .await
        .map_err(|error| format!("Could not finish writing the update: {error}"))?;
    drop(file);
    emit_progress(&app, downloaded, total);

    let digest = hasher.finalize();
    if let Some(expected) = pending.sha256.as_deref() {
        let actual = sha256_hex(&digest);
        let expected = normalize_sha256(expected);
        if actual != expected {
            let _ = std::fs::remove_file(&partial);
            return Err("The downloaded update failed its checksum check.".into());
        }
    }

    let header = read_mz_header(&partial)?;
    if header != *b"MZ" {
        let _ = std::fs::remove_file(&partial);
        return Err("The downloaded file is not a Windows executable.".into());
    }

    std::fs::rename(&partial, &staged)
        .map_err(|error| format!("Could not stage the update: {error}"))?;
    write_staged_marker(&pending.version)?;

    Ok(UpdateCheck {
        current_version: app_version(&app),
        available: true,
        downloaded: true,
        version: Some(pending.version),
        notes: pending.notes,
    })
}

#[tauri::command]
pub async fn apply_update_and_relaunch() -> Result<(), String> {
    if !updater_enabled() {
        return Err("Updates are disabled in this build.".into());
    }

    let (current, staged, backup, _) = exe_paths()?;
    if !staged.exists() {
        return Err("The update file is missing. Download it again.".into());
    }

    let mut last_error = None;
    for attempt in 0..6 {
        match swap_and_spawn(&current, &staged, &backup) {
            Ok(()) => {
                let _ = clear_staged();
                std::thread::sleep(Duration::from_millis(250));
                std::process::exit(0);
            }
            Err(error) => {
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(200 + attempt * 150));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Could not replace Axis.exe.".into()))
}

fn app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn updater_enabled() -> bool {
    match std::env::var("AXIS_UPDATER") {
        Ok(value) if value == "0" || value.eq_ignore_ascii_case("false") => false,
        Ok(value) if value == "1" || value.eq_ignore_ascii_case("true") => true,
        _ => !cfg!(debug_assertions),
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Axis")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| error.to_string())
}

async fn fetch_remote_release() -> Result<Option<RemoteRelease>, String> {
    if let Ok(url) = env_nonempty("AXIS_UPDATE_FEED_URL") {
        return fetch_feed_file(&url).await;
    }
    fetch_github_latest().await
}

async fn fetch_feed_file(url: &str) -> Result<Option<RemoteRelease>, String> {
    assert_https_url(url)?;
    let response = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("Update feed returned {}", response.status()));
    }
    let feed: FeedFile = response.json().await.map_err(|error| error.to_string())?;
    Ok(release_from_feed(feed))
}

async fn fetch_github_latest() -> Result<Option<RemoteRelease>, String> {
    let repo = env_nonempty("AXIS_UPDATE_GITHUB_REPO")
        .unwrap_or_else(|_| DEFAULT_GITHUB_REPO.to_string());
    let (owner, name) = repo
        .split_once('/')
        .ok_or_else(|| "AXIS_UPDATE_GITHUB_REPO must be owner/repo.".to_string())?;
    let url = format!("https://api.github.com/repos/{owner}/{name}/releases/latest");
    let request = http_client()?
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    let response = request.send().await.map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("GitHub releases returned {}", response.status()));
    }
    let release: GithubRelease = response.json().await.map_err(|error| error.to_string())?;
    Ok(release_from_github(release))
}

fn release_from_feed(feed: FeedFile) -> Option<RemoteRelease> {
    let platform = feed
        .platforms
        .as_ref()
        .and_then(|platforms| {
            platforms
                .get("windows-x86_64")
                .or_else(|| platforms.get("windows"))
        });
    let url = platform
        .map(|item| item.url.clone())
        .or(feed.url)?;
    let sha256 = platform
        .and_then(|item| item.sha256.clone())
        .or(feed.sha256)
        .map(|value| normalize_sha256(&value));
    Some(RemoteRelease {
        version: strip_v_prefix(&feed.version).to_string(),
        notes: empty_to_none(feed.notes),
        url,
        sha256: empty_to_none(sha256),
    })
}

fn release_from_github(release: GithubRelease) -> Option<RemoteRelease> {
    let asset = pick_windows_asset(&release.assets)?;
    Some(RemoteRelease {
        version: strip_v_prefix(&release.tag_name).to_string(),
        notes: empty_to_none(release.body).or_else(|| empty_to_none(release.name)),
        url: asset.browser_download_url.clone(),
        sha256: asset.digest.as_deref().map(normalize_sha256),
    })
}

fn pick_windows_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    let exe_assets: Vec<&GithubAsset> = assets
        .iter()
        .filter(|asset| asset.name.to_ascii_lowercase().ends_with(".exe"))
        .collect();
    exe_assets
        .iter()
        .copied()
        .find(|asset| asset.name.eq_ignore_ascii_case("axis.exe"))
        .or_else(|| {
            exe_assets.iter().copied().find(|asset| {
                let name = asset.name.to_ascii_lowercase();
                name.contains("axis") && !looks_like_installer(&name)
            })
        })
        .or_else(|| {
            exe_assets
                .iter()
                .copied()
                .find(|asset| !looks_like_installer(&asset.name.to_ascii_lowercase()))
        })
}

fn looks_like_installer(name: &str) -> bool {
    name.contains("setup") || name.contains("installer") || name.contains("-setup")
}

fn is_newer(remote: &str, current: &str) -> bool {
    match (parse_version(remote), parse_version(current)) {
        (Some(remote), Some(current)) => remote > current,
        _ => false,
    }
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let trimmed = strip_v_prefix(value.trim());
    let numeric = trimmed.split('-').next().unwrap_or(trimmed);
    let mut parts = numeric.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let patch = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Some((major, minor, patch))
}

fn strip_v_prefix(value: &str) -> &str {
    value
        .strip_prefix('v')
        .or_else(|| value.strip_prefix('V'))
        .unwrap_or(value)
}

fn assert_https_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.to_ascii_lowercase().starts_with(HTTPS_PREFIX) {
        return Ok(());
    }
    if cfg!(debug_assertions)
        && (trimmed.starts_with("http://127.0.0.1") || trimmed.starts_with("http://localhost"))
    {
        return Ok(());
    }
    Err("Update downloads must use HTTPS.".into())
}

fn emit_progress(app: &AppHandle, downloaded: u64, total: Option<u64>) {
    let _ = app.emit(
        PROGRESS_EVENT,
        DownloadProgress { downloaded, total },
    );
}

fn exe_paths() -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let current = normalize_exe_path(
        std::env::current_exe().map_err(|error| format!("Could not locate Axis.exe: {error}"))?,
    );
    let name = current
        .file_name()
        .ok_or_else(|| "Could not locate Axis.exe.".to_string())?;
    let parent = current
        .parent()
        .ok_or_else(|| "Could not locate the Axis folder.".to_string())?;
    let staged = parent.join(format!("{}.new", name.to_string_lossy()));
    let backup = parent.join(format!("{}.bak", name.to_string_lossy()));
    let partial = parent.join(format!("{}.download", name.to_string_lossy()));
    Ok((current, staged, backup, partial))
}

fn normalize_exe_path(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

fn staged_matches(version: &str) -> bool {
    let Ok((_, staged, _, _)) = exe_paths() else {
        return false;
    };
    staged.exists() && read_staged_marker().as_deref() == Some(version)
}

fn staged_marker_path() -> Result<PathBuf, String> {
    let (current, _, _, _) = exe_paths()?;
    let parent = current
        .parent()
        .ok_or_else(|| "Could not locate the Axis folder.".to_string())?;
    Ok(parent.join("axis-update-staged.json"))
}

fn write_staged_marker(version: &str) -> Result<(), String> {
    let path = staged_marker_path()?;
    let body = serde_json::json!({ "version": version });
    std::fs::write(path, body.to_string()).map_err(|error| error.to_string())
}

fn read_staged_marker() -> Option<String> {
    let path = staged_marker_path().ok()?;
    let body = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&body).ok()?;
    value
        .get("version")
        .and_then(|item| item.as_str())
        .map(ToString::to_string)
}

fn clear_staged() -> Result<(), String> {
    if let Ok((_, staged, _, partial)) = exe_paths() {
        let _ = std::fs::remove_file(staged);
        let _ = std::fs::remove_file(partial);
    }
    if let Ok(marker) = staged_marker_path() {
        let _ = std::fs::remove_file(marker);
    }
    Ok(())
}

fn read_mz_header(path: &Path) -> Result<[u8; 2], String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut buf = [0u8; 2];
    file.read_exact(&mut buf)
        .map_err(|_| "The downloaded file is empty or truncated.".to_string())?;
    Ok(buf)
}

fn swap_and_spawn(current: &Path, staged: &Path, backup: &Path) -> Result<(), String> {
    if backup.exists() {
        std::fs::remove_file(backup).map_err(|error| {
            format!("Could not remove the previous backup of Axis.exe: {error}")
        })?;
    }

    std::fs::rename(current, backup).map_err(|error| {
        format!("Could not move the running Axis.exe aside ({error}). The folder must be writable.")
    })?;

    if let Err(error) = std::fs::rename(staged, current) {
        let _ = std::fs::rename(backup, current);
        return Err(format!("Could not put the new Axis.exe in place: {error}"));
    }

    spawn_replacement(current).map_err(|error| {
        format!(
            "The new Axis.exe is in place, but it could not be started ({error}). Quit Axis and open it again."
        )
    })
}

fn spawn_replacement(exe: &Path) -> Result<(), String> {
    let mut command = std::process::Command::new(exe);
    if let Some(dir) = exe.parent() {
        command.current_dir(dir);
    }
    command.stdin(std::process::Stdio::null());
    command.stdout(std::process::Stdio::null());
    command.stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
        command.creation_flags(
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB,
        );
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn env_nonempty(name: &str) -> Result<String, std::env::VarError> {
    match std::env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value.trim().to_string()),
        Ok(_) => Err(std::env::VarError::NotPresent),
        Err(error) => Err(error),
    }
}

fn empty_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_sha256(value: &str) -> String {
    value
        .trim()
        .strip_prefix("sha256:")
        .unwrap_or(value.trim())
        .to_ascii_lowercase()
}

fn sha256_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare_treats_v_prefix_and_newer_patch() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("v0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
    }

    #[test]
    fn feed_uses_windows_platform_url() {
        let feed = FeedFile {
            version: "v0.3.0".into(),
            notes: Some("fixes".into()),
            url: Some("https://example.com/fallback.exe".into()),
            sha256: None,
            platforms: Some(HashMap::from([(
                "windows-x86_64".into(),
                FeedPlatform {
                    url: "https://example.com/axis.exe".into(),
                    sha256: Some("sha256:abc".into()),
                },
            )])),
        };
        let remote = release_from_feed(feed).expect("release");
        assert_eq!(remote.version, "0.3.0");
        assert_eq!(remote.url, "https://example.com/axis.exe");
        assert_eq!(remote.sha256.as_deref(), Some("abc"));
    }

    #[test]
    fn github_prefers_axis_exe_over_installer() {
        let assets = vec![
            GithubAsset {
                name: "Axis_0.2.0_x64-setup.exe".into(),
                browser_download_url: "https://example.com/setup.exe".into(),
                digest: None,
            },
            GithubAsset {
                name: "axis.exe".into(),
                browser_download_url: "https://example.com/axis.exe".into(),
                digest: Some("sha256:deadbeef".into()),
            },
        ];
        let picked = pick_windows_asset(&assets).expect("asset");
        assert_eq!(picked.browser_download_url, "https://example.com/axis.exe");
    }

    #[test]
    fn https_guard_rejects_http() {
        assert!(assert_https_url("https://github.com/x").is_ok());
        assert!(assert_https_url("http://evil.example/axis.exe").is_err());
    }
}
