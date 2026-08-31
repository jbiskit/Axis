use crate::graph::GraphError;
use chrono::{DateTime, Utc};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const E8_OWNER: &str = "ASD-Blueprint";
const E8_REPO: &str = "ASD-Blueprint-for-Secure-Cloud";
const E8_PATH: &str = "static/content/files/intune-config-policies";
const E8_REF: &str = "main";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct E8BaselineSource {
    pub id: String,
    pub name: String,
    /// `github` or `local`.
    #[serde(default = "default_source_kind")]
    pub kind: String,
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    pub path: String,
    #[serde(default)]
    pub local_path: String,
    pub repository_url: String,
    pub directory_url: String,
    pub api_url: String,
    #[serde(default)]
    pub has_token: bool,
}

fn default_source_kind() -> String {
    "github".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct E8BaselineReference {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub last_modified_date_time: Option<String>,
    pub repository_last_modified_date_time: Option<String>,
    pub policy_exported_date_time: Option<String>,
    pub source: String,
    pub source_url: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct E8BaselineReferencesLoad {
    pub source: E8BaselineSource,
    pub references: Vec<E8BaselineReference>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineReferenceSourceInput {
    pub id: Option<String>,
    pub name: Option<String>,
    /// `github` (default) or `local`.
    #[serde(default)]
    pub kind: String,
    /// Absolute folder on this machine. Used when `kind` is `local`.
    #[serde(default)]
    pub local_path: String,
    /// GitHub repo URL or `owner/repo`. Parsed when owner/repo are empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub git_ref: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub private: bool,
    /// Optional GitHub PAT. Used for private repos and higher rate limits.
    /// Never returned in listing payloads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineReferenceSourceLoad {
    pub source: E8BaselineSource,
    pub references: Vec<E8BaselineReference>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineReferenceSourcesLoad {
    pub sources: Vec<BaselineReferenceSourceLoad>,
}

#[derive(Debug, Deserialize)]
struct GitHubContentItem {
    name: String,
    #[serde(default)]
    path: String,
    #[serde(rename = "type")]
    item_type: String,
    download_url: Option<String>,
    html_url: Option<String>,
    sha: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubCommitItem {
    commit: GitHubCommit,
}

#[derive(Debug, Deserialize)]
struct GitHubCommit {
    author: Option<GitHubCommitAuthor>,
    committer: Option<GitHubCommitAuthor>,
}

#[derive(Debug, Deserialize)]
struct GitHubCommitAuthor {
    date: Option<String>,
}

const SKIP_PACK_DIRS: &[&str] = &[".git", ".github", ".vscode", "node_modules", "baselines"];
const MAX_PACK_DEPTH: u8 = 4;
const MAX_PACK_FILES: usize = 200;
const AXIS_PACK_MANIFEST: &str = "axis-pack.json";
const DEFAULT_POLICIES_DIR: &str = "policies";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct AxisPackManifest {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    source_label: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    paths: Option<AxisPackPaths>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AxisPackPaths {
    #[serde(default)]
    policies: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    baselines: Option<String>,
}

impl AxisPackManifest {
    fn display_name(&self) -> Option<String> {
        self.name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn resolved_source_label(&self) -> Option<String> {
        self.source_label
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| self.display_name())
    }

    fn policy_path(&self) -> Option<String> {
        self.paths
            .as_ref()
            .and_then(|paths| paths.policies.as_deref())
            .map(str::trim)
            .map(|value| value.trim_matches('/'))
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }
}

/// Policy folders to walk. An explicit source `path` wins (built-in E8). Otherwise a
/// pack manifest uses `paths.policies`, defaulting to `policies/`. No manifest means
/// the folder or repo root. `baselines/` is never included.
fn resolve_policy_scan_roots(configured_path: &str, pack: Option<&AxisPackManifest>) -> Vec<String> {
    let configured = configured_path.trim().trim_matches('/');
    if !configured.is_empty() {
        return vec![configured.to_string()];
    }
    if let Some(pack) = pack {
        return vec![pack
            .policy_path()
            .unwrap_or_else(|| DEFAULT_POLICIES_DIR.to_string())];
    }
    vec![String::new()]
}

fn skip_pack_dir(name: &str) -> bool {
    SKIP_PACK_DIRS
        .iter()
        .any(|skip| name.eq_ignore_ascii_case(skip))
}

fn looks_like_axis_checks_document(value: &Value) -> bool {
    value.get("checks").and_then(Value::as_array).is_some()
}

fn rfc3339_from_system_time(time: SystemTime) -> Option<String> {
    let datetime = DateTime::<Utc>::from(time);
    Some(datetime.to_rfc3339())
}

fn is_local_source_input(input: &BaselineReferenceSourceInput) -> bool {
    input.kind.trim().eq_ignore_ascii_case("local")
        || nonempty(&input.local_path).is_some()
}

/// Returns owner, repo, git_ref, path.
fn parse_github_repo_url(input: &str) -> Option<(String, String, String, String)> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.contains("://") && !trimmed.to_ascii_lowercase().contains("github.com") {
        let mut parts = trimmed.trim_end_matches(".git").split('/');
        let owner = parts.next()?.trim();
        let repo = parts.next()?.trim();
        if owner.is_empty() || repo.is_empty() || parts.next().is_some() {
            return None;
        }
        return Some((owner.to_string(), repo.to_string(), "main".into(), String::new()));
    }
    let normalized = trimmed
        .replacen("git@github.com:", "https://github.com/", 1)
        .replacen("ssh://git@github.com/", "https://github.com/", 1);
    let rest = normalized
        .strip_prefix("https://github.com/")
        .or_else(|| normalized.strip_prefix("http://github.com/"))
        .or_else(|| normalized.strip_prefix("https://www.github.com/"))
        .or_else(|| {
            normalized
                .strip_prefix("github.com/")
                .or_else(|| normalized.strip_prefix("www.github.com/"))
        })?;
    let mut segments = rest.split('/').filter(|segment| !segment.is_empty());
    let owner = segments.next()?.trim();
    let repo = segments.next()?.trim().trim_end_matches(".git");
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    let mut git_ref = "main".to_string();
    let mut path = String::new();
    if let Some(kind) = segments.next() {
        if kind == "tree" || kind == "blob" || kind == "raw" {
            if let Some(reference) = segments.next() {
                git_ref = reference.to_string();
                path = segments.collect::<Vec<_>>().join("/");
            }
        }
    }
    Some((owner.to_string(), repo.to_string(), git_ref, path))
}

fn trimmed_token(token: Option<&str>) -> Option<String> {
    token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn github_contents_url(owner: &str, repo: &str, path: &str, git_ref: &str) -> String {
    let encoded_ref = urlencoding::encode(git_ref);
    if path.is_empty() {
        format!("https://api.github.com/repos/{owner}/{repo}/contents?ref={encoded_ref}")
    } else {
        let encoded_path = path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(|segment| urlencoding::encode(segment).into_owned())
            .collect::<Vec<_>>()
            .join("/");
        format!(
            "https://api.github.com/repos/{owner}/{repo}/contents/{encoded_path}?ref={encoded_ref}"
        )
    }
}

fn github_tree_url(owner: &str, repo: &str, git_ref: &str, path: &str) -> String {
    if path.is_empty() {
        format!("https://github.com/{owner}/{repo}/tree/{git_ref}")
    } else {
        format!("https://github.com/{owner}/{repo}/tree/{git_ref}/{path}")
    }
}

pub(crate) fn apply_github_auth(
    request: reqwest::RequestBuilder,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = request
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Axis")
        .header("X-GitHub-Api-Version", "2022-11-28");
    match token {
        Some(token) if !token.is_empty() => request.bearer_auth(token),
        _ => request,
    }
}

fn github_status_message(status: StatusCode, detail: &str, private_hint: bool) -> String {
    let hint = if private_hint || status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        " If this is a private repository, add a GitHub personal access token with the repo scope."
    } else if status == StatusCode::NOT_FOUND {
        " Check owner, repository, ref, and path. Private repos also need a PAT."
    } else {
        ""
    };
    format!("GitHub API {status}: {detail}.{hint}")
}

fn default_source() -> E8BaselineSource {
    let repository_url = format!("https://github.com/{E8_OWNER}/{E8_REPO}");
    let directory_url = github_tree_url(E8_OWNER, E8_REPO, E8_REF, E8_PATH);
    let api_url = github_contents_url(E8_OWNER, E8_REPO, E8_PATH, E8_REF);
    E8BaselineSource {
        id: "e8-github".into(),
        name: "ASD E8".into(),
        kind: "github".into(),
        owner: E8_OWNER.into(),
        repo: E8_REPO.into(),
        git_ref: E8_REF.into(),
        path: E8_PATH.into(),
        local_path: String::new(),
        repository_url,
        directory_url,
        api_url,
        has_token: false,
    }
}

fn nonempty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn source_from_input(input: BaselineReferenceSourceInput) -> (E8BaselineSource, Option<String>) {
    let parsed = input.url.as_deref().and_then(parse_github_repo_url);
    let owner = nonempty(&input.owner)
        .or_else(|| parsed.as_ref().map(|value| value.0.clone()))
        .unwrap_or_default();
    let repo = nonempty(&input.repo)
        .map(|value| value.trim_end_matches(".git").to_string())
        .or_else(|| parsed.as_ref().map(|value| value.1.clone()))
        .unwrap_or_default();
    let git_ref = nonempty(&input.git_ref)
        .or_else(|| {
            parsed
                .as_ref()
                .map(|value| value.2.clone())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| "main".to_string());
    let path = nonempty(&input.path)
        .or_else(|| {
            parsed
                .as_ref()
                .map(|value| value.3.clone())
                .filter(|value| !value.is_empty())
        })
        .map(|value| value.trim_matches('/').to_string())
        .unwrap_or_default();
    let token = if input.private {
        trimmed_token(input.token.as_deref())
    } else {
        None
    };
    let repository_url = format!("https://github.com/{owner}/{repo}");
    let directory_url = github_tree_url(&owner, &repo, &git_ref, &path);
    let api_url = github_contents_url(&owner, &repo, &path, &git_ref);
    let id = input
        .id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("repo:{owner}/{repo}:{git_ref}:{path}"));
    let name = input
        .name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("{owner}/{repo}"));
    (
        E8BaselineSource {
            id,
            name,
            kind: "github".into(),
            owner,
            repo,
            git_ref,
            path,
            local_path: String::new(),
            repository_url,
            directory_url,
            api_url,
            has_token: token.is_some(),
        },
        token,
    )
}

fn local_source_from_input(input: BaselineReferenceSourceInput) -> Result<E8BaselineSource, GraphError> {
    let local_path = nonempty(&input.local_path).ok_or_else(|| GraphError::Request {
        status: 400,
        code: None,
        message: "Choose a local folder for this pack.".into(),
        permission_related: false,
    })?;
    let path = nonempty(&input.path)
        .map(|value| value.trim_matches('/').replace('\\', "/"))
        .unwrap_or_default();
    let id = input
        .id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("local:{local_path}:{path}"));
    let folder_name = Path::new(&local_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Local pack");
    let name = input
        .name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| folder_name.to_string());
    let directory_url = if path.is_empty() {
        local_path.clone()
    } else {
        Path::new(&local_path)
            .join(path.replace('/', std::path::MAIN_SEPARATOR_STR))
            .to_string_lossy()
            .into_owned()
    };
    Ok(E8BaselineSource {
        id,
        name,
        kind: "local".into(),
        owner: String::new(),
        repo: String::new(),
        git_ref: String::new(),
        path,
        local_path: local_path.clone(),
        repository_url: local_path,
        directory_url,
        api_url: String::new(),
        has_token: false,
    })
}

fn request_error(status: StatusCode, message: String) -> GraphError {
    GraphError::Request {
        status: status.as_u16(),
        code: None,
        message,
        permission_related: status == StatusCode::FORBIDDEN,
    }
}

fn is_baseline_source_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower == AXIS_PACK_MANIFEST || lower == "package.json" {
        return false;
    }
    lower.ends_with(".txt") || lower.ends_with(".json")
}

fn strip_bom(text: &str) -> &str {
    text.trim_start_matches('\u{FEFF}')
        .trim_start_matches('\u{FFFE}')
}

fn parse_policy_json(text: &str) -> Result<Value, GraphError> {
    let cleaned = strip_bom(text);
    let start = cleaned.find('{').ok_or_else(|| {
        serde_json::Error::io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "No JSON object found",
        ))
    })?;
    Ok(serde_json::from_str::<Value>(&cleaned[start..])?)
}

