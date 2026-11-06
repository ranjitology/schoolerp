# Requirements checklist and phase plan

This document maps the delivery brief to the repository. It is deliberately
honest: ✅ means implemented and verifiable in this repo, ◐ means a working
partial slice, ○ means designed/planned but not built.

Legend: ✅ implemented · ◐ partial slice · ○ planned.

---

## 1. Delivery status at a glance

| Phase | Scope | Status |
| --- | --- | --- |
| Phase 0 | Architecture, tenancy model, stack decisions, ADRs | ✅ |
| Phase 1 | Platform foundation: monorepo, DB/RLS, auth/RBAC, control plane, audit, CI/Docker, UI shells | ✅ |
| Phase 2 | Core school operations vertical slice: students, attendance, academics, fees, notices, dashboards | ◐ working slice |
| Phase 3 | HR/payroll, admissions, exams at scale, communication, library/transport/hostel/inventory | ◐ broad working slice |
| Phase 4 | Portal depth, offline replay, document storage, BS calendar, mobile/PWA | ◐ partial |
| Phase 5 | Analytics/reporting, billing overview, usage metering | ◐ partial |
| Phase 6 | Hardening: load/chaos/DR, accessibility audit, i18n/RTL | ○ tooling/docs only |
| Phase 7 | Scale-out: dedicated DB tier, queue extraction, multi-region | ◐ contracts only |

**Bottom line:** Phase 0 and Phase 1 are complete. Phase 2 remains a proven
vertical slice. Phase 3 has working API + web modules for HR/leave, payroll,
admissions (including offer letters and bulk conversion), homework, question
bank with exam-paper assembly, timetable substitution approval, library,
transport, hostel, inventory, direct messaging and notification delivery
receipts. Phase 4 now includes document templates with server-side PDF
generation and download, offline attendance replay with conflict review in
Settings, BS-AD conversion, a hosted payment-intent and signed-webhook flow
with Stripe/Khalti/eSewa checkout adapters and portal fee payment, web-push
subscriptions, notification preferences, parent-portal child switching
and an installable offline-aware PWA, but not a compiled desktop bundle or live
vendor gateway accounts. Phase 5 has tenant reports, saved report views with
custom columns/metrics, usage metering, report rollup tables, opt-in
read-replica reads, warehouse CSV export jobs and platform billing automation
(invoice runs, dunning, proration, plan changes), and settlement reconciliation with
manual feed import or a configured upstream feed. Payments still have no bundled
gateway SDK. Phase 6 verification is limited by the available toolchain. Phase 7 has
dedicated-database routing and queue-dispatch contracts plus per-tenant SLO/cost
reporting, but no provisioned dedicated-database tier or multi-region
deployment.

---

## 2. Phase 0 — Architecture

| Requirement | Status | Where |
| --- | --- | --- |
| Architecture document with context, tenancy, auth, modules, data, deployment | ✅ | `docs/architecture.md` |
| Seven-phase plan | ✅ | This document, §9 |
| Stack decisions and ADRs | ✅ | `docs/architecture.md` §14 |
| Tenancy model (shared schema + RLS) | ✅ | `docs/architecture.md` §4, `packages/db/prisma/rls.sql` |
| Data model | ✅ | `packages/db/prisma/schema.prisma` |
| Security model | ✅ | `docs/architecture.md` §10 |
| Reliability/performance targets | ✅ | `docs/architecture.md` §9, §11 |
| Risks and open items | ✅ | `docs/architecture.md` §15 |
| Runbook, admin guide, onboarding guide | ✅ | `docs/` |

---

## 3. Phase 1 — Platform foundation

### 3.1 Monorepo and tooling

| Requirement | Status | Evidence |
| --- | --- | --- |
| pnpm + Turborepo monorepo with required apps/packages | ✅ | `pnpm-workspace.yaml`, `turbo.json`, `apps/*`, `packages/*` |
| TypeScript strict everywhere | ✅ | `tsconfig.base.json`, per-package configs |
| React + Vite + Tailwind + shadcn-style UI | ✅ | `apps/web`, `packages/ui` |
| NestJS modular monolith | ✅ | `apps/api/src/app.module.ts` |
| Shared domain/contract package (Zod) | ✅ | `packages/core` |
| Tauri 2 desktop shell | ◐ source/config complete; requires Rust/webview to build |
| Admin console | ✅ | `apps/admin-console` |
| Lint/format/test scripts | ✅ | ESLint 9 flat config, Prettier, Vitest/Jest |
| Docker Compose | ✅ | `docker-compose.yml` |
| CI pipeline | ✅ | `.github/workflows/ci.yml` |
| OpenAPI export + drift check | ✅ | `apps/api/openapi.json`, CI job |

