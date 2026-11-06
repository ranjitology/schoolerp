# Operations runbook

This runbook covers deployment, migrations, backups/PITR, incident response,
key rotation, tenant suspension/export/deletion, monitoring and capacity
planning for SchoolERP.

**Targets:** RPO ≤ 15 min, RTO ≤ 2 h. Validate quarterly with a restore drill.

---

## 1. Environments

| Environment | Purpose | Notes |
| --- | --- | --- |
| local | Development on a laptop | `docker compose up`, seeded demo tenants |
| staging | Pre-production, mirror of prod shape | Real PostgreSQL, run migrations here first |
| production | Live | Separate secrets, no `dev-only` credentials, TLS everywhere |

Never run destructive commands against production without a ticket, approval,
and a recent verified backup.

---

## 2. Deployment

### 2.1 Prerequisites

- Container registry access
- Database with the owner role for migrations and the `erp_app` role for the
  API
- Redis, S3/MinIO or object storage
- DNS, TLS certificate and ingress
- Secrets stored in your secret manager (never in the repo)

### 2.2 Build and publish images

```bash
# From repo root
docker build -f infra/docker/api.Dockerfile -t schoolerp/api:<sha> .
docker build -f infra/docker/web.Dockerfile  -t schoolerp/web:<sha>  .
docker build -f infra/docker/admin.Dockerfile -t schoolerp/admin:<sha> .
docker push ...
```

Images build the full monorepo with the hoisted pnpm layout.

### 2.3 Migrate and seed

Migrations must run as the **owner** role (can DDL; subject to `BYPASSRLS`).
The API must run as **`erp_app`** (`NOBYPASSRLS`).

```bash
# 1) Apply schema + RLS (idempotent)
DATABASE_URL="$DATABASE_OWNER_URL" pnpm --filter @schoolerp/db migrate

# 2) Seed or upgrade data (idempotent in design; re-seeding deletes demo data)
DATABASE_URL="$DATABASE_OWNER_URL" pnpm --filter @schoolerp/db seed

# 3) Deploy the new API image pointing at erp_app
DATABASE_URL="$DATABASE_URL"  # postgresql://erp_app:... 
```

In Compose this is the `migrate` service. In Kubernetes use a one-shot Job with
the owner connection string pulled from a secret that the API never sees.

`0002_all_phases` adds the Phase 3–7 tables and appends the dynamic RLS policy
block. The PGlite RLS test applies it and asserts isolation on the new tables,
but it has **not** been run against a networked PostgreSQL server here; run it on
staging first and verify `school_id` policies with the RLS smoke query in
Appendix A.

### 2.3.1 Background jobs

Jobs are stored in `background_jobs` and executed in-process by the API (no
BullMQ worker yet). Supported types: `REPORT_CARDS`, `FEE_REMINDERS`,
`ATTENDANCE_DIGEST`, `DATA_EXPORT`, `USAGE_ROLLUP`, `TENANT_DELETION` and
`RETENTION_PURGE`. `TENANT_DELETION` cannot be created from a tenant session;
only the platform console schedules it. `RETENTION_PURGE` trims notification
rows older than `RETENTION_NOTIFICATION_DAYS`. If the API restarts mid-run,
inspect the job row and re-queue manually; there is no automatic lease recovery
yet.

### 2.4 Rolling deploy

1. Run migrations on staging and smoke test.
2. Deploy API first (backward-compatible schema), wait for health checks.
3. Deploy web and admin consoles.
4. Run `/api/v1/health/ready` and a login smoke test.
5. Monitor error rates and latency for 10 minutes.

If the API fails readiness, roll back to the previous image before investigating.

### 2.5 Environment variables

Copy `.env.example`. Critical production values:

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `DATABASE_URL` | yes | `erp_app` role, no DDL |
| `JWT_ACCESS_SECRET` | yes | ≥ 32 chars, not starting with `dev-only` |
| `JWT_REFRESH_PEPPER` | yes | ≥ 16 chars; rotate only with a plan (invalidates refresh tokens) |
| `BASE_DOMAIN` | yes | For subdomain tenant resolution |
| `APP_ORIGIN` | yes | Comma-separated allowed origins for CORS |
| `ALLOW_TENANT_HEADER` | yes | `false` in production |
| `TRUST_PROXY` | yes | `true` behind a load balancer |
| `SENTRY_DSN` | no | Errors; keep empty if not using |
| `REDIS_URL` | no | For shared limits/queues |
| `S3_*` | no | For document storage |
| `EMAIL_PROVIDER` / `SENDGRID_API_KEY` | no | `console` unless vendor email is enabled |
| `SMS_PROVIDER` / `TWILIO_*` | no | `console` unless vendor SMS/WhatsApp is enabled |
| `PAYMENT_GATEWAY_PROVIDER` | no | Default provider when a request omits one; `mock` unless configured |
| `TENANT_DELETION_GRACE_DAYS` | no | Default grace period for scheduled tenant deletion (30) |
| `RETENTION_NOTIFICATION_DAYS` | no | Age cutoff for notification retention cleanup (365) |