async fn fetch_latest_commit_date(
    client: &reqwest::Client,
    source: &E8BaselineSource,
    file_path: &str,
    token: Option<&str>,
) -> Result<Option<String>, GraphError> {
    let commits_url = format!(
        "https://api.github.com/repos/{}/{}/commits",
        source.owner, source.repo
    );
    let request = apply_github_auth(client.get(commits_url), token).query(&[
        ("path", file_path),
        ("sha", source.git_ref.as_str()),
        ("per_page", "1"),
    ]);
    let response = request.send().await?;
    if !response.status().is_success() {
        return Err(request_error(
            response.status(),
            github_status_message(
                response.status(),
                &format!("could not read commits for {file_path}"),
                source.has_token,
            ),
        ));
    }
    let commits: Vec<GitHubCommitItem> = response.json().await?;
    Ok(commits.first().and_then(|commit| {
        commit
            .commit
            .committer
            .as_ref()
            .and_then(|person| person.date.clone())
            .or_else(|| {
                commit
                    .commit
                    .author
                    .as_ref()
                    .and_then(|person| person.date.clone())
            })
    }))
}

async fn github_list_path(
    client: &reqwest::Client,
    source: &E8BaselineSource,
    path: &str,
    token: Option<&str>,
) -> Result<Vec<GitHubContentItem>, GraphError> {
    let url = github_contents_url(&source.owner, &source.repo, path, &source.git_ref);
    let response = apply_github_auth(client.get(url), token).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(request_error(
            status,
            github_status_message(status, detail.trim(), token.is_some()),
        ));
    }
    let body: Value = response.json().await?;
    if let Ok(items) = serde_json::from_value::<Vec<GitHubContentItem>>(body.clone()) {
        return Ok(items);
    }
    if let Ok(item) = serde_json::from_value::<GitHubContentItem>(body) {
        return Ok(vec![item]);
    }
    Err(request_error(
        StatusCode::BAD_REQUEST,
        "GitHub contents response was not a file listing.".into(),
    ))
}

