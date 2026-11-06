use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::write_log;

const GRAPH_BASE: &str = "https://graph.microsoft.com";

/// Retries after the first throttled response. Graph asks clients to honour
/// `Retry-After`; without one, back off 2s, 4s, 8s … up to `MAX_BACKOFF_SECS`.
const MAX_RETRIES: u32 = 5;
const MAX_BACKOFF_SECS: u64 = 30;
/// A `Retry-After` longer than this is capped, so one request cannot hang the UI.
const MAX_RETRY_AFTER_SECS: u64 = 120;

/// Sent each time a request is throttled and is about to be retried.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThrottleNotice {
    pub status: u16,
    pub path: String,
    /// 1 for the first retry.
    pub attempt: u32,
    pub max_attempts: u32,
    pub wait_ms: u64,
}

type ThrottleListener = Box<dyn Fn(ThrottleNotice) + Send + Sync>;
static THROTTLE_LISTENER: std::sync::OnceLock<ThrottleListener> = std::sync::OnceLock::new();

/// Called with every throttle retry, so the app can show that Graph is busy.
pub fn set_throttle_listener(listener: impl Fn(ThrottleNotice) + Send + Sync + 'static) {
    let _ = THROTTLE_LISTENER.set(Box::new(listener));
}

fn is_throttled(status: StatusCode) -> bool {
    matches!(status.as_u16(), 429 | 503 | 504)
}

