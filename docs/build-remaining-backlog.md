# Build guide — closing the remaining SchoolERP backlog

> **Status:** planning guide. Nothing in this document is claimed as delivered.
> It describes how to build the items still outstanding after the Phase 6–7
> contract work. Estimates are rough planning numbers, not commitments.
>
> Source of truth for current status: [`requirements-checklist.md`](./requirements-checklist.md)
> and the “Known gaps” section of [`../README.md`](../README.md).

## How to use this guide

Work in small branches, one workstream per branch, and keep the quality gates
green after every step:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

For every item, follow the same delivery pattern:

1. Add or extend the Zod contract in the owning service.
2. Add the controller endpoint and permission check.
3. Implement the service inside `withTenant` / `withTenantRead` (or
   `withPlatform` for control-plane work).
4. Write an audit row for privileged mutations.
5. Add a migration if the schema changes, including the RLS/grant block.
6. Add unit/integration tests and an RLS test for new tenant tables.
7. Regenerate `apps/api/openapi.json`.
8. Verify against a real stack, not only mocks.
9. Update README, architecture, checklist and runbook.
10. Commit and push.

### Non-negotiable project rules

- **Tenant isolation:** every tenant table has `school_id` and `FORCE ROW LEVEL
  SECURITY`; the runtime role `erp_app` is `NOBYPASSRLS`.
- **Money:** integer minor units, never floating point.
- **Contracts:** Zod schemas shared through `packages/core` where the web/desktop
  client also needs them.
- **Audit:** privileged mutations write an audit entry.
- **Migrations:** additive (expand/contract). Copy the RLS re-application block
  from `packages/db/prisma/migrations/0005_timetable_substitutions/migration.sql`.
- **No secrets in git.**

---

## Phase 0 — Unblock the environment

Everything below depends on a real stack. Install:

- Docker Desktop (Windows: WSL2 backend) or Docker Engine + Compose
- PostgreSQL client `psql`
- k6
- Rust (`rustup`) and the Tauri OS prerequisites
- Redis and MinIO — already defined in `docker-compose.yml`

Bring up the stack and establish the baseline:

```bash
pnpm install
pnpm docker:up
docker compose ps
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

**Acceptance**

- All Compose services report healthy.
- Web login works with `admin@greenvalley.edu.np / SchoolAdmin#2026`.
- API responds on `:4000`; Redis and MinIO are reachable.
- All gates pass.

Windows notes: install Docker Desktop with WSL2, k6 via `choco install k6`,
Rust via `rustup-init.exe` plus the MSVC build tools.

---

## Phase 1 — Finish the verification backlog

These scripts exist but have never been executed in this workspace.

### 1.1 Load tests

```bash
pnpm test:load
k6 run tests/load/attendance-burst.js
```

- Add thresholds: list endpoints `p(95) < 300 ms`, bulk attendance `< 2 s`,
  500 concurrent morning peak.
- Record real results in `docs/requirements-checklist.md`.
- Add a CI job that runs the smoke test against the Compose stack.

### 1.2 Chaos tests

Add `tests/chaos/` scripts that:

- stop Redis and prove core paths still work in degraded mode,
- stop the API mid-job and prove `BackgroundJob` rows stay retryable,
- break the database connection and prove health/readiness flips and recovers.

### 1.3 Restore drill

- `pg_dump` the database, restore into a scratch database, then run
  `pnpm --filter @schoolerp/db verify:seed`.
- Record exact timings and assert RPO ≤ 15 minutes / RTO ≤ 2 hours.

### 1.4 Desktop bundle

```bash
pnpm --filter @schoolerp/web build
pnpm desktop:bundle
```

- Install the artifact, verify launch, CSP, API connectivity and SQLCipher.
- Record artifact paths and the signing state.

**Acceptance:** all four runs are executed and the real outputs are recorded;
the checklist moves from “not executed” to measured results.

---

## Phase 2 — Dedicated-database tier

**Already built:** `TENANT_DB_URLS` parsing/caching in
`packages/db/src/routing.ts` and `packages/db/src/client.ts`;
`School.dataPlane` / `School.dedicatedDbRef` in the schema.

**Build**

1. **Provisioning script** (`infra/scripts/provision-tenant-db.mjs` or under
   `packages/db/scripts`):
   - create the database and an `erp_app` role with `NOBYPASSRLS`,
   - run `prisma migrate deploy` with the tenant DB owner URL,
   - apply the same RLS/grant block,
   - store the URL in a secret manager (not git, not plaintext columns).