async fn collect_github_files(
    client: &reqwest::Client,
    source: &E8BaselineSource,
    path: &str,
    depth: u8,
    token: Option<&str>,
    files: &mut Vec<GitHubContentItem>,
    warnings: &mut Vec<String>,
) -> Result<(), GraphError> {
    if files.len() >= MAX_PACK_FILES || depth > MAX_PACK_DEPTH {
        return Ok(());
    }
    let items = github_list_path(client, source, path, token).await?;
    for item in items {
        if files.len() >= MAX_PACK_FILES {
            warnings.push(format!(
                "Stopped after {MAX_PACK_FILES} files. Narrow the source path if this pack is larger."
            ));
            break;
        }
        if item.item_type == "dir" {
            if skip_pack_dir(&item.name) {
                continue;
            }
            let child_path = if item.path.trim().is_empty() {
                if path.is_empty() {
                    item.name.clone()
                } else {
                    format!("{path}/{}", item.name)
                }
            } else {
                item.path.clone()
            };
            Box::pin(collect_github_files(
                client,
                source,
                &child_path,
                depth + 1,
                token,
                files,
                warnings,
            ))
            .await?;
            continue;
        }
        if item.item_type == "file" && is_baseline_source_file(&item.name) {
            files.push(item);
        }
    }
    Ok(())
}