### 3.2 Database and tenancy

| Requirement | Status | Evidence |
| --- | --- | --- |
| PostgreSQL 16 | ✅ | Compose, Terraform |
| Shared schema, `school_id` on tenant tables | ✅ | `schema.prisma` (60 mapped `school_id` fields) |
| `FORCE ROW LEVEL SECURITY` | ✅ | `rls.sql` |
| Transaction-local tenant GUCs | ✅ | `packages/db/src/client.ts` |
| Non-owner runtime role (`erp_app`, `NOBYPASSRLS`) | ✅ | `infra/postgres/init/01-roles.sql`, Compose split |
| Platform bypass audited | ✅ | `withPlatform`, platform audit |
| Tenant isolation tests | ✅ | `packages/db/test/rls.test.ts` (PGlite, every migration) + CI real-Postgres job |
| Migrations | ✅ | `packages/db/prisma/migrations/0001_init` through `0005_timetable_substitutions` |
| Seed with ≥ 2 demo tenants | ✅ | `packages/db/prisma/seed.ts` |
| Audit append-only + hash chain | ✅ | `rls.sql`, `audit` module |
| Audit partitioning | ◐ script + runbook (`partitioning.sql`); conversion deferred |
| Read replica readiness | ✅ | `readPrisma`/`withTenantRead` route report reads to `READ_REPLICA_URL` and fall back to the primary when unset |
| Future dedicated-DB capability | ◐ `TENANT_DB_URLS` routing contract with cached per-tenant clients and shared fallback; provisioning/migration automation not built |

### 3.3 Identity and access

| Requirement | Status | Evidence |
| --- | --- | --- |
| Argon2id password hashing | ✅ | `packages/core/src/server/password.ts` |
| JWT access tokens (15 min) | ✅ | `apps/api/src/auth/token.service.ts` |
| Rotating refresh tokens, hashed + peppered | ✅ | `auth.service.ts`, Prisma `RefreshToken` |
| Refresh reuse detection | ✅ | family revocation in `auth.service.ts` |
| TOTP | ✅ | `packages/core/src/server/totp.ts`, auth service |
| Password reset | ✅ | `auth` module |
| Session list/revoke | ✅ | `auth` module, web settings |
| Lockout after 5 failures | ✅ | `auth.service.ts` |
| RBAC (role baseline + grants/denies) | ✅ | `packages/core/src/rbac.ts`, `PermissionsGuard` |
| Ownership scoping | ◐ implemented for portals/notices; expand per module |
| Tenant/platform separation | ✅ | separate guards/controllers |
| Impersonation (consent, TOTP, audit, expiry) | ✅ | `platform.service.ts` |
| Platform roles (`SUPER_ADMIN`, `SUPPORT`, `BILLING`) | ✅ | `platform` module |

### 3.4 Control plane

| Requirement | Status | Evidence |
| --- | --- | --- |
| Tenant onboarding | ✅ | `POST /platform/schools` |
| Tenant list/detail | ✅ | `GET /platform/schools`, `/:id` |
| Plan/subscription/status management with reason | ✅ | `PATCH /platform/schools/:id` |
| Limit/module overrides | ✅ | `limitsOverride`, `modulesOverride` |
| Announcements | ✅ | `/platform/announcements` |
| Platform audit | ✅ | `/platform/audit`, `PlatformAuditLog` |
| Tenant export/deletion | ◐ | deletion lifecycle is implemented (`/platform/schools/:id/deletion`, `/purge`, `/retention/run`, `TENANT_DELETION` job); `DATA_EXPORT` job exists, no self-service export API |
| Billing automation | ○ | Phase 5 |
| Usage metering | ○ | Phase 5 |

### 3.5 Security and reliability

