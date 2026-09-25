use crate::error::AppResult;
use crate::storage::{self, get_pref, set_pref, Account, UpsertAccountInput};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> AppResult<Vec<Account>> {
    let db = state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
    storage::list_accounts(&db)
}

#[tauri::command]
pub fn upsert_account(
    state: State<'_, AppState>,
    input: UpsertAccountInput,
) -> AppResult<Account> {
    let db = state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
    let account = storage::upsert_account(&db, input)?;
    state.clients.invalidate(&account.id);
    Ok(account)
}

#[tauri::command]
pub fn delete_account(state: State<'_, AppState>, id: String) -> AppResult<()> {
    {
        let db = state
            .db
            .lock()
            .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
        storage::delete_account(&db, &id)?;
    }
    state.clients.invalidate(&id);
    let db = state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
    let active = get_pref(&db, "active_account")?;
    if active.as_deref() == Some(id.as_str()) {
        set_pref(&db, "active_account", "")?;
    }
    Ok(())
}

#[tauri::command]
pub fn duplicate_account(state: State<'_, AppState>, id: String) -> AppResult<Account> {
    let db = state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
    storage::duplicate_account(&db, &id)
}

#[tauri::command]
pub async fn test_account(
    state: State<'_, AppState>,
    id: Option<String>,
    input: Option<UpsertAccountInput>,
) -> AppResult<Vec<String>> {
    let account = if let Some(id) = id {
        let db = state
            .db
            .lock()
            .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
        storage::get_account(&db, &id)?
    } else if let Some(mut input) = input {
        let temp_id = uuid::Uuid::new_v4().to_string();
        let secret = input
            .secret_access_key
            .clone()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                crate::error::AppError::Message("Secret access key is required".into())
            })?;
        crate::storage::secrets::store_secrets(&temp_id, &secret, input.session_token.as_deref())?;
        let account = Account {
            id: temp_id.clone(),
            name: input.name.clone(),
            provider: input.provider.clone(),
            region: input.region.clone(),
            endpoint_url: input.endpoint_url.take(),
            force_path_style: input.force_path_style,
            access_key_id: input.access_key_id.clone(),
            bucket_filter_mode: input.bucket_filter_mode.clone(),
            visible_buckets: input.visible_buckets.clone(),
            created_at: String::new(),
            updated_at: String::new(),
        };
        let client = crate::s3::build_client(&account).await;
        let buckets = match client {
            Ok(c) => crate::s3::list_buckets(&c).await,
            Err(e) => Err(e),
        };
        let _ = crate::storage::secrets::delete_secrets(&temp_id);
        return Ok(buckets?
            .into_iter()
            .map(|b| b.name)
            .collect());
    } else {
        return Err(crate::error::AppError::Message(
            "Provide account id or input".into(),
        ));
    };

    let client = state.clients.get_or_create(&account).await?;
    let buckets = crate::s3::list_buckets(&client).await?;
    Ok(buckets.into_iter().map(|b| b.name).collect())
}

#[tauri::command]
pub fn get_active_account(state: State<'_, AppState>) -> AppResult<Option<String>> {
    let db = state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
    let v = get_pref(&db, "active_account")?;
    Ok(v.filter(|s| !s.is_empty()))
}

#[tauri::command]
pub fn set_active_account(state: State<'_, AppState>, id: Option<String>) -> AppResult<()> {
    let db = state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
    set_pref(&db, "active_account", id.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn reveal_secret(state: State<'_, AppState>, id: String) -> AppResult<String> {
    let db = state
        .db
        .lock()
        .map_err(|_| crate::error::AppError::Message("DB lock poisoned".into()))?;
    let _ = storage::get_account(&db, &id)?;
    crate::storage::secrets::load_secret(&id)
}