async fn load_axis_pack_manifest(
    client: &reqwest::Client,
    source: &E8BaselineSource,
    token: Option<&str>,
) -> Option<AxisPackManifest> {
    let items = github_list_path(client, source, AXIS_PACK_MANIFEST, token)
        .await
        .ok()?;
    let item = items.into_iter().find(|item| {
        item.item_type == "file" && item.name.eq_ignore_ascii_case(AXIS_PACK_MANIFEST)
    })?;
    let download_url = item.download_url?;
    let response = apply_github_auth(client.get(download_url), token)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().await.ok()?;
    serde_json::from_str(strip_bom(&text)).ok()
}

async fn fetch_source_references(
    mut source: E8BaselineSource,
    token: Option<String>,
) -> Result<E8BaselineReferencesLoad, GraphError> {
    let client = reqwest::Client::new();
    let token_ref = token.as_deref();
    let configured_path = source.path.clone();
    let pack = if configured_path.is_empty() {
        load_axis_pack_manifest(&client, &source, token_ref).await
    } else {
        None
    };
    let source_label = pack
        .as_ref()
        .and_then(AxisPackManifest::resolved_source_label)
        .unwrap_or_else(|| source.name.clone());
    if let Some(name) = pack.as_ref().and_then(AxisPackManifest::display_name) {
        source.name = name;
    }
    let scan_paths = resolve_policy_scan_roots(&configured_path, pack.as_ref());
    if source.path.is_empty() {
        if let Some(first) = scan_paths.first().cloned() {
            source.path = first.clone();
            source.directory_url =
                github_tree_url(&source.owner, &source.repo, &source.git_ref, &first);
            source.api_url =
                github_contents_url(&source.owner, &source.repo, &first, &source.git_ref);
        }
    }

    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let allow_missing_subdir = configured_path.is_empty();
    for path in &scan_paths {
        match collect_github_files(
            &client,
            &source,
            path,
            0,
            token_ref,
            &mut files,
            &mut warnings,
        )
        .await
        {
            Ok(()) => {}
            Err(error)
                if allow_missing_subdir && !path.is_empty() && error.status() == Some(404) =>
            {
                warnings.push(format!(
                    "Folder `{path}` was not found. Add Intune exports under that path, or set paths.policies in axis-pack.json."
                ));
            }
            Err(error) => return Err(error),
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.dedup_by(|left, right| left.path == right.path && left.name == right.name);

    let mut references = Vec::new();
    let fetch_commit_dates = files.len() <= 25;

    for item in files {
        let Some(download_url) = item.download_url.clone() else {
            warnings.push(format!("{}: missing download URL", item.name));
            continue;
        };
        let response = apply_github_auth(client.get(&download_url), token_ref)
            .send()
            .await?;
        if !response.status().is_success() {
            warnings.push(format!(
                "{}: HTTP {} while downloading",
                item.name,
                response.status().as_u16()
            ));
            continue;
        }
        let text = response.text().await?;
        let parsed = match parse_policy_json(&text) {
            Ok(value) => value,
            Err(error) => {
                warnings.push(format!("{}: {}", item.name, error));
                continue;
            }
        };
        if looks_like_axis_checks_document(&parsed) {
            continue;
        }

        let stem = item
            .name
            .trim_end_matches(".txt")
            .trim_end_matches(".json");
        let name = parsed
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| parsed.get("displayName").and_then(Value::as_str))
            .map(str::trim)
            .map(str::to_string)
            .unwrap_or_else(|| stem.to_string());
        let version = parsed
            .get("version")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                item.sha
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| format!("sha:{}", &value[..value.len().min(7)]))
            });
        let policy_exported_date_time = parsed
            .get("lastModifiedDateTime")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let file_path = if item.path.trim().is_empty() {
            if source.path.is_empty() {
                item.name.clone()
            } else {
                format!("{}/{}", source.path, item.name)
            }
        } else {
            item.path.clone()
        };
        let repository_last_modified_date_time = if fetch_commit_dates {
            match fetch_latest_commit_date(&client, &source, &file_path, token_ref).await {
                Ok(date) => date,
                Err(error) => {
                    warnings.push(format!("{}: {}", item.name, error));
                    None
                }
            }
        } else {
            None
        };
        let last_modified_date_time = repository_last_modified_date_time
            .clone()
            .or_else(|| policy_exported_date_time.clone());

        references.push(E8BaselineReference {
            id: item.sha.clone().unwrap_or_else(|| item.name.clone()),
            name,
            version,
            last_modified_date_time,
            repository_last_modified_date_time,
            policy_exported_date_time,
            source: source_label.clone(),
            source_url: item
                .html_url
                .unwrap_or_else(|| source.directory_url.clone()),
            download_url,
        });
    }

    references.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(E8BaselineReferencesLoad {
        source,
        references,
        warnings,
    })
}

