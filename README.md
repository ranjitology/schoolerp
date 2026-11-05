# SchoolERP — multi-tenant school management platform

Production-oriented monorepo for a school ERP SaaS serving 100–150 schools:
React web app, Tauri 2 desktop shell, NestJS API, PostgreSQL with row-level
security, and a separate super-admin console.

> **Delivery status:** Phase 0 (architecture) and Phase 1 (platform foundation)
> are implemented end-to-end. Phase 2 is a working vertical slice (students,
> attendance, academics, fees, notices, dashboards) that proves the
> tenant-isolation model. Phase 3 adds working HR/leave, payroll, admissions,
> homework, question bank, library, transport, hostel, inventory and messaging
> modules. Phases 4–5 are substantially delivered (document templates and
> generated PDFs, offline replay with conflict review, BS↔AD conversion, reports
> with saved views and rollups, hosted payment intents with signed webhooks,
> usage metering, automated platform billing, web-push subscriptions,
> notification preferences, PWA and i18n/RTL), while Phases 6–7 remain
> tooling/design. See
> [`docs/requirements-checklist.md`](docs/requirements-checklist.md) for the
> honest requirement-by-requirement status.

---

## What is in the box

| Package | Purpose |
| --- | --- |
| `apps/api` | NestJS modular monolith, REST + OpenAPI, JWT auth, RBAC, RLS-scoped data access |
| `apps/web` | React 18 + TypeScript strict + Vite + Tailwind school client |
| `apps/admin-console` | Platform operator console: tenants, plans, announcements, audit, impersonation |
| `apps/desktop` | Tauri 2 shell that reuses the web build, with a SQLCipher offline outbox |
| `packages/core` | Framework-free domain logic and Zod contracts (shared by API, web, desktop) |
| `packages/db` | Prisma schema, migrations, RLS policies, seed, PGlite isolation tests |
| `packages/ui` | Shared shadcn-style primitives (Button, Card, Table, Badge, …) |
| `infra` | Docker images, Postgres init, Terraform data-plane skeleton |

### Implemented capabilities

- **Multi-tenancy:** shared schema, `school_id` on every tenant table,
  `FORCE ROW LEVEL SECURITY`, transaction-local GUCs (`app.school_id`,
  `app.is_platform`), subdomain/token tenant resolution with mismatch rejection.
- **Identity:** Argon2id passwords, 15-minute access JWT, rotating opaque refresh
  tokens (hashed + peppered, reuse detection revokes the family), optional TOTP,
  session listing/revocation, password reset, lockout after failed attempts.
- **RBAC:** role baselines + per-user grants/denies, permission-guarded
  controllers, platform roles (`SUPER_ADMIN`, `SUPPORT`, `BILLING`).
- **Control plane:** tenant onboarding, plan/limit/module overrides, status
  changes with audit reasons, announcements, platform audit, time-boxed
  impersonation with consent reference and TOTP.
- **School operations:** students (list/search/create/update/archive, CSV
  import/export, plan limits), attendance (idempotent bulk upsert, session view,
  summaries, low-attendance), academics (years, classes, subjects, timetable,
  exams, marks, report cards), fees (heads, structures, invoices, payments with
  allocation and receipt numbers, refunds, ledger, defaulters, expenses),
  notices and notifications, dashboards.
- **Operations depth (Phase 3):** staff directory, leave approval and staff
  attendance, payroll runs/payslips, admissions pipeline, homework, question
  bank, library circulation, transport routes/assignments, hostel rooms/
  allocations, inventory stock movements, and staff–guardian message threads.
- **Portals, offline and reporting (Phase 4–5):** document metadata plus a
  presign/register storage contract, idempotent offline attendance sync with
  persisted conflict review, verified BS↔AD conversion, CSV reports (overview,
  enrolment, attendance, fees, payroll, modules) with saved/custom views, tenant
  usage meters, background jobs, email/SMS/webhook notification delivery with
  retries and per-user preferences, a PWA shell with offline app-cache, and
  English/Nepali/Arabic UI with RTL support.
