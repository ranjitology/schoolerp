# SchoolERP — Architecture (Phase 0)

This document is the Phase 0 deliverable: the design that the implementation in
this repository follows. It is written to be read by engineers joining the
project, by an operator running it, and by a security reviewer checking the
multi-tenancy claims.

**Status:** Phase 0 (this document) and Phase 1 (platform foundation) are
implemented. Phase 2 is a working vertical slice. Phases 3–7 are sequenced in
[`requirements-checklist.md`](requirements-checklist.md).

---

## 1. Context and goals

### 1.1 Business context

A single SaaS operator hosts a school management product for **100–150 schools**
(tenants). Each school gets:

- a web client on its own subdomain (`<slug>.schoolerp.app`),
- an optional offline-capable desktop client (Tauri 2),
- parent and student portals,
- an isolated slice of a shared database,
- a plan with module, seat and rate limits.

A separate **platform console** lets the operator onboard schools, change plans,
suspend tenants, publish announcements, review audit trails and perform
time-boxed, consented impersonation.

### 1.2 Non-functional targets

| Area | Target |
| --- | --- |
| List endpoints | p95 < 300 ms |
| Bulk attendance (one class) | < 2 s end-to-end |
| Report-card generation | background, < 15 min per cohort |
| Morning-peak concurrency | 500 concurrent staff across all tenants |
| RPO / RTO | ≤ 15 min / ≤ 2 h |
| Availability | Graceful degradation when Redis/S3 are unavailable |
| Accessibility | WCAG 2.1 AA, full keyboard paths, visible focus |
| Retention | Per-tenant audit/document retention with export + deletion |

### 1.3 Explicit non-goals for Phase 0/1

- Microservices. The system starts as a **modular monolith** with hard module
  boundaries and an outbox, so extraction is possible later without a rewrite.
- Per-tenant databases at launch. The schema supports a future dedicated-database
  tier; the control plane stores the tenant's data-plane mode.
- A public plugin API. The OpenAPI contract is stable and versioned, but
  third-party extensibility is a later phase.

---

## 2. System context

```
             ┌──────────────────────┐        ┌──────────────────────┐
             │  School web app      │        │  Platform console    │
             │  React + Vite        │        │  React + Vite        │
             └──────────┬───────────┘        └──────────┬───────────┘
                        │ HTTPS                         │ HTTPS
                        ▼                               ▼
             ┌──────────────────────────────────────────────────────┐
             │                    NestJS API                        │
             │  auth · rbac · students · academics · attendance     │
             │  fees · notices · dashboards · audit · platform      │
             │  envelope · validation · rate limits · metrics       │
             └───────┬───────────────┬───────────────┬──────────────┘
                     │               │               │
                     ▼               ▼               ▼
             ┌──────────────┐  ┌────────────┐  ┌──────────────┐
             │ PostgreSQL16 │  │ Redis 7    │  │ S3 / MinIO   │
             │ RLS tenant   │  │ limits,    │  │ documents    │
             │ tables +     │  │ queues,    │  │ (signed URLs)│
             │ control plane│  │ cache      │  │              │
             └──────────────┘  └────────────┘  └──────────────┘
                     ▲
                     │ local SQLCipher outbox, replay on reconnect
             ┌───────┴──────────┐
             │ Tauri 2 desktop  │
             │ same web bundle  │
             └──────────────────┘
```

Trust boundaries:

- Browser/desktop → API: untrusted input, validated at the edge with Zod.
- API → database: the application role is a **non-owner** with `NOBYPASSRLS`.
- API → platform control plane: only inside `withPlatform()` after a platform
  role check, and every mutation writes a `PlatformAuditLog`.
- Desktop local store: encrypted at rest with SQLCipher; the key is never sent
  to the server.

---

## 3. Monorepo layout