struct LocalPackFile {
    name: String,
    rel_path: String,
    abs_path: PathBuf,
    modified: Option<String>,
}

fn join_pack_rel(root: &Path, rel: &str) -> PathBuf {
    if rel.is_empty() {
        return root.to_path_buf();
    }
    let mut path = root.to_path_buf();
    for segment in rel.split(['/', '\\']).filter(|segment| !segment.is_empty() && *segment != ".") {
        if segment == ".." {
            continue;
        }
        path.push(segment);
    }
    path
}

fn path_is_under(root: &Path, candidate: &Path) -> bool {
    match (fs::canonicalize(root), fs::canonicalize(candidate)) {
        (Ok(root), Ok(candidate)) => candidate.starts_with(root),
        _ => false,
    }
}

fn pack_io_error(message: impl Into<String>) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: message.into(),
        permission_related: false,
    }
}

fn collect_local_files(
    root: &Path,
    rel: &str,
    depth: u8,
    files: &mut Vec<LocalPackFile>,
    warnings: &mut Vec<String>,
) -> Result<(), GraphError> {
    if files.len() >= MAX_PACK_FILES || depth > MAX_PACK_DEPTH {
        return Ok(());
    }
    let dir = join_pack_rel(root, rel);
    if !dir.exists() {
        if rel.is_empty() {
            return Err(pack_io_error(format!(
                "Local pack folder was not found: {}",
                root.display()
            )));
        }
        warnings.push(format!(
            "Folder `{rel}` was not found. Add Intune exports under that path, or set paths.policies in axis-pack.json."
        ));
        return Ok(());
    }
    let entries = fs::read_dir(&dir).map_err(|error| {
        pack_io_error(format!("Could not read {}: {error}", dir.display()))
    })?;
    let mut listed = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            pack_io_error(format!("Could not read {}: {error}", dir.display()))
        })?;
        listed.push(entry);
    }
    listed.sort_by_key(|entry| entry.file_name());
    for entry in listed {
        if files.len() >= MAX_PACK_FILES {
            warnings.push(format!(
                "Stopped after {MAX_PACK_FILES} files. Narrow the source path if this pack is larger."
            ));
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry.file_type().map_err(|error| {
            pack_io_error(format!("Could not read {name}: {error}"))
        })?;
        let child_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        if file_type.is_dir() {
            if skip_pack_dir(&name) {
                continue;
            }
            collect_local_files(root, &child_rel, depth + 1, files, warnings)?;
            continue;
        }
        if file_type.is_file() && is_baseline_source_file(&name) {
            let abs_path = entry.path();
            if !path_is_under(root, &abs_path) {
                continue;
            }
            let modified = fs::metadata(&abs_path)
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(rfc3339_from_system_time);
            files.push(LocalPackFile {
                name,
                rel_path: child_rel.replace('\\', "/"),
                abs_path,
                modified,
            });
        }
    }
    Ok(())
}

