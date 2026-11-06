# Platform admin guide

This guide is for the SaaS operator who runs the **super-admin console** at
`http://localhost:8081` (production: `https://admin.schoolerp.app`).

The console is deliberately separate from the school app. A platform user cannot
sign in to a school, and a school user cannot sign in here.

---

## 1. Signing in

| Demo scope | Email | Password |
| --- | --- | --- |
| SUPER_ADMIN | `platform@schoolerp.local` | `Platform#2026!` |

Platform sessions last 28 hours (`PLATFORM_TOKEN_TTL_SECONDS`). The token is
stored in `sessionStorage`, so closing the browser tab ends the session. There is
no platform refresh endpoint yet; re-authenticate when the token expires.

Production requirements:

- change the seeded password before onboarding any real school,
- put the console behind the operator VPN or an identity-aware proxy,
- enable MFA at the proxy/IdP layer until platform TOTP is added (Phase 2),
- serve it only over TLS.

### Roles

| Role | Can do |
| --- | --- |
| `SUPER_ADMIN` | Everything: onboard, change status/plan, impersonate, announcements, audit |
| `BILLING` | View tenants, change plan/subscription and status; no impersonation or announcements |
| `SUPPORT` | Read-only tenant access; no plan/status changes, no impersonation |

The navigation hides pages a role cannot use, but the API is the source of
truth: every route is guarded independently.

---

## 2. Dashboard

The landing page shows platform counts (schools by status, students, staff),
recent schools and recent platform audit activity. Use it as the morning
health check:

- unexpected `SUSPENDED`/`CANCELLED` count → check the audit page,
- trial schools approaching expiry → follow up before the trial ends,
- onboarding spike with no activity → verify the school completed setup.

---

## 3. Onboarding a school

**Schools → Onboard school** (or `/onboard`). The form creates, in one
transaction:

1. the `School` row and its settings,
2. a `Subscription` on the selected plan (trial automatically gets 30 days),
3. the seven system roles for the tenant,
4. the first `SCHOOL_ADMIN` user with the password you type,
5. an academic year if you supply one,
6. optional starter data (classes, sections, subjects, grading scale, sample
   students) when **Seed sample data** is on.

### Fields

| Field | Guidance |
| --- | --- |
| School name | Legal or display name shown to users |
| Subdomain | Lowercase letters, numbers, hyphens; becomes `<slug>.schoolerp.app`; immutable after creation without a support migration |
| Timezone | IANA name, default `Asia/Kathmandu` |
| Locale | `en-NP`, `en-US`, `ne-NP`, … |
| Currency | ISO 4217, default `NPR` |
| Calendar | `AD` or `BS` (conversion behaviour is completed in Phase 2) |
| Plan | `trial`, `starter`, `growth`, `enterprise` |
| School admin | Full name, email, temporary password (≥ 10 chars, 3 character classes) |
| Academic year | Optional; if omitted the school admin creates it in settings |

### After onboarding

1. Copy the tenant URL and hand the administrator their credentials over a
   secure channel — never email a plaintext password.
2. Ask them to sign in and change the password immediately.
3. Confirm the school appears as `TRIAL` or `ACTIVE` on **Schools**.
4. If sample data was disabled, the admin must create classes/sections before
   importing students.
5. Record the onboarding in your support ticket.

> The API rejects a duplicate subdomain with `409`. If the slug is already
> taken, choose another; do not attempt to reuse a cancelled tenant's slug.

---

## 4. Finding and managing a tenant

**Schools** lists every tenant with status, plan, student/staff counts and trial
end date. Search by name or slug. Open a tenant to see:

- **Tenant profile** — slug, plan, currency, locale, calendar, trial end,
  timestamps,
- **Usage** — student and staff counts, plus any per-tenant limit or module
  overrides,
- **Subscription** — status and current billing period,
- **Plan limits** — the raw limits JSON for the plan,
- **Recent activity** — platform actions against this tenant.

### Changing status

**Manage tenant → Status → reason → Save.**

| Status | Effect |
| --- | --- |
| `TRIAL` | Full access until `trialEndsAt`; used for evaluations |
| `ACTIVE` | Normal paid operation |
| `SUSPENDED` | Tenant users are rejected at tenant resolution; data is retained; platform access remains |
| `CANCELLED` | Treated as suspended; use for churned tenants pending export/deletion |

A reason of at least 5 characters is **required**, and the change is written to
the platform audit log. Never suspend a school without a ticket reference in the
reason. Suspension is reversible; cancellation should follow the runbook's
export-and-delete procedure.

### Changing plan

Select the new plan in the same dialog and save. Plan changes affect effective
limits immediately; per-tenant overrides still win. If the tenant is over the new
limit, existing data is retained but new creates are rejected with
`PLAN_LIMIT_EXCEEDED` — warn the school before downgrading.

### Overrides

Limit and module overrides are stored on the school and applied on top of the
plan (`override > plan > platform default`). Use them for:

- a short grace increase during a migration,
- enabling a pilot module for one school,
- a contractual exception.

Overrides are visible on the tenant page so the next operator understands why a
school exceeds its plan. Remove them when no longer needed.

---

## 5. Impersonation

**Tenant → Impersonate user** (`SUPER_ADMIN` only).

Required:

