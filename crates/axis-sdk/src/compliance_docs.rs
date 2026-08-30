use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::graph::GraphError;

const TOC_URL: &str =
    "https://hosting.portal.azure.net/intunedevicesettings/?environmentjson=true&l=en&trustedAuthority=intune.microsoft.com";
const BUNDLE_BASE: &str = "https://hosting.portal.azure.net/intunedevicesettings/Content/Dynamic";

/// Graph property → portal ClientResources name / description keys.
const PORTAL_KEYS: &[(&str, &str, &str)] = &[
    (
        "passwordRequired",
        "compliancePasswordRequirementName",
        "compliancePasswordRequirementDescription",
    ),
    (
        "passwordBlockSimple",
        "complianceBlockSimplePasswordsName",
        "complianceBlockSimplePasswordsDescription",
    ),
    (
        "passwordRequiredToUnlockFromIdle",
        "compliancePasswordRequireToUnlockFromIdleName",
        "compliancePasswordRequireToUnlockFromIdleDescription",
    ),
    (
        "passwordMinutesOfInactivityBeforeLock",
        "complianceMinutesOfInactivityBeforePasswordRequiredName",
        "complianceMinutesOfInactivityBeforePasswordRequiredDescription",
    ),
    (
        "passwordExpirationDays",
        "compliancePasswordExpirationName",
        "compliancePasswordExpirationDescription",
    ),
    (
        "passwordMinimumLength",
        "complianceMinimumPasswordLengthName",
        "complianceMinimumPasswordLengthDescription",
    ),
    (
        "passwordRequiredType",
        "complianceWindowsRequiredPasswordTypeName",
        "complianceWindowsRequiredPasswordTypeDescription",
    ),
    (
        "passwordPreviousPasswordBlockCount",
        "complianceNumberOfPreviousPasswordsToBlockName",
        "complianceNumberOfPreviousPasswordsToBlockDescription",
    ),
    (
        "passcodeRequired",
        "compliancePasswordRequirementName",
        "compliancePasswordRequirementDescription",
    ),
    (
        "passcodeBlockSimple",
        "complianceBlockSimplePasswordsName",
        "complianceBlockSimplePasswordsDescription",
    ),
    (
        "passcodeExpirationDays",
        "compliancePasswordExpirationName",
        "compliancePasswordExpirationDescription",
    ),
    (
        "passcodeMinimumLength",
        "complianceMinimumPasswordLengthName",
        "complianceMinimumPasswordLengthDescription",
    ),
    (
        "passcodeMinutesOfInactivityBeforeLock",
        "complianceMinutesOfInactivityBeforePasswordRequiredName",
        "complianceMinutesOfInactivityBeforePasswordRequiredDescription",
    ),
    (
        "passcodePreviousPasscodeBlockCount",
        "complianceNumberOfPreviousPasswordsToBlockName",
        "complianceNumberOfPreviousPasswordsToBlockDescription",
    ),
    (
        "passcodeRequiredType",
        "complianceWindowsRequiredPasswordTypeName",
        "complianceRequiredPasswordTypeDescription",
    ),
    (
        "osMinimumVersion",
        "complianceOsVersionRestrictionMinimumName",
        "complianceOsVersionRestrictionMinimumDescription",
    ),
    (
        "osMaximumVersion",
        "complianceOsVersionRestrictionMaximumName",
        "complianceOsVersionRestrictionMaximumDescription",
    ),
    (
        "minAndroidSecurityPatchLevel",
        "complianceMinimumSecurityPatchLevelName",
        "complianceMinimumSecurityPatchLevelDescription",
    ),
    (
        "storageRequireEncryption",
        "complianceRequireEncryptionName",
        "complianceRequireEncryptionDescription",
    ),
    (
        "requireHealthyDeviceReport",
        "complianceRequireHealthyDeviceReportName",
        "complianceRequireHealthyDeviceReportDescription",
    ),
    (
        "deviceThreatProtectionEnabled",
        "complianceDeviceThreatProtectionRequirementName",
        "complianceDeviceThreatProtectionRequirementDescription",
    ),
    (
        "deviceThreatProtectionRequiredSecurityLevel",
        "complianceDeviceThreatProtectionRequirementName",
        "complianceDeviceThreatProtectionRequirementDescription",
    ),
    (
        "systemIntegrityProtectionEnabled",
        "complianceSystemIntegrityProtectionName",
        "complianceSystemIntegrityProtectionDescription",
    ),
    (
        "firewallEnabled",
        "complianceFirewallRequirementName",
        "complianceFirewallRequirementDescription",
    ),
    (
        "firewallBlockAllIncoming",
        "complianceFirewallBlockAllIncomingName",
        "complianceFirewallBlockAllIncomingDescription",
    ),
    (
        "firewallEnableStealthMode",
        "complianceFirewallEnableStealthModeName",
        "complianceFirewallEnableStealthModeDescription",
    ),
    (
        "activeFirewallRequired",
        "complianceRequireFirewallName",
        "complianceRequireFirewallDescription",
    ),
    (
        "defenderEnabled",
        "complianceRequireWindowsDefenderAntimalwareName",
        "complianceRequireWindowsDefenderAntimalwareDescription",
    ),
    (
        "antivirusRequired",
        "complianceAntivirusRequirementName",
        "complianceAntivirusRequirementDescription",
    ),
    (
        "antiSpywareRequired",
        "complianceAntiSpywareRequirementName",
        "complianceAntiSpywareRequirementDescription",
    ),
    (
        "rtpEnabled",
        "complianceRequireRealTimeProtectionName",
        "complianceRequireRealTimeProtectionDescription",
    ),
    (
        "signatureOutOfDate",
        "complianceRequireWindowsDefenderSignatureName",
        "complianceRequireWindowsDefenderSignatureDescription",
    ),
    (
        "defenderVersion",
        "complianceWindowsDefenderMinimumVersionName",
        "complianceWindowsDefenderMinimumVersionDescription",
    ),
    (
        "tpmRequired",
        "complianceTpmRequirementName",
        "complianceTpmRequiredDescription",
    ),
    (
        "managedEmailProfileRequired",
        "complianceEmailProfileManagementName",
        "complianceEmailProfileRequiredDescription",
    ),
    (
        "securityBlockJailbrokenDevices",
        "complianceJailbreakAllowedName",
        "complianceJailbreakAllowedDescription",
    ),
    (
        "codeIntegrityEnabled",
        "codeIntegrityEnabledName",
        "codeIntegrityEnabledName",
    ),
    (
        "secureBootEnabled",
        "secureBootEnabledName",
        "secureBootEnabledName",
    ),
    (
        "earlyLaunchAntiMalwareDriverEnabled",
        "earlyLaunchAntiMalwareDriverEnabledName",
        "earlyLaunchAntiMalwareDriverEnabledName",
    ),
    (
        "virtualizationBasedSecurityEnabled",
        "virtualizationBasedSecurityEnabledName",
        "virtualizationBasedSecurityEnabledName",
    ),
    (
        "firmwareProtectionEnabled",
        "firmwareProtectionEnabledName",
        "firmwareProtectionEnabledName",
    ),
    (
        "memoryIntegrityEnabled",
        "hvciEnabledName",
        "hvciEnabledName",
    ),
    (
        "gatekeeperAllowedAppSource",
        "gatekeeperAllowedAppSourceName",
        "gatekeeperAllowedAppSourceDescription",
    ),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompliancePropertyOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompliancePropertyDoc {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub type_name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<CompliancePropertyOption>,
}

#[derive(Debug, Clone)]
struct PortalPack {
    strings: HashMap<String, String>,
}

fn pack_cache() -> &'static Mutex<Option<PortalPack>> {
    static CACHE: OnceLock<Mutex<Option<PortalPack>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

async fn fetch_text(url: &str) -> Result<String, GraphError> {
    let response = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "axis-portal-resources")
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(GraphError::from)?;
    let status = response.status();
    if !status.is_success() {
        return Err(GraphError::Request {
            status: status.as_u16(),
            code: None,
            message: format!("Could not load Intune portal resources ({status})."),
            permission_related: false,
        });
    }
    Ok(response.text().await.map_err(GraphError::from)?)
}