fn retry_wait(response: &reqwest::Response, attempt: u32) -> std::time::Duration {
    let header = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok());
    let secs = match header {
        Some(secs) => secs.clamp(1, MAX_RETRY_AFTER_SECS),
        None => (2u64 << attempt.min(4)).min(MAX_BACKOFF_SECS),
    };
    std::time::Duration::from_secs(secs)
}

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
        // reqwest sends no User-Agent by default; Information Protection label APIs expect one.
        let http = reqwest::Client::builder()
            .user_agent(concat!("Axis/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default();
        Self { http }
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

    /// POST a JSON batch (`/beta/$batch`) and return the first response body.
    ///
    /// Some Intune endpoints only accept writes through the batch pipeline —
    /// `mobileDeviceManagementPolicies` rejects a direct PATCH with
    /// "This API is not supported for AAD accounts".
    pub async fn post_batch(
        &self,
        access_token: &str,
        requests: &[Value],
    ) -> Result<Vec<Value>, GraphError> {
        let payload = json!({ "requests": requests });
        let tracked = (write_log::enabled() && write_log::batch_is_write(requests)).then_some(None);
        let result = self.post_batch_inner(access_token, requests, &payload).await;
        self.finish_write(tracked, access_token, &Method::POST, "/$batch", "beta", Some(&payload), None, result.as_ref().err())
            .await;
        result
    }

    async fn post_batch_inner(
        &self,
        access_token: &str,
        requests: &[Value],
        payload: &Value,
    ) -> Result<Vec<Value>, GraphError> {
        let response: Value = self
            .request(
                Method::POST,
                access_token,
                "/$batch",
                "beta",
                Some(payload.clone()),
                false,
            )
            .await?;
        let responses = response
            .get("responses")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for entry in &responses {
            let status = entry.get("status").and_then(Value::as_u64).unwrap_or(0);
            if !(200..300).contains(&status) {
                let body = entry.get("body").cloned().unwrap_or(Value::Null);
                let message = body
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Batch request failed with HTTP {status}."));
                return Err(GraphError::Request {
                    status: status as u16,
                    code: body
                        .get("error")
                        .and_then(|error| error.get("code"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    // Include what was sent, so a rejected value is visible
                    // without a packet capture.
                    message: format!("{message} (sent {})", requests.first().cloned().unwrap_or(Value::Null)),
                    permission_related: status == 401 || status == 403,
                });
            }
        }
        Ok(responses)
    }

    pub async fn put_empty(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
        body: &impl Serialize,
    ) -> Result<(), GraphError> {
        let payload = serde_json::to_value(body)?;
        self.write_no_content(Method::PUT, access_token, path, version, Some(payload))
            .await
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
        self.write_no_content(Method::PATCH, access_token, path, version, Some(payload))
            .await
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
        self.write_no_content(Method::POST, access_token, path, version, Some(payload))
            .await
    }

    /// POST with an empty body. Intune `renewUpload` rejects `{}`.
    pub async fn post_empty(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
    ) -> Result<(), GraphError> {
        self.write_no_content(Method::POST, access_token, path, version, None)
            .await
    }

    pub async fn delete(
        &self,
        access_token: &str,
        path: &str,
        version: &str,
    ) -> Result<(), GraphError> {
        self.write_no_content(Method::DELETE, access_token, path, version, None)
            .await
    }

    /// Send a write whose response body is ignored, and record it in the write log.
    pub(crate) async fn write_no_content(
        &self,
        method: Method,
        access_token: &str,
        path: &str,
        version: &str,
        payload: Option<Value>,
    ) -> Result<(), GraphError> {
        let tracked = self.begin_write(access_token, &method, path, version).await;
        let url = format!("{GRAPH_BASE}/{version}{path}");
        let mut request = self.http.request(method.clone(), url).bearer_auth(access_token);
        request = match &payload {
            Some(payload) => request.json(payload),
            None if method == Method::DELETE => request,
            // Intune `renewUpload` rejects `{}`, so an empty POST sends no body.
            None => request
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(reqwest::header::CONTENT_LENGTH, "0")
                .body(""),
        };
        let result = async {
            let response = self.send(request).await?;
            let status = response.status();
            if status.is_success() {
                return Ok(());
            }
            Err(graph_error_from_response(
                status,
                response.json().await.unwrap_or_default(),
            ))
        }
        .await;
        self.finish_write(tracked, access_token, &method, path, version, payload.as_ref(), None, result.as_ref().err())
            .await;
        result
    }

    /// Read the object a write is about to change. `None` when the request is
    /// not logged; `Some(None)` when it is logged but has no prior state.
    async fn begin_write(
        &self,
        access_token: &str,
        method: &Method,
        path: &str,
        version: &str,
    ) -> Option<Option<Value>> {
        if !write_log::enabled() || !write_log::is_write(method, path) {
            return None;
        }
        if !write_log::state_tracking() {
            return Some(None);
        }
        let Some(state_path) = write_log::state_path(method, path) else {
            return Some(None);
        };
        Some(self.read_state(access_token, version, &state_path).await)
    }

    /// Record a write in the log, reading the object again once it succeeded so
    /// a later undo can tell whether anything changed it since.
    #[allow(clippy::too_many_arguments)]
    async fn finish_write(
        &self,
        tracked: Option<Option<Value>>,
        access_token: &str,
        method: &Method,
        path: &str,
        version: &str,
        body: Option<&Value>,
        response: Option<&Value>,
        error: Option<&GraphError>,
    ) {
        let Some(before) = tracked else {
            return;
        };
        let mut after = None;
        let mut created_id = None;
        let state_tracked = write_log::state_tracking();
        if error.is_none() && state_tracked {
            if let Some((object_path, id)) = write_log::created_object_path(method, path, response) {
                created_id = Some(id);
                after = self
                    .read_state(access_token, version, &write_log::object_state_path(&object_path))
                    .await;
            } else if *method != Method::DELETE {
                if let Some(state_path) = write_log::state_path(method, path) {
                    after = self.read_state(access_token, version, &state_path).await;
                }
            }
        }
        write_log::record(write_log::WriteRecord {
            access_token,
            method,
            path,
            version,
            body,
            before,
            after,
            created_id,
            state_tracked,
            status: error.and_then(GraphError::status),
            error: error.map(ToString::to_string),
        });
    }

    /// Send a request, retrying while Graph throttles it.
    ///
    /// A 429 was refused before Graph acted on it, so any request may be sent
    /// again. A 503 or 504 can arrive after a POST was carried out, so those are
    /// only retried for GET, PUT, PATCH, and DELETE, where repeating is harmless.
    /// The last throttled response is returned when retries run out.
    async fn send(&self, request: reqwest::RequestBuilder) -> Result<reqwest::Response, reqwest::Error> {
        let mut attempt = 0;
        loop {
            // A streamed body cannot be cloned; send it once.
            let Some(next) = request.try_clone() else {
                return request.send().await;
            };
            let next = next.build()?;
            let repeatable = next.method() != Method::POST;
            let response = self.http.execute(next).await?;
            let status = response.status();
            let retry = status == StatusCode::TOO_MANY_REQUESTS || (repeatable && is_throttled(status));
            if !retry || attempt >= MAX_RETRIES {
                return Ok(response);
            }
            let wait = retry_wait(&response, attempt);
            attempt += 1;
            if let Some(listener) = THROTTLE_LISTENER.get() {
                let url = response.url();
                listener(ThrottleNotice {
                    status: response.status().as_u16(),
                    path: url.path().trim_start_matches("/beta").trim_start_matches("/v1.0").to_string(),
                    attempt,
                    max_attempts: MAX_RETRIES,
                    wait_ms: wait.as_millis() as u64,
                });
            }
            tokio::time::sleep(wait).await;
        }
    }

    /// GET an object's current state for the write log. `None` when it cannot be read.
    pub(crate) async fn read_state(&self, access_token: &str, version: &str, path: &str) -> Option<Value> {
        let url = format!("{GRAPH_BASE}/{version}{path}");
        let response = self.send(self.http.get(url).bearer_auth(access_token)).await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.json::<Value>().await.ok()
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
        let response = self.send(request).await?;
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
        let request = self
            .http
            .post(url)
            .bearer_auth(access_token)
            .header("Accept", "*/*")
            .header("Accept-Language", "en")
            .header("x-ms-effective-locale", "en.en-us")
            .json(&payload);
        let response = self.send(request).await?;
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

    /// Same POST as `post_intune_report`, returning the raw success body.
    /// Some app reports return a base64 document rather than a JSON object.
    pub async fn post_intune_report_text(
        &self,
        access_token: &str,
        path: &str,
        body: &impl Serialize,
    ) -> Result<String, GraphError> {
        let payload = serde_json::to_value(body)?;
        let url = format!("{GRAPH_BASE}/beta{path}");
        let request = self
            .http
            .post(url)
            .bearer_auth(access_token)
            .header("Accept", "*/*")
            .header("Accept-Language", "en")
            .header("x-ms-effective-locale", "en.en-us")
            .json(&payload);
        let response = self.send(request).await?;
        let status = response.status();
        if status.is_success() {
            return Ok(response.text().await?);
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
        // `post_batch` records the batch itself, with its per-request outcome.
        let tracked = if path == "/$batch" {
            None
        } else {
            self.begin_write(access_token, &method, path, version).await
        };
        let url = format!("{GRAPH_BASE}/{version}{path}");
        let mut request = self.http.request(method.clone(), url).bearer_auth(access_token);
        if consistency_level {
            request = request.header("ConsistencyLevel", "eventual");
        }
        if let Some(body) = &body {
            request = request.json(body);
        }
        if tracked.is_none() {
            let response = self.send(request).await?;
            let status = response.status();
            if status.is_success() {
                return Ok(response.json().await?);
            }
            return Err(graph_error_from_response(
                status,
                response.json().await.unwrap_or_default(),
            ));
        }
        // Logged writes keep the response, so a create can record the new object's id.
        let result: Result<Value, GraphError> = async {
            let response = self.send(request).await?;
            let status = response.status();
            if status.is_success() {
                return Ok(response.json().await?);
            }
            Err(graph_error_from_response(
                status,
                response.json().await.unwrap_or_default(),
            ))
        }
        .await;
        self.finish_write(
            tracked,
            access_token,
            &method,
            path,
            version,
            body.as_ref(),
            result.as_ref().ok(),
            result.as_ref().err(),
        )
        .await;
        Ok(serde_json::from_value(result?)?)
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
            let response = self.send(request).await?;

            let status = response.status();
            if !status.is_success() {
                return Err(graph_error_from_response(
                    status,
                    response.json().await.unwrap_or_default(),
                ));
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
        let response = self.send(self.http.get(&url).bearer_auth(access_token)).await?;
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
            let response = self.send(self.http.get(&url).bearer_auth(access_token)).await?;

            let status = response.status();
            if !status.is_success() {
                return Err(graph_error_from_response(
                    status,
                    response.json().await.unwrap_or_default(),
                ));
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
    // Only reached once `send` has used up its retries.
    let message = if is_throttled(status) {
        format!(
            "Microsoft Graph is busy and throttled this request after {MAX_RETRIES} retries. Wait a few minutes and try again. ({message})"
        )
    } else {
        message
    };
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
