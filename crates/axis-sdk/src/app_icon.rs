//! Catalog app icons: a local PNG/JPEG, or an image downloaded from a URL.

use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use thiserror::Error;

const MAX_ICON_BYTES: usize = 1_500_000;
const PACKAGE_INFO_DIR: &str = "PackageInformation";

#[derive(Debug, Error)]
pub enum IconError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Message(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAppIcon {
    pub file: String,
    #[serde(rename = "type")]
    pub mime_type: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogIconPreview {
    #[serde(rename = "type")]
    pub mime_type: String,
    pub value: String,
}

pub fn read_local_icon(source_file: &Path) -> Result<CatalogAppIcon, IconError> {
    if !source_file.is_file() {
        return Err(IconError::Message(format!(
            "Icon file not found: {}",
            source_file.display()
        )));
    }
    let bytes = std::fs::read(source_file)?;
    let mime = sniff_icon(&bytes)?;
    let file_name = icon_file_name(
        source_file
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .as_deref(),
        &mime,
    )?;
    Ok(icon_payload(file_name, mime, &bytes, None))
}

pub fn attach_catalog_icon(app_dir: &Path, source_file: &Path) -> Result<CatalogAppIcon, IconError> {
    let icon = read_local_icon(source_file)?;
    let bytes = decode_icon_bytes(&icon.value)?;
    write_icon_file(app_dir, &icon.file, &bytes)?;
    Ok(icon)
}

pub async fn download_public_icon(raw_url: &str) -> Result<CatalogAppIcon, IconError> {
    let url = assert_public_http_url(raw_url)?;
    let bytes = download_icon(&url).await?;
    let mime = sniff_icon(&bytes)?;
    let file_name = icon_file_name(Some(&file_name_from_url(&url, &mime)), &mime)?;
    Ok(icon_payload(
        file_name,
        mime,
        &bytes,
        Some(url.to_string()),
    ))
}

pub async fn fetch_catalog_icon(app_dir: &Path, raw_url: &str) -> Result<CatalogAppIcon, IconError> {
    let icon = download_public_icon(raw_url).await?;
    let bytes = decode_icon_bytes(&icon.value)?;
    write_icon_file(app_dir, &icon.file, &bytes)?;
    Ok(icon)
}

pub fn large_icon_json(value: &str) -> Result<Value, IconError> {
    let bytes = decode_icon_bytes(value)?;
    let mime = sniff_icon(&bytes)?;
    Ok(graph_large_icon(&mime, &bytes))
}

pub fn preview_catalog_icon(app_dir: &Path, config: &Value) -> Option<CatalogIconPreview> {
    let (mime, bytes) = icon_bytes(app_dir, config).ok().flatten()?;
    Some(CatalogIconPreview {
        mime_type: mime,
        value: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// Bytes for Graph `largeIcon`. Uses saved image data, then a file in the package, then `icon.url`.
pub async fn resolve_catalog_large_icon(
    app_dir: &Path,
    config: &Value,
) -> Result<Option<Value>, IconError> {
    if let Some((mime, bytes)) = icon_bytes(app_dir, config)? {
        return Ok(Some(graph_large_icon(&mime, &bytes)));
    }
    let url = icon_text(config, "url");
    if url.is_empty() {
        return Ok(None);
    }
    let fetched = fetch_catalog_icon(app_dir, &url).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(fetched.value.as_bytes())
        .map_err(|_| IconError::Message("Fetched icon could not be encoded.".into()))?;
    Ok(Some(graph_large_icon(&fetched.mime_type, &bytes)))
}

fn decode_icon_bytes(value: &str) -> Result<Vec<u8>, IconError> {
    let compact: String = value.chars().filter(|ch| !ch.is_whitespace()).collect();
    if compact.is_empty() {
        return Err(IconError::Message("Choose a PNG or JPEG icon.".into()));
    }
    base64::engine::general_purpose::STANDARD
        .decode(compact.as_bytes())
        .map_err(|_| IconError::Message("The icon is not valid base64.".into()))
}

fn graph_large_icon(mime: &str, bytes: &[u8]) -> Value {
    json!({
        "@odata.type": "#microsoft.graph.mimeContent",
        "type": mime,
        "value": base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

fn icon_payload(file: String, mime: String, bytes: &[u8], url: Option<String>) -> CatalogAppIcon {
    CatalogAppIcon {
        file,
        mime_type: mime,
        value: base64::engine::general_purpose::STANDARD.encode(bytes),
        url,
    }
}

fn icon_bytes(app_dir: &Path, config: &Value) -> Result<Option<(String, Vec<u8>)>, IconError> {
    let icon = config.pointer("/application/icon").unwrap_or(&Value::Null);
    let embedded = icon
        .get("value")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    if !embedded.is_empty() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(embedded.as_bytes())
            .map_err(|_| IconError::Message("The saved icon is not valid base64.".into()))?;
        let mime = sniff_icon(&bytes)?;
        return Ok(Some((mime, bytes)));
    }
    let file_name = icon_text(config, "file");
    if file_name.is_empty() {
        return Ok(None);
    }
    let Some(path) = find_icon_file(app_dir, &file_name) else {
        return Ok(None);
    };
    let bytes = std::fs::read(path)?;
    let mime = sniff_icon(&bytes)?;
    Ok(Some((mime, bytes)))
}

fn icon_text(config: &Value, key: &str) -> String {
    config
        .pointer("/application/icon")
        .and_then(|icon| icon.get(key))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn find_icon_file(app_dir: &Path, file_name: &str) -> Option<PathBuf> {
    let name = Path::new(file_name)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())?;
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }
    let packaged = app_dir.join(PACKAGE_INFO_DIR).join(&name);
    if packaged.is_file() {
        return Some(packaged);
    }
    let beside = app_dir.join(&name);
    if beside.is_file() {
        return Some(beside);
    }
    None
}

fn write_icon_file(app_dir: &Path, file_name: &str, bytes: &[u8]) -> Result<PathBuf, IconError> {
    let dir = app_dir.join(PACKAGE_INFO_DIR);
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(file_name);
    std::fs::write(&dest, bytes)?;
    Ok(dest)
}

fn sniff_icon(bytes: &[u8]) -> Result<String, IconError> {
    if bytes.is_empty() {
        return Err(IconError::Message("Icon file is empty.".into()));
    }
    if bytes.len() > MAX_ICON_BYTES {
        return Err(IconError::Message(format!(
            "Icon is too large ({} KB). Keep it under {} KB.",
            bytes.len() / 1024,
            MAX_ICON_BYTES / 1024
        )));
    }
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return Ok("image/png".into());
    }
    if bytes.starts_with(&[0xFF, 0xD8]) {
        return Ok("image/jpeg".into());
    }
    Err(IconError::Message(
        "Icon must be a PNG or JPEG image.".into(),
    ))
}

fn icon_file_name(raw: Option<&str>, mime: &str) -> Result<String, IconError> {
    let extension = if mime == "image/jpeg" { "jpg" } else { "png" };
    let name = raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| {
            Path::new(value)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| format!("AppIcon.{extension}"));
    let mut name: String = name
        .chars()
        .map(|ch| {
            if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control()
            {
                '-'
            } else {
                ch
            }
        })
        .collect();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err(IconError::Message("Icon file name is not valid.".into()));
    }
    let lower = name.to_ascii_lowercase();
    if !(lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")) {
        name = format!("{name}.{extension}");
    }
    Ok(name)
}

fn file_name_from_url(url: &reqwest::Url, mime: &str) -> String {
    let extension = if mime == "image/jpeg" { "jpg" } else { "png" };
    let segment = url
        .path_segments()
        .and_then(|parts| parts.filter(|part| !part.is_empty()).last())
        .unwrap_or("AppIcon");
    let decoded = urlencoding::decode(segment)
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| segment.to_string());
    let lower = decoded.to_ascii_lowercase();
    if lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        decoded
    } else {
        let stem = Path::new(&decoded)
            .file_stem()
            .map(|value| value.to_string_lossy().into_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "AppIcon".into());
        format!("{stem}.{extension}")
    }
}

fn assert_public_http_url(raw: &str) -> Result<reqwest::Url, IconError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(IconError::Message("Icon URL is required.".into()));
    }
    let url = reqwest::Url::parse(trimmed)
        .map_err(|_| IconError::Message("Icon URL is not valid.".into()))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(IconError::Message(
            "Icon URL must use http or https.".into(),
        ));
    }
    if host_is_blocked(&url) {
        return Err(IconError::Message("Icon URL host is not allowed.".into()));
    }
    Ok(url)
}

