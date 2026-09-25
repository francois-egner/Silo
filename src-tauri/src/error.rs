use serde::Serialize;
use std::error::Error as StdError;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("S3 error: {0}")]
    S3(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Account not found")]
    AccountNotFound,
    #[error("Cancelled")]
    Cancelled,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<aws_sdk_s3::Error> for AppError {
    fn from(value: aws_sdk_s3::Error) -> Self {
        AppError::S3(sanitize_s3_error(&format_error_chain(&value)))
    }
}

/// Walk the error chain so "dispatch failure" includes the real cause
/// (DNS, connection refused, TLS, etc.).
pub fn format_error_chain(err: &dyn StdError) -> String {
    let mut parts = Vec::new();
    let mut current: Option<&dyn StdError> = Some(err);
    while let Some(e) = current {
        let s = e.to_string();
        if parts.last().map(|p: &String| p != &s).unwrap_or(true) {
            parts.push(s);
        }
        current = e.source();
    }
    let joined = parts.join(" — ");
    if joined.to_lowercase().contains("dispatch failure") && parts.len() == 1 {
        format!(
            "{joined} (network/TLS — check endpoint URL, internet access, and that HTTPS/HTTP matches the server)"
        )
    } else {
        joined
    }
}

pub fn sanitize_s3_error(msg: &str) -> String {
    let lower = msg.to_lowercase();
    if lower.contains("secretaccesskey") || lower.contains("secret_access_key") {
        "S3 request failed (credentials or permissions may be incorrect)".into()
    } else {
        msg.chars().take(800).collect()
    }
}

pub type AppResult<T> = Result<T, AppError>;