pub fn client_resources_bundle_url(toc: &str) -> Option<String> {
    let marker = "\"*ClientResources\":[";
    let mut rest = toc;
    while let Some(start) = rest.find(marker) {
        let after = &rest[start + marker.len()..];
        let array_end = after.find(']')?;
        let array = &after[..array_end];
        if let Some(dyn_at) = array.find("Content/Dynamic/") {
            let hash_start = dyn_at + "Content/Dynamic/".len();
            let hash: String = array[hash_start..]
                .chars()
                .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
                .collect();
            if !hash.is_empty() {
                return Some(format!("{BUNDLE_BASE}/{hash}.js"));
            }
        }
        rest = &after[1..];
    }
    None
}

pub fn parse_js_string_leaves(source: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let bytes = source.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            i += 1;
            continue;
        }
        if !(bytes[i].is_ascii_alphabetic() || bytes[i] == b'_' || bytes[i] == b'$') {
            i += 1;
            continue;
        }
        let key_start = i;
        i += 1;
        while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
            i += 1;
        }
        let key = &source[key_start..i];
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b':' {
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'"' {
            continue;
        }
        i += 1;
        let mut value = String::new();
        while i < bytes.len() {
            let ch = bytes[i];
            if ch == b'\\' {
                if i + 1 < bytes.len() {
                    match bytes[i + 1] {
                        b'n' => value.push('\n'),
                        b'r' => value.push('\r'),
                        b't' => value.push('\t'),
                        other => value.push(other as char),
                    }
                    i += 2;
                    continue;
                }
            }
            if ch == b'"' {
                i += 1;
                break;
            }
            value.push(ch as char);
            i += 1;
        }
        if !key.is_empty() {
            out.insert(key.to_string(), value);
        }
    }
    out
}

