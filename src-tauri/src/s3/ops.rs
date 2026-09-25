use crate::error::{AppError, AppResult, sanitize_s3_error};
use aws_sdk_s3::types::{
    BucketCannedAcl, BucketLocationConstraint, BucketVersioningStatus,
    CreateBucketConfiguration, ObjectCannedAcl, ServerSideEncryption,
    ServerSideEncryptionByDefault, ServerSideEncryptionConfiguration,
    ServerSideEncryptionRule, VersioningConfiguration,
};
use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketInfo {
    pub name: String,
    pub creation_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectEntry {
    pub key: String,
    pub name: String,
    pub size: Option<i64>,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub storage_class: Option<String>,
    pub is_folder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListObjectsResult {
    pub entries: Vec<ObjectEntry>,
    pub is_truncated: bool,
    pub next_continuation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclGrant {
    pub grantee: String,
    pub permission: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AclInfo {
    pub owner: Option<String>,
    pub grants: Vec<AclGrant>,
}

fn map_sdk_err(e: impl std::error::Error) -> AppError {
    let msg = crate::error::format_error_chain(&e);
    tracing::warn!(error = %msg, "S3 request failed");
    AppError::S3(sanitize_s3_error(&msg))
}

pub async fn list_buckets(client: &Client) -> AppResult<Vec<BucketInfo>> {
    let out = client.list_buckets().send().await.map_err(map_sdk_err)?;
    let mut buckets = Vec::new();
    for b in out.buckets() {
        buckets.push(BucketInfo {
            name: b.name().unwrap_or_default().to_string(),
            creation_date: b.creation_date().map(|d| d.to_string()),
        });
    }
    buckets.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(buckets)
}

pub async fn create_bucket(client: &Client, name: &str, region: &str) -> AppResult<()> {
    let mut req = client.create_bucket().bucket(name);
    // us-east-1 must omit LocationConstraint
    if region != "us-east-1" {
        if let Ok(constraint) = BucketLocationConstraint::try_parse(region) {
            let cfg = CreateBucketConfiguration::builder()
                .location_constraint(constraint)
                .build();
            req = req.create_bucket_configuration(cfg);
        }
    }
    req.send().await.map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_bucket(client: &Client, name: &str) -> AppResult<()> {
    client
        .delete_bucket()
        .bucket(name)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn list_objects(
    client: &Client,
    bucket: &str,
    prefix: &str,
    continuation_token: Option<String>,
) -> AppResult<ListObjectsResult> {
    let mut req = client
        .list_objects_v2()
        .bucket(bucket)
        .delimiter("/")
        .prefix(prefix)
        .max_keys(500);

    if let Some(token) = continuation_token {
        req = req.continuation_token(token);
    }

    let out = req.send().await.map_err(map_sdk_err)?;
    let mut entries = Vec::new();

    for p in out.common_prefixes() {
        if let Some(pref) = p.prefix() {
            let name = pref
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or(pref)
                .to_string();
            entries.push(ObjectEntry {
                key: pref.to_string(),
                name,
                size: None,
                last_modified: None,
                etag: None,
                storage_class: None,
                is_folder: true,
            });
        }
    }

    for obj in out.contents() {
        let key = obj.key().unwrap_or_default().to_string();
        // Skip the folder marker itself when listing inside a prefix
        if key == prefix || key.ends_with('/') {
            continue;
        }
        let name = key.rsplit('/').next().unwrap_or(&key).to_string();
        entries.push(ObjectEntry {
            key: key.clone(),
            name,
            size: obj.size(),
            last_modified: obj.last_modified().map(|d| d.to_string()),
            etag: obj.e_tag().map(|s| s.to_string()),
            storage_class: obj.storage_class().map(|s| s.as_str().to_string()),
            is_folder: false,
        });
    }

    entries.sort_by(|a, b| match (a.is_folder, b.is_folder) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(ListObjectsResult {
        entries,
        is_truncated: out.is_truncated().unwrap_or(false),
        next_continuation_token: out.next_continuation_token().map(|s| s.to_string()),
    })
}

pub async fn delete_objects(client: &Client, bucket: &str, keys: Vec<String>) -> AppResult<()> {
    use aws_sdk_s3::types::{Delete, ObjectIdentifier};
    if keys.is_empty() {
        return Ok(());
    }
    // Batch in chunks of 1000
    for chunk in keys.chunks(1000) {
        let objects: Result<Vec<_>, _> = chunk
            .iter()
            .map(|k| ObjectIdentifier::builder().key(k).build())
            .collect();
        let objects = objects.map_err(|e| AppError::Message(e.to_string()))?;
        let delete = Delete::builder()
            .set_objects(Some(objects))
            .quiet(true)
            .build()
            .map_err(|e| AppError::Message(e.to_string()))?;
        client
            .delete_objects()
            .bucket(bucket)
            .delete(delete)
            .send()
            .await
            .map_err(map_sdk_err)?;
    }
    Ok(())
}

pub async fn copy_object(
    client: &Client,
    source_bucket: &str,
    dest_bucket: &str,
    source_key: &str,
    dest_key: &str,
) -> AppResult<()> {
    let copy_source = format!(
        "{}/{}",
        source_bucket,
        encode_key_for_copy(source_key)
    );
    client
        .copy_object()
        .bucket(dest_bucket)
        .key(dest_key)
        .copy_source(copy_source)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

fn encode_key_for_copy(key: &str) -> String {
    key.split('/')
        .map(|part| {
            let mut out = String::new();
            for b in part.bytes() {
                match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        out.push(b as char)
                    }
                    _ => out.push_str(&format!("%{b:02X}")),
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join("/")
}

pub async fn create_folder(client: &Client, bucket: &str, prefix: &str) -> AppResult<()> {
    let key = if prefix.ends_with('/') {
        prefix.to_string()
    } else {
        format!("{prefix}/")
    };
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(aws_sdk_s3::primitives::ByteStream::from_static(b""))
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_bucket_acl(client: &Client, bucket: &str) -> AppResult<AclInfo> {
    let out = client
        .get_bucket_acl()
        .bucket(bucket)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(AclInfo {
        owner: out.owner().and_then(|o| o.display_name().map(|s| s.to_string()).or_else(|| o.id().map(|s| s.to_string()))),
        grants: out
            .grants()
            .iter()
            .map(|g| AclGrant {
                grantee: g
                    .grantee()
                    .map(|gr| {
                        gr.display_name()
                            .or(gr.uri())
                            .or(gr.id())
                            .unwrap_or("unknown")
                            .to_string()
                    })
                    .unwrap_or_else(|| "unknown".into()),
                permission: g
                    .permission()
                    .map(|p| p.as_str().to_string())
                    .unwrap_or_default(),
            })
            .collect(),
    })
}

pub async fn put_bucket_acl(client: &Client, bucket: &str, canned: &str) -> AppResult<()> {
    let acl = parse_bucket_canned(canned)?;
    client
        .put_bucket_acl()
        .bucket(bucket)
        .acl(acl)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_object_acl(client: &Client, bucket: &str, key: &str) -> AppResult<AclInfo> {
    let out = client
        .get_object_acl()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(AclInfo {
        owner: out.owner().and_then(|o| o.display_name().map(|s| s.to_string()).or_else(|| o.id().map(|s| s.to_string()))),
        grants: out
            .grants()
            .iter()
            .map(|g| AclGrant {
                grantee: g
                    .grantee()
                    .map(|gr| {
                        gr.display_name()
                            .or(gr.uri())
                            .or(gr.id())
                            .unwrap_or("unknown")
                            .to_string()
                    })
                    .unwrap_or_else(|| "unknown".into()),
                permission: g
                    .permission()
                    .map(|p| p.as_str().to_string())
                    .unwrap_or_default(),
            })
            .collect(),
    })
}

pub async fn put_object_acl(
    client: &Client,
    bucket: &str,
    key: &str,
    canned: &str,
) -> AppResult<()> {
    let acl = parse_object_canned(canned)?;
    client
        .put_object_acl()
        .bucket(bucket)
        .key(key)
        .acl(acl)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_bucket_policy(client: &Client, bucket: &str) -> AppResult<Option<String>> {
    match client.get_bucket_policy().bucket(bucket).send().await {
        Ok(out) => Ok(out.policy().map(|s| s.to_string())),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("NoSuchBucketPolicy") || msg.contains("404") {
                Ok(None)
            } else {
                Err(map_sdk_err(e))
            }
        }
    }
}

pub async fn put_bucket_policy(client: &Client, bucket: &str, policy: &str) -> AppResult<()> {
    // Validate JSON
    let _: serde_json::Value = serde_json::from_str(policy)?;
    client
        .put_bucket_policy()
        .bucket(bucket)
        .policy(policy)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_bucket_policy(client: &Client, bucket: &str) -> AppResult<()> {
    client
        .delete_bucket_policy()
        .bucket(bucket)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

fn parse_bucket_canned(s: &str) -> AppResult<BucketCannedAcl> {
    match s {
        "private" => Ok(BucketCannedAcl::Private),
        "public-read" => Ok(BucketCannedAcl::PublicRead),
        "public-read-write" => Ok(BucketCannedAcl::PublicReadWrite),
        "authenticated-read" => Ok(BucketCannedAcl::AuthenticatedRead),
        other => Err(AppError::Message(format!("Unknown canned ACL: {other}"))),
    }
}

fn parse_object_canned(s: &str) -> AppResult<ObjectCannedAcl> {
    match s {
        "private" => Ok(ObjectCannedAcl::Private),
        "public-read" => Ok(ObjectCannedAcl::PublicRead),
        "public-read-write" => Ok(ObjectCannedAcl::PublicReadWrite),
        "authenticated-read" => Ok(ObjectCannedAcl::AuthenticatedRead),
        "bucket-owner-read" => Ok(ObjectCannedAcl::BucketOwnerRead),
        "bucket-owner-full-control" => Ok(ObjectCannedAcl::BucketOwnerFullControl),
        other => Err(AppError::Message(format!("Unknown canned ACL: {other}"))),
    }
}

pub async fn presign_get(
    client: &Client,
    bucket: &str,
    key: &str,
    expires_secs: u64,
) -> AppResult<String> {
    use std::time::Duration;
    let presigned = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .presigned(
            aws_sdk_s3::presigning::PresigningConfig::expires_in(Duration::from_secs(
                expires_secs.max(60),
            ))
            .map_err(|e| AppError::Message(e.to_string()))?,
        )
        .await
        .map_err(map_sdk_err)?;
    Ok(presigned.uri().to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersioningInfo {
    pub status: String,
}

pub async fn get_bucket_versioning(client: &Client, bucket: &str) -> AppResult<VersioningInfo> {
    let out = client
        .get_bucket_versioning()
        .bucket(bucket)
        .send()
        .await
        .map_err(map_sdk_err)?;
    let status = out
        .status()
        .map(|s| s.as_str().to_string())
        .unwrap_or_else(|| "Disabled".into());
    Ok(VersioningInfo { status })
}

pub async fn put_bucket_versioning(
    client: &Client,
    bucket: &str,
    status: &str,
) -> AppResult<()> {
    let status = match status.to_lowercase().as_str() {
        "enabled" => BucketVersioningStatus::Enabled,
        "suspended" => BucketVersioningStatus::Suspended,
        other => {
            return Err(AppError::Message(format!(
                "Unknown versioning status: {other} (use Enabled or Suspended)"
            )));
        }
    };
    let cfg = VersioningConfiguration::builder().status(status).build();
    client
        .put_bucket_versioning()
        .bucket(bucket)
        .versioning_configuration(cfg)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_bucket_cors(client: &Client, bucket: &str) -> AppResult<Option<String>> {
    match client.get_bucket_cors().bucket(bucket).send().await {
        Ok(out) => {
            let rules: Vec<serde_json::Value> = out
                .cors_rules()
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "allowedOrigins": r.allowed_origins(),
                        "allowedMethods": r.allowed_methods().iter().map(|m| m.as_str()).collect::<Vec<_>>(),
                        "allowedHeaders": r.allowed_headers(),
                        "exposeHeaders": r.expose_headers(),
                        "maxAgeSeconds": r.max_age_seconds(),
                        "id": r.id(),
                    })
                })
                .collect();
            Ok(Some(serde_json::to_string_pretty(&rules)?))
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("NoSuchCORSConfiguration") || msg.contains("404") {
                Ok(None)
            } else {
                Err(map_sdk_err(e))
            }
        }
    }
}

pub async fn put_bucket_cors(client: &Client, bucket: &str, rules_json: &str) -> AppResult<()> {
    use aws_sdk_s3::types::{CorsConfiguration, CorsRule};
    let value: serde_json::Value = serde_json::from_str(rules_json)?;
    let arr = value
        .as_array()
        .ok_or_else(|| AppError::Message("CORS JSON must be an array of rules".into()))?;
    let mut rules = Vec::new();
    for item in arr {
        let origins = item
            .get("allowedOrigins")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let methods = item
            .get("allowedMethods")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if origins.is_empty() || methods.is_empty() {
            return Err(AppError::Message(
                "Each CORS rule needs allowedOrigins and allowedMethods".into(),
            ));
        }
        let mut builder = CorsRule::builder()
            .set_allowed_origins(Some(origins))
            .set_allowed_methods(Some(methods));
        if let Some(headers) = item.get("allowedHeaders").and_then(|v| v.as_array()) {
            builder = builder.set_allowed_headers(Some(
                headers
                    .iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect(),
            ));
        }
        if let Some(headers) = item.get("exposeHeaders").and_then(|v| v.as_array()) {
            builder = builder.set_expose_headers(Some(
                headers
                    .iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect(),
            ));
        }
        if let Some(age) = item.get("maxAgeSeconds").and_then(|v| v.as_i64()) {
            builder = builder.max_age_seconds(age as i32);
        }
        if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
            builder = builder.id(id);
        }
        rules.push(builder.build().map_err(|e| AppError::Message(e.to_string()))?);
    }
    let cfg = CorsConfiguration::builder()
        .set_cors_rules(Some(rules))
        .build()
        .map_err(|e| AppError::Message(e.to_string()))?;
    client
        .put_bucket_cors()
        .bucket(bucket)
        .cors_configuration(cfg)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_bucket_cors(client: &Client, bucket: &str) -> AppResult<()> {
    client
        .delete_bucket_cors()
        .bucket(bucket)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn get_bucket_lifecycle(client: &Client, bucket: &str) -> AppResult<Option<String>> {
    match client
        .get_bucket_lifecycle_configuration()
        .bucket(bucket)
        .send()
        .await
    {
        Ok(out) => {
            let rules: Vec<serde_json::Value> = out
                .rules()
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.id(),
                        "status": r.status().as_str(),
                        "filter": r.filter().map(|f| {
                            serde_json::json!({
                                "prefix": f.prefix(),
                            })
                        }),
                        "expiration": r.expiration().map(|e| {
                            serde_json::json!({
                                "days": e.days(),
                                "expiredObjectDeleteMarker": e.expired_object_delete_marker(),
                            })
                        }),
                        "transitions": r.transitions().iter().map(|t| {
                            serde_json::json!({
                                "days": t.days(),
                                "storageClass": t.storage_class().map(|s| s.as_str()),
                            })
                        }).collect::<Vec<_>>(),
                        "noncurrentVersionExpiration": r.noncurrent_version_expiration().map(|e| {
                            serde_json::json!({ "noncurrentDays": e.noncurrent_days() })
                        }),
                        "abortIncompleteMultipartUpload": r.abort_incomplete_multipart_upload().map(|a| {
                            serde_json::json!({ "daysAfterInitiation": a.days_after_initiation() })
                        }),
                    })
                })
                .collect();
            Ok(Some(serde_json::to_string_pretty(&rules)?))
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("NoSuchLifecycleConfiguration")
                || msg.contains("404")
                || msg.contains("NoSuchLifecycle")
            {
                Ok(None)
            } else {
                Err(map_sdk_err(e))
            }
        }
    }
}

pub async fn put_bucket_lifecycle(client: &Client, bucket: &str, rules_json: &str) -> AppResult<()> {
    use aws_sdk_s3::types::{
        BucketLifecycleConfiguration, ExpirationStatus, LifecycleExpiration, LifecycleRule,
        LifecycleRuleFilter, Transition, TransitionStorageClass,
    };
    let value: serde_json::Value = serde_json::from_str(rules_json)?;
    let arr = value
        .as_array()
        .ok_or_else(|| AppError::Message("Lifecycle JSON must be an array of rules".into()))?;
    let mut rules = Vec::new();
    for item in arr {
        let status_str = item
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("Enabled");
        let status = match status_str {
            "Disabled" => ExpirationStatus::Disabled,
            _ => ExpirationStatus::Enabled,
        };
        let mut builder = LifecycleRule::builder().status(status);
        if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
            builder = builder.id(id);
        }
        if let Some(prefix) = item
            .pointer("/filter/prefix")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("prefix").and_then(|v| v.as_str()))
        {
            let filter = LifecycleRuleFilter::builder().prefix(prefix).build();
            builder = builder.filter(filter);
        }
        if let Some(days) = item.pointer("/expiration/days").and_then(|v| v.as_i64()) {
            let exp = LifecycleExpiration::builder().days(days as i32).build();
            builder = builder.expiration(exp);
        }
        if let Some(transitions) = item.get("transitions").and_then(|v| v.as_array()) {
            for t in transitions {
                let days = t.get("days").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                let mut tb = Transition::builder().days(days);
                if let Some(class_str) = t.get("storageClass").and_then(|v| v.as_str()) {
                    if let Ok(class) = TransitionStorageClass::try_parse(class_str) {
                        tb = tb.storage_class(class);
                    }
                }
                builder = builder.transitions(tb.build());
            }
        }
        rules.push(
            builder
                .build()
                .map_err(|e| AppError::Message(e.to_string()))?,
        );
    }
    let cfg = BucketLifecycleConfiguration::builder()
        .set_rules(Some(rules))
        .build()
        .map_err(|e| AppError::Message(e.to_string()))?;
    client
        .put_bucket_lifecycle_configuration()
        .bucket(bucket)
        .lifecycle_configuration(cfg)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

pub async fn delete_bucket_lifecycle(client: &Client, bucket: &str) -> AppResult<()> {
    client
        .delete_bucket_lifecycle()
        .bucket(bucket)
        .send()
        .await
        .map_err(map_sdk_err)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionInfo {
    pub algorithm: Option<String>,
}

pub async fn get_bucket_encryption(client: &Client, bucket: &str) -> AppResult<EncryptionInfo> {
    match client
        .get_bucket_encryption()
        .bucket(bucket)
        .send()
        .await
    {
        Ok(out) => {
            let algorithm = out
                .server_side_encryption_configuration()
                .and_then(|c| c.rules().first())
                .and_then(|r| r.apply_server_side_encryption_by_default())
                .map(|d| d.sse_algorithm().as_str().to_string());
            Ok(EncryptionInfo { algorithm })
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("ServerSideEncryptionConfigurationNotFoundError")
                || msg.contains("404")
                || msg.contains("NoSuch")
            {
                Ok(EncryptionInfo { algorithm: None })
            } else {
                Err(map_sdk_err(e))
            }
        }
    }
}

pub async fn put_bucket_encryption(
    client: &Client,
    bucket: &str,
    mode: &str,
) -> AppResult<()> {
    match mode {
        "none" => {
            client
                .delete_bucket_encryption()
                .bucket(bucket)
                .send()
                .await
                .map_err(map_sdk_err)?;
        }
        "sseS3" | "AES256" => {
            let default = ServerSideEncryptionByDefault::builder()
                .sse_algorithm(ServerSideEncryption::Aes256)
                .build()
                .map_err(|e| AppError::Message(e.to_string()))?;
            let rule = ServerSideEncryptionRule::builder()
                .apply_server_side_encryption_by_default(default)
                .build();
            let cfg = ServerSideEncryptionConfiguration::builder()
                .rules(rule)
                .build()
                .map_err(|e| AppError::Message(e.to_string()))?;
            client
                .put_bucket_encryption()
                .bucket(bucket)
                .server_side_encryption_configuration(cfg)
                .send()
                .await
                .map_err(map_sdk_err)?;
        }
        other => {
            return Err(AppError::Message(format!(
                "Unknown encryption mode: {other} (use sseS3 or none)"
            )));
        }
    }
    Ok(())
}

pub async fn empty_bucket(client: &Client, bucket: &str) -> AppResult<u64> {
    use aws_sdk_s3::types::{Delete, ObjectIdentifier};
    let mut deleted: u64 = 0;
    let mut token: Option<String> = None;
    loop {
        let mut req = client
            .list_objects_v2()
            .bucket(bucket)
            .max_keys(1000);
        if let Some(t) = token {
            req = req.continuation_token(t);
        }
        let out = req.send().await.map_err(map_sdk_err)?;
        let keys: Vec<_> = out
            .contents()
            .iter()
            .filter_map(|o| o.key().map(|k| k.to_string()))
            .collect();
        if !keys.is_empty() {
            let objects: Vec<_> = keys
                .iter()
                .filter_map(|k| ObjectIdentifier::builder().key(k).build().ok())
                .collect();
            let del = Delete::builder()
                .set_objects(Some(objects))
                .quiet(true)
                .build()
                .map_err(|e| AppError::Message(e.to_string()))?;
            client
                .delete_objects()
                .bucket(bucket)
                .delete(del)
                .send()
                .await
                .map_err(map_sdk_err)?;
            deleted += keys.len() as u64;
        }
        if out.is_truncated().unwrap_or(false) {
            token = out.next_continuation_token().map(|s| s.to_string());
            if token.is_none() {
                break;
            }
        } else {
            // After deleting, list again in case more appeared / pagination with deletes
            if keys.is_empty() {
                break;
            }
            token = None;
        }
    }
    Ok(deleted)
}
