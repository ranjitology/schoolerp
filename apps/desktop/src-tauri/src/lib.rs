//! SchoolERP desktop shell.
//!
//! The web client is reused unchanged; this crate adds a small, auditable
//! offline store. The database is SQLCipher-encrypted, the key lives in a
//! per-install key file (replace with the OS keychain before production), and
//! every mutation travels through the same outbox contract as
//! `@schoolerp/core/outbox`.

use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS outbox (
  id                TEXT PRIMARY KEY,
  entity            TEXT NOT NULL,
  operation         TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  payload           TEXT NOT NULL,
  client_sequence   INTEGER NOT NULL,
  client_timestamp  TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  base_version      INTEGER,
  status            TEXT NOT NULL DEFAULT 'PENDING',
  created_at        TEXT NOT NULL,
  synced_at         TEXT
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx
  ON outbox (status, entity, client_sequence);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

struct Db(Mutex<Connection>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutboxInput {
    id: String,
    entity: String,
    operation: String,
    entity_id: String,
    payload: serde_json::Value,
    client_sequence: i64,
    client_timestamp: String,
    idempotency_key: String,
    #[serde(default)]
    base_version: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutboxRecord {
    id: String,
    entity: String,
    operation: String,
    entity_id: String,
    payload: serde_json::Value,
    client_sequence: i64,
    client_timestamp: String,
    idempotency_key: String,
    attempts: i64,
    last_error: Option<String>,
    base_version: Option<i64>,
    status: String,
    created_at: String,
    synced_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutboxStats {
    pending: i64,
    failed: i64,
    synced: i64,
    total: i64,
}

#[derive(Debug, Serialize)]
struct DeviceInfo {
    device_id: String,
    platform: &'static str,
    schema_version: i64,
    encrypted: bool,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

/// Loads the SQLCipher key from the environment, or creates a 256-bit key file
/// next to the database. Production installs should wrap this in the OS
/// credential store; the interface stays the same.
fn load_or_create_key(dir: &Path) -> Result<String, Box<dyn std::error::Error>> {
    if let Ok(key) = std::env::var("SCHOOLERP_DB_KEY") {
        if key.len() >= 32 {
            return Ok(key);
        }
    }
    let key_path = dir.join("offline.key");
    if let Ok(existing) = fs::read_to_string(&key_path) {
        let trimmed = existing.trim().to_string();
        if trimmed.len() >= 32 {
            return Ok(trimmed);
        }
    }
    let key = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    fs::write(&key_path, &key)?;
    restrict_permissions(&key_path);
    Ok(key)
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

fn open_db(app: &tauri::AppHandle) -> Result<Connection, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    fs::create_dir_all(&dir)?;
    let key = load_or_create_key(&dir)?;
    let conn = Connection::open(dir.join("schoolerp.db"))?;
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.pragma_update(None, "key", &key)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Confirms the key is valid before any table is touched.
    conn.pragma_query_value(None, "cipher_version", |row| row.get::<_, String>(0))
        .map_err(|_| "offline database key rejected")?;
    conn.execute_batch(SCHEMA)?;
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_version', '1')
         ON CONFLICT(key) DO NOTHING",
        [],
    )?;
    Ok(conn)
}

fn lock<'a>(db: &'a Db) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    db.0.lock().map_err(|_| "offline store is unavailable".to_string())
}

#[tauri::command]
fn outbox_enqueue(db: tauri::State<'_, Db>, input: OutboxInput) -> Result<OutboxRecord, String> {
    let conn = lock(&db)?;
    let payload = serde_json::to_string(&input.payload).map_err(|error| error.to_string())?;
    let created_at = now();
    conn.execute(
        "INSERT OR IGNORE INTO outbox
         (id, entity, operation, entity_id, payload, client_sequence, client_timestamp,
          idempotency_key, base_version, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'PENDING', ?10)",
        params![
            input.id,
            input.entity,
            input.operation,
            input.entity_id,
            payload,
            input.client_sequence,
            input.client_timestamp,
            input.idempotency_key,
            input.base_version,
            created_at,
        ],
    )
    .map_err(|error| error.to_string())?;

    read_by_key(&conn, &input.idempotency_key)
}

#[tauri::command]
fn outbox_pending(db: tauri::State<'_, Db>, limit: Option<i64>) -> Result<Vec<OutboxRecord>, String> {
    let conn = lock(&db)?;
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let mut statement = conn
        .prepare(
            "SELECT id, entity, operation, entity_id, payload, client_sequence, client_timestamp,
                    idempotency_key, attempts, last_error, base_version, status, created_at, synced_at
             FROM outbox
             WHERE status = 'PENDING'
             ORDER BY CASE entity
                        WHEN 'FEE_PAYMENT' THEN 10
                        WHEN 'EXPENSE' THEN 20
                        WHEN 'ATTENDANCE' THEN 30
                        WHEN 'STUDENT' THEN 40
                        WHEN 'HOMEWORK' THEN 50
                        ELSE 60
                      END,
                      client_sequence,
                      id
             LIMIT ?1",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![limit], map_record)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn outbox_mark_synced(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    let conn = lock(&db)?;
    conn.execute(
        "UPDATE outbox SET status = 'SYNCED', synced_at = ?1, last_error = NULL WHERE id = ?2",
        params![now(), id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn outbox_mark_failed(db: tauri::State<'_, Db>, id: String, error: String) -> Result<i64, String> {
    let conn = lock(&db)?;
    conn.execute(
        "UPDATE outbox
         SET attempts = attempts + 1, last_error = ?1,
             status = CASE WHEN attempts + 1 >= 10 THEN 'FAILED' ELSE 'PENDING' END
         WHERE id = ?2",
        params![error, id],
    )
    .map_err(|error| error.to_string())?;
    conn.query_row("SELECT attempts FROM outbox WHERE id = ?1", params![id], |row| {
        row.get::<_, i64>(0)
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn outbox_clear_synced(db: tauri::State<'_, Db>) -> Result<usize, String> {
    let conn = lock(&db)?;
    conn.execute("DELETE FROM outbox WHERE status = 'SYNCED'", [])
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn outbox_stats(db: tauri::State<'_, Db>) -> Result<OutboxStats, String> {
    let conn = lock(&db)?;
    let pending = count_status(&conn, "PENDING")?;
    let failed = count_status(&conn, "FAILED")?;
    let synced = count_status(&conn, "SYNCED")?;
    Ok(OutboxStats {
        pending,
        failed,
        synced,
        total: pending + failed + synced,
    })
}

#[tauri::command]
fn device_info(db: tauri::State<'_, Db>) -> Result<DeviceInfo, String> {
    let conn = lock(&db)?;
    let device_id = conn
        .query_row("SELECT value FROM meta WHERE key = 'device_id'", [], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|| {
            let generated = Uuid::new_v4().to_string();
            let _ = conn.execute(
                "INSERT INTO meta (key, value) VALUES ('device_id', ?1)
                 ON CONFLICT(key) DO NOTHING",
                params![generated],
            );
            generated
        });
    let schema_version = conn
        .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|error| error.to_string())?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(1);
    Ok(DeviceInfo {
        device_id,
        platform: std::env::consts::OS,
        schema_version,
        encrypted: true,
    })
}

fn count_status(conn: &Connection, status: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM outbox WHERE status = ?1",
        params![status],
        |row| row.get::<_, i64>(0),
    )
    .map_err(|error| error.to_string())
}

fn read_by_key(conn: &Connection, key: &str) -> Result<OutboxRecord, String> {
    conn.query_row(
        "SELECT id, entity, operation, entity_id, payload, client_sequence, client_timestamp,
                idempotency_key, attempts, last_error, base_version, status, created_at, synced_at
         FROM outbox WHERE idempotency_key = ?1",
        params![key],
        map_record,
    )
    .map_err(|error| error.to_string())
}

fn map_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxRecord> {
    let payload: String = row.get(4)?;
    Ok(OutboxRecord {
        id: row.get(0)?,
        entity: row.get(1)?,
        operation: row.get(2)?,
        entity_id: row.get(3)?,
        payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
        client_sequence: row.get(5)?,
        client_timestamp: row.get(6)?,
        idempotency_key: row.get(7)?,
        attempts: row.get(8)?,
        last_error: row.get(9)?,
        base_version: row.get(10)?,
        status: row.get(11)?,
        created_at: row.get(12)?,
        synced_at: row.get(13)?,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let conn = open_db(app.handle())?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            outbox_enqueue,
            outbox_pending,
            outbox_mark_synced,
            outbox_mark_failed,
            outbox_clear_synced,
            outbox_stats,
            device_info,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the SchoolERP desktop shell");
}
