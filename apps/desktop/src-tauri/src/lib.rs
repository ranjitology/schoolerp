//! SchoolERP desktop shell.
//!
//! The web client is reused unchanged; this crate adds a small, auditable
//! offline store. The database is SQLCipher-encrypted, the key lives in a
//! per-install key file (replace with the OS keychain before production), and
//! every mutation travels through the same outbox contract as
//! `@schoolerp/core/outbox`.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use rusqlite::params_from_iter;
use rusqlite::types::Value as SqlValue;
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
CREATE TABLE IF NOT EXISTS cache_classes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cache_sections (
  id       TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  name     TEXT NOT NULL,
  data     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cache_sections_class_idx
  ON cache_sections (class_id, name);
CREATE TABLE IF NOT EXISTS cache_students (
  id           TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL,
  section_id   TEXT NOT NULL,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  admission_no TEXT NOT NULL,
  status       TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  data         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cache_students_class_idx
  ON cache_students (class_id, section_id, status, admission_no);
CREATE INDEX IF NOT EXISTS cache_students_updated_idx
  ON cache_students (updated_at);
CREATE TABLE IF NOT EXISTS cache_fee_heads (
  id   TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cache_fee_structures (
  id       TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  data     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cache_fee_structures_class_idx
  ON cache_fee_structures (class_id);
CREATE TABLE IF NOT EXISTS cache_invoices (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL,
  number       TEXT NOT NULL,
  student_name TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL,
  issue_date   TEXT NOT NULL DEFAULT '',
  due_date     TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL,
  data         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cache_invoices_student_idx
  ON cache_invoices (student_id);
CREATE INDEX IF NOT EXISTS cache_invoices_updated_idx
  ON cache_invoices (updated_at);
CREATE TABLE IF NOT EXISTS attendance_drafts (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL,
  section_id TEXT NOT NULL,
  draft_date TEXT NOT NULL,
  period     INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (class_id, section_id, draft_date, period)
);
"#;

const SCHEMA_VERSION: i64 = 2;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachePull {
    #[serde(default)]
    server_time: Option<String>,
    #[serde(default)]
    next_since: Option<String>,
    #[serde(default)]
    since: Option<String>,
    #[serde(default)]
    classes: Vec<serde_json::Value>,
    #[serde(default)]
    sections: Vec<serde_json::Value>,
    #[serde(default)]
    students: Vec<serde_json::Value>,
    #[serde(default)]
    fee_heads: Vec<serde_json::Value>,
    #[serde(default)]
    fee_structures: Vec<serde_json::Value>,
    #[serde(default)]
    invoices: Vec<serde_json::Value>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheQuery {
    class_id: Option<String>,
    section_id: Option<String>,
    status: Option<String>,
    search: Option<String>,
    student_id: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftQuery {
    class_id: Option<String>,
    section_id: Option<String>,
    date: Option<String>,
    period: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttendanceDraftInput {
    class_id: String,
    section_id: String,
    date: String,
    #[serde(default)]
    period: i64,
    #[serde(default)]
    records: Vec<serde_json::Value>,
    #[serde(default)]
    updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheStatus {
    schema_version: i64,
    server_time: Option<String>,
    last_synced_at: Option<String>,
    since: Option<String>,
    classes: i64,
    sections: i64,
    students: i64,
    fee_heads: i64,
    fee_structures: i64,
    invoices: i64,
    attendance_drafts: i64,
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
        "INSERT INTO meta (key, value) VALUES ('schema_version', '2')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
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
        .unwrap_or(SCHEMA_VERSION);
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

fn parse_json(raw: &str) -> serde_json::Value {
    serde_json::from_str(raw).unwrap_or(serde_json::Value::Null)
}

fn json_text(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .unwrap_or_default()
        .to_string()
}

fn json_i64(value: &serde_json::Value, key: &str) -> i64 {
    value.get(key).and_then(|item| item.as_i64()).unwrap_or(0)
}

fn is_deleted(value: &serde_json::Value) -> bool {
    value
        .get("deletedAt")
        .map(|item| !item.is_null())
        .unwrap_or(false)
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |row| {
        row.get::<_, String>(0)
    })
    .optional()
    .map_err(|error| error.to_string())
}

fn count_rows(conn: &Connection, table: &str) -> Result<i64, String> {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get::<_, i64>(0)
    })
    .map_err(|error| error.to_string())
}

fn read_cache_status(conn: &Connection) -> Result<CacheStatus, String> {
    let schema_version = get_meta(conn, "schema_version")?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(SCHEMA_VERSION);
    Ok(CacheStatus {
        schema_version,
        server_time: get_meta(conn, "cache_server_time")?,
        last_synced_at: get_meta(conn, "cache_last_sync")?,
        since: get_meta(conn, "cache_since")?,
        classes: count_rows(conn, "cache_classes")?,
        sections: count_rows(conn, "cache_sections")?,
        students: count_rows(conn, "cache_students")?,
        fee_heads: count_rows(conn, "cache_fee_heads")?,
        fee_structures: count_rows(conn, "cache_fee_structures")?,
        invoices: count_rows(conn, "cache_invoices")?,
        attendance_drafts: count_rows(conn, "attendance_drafts")?,
    })
}

/// Applies one `/sync/pull` response in a single SQLite transaction. Reference
/// tables are replaced (full snapshot); students and invoices are upserted by
/// id, and a student carrying `deletedAt` is evicted from the cache.
#[tauri::command]
fn cache_apply_pull(db: tauri::State<'_, Db>, payload: CachePull) -> Result<CacheStatus, String> {
    let mut conn = lock(&db)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;

    tx.execute("DELETE FROM cache_classes", [])
        .map_err(|error| error.to_string())?;
    for item in &payload.classes {
        let id = json_text(item, "id");
        if id.is_empty() {
            continue;
        }
        let data = serde_json::to_string(item).map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO cache_classes (id, name, sort, data) VALUES (?1, ?2, ?3, ?4)",
            params![id, json_text(item, "name"), json_i64(item, "sequence"), data],
        )
        .map_err(|error| error.to_string())?;
    }

    tx.execute("DELETE FROM cache_sections", [])
        .map_err(|error| error.to_string())?;
    for item in &payload.sections {
        let id = json_text(item, "id");
        if id.is_empty() {
            continue;
        }
        let data = serde_json::to_string(item).map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO cache_sections (id, class_id, name, data) VALUES (?1, ?2, ?3, ?4)",
            params![id, json_text(item, "classId"), json_text(item, "name"), data],
        )
        .map_err(|error| error.to_string())?;
    }

    for item in &payload.students {
        let id = json_text(item, "id");
        if id.is_empty() {
            continue;
        }
        if is_deleted(item) {
            tx.execute("DELETE FROM cache_students WHERE id = ?1", params![id])
                .map_err(|error| error.to_string())?;
            continue;
        }
        let data = serde_json::to_string(item).map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO cache_students
               (id, class_id, section_id, first_name, last_name, admission_no, status, updated_at, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               class_id = excluded.class_id,
               section_id = excluded.section_id,
               first_name = excluded.first_name,
               last_name = excluded.last_name,
               admission_no = excluded.admission_no,
               status = excluded.status,
               updated_at = excluded.updated_at,
               data = excluded.data",
            params![
                id,
                json_text(item, "classId"),
                json_text(item, "sectionId"),
                json_text(item, "firstName"),
                json_text(item, "lastName"),
                json_text(item, "admissionNo"),
                json_text(item, "status"),
                json_text(item, "updatedAt"),
                data,
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    tx.execute("DELETE FROM cache_fee_heads", [])
        .map_err(|error| error.to_string())?;
    for item in &payload.fee_heads {
        let id = json_text(item, "id");
        if id.is_empty() {
            continue;
        }
        let data = serde_json::to_string(item).map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO cache_fee_heads (id, data) VALUES (?1, ?2)",
            params![id, data],
        )
        .map_err(|error| error.to_string())?;
    }

    tx.execute("DELETE FROM cache_fee_structures", [])
        .map_err(|error| error.to_string())?;
    for item in &payload.fee_structures {
        let id = json_text(item, "id");
        if id.is_empty() {
            continue;
        }
        let data = serde_json::to_string(item).map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO cache_fee_structures (id, class_id, data) VALUES (?1, ?2, ?3)",
            params![id, json_text(item, "classId"), data],
        )
        .map_err(|error| error.to_string())?;
    }

    for item in &payload.invoices {
        let id = json_text(item, "id");
        if id.is_empty() {
            continue;
        }
        let data = serde_json::to_string(item).map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO cache_invoices
               (id, student_id, number, student_name, status, issue_date, due_date, updated_at, data)
             VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               student_id = excluded.student_id,
               number = excluded.number,
               status = excluded.status,
               issue_date = excluded.issue_date,
               due_date = excluded.due_date,
               updated_at = excluded.updated_at,
               data = excluded.data",
            params![
                id,
                json_text(item, "studentId"),
                json_text(item, "number"),
                json_text(item, "status"),
                json_text(item, "issueDate"),
                json_text(item, "dueDate"),
                json_text(item, "updatedAt"),
                data,
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    let synced_at = payload
        .server_time
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(now);
    set_meta(&tx, "cache_last_sync", &synced_at)?;
    set_meta(&tx, "cache_server_time", &synced_at)?;
    if let Some(next) = payload.next_since.as_ref().filter(|value| !value.is_empty()) {
        set_meta(&tx, "cache_since", next)?;
    } else if let Some(since) = payload.since.as_ref().filter(|value| !value.is_empty()) {
        set_meta(&tx, "cache_since", since)?;
    }

    tx.commit().map_err(|error| error.to_string())?;
    let status = read_cache_status(&conn)?;
    Ok(status)
}

#[tauri::command]
fn cache_status(db: tauri::State<'_, Db>) -> Result<CacheStatus, String> {
    let conn = lock(&db)?;
    read_cache_status(&conn)
}

/// Returns classes with their sections nested, matching the `/academics/classes`
/// shape used by the web pages.
#[tauri::command]
fn cache_classes(db: tauri::State<'_, Db>) -> Result<Vec<serde_json::Value>, String> {
    let conn = lock(&db)?;
    let mut by_class: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
    {
        let mut statement = conn
            .prepare("SELECT data FROM cache_sections ORDER BY class_id, name")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        for row in rows {
            let raw = row.map_err(|error| error.to_string())?;
            let value = parse_json(&raw);
            by_class
                .entry(json_text(&value, "classId"))
                .or_default()
                .push(value);
        }
    }

    let mut statement = conn
        .prepare("SELECT data FROM cache_classes ORDER BY sort, name")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        let raw = row.map_err(|error| error.to_string())?;
        let mut value = parse_json(&raw);
        let id = json_text(&value, "id");
        let sections = by_class.remove(&id).unwrap_or_default();
        if let Some(object) = value.as_object_mut() {
            object.insert("sections".to_string(), serde_json::Value::Array(sections));
        }
        result.push(value);
    }
    Ok(result)
}

#[tauri::command]
fn cache_students(
    db: tauri::State<'_, Db>,
    query: Option<CacheQuery>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = lock(&db)?;
    let query = query.unwrap_or_default();
    let limit = query.limit.unwrap_or(500).clamp(1, 5000);

    let mut sql = String::from(
        "SELECT st.data, c.name, sec.name
         FROM cache_students st
         LEFT JOIN cache_classes c ON c.id = st.class_id
         LEFT JOIN cache_sections sec ON sec.id = st.section_id
         WHERE 1 = 1",
    );
    let mut args: Vec<SqlValue> = Vec::new();
    if let Some(value) = query.class_id.as_ref().filter(|value| !value.is_empty()) {
        sql.push_str(" AND st.class_id = ?");
        args.push(SqlValue::Text(value.clone()));
    }
    if let Some(value) = query.section_id.as_ref().filter(|value| !value.is_empty()) {
        sql.push_str(" AND st.section_id = ?");
        args.push(SqlValue::Text(value.clone()));
    }
    if let Some(value) = query.status.as_ref().filter(|value| !value.is_empty()) {
        sql.push_str(" AND st.status = ?");
        args.push(SqlValue::Text(value.clone()));
    }
    if let Some(term) = query
        .search
        .as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
    {
        let like = format!("%{term}%");
        sql.push_str(
            " AND (lower(st.first_name) LIKE ? OR lower(st.last_name) LIKE ? OR lower(st.admission_no) LIKE ?)",
        );
        args.push(SqlValue::Text(like.clone()));
        args.push(SqlValue::Text(like.clone()));
        args.push(SqlValue::Text(like));
    }
    sql.push_str(" ORDER BY st.admission_no ASC LIMIT ?");
    args.push(SqlValue::Integer(limit));

    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(args.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let (raw, class_name, section_name) = row.map_err(|error| error.to_string())?;
        let mut value = parse_json(&raw);
        if let Some(object) = value.as_object_mut() {
            if let Some(name) = class_name {
                object.insert("className".to_string(), serde_json::Value::String(name));
            }
            if let Some(name) = section_name {
                object.insert("sectionName".to_string(), serde_json::Value::String(name));
            }
        }
        result.push(value);
    }
    Ok(result)
}

#[tauri::command]
fn cache_invoices(
    db: tauri::State<'_, Db>,
    query: Option<CacheQuery>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = lock(&db)?;
    let query = query.unwrap_or_default();
    let limit = query.limit.unwrap_or(500).clamp(1, 5000);

    let mut sql = String::from(
        "SELECT i.data, st.first_name, st.last_name, st.admission_no, c.name, sec.name
         FROM cache_invoices i
         LEFT JOIN cache_students st ON st.id = i.student_id
         LEFT JOIN cache_classes c ON c.id = st.class_id
         LEFT JOIN cache_sections sec ON sec.id = st.section_id
         WHERE 1 = 1",
    );
    let mut args: Vec<SqlValue> = Vec::new();
    if let Some(value) = query.status.as_ref().filter(|value| !value.is_empty()) {
        sql.push_str(" AND i.status = ?");
        args.push(SqlValue::Text(value.clone()));
    }
    if let Some(value) = query.student_id.as_ref().filter(|value| !value.is_empty()) {
        sql.push_str(" AND i.student_id = ?");
        args.push(SqlValue::Text(value.clone()));
    }
    if let Some(term) = query
        .search
        .as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
    {
        let like = format!("%{term}%");
        sql.push_str(
            " AND (lower(i.number) LIKE ?
                  OR lower(COALESCE(st.first_name, '') || ' ' || COALESCE(st.last_name, '')) LIKE ?
                  OR lower(COALESCE(st.admission_no, '')) LIKE ?)",
        );
        args.push(SqlValue::Text(like.clone()));
        args.push(SqlValue::Text(like.clone()));
        args.push(SqlValue::Text(like));
    }
    sql.push_str(" ORDER BY i.issue_date DESC, i.updated_at DESC LIMIT ?");
    args.push(SqlValue::Integer(limit));

    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(args.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let (raw, first_name, last_name, admission_no, class_name, section_name) =
            row.map_err(|error| error.to_string())?;
        let mut value = parse_json(&raw);
        if let Some(object) = value.as_object_mut() {
            let name = format!(
                "{} {}",
                first_name.unwrap_or_default(),
                last_name.unwrap_or_default()
            )
            .trim()
            .to_string();
            let student_id = object
                .get("studentId")
                .and_then(|item| item.as_str())
                .unwrap_or_default()
                .to_string();
            let mut student = serde_json::Map::new();
            student.insert(
                "id".to_string(),
                serde_json::Value::String(student_id),
            );
            student.insert("name".to_string(), serde_json::Value::String(name));
            if let Some(value) = admission_no {
                student.insert("admissionNo".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = class_name {
                student.insert("className".to_string(), serde_json::Value::String(value));
            }
            if let Some(value) = section_name {
                student.insert("sectionName".to_string(), serde_json::Value::String(value));
            }
            object.insert("student".to_string(), serde_json::Value::Object(student));
        }
        result.push(value);
    }
    Ok(result)
}

#[tauri::command]
fn cache_fee_heads(db: tauri::State<'_, Db>) -> Result<Vec<serde_json::Value>, String> {
    let conn = lock(&db)?;
    let mut statement = conn
        .prepare("SELECT data FROM cache_fee_heads ORDER BY id")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map(|values| values.iter().map(|raw| parse_json(raw)).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cache_fee_structures(
    db: tauri::State<'_, Db>,
    query: Option<CacheQuery>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = lock(&db)?;
    let query = query.unwrap_or_default();
    let mut statement = conn
        .prepare("SELECT data FROM cache_fee_structures WHERE (?1 IS NULL OR class_id = ?1) ORDER BY class_id")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![query.class_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map(|values| values.iter().map(|raw| parse_json(raw)).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cache_clear(db: tauri::State<'_, Db>) -> Result<(), String> {
    let conn = lock(&db)?;
    conn.execute_batch(
        "DELETE FROM cache_classes;
         DELETE FROM cache_sections;
         DELETE FROM cache_students;
         DELETE FROM cache_fee_heads;
         DELETE FROM cache_fee_structures;
         DELETE FROM cache_invoices;
         DELETE FROM attendance_drafts;
         DELETE FROM meta WHERE key IN ('cache_last_sync', 'cache_server_time', 'cache_since');",
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn attendance_draft_save(
    db: tauri::State<'_, Db>,
    input: AttendanceDraftInput,
) -> Result<serde_json::Value, String> {
    let conn = lock(&db)?;
    let key = format!(
        "{}:{}:{}:{}",
        input.class_id, input.section_id, input.date, input.period
    );
    let updated_at = input
        .updated_at
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(now);
    let payload = serde_json::to_string(&input).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO attendance_drafts
           (id, class_id, section_id, draft_date, period, payload, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at",
        params![
            key,
            input.class_id,
            input.section_id,
            input.date,
            input.period,
            payload,
            updated_at,
        ],
    )
    .map_err(|error| error.to_string())?;

    let mut value = parse_json(&payload);
    if let Some(object) = value.as_object_mut() {
        object.insert("id".to_string(), serde_json::Value::String(key));
        object.insert(
            "updatedAt".to_string(),
            serde_json::Value::String(updated_at),
        );
    }
    Ok(value)
}

#[tauri::command]
fn attendance_draft_get(
    db: tauri::State<'_, Db>,
    query: DraftQuery,
) -> Result<Option<serde_json::Value>, String> {
    let conn = lock(&db)?;
    let Some(class_id) = query.class_id else {
        return Ok(None);
    };
    let Some(section_id) = query.section_id else {
        return Ok(None);
    };
    let Some(date) = query.date else {
        return Ok(None);
    };
    let period = query.period.unwrap_or(0);
    let raw = conn
        .query_row(
            "SELECT payload FROM attendance_drafts
             WHERE class_id = ?1 AND section_id = ?2 AND draft_date = ?3 AND period = ?4",
            params![class_id, section_id, date, period],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(raw.map(|value| parse_json(&value)))
}

#[tauri::command]
fn attendance_draft_list(db: tauri::State<'_, Db>) -> Result<Vec<serde_json::Value>, String> {
    let conn = lock(&db)?;
    let mut statement = conn
        .prepare("SELECT payload FROM attendance_drafts ORDER BY updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map(|values| values.iter().map(|raw| parse_json(raw)).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn attendance_draft_clear(
    db: tauri::State<'_, Db>,
    query: Option<DraftQuery>,
) -> Result<usize, String> {
    let conn = lock(&db)?;
    match query {
        Some(DraftQuery {
            class_id: Some(class_id),
            section_id: Some(section_id),
            date: Some(date),
            period: Some(period),
        }) => conn
            .execute(
                "DELETE FROM attendance_drafts
                 WHERE class_id = ?1 AND section_id = ?2 AND draft_date = ?3 AND period = ?4",
                params![class_id, section_id, date, period],
            )
            .map_err(|error| error.to_string()),
        _ => conn
            .execute("DELETE FROM attendance_drafts", [])
            .map_err(|error| error.to_string()),
    }
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
            cache_apply_pull,
            cache_status,
            cache_classes,
            cache_students,
            cache_invoices,
            cache_fee_heads,
            cache_fee_structures,
            cache_clear,
            attendance_draft_save,
            attendance_draft_get,
            attendance_draft_list,
            attendance_draft_clear,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the SchoolERP desktop shell");
}