fn lookup_portal_text(
    graph_key: &str,
    strings: &HashMap<String, String>,
) -> (Option<String>, Option<String>) {
    if let Some((_, name_key, desc_key)) = PORTAL_KEYS.iter().find(|(key, _, _)| *key == graph_key) {
        return (
            strings.get(*name_key).cloned(),
            strings.get(*desc_key).cloned(),
        );
    }
    let name = strings.get(&format!("{graph_key}Name")).cloned();
    let description = strings.get(&format!("{graph_key}Description")).cloned();
    (name, description)
}

fn docs_from_pack(pack: &PortalPack) -> Vec<CompliancePropertyDoc> {
    let mut docs = Vec::new();
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for (graph_key, _, _) in PORTAL_KEYS {
        if !seen.insert(graph_key) {
            continue;
        }
        let (label, description) = lookup_portal_text(graph_key, &pack.strings);
        if label.is_none() && description.is_none() {
            continue;
        }
        docs.push(CompliancePropertyDoc {
            name: (*graph_key).to_string(),
            label,
            type_name: String::new(),
            description: description.unwrap_or_default(),
            options: Vec::new(),
        });
    }
    for (key, value) in &pack.strings {
        if !key.ends_with("Name") || key.starts_with("compliance") {
            continue;
        }
        let graph_key = key.trim_end_matches("Name");
        if graph_key.is_empty() || seen.contains(graph_key) {
            continue;
        }
        if !graph_key
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_lowercase())
        {
            continue;
        }
        seen.insert(graph_key);
        docs.push(CompliancePropertyDoc {
            name: graph_key.to_string(),
            label: Some(value.clone()),
            type_name: String::new(),
            description: pack
                .strings
                .get(&format!("{graph_key}Description"))
                .cloned()
                .unwrap_or_default(),
            options: Vec::new(),
        });
    }
    docs
}

