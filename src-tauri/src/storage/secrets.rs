//! Local encrypted secret vault (no OS Keychain prompts).
//!
//! macOS Keychain re-prompts on every unsigned / rebuilt Tauri binary, so
//! "Always Allow" never sticks. Secrets live in the app data dir instead,
//! encrypted with AES-256-GCM under a local master key (mode 0600).

use crate::error::{AppError, AppResult};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static VAULT: OnceLock<Mutex<Vault>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SecretRecord {
    secret: String,
    token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct VaultFile {
    v: u32,
    entries: HashMap<String, SecretRecord>,
}

struct Vault {
    data_path: PathBuf,
    key: [u8; 32],
    entries: HashMap<String, SecretRecord>,
}

pub fn init(app_data_dir: &Path) -> AppResult<()> {
    fs::create_dir_all(app_data_dir)?;
    let key_path = app_data_dir.join("master.key");
    let data_path = app_data_dir.join("secrets.vault");

    let key = load_or_create_key(&key_path)?;
    let entries = load_entries(&data_path, &key)?;

    let vault = Vault {
        data_path,
        key,
        entries,
    };

    match VAULT.get() {
        None => {
            let _ = VAULT.set(Mutex::new(vault));
        }
        Some(cell) => {
            let mut guard = cell
                .lock()
                .map_err(|_| AppError::Message("Secret vault lock poisoned".into()))?;
            *guard = vault;
        }
    }
    Ok(())
}

fn vault_lock() -> AppResult<std::sync::MutexGuard<'static, Vault>> {
    let cell = VAULT
        .get()
        .ok_or_else(|| AppError::Message("Secret vault not initialized".into()))?;
    cell.lock()
        .map_err(|_| AppError::Message("Secret vault lock poisoned".into()))
}

fn load_or_create_key(path: &Path) -> AppResult<[u8; 32]> {
    if path.exists() {
        let bytes = fs::read(path)?;
        if bytes.len() != 32 {
            return Err(AppError::Message(
                "Corrupt master.key — delete it and re-enter account secrets".into(),
            ));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        return Ok(key);
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    fs::write(path, key)?;
    restrict_permissions(path)?;
    Ok(key)
}

fn restrict_permissions(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(path, perms)?;
    }
    let _ = path;
    Ok(())
}

fn load_entries(path: &Path, key: &[u8; 32]) -> AppResult<HashMap<String, SecretRecord>> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let blob = fs::read(path)?;
    if blob.len() < 12 + 16 {
        return Ok(HashMap::new());
    }
    let (nonce_bytes, ciphertext) = blob.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Message(format!("Vault key error: {e}")))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::Message("Failed to decrypt secrets vault".into()))?;
    let file: VaultFile = serde_json::from_slice(&plain)?;
    Ok(file.entries)
}

fn persist(vault: &Vault) -> AppResult<()> {
    let file = VaultFile {
        v: 1,
        entries: vault.entries.clone(),
    };
    let plain = serde_json::to_vec(&file)?;
    let cipher = Aes256Gcm::new_from_slice(&vault.key)
        .map_err(|e| AppError::Message(format!("Vault key error: {e}")))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plain.as_ref())
        .map_err(|e| AppError::Message(format!("Vault encrypt error: {e}")))?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    fs::write(&vault.data_path, out)?;
    restrict_permissions(&vault.data_path)?;
    Ok(())
}

pub fn store_secrets(
    account_id: &str,
    secret_access_key: &str,
    session_token: Option<&str>,
) -> AppResult<()> {
    let mut vault = vault_lock()?;
    vault.entries.insert(
        account_id.to_string(),
        SecretRecord {
            secret: secret_access_key.to_string(),
            token: session_token
                .filter(|t| !t.is_empty())
                .map(|t| t.to_string()),
        },
    );
    persist(&vault)
}

pub fn load_secret(account_id: &str) -> AppResult<String> {
    let vault = vault_lock()?;
    vault
        .entries
        .get(account_id)
        .map(|r| r.secret.clone())
        .ok_or_else(|| {
            AppError::Message(
                "No secret stored for this account — edit the account and enter the secret key again"
                    .into(),
            )
        })
}

pub fn load_session_token(account_id: &str) -> AppResult<Option<String>> {
    let vault = vault_lock()?;
    Ok(vault.entries.get(account_id).and_then(|r| r.token.clone()))
}

pub fn delete_secrets(account_id: &str) -> AppResult<()> {
    let mut vault = vault_lock()?;
    vault.entries.remove(account_id);
    persist(&vault)
}
