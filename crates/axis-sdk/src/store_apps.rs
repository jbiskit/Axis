//! Microsoft Store (WinGet) catalog search and app creation.
//! Search uses the public Store catalog Intune uses for “Microsoft Store app (new)”.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::app_icon::large_icon_json;
use crate::graph::{GraphClient, GraphError};
use crate::inventory::MobileAppSummary;

const STORE_EDGE: &str = "https://storeedgefd.dsx.mp.microsoft.com/v9.0";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCatalogHit {
    pub package_identifier: String,
    pub package_name: String,
    pub publisher: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCatalogManifest {
    pub package_identifier: String,
    pub package_name: String,
    pub publisher: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub information_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_information_url: Option<String>,
    pub run_as_account: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWinGetAppInput {
    pub display_name: String,
    pub package_identifier: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub information_url: Option<String>,
    #[serde(default)]
    pub privacy_information_url: Option<String>,
    #[serde(default)]
    pub developer: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub run_as_account: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWinGetAppInput {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub publisher: String,
    pub developer: String,
    pub owner: String,
    pub notes: String,
    pub information_url: String,
    pub privacy_information_url: String,
    pub package_identifier: String,
    #[serde(default)]
    pub update_icon: bool,
    #[serde(default)]
    pub icon_value: String,
}

pub async fn search_store_catalog(query: &str) -> Result<Vec<StoreCatalogHit>, GraphError> {
    let keyword = query.trim();
    if keyword.len() < 2 {
        return Ok(Vec::new());
    }
    let exact = looks_like_store_package_id(keyword);
    let body = json!({
        "MaximumResults": 25,
        "Query": {
            "KeyWord": keyword,
            "MatchType": if exact { "Exact" } else { "Substring" },
        },
    });
    let payload = store_request(reqwest::Method::POST, "/manifestSearch", Some(body)).await?;
    let rows = payload
        .get("Data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut hits = Vec::new();
    for row in rows {
        let Some(package_identifier) = text_field(&row, "PackageIdentifier") else {
            continue;
        };
        let Some(package_name) = text_field(&row, "PackageName") else {
            continue;
        };
        hits.push(StoreCatalogHit {
            package_identifier,
            package_name,
            publisher: text_field(&row, "Publisher").unwrap_or_else(|| "Unknown".into()),
        });
    }
    Ok(hits)
}

pub async fn fetch_store_catalog_manifest(
    package_identifier: &str,
) -> Result<StoreCatalogManifest, GraphError> {
    let id = package_identifier.trim();
    if id.is_empty() {
        return Err(bad_request("Package identifier is required."));
    }
    let path = format!("/packageManifests/{}", urlencoding::encode(id));
    let payload = store_request(reqwest::Method::GET, &path, None).await?;
    let data = payload.get("Data").cloned().unwrap_or(Value::Null);
    let package_identifier = text_field(&data, "PackageIdentifier").ok_or_else(|| {
        bad_request(&format!("Package \"{id}\" returned an empty manifest."))
    })?;
    let versions = data
        .get("Versions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let version = versions.last();
    let locale = version.and_then(|item| item.get("DefaultLocale"));
    let installers = version
        .and_then(|item| item.get("Installers"))
        .and_then(Value::as_array);
    Ok(StoreCatalogManifest {
        package_name: locale
            .and_then(|item| text_field(item, "PackageName"))
            .unwrap_or_else(|| package_identifier.clone()),
        publisher: locale
            .and_then(|item| text_field(item, "Publisher"))
            .unwrap_or_else(|| "Unknown".into()),
        description: locale.and_then(|item| {
            text_field(item, "Description").or_else(|| text_field(item, "ShortDescription"))
        }),
        information_url: locale.and_then(|item| {
            text_field(item, "PublisherSupportUrl").or_else(|| text_field(item, "PublisherUrl"))
        }),
        privacy_information_url: locale.and_then(|item| text_field(item, "PrivacyUrl")),
        run_as_account: pick_run_as(installers).into(),
        package_identifier,
    })
}

pub async fn create_winget_app(
    access_token: &str,
    input: CreateWinGetAppInput,
) -> Result<MobileAppSummary, GraphError> {
    let display_name = input.display_name.trim();
    let package_identifier = input.package_identifier.trim();
    let publisher = input.publisher.as_deref().unwrap_or("").trim();
    if display_name.is_empty() {
        return Err(bad_request("Display name is required."));
    }
    if package_identifier.is_empty() {
        return Err(bad_request("Package identifier is required."));
    }
    if publisher.is_empty() {
        return Err(bad_request("Publisher is required."));
    }
    let run_as = normalize_run_as(input.run_as_account.as_deref());
    let developer = input
        .developer
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(publisher);
    let mut body = json!({
        "@odata.type": "#microsoft.graph.winGetApp",
        "displayName": display_name,
        "publisher": publisher,
        "developer": developer,
        "packageIdentifier": package_identifier,
        "installExperience": install_experience(run_as),
    });
    let map = body.as_object_mut().expect("object");
    insert_text(map, "description", input.description.as_deref());
    insert_text(map, "informationUrl", input.information_url.as_deref());
    insert_text(
        map,
        "privacyInformationUrl",
        input.privacy_information_url.as_deref(),
    );
    insert_text(map, "owner", input.owner.as_deref());
    insert_text(map, "notes", input.notes.as_deref());
    let created: Value = GraphClient::new()
        .post(
            access_token,
            "/deviceAppManagement/mobileApps",
            "beta",
            &body,
        )
        .await?;
    let id = created
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if id.is_empty() {
        return Err(bad_request("Create succeeded but Graph did not return an app id."));
    }
    Ok(MobileAppSummary {
        id,
        display_name: display_name.to_string(),
        publisher: Some(publisher.to_string()),
        display_version: None,
        file_name: None,
        publishing_state: created
            .get("publishingState")
            .and_then(Value::as_str)
            .map(str::to_string),
        is_assigned: Some(false),
        odata_type: Some("#microsoft.graph.winGetApp".into()),
        package_identifier: Some(package_identifier.to_string()),
        last_modified_date_time: created
            .get("lastModifiedDateTime")
            .and_then(Value::as_str)
            .map(str::to_string),
        kind: Some("winget".into()),
        platform: Some("windows".into()),
        app_kind: Some("store".into()),
        app_type_label: Some("WinGet".into()),
    })
}

pub async fn update_winget_app(
    access_token: &str,
    input: UpdateWinGetAppInput,
) -> Result<(), GraphError> {
    let id = input.id.trim();
    if id.is_empty() {
        return Err(bad_request("Store app id is required."));
    }
    let display_name = input.display_name.trim();
    let publisher = input.publisher.trim();
    let package_identifier = input.package_identifier.trim();
    if display_name.is_empty() {
        return Err(bad_request("Display name is required."));
    }
    if publisher.is_empty() {
        return Err(bad_request("Publisher is required."));
    }
    if package_identifier.is_empty() {
        return Err(bad_request("Package identifier is required."));
    }
    let mut body = json!({
        "@odata.type": "#microsoft.graph.winGetApp",
        "displayName": display_name,
        "description": input.description.trim(),
        "publisher": publisher,
        "developer": input.developer.trim(),
        "owner": input.owner.trim(),
        "notes": input.notes.trim(),
        "informationUrl": input.information_url.trim(),
        "privacyInformationUrl": input.privacy_information_url.trim(),
        "packageIdentifier": package_identifier,
    });
    if input.update_icon {
        let icon = large_icon_json(&input.icon_value).map_err(|error| bad_request(&error.to_string()))?;
        body.as_object_mut()
            .expect("object")
            .insert("largeIcon".into(), icon);
    }
    let enc = urlencoding::encode(id);
    GraphClient::new()
        .patch_no_content(
            access_token,
            &format!("/deviceAppManagement/mobileApps/{enc}"),
            "beta",
            &body,
        )
        .await
}

fn install_experience(run_as: &str) -> Value {
    json!({
        "@odata.type": "#microsoft.graph.winGetAppInstallExperience",
        "runAsAccount": run_as,
    })
}

fn normalize_run_as(raw: Option<&str>) -> &'static str {
    if raw.unwrap_or("system").trim().eq_ignore_ascii_case("user") {
        "user"
    } else {
        "system"
    }
}

fn insert_text(body: &mut serde_json::Map<String, Value>, key: &str, value: Option<&str>) {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    body.insert(key.to_string(), json!(value));
}

fn pick_run_as(installers: Option<&Vec<Value>>) -> &'static str {
    let mut saw_user = false;
    for installer in installers.into_iter().flatten() {
        let scope = installer
            .get("Scope")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if scope == "machine" || scope == "system" {
            return "system";
        }
        if scope == "user" {
            saw_user = true;
        }
    }
    if saw_user {
        "user"
    } else {
        "system"
    }
}

fn looks_like_store_package_id(query: &str) -> bool {
    let value = query.trim();
    if value.len() > 2
        && value[..2].eq_ignore_ascii_case("XP")
        && value.chars().all(|ch| ch.is_ascii_alphanumeric())
    {
        return true;
    }
    value.len() == 12 && value.chars().all(|ch| ch.is_ascii_alphanumeric())
}

async fn store_request(
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, GraphError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?;
    let url = format!("{STORE_EDGE}{path}");
    let mut request = client
        .request(method, url)
        .header("Accept", "application/json")
        .header("User-Agent", "Axis");
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await?;
    let status = response.status();
    if status.as_u16() == 404 {
        return Err(bad_request("That package was not found in the Microsoft Store catalog."));
    }
    if !status.is_success() {
        return Err(GraphError::Request {
            status: status.as_u16(),
            code: None,
            message: format!("Store catalog request failed ({status})."),
            permission_related: false,
        });
    }
    Ok(response.json().await.unwrap_or(Value::Null))
}

fn text_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn bad_request(message: &str) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: message.into(),
        permission_related: false,
    }
}