- **Accounting and payments:** double-entry general ledger with a seeded chart
  of accounts, trial balance and idempotent postings from invoices, payments,
  refunds, expenses and payroll; hosted payment intents with signed settlement
  webhooks and manual confirmation.
- **Documents and delivery:** tenant document templates, server-side PDF
  rendering and generated-document download; web-push subscriptions dispatched
  through a deployment-owned gateway.
- **Reporting and scale hooks:** tenant report rollup tables with a refresh
  endpoint/job, opt-in read-replica routing for report queries, and an optional
  webhook queue dispatcher while the durable job row remains authoritative.
- **Platform billing (Phase 5):** idempotent invoice runs per tenant/period,
  dunning ladder (reminder → warning → restriction), proration on plan changes,
  mark-paid/void with reasons, MRR/usage console, and automated billing actions.
- **Security/reliability:** helmet, CORS allow-list, request IDs, Zod validation
  at the boundary, auth and per-tenant rate limiting, append-only hash-chained
  audit logs, structured errors, health/readiness/liveness and Prometheus
  metrics, graceful shutdown.
- **Infra:** Docker Compose (Postgres 16, Redis 7, MinIO, migrate, API, web,
  admin), CI (lint/typecheck/tests/build/OpenAPI drift/audit), Playwright and k6
  skeletons, Terraform data-plane skeleton.

### Known gaps (tracked, not hidden)

- `QUEUE_DRIVER=webhook` can hand a job to an external worker, but the default
  remains the durable `BackgroundJob` table polled in-process; no BullMQ worker
  is deployed here. Rate limiting is in-process (single instance).
- S3/MinIO is provisioned, but document upload/download uses a presign/register
  contract plus tenant-generated PDFs stored in PostgreSQL; real S3 signing,
  virus scanning and retention automation are not implemented.
- Exam-paper assembly and timetable substitution approval are not built;
  built-in document templates cover bonafide certificates, fee receipts,
  payslips and admission offers.
- Notification transports support console and a generic HTTP webhook; web-push
  subscriptions are stored and dispatched through `PUSH_WEBHOOK_URL`. Direct
  email/SMS vendor integrations require credentials and are not wired.
- Hosted payment intents and signed settlement webhooks are implemented, but no
  vendor SDK is bundled; a real gateway and bank reconciliation remain
  deployment integrations.
- Desktop compiles only where Rust + platform webview exist; the SQLCipher
  outbox and API replay path are wired. Settings shows sync batches and lets
  reviewers resolve conflicts, but the native bundle was not compiled here.
- Load/chaos/restore drills, a formal WCAG audit and penetration testing are not
  executed in this workspace.
- Docker/Postgres/Rust are unavailable in this workspace, so the Docker stack
  and the desktop bundle were not executed here. Migrations were applied and the
  demo seed was run against managed PostgreSQL (Neon); PGlite applies both
  migrations in the RLS test, and static checks cover the rest.

---

## Quick start (Docker Compose)

Requirements: Docker Desktop with Compose v2. Nothing else.

```bash
cp .env.example .env          # change secrets before any shared deployment
docker compose up --build
```

First boot creates the database volume, applies migrations, and seeds two demo
tenants. Services:

| URL | Service |
| --- | --- |
| http://localhost:8080 | School web app |
| http://localhost:8081 | Platform admin console |
| http://localhost:4000/api/v1/docs | OpenAPI / Swagger UI |
| http://localhost:4000/api/v1/health | Health |
| http://localhost:9001 | MinIO console (`schoolerp` / `schoolerp-dev-secret`) |

Stop and remove data:

```bash
docker compose down -v
```

### Demo credentials