fn load_local_pack_manifest(root: &Path) -> Option<AxisPackManifest> {
    let path = root.join(AXIS_PACK_MANIFEST);
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(strip_bom(&text)).ok()
}

fn fetch_local_source_references(
    mut source: E8BaselineSource,
) -> Result<E8BaselineReferencesLoad, GraphError> {
    let root = PathBuf::from(&source.local_path);
    if !root.is_dir() {
        return Err(pack_io_error(format!(
            "Local pack path is not a folder: {}",
            root.display()
        )));
    }
    let configured_path = source.path.clone();
    let pack = if configured_path.is_empty() {
        load_local_pack_manifest(&root)
    } else {
        None
    };
    let source_label = pack
        .as_ref()
        .and_then(AxisPackManifest::resolved_source_label)
        .unwrap_or_else(|| source.name.clone());
    if let Some(name) = pack.as_ref().and_then(AxisPackManifest::display_name) {
        source.name = name;
    }
    let scan_paths = resolve_policy_scan_roots(&configured_path, pack.as_ref());
    if source.path.is_empty() {
        if let Some(first) = scan_paths.first().cloned() {
            source.path = first.clone();
            source.directory_url = if first.is_empty() {
                source.local_path.clone()
            } else {
                join_pack_rel(&root, &first).to_string_lossy().into_owned()
            };
        }
    }

    let mut files = Vec::new();
    let mut warnings = Vec::new();
    for path in &scan_paths {
        collect_local_files(&root, path, 0, &mut files, &mut warnings)?;
    }
    files.sort_by(|left, right| left.rel_path.cmp(&right.rel_path));
    files.dedup_by(|left, right| left.rel_path == right.rel_path);

    let mut references = Vec::new();
    for item in files {
        let text = match fs::read_to_string(&item.abs_path) {
            Ok(text) => text,
            Err(error) => {
                warnings.push(format!("{}: {error}", item.name));
                continue;
            }
        };
        let parsed = match parse_policy_json(&text) {
            Ok(value) => value,
            Err(error) => {
                warnings.push(format!("{}: {}", item.name, error));
                continue;
            }
        };
        if looks_like_axis_checks_document(&parsed) {
            continue;
        }
        let stem = item
            .name
            .trim_end_matches(".txt")
            .trim_end_matches(".json");
        let name = parsed
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| parsed.get("displayName").and_then(Value::as_str))
            .map(str::trim)
            .map(str::to_string)
            .unwrap_or_else(|| stem.to_string());
        let version = parsed
            .get("version")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let policy_exported_date_time = parsed
            .get("lastModifiedDateTime")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let download_url = item.abs_path.to_string_lossy().into_owned();
        references.push(E8BaselineReference {
            id: item.rel_path.clone(),
            name,
            version,
            last_modified_date_time: item.modified.clone().or_else(|| policy_exported_date_time.clone()),
            repository_last_modified_date_time: item.modified,
            policy_exported_date_time,
            source: source_label.clone(),
            source_url: download_url.clone(),
            download_url,
        });
    }

    references.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(E8BaselineReferencesLoad {
        source,
        references,
        warnings,
    })
}

