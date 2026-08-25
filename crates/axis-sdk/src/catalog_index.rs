use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::graph::{GraphClient, GraphError};
use crate::settings_catalog::{
    is_synthetic_top_level_group_id, map_setting_summary,
    settings_catalog_settings_applicability_graph_filter, CatalogCategory, CatalogSettingSummary,
    CategorySettingsLoad, SettingsCatalogPlatform,
};

/// Bump when indexed rows or accept-rules change (v3 unwraps Apple wrappers via `dependedOnBy` / root id).
pub const CATALOG_INDEX_CACHE_VERSION: &str = "v3";
pub const CATALOG_INDEX_TTL_MS: u64 = 24 * 60 * 60 * 1000;
pub const CATALOG_INDEX_SUSPICIOUSLY_SMALL: usize = 500;

const SELECT: &str =
    "$select=id,displayName,name,description,helpText,categoryId,keywords,applicability,visibility,rootDefinitionId";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 20_000;
const PAGE_DELAY_MS: u64 = 200;
const PERSIST_EVERY_PAGES: usize = 25;

const AREA_LABELS: &[(&str, &str)] = &[
    ("bitlocker", "BitLocker"),
    ("defender", "Microsoft Defender"),
    ("firewall", "Firewall"),
    ("passport", "Windows Hello for Business"),
    ("policy", "Administrative Templates"),
    ("wifi", "Wi-Fi"),
    ("wirednetwork", "Wired network"),
    ("windowsai", "Windows AI"),
    ("windowsupdate", "Windows Update"),
    ("audit", "Audit"),
    ("appv", "App-V"),
    ("browser", "Browser"),
    ("connectivity", "Connectivity"),
    ("cryptographyservices", "Cryptography"),
    ("deliveryoptimization", "Delivery Optimization"),
    ("dma", "DMA"),
    ("experience", "Experience"),
    ("microsoftedge", "Microsoft Edge"),
    ("office16", "Microsoft Office"),
    ("power", "Power"),
    ("privacy", "Privacy"),
    ("search", "Search"),
    ("security", "Security"),
    ("storage", "Storage"),
    ("system", "System"),
    ("timeservice", "Time service"),
    (
        "virtualizationbasedtechnology",
        "Virtualization-based security",
    ),
    ("windowsinkworkspace", "Windows Ink"),
    ("windowsdefendersecuritycenter", "Windows Security"),
    ("above", "Above lock"),
    ("cameracaptureui", "Camera"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogIndexStatus {
    Idle,
    Loading,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArea {
    pub key: String,
    pub label: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogIndexCacheEntry {
    pub saved_at: u64,
    pub expires_at: u64,
    pub platform: String,
    pub complete: bool,
    pub settings: Vec<CatalogSettingSummary>,
    pub scanned: usize,
    pub pages: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogIndexState {
    pub status: CatalogIndexStatus,
    pub platform: String,
    pub loaded: usize,
    pub scanned: usize,
    pub pages: usize,
    pub complete: bool,
    pub from_cache: bool,
    pub cached_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub error: Option<String>,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub area_count: usize,
    pub cache_path: Option<String>,
}

impl CatalogIndexState {
    pub fn idle(platform: SettingsCatalogPlatform) -> Self {
        Self {
            status: CatalogIndexStatus::Idle,
            platform: platform_key(platform).to_string(),
            loaded: 0,
            scanned: 0,
            pages: 0,
            complete: false,
            from_cache: false,
            cached_at: None,
            expires_at: None,
            error: None,
            started_at: None,
            finished_at: None,
            area_count: 0,
            cache_path: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CatalogIndexSnapshot {
    pub platform: SettingsCatalogPlatform,
    pub settings: Vec<CatalogSettingSummary>,
    pub scanned: usize,
    pub pages: usize,
    pub complete: bool,
    pub from_cache: bool,
    pub cached_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub error: Option<String>,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub status: CatalogIndexStatus,
}

impl CatalogIndexSnapshot {
    pub fn empty(platform: SettingsCatalogPlatform) -> Self {
        Self {
            platform,
            settings: Vec::new(),
            scanned: 0,
            pages: 0,
            complete: false,
            from_cache: false,
            cached_at: None,
            expires_at: None,
            error: None,
            started_at: None,
            finished_at: None,
            status: CatalogIndexStatus::Idle,
        }
    }

    pub fn to_state(&self, cache_path: Option<String>) -> CatalogIndexState {
        CatalogIndexState {
            status: self.status,
            platform: platform_key(self.platform).to_string(),
            loaded: self.settings.len(),
            scanned: self.scanned,
            pages: self.pages,
            complete: self.complete,
            from_cache: self.from_cache,
            cached_at: self.cached_at,
            expires_at: self.expires_at,
            error: self.error.clone(),
            started_at: self.started_at,
            finished_at: self.finished_at,
            area_count: rebuild_areas(&self.settings).len(),
            cache_path,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CatalogIndexProgress {
    pub settings: Vec<CatalogSettingSummary>,
    pub scanned: usize,
    pub pages: usize,
    pub persist: bool,
}

#[derive(Debug)]
pub struct CatalogIndexCrawlResult {
    pub settings: Vec<CatalogSettingSummary>,
    pub scanned: usize,
    pub pages: usize,
    pub aborted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoriesCacheEntry {
    saved_at: u64,
    expires_at: u64,
    categories: Vec<CatalogCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategorySettingsCacheEntry {
    saved_at: u64,
    expires_at: u64,
    load: CategorySettingsLoad,
}

pub fn platform_key(platform: SettingsCatalogPlatform) -> &'static str {
    match platform {
        SettingsCatalogPlatform::Macos => "macos",
        SettingsCatalogPlatform::Windows => "windows",
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn versioned_cache_dir(cache_dir: &Path) -> PathBuf {
    cache_dir.join(CATALOG_INDEX_CACHE_VERSION)
}

pub fn index_cache_path(cache_dir: &Path, platform: SettingsCatalogPlatform) -> PathBuf {
    versioned_cache_dir(cache_dir).join(format!("{}.json", platform_key(platform)))
}

fn categories_cache_path(cache_dir: &Path, platform: SettingsCatalogPlatform) -> PathBuf {
    versioned_cache_dir(cache_dir)
        .join(platform_key(platform))
        .join("categories.json")
}

fn category_settings_cache_path(
    cache_dir: &Path,
    platform: SettingsCatalogPlatform,
    category_id: &str,
) -> PathBuf {
    versioned_cache_dir(cache_dir)
        .join(platform_key(platform))
        .join("category")
        .join(format!("{category_id}.json"))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    let _ = std::fs::remove_file(path);
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn read_index_cache(
    cache_dir: &Path,
    platform: SettingsCatalogPlatform,
) -> Option<CatalogIndexCacheEntry> {
    let entry: CatalogIndexCacheEntry = read_json(&index_cache_path(cache_dir, platform))?;
    if entry.settings.is_empty() && !entry.complete {
        return None;
    }
    if now_ms() > entry.expires_at {
        let _ = std::fs::remove_file(index_cache_path(cache_dir, platform));
        return None;
    }
    Some(entry)
}

pub fn write_index_cache(
    cache_dir: &Path,
    platform: SettingsCatalogPlatform,
    settings: &[CatalogSettingSummary],
    scanned: usize,
    pages: usize,
    complete: bool,
) -> std::io::Result<CatalogIndexCacheEntry> {
    let now = now_ms();
    let entry = CatalogIndexCacheEntry {
        saved_at: now,
        expires_at: now + CATALOG_INDEX_TTL_MS,
        platform: platform_key(platform).to_string(),
        complete,
        settings: settings.to_vec(),
        scanned,
        pages,
    };
    let bytes = serde_json::to_vec(&entry)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    atomic_write(&index_cache_path(cache_dir, platform), &bytes)?;
    Ok(entry)
}

pub fn read_categories_cache(
    cache_dir: &Path,
    platform: SettingsCatalogPlatform,
) -> Option<Vec<CatalogCategory>> {
    let entry: CategoriesCacheEntry = read_json(&categories_cache_path(cache_dir, platform))?;
    if now_ms() > entry.expires_at {
        let _ = std::fs::remove_file(categories_cache_path(cache_dir, platform));
        return None;
    }
    Some(entry.categories)
}

pub fn write_categories_cache(
    cache_dir: &Path,
    platform: SettingsCatalogPlatform,
    categories: &[CatalogCategory],
) -> std::io::Result<()> {
    let now = now_ms();
    let entry = CategoriesCacheEntry {
        saved_at: now,
        expires_at: now + CATALOG_INDEX_TTL_MS,
        categories: categories.to_vec(),
    };
    let bytes = serde_json::to_vec(&entry)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    atomic_write(&categories_cache_path(cache_dir, platform), &bytes)
}

pub fn read_category_settings_cache(
    cache_dir: &Path,
    platform: SettingsCatalogPlatform,
    category_id: &str,
) -> Option<CategorySettingsLoad> {
    let entry: CategorySettingsCacheEntry = read_json(&category_settings_cache_path(
        cache_dir,
        platform,
        category_id,
    ))?;
    if now_ms() > entry.expires_at {
        let _ = std::fs::remove_file(category_settings_cache_path(
            cache_dir,
            platform,
            category_id,
        ));
        return None;
    }
    Some(entry.load)
}

pub fn write_category_settings_cache(
    cache_dir: &Path,
    platform: SettingsCatalogPlatform,
    load: &CategorySettingsLoad,
) -> std::io::Result<()> {
    let now = now_ms();
    let entry = CategorySettingsCacheEntry {
        saved_at: now,
        expires_at: now + CATALOG_INDEX_TTL_MS,
        load: load.clone(),
    };
    let bytes = serde_json::to_vec(&entry)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    atomic_write(
        &category_settings_cache_path(cache_dir, platform, &load.category_id),
        &bytes,
    )
}

pub fn setting_area_key(setting_id: &str) -> String {
    let lower = setting_id.to_ascii_lowercase();
    let parts: Vec<&str> = lower.split('_').filter(|part| !part.is_empty()).collect();
    let vendor_idx = parts
        .iter()
        .position(|part| *part == "msft" || *part == "microsoft" || *part == "google");
    if let Some(idx) = vendor_idx {
        if let Some(next) = parts.get(idx + 1) {
            return (*next).to_string();
        }
    }
    if parts.len() >= 3 {
        return parts[2].to_string();
    }
    parts.first().unwrap_or(&"other").to_string()
}

pub fn setting_area_label(area_key: &str) -> String {
    let key = area_key.to_ascii_lowercase();
    if let Some((_, label)) = AREA_LABELS.iter().find(|(candidate, _)| *candidate == key) {
        return (*label).to_string();
    }
    let mut chars = key.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => "Other".into(),
    }
}

fn rebuild_areas(settings: &[CatalogSettingSummary]) -> Vec<CatalogArea> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for setting in settings {
        *counts.entry(setting_area_key(&setting.id)).or_insert(0) += 1;
    }
    let mut areas: Vec<CatalogArea> = counts
        .into_iter()
        .map(|(key, count)| CatalogArea {
            label: setting_area_label(&key),
            key,
            count,
        })
        .collect();
    areas.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
    });
    areas
}

fn flag_tokens(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

fn setting_matches_platform(
    setting: &CatalogSettingSummary,
    platform: SettingsCatalogPlatform,
) -> bool {
    let Some(value) = setting
        .platform
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    let normalized = value.to_ascii_lowercase();
    if normalized == "none" {
        return true;
    }
    let needle = platform.graph_platforms().to_ascii_lowercase();
    normalized == needle
        || normalized
            .split(|ch: char| ch == ',' || ch.is_whitespace())
            .any(|part| part == needle)
}

fn setting_visible_in_catalog(setting: &CatalogSettingSummary) -> bool {
    let Some(visibility) = setting.visibility.as_deref() else {
        return true;
    };
    let visibility = visibility.to_ascii_lowercase();
    if visibility.is_empty() {
        return true;
    }
    visibility.contains("settingscatalog")
}

fn setting_technologies_ok(
    setting: &CatalogSettingSummary,
    platform: SettingsCatalogPlatform,
) -> bool {
    if platform != SettingsCatalogPlatform::Macos {
        return true;
    }
    let technologies = flag_tokens(setting.technologies.as_deref());
    if technologies.is_empty() {
        return true;
    }
    if technologies
        .iter()
        .any(|token| token == "appleremotemanagement")
    {
        return true;
    }
    !technologies
        .iter()
        .any(|token| token == "mobileapplicationmanagement")
}

pub fn accept_indexed_setting(
    setting: &CatalogSettingSummary,
    platform: SettingsCatalogPlatform,
) -> bool {
    if setting.id.is_empty() {
        return false;
    }
    if is_synthetic_top_level_group_id(&setting.id) {
        return false;
    }
    if !setting.is_root
        && !setting
            .root_definition_id
            .as_deref()
            .is_some_and(is_synthetic_top_level_group_id)
    {
        return false;
    }
    if !setting_matches_platform(setting, platform) {
        return false;
    }
    if !setting_visible_in_catalog(setting) {
        return false;
    }
    if !setting_technologies_ok(setting, platform) {
        return false;
    }
    true
}

pub fn sorted_settings(
    settings: impl IntoIterator<Item = CatalogSettingSummary>,
) -> Vec<CatalogSettingSummary> {
    let mut settings: Vec<_> = settings.into_iter().collect();
    settings.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    settings
}

pub fn merge_indexed_settings(
    existing: &[CatalogSettingSummary],
    incoming: impl IntoIterator<Item = CatalogSettingSummary>,
    platform: SettingsCatalogPlatform,
) -> Vec<CatalogSettingSummary> {
    let mut by_id: HashMap<String, CatalogSettingSummary> = existing
        .iter()
        .cloned()
        .map(|setting| (setting.id.clone(), setting))
        .collect();
    for setting in incoming {
        if !accept_indexed_setting(&setting, platform) {
            continue;
        }
        by_id.insert(setting.id.clone(), setting);
    }
    sorted_settings(by_id.into_values())
}

pub fn filter_indexed_settings(
    settings: &[CatalogSettingSummary],
    query: &str,
    category_id: Option<&str>,
    max_results: Option<usize>,
) -> Vec<CatalogSettingSummary> {
    let query = query.trim().to_lowercase();
    let category_id = category_id.map(str::trim).filter(|value| !value.is_empty());
    let tokens: Vec<&str> = if query.is_empty() {
        Vec::new()
    } else {
        query
            .split_whitespace()
            .filter(|token| token.len() > 1)
            .collect()
    };

    let mut matched: Vec<CatalogSettingSummary> = settings
        .iter()
        .filter(|setting| {
            if let Some(category_id) = category_id {
                if setting.category_id.as_deref() != Some(category_id) {
                    return false;
                }
            }
            if query.is_empty() {
                return true;
            }
            let keywords = setting.keywords.join(" ");
            let area = setting_area_label(&setting_area_key(&setting.id));
            let haystack = format!(
                "{} {} {} {} {}",
                setting.display_name,
                setting.description.as_deref().unwrap_or(""),
                setting.id,
                keywords,
                area
            )
            .to_lowercase();
            haystack.contains(&query)
                || (!tokens.is_empty() && tokens.iter().all(|token| haystack.contains(token)))
        })
        .cloned()
        .collect();

    if !query.is_empty() {
        matched.sort_by(|a, b| {
            let rank = |name: &str| {
                let name = name.to_lowercase();
                if name == query {
                    0
                } else if name.starts_with(&query) {
                    1
                } else if name.contains(&query) {
                    2
                } else {
                    3
                }
            };
            rank(&a.display_name)
                .cmp(&rank(&b.display_name))
                .then_with(|| {
                    a.display_name
                        .to_lowercase()
                        .cmp(&b.display_name.to_lowercase())
                })
        });
    }

    if let Some(max_results) = max_results {
        matched.truncate(max_results);
    }
    matched
}

fn build_settings_path(filter: Option<&str>, skip: usize, top: Option<usize>) -> String {
    let mut params = vec![SELECT.to_string()];
    if let Some(filter) = filter {
        params.push(format!("$filter={}", urlencoding::encode(filter)));
    }
    if let Some(top) = top {
        params.push(format!("$top={top}"));
    }
    if skip > 0 {
        params.push(format!("$skip={skip}"));
    }
    format!(
        "/deviceManagement/configurationSettings?{}",
        params.join("&")
    )
}

pub async fn crawl_catalog_index(
    access_token: &str,
    platform: SettingsCatalogPlatform,
    seed: HashMap<String, CatalogSettingSummary>,
    should_abort: impl Fn() -> bool,
    is_paused: impl Fn() -> bool,
    mut on_progress: impl FnMut(CatalogIndexProgress),
) -> Result<CatalogIndexCrawlResult, GraphError> {
    let client = GraphClient::new();
    let mut by_id = seed;
    let mut scanned = 0usize;
    let mut pages = 0usize;

    let filtered = settings_catalog_settings_applicability_graph_filter(platform);
    let mut result = crawl_pages(
        &client,
        access_token,
        platform,
        Some(filtered.as_str()),
        &mut by_id,
        &mut scanned,
        &mut pages,
        &should_abort,
        &is_paused,
        &mut on_progress,
    )
    .await?;
    if result.aborted {
        return Ok(finish(&by_id, scanned, pages, true));
    }

    if by_id.len() < CATALOG_INDEX_SUSPICIOUSLY_SMALL {
        result = crawl_pages(
            &client,
            access_token,
            platform,
            None,
            &mut by_id,
            &mut scanned,
            &mut pages,
            &should_abort,
            &is_paused,
            &mut on_progress,
        )
        .await?;
    }

    Ok(finish(&by_id, scanned, pages, result.aborted))
}

struct PageCrawl {
    aborted: bool,
}

async fn crawl_pages(
    client: &GraphClient,
    access_token: &str,
    platform: SettingsCatalogPlatform,
    filter: Option<&str>,
    by_id: &mut HashMap<String, CatalogSettingSummary>,
    scanned: &mut usize,
    pages: &mut usize,
    should_abort: &impl Fn() -> bool,
    is_paused: &impl Fn() -> bool,
    on_progress: &mut impl FnMut(CatalogIndexProgress),
) -> Result<PageCrawl, GraphError> {
    let mut skip = 0usize;
    let mut stagnant = 0usize;
    let mut previous_accepted = by_id.len();
    let mut next_path: Option<String> = Some(build_settings_path(filter, 0, None));

    while let Some(path) = next_path {
        while is_paused() {
            if should_abort() {
                return Ok(PageCrawl { aborted: true });
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        if should_abort() {
            return Ok(PageCrawl { aborted: true });
        }

        let page: crate::graph::GraphCollection<Value> = client
            .fetch_plain_collection(access_token, &path, "beta")
            .await?;
        *pages += 1;
        let batch = page.value;
        *scanned += batch.len();

        for row in &batch {
            if let Some(summary) = map_setting_summary(row) {
                if accept_indexed_setting(&summary, platform) {
                    by_id.insert(summary.id.clone(), summary);
                }
            }
        }

        let persist = *pages % PERSIST_EVERY_PAGES == 0;
        on_progress(CatalogIndexProgress {
            settings: sorted_settings(by_id.values().cloned()),
            scanned: *scanned,
            pages: *pages,
            persist,
        });

        if by_id.len() == previous_accepted {
            stagnant += 1;
        } else {
            stagnant = 0;
        }
        previous_accepted = by_id.len();

        if let Some(next_link) = page.next_link.filter(|link| !link.is_empty()) {
            next_path = Some(next_link);
            skip = 0;
        } else if batch.len() >= PAGE_SIZE / 2 && stagnant < 3 && *pages < MAX_PAGES {
            skip += batch.len();
            next_path = Some(build_settings_path(filter, skip, Some(PAGE_SIZE)));
        } else {
            next_path = None;
        }

        if next_path.is_some() {
            if *pages >= MAX_PAGES {
                next_path = None;
            } else {
                tokio::time::sleep(std::time::Duration::from_millis(PAGE_DELAY_MS)).await;
            }
        }
    }

    Ok(PageCrawl { aborted: false })
}

fn finish(
    by_id: &HashMap<String, CatalogSettingSummary>,
    scanned: usize,
    pages: usize,
    aborted: bool,
) -> CatalogIndexCrawlResult {
    CatalogIndexCrawlResult {
        settings: sorted_settings(by_id.values().cloned()),
        scanned,
        pages,
        aborted,
    }
}

pub fn snapshot_from_cache(
    platform: SettingsCatalogPlatform,
    cached: CatalogIndexCacheEntry,
) -> CatalogIndexSnapshot {
    let complete = cached.complete && cached.settings.len() >= CATALOG_INDEX_SUSPICIOUSLY_SMALL;
    CatalogIndexSnapshot {
        platform,
        settings: cached.settings,
        scanned: cached.scanned,
        pages: cached.pages,
        complete: cached.complete,
        from_cache: true,
        cached_at: Some(cached.saved_at),
        expires_at: Some(cached.expires_at),
        error: None,
        started_at: Some(cached.saved_at),
        finished_at: if cached.complete {
            Some(cached.saved_at)
        } else {
            None
        },
        status: if complete {
            CatalogIndexStatus::Ready
        } else {
            CatalogIndexStatus::Loading
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(id: &str, name: &str, root: bool, root_id: Option<&str>) -> CatalogSettingSummary {
        CatalogSettingSummary {
            id: id.into(),
            display_name: name.into(),
            description: Some("BitLocker disk encryption".into()),
            help_text: None,
            category_id: Some("bitlocker".into()),
            keywords: vec!["bitlocker".into()],
            platform: Some("windows10".into()),
            technologies: Some("mdm".into()),
            kind: "ChoiceSettingDefinition".into(),
            visibility: Some("settingsCatalog".into()),
            root_definition_id: root_id.map(str::to_string).or_else(|| Some(id.into())),
            is_root: root,
        }
    }

    #[test]
    fn drops_synthetic_wrappers_indexes_children() {
        let wrapper = summary(
            "com.apple.airplay_com.apple.airplay",
            "Top Level Setting Group Collection",
            true,
            None,
        );
        let child = CatalogSettingSummary {
            platform: Some("macOS".into()),
            technologies: Some("mdm,appleRemoteManagement".into()),
            is_root: false,
            root_definition_id: Some("com.apple.airplay_com.apple.airplay".into()),
            ..summary(
                "com.apple.airplay_allowlist",
                "Allow List",
                false,
                Some("com.apple.airplay_com.apple.airplay"),
            )
        };
        let suffixed = CatalogSettingSummary {
            platform: Some("macOS".into()),
            technologies: Some("mdm".into()),
            is_root: false,
            ..summary(
                "com.apple.mcx_loginwindow",
                "Login window",
                false,
                Some("com.apple.mcx_com.apple.mcx-accounts"),
            )
        };
        assert!(!accept_indexed_setting(
            &wrapper,
            SettingsCatalogPlatform::Macos
        ));
        assert!(accept_indexed_setting(
            &child,
            SettingsCatalogPlatform::Macos
        ));
        assert!(accept_indexed_setting(
            &suffixed,
            SettingsCatalogPlatform::Macos
        ));
    }

    #[test]
    fn drops_mam_edge_settings_on_macos() {
        let mam = CatalogSettingSummary {
            platform: Some("macOS".into()),
            technologies: Some("mdm,mobileApplicationManagement".into()),
            ..summary("edge_homepage", "Homepage", true, None)
        };
        let windows_mam = CatalogSettingSummary {
            technologies: Some("mdm,mobileApplicationManagement".into()),
            ..summary("edge_homepage", "Homepage", true, None)
        };
        assert!(!accept_indexed_setting(
            &mam,
            SettingsCatalogPlatform::Macos
        ));
        assert!(accept_indexed_setting(
            &windows_mam,
            SettingsCatalogPlatform::Windows
        ));
    }

    #[test]
    fn search_ranks_name_matches() {
        let settings = vec![
            summary(
                "device_vendor_msft_bitlocker_requiredeviceencryption",
                "Require Device Encryption",
                true,
                None,
            ),
            summary(
                "device_vendor_msft_bitlocker_allowwarningforotherdiskencryption",
                "Allow Warning For Other Disk Encryption",
                true,
                None,
            ),
        ];
        let hits = filter_indexed_settings(&settings, "require device", None, Some(10));
        assert_eq!(hits[0].display_name, "Require Device Encryption");
    }

    #[test]
    fn area_key_from_csp_id() {
        assert_eq!(
            setting_area_key("device_vendor_msft_bitlocker_requiredeviceencryption"),
            "bitlocker"
        );
        assert_eq!(setting_area_label("bitlocker"), "BitLocker");
    }
}