| Scope | Email | Password |
| --- | --- | --- |
| Platform super admin | `platform@schoolerp.local` | `Platform#2026!` |
| Green Valley admin (`green-valley`) | `admin@greenvalley.edu.np` | `SchoolAdmin#2026` |
| Green Valley teacher | `teacher@greenvalley.edu.np` | `Teacher#2026` |
| Green Valley accountant | `accounts@greenvalley.edu.np` | `Accounts#2026` |
| Green Valley parent | `parent@greenvalley.edu.np` | `Parent#2026` |
| Green Valley student | `student@greenvalley.edu.np` | `Student#2026` |
| Sunrise admin (`sunrise`) | `admin@sunrise.edu.np` | `SchoolAdmin#2026` |

The tenant slug is entered on the sign-in screen. For local development the web
client defaults to `green-valley`.

---

## Local development (without the full Compose stack)

Requirements: Node 22+ (Node 20.11 minimum), pnpm 9.15, Docker for PostgreSQL.

```bash
pnpm install
pnpm db:generate

# Start dependencies only, then apply migrations/seed as the owner role
docker compose up -d db redis minio
pnpm --filter @schoolerp/db exec prisma migrate deploy   # DATABASE_URL owner
pnpm db:seed

# Terminal 1 — API
pnpm dev:api

# Terminal 2 — web
pnpm dev:web

# Terminal 3 — platform console
pnpm dev:admin

# Desktop (requires Rust + Tauri prerequisites)
pnpm desktop:dev
```

Set the owner connection string for migrations and the application connection
string for the API:

```bash
# migrations/seed (DDL + bypass RLS)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/schoolerp pnpm db:migrate
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/schoolerp pnpm db:seed

# API runtime (DML only, RLS enforced)
DATABASE_URL=postgresql://erp_app:erp_app@localhost:5432/schoolerp pnpm dev:api
```

> The application must **never** run as the table owner. RLS is `FORCE`d, but the
> migration role keeps `BYPASSRLS`; using it at runtime defeats isolation.

### Environment

See [`.env.example`](.env.example). Critical variables:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Runtime role `erp_app` (no DDL, RLS enforced) |
| `JWT_ACCESS_SECRET` | ≥ 32 chars; production refuses `dev-only` values |
| `JWT_REFRESH_PEPPER` | ≥ 16 chars; rotation invalidates all refresh tokens |
| `BASE_DOMAIN` | Enables subdomain tenant resolution |
| `ALLOW_TENANT_HEADER` | Dev-only `X-School-Slug`; disable in production |
| `PAYMENT_GATEWAY_WEBHOOK_SECRET` | Signs hosted-payment settlement webhooks |
| `PUSH_WEBHOOK_URL` | Deployment gateway for web-push fan-out |
| `READ_REPLICA_URL` | Optional read replica for report queries; primary is the fallback |
| `QUEUE_DRIVER` / `QUEUE_WEBHOOK_URL` | `db` (default) or `webhook` dispatch hint |
| `SCHOOLERP_DB_KEY` | Desktop SQLCipher key; otherwise generated per install |

---

## Managed PostgreSQL (Neon)

The migrations are portable to managed PostgreSQL. Neon needs the **direct**
(non-pooler) host for `prisma migrate deploy` and for the seed, because both use
session-level features; the API runtime can use the pooled host.

```bash
# packages/db/.env — never commit this file
DATABASE_URL="postgresql://<user>:<password>@<endpoint>.c-16.<region>.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

pnpm --filter @schoolerp/db generate
pnpm --filter @schoolerp/db migrate
SEED_TX_TIMEOUT_MS=3600000 pnpm --filter @schoolerp/db seed
```

`prisma migrate deploy` loads `packages/db/.env` automatically. The API does not
read `.env` files, so export the runtime variables in the shell (or your process
manager) before starting it. Use the **application** role, never the owner role:

