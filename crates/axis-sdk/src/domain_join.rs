//! Hybrid Autopilot domain join profile (`windowsDomainJoinConfiguration`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::graph::{GraphClient, GraphError};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDomainJoinInput {
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub domain_name: String,
    #[serde(default)]
    pub organizational_unit: Option<String>,
    pub computer_name_prefix: String,
    pub computer_name_random_char_count: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedDomainJoinProfile {
    pub id: String,
    pub display_name: String,
}

fn input_error(message: impl Into<String>) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: message.into(),
        permission_related: false,
    }
}

fn prefix_char_ok(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '-'
}

pub fn create_domain_join_body(input: &CreateDomainJoinInput) -> Result<Value, GraphError> {
    let display_name = input.display_name.trim();
    if display_name.is_empty() {
        return Err(input_error("Domain join profile name is required."));
    }
    let domain = input.domain_name.trim();
    if domain.is_empty() || domain.contains(char::is_whitespace) || !domain.contains('.') {
        return Err(input_error(
            "Active Directory domain name is required, such as contoso.com.",
        ));
    }
    let prefix = input.computer_name_prefix.trim();
    if prefix.chars().any(|ch| !prefix_char_ok(ch)) {
        return Err(input_error(
            "Computer name prefix can use letters, digits, and hyphens.",
        ));
    }
    let random = input.computer_name_random_char_count;
    if !(0..=15).contains(&random) {
        return Err(input_error(
            "Random computer name length must be from 0 to 15.",
        ));
    }
    if prefix.is_empty() && random == 0 {
        return Err(input_error(
            "Enter a computer name prefix or a random length.",
        ));
    }
    if prefix.chars().count() + random as usize > 15 {
        return Err(input_error(
            "Computer name prefix plus the random length must be 15 characters or fewer.",
        ));
    }
    let ou = input
        .organizational_unit
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(ou) = ou {
        if !ou.contains('=') {
            return Err(input_error(
                "Organizational unit is a distinguished name, such as OU=Computers,DC=contoso,DC=com.",
            ));
        }
    }

    let mut body = json!({
        "@odata.type": "#microsoft.graph.windowsDomainJoinConfiguration",
        "displayName": display_name,
        "activeDirectoryDomainName": domain,
        "computerNameStaticPrefix": prefix,
        "computerNameSuffixRandomCharCount": random,
    });
    if let Some(description) = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["description"] = json!(description);
    }
    if let Some(ou) = ou {
        body["organizationalUnit"] = json!(ou);
    }
    Ok(body)
}

pub async fn create_domain_join_profile(
    access_token: &str,
    input: CreateDomainJoinInput,
) -> Result<CreatedDomainJoinProfile, GraphError> {
    let body = create_domain_join_body(&input)?;
    let created: Value = GraphClient::new()
        .post(
            access_token,
            "/deviceManagement/deviceConfigurations",
            "beta",
            &body,
        )
        .await?;
    let id = created
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| input_error("Domain join profile was created but Graph returned no id."))?;
    let display_name = created
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(input.display_name.trim())
        .to_string();
    Ok(CreatedDomainJoinProfile {
        id: id.to_string(),
        display_name,
    })
}