```
apps/
  api/              NestJS modular monolith
  web/              School-facing React app (also the desktop front-end)
  admin-console/    Platform operator console
  desktop/          Tauri 2 shell + SQLCipher outbox commands
packages/
  core/             Framework-free domain logic, Zod contracts, crypto (server subpath)
  db/               Prisma schema, migrations, RLS SQL, seed, PGlite RLS tests
  ui/               shadcn-style primitives shared by web + admin
infra/
  docker/           Dockerfiles and nginx configs
  postgres/init/    Role bootstrap (erp_app with NOBYPASSRLS)
  terraform/        Data-plane skeleton (RDS, ElastiCache, S3, security groups)
docs/
tests/
  e2e/              Playwright specs
  load/             k6 smoke and attendance burst
```

Rules enforced by review and CI:

- `packages/core` never imports Nest, React, Prisma or Node-only APIs at the
  package root. Server-only crypto lives behind `@schoolerp/core/server`.
- `apps/*` may depend on `packages/*`; packages never depend on apps.
- The database package owns every SQL statement that defines isolation. API
  services use Prisma through `withTenant`/`withPlatform`, never the raw client.

---

## 4. Tenancy model

### 4.1 Shared database, shared schema, row-level security

Every tenant-owned table has a `school_id uuid NOT NULL` column, indexed
tenant-first (e.g. `(school_id, class_id, date)`). The `schools` table itself is
the tenant registry and has no `school_id`.

The migration appends `prisma/rls.sql`, which:

1. finds every base table with a `school_id` column,
2. enables and **forces** row-level security,
3. creates one `tenant_isolation` policy:

```sql
USING (
  current_setting('app.is_platform', true) = 'true'
  OR school_id = nullif(current_setting('app.school_id', true), '')::uuid
)
WITH CHECK ( <same predicate> )
```

`FORCE ROW LEVEL SECURITY` means the table owner is constrained too. The only
roles that bypass RLS are the migration runner (`postgres`, `BYPASSRLS`) and a
superuser. The runtime role is `erp_app`, created by
`infra/postgres/init/01-roles.sql` with `NOBYPASSRLS`, and it receives only DML
grants plus sequence usage.

### 4.2 Request-scoped tenant context

Isolation depends on the GUCs being **transaction-local**, so a pooled
connection can never leak context between requests:

```ts
withTenant({ schoolId }, async (tx) => {
  // set_config('app.school_id', $1, true)
  // set_config('app.is_platform', 'false', true)
  return tx.student.findMany(...);
});
```

- `withTenant` is the only sanctioned path for tenant data.
- `withPlatform` sets `app.is_platform = 'true'` and clears `app.school_id`. It is
  used by the platform module and the seed. Every platform mutation must write a
  platform audit entry.
- Services that already own a transaction (bulk attendance, fee collection) call
  `applyTenantScope(tx, { schoolId })` and continue inside the same transaction.

### 4.3 Tenant resolution

Order of precedence, implemented in `TenantMiddleware`:

1. **Host subdomain** — `green-valley.schoolerp.app` → slug `green-valley`
   (`BASE_DOMAIN` must be set).
2. **Development header** — `X-School-Slug`, only when
   `ALLOW_TENANT_HEADER=true` and `NODE_ENV !== 'production'`.
3. **JWT claim** — `sid` in the access token.

If a host-derived tenant and a token-derived tenant disagree, the request is
rejected with `TenantMismatchError` (HTTP 403). Suspended, cancelled or deleted
schools are rejected before any query runs. Public endpoints (login, platform
login, health) do not require a resolved tenant.

### 4.4 Isolation proof

`packages/db/test/rls.test.ts` runs against an in-process PostgreSQL (PGlite)
because Docker/PostgreSQL were unavailable in the delivery environment. It:

- applies the real generated migration plus `rls.sql`,
- creates a non-owner `erp_app` role,
- inserts two schools and proves a tenant-scoped read sees only its own rows,
- proves cross-tenant `INSERT`/`UPDATE`/`DELETE` are denied,
- proves `app.is_platform = 'true'` can read across tenants,
- proves `audit_logs` rejects `UPDATE`, `DELETE` and `TRUNCATE`.