| Requirement | Status | Evidence |
| --- | --- | --- |
| OWASP controls (validation, injection, headers, CORS) | ✅ | Zod, Prisma, helmet, CORS allow-list |
| Auth rate limiting | ◐ in-process guard; Redis/gateway for multi-replica is planned |
| Audit log | ✅ | tenant + platform |
| Signed URLs | ○ | storage endpoints not built |
| PII minimisation / retention / consent | ◐ | minimal selects; retention fields, `RETENTION_PURGE` notification cleanup and runbook; broader record-level policy and scheduling pending |
| Backups + PITR | ✅ configured in Terraform, documented in runbook | |
| Restore drills | ◐ procedure + quarterly checklist; not executed in this workspace |
| Expand/contract migrations | ✅ documented and followed | |
| Graceful degradation | ◐ health/readiness; Redis/S3 not required by core paths | |
| Observability | ✅ `/health`, `/metrics`, request ids; Sentry env hook |
| RPO ≤ 15m / RTO ≤ 2h | ◐ designed and documented; drill pending | |

### 3.6 UX

| Requirement | Status | Evidence |
| --- | --- | --- |
| Responsive layouts | ✅ | Tailwind breakpoints across web/admin |
| Keyboard navigation | ✅ | focus-visible styles, skip link, dialogs |
| Command palette / search | ✅ | admin console `Ctrl/⌘K` school search |
| Skeletons/empty states | ✅ | `Skeleton`, `EmptyState`, loading states |
| Data tables | ◐ list tables with pagination; TanStack Table not yet used |
| Print assets | ◐ print CSS in web shell; report-card print layout pending |
| i18n/RTL | ◐ i18next configured; translations partial, RTL audit pending |
| Bundled assets | ✅ | Vite build, no external CDN required |
| WCAG 2.1 AA | ◐ baseline labels/focus/contrast; formal audit pending |
| Dark mode | ◐ admin console dark; school app light-first |

---

## 4. Phase 2 — vertical slice delivered

> This section records what the Phase 2 slice contained when it landed. Some
> rows marked ○ here (admissions pipeline, staff attendance, homework, staff
> messaging, payload exports) were delivered later in Phase 3 — see §5. The
> authoritative current status is §1 plus §5.

### 4.1 Admissions and students

| Requirement | Status | Evidence |
| --- | --- | --- |
| Student list/search/filter/pagination | ✅ | `GET /students`, `studentListQuerySchema` |
| Create/update/archive | ✅ | `students.controller.ts` |
| Detail with guardians/documents | ✅ | `GET /students/:id` |
| CSV export | ✅ | `GET /students/export.csv` |
| CSV import with preview/commit and row errors | ✅ | `POST /students/import` |
| Plan limit enforcement | ✅ | `assertStudentLimit` |
| Admissions pipeline | ○ | fields exist; workflow not built |
| Documents upload/signed URLs | ○ | metadata only |
| Bulk promotion | ○ | Phase 3 |

### 4.2 Attendance

| Requirement | Status | Evidence |
| --- | --- | --- |
| Bulk idempotent attendance | ✅ | `POST /attendance/bulk` |
| Session view | ✅ | `GET /attendance/session` |
| Summary + low attendance | ✅ | `GET /attendance/summary` |
| List by date/class/section | ✅ | `GET /attendance` |
| Policy configuration UI | ○ | policy fields exist; no write endpoint |
| Staff attendance | ○ | Phase 3 |

### 4.3 Academics

| Requirement | Status | Evidence |
| --- | --- | --- |
| Academic years | ✅ | `/academics/years` |
| Classes/sections | ✅ | `/academics/classes` |
| Subjects and class mapping | ✅ | `/academics/subjects` |
| Timetable slots | ✅ | `/academics/timetable` |
| Exams and marks | ✅ | `/academics/exams`, `/marks`, `ExamsPage.tsx` (create exams, enter marks, absent handling) |
| Report cards + publish | ✅ | `/academics/report-cards`, `/publish`, printable report-card workspace in `ExamsPage.tsx` |
| Background generation < 15m | ◐ synchronous for seeded cohort; queue planned |
| BS calendar conversion | ○ | setting/schema only; verified conversion Phase 2/3 |
| Substitutions, rooms, conflict detection | ✅ | substitution request/review/cancel workflow (`/academics/timetable/substitutions`) plus clash checks; rooms remain a Phase 3 item |

### 4.4 Fees and accounts