```bash
DATABASE_URL="postgresql://erp_app:<password>@<endpoint>-pooler.c-16.<region>.aws.neon.tech/neondb?sslmode=require"
JWT_ACCESS_SECRET="<32+ random chars>"
JWT_REFRESH_PEPPER="<16+ random chars>"
NODE_ENV=production
pnpm --filter @schoolerp/api start
```

Notes:

- Managed providers often give the owner role `BYPASSRLS` (Neon does). Running
  the API as the owner defeats tenant isolation even though policies are
  `FORCE`d. Provision a dedicated DML-only role, for example:

  ```sql
  CREATE ROLE erp_app LOGIN PASSWORD '<strong-password>'
    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  GRANT CONNECT ON DATABASE neondb TO erp_app;
  GRANT USAGE ON SCHEMA public TO erp_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
  ```

- Verify the deployment with the application role:

  ```bash
  DATABASE_URL="postgresql://erp_app:<password>@<endpoint>.../neondb?sslmode=require" \
    pnpm --filter @schoolerp/db verify:seed
  ```

  The script prints per-tenant counts and fails if a tenant-scoped transaction
  can see another tenant's students.

- `SEED_TX_TIMEOUT_MS` raises the interactive transaction budget. The full demo
  seed performs many sequential writes, so a remote database with per-statement
  latency can exceed the default 30s by an order of magnitude.
- The seed is idempotent: it replaces the `green-valley` and `sunrise` demo
  tenants and leaves other tenants untouched.
- If your provider requires TLS, keep `sslmode=require`; add
  `channel_binding=require` when the driver supports it.

---

## Testing

```bash
pnpm test              # unit + RLS (PGlite) tests
pnpm test:coverage     # coverage for core, db and api
pnpm typecheck         # strict TypeScript across packages
pnpm lint
pnpm build             # builds core, db, ui, api, web, admin; validates desktop config
pnpm test:e2e          # Playwright: public shells, a11y basics (starts Vite)
pnpm test:load         # k6 smoke (requires k6 + seeded stack)
```

- RLS proof: `packages/db/test/rls.test.ts` applies the real migration to an
  in-process PostgreSQL (PGlite), creates a non-owner `erp_app`, and proves
  cross-tenant reads/writes are denied, platform bypass is audited, and audit
  rows are append-only.
- E2E specs intentionally avoid credentials so they run without a database; the
  seeded-stack smoke test lives in `.github/workflows/e2e.yml`.
- CI runs the full quality gate plus a real PostgreSQL job that applies
  migrations and seeds through the owner role.

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full Phase 0 design.
The short version:

```
Browser / Tauri
   │  HTTPS, HttpOnly refresh cookie (web) or body token (desktop)
   ▼
NestJS API  ──►  PostgreSQL 16 (shared schema + RLS)
   │                   ├─ tenant tables (school_id)
   │                   └─ control plane (schools, plans, platform audit)
   ├──► Redis (rate limits/queues, reserved)
   └──► S3/MinIO (documents, reserved)
```

- **Tenant resolution:** host subdomain → dev `X-School-Slug` → JWT `sid`.
  A host/token mismatch is rejected with `TenantMismatchError`.
- **Data access:** only through `withTenant({ schoolId })` or
  `withPlatform()`, which set transaction-local GUCs. No service touches
  `prisma` directly for tenant data.
- **Money** is integer minor units; **dates** are ISO `YYYY-MM-DD` with explicit
  timezone handling; **IDs** are UUIDv7 generated in the application.
- **Audit** is append-only, hash-chained per tenant, and separately maintained for
  the platform control plane.

---

## Documentation

- [Architecture (Phase 0)](docs/architecture.md)
- [Platform admin guide](docs/admin-guide.md)
- [School onboarding guide](docs/onboarding-guide.md)
- [Operations runbook](docs/runbook.md)
- [Requirement checklist & phase plan](docs/requirements-checklist.md)
- [Desktop shell](apps/desktop/README.md)

## License

Proprietary. All rights reserved.
