use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use axis_sdk::{
    crawl_catalog_index, filter_indexed_settings, index_cache_path, merge_indexed_settings, now_ms,
    read_categories_cache, read_category_settings_cache, read_index_cache, snapshot_from_cache,
    write_categories_cache, write_category_settings_cache, write_index_cache, CatalogCategory,
    CatalogIndexSnapshot, CatalogIndexState, CatalogIndexStatus, CatalogSearchResult,
    CatalogSettingSummary, CategorySettingsLoad, SettingsCatalogPlatform,
    CATALOG_INDEX_SUSPICIOUSLY_SMALL,
};

pub struct CatalogIndexRuntime {
    cache_dir: PathBuf,
    inner: Mutex<HashMap<String, CatalogIndexSnapshot>>,
    crawling: Mutex<Option<SettingsCatalogPlatform>>,
    generation: AtomicU64,
    paused: AtomicBool,
}

impl CatalogIndexRuntime {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        Self {
            cache_dir,
            inner: Mutex::new(HashMap::new()),
            crawling: Mutex::new(None),
            generation: AtomicU64::new(0),
            paused: AtomicBool::new(false),
        }
    }

    fn key(platform: SettingsCatalogPlatform) -> &'static str {
        match platform {
            SettingsCatalogPlatform::Macos => "macos",
            SettingsCatalogPlatform::Windows => "windows",
        }
    }

    pub fn cache_path(&self, platform: SettingsCatalogPlatform) -> String {
        index_cache_path(&self.cache_dir, platform)
            .to_string_lossy()
            .into_owned()
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
    }

    pub fn status(&self, platform: SettingsCatalogPlatform) -> CatalogIndexState {
        let mut guard = self.inner.lock().expect("catalog index mutex");
        self.hydrate_locked(&mut guard, platform)
            .to_state(Some(self.cache_path(platform)))
    }

    fn hydrate_locked(
        &self,
        guard: &mut HashMap<String, CatalogIndexSnapshot>,
        platform: SettingsCatalogPlatform,
    ) -> CatalogIndexSnapshot {
        let key = Self::key(platform).to_string();
        if let Some(existing) = guard.get(&key) {
            if existing.complete
                || existing.status == CatalogIndexStatus::Loading
                || !existing.settings.is_empty()
            {
                return existing.clone();
            }
        }
        if let Some(cached) = read_index_cache(&self.cache_dir, platform) {
            let snapshot = snapshot_from_cache(platform, cached);
            guard.insert(key, snapshot.clone());
            return snapshot;
        }
        guard
            .entry(key)
            .or_insert_with(|| CatalogIndexSnapshot::empty(platform))
            .clone()
    }

    pub fn ensure(
        self: &Arc<Self>,
        platform: SettingsCatalogPlatform,
        access_token: String,
        force: bool,
    ) {
        self.resume();
        {
            let mut guard = self.inner.lock().expect("catalog index mutex");
            let snapshot = self.hydrate_locked(&mut guard, platform);
            if !force
                && snapshot.complete
                && snapshot.settings.len() >= CATALOG_INDEX_SUSPICIOUSLY_SMALL
                && snapshot.status == CatalogIndexStatus::Ready
            {
                return;
            }
        }
        {
            let crawling = self.crawling.lock().expect("catalog crawl mutex");
            if !force && *crawling == Some(platform) {
                return;
            }
        }

        {
            let mut guard = self.inner.lock().expect("catalog index mutex");
            let mut next = self.hydrate_locked(&mut guard, platform);
            next.status = CatalogIndexStatus::Loading;
            next.complete = false;
            next.started_at = Some(next.started_at.unwrap_or_else(now_ms));
            next.finished_at = None;
            next.error = None;
            guard.insert(Self::key(platform).to_string(), next);
        }

        *self.crawling.lock().expect("catalog crawl mutex") = Some(platform);
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let runtime = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            runtime.run_crawl(platform, access_token, generation).await;
        });
    }

    fn publish_progress(
        &self,
        platform: SettingsCatalogPlatform,
        settings: Vec<CatalogSettingSummary>,
        scanned: usize,
        pages: usize,
        persist: bool,
    ) {
        if persist {
            let _ = write_index_cache(&self.cache_dir, platform, &settings, scanned, pages, false);
        }
        let mut guard = self.inner.lock().expect("catalog index mutex");
        if let Some(snapshot) = guard.get_mut(Self::key(platform)) {
            snapshot.settings = settings;
            snapshot.scanned = scanned;
            snapshot.pages = pages;
            snapshot.status = CatalogIndexStatus::Loading;
            snapshot.complete = false;
            snapshot.from_cache = false;
            snapshot.error = None;
        }
    }

    async fn run_crawl(
        &self,
        platform: SettingsCatalogPlatform,
        access_token: String,
        generation: u64,
    ) {
        let seed = {
            let mut guard = self.inner.lock().expect("catalog index mutex");
            self.hydrate_locked(&mut guard, platform)
                .settings
                .into_iter()
                .map(|setting| (setting.id.clone(), setting))
                .collect()
        };

        let result = crawl_catalog_index(
            &access_token,
            platform,
            seed,
            || self.generation.load(Ordering::SeqCst) != generation,
            || self.paused.load(Ordering::SeqCst),
            |progress| {
                self.publish_progress(
                    platform,
                    progress.settings,
                    progress.scanned,
                    progress.pages,
                    progress.persist,
                );
            },
        )
        .await;

        {
            let mut crawling = self.crawling.lock().expect("catalog crawl mutex");
            if *crawling == Some(platform) {
                *crawling = None;
            }
        }

        if self.generation.load(Ordering::SeqCst) != generation {
            return;
        }

        let mut guard = self.inner.lock().expect("catalog index mutex");
        match result {
            Ok(outcome) => {
                if outcome.aborted {
                    let _ = write_index_cache(
                        &self.cache_dir,
                        platform,
                        &outcome.settings,
                        outcome.scanned,
                        outcome.pages,
                        false,
                    );
                    if let Some(snapshot) = guard.get_mut(Self::key(platform)) {
                        snapshot.settings = outcome.settings;
                        snapshot.scanned = outcome.scanned;
                        snapshot.pages = outcome.pages;
                        snapshot.complete = false;
                    }
                    return;
                }
                let cached = write_index_cache(
                    &self.cache_dir,
                    platform,
                    &outcome.settings,
                    outcome.scanned,
                    outcome.pages,
                    true,
                )
                .ok();
                let started_at = guard
                    .get(Self::key(platform))
                    .and_then(|snapshot| snapshot.started_at)
                    .or_else(|| Some(now_ms()));
                guard.insert(
                    Self::key(platform).to_string(),
                    CatalogIndexSnapshot {
                        platform,
                        settings: outcome.settings.clone(),
                        scanned: outcome.scanned,
                        pages: outcome.pages,
                        complete: true,
                        from_cache: false,
                        cached_at: cached.as_ref().map(|entry| entry.saved_at),
                        expires_at: cached.as_ref().map(|entry| entry.expires_at),
                        error: if outcome.settings.len() < CATALOG_INDEX_SUSPICIOUSLY_SMALL {
                            Some(format!(
                                "Index finished with only {} settings — Graph paging may still be limited in this tenant.",
                                outcome.settings.len()
                            ))
                        } else {
                            None
                        },
                        started_at,
                        finished_at: Some(now_ms()),
                        status: CatalogIndexStatus::Ready,
                    },
                );
            }
            Err(error) => {
                if let Some(snapshot) = guard.get_mut(Self::key(platform)) {
                    snapshot.status = if snapshot.settings.is_empty() {
                        CatalogIndexStatus::Error
                    } else {
                        CatalogIndexStatus::Ready
                    };
                    snapshot.complete = false;
                    snapshot.finished_at = Some(now_ms());
                    snapshot.error = Some(error.to_string());
                }
            }
        }
    }

    pub fn search(
        &self,
        platform: SettingsCatalogPlatform,
        query: &str,
        max_results: usize,
    ) -> (CatalogSearchResult, CatalogIndexState) {
        let mut guard = self.inner.lock().expect("catalog index mutex");
        let snapshot = self.hydrate_locked(&mut guard, platform);
        let settings = filter_indexed_settings(&snapshot.settings, query, None, Some(max_results));
        let mode = if snapshot.complete {
            "index"
        } else if snapshot.settings.is_empty() {
            "indexing"
        } else {
            "index-partial"
        };
        (
            CatalogSearchResult {
                settings,
                mode: mode.into(),
            },
            snapshot.to_state(Some(self.cache_path(platform))),
        )
    }

    pub fn merge_settings(
        &self,
        platform: SettingsCatalogPlatform,
        incoming: impl IntoIterator<Item = CatalogSettingSummary>,
    ) {
        let mut guard = self.inner.lock().expect("catalog index mutex");
        let mut snapshot = self.hydrate_locked(&mut guard, platform);
        snapshot.settings = merge_indexed_settings(&snapshot.settings, incoming, platform);
        if snapshot.status == CatalogIndexStatus::Error && !snapshot.settings.is_empty() {
            snapshot.error = None;
        }
        guard.insert(Self::key(platform).to_string(), snapshot);
    }

    pub fn cached_categories(
        &self,
        platform: SettingsCatalogPlatform,
    ) -> Option<Vec<CatalogCategory>> {
        read_categories_cache(&self.cache_dir, platform)
    }

    pub fn store_categories(
        &self,
        platform: SettingsCatalogPlatform,
        categories: &[CatalogCategory],
    ) {
        let _ = write_categories_cache(&self.cache_dir, platform, categories);
    }

    pub fn cached_category_settings(
        &self,
        platform: SettingsCatalogPlatform,
        category_id: &str,
    ) -> Option<CategorySettingsLoad> {
        read_category_settings_cache(&self.cache_dir, platform, category_id)
    }

    pub fn store_category_settings(
        &self,
        platform: SettingsCatalogPlatform,
        load: &CategorySettingsLoad,
    ) {
        let _ = write_category_settings_cache(&self.cache_dir, platform, load);
        let incoming = load.by_id.values().map(|detail| detail.summary.clone());
        self.merge_settings(platform, incoming);
    }
}