CI additionally runs the same migration and seed against a real PostgreSQL 16
service, so the test is not only a PGlite artifact.

### 4.5 Dedicated-database routing

The control plane stores each tenant's data-plane mode (`School.dataPlane`) and
an optional `dedicatedDbRef`. Routing is driven by `TENANT_DB_URLS`, which
accepts either a JSON object or comma-separated `schoolId=url` pairs:

```bash
TENANT_DB_URLS='{"<schoolId>":"postgresql://user:pass@host/db"}'
TENANT_DB_URLS='<schoolId>=postgresql://...,<schoolId2>=postgresql://...'
```

`packages/db/src/routing.ts` parses and validates that configuration without
opening a connection; `packages/db/src/client.ts` caches one Prisma client per
routed tenant and falls back to the shared primary for every other school.
`withTenant` and `withTenantRead` select the client from the transaction's
`schoolId`, so callers keep the same contract and RLS remains enabled on the
dedicated database as defence in depth.

Enabling routing is additive: an empty or missing `TENANT_DB_URLS` means
"shared only". Keys are `schoolId` values (the same value used for
`app.school_id`), and every dedicated database must receive the same migrations
and RLS grants. Provisioning and automated migration of dedicated databases are
still deployment concerns and are not implemented in the application.

---

## 5. Identity, sessions and authorization

### 5.1 Passwords

- Argon2id, tuned parameters, 64-byte hash, per-user salt.
- Constant-time verification; unknown users verify against a dummy hash to
  avoid user-enumeration timing.
- Five consecutive failures lock the account for 15 minutes.
- Password reset uses a single-use, hashed, expiring token; completion revokes
  all sessions.

### 5.2 Access tokens

- JWT, 15-minute TTL, HS256 signed with `JWT_ACCESS_SECRET` (≥ 32 chars in
  production; the process refuses `dev-only` secrets in production).
- Claims: `sub` (user), `sid` (school), `role`, `scopes`, `typ`, `jti`, `iat`,
  `exp`, optional impersonation claims (`imp`, `pid`).
- Access tokens are memory-only in the web client; the desktop client keeps them
  in memory as well.

### 5.3 Refresh tokens

- Opaque 256-bit random values; only a SHA-256 hash combined with
  `JWT_REFRESH_PEPPER` is stored.
- Rotating on every use. Each token belongs to a family; presenting an already
  rotated token is treated as theft and revokes the whole family.
- Web: delivered as an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie
  scoped to the API path. Desktop (`X-Client: desktop`): returned in the
  response body so the shell can store it in the OS-appropriate secure store.
- Password change, reset, account suspension and explicit logout revoke the
  relevant family/sessions.

### 5.4 TOTP

Optional per user. Enrolment returns an otpauth URI and recovery codes; the
secret is encrypted at rest. Login with TOTP enabled requires a valid 6-digit
code. Replay is prevented by persisting `totpLastStep` and rejecting any code
whose time step is not greater than the stored value.

### 5.5 Authorization

Two layers:

1. **Permission guard** — controllers declare `@RequirePermissions('students:read')`.
   The user's effective permissions are `role baseline + grants − denies`.
   Permission constants live in `packages/core/src/rbac.ts`.
2. **Ownership scoping** — a permission is necessary but not sufficient. Parent
   and student principals are additionally constrained to their own children /
   records inside services (for example the portal dashboard and notices).

Platform routes use a separate guard and `@RequirePlatformRoles(...)` with
`SUPER_ADMIN`, `SUPPORT` and `BILLING`. Tenant tokens cannot call platform
routes and vice versa.

Impersonation:

- started by a `SUPER_ADMIN` with a reason and a consent reference,
- issues a short-lived tenant token carrying `imp` and `pid`,
- is fully audited on both the platform and tenant sides,
- can be ended explicitly or expires automatically (default 30 minutes).

---

## 6. API design