| Requirement | Status | Evidence |
| --- | --- | --- |
| Fee heads | ✅ | `/fees/heads` |
| Fee structures | ✅ | `/fees/structures` |
| Invoice generation | ✅ | `/fees/invoices/generate` |
| Invoice list/detail | ✅ | `/fees/invoices` |
| Payment collection with allocation | ✅ | `/fees/payments` |
| Receipt numbers | ✅ | `NumberSequence` |
| Idempotency | ✅ | `(schoolId, idempotencyKey)` |
| Refunds | ✅ | `/fees/refunds` |
| Settlement reconciliation | ✅ | `/payments/reconciliations/import`, `/payments/reconciliations/pull`, list/detail/CSV export; matches `providerRef`, flags amount/status/missing/duplicate lines and counts unsettled intents |
| Student ledger | ✅ | `/fees/ledger/:studentId` |
| Summary/defaulters | ✅ | `/fees/summary`, `/defaulters` |
| Expenses | ✅ | `/fees/expenses` |
| Online payment gateway | ✅ | hosted intents and signed settlement webhooks (`/payments`), staff and portal checkout |
| Payroll/accounting integration | ○ | Phase 3/5 |
| Double-entry ledger | ✅ | `ledger` module: chart of accounts, trial balance and idempotent journal postings from invoices, payments, refunds, expenses and payroll |

### 4.5 Communication and dashboards

| Requirement | Status | Evidence |
| --- | --- | --- |
| Staff notices CRUD/publish/archive | ✅ | `/notices` |
| Audience filters (roles/classes/sections) | ✅ | `noticeSchema` |
| Portal notices with visibility | ✅ | `/portal/notices` |
| Notifications + read state | ✅ | `/notifications` |
| Email/SMS/push delivery | ○ | notices are in-app; providers planned |
| Staff dashboard | ✅ | `/dashboard` |
| Role-aware portal dashboard | ✅ | `/dashboard/me` |
| Custom report builder | ○ | Phase 5 |
| Report exports | ◐ students CSV; fee/attendance exports planned |

### 4.6 Portals

| Requirement | Status | Evidence |
| --- | --- | --- |
| Parent portal | ◐ dashboard/attendance/fees/notices; child selector partial |
| Student portal | ◐ dashboard/results/notices |
| Online fee payment | ○ | Phase 4 |
| Homework/downloads | ○ | module flag; Phase 3 |
| Portal notification preferences | ○ | Phase 4 |

---

## 5. Phase 3–7 delivery status

### Phase 3 — Operations depth (◐ broad working slice)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Staff directory, employment status, leave requests/approval | ✅ | `apps/api/src/hr`, `HrPage.tsx`, `StaffLeave` |
| Staff attendance register | ✅ | `/hr/attendance`, `StaffAttendance` |
| Payroll runs, payslips, totals | ✅ | `apps/api/src/payroll`, `PayrollPage.tsx`, `PayrollRun`/`Payslip` |
| Admissions enquiry → application → offer → enrolment | ✅ core workflow | `apps/api/src/admissions`, `AdmissionsPage.tsx` (offer letters and automated document collection remain manual) |
| Homework assignments by class/section | ✅ | `/homework`, `HomeworkPage.tsx` |
| Question bank | ✅ | `/question-bank`; deterministic exam-paper assembly UI selects questions by subject/type/count and orders them |
| Library catalogue, issue/return, fines | ✅ core | `/library`, `LibraryPage.tsx` |
| Transport routes, stops, student assignment | ✅ core | `/transport`, `TransportPage.tsx` |
| Hostel blocks, rooms, allocations | ✅ core | `/hostel`, `HostelPage.tsx` |
| Inventory items, stock movements, reorder visibility | ✅ core | `/inventory`, `InventoryPage.tsx`; `WAREHOUSE_EXPORT` job writes CSV documents |
| Direct staff–guardian messaging | ✅ | `/messages`, `MessagesPage.tsx`, `MessageThread`/`Message` |
| Email/SMS/push delivery providers | ✅ contract | template registry, recipient planning, `NotificationDelivery` receipts, retry and per-user opt-outs; console transport by default, optional SendGrid email and Twilio SMS/WhatsApp transports (`EMAIL_PROVIDER`, `SMS_PROVIDER`) plus a generic webhook gateway (credentials are deployment config) |
| Timetable substitutions/conflict detection | ✅ | clash checks, slot create/delete, and a PENDING → APPROVED/REJECTED/CANCELLED request/review/cancel workflow in `TimetablePage.tsx` (`timetable_substitutions`, migration `0005`) |
| Exams at scale (moderation, transcripts, queued generation) | ✅ | moderation, transcript and queued `REPORT_CARDS` job; the queue runs in-process rather than on BullMQ |
| Server-side bulk report-card job | ✅ partial | `REPORT_CARDS` handler in `apps/api/src/jobs`; runs in-process, not BullMQ |
| Admissions offer letters / bulk promotion | ✅ | printable offer-letter endpoint, bulk admission conversion and student class promotion with preview |

