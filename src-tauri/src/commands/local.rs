use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedLocalFile {
    pub local_path: String,
    pub relative_key: String,
}

fn resolve_home() -> AppResult<PathBuf> {
    if let Ok(h) = std::env::var("HOME") {
        return Ok(PathBuf::from(h));
    }
    if let Ok(h) = std::env::var("USERPROFILE") {
        return Ok(PathBuf::from(h));
    }
    Err(AppError::Message(
        "Could not determine home directory".into(),
    ))
}

fn system_time_to_iso(t: SystemTime) -> Option<String> {
    let dt: DateTime<Utc> = t.into();
    Some(dt.to_rfc3339())
}

#[tauri::command]
pub fn get_home_dir() -> AppResult<String> {
    Ok(resolve_home()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_local_dir(path: String) -> AppResult<Vec<LocalEntry>> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err(AppError::Message("Path must be absolute".into()));
    }
    let meta = fs::metadata(&p)?;
    if !meta.is_dir() {
        return Err(AppError::Message("Not a directory".into()));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&p)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        let ft = entry.file_type()?;
        let is_dir = ft.is_dir();
        let meta = entry.metadata().ok();
        let size = if is_dir {
            None
        } else {
            meta.as_ref().map(|m| m.len())
        };
        let modified = meta
            .and_then(|m| m.modified().ok())
            .and_then(system_time_to_iso);
        entries.push(LocalEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
            size,
            modified,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn expand_local_files(paths: Vec<String>) -> AppResult<Vec<ExpandedLocalFile>> {
    let mut out = Vec::new();
    for path_str in paths {
        let path = PathBuf::from(&path_str);
        if !path.is_absolute() {
            return Err(AppError::Message(format!(
                "Path must be absolute: {path_str}"
            )));
        }
        if !path.exists() {
            return Err(AppError::Message(format!("Path not found: {path_str}")));
        }
        let base_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".into());
        if path.is_file() {
            out.push(ExpandedLocalFile {
                local_path: path.to_string_lossy().to_string(),
                relative_key: base_name.replace('\\', "/"),
            });
        } else if path.is_dir() {
            walk_dir(&path, &base_name, &mut out)?;
        }
    }
    Ok(out)
}

fn walk_dir(dir: &Path, rel: &str, out: &mut Vec<ExpandedLocalFile>) -> AppResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        let child_rel = format!("{rel}/{name}");
        let path = entry.path();
        if path.is_dir() {
            walk_dir(&path, &child_rel, out)?;
        } else if path.is_file() {
            out.push(ExpandedLocalFile {
                local_path: path.to_string_lossy().to_string(),
                relative_key: child_rel.replace('\\', "/"),
            });
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStat {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub modified: Option<String>,
}

#[tauri::command]
pub fn stat_local_path(path: String) -> AppResult<LocalStat> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err(AppError::Message("Path must be absolute".into()));
    }
    let meta = fs::metadata(&p)?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let modified = meta.modified().ok().and_then(system_time_to_iso);

    if meta.is_file() {
        return Ok(LocalStat {
            name,
            path,
            is_dir: false,
            size: meta.len(),
            file_count: 1,
            dir_count: 0,
            modified,
        });
    }
    if !meta.is_dir() {
        return Err(AppError::Message("Not a file or directory".into()));
    }

    let mut size = 0u64;
    let mut file_count = 0u64;
    let mut dir_count = 0u64;
    walk_stat(&p, &mut size, &mut file_count, &mut dir_count)?;

    Ok(LocalStat {
        name,
        path,
        is_dir: true,
        size,
        file_count,
        dir_count,
        modified,
    })
}

fn walk_stat(
    dir: &Path,
    size: &mut u64,
    file_count: &mut u64,
    dir_count: &mut u64,
) -> AppResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_dir() {
            *dir_count += 1;
            walk_stat(&path, size, file_count, dir_count)?;
        } else if meta.is_file() {
            *file_count += 1;
            *size += meta.len();
        }
    }
    Ok(())
}
