use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const GRAPH_BASE: &str = "https://graph.microsoft.com";

#[derive(Debug, Error)]
pub enum GraphError {
    #[error("HTTP {status}: {message}")]
    Request {
        status: u16,
        code: Option<String>,
        message: String,
        permission_related: bool,
    },
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl GraphError {
    pub fn permission_related(&self) -> bool {
        matches!(
            self,
            GraphError::Request {
                permission_related: true,
                ..
            }
        )
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            GraphError::Request { status, .. } => Some(*status),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct GraphCollection<T> {
    pub value: Vec<T>,
    #[serde(default)]
    #[allow(dead_code)]
    #[serde(rename = "@odata.count")]
    pub odata_count: Option<u32>,
    #[serde(default)]
    #[serde(rename = "@odata.nextLink")]
    pub next_link: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphErrorBody {
    error: GraphErrorDetail,
}

#[derive(Debug, Deserialize)]
struct GraphErrorDetail {
    code: Option<String>,
    message: Option<String>,
}

pub struct GraphClient {
    http: reqwest::Client,
}

impl Default for GraphClient {
    fn default() -> Self {
        Self {
            http: reqwest::Client::new(),
        }
    }
}

impl GraphClient {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn fetch<T: DeserializeOwned>(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
    ) -> Result<T, GraphError> {
        self.request(Method::GET, access_token, path, version, None, true)
            .await
    }

    /// GET without `ConsistencyLevel: eventual` — Intune catalog APIs reject it.
    pub async fn fetch_plain<T: DeserializeOwned>(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
    ) -> Result<T, GraphError> {
        self.request(Method::GET, access_token, path, version, None, false)
            .await
    }

    pub async fn post<T: DeserializeOwned>(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
        body: &impl Serialize,
    ) -> Result<T, GraphError> {
        let payload = serde_json::to_value(body)?;
        self.request(
            Method::POST,
            access_token,
            path,
            version,
            Some(payload),
            false,
        )
        .await
    }

    pub async fn put_empty(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
        body: &impl Serialize,
    ) -> Result<(), GraphError> {
        let payload = serde_json::to_value(body)?;
        let url = format!("{GRAPH_BASE}/{version}{path}");
        let response = self
            .http
            .put(url)
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        Err(graph_error_from_response(
            status,
            response.json().await.unwrap_or_default(),
        ))
    }

    /// PATCH that treats 2xx (including empty 204) as success.
    pub async fn patch_no_content(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
        body: &impl Serialize,
    ) -> Result<(), GraphError> {
        let payload = serde_json::to_value(body)?;
        let url = format!("{GRAPH_BASE}/{version}{path}");
        let response = self
            .http
            .patch(url)
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        Err(graph_error_from_response(
            status,
            response.json().await.unwrap_or_default(),
        ))
    }

    /// POST that treats 2xx (including empty 204) as success.
    pub async fn post_no_content(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
        body: &impl Serialize,
    ) -> Result<(), GraphError> {
        let payload = serde_json::to_value(body)?;
        let url = format!("{GRAPH_BASE}/{version}{path}");
        let response = self
            .http
            .post(url)
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        Err(graph_error_from_response(
            status,
            response.json().await.unwrap_or_default(),
        ))
    }

    pub async fn delete(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
    ) -> Result<(), GraphError> {
        let url = format!("{GRAPH_BASE}/{version}{path}");
        let response = self
            .http
            .delete(url)
            .bearer_auth(access_token)
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        Err(graph_error_from_response(
            status,
            response.json().await.unwrap_or_default(),
        ))
    }

    /// GET with extra headers and no ConsistencyLevel (BitLocker / LAPS).
    pub async fn fetch_with_headers<T: DeserializeOwned>(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
        headers: &[(&str, &str)],
    ) -> Result<T, GraphError> {
        let url = format!("{GRAPH_BASE}/{version}{path}");
        let mut request = self.http.get(url).bearer_auth(access_token);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let response = request.send().await?;
        let status = response.status();
        if status.is_success() {
            return Ok(response.json().await?);
        }
        Err(graph_error_from_response(
            status,
            response.json().await.unwrap_or_default(),
        ))
    }

    /// POST Intune report endpoints with portal-like Accept headers.
    pub async fn post_intune_report<T: DeserializeOwned>(
        &self,
        access_token: &str,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, GraphError> {
        let payload = serde_json::to_value(body)?;
        let url = format!("{GRAPH_BASE}/beta{path}");
        let response = self
            .http
            .post(url)
            .bearer_auth(access_token)
            .header("Accept", "*/*")
            .header("Accept-Language", "en")
            .header("x-ms-effective-locale", "en.en-us")
            .json(&payload)
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            let text = response.text().await?;
            if text.trim().is_empty() {
                return serde_json::from_str("{}").map_err(GraphError::from);
            }
            return Ok(serde_json::from_str(&text)?);
        }
        Err(graph_error_from_response(
            status,
            response.json().await.unwrap_or_default(),
        ))
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        access_token: &str,
        path: &str,
        version: &str,
        body: Option<serde_json::Value>,
        consistency_level: bool,
    ) -> Result<T, GraphError> {
        let url = format!("{GRAPH_BASE}/{version}{path}");
        let mut request = self.http.request(method, url).bearer_auth(access_token);
        if consistency_level {
            request = request.header("ConsistencyLevel", "eventual");
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await?;
        let status = response.status();
        if status.is_success() {
            return Ok(response.json().await?);
        }
        Err(graph_error_from_response(
            status,
            response.json().await.unwrap_or_default(),
        ))
    }

    /// Count a Graph collection. Prefer `@odata.count` when the resource allows
    /// it. Several Intune beta APIs reject `$count` (and `$top=0`) — skip those
    /// and page `$select=id&$top=100` with `ConsistencyLevel: eventual`, matching
    /// Next.js `graphCount`.
    pub async fn count(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
    ) -> Result<u32, GraphError> {
        if !rejects_odata_count(path) {
            let count_path = append_query(path, "$count=true&$top=1");
            match self
                .fetch::<GraphCollection<serde_json::Value>>(access_token, &count_path, version)
                .await
            {
                Ok(json) => {
                    if let Some(count) = json.odata_count {
                        return Ok(count);
                    }
                }
                Err(error)
                    if matches!(
                        error,
                        GraphError::Request {
                            permission_related: true,
                            ..
                        }
                    ) =>
                {
                    return Err(error);
                }
                Err(_) => {}
            }
        }

        match self
            .count_by_paging(access_token, path, version, true)
            .await
        {
            Ok(total) => Ok(total),
            Err(error)
                if matches!(
                    error,
                    GraphError::Request {
                        permission_related: true,
                        ..
                    }
                ) =>
            {
                Err(error)
            }
            Err(_) => {
                self.count_by_paging(access_token, path, version, false)
                    .await
            }
        }
    }

    async fn count_by_paging(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
        select_id: bool,
    ) -> Result<u32, GraphError> {
        let query = if select_id {
            "$select=id&$top=100"
        } else {
            "$top=100"
        };
        let mut url = format!("{GRAPH_BASE}/{version}{}", append_query(path, query));
        let mut total = 0u32;

        while !url.is_empty() {
            let mut request = self.http.get(&url).bearer_auth(access_token);
            request = request.header("ConsistencyLevel", "eventual");
            let response = request.send().await?;

            let status = response.status();
            if !status.is_success() {
                let status_code = status.as_u16();
                let body: serde_json::Value = response.json().await.unwrap_or_default();
                let detail = serde_json::from_value::<GraphErrorBody>(body.clone()).ok();
                let code = detail.as_ref().and_then(|value| value.error.code.clone());
                let message = detail
                    .as_ref()
                    .and_then(|value| value.error.message.clone())
                    .unwrap_or_else(|| body.to_string());
                let permission_related = is_permission_error(status, code.as_deref(), &message);
                return Err(GraphError::Request {
                    status: status_code,
                    code,
                    message,
                    permission_related,
                });
            }

            let page: GraphCollection<serde_json::Value> = response.json().await?;
            total = total.saturating_add(page.value.len() as u32);
            url = page.next_link.unwrap_or_default();
        }

        Ok(total)
    }

    /// GET a single collection page without `ConsistencyLevel` (Intune catalog).
    /// `path_or_url` may be a Graph-relative path or a full `@odata.nextLink`.
    pub async fn fetch_plain_collection<T: DeserializeOwned>(
        &self,
        access_token: &str,
        path_or_url: &str,
        version: &str,
    ) -> Result<GraphCollection<T>, GraphError> {
        let url = if path_or_url.starts_with("https://") || path_or_url.starts_with("http://") {
            path_or_url.to_string()
        } else {
            format!("{GRAPH_BASE}/{version}{path_or_url}")
        };
        let response = self.http.get(&url).bearer_auth(access_token).send().await?;
        let status = response.status();
        if status.is_success() {
            return Ok(response.json().await?);
        }
        Err(graph_error_from_response(
            status,
            response.json().await.unwrap_or_default(),
        ))
    }

    pub async fn fetch_all_pages<T: DeserializeOwned + Send + 'static>(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
        max_items: usize,
    ) -> Result<Vec<T>, GraphError> {
        let mut url = format!("{GRAPH_BASE}/{version}{path}");
        let mut items = Vec::new();

        while !url.is_empty() && items.len() < max_items {
            let response = self.http.get(&url).bearer_auth(access_token).send().await?;

            let status = response.status();
            if !status.is_success() {
                let status_code = status.as_u16();
                let body: serde_json::Value = response.json().await.unwrap_or_default();
                let detail = serde_json::from_value::<GraphErrorBody>(body.clone()).ok();
                let code = detail.as_ref().and_then(|value| value.error.code.clone());
                let message = detail
                    .as_ref()
                    .and_then(|value| value.error.message.clone())
                    .unwrap_or_else(|| body.to_string());
                let permission_related = is_permission_error(status, code.as_deref(), &message);
                return Err(GraphError::Request {
                    status: status_code,
                    code,
                    message,
                    permission_related,
                });
            }

            let page: GraphCollection<T> = response.json().await?;
            items.extend(page.value);
            url = page.next_link.unwrap_or_default();
        }

        if items.len() > max_items {
            items.truncate(max_items);
        }
        Ok(items)
    }
}

fn graph_error_from_response(status: StatusCode, body: serde_json::Value) -> GraphError {
    let detail = serde_json::from_value::<GraphErrorBody>(body.clone()).ok();
    let code = detail.as_ref().and_then(|value| value.error.code.clone());
    let message = detail
        .as_ref()
        .and_then(|value| value.error.message.clone())
        .unwrap_or_else(|| body.to_string());
    let permission_related = is_permission_error(status, code.as_deref(), &message);
    GraphError::Request {
        status: status.as_u16(),
        code,
        message,
        permission_related,
    }
}

fn append_query(path: &str, query: &str) -> String {
    if path.contains('?') {
        format!("{path}&{query}")
    } else {
        format!("{path}?{query}")
    }
}

/// Intune beta collections that 400 on `$count` (Graph or the Intune proxy).
fn rejects_odata_count(path: &str) -> bool {
    const PATHS: &[&str] = &[
        "/deviceManagement/compliancePolicies",
        "/deviceManagement/configurationPolicies",
        "/deviceManagement/windowsFeatureUpdateProfiles",
        "/deviceManagement/windowsQualityUpdateProfiles",
        "/deviceManagement/assignmentFilters",
    ];
    let resource = path.split('?').next().unwrap_or(path);
    PATHS.contains(&resource)
}

fn is_permission_error(status: StatusCode, code: Option<&str>, message: &str) -> bool {
    if status == StatusCode::FORBIDDEN {
        return true;
    }
    let haystack = format!("{} {}", code.unwrap_or_default(), message).to_lowercase();
    haystack.contains("authorization")
        || haystack.contains("access denied")
        || haystack.contains("insufficient")
        || haystack.contains("permission")
}

pub fn format_graph_error(prefix: &str, error: &GraphError) -> (String, bool) {
    match error {
        GraphError::Request {
            status,
            code,
            message,
            permission_related,
        } => (
            format!(
                "{prefix}: HTTP {status}{}{}",
                code.as_ref()
                    .map(|value| format!(" {value}"))
                    .unwrap_or_default(),
                if message.is_empty() {
                    String::new()
                } else {
                    format!(" — {message}")
                }
            ),
            *permission_related,
        ),
        GraphError::Http(err) => (format!("{prefix}: {err}"), false),
        GraphError::Json(err) => (format!("{prefix}: {err}"), false),
    }
}