### Phase 4 — Portals and offline (◐ partial)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Document metadata and storage presign/register contract | ✅ contract | `apps/api/src/documents`, `apps/api/src/storage`, `packages/core/src/storage.ts`; S3 signing is deployment configuration, not exercised locally |
| Document templates and generation records | ✅ | tenant templates, `renderPdf`, generated-document list/download (`/documents/templates`, `/documents/generate`) |
| Offline attendance queue and idempotent replay | ✅ API slice | `apps/api/src/sync`, `SyncBatch`, idempotency keys, conflict listing |
| Sync conflict persistence and manual resolution | ✅ | `OutboxConflict` rows with `SERVER_WINS`/`CLIENT_WINS`/`DISMISSED` review, surfaced in Settings with batch history |
| Desktop offline sync replay | ◐ | SQLCipher outbox source exists; full device/conflict/background sync not compiled or tested (no Rust toolchain) |
| BS↔AD calendar conversion | ✅ | `packages/core/src/calendar.ts` using `nepali-date-converter`, fixture tests |
| Parent/student portal dashboards, results, notices | ✅ | portal endpoints cover the Phase 2 scope; linked children can be switched in the portal dashboard; portal users pay invoices through the scoped checkout flow |
| Portal notification preferences | ✅ | `GET/PUT /notifications/preferences`, stored per user |
| Online fee payment gateway | ✅ | hosted payment intents, signed settlement webhook, manual confirmation, staff and portal checkout flows; Stripe Checkout, Khalti, signed eSewa redirect and hosted fallback adapters, with a development-only mock. Settlement reconciliation supports manual JSON import or a configured provider feed with `providerRef` matching, mismatch flags and CSV export; live vendor accounts and real bank-statement feeds remain deployment integrations |
| PWA/mobile shell and push notifications | ◐ | installable manifest, app-shell cache, web-push subscriptions through `PUSH_WEBHOOK_URL`; native bundle not compiled here |

### Phase 5 — Analytics and billing (◐ partial)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Tenant reports: overview, enrolment, attendance, fees, payroll, module usage | ✅ | `apps/api/src/reports`, `ReportsPage.tsx` |
| CSV report export | ✅ | `/reports/*.csv`, web download helper |
| Usage metering (students, staff, storage, API calls, SMS) | ✅ contract | `MeterUsage`, `USAGE_ROLLUP` job, platform usage endpoint |
| Platform billing overview (plans, subscriptions, invoices, MRR) | ✅ | `GET /platform/billing`, `BillingPage.tsx` |
| Platform usage console | ✅ | `GET /platform/usage`, `UsagePage.tsx`; includes 30-day job success rate, avg/p95 duration, SLO status and plan-allocated cost |
| Invoice generation, dunning, proration, plan changes | ✅ | idempotent monthly invoice runs, 14-day dunning ladder, proration credits, mark-paid/void, admin console actions |
| Payment capture | ✅ | hosted intents plus signed webhook settlement, staff and portal checkout; Stripe/Khalti/eSewa/hosted adapters and a development-only mock; no bundled card/wallet SDK |
| Materialised views / warehouse export | ✅ | tenant report rollup tables refreshed by `REPORT_ROLLUP` with live-query fallback; `WAREHOUSE_EXPORT` job emits inventory item and transaction CSVs as downloadable documents |
| Custom report builder | ✅ | saved report views with per-report column/metric whitelists, validation on save, metric projection on run and filtered CSV export |

### Phase 6 — Hardening (○ tooling/docs only)

- Load/chaos/restore scripts and runbook procedures exist, but none were
  executed here because Docker/PostgreSQL/k6 are unavailable in this workspace.
- Accessibility, i18n and RTL coverage remain partial; English/Nepali labels
  cover navigation and shell plus the timetable and question-bank modules, not
  every module.
- Audit partitioning is scripted but not applied; Redis-backed rate limits, WAF
  and penetration testing are not implemented.
