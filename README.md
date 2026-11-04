# SchoolERP — multi-tenant school management platform

Production-oriented monorepo for a school ERP SaaS serving 100–150 schools:
React web app, Tauri 2 desktop shell, NestJS API, PostgreSQL with row-level
security, and a separate super-admin console.

> **Delivery status:** Phase 0 (architecture) and Phase 1 (platform foundation)
> are implemented end-to-end. Phase 2 is a working vertical slice (students,
> attendance, academics, fees, notices, dashboards) that proves the
> tenant-isolation model. Phase 3 adds working HR/leave, payroll, admissions,
> homework, question bank, library, transport, hostel, inventory and messaging
> modules. Phases 4–5 are partial (document contract, offline replay, BS
> calendar, reports, usage metering, read-only platform billing), while Phases
> 6–7 are tooling/design only. See
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
  presign/register storage contract, idempotent offline attendance sync, verified
  BS↔AD conversion, CSV reports (overview, enrolment, attendance, fees, payroll,
  modules), tenant usage meters, background jobs, and a read-only platform
  billing/usage console.
- **Security/reliability:** helmet, CORS allow-list, request IDs, Zod validation
  at the boundary, auth rate limiting, append-only hash-chained audit logs,
  structured errors, health/readiness/liveness and Prometheus metrics,
  graceful shutdown.
- **Infra:** Docker Compose (Postgres 16, Redis 7, MinIO, migrate, API, web,
  admin), CI (lint/typecheck/tests/build/OpenAPI drift/audit), Playwright and k6
  skeletons, Terraform data-plane skeleton.

### Known gaps (tracked, not hidden)

- BullMQ/Redis queueing is configured in Compose but not yet used by the API;
  background jobs run in-process from the `BackgroundJob` table, and auth rate
  limiting is in-process.
- S3/MinIO is provisioned, but document upload/download uses a presign/register
  contract rather than real S3 signing; virus scanning and retention automation
  are not implemented.
- Phase 3 modules are functional slices: exam-paper assembly, offer letters,
  timetable substitutions, bulk promotion and email/SMS/push delivery are not
  built.
- Phase 5 billing is read-only (seeded/demo invoices); invoice generation,
  dunning, proration and payment capture are not automated.
- Desktop compiles only where Rust + platform webview exist; only the
  SQLCipher outbox is wired, not full background sync/conflict replay.
- Load/chaos/restore drills, WCAG audit, RTL support and penetration testing
  are not executed in this workspace.
- Docker/Postgres/Rust are unavailable in this workspace, so a networked
  PostgreSQL server, the Docker stack and the desktop bundle were not executed
  here. PGlite applies both `0001_init` and `0002_all_phases` in the RLS test
  (including tenant policies on the new Phase 3 tables); static checks cover the
  rest.

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
| `SCHOOLERP_DB_KEY` | Desktop SQLCipher key; otherwise generated per install |

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