async fn load_portal_pack() -> Result<PortalPack, GraphError> {
    if let Ok(cache) = pack_cache().lock() {
        if let Some(existing) = cache.as_ref() {
            return Ok(existing.clone());
        }
    }
    let toc = fetch_text(TOC_URL).await?;
    let bundle = client_resources_bundle_url(&toc).ok_or_else(|| GraphError::Request {
        status: 502,
        code: None,
        message: "Intune portal table of contents did not name a ClientResources bundle.".into(),
        permission_related: false,
    })?;
    let js = fetch_text(&bundle).await?;
    let strings = parse_js_string_leaves(&js);
    if strings.is_empty() {
        return Err(GraphError::Request {
            status: 502,
            code: None,
            message: "Intune ClientResources bundle did not contain string keys.".into(),
            permission_related: false,
        });
    }
    let pack = PortalPack { strings };
    if let Ok(mut cache) = pack_cache().lock() {
        *cache = Some(pack.clone());
    }
    Ok(pack)
}

pub async fn fetch_compliance_property_docs(
    _odata_type: &str,
) -> Result<Vec<CompliancePropertyDoc>, GraphError> {
    let pack = load_portal_pack().await?;
    Ok(docs_from_pack(&pack))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_hash_from_star_client_resources() {
        let toc = r#"{"pageVersion":"1.2608.117.0","requireConfig":{"x":1},"*ClientResources":["//hosting.portal.azure.net/intunedevicesettings/Content/Dynamic/d2CqJR4B775S","https://hosting.portal.azure.net/intunedevicesettings/Content/Dynamic/d2CqJR4B775S"]}"#;
        assert_eq!(
            client_resources_bundle_url(toc).as_deref(),
            Some("https://hosting.portal.azure.net/intunedevicesettings/Content/Dynamic/d2CqJR4B775S.js")
        );
    }

    #[test]
    fn skips_alias_client_resources_before_hashed_bundle() {
        let toc = r#"{
            "*ClientResources":["ClientResources"],
            "other":{"//hosting.portal.azure.net/intunedevicesettings/Content/Dynamic/WRONGHASH":{}},
            "*ClientResources":["//hosting.portal.azure.net/intunedevicesettings/Content/Dynamic/d2CqJR4B775S","https://hosting.portal.azure.net/intunedevicesettings/Content/Dynamic/d2CqJR4B775S"]
        }"#;
        assert_eq!(
            client_resources_bundle_url(toc).as_deref(),
            Some("https://hosting.portal.azure.net/intunedevicesettings/Content/Dynamic/d2CqJR4B775S.js")
        );
    }

    #[test]
    fn parses_nested_client_resources_leaves() {
        let js = r#"define("ClientResources",{ADMX:{x:"ignore"},compliancePasswordRequirementName:"Require a password to unlock mobile devices",compliancePasswordRequirementDescription:"This setting specifies whether to require users to enter a password before access is granted to information on their mobile devices. Recommended value: Require",nested:{passwordBlockSimpleName:"Simple passwords"}});"#;
        let strings = parse_js_string_leaves(js);
        assert_eq!(
            strings.get("compliancePasswordRequirementName").map(String::as_str),
            Some("Require a password to unlock mobile devices")
        );
        assert!(strings
            .get("compliancePasswordRequirementDescription")
            .unwrap()
            .contains("Recommended value: Require"));
        assert_eq!(
            strings.get("passwordBlockSimpleName").map(String::as_str),
            Some("Simple passwords")
        );
    }

    #[test]
    fn maps_password_required_to_portal_copy() {
        let mut strings = HashMap::new();
        strings.insert(
            "compliancePasswordRequirementName".into(),
            "Require a password to unlock mobile devices".into(),
        );
        strings.insert(
            "compliancePasswordRequirementDescription".into(),
            "This setting specifies whether to require users to enter a password before access is granted to information on their mobile devices. Recommended value: Require".into(),
        );
        let pack = PortalPack { strings };
        let docs = docs_from_pack(&pack);
        let password = docs.iter().find(|doc| doc.name == "passwordRequired").unwrap();
        assert_eq!(
            password.label.as_deref(),
            Some("Require a password to unlock mobile devices")
        );
        assert!(password.description.contains("Recommended value: Require"));
    }
}