- Migrations `0001_init` through `0005_timetable_substitutions` are applied in
  PGlite with RLS assertions (including the substitution table), and have been
  deployed to managed PostgreSQL (Neon); the Docker stack and desktop bundle
  were not executed in this workspace.

### Phase 7 — Scale-out (◐ contracts only)

- `School.dataPlane` and `School.dedicatedDbRef` exist in the schema.
  `TENANT_DB_URLS` (JSON object or `schoolId=url` pairs) drives per-tenant
  Prisma client routing with a shared fallback, but no dedicated-database
  provisioning or migration automation is implemented.
- `withTenantRead()` can use `READ_REPLICA_URL` when a replica is provisioned,
  and `QUEUE_DRIVER=webhook` can hint an external worker, but BullMQ worker
  extraction and multi-region DR are not built. `BackgroundJob` remains the
  durable queue and runs in-process by default.
- The platform usage console reports per-tenant 30-day job success rate,
  average/p95 duration, SLO status and plan-allocated cost; these are observed
  application metrics, not external APM or metered infrastructure spend.

---

## 6. Cross-cutting requirements matrix

| Requirement | Status | Notes |
| --- | --- | --- |
| 100–150 schools | ◐ architecture and limits support it; load-tested only with k6 scripts | |
| Per-tenant config/flags/limits | ✅ | `entitlements.ts`, overrides |
| Per-tenant rate limits | ✅ | in-process `TenantRateLimitGuard` keyed by school/user, configurable via `TENANT_RATE_LIMIT_PER_MINUTE`; gateway limit still recommended for multi-replica |
| Queue fairness | ◐ | DB-backed `BackgroundJob` queue scoped per tenant; optional `QUEUE_DRIVER=webhook` dispatch, no external worker deployed |
| Data export/deletion | ✅ deletion / ◐ export | platform-guarded deletion request, cancel, purge and retention sweep with audit and retained audit logs; `DATA_EXPORT` job exists but there is no self-service export API |
| Future dedicated DB | ◐ | `dataPlane`/`dedicatedDbRef` fields plus `TENANT_DB_URLS` routing contract with cached clients; provisioning not automated |
| Tenant isolation tests | ✅ | PGlite applies every migration and asserts isolation (students, library, timetable substitutions) before real-Postgres CI |
| < 300 ms p95 list endpoints | ◐ | tenant-first indexes; not measured locally |
| < 2 s bulk attendance | ◐ | single-transaction upsert; k6 script provided |
| Report cards < 15 min | ◐ | `REPORT_CARDS` job handler exists; in-process, not load-tested at scale |
| 500 concurrent morning peak | ◐ | k6 scenario; infra sized, not executed |
| Partitioning plan | ✅ | audit partitioning script + runbook |
| OWASP controls | ✅ | see architecture §10 |
| Parameterized queries | ✅ | Prisma; raw SQL only in scripts |
| Rate limiting | ✅ | auth guard plus `TenantRateLimitGuard` (per school/user, `TENANT_RATE_LIMIT_PER_MINUTE`); in-process, so a gateway limit is still recommended for multi-replica deployments |
| Audit log | ✅ | tenant + platform, hash chain |
| Signed URLs | ◐ | presign/register contract in `storage` module; S3 signing deferred to deployment config |
| PII minimisation | ✅ | minimal selects, redacted errors |
| Retention/consent | ◐ | `RETENTION_PURGE` trims notification rows via `RETENTION_NOTIFICATION_DAYS`; broader record-level policy and sweep scheduling pending |
| Backups/PITR | ✅ | Terraform + runbook |
| Restore drills | ◐ | documented, not executed here |
| Expand/contract migrations | ✅ | documented and followed |
| Graceful degradation | ◐ | health checks; feature-level fallback pending |
| RPO ≤ 15m / RTO ≤ 2h | ◐ | designed |
| Responsive, WCAG 2.1 AA | ◐ | baseline implemented; audit pending |
| Keyboard + command palette | ◐ | admin command palette; web shortcuts basic |
| Skeletons/empty states | ✅ | shared UI |
| Data tables | ◐ | paginated tables; TanStack Table not wired |
| Print assets | ◐ | print CSS; report-card template pending |
| i18n/RTL | ◐ | i18next wired with English/Nepali/Arabic and RTL shell mirroring; module-level translations still partial |
| Bundled assets | ✅ | Vite build |
| Vitest/Jest | ✅ | core/db/api |
| Playwright | ✅ | public shell + a11y specs |
| k6 | ✅ | smoke + attendance burst |
| Docker/CI | ✅ | Compose + GitHub Actions |
| Terraform | ◐ | data-plane skeleton |
| Sentry/Prometheus | ◐ | Prometheus metrics; `SENTRY_DSN` env only |
| README/admin/onboarding/runbook | ✅ | `README.md`, `docs/` |
| Desktop bundle | ◐ | source/config; Rust toolchain absent locally |

