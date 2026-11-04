# SchoolERP desktop (Tauri 2)

A desktop shell that runs the **same React web bundle** as the browser app and
adds an encrypted local outbox for work done without connectivity.

The desktop is an offline-capable client, not a second product: one UI, one
design system, one API. Native capabilities live behind Tauri commands.

---

## 1. What is implemented

| Piece | Status |
| --- | --- |
| Tauri 2 window + config | ✅ |
| Reuse of `apps/web` via `beforeDevCommand`/`frontendDist` | ✅ |
| Strict CSP (prod + dev) | ✅ |
| Minimal capability (`core:default`) | ✅ |
| SQLCipher-encrypted local database | ✅ |
| Outbox: enqueue, pending, mark synced/failed, clear, stats | ✅ |
| Device info (id, platform, schema version, encrypted) | ✅ |
| Key file with restricted permissions | ✅ (OS keychain is a follow-up) |
| Automatic sync/replay loop | ○ Phase 4 — the commands exist; the web UI does not call them yet |
| Updater, code signing, auto-launch | ○ |

---

## 2. Prerequisites

Building the native shell requires:

- **Rust** 1.77+ (`rustup`)
- **Tauri CLI** (`@tauri-apps/cli` is a dev dependency)
- Platform toolchain:
  - Windows: MSVC build tools + WebView2 (preinstalled on Windows 11; the
    installer bootstraps it on older systems)
  - macOS: Xcode command line tools
  - Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`,
    `patchelf`, `build-essential`
- OpenSSL build prerequisites (the crate uses vendored OpenSSL for SQLCipher)

The repo's `build`, `typecheck` and `lint` scripts for this package intentionally
run a **static config validator** instead of Cargo, so root CI works on machines
without Rust:

```bash
pnpm --filter @schoolerp/desktop build       # node scripts/check-desktop.mjs
```

Real bundling:

```bash
pnpm desktop:bundle                          # tauri build
```

---

## 3. Development

```bash
# From repo root, with the API running
pnpm desktop:dev
```

Tauri starts `pnpm --filter @schoolerp/web dev` (Vite on 5173) and loads it in
the native window. API base URL resolution is the same as the web app; the dev
CSP allows `http://localhost:4000` and the Vite websocket.

Production bundle:

```bash
pnpm --filter @schoolerp/web build
pnpm desktop:bundle
```

Artifacts land in `apps/desktop/src-tauri/target/release/bundle/`.

---

## 4. Where the local database lives

Tauri's app data directory, under the app identifier
`np.edu.schoolerp.desktop`:

- Windows: `%APPDATA%\np.edu.schoolerp.desktop\offline.db`
- macOS: `~/Library/Application Support/np.edu.schoolerp.desktop/offline.db`
- Linux: `~/.local/share/np.edu.schoolerp.desktop/offline.db`

The database is opened with SQLCipher (`PRAGMA key`), `foreign_keys = ON`, and a
key check (`SELECT count(*) FROM sqlite_master`) before any table is touched.
A wrong key fails closed with `offline database key rejected`.

---

## 5. Key management

`SCHOOLERP_DB_KEY` is read first. If unset (or shorter than 32 characters), the
shell generates a random 64-character key and writes it to `offline.key` next to
the database, then restricts file permissions (0600 on Unix; Windows relies on
the user profile ACL).

Rules:

- Never commit `offline.key`; it is device-local.
- Never send the key to the API or include it in logs/crash reports.
- Rotating the key without a migration makes the outbox unreadable. Export
  pending rows first.
- **Follow-up:** move the key to the OS keychain (Windows Credential Manager,
  macOS Keychain, libsecret) before a production rollout. The current file-based
  approach is a documented trade-off, not the end state.
- For managed deployments you may inject `SCHOOLERP_DB_KEY` from device
  management; treat it as a secret.

---

## 6. Offline outbox contract

Schema (created on first launch):

