use crate::error::{AppError, AppResult};
use crate::storage::{secrets, Account};
use aws_config::Region;
use aws_credential_types::Credentials;
use aws_sdk_s3::config::endpoint::{Endpoint, EndpointFuture, Params, ResolveEndpoint};
use aws_sdk_s3::Client;
use aws_smithy_types::endpoint::EndpointAuthScheme;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct ClientManager {
    clients: Mutex<HashMap<String, Client>>,
}

impl ClientManager {
    pub fn new() -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
        }
    }

    pub fn invalidate(&self, account_id: &str) {
        if let Ok(mut map) = self.clients.lock() {
            map.remove(account_id);
        }
    }

    pub fn invalidate_all(&self) {
        if let Ok(mut map) = self.clients.lock() {
            map.clear();
        }
    }

    pub async fn get_or_create(&self, account: &Account) -> AppResult<Client> {
        {
            let map = self
                .clients
                .lock()
                .map_err(|_| AppError::Message("Client lock poisoned".into()))?;
            if let Some(c) = map.get(&account.id) {
                return Ok(c.clone());
            }
        }
        let client = build_client(account).await?;
        let mut map = self
            .clients
            .lock()
            .map_err(|_| AppError::Message("Client lock poisoned".into()))?;
        map.insert(account.id.clone(), client.clone());
        Ok(client)
    }
}

/// Fully overrides AWS partition/DNS endpoint rules — required for Wasabi, MinIO, R2, etc.
///
/// Important: S3 operation serializers only emit `/` as the path. The bucket must be
/// embedded here (path-style or virtual-hosted), otherwise ListObjects hits `/` and
/// compatible stores answer with ListAllMyBucketsResult.
#[derive(Debug)]
struct FixedEndpoint {
    base_url: String,
    signing_region: String,
    force_path_style: bool,
}

impl FixedEndpoint {
    fn resolve_url(&self, params: &Params) -> String {
        let base = self.base_url.trim_end_matches('/');
        let path_style = params.force_path_style().unwrap_or(self.force_path_style);

        match params.bucket() {
            Some(bucket) if !bucket.is_empty() && !bucket.starts_with("arn:") => {
                if path_style {
                    format!("{base}/{bucket}")
                } else if let Some(rest) = base.strip_prefix("https://") {
                    format!("https://{bucket}.{rest}")
                } else if let Some(rest) = base.strip_prefix("http://") {
                    format!("http://{bucket}.{rest}")
                } else {
                    format!("{base}/{bucket}")
                }
            }
            _ => base.to_string(),
        }
    }
}

impl ResolveEndpoint for FixedEndpoint {
    fn resolve_endpoint<'a>(&'a self, params: &'a Params) -> EndpointFuture<'a> {
        let url = self.resolve_url(params);
        let auth = EndpointAuthScheme::with_capacity("sigv4", 3)
            .put("signingName", "s3")
            .put("signingRegion", self.signing_region.as_str())
            .put("disableDoubleEncoding", true);

        EndpointFuture::ready(Ok(Endpoint::builder()
            .url(url)
            .auth_scheme(auth)
            .build()))
    }
}

pub async fn build_client(account: &Account) -> AppResult<Client> {
    let secret = secrets::load_secret(&account.id)?;
    let session = secrets::load_session_token(&account.id)?;
    let configured_region = account.region.trim().to_string();
    if configured_region.is_empty() {
        return Err(AppError::Message("Region is required".into()));
    }

    let custom_endpoint = account
        .endpoint_url
        .as_ref()
        .map(|s| normalize_endpoint_url(s))
        .filter(|s| !s.is_empty());

    // Wasabi (and similar) use regional DNS aliases like s3.de-1.wasabisys.com
    // that must be signed as eu-central-2 — not "de-1".
    let region = resolve_signing_region(&configured_region, custom_endpoint.as_deref());
    if region != configured_region {
        tracing::info!(
            configured = %configured_region,
            signing = %region,
            endpoint = ?custom_endpoint,
            "Adjusted signing region for S3-compatible endpoint"
        );
    }

    let creds = Credentials::new(
        &account.access_key_id,
        &secret,
        session,
        None,
        "silo",
    );

    let shared = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new(region.clone()))
        .credentials_provider(creds)
        .load()
        .await;

    let mut s3 = aws_sdk_s3::config::Builder::from(&shared);

    if let Some(url) = custom_endpoint {
        let path_style = true;
        s3 = s3
            .endpoint_resolver(FixedEndpoint {
                base_url: url,
                signing_region: region,
                force_path_style: path_style,
            })
            .force_path_style(path_style);
    } else if account.force_path_style {
        s3 = s3.force_path_style(true);
    }

    Ok(Client::from_conf(s3.build()))
}

