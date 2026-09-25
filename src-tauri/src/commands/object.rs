use crate::error::AppResult;
use crate::s3::{self, CopyItem, DownloadItem, ListObjectsResult, UploadItem};
use crate::storage;
use crate::AppState;
use tauri::{AppHandle, State};

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
pub async fn list_objects(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    prefix: Option<String>,
    continuation_token: Option<String>,
) -> AppResult<ListObjectsResult> {
    let client = client_for(&state, &account_id).await?;
    s3::list_objects(
        &client,
        &bucket,
        prefix.as_deref().unwrap_or(""),
        continuation_token,
    )
    .await
}

#[tauri::command]
pub async fn upload_objects(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    items: Vec<UploadItem>,
) -> AppResult<Vec<String>> {
    let client = client_for(&state, &account_id).await?;
    s3::upload_objects(&app, &client, &bucket, items).await
}

#[tauri::command]
pub async fn download_objects(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    items: Vec<DownloadItem>,
) -> AppResult<Vec<String>> {
    let client = client_for(&state, &account_id).await?;
    s3::download_objects(&app, &client, &bucket, items).await
}

#[tauri::command]
pub async fn delete_objects(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    keys: Vec<String>,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::delete_objects(&client, &bucket, keys).await
}

#[tauri::command]
pub async fn copy_object(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    source_key: String,
    dest_key: String,
    delete_source: bool,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::copy_object(&client, &bucket, &bucket, &source_key, &dest_key).await?;
    if delete_source {
        s3::delete_objects(&client, &bucket, vec![source_key]).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn copy_objects(
    app: AppHandle,
    state: State<'_, AppState>,
    source_account_id: String,
    source_bucket: String,
    dest_account_id: String,
    dest_bucket: String,
    items: Vec<CopyItem>,
    delete_source: bool,
) -> AppResult<Vec<String>> {
    let src_client = client_for(&state, &source_account_id).await?;
    let dest_client = if source_account_id == dest_account_id {
        src_client.clone()
    } else {
        client_for(&state, &dest_account_id).await?
    };
    let same_account = source_account_id == dest_account_id;
    let (ids, copied) = s3::copy_objects(
        &app,
        &src_client,
        &dest_client,
        &source_bucket,
        &dest_bucket,
        items,
        same_account,
    )
    .await?;
    if delete_source && !copied.is_empty() {
        s3::delete_objects(&src_client, &source_bucket, copied).await?;
    }
    Ok(ids)
}

#[tauri::command]
pub async fn create_folder(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    prefix: String,
) -> AppResult<()> {
    let client = client_for(&state, &account_id).await?;
    s3::create_folder(&client, &bucket, &prefix).await
}

#[tauri::command]
pub async fn presign_get(
    state: State<'_, AppState>,
    account_id: String,
    bucket: String,
    key: String,
    expires_secs: Option<u64>,
) -> AppResult<String> {
    let client = client_for(&state, &account_id).await?;
    s3::presign_get(&client, &bucket, &key, expires_secs.unwrap_or(3600)).await
}