- Global prefix `api/v1`; OpenAPI at `/api/v1/docs`, machine contract at
  `apps/api/openapi.json` (CI fails on drift).
- Success envelope: `{ "data": ... }`.
- Pagination lives inside `data`: `{ items, page, pageSize, total }`.
- Errors: `{ "error": { "code", "message", "details", "requestId" } }`.
  Validation failures return field-level `details`.
- Every request gets `X-Request-Id` (client-supplied or generated) and it is
  echoed in responses and logs.
- Validation at the boundary with Zod (`zodBody` pipe) using the shared schemas
  in `@schoolerp/core`; query and path parameters are validated too.
- Tenant-side rate limiting: auth endpoints use an in-process fixed window.
  Production note: move to Redis/gateway limits before horizontal scaling (see
  "Known gaps").
- Idempotency: fee payments are unique on `(school_id, idempotency_key)`;
  attendance bulk upserts are unique on
  `(school_id, date, class_id, section_id, period, student_id)` with a client
  idempotency key; the desktop outbox keys replays the same way.

Route groups:

| Group | Purpose |
| --- | --- |
| `/auth` | login, refresh, logout, sessions, password, TOTP |
| `/students` | CRUD, search, CSV import/export |
| `/academics` | years, classes, sections, subjects, timetable, exams, marks, report cards |
| `/attendance` | bulk write, session, summary, low attendance |
| `/fees` | heads, structures, invoices, payments, refunds, ledger, defaulters, expenses |
| `/notices` / `/portal/notices` / `/notifications` | staff notices, portal feed, read state |
| `/dashboard` | staff overview, role-aware `/dashboard/me` |
| `/audit` | tenant audit read + hash-chain verification |
| `/platform` | control plane (separate guard) |
| `/health`, `/metrics` | liveness/readiness and Prometheus |

---

## 7. Data model

The canonical model is `packages/db/prisma/schema.prisma`. Domains:

- **Control plane:** `School`, `Plan`, `Subscription`, `PlatformUser`,
  `PlatformAuditLog`, `Announcement`, `ImpersonationSession`.
- **Identity:** `User`, `Role`, `UserRole`, `PermissionGrant`, `Session`,
  `RefreshToken`, `PasswordResetToken`, `TotpSecret`.
- **People:** `Staff`, `StaffAssignment`, `Student`, `Guardian`,
  `StudentGuardian`, `StudentDocument`.
- **Academics:** `AcademicYear`, `Class`, `Section`, `Subject`,
  `ClassSubject`, `TimetableSlot`, `Exam`, `ExamSubject`, `Mark`,
  `ReportCard`, `GradingScale`, `GradeBand`.
- **Attendance:** `AttendanceRecord` (+ policy fields on the school/settings).
- **Fees:** `FeeHead`, `FeeStructure`, `FeeStructureItem`, `Invoice`,
  `InvoiceItem`, `Payment`, `PaymentAllocation`, `Refund`, `Expense`,
  `NumberSequence`.
- **Communication:** `Notice`, `NoticeAudience`, `Notification`.
- **Platform plumbing:** `AuditLog`, `OutboxEvent`, `SchoolSetting`.

Conventions:

- **IDs** are UUIDv7 generated in the application with a monotonic counter, so
  they are time-sortable and index-friendly. The database does not generate IDs.
- **Money** is `Int`/`BigInt` minor units plus a currency code. No floats.
- **Dates** are ISO `YYYY-MM-DD` strings at the API boundary; timestamps are
  `timestamptz`. The tenant timezone is explicit on the school.
- **Calendar systems** are a per-school setting. AD↔BS conversion is scoped to
  Phase 2; the schema and settings already carry the calendar system.
- **Optimistic concurrency:** editable aggregates carry `version`; updates
  compare-and-set and return `409 VERSION_CONFLICT` on mismatch.
- **Soft deletion:** students and users are archived (`archivedAt`/`deletedAt`)
  rather than hard-deleted; audit and financial records are retained.

