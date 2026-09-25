mod commands;
mod error;
mod s3;
mod storage;

use commands::*;
use s3::ClientManager;
use std::sync::Mutex;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub clients: ClientManager,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // rustls 0.23 requires an explicit process-default crypto provider.
    // Without this, HTTPS S3 calls fail with a vague "dispatch failure".
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("silo=info".parse().unwrap()))
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let conn = storage::open_db(app.handle())?;
            app.manage(AppState {
                db: Mutex::new(conn),
                clients: ClientManager::new(),
            });

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                    tracing::info!("DevTools opened — use the Console tab for frontend logs");
                }
            }

            tracing::info!("Silo ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            upsert_account,
            delete_account,
            duplicate_account,
            test_account,
            get_active_account,
            set_active_account,
            reveal_secret,
            list_buckets,
            create_bucket,
            delete_bucket,
            empty_bucket,
            list_objects,
            upload_objects,
            download_objects,
            delete_objects,
            copy_object,
            copy_objects,
            create_folder,
            presign_get,
            get_bucket_acl,
            put_bucket_acl,
            get_object_acl,
            put_object_acl,
            get_bucket_policy,
            put_bucket_policy,
            delete_bucket_policy,
            get_bucket_versioning,
            put_bucket_versioning,
            get_bucket_cors,
            put_bucket_cors,
            delete_bucket_cors,
            get_bucket_lifecycle,
            put_bucket_lifecycle,
            delete_bucket_lifecycle,
            get_bucket_encryption,
            put_bucket_encryption,
            list_local_dir,
            get_home_dir,
            expand_local_files,
            stat_local_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
