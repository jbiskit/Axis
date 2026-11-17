//! Friendly licence and service plan names from Microsoft's "Product names and service plan
//! identifiers for licensing" CSV. Graph only returns codes (skuPartNumber, servicePlanName), so this
//! is the official source for the names the admin portals show. Downloaded once per session; when the
//! download fails, callers keep the Graph codes.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

const CSV_URL: &str = "https://download.microsoft.com/download/e/3/e/e3e9faf2-f28b-490a-9ada-c6089a1fc5b0/Product%20names%20and%20service%20plan%20identifiers%20for%20licensing.csv";

#[derive(Default)]
pub(crate) struct LicenceNames {
    /// skuId (lower case) → product name, e.g. "Microsoft 365 E5".
    pub products: HashMap<String, String>,
    /// servicePlanId (lower case) → feature name, e.g. "Microsoft Intune".
    pub plans: HashMap<String, String>,
}

static CACHE: Mutex<Option<Arc<LicenceNames>>> = Mutex::const_new(None);

/// The name tables, downloaded on first use. A failed download isn't cached, so a later call retries.
pub(crate) async fn licence_names() -> Option<Arc<LicenceNames>> {
    let mut cache = CACHE.lock().await;
    if let Some(names) = cache.as_ref() {
        return Some(names.clone());
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Axis/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .ok()?;
    let response = client.get(CSV_URL).send().await.ok()?.error_for_status().ok()?;
    let text = response.text().await.ok()?;
    let names = Arc::new(parse(&text));
    if names.products.is_empty() {
        return None;
    }
    *cache = Some(names.clone());
    Some(names)
}

fn parse(text: &str) -> LicenceNames {
    let mut rows = csv_rows(text.trim_start_matches('\u{feff}'));
    let Some(header) = rows.next() else { return LicenceNames::default() };
    let column = |name: &str| header.iter().position(|cell| cell == name);
    let (Some(product), Some(sku), Some(plan_id), Some(plan_name)) = (
        column("Product_Display_Name"),
        column("GUID"),
        column("Service_Plan_Id"),
        column("Service_Plans_Included_Friendly_Names"),
    ) else {
        return LicenceNames::default();
    };
    let mut names = LicenceNames::default();
    for row in rows {
        let cell = |index: usize| row.get(index).map(|value| value.trim()).unwrap_or_default();
        if !cell(sku).is_empty() && !cell(product).is_empty() {
            names.products.entry(cell(sku).to_lowercase()).or_insert_with(|| cell(product).to_string());
        }
        let (id, name) = (cell(plan_id).to_lowercase(), cell(plan_name));
        if id.is_empty() || name.is_empty() {
            continue;
        }
        // The same plan appears under many products with inconsistent casing; prefer a mixed-case name.
        let shouting = |value: &str| value.chars().any(char::is_alphabetic) && !value.chars().any(char::is_lowercase);
        match names.plans.get(&id) {
            Some(existing) if !shouting(existing) || shouting(name) => {}
            _ => {
                names.plans.insert(id, name.to_string());
            }
        }
    }
    names
}

/// RFC 4180 rows: commas inside double quotes, "" for a quote, CRLF or LF line ends.
fn csv_rows(text: &str) -> impl Iterator<Item = Vec<String>> + '_ {
    let mut chars = text.chars().peekable();
    std::iter::from_fn(move || {
        chars.peek()?;
        let (mut row, mut cell, mut quoted) = (Vec::new(), String::new(), false);
        while let Some(c) = chars.next() {
            match c {
                '"' if quoted && chars.peek() == Some(&'"') => {
                    chars.next();
                    cell.push('"');
                }
                '"' => quoted = !quoted,
                ',' if !quoted => row.push(std::mem::take(&mut cell)),
                '\r' if !quoted => {}
                '\n' if !quoted => break,
                _ => cell.push(c),
            }
        }
        row.push(cell);
        Some(row)
    })
}