Tenant-first indexing: every composite index used by list/report queries starts
with `school_id`. Examples: `(school_id, class_id, section_id, date)` on
attendance, `(school_id, student_id, issued_at)` on invoices,
`(school_id, created_at)` on audit.

---

## 8. Audit, outbox and background work

### 8.1 Audit

- `AuditLog` is tenant-scoped (`school_id`), append-only, hash-chained per
  school: each row stores the previous hash and a hash over the canonical
  payload. `GET /audit/verify` recomputes the chain.
- Database triggers reject `UPDATE`, `DELETE` and `TRUNCATE` for every role
  including the migration role unless triggers are explicitly dropped.
- `PlatformAuditLog` is separate and records control-plane actions (onboarding,
  status change, plan change, impersonation start/end, announcements).
- Audit writes happen in the same transaction as the mutation they describe.
- Production partitioning by month is scripted in
  `packages/db/prisma/partitioning.sql`; the composite primary key
  `(id, created_at)` makes the conversion possible in place. It is not applied
  in the generated migration yet because it is a maintenance-window operation.

### 8.2 Outbox

`OutboxEvent` records domain events (notifications, future integrations) in the
same transaction as the state change. A dispatcher (BullMQ, Phase 2) will read
unpublished rows. The desktop uses the same pattern locally: SQLCipher
`outbox` rows with `idempotency_key`, `attempts`, `last_error`, `status` and
`base_version`, replayed to the API on reconnect.

### 8.3 Queues (reserved)

Redis and BullMQ are provisioned in Compose and the Terraform skeleton. The API
does not yet enqueue work; report-card generation currently runs synchronously
for the seeded cohort. Moving it behind a queue is a Phase 2/3 task and is
called out in the requirements checklist.

---

## 9. Performance and capacity

- **Tenant-first indexes** on every hot path; no query scans across tenants.
- **Cursor-friendly IDs** (UUIDv7) and stable ordering by `(created_at, id)`.
- **bounded list pages** (default 25, max 100) and validated sort/filter fields.
- **Bulk attendance** is a single transaction using a multi-row upsert and a
  pre-fetched roster; target < 2 s for a 60-student class.
- **Report-card generation** is batched per class with pre-loaded marks; the
  target is a background job in later phases.
- **Connection pooling:** Prisma pool sized per API replica; the Compose stack
  is single-instance. Production should front PostgreSQL with PgBouncer in
  transaction mode — safe because tenant context is transaction-local.
- **Caching:** per-tenant configuration and entitlements are candidates for a
  Redis cache with short TTL and explicit invalidation on plan change. Not yet
  implemented (correctness first).
- **Partitioning:** audit by month; high-volume attendance by academic year is a
  later option. Both are documented rather than prematurely applied.
- **Load tests:** `tests/load/smoke.js` and `tests/load/attendance-burst.js`
  (ramping to 500 VUs, p95 < 2 s on bulk attendance).

---

## 10. Security

| Threat | Control |
| --- | --- |
| Cross-tenant data access | RLS (forced), non-owner runtime role, tenant-scoped transactions, isolation tests |
| Tenant confusion | Host/token mismatch rejection; suspended tenant rejection |
| Credential stuffing | Argon2id, lockout, auth rate limits, generic error messages |
| Session theft | Short access TTL, rotating hashed refresh tokens, reuse detection, revocation |
| XSS | React escaping, strict CSP in production and in Tauri, no `dangerouslySetInnerHTML` on user content |
| CSRF | Bearer access token + `SameSite=Lax` refresh cookie scoped to API; CORS allow-list |
| SQL injection | Prisma parameterisation; raw SQL limited to migration/RLS scripts |
| Mass assignment | Zod schemas whitelist fields; no spreading request bodies into Prisma |
| IDOR | Permission guard plus ownership scoping in services |
| PII exposure | Minimised responses, no secrets in logs, redacted audit payloads |
| File upload abuse | Signed URLs, content-type/size limits (storage module pending) |
| DoS | Body limits, auth rate limits, bounded pages, statement timeouts (Terraform parameter group) |
| Supply chain | `pnpm audit` in CI, lockfile, pinned images |
| Insider access | Platform actions audited, impersonation requires reason + consent reference + TOTP |
| Data at rest | PostgreSQL/S3 encryption (Terraform), SQLCipher on desktop |
| Data in transit | TLS terminated at the ingress; HSTS via the proxy/ingress |