2. **Control-plane API:** `PATCH /platform/schools/:id/data-plane` to set
   `dataPlane` and `dedicatedDbRef`, with audit, rejecting unreachable or
   behind-migration databases.
3. **Config reload:** load `TENANT_DB_URLS` from the secret store at boot; add
   per-dedicated-DB health checks and expose `tenantRoutingSummary()` in
   platform diagnostics.
4. **Migration fan-out tool:** iterate dedicated DBs, apply migrations, verify
   RLS, fail loudly with a per-tenant report.
5. **Decommission/rollback:** drain tenant, export data, remove the route,
   archive the database.

**Acceptance:** provision a second database locally, route one school to it,
prove reads and writes go there, prove RLS still blocks cross-tenant access, and
run the full suite.

---

## Phase 3 — Queue extraction (BullMQ + Redis) and distributed rate limits

**Already built:** durable `BackgroundJob` and `JobDispatcher` with
`QUEUE_DRIVER=db|webhook`.

**Build**

1. Add `bullmq` and `ioredis` to `apps/api`, or create a dedicated `apps/worker`.
2. Extend `QUEUE_DRIVER` to accept `redis`; enqueue
   `{ jobId, schoolId, type }` while keeping the DB row authoritative.
3. Worker process:
   - consume jobs,
   - re-open the job row in tenant scope,
   - claim atomically (`QUEUED → RUNNING`),
   - run the existing handler,
   - mark `COMPLETED` / `FAILED`, retry with exponential backoff, and move
     poison messages to a dead-letter queue.
4. Keep the in-process poller as the fallback when `QUEUE_DRIVER=db`.
5. Replace the in-process rate limiter with a Redis-backed
   `@nestjs/throttler` storage or a custom guard.
6. Add the worker to `docker-compose.yml` and to Terraform (ECS service).

**Acceptance:** run with `QUEUE_DRIVER=redis`, kill the worker mid-job, confirm
retries and no duplicate side effects; confirm the DB row remains the source of
truth; confirm rate limits are shared across replicas.

---

## Phase 4 — Read replica and multi-region DR

1. Provision a read replica (RDS read replica or a Compose streaming replica).
2. Set `READ_REPLICA_URL`; verify `withTenantRead` routes report queries and
   that writes never hit the replica.
3. Add replication-lag monitoring and a health check.
4. Write the promotion/failover runbook: DNS switch, connection string update,
   job drain, verification.
5. Terraform: cross-region read replica, Route53 health checks, WAF.
6. Run a quarterly DR drill using the Phase 1 restore procedure.

**Acceptance:** reports served from the replica, a failover drill completed,
with measured RTO/RPO.

---

## Phase 5 — Object storage (S3/MinIO)

**Already built:** presign/register contract, metadata, PostgreSQL-stored PDFs.

**Build**

1. Add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
2. Add `S3_ACCESS_KEY` and `S3_SECRET_KEY` to `apps/api/src/config/env.ts`
   (Compose already passes them; the schema does not validate them yet).
3. In `apps/api/src/storage/storage.service.ts`:
   - generate real presigned `PUT` and `GET` URLs,
   - verify the checksum on register,
   - delete the object on `remove`,
   - return `configured: true` only when signing succeeds.
4. Add a malware-scan hook (ClamAV sidecar or a queue/Lambda scan) before an
   object becomes downloadable.
5. Add lifecycle rules for incomplete uploads and retention in Terraform.
6. Wire the web upload/download flow to the presigned URLs.

**Acceptance:** upload via MinIO, download through a signed URL, reject an
unsigned URL, confirm deletion removes the object, and quarantine an EICAR test
file.

---

## Phase 6 — Vendor notification gateways

**Already built:** provider interface, console + generic webhook transports,
SendGrid email and Twilio SMS/WhatsApp transports, delivery receipts, retries,
per-user preferences.

**Remaining**

1. Add a VAPID web-push provider in `apps/api/src/notices/` or a new
   `notifications` module.
2. Add per-tenant sender identity and template rendering beyond the shared
   templates.
3. Add contract tests with mocked HTTP, plus one live smoke per provider when
   credentials exist.
4. Verify failure mapping, provider message IDs and no credentials in logs
   against the vendor sandboxes.

