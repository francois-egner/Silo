use crate::error::{AppError, AppResult};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

const MULTIPART_THRESHOLD: u64 = 16 * 1024 * 1024; // 16 MiB
const PART_SIZE: usize = 8 * 1024 * 1024; // 8 MiB

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub id: String,
    pub kind: String,
    pub key: String,
    pub bytes: u64,
    pub total: u64,
    pub status: String,
    pub error: Option<String>,
}

fn emit_progress(app: &AppHandle, progress: &TransferProgress) {
    let _ = app.emit("transfer://progress", progress);
}

fn map_err(e: impl std::error::Error) -> AppError {
    let msg = crate::error::format_error_chain(&e);
    tracing::warn!(error = %msg, "S3 transfer failed");
    AppError::S3(crate::error::sanitize_s3_error(&msg))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadItem {
    pub local_path: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub key: String,
    pub local_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItem {
    pub source_key: String,
    pub dest_key: String,
}

pub async fn upload_objects(
    app: &AppHandle,
    client: &Client,
    bucket: &str,
    items: Vec<UploadItem>,
) -> AppResult<Vec<String>> {
    let mut ids = Vec::new();
    for item in items {
        let id = Uuid::new_v4().to_string();
        ids.push(id.clone());
        let path = PathBuf::from(&item.local_path);
        match upload_one(app, client, bucket, &path, &item.key, &id).await {
            Ok(()) => {}
            Err(e) => {
                emit_progress(
                    app,
                    &TransferProgress {
                        id,
                        kind: "upload".into(),
                        key: item.key,
                        bytes: 0,
                        total: 0,
                        status: "error".into(),
                        error: Some(e.to_string()),
                    },
                );
            }
        }
    }
    Ok(ids)
}

async fn upload_one(
    app: &AppHandle,
    client: &Client,
    bucket: &str,
    path: &Path,
    key: &str,
    id: &str,
) -> AppResult<()> {
    let meta = tokio::fs::metadata(path).await?;
    let total = meta.len();

    emit_progress(
        app,
        &TransferProgress {
            id: id.to_string(),
            kind: "upload".into(),
            key: key.to_string(),
            bytes: 0,
            total,
            status: "running".into(),
            error: None,
        },
    );

    if total < MULTIPART_THRESHOLD {
        let body = ByteStream::from_path(path).await.map_err(map_err)?;
        client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(body)
            .send()
            .await
            .map_err(map_err)?;
        emit_progress(
            app,
            &TransferProgress {
                id: id.to_string(),
                kind: "upload".into(),
                key: key.to_string(),
                bytes: total,
                total,
                status: "done".into(),
                error: None,
            },
        );
        return Ok(());
    }

    let create = client
        .create_multipart_upload()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(map_err)?;
    let upload_id = create
        .upload_id()
        .ok_or_else(|| AppError::Message("Missing upload id".into()))?
        .to_string();

    let mut file = File::open(path).await?;
    let mut part_number: i32 = 1;
    let mut uploaded: u64 = 0;
    let mut completed_parts = Vec::new();
    let mut buf = vec![0u8; PART_SIZE];

    let result: AppResult<()> = async {
        loop {
            let mut filled = 0usize;
            while filled < PART_SIZE {
                let n = file.read(&mut buf[filled..]).await?;
                if n == 0 {
                    break;
                }
                filled += n;
            }
            if filled == 0 {
                break;
            }

            let body = ByteStream::from(buf[..filled].to_vec());
            let part = client
                .upload_part()
                .bucket(bucket)
                .key(key)
                .upload_id(&upload_id)
                .part_number(part_number)
                .body(body)
                .send()
                .await
                .map_err(map_err)?;

            let etag = part
                .e_tag()
                .ok_or_else(|| AppError::Message("Missing part ETag".into()))?
                .to_string();
            completed_parts.push(
                CompletedPart::builder()
                    .e_tag(etag)
                    .part_number(part_number)
                    .build(),
            );

            uploaded += filled as u64;
            emit_progress(
                app,
                &TransferProgress {
                    id: id.to_string(),
                    kind: "upload".into(),
                    key: key.to_string(),
                    bytes: uploaded.min(total),
                    total,
                    status: "running".into(),
                    error: None,
                },
            );
            part_number += 1;
        }

        let completed = CompletedMultipartUpload::builder()
            .set_parts(Some(completed_parts))
            .build();

        client
            .complete_multipart_upload()
            .bucket(bucket)
            .key(key)
            .upload_id(&upload_id)
            .multipart_upload(completed)
            .send()
            .await
            .map_err(map_err)?;
        Ok(())
    }
    .await;

    if let Err(e) = &result {
        let _ = client
            .abort_multipart_upload()
            .bucket(bucket)
            .key(key)
            .upload_id(&upload_id)
            .send()
            .await;
        return Err(AppError::Message(e.to_string()));
    }

    emit_progress(
        app,
        &TransferProgress {
            id: id.to_string(),
            kind: "upload".into(),
            key: key.to_string(),
            bytes: total,
            total,
            status: "done".into(),
            error: None,
        },
    );
    Ok(())
}

pub async fn download_objects(
    app: &AppHandle,
    client: &Client,
    bucket: &str,
    items: Vec<DownloadItem>,
) -> AppResult<Vec<String>> {
    let mut ids = Vec::new();
    for item in items {
        let id = Uuid::new_v4().to_string();
        ids.push(id.clone());
        match download_one(app, client, bucket, &item.key, Path::new(&item.local_path), &id).await
        {
            Ok(()) => {}
            Err(e) => {
                emit_progress(
                    app,
                    &TransferProgress {
                        id,
                        kind: "download".into(),
                        key: item.key,
                        bytes: 0,
                        total: 0,
                        status: "error".into(),
                        error: Some(e.to_string()),
                    },
                );
            }
        }
    }
    Ok(ids)
}

async fn download_one(
    app: &AppHandle,
    client: &Client,
    bucket: &str,
    key: &str,
    dest: &Path,
    id: &str,
) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let out = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(map_err)?;

    let total = out.content_length().unwrap_or(0).max(0) as u64;
    emit_progress(
        app,
        &TransferProgress {
            id: id.to_string(),
            kind: "download".into(),
            key: key.to_string(),
            bytes: 0,
            total,
            status: "running".into(),
            error: None,
        },
    );

    let mut body = out.body;
    let mut file = File::create(dest).await?;
    let mut written: u64 = 0;

    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(map_err)?;
        file.write_all(&chunk).await?;
        written += chunk.len() as u64;
        emit_progress(
            app,
            &TransferProgress {
                id: id.to_string(),
                kind: "download".into(),
                key: key.to_string(),
                bytes: written,
                total: if total == 0 { written } else { total },
                status: "running".into(),
                error: None,
            },
        );
    }
    file.flush().await?;

    emit_progress(
        app,
        &TransferProgress {
            id: id.to_string(),
            kind: "download".into(),
            key: key.to_string(),
            bytes: written,
            total: if total == 0 { written } else { total },
            status: "done".into(),
            error: None,
        },
    );
    Ok(())
}