---

## 3. Migrations: expand/contract

Never drop columns or rename tables in the same release as code that uses
them.

### Expand phase

1. Add a nullable column or a new table.
2. Deploy a migration that backfills existing rows (in batches, during
   low-traffic hours if large).
3. Deploy API code that reads the new shape and writes **both** old and new.
4. Verify reads and writes.

### Contract phase

1. Deploy code that only reads/writes the new shape.
2. Make the new column `NOT NULL` if required (after backfill).
3. Drop the old column in a subsequent migration (separate deploy).
4. Remove unused code.

If a migration must lock a large table, test the lock time on staging with
production-sized data. Consider `CREATE INDEX CONCURRENTLY`, adding columns
with defaults carefully, and batching backfills.

RLS policies are regenerated by `rls.sql`; do not manually edit tenant policies
to "fix" a query — fix the query or the index instead.

---

## 4. Backups and PITR

### 4.1 Automated backups (RDS)

Terraform sets:

- `backup_retention_period = 14`
- daily backup window, maintenance window
- Multi-AZ in production
- encryption at rest

Snapshots are taken automatically. Verify they exist in AWS Backup or the RDS
console.

### 4.2 Manual snapshots

Before a risky migration:

```bash
aws rds create-db-snapshot \
  --db-instance-identifier schoolerp-production \
  --db-snapshot-identifier schoolerp-pre-migration-$(date +%Y%m%d%H%M)
```

### 4.3 Point-in-time recovery (PITR)

RPO ≤ 15 min is achievable if WAL shipping is enabled and healthy. To restore:

1. **Decide the restore point** (UTC). Pick the last known-good time before the
   incident.
2. **Restore to a new instance** in a sandbox VPC/subnets with a different
   identifier (never restore over the live instance).
3. **Apply parameter/option groups** and allow the instance to reach `available`.
4. **Update security groups** to allow your jump host only.
5. **Validate**:
   - connect as the owner and run `\dt`
   - check row counts per school
   - verify the audit hash chain for a sample tenant: `GET /api/v1/audit/verify` logic or a script
   - sign in as a user in each demo tenant
   - run a smoke test against the restored copy
6. **Cut over** only if validation passes; update DNS/connection strings and
   rotate credentials if WAL logs could have been exfiltrated.
7. **Document** the restore time and compare to RTO.

### 4.4 Compose/local backups

```bash
# Logical backup
docker compose exec db pg_dump -U postgres -d schoolerp --format=custom -f /tmp/schoolerp.dump

# Copy out
docker cp schoolerp-db-1:/tmp/schoolerp.dump ./backups/

# Restore
docker compose exec -T db pg_restore -U postgres -d schoolerp --clean --if-exists --no-owner /tmp/schoolerp.dump
```

Do not use these for production.

---

## 5. Incident response

### Severity levels

| Level | Example | Response time | Escalation |
| --- | --- | --- | --- |
| SEV-1 | Cross-tenant data leak, auth bypass | Immediate | Security + engineering lead + legal if PII |
| SEV-2 | All tenants down, payments failing | < 15 min | On-call + platform lead |
| SEV-3 | One tenant down, degraded performance | < 1 h | On-call |
| SEV-4 | Cosmetic, non-blocking | Next business day | Support |

### Response steps

1. **Acknowledge** the incident in chat/ticket and assign an incident commander.
2. **Stabilise** — scale up, fail over, roll back, or enable maintenance mode.
   If cross-tenant access is suspected, **rotate `JWT_ACCESS_SECRET` and
   `JWT_REFRESH_PEPPER` immediately** (this invalidates all tokens) and freeze
   platform logins until cleared.
3. **Investigate** — pull logs with request ids, check `/health/ready`, DB
   connections, replication lag, Redis/S3.
4. **Communicate** — update affected schools without leaking PII; use platform
   announcements only if appropriate.
5. **Fix** — deploy the fix, verify with smoke tests.
6. **Post-mortem** — blameless, root cause, action items, deadline for each.
   Document in the ticket and link to the runbook update if the procedure
   changed.

### Common playbooks

#### API down
- Check container health, load balancer targets, security groups.
- Check database connectivity from the API pod/container.
- Look at recent deploys and roll back if correlated.
- If DB is the issue, consider failover to a read replica only if the app
  supports it (Phase 2) — currently all writes go to the primary.

#### Database slow / connection exhaustion
- Check `pg_stat_activity`, long-running queries, locks.
- `idle_in_transaction_session_timeout` is 60 s; `statement_timeout` 30 s.
- Increase pool size carefully or kill idle-in-tx sessions (with caution).
- Add the missing tenant-first index before scaling up the instance.

