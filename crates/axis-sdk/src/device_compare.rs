use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::e8_baselines::apply_github_auth;
use crate::graph::{GraphClient, GraphError};

const SETTINGS_MAX: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedPolicySettings {
    pub policy_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub settings: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub skipped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedPolicySettingsLoad {
    pub policies: Vec<AppliedPolicySettings>,
    pub loaded: usize,
    pub skipped: usize,
    pub failed: usize,
}

fn normalize_policy_id(id: &str) -> Option<String> {
    let trimmed = id
        .trim()
        .trim_matches(|ch| ch == '{' || ch == '}')
        .trim()
        .to_string();
    if trimmed.is_empty() || Uuid::parse_str(&trimmed).is_err() {
        return None;
    }
    Some(trimmed)
}

async fn fetch_one(
    client: &GraphClient,
    access_token: &str,
    policy_id: &str,
) -> AppliedPolicySettings {
    let enc = urlencoding::encode(policy_id.trim());
    let settings_path = format!(
        "/deviceManagement/configurationPolicies/{enc}/settings?$expand=settingDefinitions&$top={SETTINGS_MAX}"
    );
    match client
        .fetch_all_pages::<Value>(access_token, &settings_path, "beta", SETTINGS_MAX)
        .await
    {
        Ok(settings) => AppliedPolicySettings {
            policy_id: policy_id.to_string(),
            name: None,
            settings,
            error: None,
            skipped: false,
        },
        Err(error) => {
            let skipped = matches!(error.status(), Some(400 | 404));
            AppliedPolicySettings {
                policy_id: policy_id.to_string(),
                name: None,
                settings: vec![],
                error: Some(error.to_string()),
                skipped,
            }
        }
    }
}

/// Load Settings Catalog instances for policies applied to a device.
/// Non-catalog / classic profiles 404 and are skipped.
pub async fn fetch_applied_policy_settings(
    access_token: &str,
    policy_ids: &[String],
) -> AppliedPolicySettingsLoad {
    let client = GraphClient::new();
    let mut policies = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for raw_id in policy_ids {
        let Some(id) = normalize_policy_id(raw_id) else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        policies.push(fetch_one(&client, access_token, &id).await);
    }

    let loaded = policies
        .iter()
        .filter(|row| row.error.is_none())
        .count();
    let skipped = policies.iter().filter(|row| row.skipped).count();
    let failed = policies
        .iter()
        .filter(|row| row.error.is_some() && !row.skipped)
        .count();

    AppliedPolicySettingsLoad {
        policies,
        loaded,
        skipped,
        failed,
    }
}

pub async fn fetch_baseline_export_json(
    download_url: &str,
    token: Option<&str>,
) -> Result<Value, GraphError> {
    let url = download_url.trim();
    if !url.starts_with("https://") {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Baseline download URL must be https.".into(),
            permission_related: false,
        });
    }
    let token = token.map(str::trim).filter(|value| !value.is_empty());
    let client = reqwest::Client::new();
    let response = apply_github_auth(client.get(url), token).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let hint = if token.is_none()
            && (status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
                || status == reqwest::StatusCode::NOT_FOUND)
        {
            " If this is a private repository, add a GitHub personal access token with the repo scope."
        } else {
            ""
        };
        return Err(GraphError::Request {
            status: status.as_u16(),
            code: None,
            message: format!("HTTP {status} while downloading baseline export.{hint}"),
            permission_related: status == reqwest::StatusCode::FORBIDDEN,
        });
    }
    let text = response.text().await?;
    parse_export_json(&text)
}

fn parse_export_json(text: &str) -> Result<Value, GraphError> {
    let cleaned = text
        .trim_start_matches('\u{FEFF}')
        .trim_start_matches('\u{FFFE}');
    let start = cleaned
        .find(['{', '['])
        .ok_or_else(|| GraphError::Request {
            status: 400,
            code: None,
            message: "No JSON object or array found in baseline export.".into(),
            permission_related: false,
        })?;
    Ok(serde_json::from_str::<Value>(&cleaned[start..])?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_object_and_array_exports() {
        let object = parse_export_json("\u{FEFF}{\"name\":\"Edge\",\"settings\":[]}").unwrap();
        assert_eq!(object["name"], "Edge");
        let array = parse_export_json("[{\"settingInstance\":{\"settingDefinitionId\":\"a\"}}]").unwrap();
        assert!(array.is_array());
    }
}