- the target tenant user,
- a reason (≥ 10 characters),
- a consent/ticket reference from the school (≥ 3 characters),
- a valid TOTP code for the platform operator,
- a duration of 5–60 minutes (default 15).

The API issues a **short-lived tenant token** carrying `imp` (the impersonation
session) and `pid` (the platform operator). Both the platform audit log and the
tenant audit log record the start and end. The session can be ended explicitly
from the tenant page or expires automatically.

Rules:

1. Never impersonate without a written request from the school.
2. Do only what the ticket authorises; do not browse unrelated records.
3. End the session when finished.
4. If TOTP is not yet enrolled for the operator, impersonation will fail — enrol
   first (Phase 2 exposes self-service enrolment; until then the seed operator
   has no TOTP secret, so this flow is exercised in tests/CI rather than by
   default in the demo).

---

## 6. Announcements

**Announcements** publishes platform-wide or targeted messages to school users.

Fields: title, body, audience (`ALL`, `TRIAL`, `ACTIVE`, `SUSPENDED`,
`SELECTED`), selected schools, severity (`INFO`, `WARNING`, `CRITICAL`), publish
time and optional expiry.

- Use `INFO` for maintenance notices, `WARNING` for degraded features,
  `CRITICAL` only for outages or security events.
- Scheduled announcements require an ISO timestamp with an offset.
- Announcements are platform records, not tenant notices; schools cannot edit
  them.
- Publishing is audited. Deleting/editing published announcements is not exposed
  in the console yet; create a follow-up announcement instead.

---

## 7. Billing and usage

**Billing** (super admins and the `BILLING` role) summarises plans, subscriptions,
platform invoices and monthly recurring revenue. Yearly plan prices are
normalised to a monthly figure for MRR. Invoice runs, dunning, proration and
plan changes are automated; payments are captured through the checkout adapters
or marked paid manually. Live vendor gateway accounts and bank reconciliation
remain deployment integrations.

**Usage & metering** shows live student/staff counts plus the current month's
`MeterUsage` rows (students, staff, storage MB, API calls, SMS sent) for every
tenant. The `USAGE_ROLLUP` job can refresh meters; in this build jobs run
in-process from the `BackgroundJob` table.

If a tenant's usage looks wrong, check that its subscription/plan and
`MeterUsage` period match the current `YYYY-MM`; demo data is seeded for the
current month only.

---

## 8. Audit

**Audit** shows the control-plane trail: logins, onboarding, status/plan
changes, impersonation start/end, announcements and other platform actions.
Filter by action, entity, actor, school and time range; paginate with the table
controls.

Use it to answer:

- Who suspended this school, and why?
- Who impersonated a user, under which ticket?
- When was this tenant moved to `enterprise`?
- Which operator onboarded the last ten schools?

The tenant-side audit (`GET /api/v1/audit` in the school app) is separate and is
visible to the school's own administrators. Do not expect school activity in the
platform audit page.

---

## 9. Tenant export and deletion

Deletion is built into the tenant page for `SUPER_ADMIN`:

1. Verify the request and the requester's authority.
2. Export the tenant's data with the documented query set (or a scripted
   `pg_dump` filtered by `school_id`) and deliver it over an encrypted channel.
   Self-service export is not built yet.
3. Obtain written confirmation of deletion.
4. **Danger zone → Schedule tenant deletion**: record the reason and grace
   period. Sign-in is disabled immediately; data is retained until `purgeAfter`.
5. If the request was a mistake, use **Cancel scheduled deletion** before
   `purgeAfter`.
6. After the grace period, use **Purge tenant now** with the typed `PURGE`
   confirmation, or run the retention sweep. Audit and platform audit logs are
   retained; operational tenant rows are deleted and the school shell is
   anonymised.
7. Record the ticket in the reason and check the platform audit page.

Never delete a tenant by `DELETE FROM schools` — foreign keys and retention
rules apply, and audit rows must be archived first.

---

## 10. Common errors

| Symptom | Cause | Action |
| --- | --- | --- |
| `TENANT_NOT_FOUND` on login | Wrong subdomain or tenant suspended | Check the school status and slug |
| `TENANT_MISMATCH` | Host subdomain and token disagree | Re-open the correct tenant URL; clear stale storage |
| `PLAN_LIMIT_EXCEEDED` | Tenant at its student/staff limit | Raise the plan or add an override |
| `MODULE_NOT_ENABLED` | Module disabled for the plan/tenant | Enable the module override or upgrade |
| Onboarding `409` | Slug already used | Choose a different slug |
| `401` in the console after a break | 28-hour token expired | Sign in again |
| Impersonation `403` | Missing TOTP, role, or consent reference | Enrol TOTP; use `SUPER_ADMIN`; supply a ticket |

---

## 11. Operator checklist

Daily:

- [ ] Dashboard totals look sane; no unexpected suspensions.
- [ ] Review new audit entries for plan/status changes.
- [ ] Check trial expiries in the next 7 days.

Weekly:

- [ ] Review schools with no activity (possible failed onboarding).
- [ ] Reconcile plan changes against billing.
- [ ] Check the platform console and API health dashboards.

On every onboarding:

- [ ] Slug, timezone, currency and calendar verified with the school.
- [ ] Credentials delivered securely.
- [ ] Sample-data decision recorded.
- [ ] Support ticket updated.
