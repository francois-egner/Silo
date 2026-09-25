use crate::error::AppResult;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

pub fn open_db(app: &AppHandle) -> AppResult<Connection> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| crate::error::AppError::Message(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    crate::storage::secrets::init(&dir)?;

    let path = dir.join("silo.db");
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            region TEXT NOT NULL,
            endpoint_url TEXT,
            force_path_style INTEGER NOT NULL DEFAULT 0,
            access_key_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS prefs (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        ",
    )?;
    migrate_accounts(&conn)?;
    Ok(conn)
}

fn migrate_accounts(conn: &Connection) -> AppResult<()> {
    let mut cols = std::collections::HashSet::new();
    let mut stmt = conn.prepare("PRAGMA table_info(accounts)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for r in rows {
        cols.insert(r?);
    }
    if !cols.contains("bucket_filter_mode") {
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN bucket_filter_mode TEXT NOT NULL DEFAULT 'all'",
            [],
        )?;
    }
    if !cols.contains("visible_buckets") {
        conn.execute(
            "ALTER TABLE accounts ADD COLUMN visible_buckets TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }
    Ok(())
}

pub fn get_pref(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM prefs WHERE key = ?1")?;
    let mut rows = stmt.query([key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_pref(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO prefs (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}