pub async fn fetch_e8_baseline_references() -> Result<E8BaselineReferencesLoad, GraphError> {
    fetch_source_references(default_source(), None).await
}

pub async fn fetch_baseline_reference_sources(
    sources: Vec<BaselineReferenceSourceInput>,
) -> BaselineReferenceSourcesLoad {
    let inputs = if sources.is_empty() {
        vec![BaselineReferenceSourceInput {
            id: Some("e8-github".into()),
            name: Some("ASD E8".into()),
            kind: "github".into(),
            local_path: String::new(),
            url: None,
            owner: E8_OWNER.into(),
            repo: E8_REPO.into(),
            git_ref: E8_REF.into(),
            path: E8_PATH.into(),
            private: false,
            token: None,
        }]
    } else {
        sources
    };

    let mut loads = Vec::with_capacity(inputs.len());
    for input in inputs {
        if is_local_source_input(&input) {
            match local_source_from_input(input) {
                Ok(source) => match fetch_local_source_references(source.clone()) {
                    Ok(result) => loads.push(BaselineReferenceSourceLoad {
                        source: result.source,
                        references: result.references,
                        warnings: result.warnings,
                        error: None,
                    }),
                    Err(error) => loads.push(BaselineReferenceSourceLoad {
                        source,
                        references: Vec::new(),
                        warnings: Vec::new(),
                        error: Some(error.to_string()),
                    }),
                },
                Err(error) => loads.push(BaselineReferenceSourceLoad {
                    source: E8BaselineSource {
                        id: "local".into(),
                        name: "Local pack".into(),
                        kind: "local".into(),
                        owner: String::new(),
                        repo: String::new(),
                        git_ref: String::new(),
                        path: String::new(),
                        local_path: String::new(),
                        repository_url: String::new(),
                        directory_url: String::new(),
                        api_url: String::new(),
                        has_token: false,
                    },
                    references: Vec::new(),
                    warnings: Vec::new(),
                    error: Some(error.to_string()),
                }),
            }
            continue;
        }
        let (source, token) = source_from_input(input);
        match fetch_source_references(source.clone(), token).await {
            Ok(result) => loads.push(BaselineReferenceSourceLoad {
                source: result.source,
                references: result.references,
                warnings: result.warnings,
                error: None,
            }),
            Err(error) => loads.push(BaselineReferenceSourceLoad {
                source,
                references: Vec::new(),
                warnings: Vec::new(),
                error: Some(error.to_string()),
            }),
        }
    }

    BaselineReferenceSourcesLoad { sources: loads }
}

#[cfg(test)]
mod tests {
    use super::{
        github_contents_url, github_tree_url, is_baseline_source_file, looks_like_axis_checks_document,
        parse_github_repo_url, resolve_policy_scan_roots, skip_pack_dir, AxisPackManifest, AxisPackPaths,
    };
    use serde_json::json;