fn host_is_blocked(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return true;
    };
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host == "metadata.google.internal"
    {
        return true;
    }
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        return ip.is_private()
            || ip.is_loopback()
            || ip.is_link_local()
            || ip.is_unspecified()
            || ip.is_broadcast();
    }
    if let Ok(ip) = host.parse::<Ipv6Addr>() {
        let first = ip.segments()[0];
        let unique_local = (first & 0xfe00) == 0xfc00;
        let link_local = (first & 0xffc0) == 0xfe80;
        return ip.is_loopback() || ip.is_unspecified() || unique_local || link_local;
    }
    false
}

async fn download_icon(url: &reqwest::Url) -> Result<Vec<u8>, IconError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("Too many icon redirects.");
            }
            match assert_public_http_url(attempt.url().as_str()) {
                Ok(_) => attempt.follow(),
                Err(error) => attempt.error(error.to_string()),
            }
        }))
        .build()?;
    let response = client
        .get(url.clone())
        .header(
            reqwest::header::ACCEPT,
            "image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
        )
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(IconError::Message(format!(
            "Failed to download icon ({}).",
            response.status()
        )));
    }
    let mut bytes = Vec::new();
    let mut response = response;
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > MAX_ICON_BYTES {
            return Err(IconError::Message(format!(
                "Icon is too large. Keep it under {} KB.",
                MAX_ICON_BYTES / 1024
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