#### RLS suspected bypass
- Query with the `erp_app` role: `SET LOCAL app.school_id = '<uuid>'; SET LOCAL app.is_platform = 'false'; ...`
- Compare results to a platform query.
- Check recent migrations for policy changes.
- Review audit logs for cross-tenant access patterns.
- If confirmed, treat as SEV-1.

#### Rate-limiting bypass / brute force
- The auth guard is in-process; behind multiple replicas it does not share
  state. Add a Redis-based limiter or put the gateway in front. For now, block
  the IP at the ingress and rotate credentials if accounts were compromised.

---

## 6. Key rotation

### JWT access secret
1. Generate a new secret (≥ 32 bytes, base64 or hex).
2. Deploy with **both** secrets temporarily (if the library supports key ids) —
   the current implementation uses a single secret. A single-secret rotation
   means **all access tokens are invalidated at the moment of change**.
3. Inform users that they will need to sign in again.
4. Remove the old secret after all old tokens have expired (15 minutes +
   clock skew).

### JWT refresh pepper
Changing the pepper means **all existing refresh tokens become invalid**
(because hashes won't match). Users must sign in again. Plan maintenance
around this.

### Database passwords
- Rotate the `erp_app` password: update the secret, restart the API replicas
  one by one.
- Rotate the `postgres` (owner) password: update the secret used by the
  migration job and by operators; coordinate with no migrations in progress.
- Use AWS Secrets Manager rotation where possible.

### S3 / object storage keys
Rotate access keys, update the API secret, and invalidate presigned URLs if
necessary (URLs embed the signature).

### Tauri SQLCipher key
The key lives in `offline.key` or `SCHOOLERP_DB_KEY`. Rotating it makes the
local database unreadable. Do **not** rotate it on user devices without a
migration strategy; treat it as device-local and back up the outbox before any
change.

---

## 7. Tenant suspension, export and deletion

### Suspension
1. Platform admin opens the tenant → **Manage tenant → Suspend** with a ticket
   reason.
2. Users from that tenant are rejected at tenant resolution (`TENANT_SUSPENDED`).
3. Platform operators can still view the tenant and start impersonation if
   necessary for export.
4. Data is retained. No automatic deletion.

### Export
Until the self-service export API ships:

1. Get written authorisation from the school owner.
2. Suspend the tenant.
3. Connect to the database as the owner.
4. Export tables filtered by `school_id` using `COPY` or a script. Include:
   - students, guardians, staff, users
   - attendance, exams, marks, report cards
   - invoices, payments, refunds, ledger
   - notices, notifications
   - audit logs
   - settings and documents metadata
5. Export in a structured format (CSV/JSON); include a manifest with counts.
6. Deliver over an encrypted channel; delete the local copy after delivery.
7. Log the export in the platform audit log.

### Deletion
The platform console implements the lifecycle; the manual procedure is only a
fallback for environments without the console.

1. Export completed and confirmed by the school.
2. Ensure the statutory retention period for financial/audit records has
  passed (consult your legal counsel). **Audit logs and financial records must
  not be deleted before the retention period expires**.
3. Open the tenant → **Danger zone → Schedule tenant deletion**, record the
  reason and grace period. This disables sign-in immediately and sets
  `purgeAfter`; nothing is purged yet.
4. To reverse an accidental request before `purgeAfter`, use **Cancel scheduled
  deletion**. The tenant is re-activated and queued deletion jobs are cancelled.
5. After the grace period, either run the scheduled sweep
  `POST /api/v1/platform/retention/run` (or with `{ "dryRun": true }` to list due
  tenants first) or use **Purge tenant now** with the typed `PURGE`
  confirmation. Early purge requires the force checkbox.
6. The purge calls `purge_tenant_data(uuid)`, which requires
  `app.is_platform = 'true'`. It deletes every table carrying `school_id` except
  `schools`, `audit_logs` and `platform_audit_logs`, then anonymises the
  `schools` row (`deleted-<id-prefix>` slug, plan/overrides cleared).
7. Verify the platform audit log contains `platform.school_deletion_requested`,
  `platform.school_deletion_cancelled`, `platform.school_purged` and/or
  `platform.retention_run` entries with the ticket reference.

If the SQL function reports unresolved foreign keys, inspect the blocked table
before attempting a manual delete. Do not disable the append-only audit
triggers, and never run `TRUNCATE` on `audit_logs`.

---

## 8. Monitoring and alerting

### Health
- `/api/v1/health/live` — restart on failure
- `/api/v1/health/ready` — remove from load balancer on failure
- `/api/v1/metrics` — scrape with Prometheus

### Key alerts
| Metric | Threshold | Action |
| --- | --- | --- |
| API 5xx rate | > 1% over 5 min | Investigate errors, check DB |
| API p95 latency | > 500 ms over 5 min | Check slow queries, index usage |
| DB connections | > 80% of max | Check pool, kill idle-in-tx |
| DB replication lag | > 30 s | Investigate WAL; consider read-only routing |
| Failed logins (auth) | spike | Possible brute force; rate-limit/block |
| Queue depth | grows monotonically | Scale workers (when queues ship) |
| Disk usage (DB) | > 80% | Plan scaling or partition cleanup |
| Certificate expiry | < 14 days | Renew TLS |
| Backup failure | any | Run a manual backup and investigate |

### Dashboards to have
- Requests by route, status, tenant (log-derived)
- Auth events (login/fail/refresh)
- Attendance bulk latency
- Fee collection volume
- Platform audit volume
- RLS policy violations (should be zero; alert on any)

---

### Disaster recovery summary
- **Backup:** RDS automated + manual snapshots before deploys/migrations
- **Restore:** PITR to new instance, validate, cut over — target RTO ≤ 2 h
- **Communication:** Incident commander updates stakeholders every 30 min for
  SEV-1/2
- **Testing:** Quarterly restore drill — record actual RPO/RTO and fix gaps

---

## 9. Capacity planning

| Component | Baseline (50 schools) | Growth (100–150 schools) | Notes |
| --- | --- | --- | --- |
| API | 2 vCPU, 4 GB, 2 replicas | 4 vCPU, 8 GB, 4–6 replicas | Stateless; scale horizontally |
| PostgreSQL | db.t4g.medium | db.r6g.large/xlarge | Multi-AZ in prod; read replica for reports |
| Redis | cache.t4g.micro | cache.t4g.small/medium | Shared limits/queues/cache |
| S3 | standard | standard/IA | Lifecycle rules for old documents |
| Load balancer | ALB | ALB with WAF | Rate limiting at edge |
| PgBouncer | none (local) | transaction mode, 2 replicas | Protects the DB from connection storms |

### Sizing notes
- Tenant-first indexes are critical: without them, a cross-tenant scan becomes
  likely.
- Bulk attendance: 60 students * (row + audit + outbox) in one transaction.
- Report cards: batch per class; move to a queue before the 15 min target
  becomes tight.
- Storage: plan limits are enforced at the API level (500 MB – 50 GB), but
  bucket size must be monitored.
 
---

## 10. Maintenance checklist

Daily:
- [ ] `/health/ready` green
- [ ] Backup status OK
- [ ] No SEV alerts
- [ ] Platform audit reviewed

Weekly:
- [ ] Slow query log review
- [ ] Failed login spikes
- [ ] Disk/connection usage trends
- [ ] Pending migrations list

Monthly:
- [ ] Key rotation schedule review (secrets nearing expiry)
- [ ] Capacity review against 90-day growth
- [ ] Security patch review for base images
- [ ] Runbook updates from incidents

Quarterly:
- [ ] **Restore drill** — perform PITR, validate, time it, report
- [ ] Tenant export/deletion procedure test
- [ ] Load test against staging (k6)
- [ ] Accessibility spot-check
- [ ] Disaster recovery review

---

## Appendix A: Quick commands

```bash
# Logs
docker compose logs -f api
# Health
curl https://api.schoolerp.app/api/v1/health/ready
# OpenAPI
curl https://api.schoolerp.app/api/v1/openapi.json | jq '.info.version'
# RLS check (owner)
psql "$DATABASE_OWNER_URL" -c "SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('student','attendance_record');"
# Migrate
DATABASE_URL="$DATABASE_OWNER_URL" pnpm --filter @schoolerp/db migrate
# Seed demo
DATABASE_URL="$DATABASE_OWNER_URL" pnpm db:seed
# Build all
pnpm build
# Tests
pnpm test && pnpm typecheck && pnpm lint
```

---

## Appendix B: File locations

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | Local topology |
| `.env.example` | Env template |
| `infra/docker/*` | Dockerfiles/nginx |
| `infra/postgres/init/01-roles.sql` | Role bootstrap |
| `packages/db/prisma/migrations/0001_init/migration.sql` | Base schema + appended RLS |
| `packages/db/prisma/migrations/0002_all_phases/migration.sql` | Phase 3–7 schema + appended RLS |
| `packages/db/prisma/rls.sql` | RLS policies, audit triggers, grants |
| `packages/db/prisma/partitioning.sql` | Audit partition runbook |
| `packages/db/src/client.ts` | Tenant/platform transaction wrappers |
| `apps/api/src/config/env.ts` | Env validation |
| `apps/api/src/main.ts` | Bootstrap, middleware, guards, Swagger |
| `apps/api/openapi.json` | Contract snapshot |