    #[test]
    fn accepts_policy_exports_and_skips_pack_manifest() {
        assert!(is_baseline_source_file("BitLocker.txt"));
        assert!(is_baseline_source_file("defender.json"));
        assert!(!is_baseline_source_file("axis-pack.json"));
        assert!(!is_baseline_source_file("README.md"));
    }

    #[test]
    fn policy_scan_roots_honor_explicit_path_then_pack_then_root() {
        let pack = AxisPackManifest {
            id: None,
            name: Some("Contoso".into()),
            source_label: None,
            version: None,
            paths: Some(AxisPackPaths {
                policies: Some("policies".into()),
                baselines: Some("baselines".into()),
            }),
        };
        assert_eq!(
            resolve_policy_scan_roots("static/content/files/intune-config-policies", Some(&pack)),
            vec!["static/content/files/intune-config-policies".to_string()]
        );
        assert_eq!(
            resolve_policy_scan_roots("", Some(&pack)),
            vec!["policies".to_string()]
        );
        let pack_default = AxisPackManifest {
            id: None,
            name: Some("Contoso".into()),
            source_label: None,
            version: None,
            paths: None,
        };
        assert_eq!(
            resolve_policy_scan_roots("", Some(&pack_default)),
            vec!["policies".to_string()]
        );
        assert_eq!(resolve_policy_scan_roots("", None), vec![String::new()]);
    }

    #[test]
    fn skips_reserved_pack_directories_and_checks_documents() {
        assert!(skip_pack_dir("baselines"));
        assert!(skip_pack_dir(".git"));
        assert!(skip_pack_dir("node_modules"));
        assert!(!skip_pack_dir("policies"));
        assert!(looks_like_axis_checks_document(&json!({ "checks": [] })));
        assert!(!looks_like_axis_checks_document(
            &json!({ "name": "Edge", "settings": [] })
        ));
    }

    #[test]
    fn parses_github_repo_urls() {
        assert_eq!(
            parse_github_repo_url("https://github.com/acme/windows-pack"),
            Some(("acme".into(), "windows-pack".into(), "main".into(), String::new()))
        );
        assert_eq!(
            parse_github_repo_url("https://github.com/acme/windows-pack/tree/main/policies"),
            Some(("acme".into(), "windows-pack".into(), "main".into(), "policies".into()))
        );
        assert_eq!(
            parse_github_repo_url("acme/windows-pack"),
            Some(("acme".into(), "windows-pack".into(), "main".into(), String::new()))
        );
    }

    #[test]
    fn github_urls_allow_repo_root() {
        assert_eq!(
            github_contents_url("owner", "repo", "", "main"),
            "https://api.github.com/repos/owner/repo/contents?ref=main"
        );
        assert_eq!(
            github_tree_url("owner", "repo", "main", ""),
            "https://github.com/owner/repo/tree/main"
        );
        assert_eq!(
            github_contents_url("owner", "repo", "policies/win", "main"),
            "https://api.github.com/repos/owner/repo/contents/policies/win?ref=main"
        );
    }

    #[test]
    fn local_folder_scans_policies_and_skips_baselines() {
        let dir = std::env::temp_dir().join(format!(
            "axis-pack-scan-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_millis())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("policies")).unwrap();
        std::fs::create_dir_all(dir.join("baselines")).unwrap();
        std::fs::write(
            dir.join("axis-pack.json"),
            r#"{"name":"Test pack","paths":{"policies":"policies","baselines":"baselines"}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("policies").join("edge.json"),
            r#"{"name":"Edge","settings":[]}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("baselines").join("checks.json"),
            r#"{"checks":[{"id":"a"}]}"#,
        )
        .unwrap();
        let source = super::local_source_from_input(super::BaselineReferenceSourceInput {
            id: Some("t".into()),
            name: None,
            kind: "local".into(),
            local_path: dir.to_string_lossy().into_owned(),
            url: None,
            owner: String::new(),
            repo: String::new(),
            git_ref: String::new(),
            path: String::new(),
            private: false,
            token: None,
        })
        .unwrap();
        let load = super::fetch_local_source_references(source).unwrap();
        assert_eq!(load.source.name, "Test pack");
        assert_eq!(load.references.len(), 1);
        assert_eq!(load.references[0].name, "Edge");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