**Acceptance:** each channel sends through a real provider in staging, receipts
record provider IDs, failures retry, and no credentials appear in logs.

---

## Phase 7 — Payments: gateway SDK, reconciliation, portal checkout

**Already built:** hosted intents, signed webhooks, fee allocation, refunds,
idempotency; Stripe Checkout, Khalti, signed eSewa redirect and hosted fallback
adapters; staff and portal checkout flows behind a development-only mock;
settlement reconciliation with manual JSON import or a configured provider feed,
`providerRef` matching, mismatch classification, unsettled-intent counts, audit
rows and CSV export.

**Remaining**

1. Live sandbox verification for each gateway and webhook replay.
2. Provider-side refunds (the local refund ledger is implemented) and a scheduled
   daily settlement pull.
3. Bank reconciliation and production gateway accounts.

**Acceptance:** end-to-end sandbox payment in staging, idempotent webhook
replay, reconciliation matches, and the portal shows the correct paid balance.

---

## Phase 8 — Desktop offline sync and bundle

**Already built:** SQLCipher cache + outbox commands (schema v2), `/sync/pull`
incremental cache payload, web-client pull/replay loop, offline attendance
drafts, cached student/fee reads with network fallback, Settings cache
status/refresh/clear, server-side conflict persistence and the Tauri shell.
Static config/contract checks run in CI.

**Remaining**

1. Compile and smoke-test the native shell and signed installers on each OS
   (Rust/Tauri toolchain absent in this workspace).
2. Surface replay `409 VERSION_CONFLICT` rows in the conflict-resolution UI and
   add a pending-items indicator with backoff/telemetry.
3. Move the SQLCipher key and refresh token to the OS keychain.
4. Add code signing, an updater feed and background sync while minimized.
5. Decide whether payment-level detail belongs in the cache; today the offline
   fee summary is approximate (invoice issue dates, no method breakdown).

**Acceptance:** on an installed bundle, go offline, read students/classes/fees,
create attendance/payment rows, reconnect, confirm exactly-once replay and
conflict handling; install a signed bundle on a clean machine.

---

## Phase 9 — Observability and real cost

1. Wire Sentry into the API, worker, web and admin (the env var exists).
2. Add OpenTelemetry tracing and correlate request IDs.
3. Extend Prometheus metrics: job latency/queue depth, replica lag, provider
   failures.
4. Build dashboards and alerts: error rate, p95, queue backlog, failed jobs,
   payment webhook failures.
5. Replace plan-allocation cost with metered cost: tag cloud resources per
   tenant, ingest AWS Cost Explorer/cur, compute per-tenant allocation, and keep
   the plan figure as a fallback.

**Acceptance:** a forced error appears in Sentry with a request ID, dashboards
show live data, and the cost output cites a metered source.

---

## Phase 10 — Security hardening

1. Put AWS WAF or Cloudflare in front of the API/web with rate and bot rules.
2. Add secret scanning and SAST to CI (`gitleaks`, CodeQL or Semgrep).
3. Commission a penetration test; fix findings and record evidence.
4. Add CSP/security-header regression tests.
5. Make `pnpm audit --audit-level high` blocking when clean.
6. Move rate limiting to Redis (Phase 3).

**Acceptance:** WAF deployed, pen-test report and fixes recorded, CI blocks on
high-severity findings.

---

## Phase 11 — UX, accessibility, i18n and performance polish

1. **TanStack Table:** replace ad-hoc paginated tables module by module.
2. **Report-card print template:** add a print route and CSS, verify A4 output.
3. **Dark mode:** add theme tokens and a toggle for the school app.
4. **i18n/RTL:** extract every module’s strings, complete Nepali/Arabic
   translations, audit RTL layout and logical CSS properties.
5. **WCAG 2.1 AA:** run axe on every page, fix contrast/labels/focus/order, and
   add keyboard-only e2e tests.

**Acceptance:** axe reports zero serious issues on the main flows, keyboard-only
journeys pass, language switching covers all modules, and print output matches
the template.

---

## Phase 12 — Data lifecycle, degradation and DR guarantees

1. **Tenant deletion automation:** implemented (request → grace period →
   platform-guarded purge, retention sweep, audit and retained audit logs).
   Remaining: export storage objects alongside database rows, and schedule the
   sweep externally.