---

## 7. Definition-of-done check

The brief's definition of done:

| Criterion | Status |
| --- | --- |
| `docker compose up` brings up the stack | ✅ authored and health-checked; not executed here because Docker is unavailable in this workspace |
| `pnpm desktop:dev` | ◐ requires Rust + webview; config validated |
| ≥ 2 seeded demo tenants | ✅ Green Valley + Sunrise |
| All tests pass | ✅ unit/RLS/API locally; CI covers real PostgreSQL |
| Load tests pass | ◐ scripts provided; execution requires a running stack + k6 |
| No critical lint/security warnings | ✅ lint clean; `pnpm audit` in CI |
| README + admin guide + onboarding guide + runbook | ✅ |

**Deployed verification:** migrations `0001_init` through
`0005_timetable_substitutions` were applied with `prisma migrate deploy` to a
managed Neon PostgreSQL database, the idempotent demo seed was executed against
the same database (with an extended interactive-transaction budget), and
`pnpm --filter @schoolerp/db verify:seed` confirmed the seeded tenants and RLS
isolation using a dedicated `erp_app` role (`NOBYPASSRLS`, DML only). The
repository was pushed to `github.com/ranjitology/schoolerp`. The seed replaces
only the `green-valley` and `sunrise` demo tenants.

Additional live checks against the Neon-backed API covered login, report-field
catalogues, saved report create/run/export, a `WAREHOUSE_EXPORT` job and its CSV
download, timetable substitution request/review, and per-tenant SLO/cost fields
in the platform usage response.

**Known environmental limitation:** this workspace has no Docker, local
PostgreSQL server, psql, Rust or Tauri toolchain. Verification therefore used:

- PGlite for the real PostgreSQL RLS/migration tests: all five migrations
  (`0001_init` through `0005_timetable_substitutions`) are applied, including
  tenant policies on the Phase 3, phase-completion and substitution tables,
- a managed Neon PostgreSQL database for the production migrations and demo
  seed; the Docker Compose stack and desktop bundle were still not executed here,
- `prisma generate` plus TypeScript for the data layer,
- unit/API tests for auth, validation, CSV, audit, rate limiting, calendar and
  payroll/analytics helpers,
- Vite production builds for web and admin,
- a static Tauri config validator,
- GitHub Actions for the real-Postgres and Docker smoke jobs.

---

## 8. How to verify locally

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e          # after pnpm test:e2e:install
```

With Docker:

```bash
cp .env.example .env
docker compose up --build
# web http://localhost:8080 · admin http://localhost:8081 · API docs http://localhost:4000/api/v1/docs
```

With k6 and a seeded stack:

```bash
k6 run -e BASE_URL=http://localhost:4000/api/v1 tests/load/smoke.js
CLASS_ID=... SECTION_ID=... STUDENT_IDS=... \
  k6 run -e BASE_URL=http://localhost:4000/api/v1 tests/load/attendance-burst.js
```

---

## 9. Phase acceptance summary

| Phase | Acceptance signal |
| --- | --- |
| 0 | Architecture reviewed; risks accepted |
| 1 | Two tenants isolated by tests; platform can onboard/suspend; audit verifiable |
| 2 (slice) | A school can run students → attendance → exams → fees → notices → dashboards |
| 3 | A school can run staff/leave/payroll, admissions, homework, messaging and library/transport/hostel/inventory |
| 4 | Document templates/PDFs, offline sync review, BS↔AD conversion, hosted payment intents and signed webhooks, portal child switching; compiled desktop bundle remains partial |
| 5 | Fixed reports, custom report columns/metrics, report rollups, CSV export, warehouse export job, usage metering and automated platform billing |
| 6 | Load/chaos/DR/accessibility sign-off — **not achieved**; scripts and procedures only |
| 7 | Dedicated-DB routing and per-tenant SLO/cost reporting contracts are implemented; a provisioned dedicated tier and multi-region deployment are **not live** |