/// Returns (transfer ids, successfully copied source keys).
pub async fn copy_objects(
    app: &AppHandle,
    src_client: &Client,
    dest_client: &Client,
    src_bucket: &str,
    dest_bucket: &str,
    items: Vec<CopyItem>,
    same_account: bool,
) -> AppResult<(Vec<String>, Vec<String>)> {
    let mut ids = Vec::new();
    let mut copied_sources = Vec::new();
    for item in items {
        let id = Uuid::new_v4().to_string();
        ids.push(id.clone());

        if src_bucket == dest_bucket && item.source_key == item.dest_key {
            emit_progress(
                app,
                &TransferProgress {
                    id,
                    kind: "copy".into(),
                    key: item.dest_key,
                    bytes: 0,
                    total: 0,
                    status: "error".into(),
                    error: Some("Same location — nothing to copy".into()),
                },
            );
            continue;
        }

        let result = if same_account {
            match server_copy_one(
                app,
                dest_client,
                src_bucket,
                dest_bucket,
                &item.source_key,
                &item.dest_key,
                &id,
            )
            .await
            {
                Ok(()) => Ok(()),
                // Some S3-compatible stores mishandle CopyObject (e.g. odd NoSuchKey);
                // fall back to GetObject + PutObject which already works for downloads.
                Err(_) => {
                    stream_copy_one(
                        app,
                        src_client,
                        dest_client,
                        src_bucket,
                        dest_bucket,
                        &item.source_key,
                        &item.dest_key,
                        &id,
                    )
                    .await
                }
            }
        } else {
            stream_copy_one(
                app,
                src_client,
                dest_client,
                src_bucket,
                dest_bucket,
                &item.source_key,
                &item.dest_key,
                &id,
            )
            .await
        };
        match result {
            Ok(()) => copied_sources.push(item.source_key),
            Err(e) => {
                emit_progress(
                    app,
                    &TransferProgress {
                        id,
                        kind: "copy".into(),
                        key: item.dest_key,
                        bytes: 0,
                        total: 0,
                        status: "error".into(),
                        error: Some(e.to_string()),
                    },
                );
            }
        }
    }
    Ok((ids, copied_sources))
}

