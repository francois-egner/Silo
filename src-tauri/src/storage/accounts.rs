use crate::error::{AppError, AppResult};
use crate::storage::secrets;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Aws,
    Minio,
    R2,
    Spaces,
    Wasabi,
    Custom,
}

impl Provider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::Aws => "aws",
            Provider::Minio => "minio",
            Provider::R2 => "r2",
            Provider::Spaces => "spaces",
            Provider::Wasabi => "wasabi",
            Provider::Custom => "custom",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "minio" => Provider::Minio,
            "r2" => Provider::R2,
            "spaces" => Provider::Spaces,
            "wasabi" => Provider::Wasabi,
            "custom" => Provider::Custom,
            _ => Provider::Aws,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BucketFilterMode {
    All,
    Selected,
}

impl BucketFilterMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            BucketFilterMode::All => "all",
            BucketFilterMode::Selected => "selected",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "selected" => BucketFilterMode::Selected,
            _ => BucketFilterMode::All,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub provider: Provider,
    pub region: String,
    pub endpoint_url: Option<String>,
    pub force_path_style: bool,
    pub access_key_id: String,
    pub bucket_filter_mode: BucketFilterMode,
    pub visible_buckets: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAccountInput {
    pub id: Option<String>,
    pub name: String,
    pub provider: Provider,
    pub region: String,
    pub endpoint_url: Option<String>,
    pub force_path_style: bool,
    pub access_key_id: String,
    /// Omit or empty on edit to keep existing secret.
    pub secret_access_key: Option<String>,
    pub session_token: Option<String>,
    #[serde(default = "default_bucket_filter_mode")]
    pub bucket_filter_mode: BucketFilterMode,
    #[serde(default)]
    pub visible_buckets: Vec<String>,
}

fn default_bucket_filter_mode() -> BucketFilterMode {
    BucketFilterMode::All
}

fn encode_visible_buckets(names: &[String]) -> String {
    serde_json::to_string(names).unwrap_or_else(|_| "[]".into())
}

fn decode_visible_buckets(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn normalize_visible_buckets(names: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = names
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

fn row_to_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    let visible_raw: String = row.get(8)?;
    Ok(Account {
        id: row.get(0)?,
        name: row.get(1)?,
        provider: Provider::parse(&row.get::<_, String>(2)?),
        region: row.get(3)?,
        endpoint_url: row.get(4)?,
        force_path_style: row.get::<_, i64>(5)? != 0,
        access_key_id: row.get(6)?,
        bucket_filter_mode: BucketFilterMode::parse(&row.get::<_, String>(7)?),
        visible_buckets: decode_visible_buckets(&visible_raw),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

const ACCOUNT_COLS: &str = "id, name, provider, region, endpoint_url, force_path_style, access_key_id, bucket_filter_mode, visible_buckets, created_at, updated_at";

pub fn list_accounts(conn: &Connection) -> AppResult<Vec<Account>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ACCOUNT_COLS} FROM accounts ORDER BY name COLLATE NOCASE ASC"
    ))?;
    let rows = stmt.query_map([], row_to_account)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_account(conn: &Connection, id: &str) -> AppResult<Account> {
    conn.query_row(
        &format!("SELECT {ACCOUNT_COLS} FROM accounts WHERE id = ?1"),
        [id],
        row_to_account,
    )
    .map_err(|_| AppError::AccountNotFound)
}

pub fn upsert_account(conn: &Connection, input: UpsertAccountInput) -> AppResult<Account> {
    let now: DateTime<Utc> = Utc::now();
    let now_s = now.to_rfc3339();
    let is_new = input.id.is_none();
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let name = input.name.trim().to_string();
    let region = input.region.trim().to_string();
    let access_key_id = input.access_key_id.trim().to_string();
    let endpoint_url = input
        .endpoint_url
        .as_ref()
        .map(|s| crate::s3::normalize_endpoint_url(s))
        .filter(|s| !s.is_empty());

    if region.is_empty() {
        return Err(AppError::Message("Region is required".into()));
    }
    if access_key_id.is_empty() {
        return Err(AppError::Message("Access key ID is required".into()));
    }

    let visible_buckets = normalize_visible_buckets(input.visible_buckets);
    let visible_json = encode_visible_buckets(&visible_buckets);
    let filter_mode = if input.bucket_filter_mode == BucketFilterMode::Selected
        && visible_buckets.is_empty()
    {
        BucketFilterMode::All
    } else {
        input.bucket_filter_mode
    };

    if is_new {
        let secret = input
            .secret_access_key
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Message("Secret access key is required".into()))?;
        secrets::store_secrets(&id, secret, input.session_token.as_deref())?;
        conn.execute(
            "INSERT INTO accounts (id, name, provider, region, endpoint_url, force_path_style, access_key_id, bucket_filter_mode, visible_buckets, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                name,
                input.provider.as_str(),
                region,
                endpoint_url,
                input.force_path_style as i64,
                access_key_id,
                filter_mode.as_str(),
                visible_json,
                now_s,
                now_s,
            ],
        )?;
    } else {
        if let Some(secret) = input
            .secret_access_key
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            secrets::store_secrets(&id, secret, input.session_token.as_deref())?;
        } else if input.session_token.is_some() {
            let existing = secrets::load_secret(&id)?;
            secrets::store_secrets(&id, &existing, input.session_token.as_deref())?;
        }
        let updated = conn.execute(
            "UPDATE accounts SET name=?2, provider=?3, region=?4, endpoint_url=?5,
             force_path_style=?6, access_key_id=?7, bucket_filter_mode=?8, visible_buckets=?9, updated_at=?10 WHERE id=?1",
            params![
                id,
                name,
                input.provider.as_str(),
                region,
                endpoint_url,
                input.force_path_style as i64,
                access_key_id,
                filter_mode.as_str(),
                visible_json,
                now_s,
            ],
        )?;
        if updated == 0 {
            return Err(AppError::AccountNotFound);
        }
    }

    get_account(conn, &id)
}

pub fn delete_account(conn: &Connection, id: &str) -> AppResult<()> {
    let n = conn.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::AccountNotFound);
    }
    let _ = secrets::delete_secrets(id);
    Ok(())
}

pub fn duplicate_account(conn: &Connection, id: &str) -> AppResult<Account> {
    let src = get_account(conn, id)?;
    let secret = secrets::load_secret(id)?;
    let token = secrets::load_session_token(id)?;
    upsert_account(
        conn,
        UpsertAccountInput {
            id: None,
            name: format!("{} (copy)", src.name),
            provider: src.provider,
            region: src.region,
            endpoint_url: src.endpoint_url,
            force_path_style: src.force_path_style,
            access_key_id: src.access_key_id,
            secret_access_key: Some(secret),
            session_token: token,
            bucket_filter_mode: src.bucket_filter_mode,
            visible_buckets: src.visible_buckets,
        },
    )
}
