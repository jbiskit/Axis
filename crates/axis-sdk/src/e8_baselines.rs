use crate::graph::GraphError;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const E8_OWNER: &str = "ASD-Blueprint";
const E8_REPO: &str = "ASD-Blueprint-for-Secure-Cloud";
const E8_PATH: &str = "static/content/files/intune-config-policies";
const E8_REF: &str = "main";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct E8BaselineSource {
    pub id: String,
    pub name: String,
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    pub path: String,
    pub repository_url: String,
    pub directory_url: String,
    pub api_url: String,
    #[serde(default)]
    pub has_token: bool,
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

const SKIP_GITHUB_DIRS: &[&str] = &[".git", ".github", ".vscode", "node_modules"];
const MAX_GITHUB_DEPTH: u8 = 4;
const MAX_GITHUB_FILES: usize = 200;
const AXIS_PACK_MANIFEST: &str = "axis-pack.json";

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

    fn scan_paths(&self) -> Vec<String> {
        let mut paths = Vec::new();
        if let Some(paths_spec) = &self.paths {
            for value in [&paths_spec.policies, &paths_spec.baselines] {
                if let Some(path) = value
                    .as_deref()
                    .map(str::trim)
                    .map(|value| value.trim_matches('/'))
                    .filter(|value| !value.is_empty())
                {
                    if !paths.iter().any(|existing| existing == path) {
                        paths.push(path.to_string());
                    }
                }
            }
        }
        paths
    }
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
        owner: E8_OWNER.into(),
        repo: E8_REPO.into(),
        git_ref: E8_REF.into(),
        path: E8_PATH.into(),
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
            owner,
            repo,
            git_ref,
            path,
            repository_url,
            directory_url,
            api_url,
            has_token: token.is_some(),
        },
        token,
    )
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
    if files.len() >= MAX_GITHUB_FILES || depth > MAX_GITHUB_DEPTH {
        return Ok(());
    }
    let items = github_list_path(client, source, path, token).await?;
    for item in items {
        if files.len() >= MAX_GITHUB_FILES {
            warnings.push(format!(
                "Stopped after {MAX_GITHUB_FILES} files. Narrow the source path if this pack is larger."
            ));
            break;
        }
        if item.item_type == "dir" {
            if SKIP_GITHUB_DIRS
                .iter()
                .any(|name| item.name.eq_ignore_ascii_case(name))
            {
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
    let pack = load_axis_pack_manifest(&client, &source, token_ref).await;
    let source_label = pack
        .as_ref()
        .and_then(AxisPackManifest::resolved_source_label)
        .unwrap_or_else(|| source.name.clone());
    if let Some(name) = pack.as_ref().and_then(AxisPackManifest::display_name) {
        source.name = name;
    }
    let scan_paths = if !source.path.is_empty() {
        vec![source.path.clone()]
    } else {
        let from_pack = pack.as_ref().map(AxisPackManifest::scan_paths).unwrap_or_default();
        if from_pack.is_empty() {
            vec![String::new()]
        } else {
            from_pack
        }
    };
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
    for path in &scan_paths {
        collect_github_files(
            &client,
            &source,
            path,
            0,
            token_ref,
            &mut files,
            &mut warnings,
        )
        .await?;
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
    use super::{github_contents_url, github_tree_url, is_baseline_source_file, parse_github_repo_url};

    #[test]
    fn accepts_policy_exports_and_skips_pack_manifest() {
        assert!(is_baseline_source_file("BitLocker.txt"));
        assert!(is_baseline_source_file("defender.json"));
        assert!(!is_baseline_source_file("axis-pack.json"));
        assert!(!is_baseline_source_file("README.md"));
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
}