Headers: `helmet` with CSP in production; CORS restricted to configured
origins. Request bodies are capped (10 MB JSON, 2 MB form). Production
environment validation refuses placeholder JWT secrets.

Retention and consent: tenant export/deletion endpoints and document retention
schedules are specified in the runbook; the control plane already stores the
retention policy on the school. Implementing the export worker is a Phase 2/3
task.

---

## 11. Reliability

- **Backups:** RDS automated backups with 14-day retention and PITR (RPO
  ≤ 15 min). Compose volumes are for local use only.
- **Restore drills:** quarterly, documented in the runbook, with measured RTO
  and a data-integrity check (tenant counts + audit chain verification).
- **Migrations:** expand/contract. Add nullable columns and backfill in a
  separate step; deploy code that writes both shapes; drop old columns in a
  later release. Prisma migrations are forward-only; destructive changes are
  manual and reviewed.
- **Graceful degradation:** health endpoints separate liveness (process) from
  readiness (database). Redis/S3 outages must not take down core reads/writes;
  features that need them return a typed `SERVICE_UNAVAILABLE`.
- **Graceful shutdown:** `enableShutdownHooks()`; the API drains connections on
  SIGTERM.
- **Statement timeouts:** `statement_timeout=30s`,
  `idle_in_transaction_session_timeout=60s` in the Terraform parameter group.
- **Idempotency** on retried writes (attendance, payments, outbox replay).

---

## 12. Deployment topology

### 12.1 Local / demo (implemented)

`docker compose up --build` starts:

- `db` — PostgreSQL 16, init script creates `erp_app`,
- `redis` — Redis 7,
- `minio` + `minio-init` — private documents bucket,
- `migrate` — applies migrations and seeds as the owner role, then exits,
- `api` — NestJS as `erp_app`,
- `web` — nginx serving the built school app,
- `admin` — nginx serving the platform console.

Ports: web 8080, admin 8081, API 4000, MinIO 9000/9001.

### 12.2 Production (skeleton)

- Data plane: Terraform provisions RDS PostgreSQL 16 (Multi-AZ, encrypted,
  PITR), ElastiCache Redis 7, and an encrypted private S3 bucket with
  security groups that only admit the API.
- Compute: container images from `infra/docker/*` on ECS/EKS or VMs behind an
  ingress that terminates TLS and routes `<slug>.schoolerp.app` to the web app
  and `api.schoolerp.app` to the API.
- Secrets: RDS managed master password in Secrets Manager; application secrets
  in the platform's secret store, injected at runtime.
- Observability: structured JSON logs, Prometheus `/metrics`, Sentry DSN
  (`SENTRY_DSN` is read by config), uptime checks on `/health/ready`.
- Scaling: stateless API replicas; PgBouncer; Redis for shared rate limits and
  queues once implemented.

Terraform is intentionally a **data-plane skeleton**, not a complete production
deployment. The README and Terraform README say so explicitly.

---

## 13. Observability

- `GET /health/live` — process liveness.
- `GET /health/ready` — database connectivity (and future dependency checks).
- `GET /health` — summary.
- `GET /metrics` — Prometheus counters/histograms including
  `http_requests_total`; BullMQ/job metrics to be added with the queue.
- Every log line carries the request id; auth events include the school and
  actor but never tokens or password material.
- Audit trails are queryable per tenant and verifiable for tampering.

---

## 14. Architecture decision records (condensed)

