use crate::error::AppResult;
use crate::s3::{self, AclInfo};
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
pub async fn get_bucket_acl(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
) -> AppResult<AclInfo> {
    let client = client_for(&state, &account_id).await?;
    s3::get_bucket_acl(&client, &bucket).await
}

#[tauri::command]
pub async fn put_bucket_acl(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    canned_acl: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::put_bucket_acl(&client, &bucket, &canned_acl).await
}

#[tauri::command]
pub async fn get_object_acl(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    key: String,
) -> AppResult<AclInfo> {
    let client = client_for(&state, &account_id).await?;
    s3::get_object_acl(&client, &bucket, &key).await
}

#[tauri::command]
pub async fn put_object_acl(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    key: String,
    canned_acl: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::put_object_acl(&client, &bucket, &key, &canned_acl).await
}

#[tauri::command]
pub async fn get_bucket_policy(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
) -> AppResult<Option<String>> {
    let client = client_for(&state, &account_id).await?;
    s3::get_bucket_policy(&client, &bucket).await
}

#[tauri::command]
pub async fn put_bucket_policy(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    policy: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::put_bucket_policy(&client, &bucket, &policy).await
}

#[tauri::command]
pub async fn delete_bucket_policy(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::delete_bucket_policy(&client, &bucket).await
}