```sql
CREATE TABLE outbox (
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

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Commands exposed to the web UI:

| Command | Input | Behaviour |
| --- | --- | --- |
| `outbox_enqueue` | `{ id, entity, operation, entityId, payload, clientSequence, clientTimestamp, idempotencyKey, baseVersion? }` | Inserts once per `idempotency_key`; returns the stored record |
| `outbox_pending` | `limit?` | Returns pending rows, oldest first (default 50) |
| `outbox_mark_synced` | `id` | Sets `SYNCED` and `synced_at` |
| `outbox_mark_failed` | `id`, `error` | Increments attempts, stores the error, keeps the row retryable |
| `outbox_clear_synced` | — | Deletes synced rows; returns the count |
| `outbox_stats` | — | `{ pending, failed, synced, total }` |
| `device_info` | — | `{ deviceId, platform, schemaVersion, encrypted }` |

Notes:

- `id` and `idempotency_key` are generated on the client. The server treats the
  key as unique per school, so a replay after a timeout cannot duplicate a
  payment or attendance row.
- `client_sequence` gives a total order per device; `client_timestamp` is an
  ISO-8601 string for diagnostics (never trust it for business ordering).
- `base_version` supports optimistic concurrency: when the server's version is
  newer, the API returns `409 VERSION_CONFLICT`; the UI must resolve before
  retrying.
- `operation` is `CREATE`, `UPDATE` or `DELETE`; `entity` is the API resource
  (`attendance`, `payment`, `student`, …).

### Replay semantics

A future sync worker should:

1. read pending rows in `client_sequence` order,
2. call the corresponding idempotent API endpoint,
3. on 2xx, `outbox_mark_synced`,
4. on 4xx validation/conflict, mark failed with the server message and surface
   it to the user,
5. on 5xx/network, leave pending and retry with exponential backoff,
6. never delete a failed row without user confirmation.

Until replay ships, the desktop is a **UI shell with a durable local queue**, not
a fully offline product.

---

## 7. Security

- CSP denies remote scripts; only the API origin is allowed for `connect-src`.
- The capability file grants only `core:default`.
- No shell/fs/http plugins are enabled.
- SQLCipher encrypts the database at rest; the key is device-local.
- The desktop receives its refresh token in the API response body
  (`X-Client: desktop`) instead of a cookie; the shell must store it in the OS
  secure store when that is wired (currently the web client keeps it in memory
  for the session).
- Treat the device as untrusted: the server enforces authorisation and tenant
  isolation regardless of what the client sends.

---

## 8. Validation without Rust

CI and local `pnpm build` run:

```bash
node apps/desktop/scripts/check-desktop.mjs
```

It validates:

- `package.json` scripts and dependency wiring,
- `tauri.conf.json` schema essentials, identifiers, CSP presence,
- the Rust entrypoint and `invoke_handler` command list,
- the capability file and icon set,
- that `frontendDist` points at an existing web build (warns if absent).

This is not a substitute for `cargo build`; it catches the mistakes that would
otherwise break the monorepo on a machine without Rust.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `pnpm desktop:dev` fails with "cargo not found" | Rust missing | Install rustup, restart the shell |
| WebView2 missing on Windows | Older OS | Install the Evergreen WebView2 runtime; the bundle bootstrapper does it |
| `offline database key rejected` | Key changed or file replaced | Restore the original `offline.key`; never rotate blindly |
| Blank window in dev | Vite not running | Let `beforeDevCommand` start it; check port 5173 |
| CSP blocks the API | API on a non-allowed origin | Use `http://localhost:4000` in dev or update `devCsp` |
| `409 VERSION_CONFLICT` after reconnect | Server record changed while offline | Refresh, reapply the edit, re-enqueue with the new `baseVersion` |

---

## 10. Roadmap for the desktop

- OS keychain for the SQLCipher key and refresh token.
- Sync engine with backoff, conflict UI and a pending-items indicator.
- Background sync + network status banner.
- Signed installers and an updater feed.
- Printer integration for report cards/receipts.
- Optional device enrolment and remote wipe.