async fn server_copy_one(
    app: &AppHandle,
    client: &Client,
    src_bucket: &str,
    dest_bucket: &str,
    source_key: &str,
    dest_key: &str,
    id: &str,
) -> AppResult<()> {
    emit_progress(
        app,
        &TransferProgress {
            id: id.to_string(),
            kind: "copy".into(),
            key: dest_key.to_string(),
            bytes: 0,
            total: 0,
            status: "running".into(),
            error: None,
        },
    );
    crate::s3::ops::copy_object(client, src_bucket, dest_bucket, source_key, dest_key).await?;
    emit_progress(
        app,
        &TransferProgress {
            id: id.to_string(),
            kind: "copy".into(),
            key: dest_key.to_string(),
            bytes: 0,
            total: 0,
            status: "done".into(),
            error: None,
        },
    );
    Ok(())
}

async fn stream_copy_one(
    app: &AppHandle,
    src_client: &Client,
    dest_client: &Client,
    src_bucket: &str,
    dest_bucket: &str,
    source_key: &str,
    dest_key: &str,
    id: &str,
) -> AppResult<()> {
    let out = src_client
        .get_object()
        .bucket(src_bucket)
        .key(source_key)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!(
                src_bucket = %src_bucket,
                source_key = %source_key,
                dest_bucket = %dest_bucket,
                dest_key = %dest_key,
                error = %crate::error::format_error_chain(&e),
                "S3 GetObject failed during stream copy"
            );
            map_err(e)
        })?;

    let total = out.content_length().unwrap_or(0).max(0) as u64;
    emit_progress(
        app,
        &TransferProgress {
            id: id.to_string(),
            kind: "copy".into(),
            key: dest_key.to_string(),
            bytes: 0,
            total,
            status: "running".into(),
            error: None,
        },
    );

    let mut body = out.body;

    if total > 0 && total < MULTIPART_THRESHOLD {
        let mut buf = Vec::with_capacity(total as usize);
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(map_err)?;
            buf.extend_from_slice(&chunk);
            emit_progress(
                app,
                &TransferProgress {
                    id: id.to_string(),
                    kind: "copy".into(),
                    key: dest_key.to_string(),
                    bytes: buf.len() as u64,
                    total,
                    status: "running".into(),
                    error: None,
                },
            );
        }
        dest_client
            .put_object()
            .bucket(dest_bucket)
            .key(dest_key)
            .body(ByteStream::from(buf))
            .send()
            .await
            .map_err(map_err)?;
    } else if total == 0 {
        let mut buf = Vec::new();
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(map_err)?;
            buf.extend_from_slice(&chunk);
            emit_progress(
                app,
                &TransferProgress {
                    id: id.to_string(),
                    kind: "copy".into(),
                    key: dest_key.to_string(),
                    bytes: buf.len() as u64,
                    total: buf.len() as u64,
                    status: "running".into(),
                    error: None,
                },
            );
        }
        let written = buf.len() as u64;
        dest_client
            .put_object()
            .bucket(dest_bucket)
            .key(dest_key)
            .body(ByteStream::from(buf))
            .send()
            .await
            .map_err(map_err)?;
        emit_progress(
            app,
            &TransferProgress {
                id: id.to_string(),
                kind: "copy".into(),
                key: dest_key.to_string(),
                bytes: written,
                total: written,
                status: "done".into(),
                error: None,
            },
        );
        return Ok(());
    } else {
        let create = dest_client
            .create_multipart_upload()
            .bucket(dest_bucket)
            .key(dest_key)
            .send()
            .await
            .map_err(map_err)?;
        let upload_id = create
            .upload_id()
            .ok_or_else(|| AppError::Message("Missing upload id".into()))?
            .to_string();

        let mut part_number: i32 = 1;
        let mut uploaded: u64 = 0;
        let mut completed_parts = Vec::new();
        let mut part_buf: Vec<u8> = Vec::with_capacity(PART_SIZE);

        let result: AppResult<()> = async {
            while let Some(chunk) = body.next().await {
                let chunk = chunk.map_err(map_err)?;
                part_buf.extend_from_slice(&chunk);
                while part_buf.len() >= PART_SIZE {
                    let part_data: Vec<u8> = part_buf.drain(..PART_SIZE).collect();
                    let filled = part_data.len();
                    let part = dest_client
                        .upload_part()
                        .bucket(dest_bucket)
                        .key(dest_key)
                        .upload_id(&upload_id)
                        .part_number(part_number)
                        .body(ByteStream::from(part_data))
                        .send()
                        .await
                        .map_err(map_err)?;
                    let etag = part
                        .e_tag()
                        .ok_or_else(|| AppError::Message("Missing part ETag".into()))?
                        .to_string();
                    completed_parts.push(
                        CompletedPart::builder()
                            .e_tag(etag)
                            .part_number(part_number)
                            .build(),
                    );
                    uploaded += filled as u64;
                    emit_progress(
                        app,
                        &TransferProgress {
                            id: id.to_string(),
                            kind: "copy".into(),
                            key: dest_key.to_string(),
                            bytes: uploaded.min(total),
                            total,
                            status: "running".into(),
                            error: None,
                        },
                    );
                    part_number += 1;
                }
            }

            if !part_buf.is_empty() {
                let filled = part_buf.len();
                let part = dest_client
                    .upload_part()
                    .bucket(dest_bucket)
                    .key(dest_key)
                    .upload_id(&upload_id)
                    .part_number(part_number)
                    .body(ByteStream::from(part_buf))
                    .send()
                    .await
                    .map_err(map_err)?;
                let etag = part
                    .e_tag()
                    .ok_or_else(|| AppError::Message("Missing part ETag".into()))?
                    .to_string();
                completed_parts.push(
                    CompletedPart::builder()
                        .e_tag(etag)
                        .part_number(part_number)
                        .build(),
                );
                uploaded += filled as u64;
                let _ = uploaded;
            }

            if completed_parts.is_empty() {
                let _ = dest_client
                    .abort_multipart_upload()
                    .bucket(dest_bucket)
                    .key(dest_key)
                    .upload_id(&upload_id)
                    .send()
                    .await;
                dest_client
                    .put_object()
                    .bucket(dest_bucket)
                    .key(dest_key)
                    .body(ByteStream::from_static(b""))
                    .send()
                    .await
                    .map_err(map_err)?;
                return Ok(());
            }

            let completed = CompletedMultipartUpload::builder()
                .set_parts(Some(completed_parts))
                .build();
            dest_client
                .complete_multipart_upload()
                .bucket(dest_bucket)
                .key(dest_key)
                .upload_id(&upload_id)
                .multipart_upload(completed)
                .send()
                .await
                .map_err(map_err)?;
            Ok(())
        }
        .await;

        if let Err(e) = &result {
            let _ = dest_client
                .abort_multipart_upload()
                .bucket(dest_bucket)
                .key(dest_key)
                .upload_id(&upload_id)
                .send()
                .await;
            return Err(AppError::Message(e.to_string()));
        }
    }

    emit_progress(
        app,
        &TransferProgress {
            id: id.to_string(),
            kind: "copy".into(),
            key: dest_key.to_string(),
            bytes: total,
            total,
            status: "done".into(),
            error: None,
        },
    );
    Ok(())
}