/// Map endpoint host / regional aliases to the SigV4 region Wasabi expects.
pub fn resolve_signing_region(configured: &str, endpoint: Option<&str>) -> String {
    let configured = configured.trim();
    if let Some(ep) = endpoint {
        if let Some(mapped) = wasabi_region_for_host(ep) {
            return mapped.to_string();
        }
    }
    // Also map bare aliases typed into the Region field.
    match configured.to_lowercase().as_str() {
        "de-1" => "eu-central-2".into(),
        "nl-1" => "eu-central-1".into(),
        "uk-1" => "eu-west-1".into(),
        "uk-2" => "eu-west-3".into(),
        "fr-1" => "eu-west-2".into(),
        "it-1" => "eu-south-1".into(),
        other => other.to_string(),
    }
}

fn wasabi_region_for_host(endpoint: &str) -> Option<&'static str> {
    let host = endpoint
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .to_lowercase();
    // Strip optional port
    let host = host.split(':').next().unwrap_or(&host);

    let map = [
        ("s3.wasabisys.com", "us-east-1"),
        ("s3.us-east-1.wasabisys.com", "us-east-1"),
        ("s3.us-east-2.wasabisys.com", "us-east-2"),
        ("s3.us-central-1.wasabisys.com", "us-central-1"),
        ("s3.us-west-1.wasabisys.com", "us-west-1"),
        ("s3.ca-central-1.wasabisys.com", "ca-central-1"),
        ("s3.eu-central-1.wasabisys.com", "eu-central-1"),
        ("s3.nl-1.wasabisys.com", "eu-central-1"),
        ("s3.eu-central-2.wasabisys.com", "eu-central-2"),
        ("s3.de-1.wasabisys.com", "eu-central-2"),
        ("s3.eu-west-1.wasabisys.com", "eu-west-1"),
        ("s3.uk-1.wasabisys.com", "eu-west-1"),
        ("s3.eu-west-2.wasabisys.com", "eu-west-2"),
        ("s3.fr-1.wasabisys.com", "eu-west-2"),
        ("s3.eu-west-3.wasabisys.com", "eu-west-3"),
        ("s3.uk-2.wasabisys.com", "eu-west-3"),
        ("s3.eu-south-1.wasabisys.com", "eu-south-1"),
        ("s3.it-1.wasabisys.com", "eu-south-1"),
        ("s3.ap-northeast-1.wasabisys.com", "ap-northeast-1"),
        ("s3.ap-northeast-2.wasabisys.com", "ap-northeast-2"),
        ("s3.ap-southeast-1.wasabisys.com", "ap-southeast-1"),
        ("s3.ap-southeast-2.wasabisys.com", "ap-southeast-2"),
    ];
    map.iter()
        .find(|(h, _)| *h == host)
        .map(|(_, r)| *r)
}

/// Ensure endpoint has a scheme. Hosts like `s3.de-1.wasabisys.com` become `https://...`.
pub fn normalize_endpoint_url(raw: &str) -> String {
    let s = raw.trim().trim_end_matches('/').to_string();
    if s.is_empty() {
        return s;
    }
    let lower = s.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return s;
    }
    let host = s.split('/').next().unwrap_or(&s);
    let host_lower = host.to_lowercase();
    if host_lower.starts_with("localhost")
        || host_lower.starts_with("127.0.0.1")
        || host_lower.starts_with("0.0.0.0")
        || host_lower.starts_with("[::1]")
    {
        format!("http://{s}")
    } else {
        format!("https://{s}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aws_sdk_s3::config::endpoint::Params;

    #[test]
    fn adds_https_when_missing() {
        assert_eq!(
            normalize_endpoint_url("s3.de-1.wasabisys.com"),
            "https://s3.de-1.wasabisys.com"
        );
    }

    #[test]
    fn path_style_embeds_bucket() {
        let ep = FixedEndpoint {
            base_url: "https://s3.de-1.wasabisys.com".into(),
            signing_region: "eu-central-1".into(),
            force_path_style: true,
        };
        let params = Params::builder()
            .bucket("my-bucket")
            .force_path_style(true)
            .build()
            .unwrap();
        assert_eq!(
            ep.resolve_url(&params),
            "https://s3.de-1.wasabisys.com/my-bucket"
        );
    }

    #[test]
    fn wasabi_de1_maps_to_eu_central_2() {
        assert_eq!(
            resolve_signing_region("de-1", Some("https://s3.de-1.wasabisys.com")),
            "eu-central-2"
        );
        assert_eq!(
            resolve_signing_region("eu-central-2", Some("https://s3.de-1.wasabisys.com")),
            "eu-central-2"
        );
    }
}