| # | Decision | Rationale | Consequence |
| --- | --- | --- | --- |
| 1 | Modular monolith, not microservices | 100–150 tenants do not justify distributed complexity; team size is small | Extract modules behind the outbox when load demands |
| 2 | Shared schema + RLS, not schema-per-tenant | 150 schemas multiply migrations and connection overhead | Must test isolation rigorously; done via PGlite + real-Postgres CI |
| 3 | Non-owner runtime role | RLS can be bypassed by owners; `FORCE` helps but the owner still has DDL | Two connection strings; Compose splits migrate vs api |
| 4 | Transaction-local GUCs | Pooling cannot leak tenant context | All tenant access must use `withTenant`; enforced by review |
| 5 | UUIDv7 in the app | Time-sortable, index-friendly, no DB round-trip for IDs | Monotonic counter state must be process-safe (it is) |
| 6 | Zod contracts in `core` | One schema for API validation and client types | Core must stay framework-free; browser uses source aliases |
| 7 | Control plane separate from tenant audit | Platform operators must not appear in tenant audit, and vice versa | Two audit tables and two write paths |
| 8 | Integer minor units | Avoid floating-point money bugs | Formatting in `@schoolerp/core` |
| 9 | Opaque rotating refresh tokens | Revocation and reuse detection are simpler than JWT refresh | Requires a session table and pepper management |
| 10 | Tauri reuses the web bundle | One UI, one test suite, one design system | Desktop inherits web constraints; native features via commands |
| 11 | PGlite for local RLS tests | No Docker/Postgres in the delivery environment | CI also runs real PostgreSQL to close the gap |
| 12 | Hoisted pnpm node-linker | Prisma on Windows, monorepo resolution | Larger `node_modules`; Docker images build the full monorepo |

---

## 15. Risks and open items

| Risk | Impact | Mitigation |
| --- | --- | --- |
| RLS bypass through a future raw query | Cross-tenant leak | Code review rule, `applyTenantScope` helpers, isolation tests, lint for direct `prisma.` use in services |
| In-process rate limiting | Bypass when scaling horizontally | Move to Redis/gateway before multi-replica production |
| Missing document storage endpoints | Admissions documents are metadata-only | Phase 2: S3 signed upload/download, virus scanning, retention |
| Report cards synchronous | Large cohorts exceed 15 min target | Phase 3: BullMQ job + progress API |
| Desktop offline sync not fully wired | Outbox rows accumulate without replay | Phase 2: sync command + conflict policy (`base_version`) |
| Calendar conversion incomplete | BS dates displayed as AD | Phase 2: verified AD↔BS library with tests |
| PGlite ≠ PostgreSQL | Subtle planner/extension differences | CI job against real PostgreSQL 16 |
| No tenant export/deletion worker | GDPR-style requests are manual | Runbook procedure now, automated worker later |
| Secrets in local `.env` | Accidental commit | `.gitignore`, `.env.example` only, production validation |

---

## 16. Roadmap reference

The phase plan, module scope and requirement-by-requirement status live in
[`requirements-checklist.md`](requirements-checklist.md). In summary:

- **Phase 0** — architecture (this document). ✅
- **Phase 1** — platform foundation: monorepo, tenancy, auth, RBAC, control
  plane, audit, Docker/CI, UI shells. ✅
- **Phase 2** — core school operations vertical slice: students, attendance,
  academics, fees, notices, dashboards. ✅ (slice)
- **Phase 3** — HR/leave/payroll, admissions, homework, question bank,
  library/transport/hostel/inventory, direct messaging. ◐ broad slice.
- **Phase 4** — document contract, offline attendance replay, verified BS↔AD
  conversion, portal foundations. ◐ partial.
- **Phase 5** — fixed reports/CSV export, usage metering, read-only platform
  billing. ◐ partial.
- **Phase 6** — hardening: load, chaos, DR drills, accessibility audit, i18n/RTL.
  ○ tooling/docs only.
- **Phase 7** — scale-out: dedicated-database tier, queue extraction, multi-region.
  ○ schema hooks/design only.
