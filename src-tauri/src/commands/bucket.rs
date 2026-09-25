use crate::error::AppResult;
use crate::s3::{self, BucketInfo};
use crate::storage;
use crate::AppState;
use tauri::State;

async fn client_for(state: &State<'_, AppState>, account_id: &str) -> AppResult<aws_sdk_s3::Client> {
    let account = {
        let db = state
            .db
            .lock()
            .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
        storage::get_account(&db, account_id)?
    };
    state.clients.get_or_create(&account).await
}

#[tauri::command]
pub async fn list_buckets(
    state: State<'_, AppState>,
    account_id: String,
) -> AppResult<Vec<BucketInfo>> {
    let client = client_for(&state, &account_id).await?;
    s3::list_buckets(&client).await
}

#[tauri::command]
pub async fn create_bucket(
    state: State<'_, AppState>,
    account_id: String,
    name: String,
    region: Option<String>,
) -> AppResult<()> {
    let account = {
        let db = state
            .db
            .lock()
            .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
        storage::get_account(&db, &account_id)?
    };
    let region = region.unwrap_or(account.region.clone());
    let client = state.clients.get_or_create(&account).await?;
    s3::create_bucket(&client, &name, &region).await
}

#[tauri::command]
pub async fn delete_bucket(
    state: State<'_, AppState>,
    account_id: String,
    name: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::delete_bucket(&client, &name).await
}

#[tauri::command]
pub async fn empty_bucket(
    state: State<'_, AppState>,
    account_id: String,
    name: String,
) -> AppResult<u64> {
    let client = client_for(&state, &account_id).await?;
    s3::empty_bucket(&client, &name).await
}

#[tauri::command]
pub async fn get_bucket_versioning(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
) -> AppResult<s3::VersioningInfo> {
    let client = client_for(&state, &account_id).await?;
    s3::get_bucket_versioning(&client, &bucket).await
}

#[tauri::command]
pub async fn put_bucket_versioning(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    status: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::put_bucket_versioning(&client, &bucket, &status).await
}

#[tauri::command]
pub async fn get_bucket_cors(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
) -> AppResult<Option<String>> {
    let client = client_for(&state, &account_id).await?;
    s3::get_bucket_cors(&client, &bucket).await
}

#[tauri::command]
pub async fn put_bucket_cors(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    rules_json: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::put_bucket_cors(&client, &bucket, &rules_json).await
}

#[tauri::command]
pub async fn delete_bucket_cors(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::delete_bucket_cors(&client, &bucket).await
}

#[tauri::command]
pub async fn get_bucket_lifecycle(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
) -> AppResult<Option<String>> {
    let client = client_for(&state, &account_id).await?;
    s3::get_bucket_lifecycle(&client, &bucket).await
}

#[tauri::command]
pub async fn put_bucket_lifecycle(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    rules_json: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::put_bucket_lifecycle(&client, &bucket, &rules_json).await
}

#[tauri::command]
pub async fn delete_bucket_lifecycle(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::delete_bucket_lifecycle(&client, &bucket).await
}

#[tauri::command]
pub async fn get_bucket_encryption(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
) -> AppResult<s3::EncryptionInfo> {
    let client = client_for(&state, &account_id).await?;
    s3::get_bucket_encryption(&client, &bucket).await
}

#[tauri::command]
pub async fn put_bucket_encryption(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    mode: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::put_bucket_encryption(&client, &bucket, &mode).await
}