2. **Retention/consent automation:** scheduled job enforcing broader retention
   windows and consent withdrawals; `RETENTION_PURGE` currently covers
   notification rows only.
3. **Graceful degradation:** per-feature fallbacks when Redis/S3/a provider is
   down (queue to DB, store locally, retry) with clear UI banners.
4. **RPO/RTO:** formalize targets, run the Phase 1 drills, record results.

**Acceptance:** a test tenant can be exported and purged end to end; disabling
Redis/S3 keeps core flows working in degraded mode; drill results meet targets.

---

## Phase 13 — Audit partitioning and Terraform completion

1. Convert `audit_logs` to monthly partitions using
   `infra/postgres/partitioning.sql`, and add a maintenance job that creates
   future partitions.
2. Complete Terraform: ECS/Fargate services, ALB, Secrets Manager, WAF, S3,
   RDS multi-AZ + read replica, ElastiCache, cross-region backup/replica.
3. Add `terraform validate` / `plan` to CI against a non-production workspace.

**Acceptance:** partitions exist and roll forward; `terraform plan` is clean; a
staging environment can be created from the modules.

---

## Recommended execution order

| Order | Workstream | Type | Depends on | Rough effort |
| --- | --- | --- | --- | --- |
| 1 | Phase 0 — environment | infra | — | 1–2 days |
| 2 | Phase 1 — verification (load/chaos/restore/desktop) | verify | Phase 0 | 3–5 days |
| 3 | Phase 3 — queue + Redis rate limit | code/infra | Phase 0 | 4–6 days |
| 4 | Phase 5 — object storage | code | Phase 0 | 3–4 days |
| 5 | Phase 6 — notification vendors (remaining push/sender identity) | code/vendor | Phase 0 | 2–3 days |
| 6 | Phase 7 — live gateway sandbox verification and bank feeds (settlement matching done) | vendor/infra | Phase 0 | 3–5 days |
| 7 | Phase 8 — desktop sync + bundle | code/native | Phase 0 | 5–8 days |
| 8 | Phase 2 — dedicated DB tier | code/infra | Phase 1 | 5–8 days |
| 9 | Phase 4 — replica + DR | infra | Phase 0 | 4–6 days |
| 10 | Phase 9 — observability/cost | code/infra | Phase 3 | 3–5 days |
| 11 | Phase 10 — security | infra/vendor | Phase 3 | 5–10 days |
| 12 | Phase 11 — UX/a11y/i18n | code | — | 8–15 days |
| 13 | Phase 12 — lifecycle/degradation (deletion done; broader retention left) | code | Phase 3 | 2–4 days |
| 14 | Phase 13 — partitioning/Terraform | infra | Phase 4 | 4–6 days |

## In-repo work vs external access

### Can be done entirely in the repository

- Sentry/OpenTelemetry wiring, Prometheus dashboards, better metrics.
- S3 presign implementation and provider adapters with mocked contract tests.
- Desktop outbox wiring, replay worker and conflict UI.
- TanStack Table, report-card print, dark mode, i18n extraction, axe fixes.
- Graceful-degradation fallbacks.
- Audit partitioning script/migration and Terraform module authoring.
- Reconciling the stale early sections of `docs/requirements-checklist.md`.

### Requires external access

- Cloud provisioning, dedicated databases, replicas, WAF.
- Vendor credentials (email/SMS/payment/push).
- Load, chaos and restore drill execution.
- Rust/Tauri bundle signing.
- Penetration testing.

## Definition of done for every workstream

- [ ] Migration added (if the schema changed) and applied to a real PostgreSQL,
      with RLS/grant assertions.
- [ ] Zod contracts, controller, service and audit entry.
- [ ] Unit/integration test; RLS test if a tenant table was added.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`
      pass.
- [ ] `openapi.json` regenerated and the drift check is clean.
- [ ] Live verification against the running stack is recorded.
- [ ] README, architecture, checklist and runbook updated honestly.
- [ ] Committed on a focused branch and pushed.

## Immediate next steps

1. Once Docker is available, run Phase 0 and Phase 1 and record real results.
2. Verify notification and payment adapters against vendor sandboxes and record
   the evidence.
3. Start with the highest-leverage remaining in-repo item: **BullMQ worker
   extraction + Redis rate limiting** or **S3 presign implementation**. Both
   unblock several later phases and are fully testable locally.
