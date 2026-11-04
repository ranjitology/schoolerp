# School onboarding guide

Audience: the school's `SCHOOL_ADMIN` and the people they nominate (principal,
accountant, teachers). This is the practical "first two weeks" guide.

Demo tenant: **Green Valley Secondary School**, subdomain `green-valley`.

| Role | Email | Password |
| --- | --- | --- |
| School admin | `admin@greenvalley.edu.np` | `SchoolAdmin#2026` |
| Teacher | `teacher@greenvalley.edu.np` | `Teacher#2026` |
| Accountant | `accounts@greenvalley.edu.np` | `Accounts#2026` |
| Parent | `parent@greenvalley.edu.np` | `Parent#2026` |
| Student | `student@greenvalley.edu.np` | `Student#2026` |

Second demo tenant: **Sunrise English School**, slug `sunrise`,
`admin@sunrise.edu.np` / `SchoolAdmin#2026`.

> In local development the web app defaults to the `green-valley` subdomain. In
> production the school URL is `https://<slug>.schoolerp.app`.

---

## 1. First sign-in

1. Open the school URL (or `http://localhost:8080` locally).
2. Enter the subdomain if the login form asks for it.
3. Sign in with the administrator email and temporary password.
4. Change the password immediately: **Settings → Security → Change password**.
5. Review **Settings → Sessions** and revoke anything you do not recognise.
6. Enable two-factor authentication if your school requires it.

If the password was delivered over chat or email, change it before doing
anything else.

### Roles in the school app

| Role | Typical use |
| --- | --- |
| School Admin | Everything except platform operations; users, settings, modules |
| Principal | Academics, attendance, exams/results, reports; read-only fees |
| Accountant | Fees, invoices, payments, refunds, expenses, ledgers |
| Teacher | Attendance, marks, timetable, class student lists |
| Receptionist | Student search/admissions, notices, basic dashboards |
| Parent | Own children: dashboard, attendance, fees, notices |
| Student | Own dashboard, timetable, results, notices |

Permissions are additive; the school admin can grant or deny individual
permissions per user. Ownership rules still apply: a parent can never read
another family's child, even with `students:read`.

---

## 2. Week-one setup checklist

Do these in order. Each step depends on the previous one.

### 2.1 School profile

**Settings** covers the school name, address, phone, email, website, branding
colours, timezone, locale, currency and calendar system in the current build.
Some fields are read-only until the settings write API ships (Phase 2); ask the
platform operator to change anything the page does not allow.

Verify:

- [ ] timezone is correct (attendance dates and fee periods depend on it),
- [ ] currency is correct (amounts are stored in minor units),
- [ ] calendar system is `AD` or `BS` as intended,
- [ ] branding colours are legible (WCAG contrast).

### 2.2 Academic year

Create the current year with a clear name (for example `2026-27`) and correct
start/end dates. Only one year should be current. Historical years stay for
reports and report cards.

### 2.3 Classes and sections

Create each class (`Nursery`, `LKG`, `UKG`, `Class 1` … `Class 10`) in order.
For each class create at least one section (`A`, `B`, …). Students cannot be
created or imported without a class and a section.

### 2.4 Subjects and timetable

Create subjects with a unique code and type (`THEORY`/`PRACTICAL`). Attach
subjects to classes, then build the timetable. Timetable slots reference a
`staffId`, so create staff records first.

### 2.5 Staff and users

Create staff records, then user accounts. Give each person the least role they
need. A teacher who only marks attendance does not need `students:write`.

Do not share accounts. Shared logins destroy the audit trail and make
attendance/fee accountability impossible.

### 2.6 Students and guardians

Add students individually (**Students → Add student**) or by CSV (section 3).
Every student needs:

- a unique admission number,
- first name (last name is recommended),
- gender (`MALE`, `FEMALE`, `OTHER`),
- class and section,
- a guardian for the parent portal.

### 2.7 Fee setup

1. Create fee heads (tuition, transport, exam, …) with a code and frequency.
2. Create a fee structure for the year/class with one line per head.
3. Generate invoices for the class or the whole school.
4. Collect payments at the counter or record bank transfers.

Amounts are integer minor units internally; the UI formats them with the
school currency. A payment is idempotent per `(school, idempotencyKey)` — a
double-click cannot charge twice.

### 2.8 Attendance

Teachers open **Attendance**, pick date/class/section/period, mark students and
save. The write is idempotent, so re-saving the same session updates rather than
duplicates. The summary view shows per-student percentages and a low-attendance
list; configure the threshold with the platform operator until settings writes
ship.

### 2.9 Exams and results

Create an exam, attach subjects and maximum marks, enter marks, generate report
cards, review them, then publish. Publishing is an audited action; parents see
results only after publish.

### 2.10 Notices and portals

Publish notices to roles/classes/sections. Notices support draft, scheduled,
published and archived states. Portal users see only notices targeted at them.
Parents and students get a child/self dashboard with attendance, fees and
notices.

---

## 3. Importing students from CSV

### 3.1 Format

UTF-8 CSV with a header row. Required columns:

```csv
admissionNo,firstName,lastName,gender,className,sectionName,rollNo,dateOfBirth,phone,guardianName,guardianPhone
GV-2026-001,Aarav,Sharma,MALE,Class 5,A,12,2015-04-12,9800000001,Ramesh Sharma,9800000002
GV-2026-002,Sita,Gurung,FEMALE,Class 5,A,13,2015-06-30,9800000003,Deepa Gurung,9800000004
```

| Column | Rules |
| --- | --- |
| `admissionNo` | Required, unique per school |
| `firstName` | Required |
| `lastName` | Optional but recommended |
| `gender` | `MALE`, `FEMALE` or `OTHER` |
| `className` | Must match an existing class name (case-insensitive) |
| `sectionName` | Must match a section in that class; blank uses the default section |
| `rollNo` | Optional |
| `dateOfBirth` | `YYYY-MM-DD` |
| `phone` | Optional |
| `guardianName` / `guardianPhone` | Optional; creates a primary guardian link |

Export a class first (**Students → Export CSV**) to get a file in exactly the
right shape.

### 3.2 Preview then commit

1. **Students → Import CSV**.
2. Paste/upload the CSV.
3. Run **Preview**. The API validates every row and returns row-level errors
   (`row`, `field`, `message`) plus the first ten valid rows.
4. Fix the file and preview again until `validRows` equals `totalRows`.
5. Run **Commit**. The import is transactional per batch and respects the
   student plan limit.
6. Check the student list and a few detail pages.

Common errors:

| Error | Fix |
| --- | --- |
| `Unknown class` | Class names must match exactly (case-insensitive) |
| `Unknown section` | Create the section under that class, or fill `sectionName` |
| `Use YYYY-MM-DD` | Reformat dates; Excel may have changed them |
| `Required` | Fill `admissionNo` and `firstName` |
| `PLAN_LIMIT_EXCEEDED` | Ask the platform operator for a plan change or override |

Do not re-import the same file blindly: admission numbers are unique and
duplicate rows will be rejected. For a correction, export, edit and import only
the changed rows — or update students individually.

---

## 4. Daily operations

### Teachers

- Mark attendance at the start of each period.
- Enter marks before the exam deadline.
- Check the timetable for substitutions.
- Read notices targeted at staff.

### Accountants

- Collect fees and issue receipts.
- Reconcile bank transfers.
- Review defaulters weekly; send reminders through notices.
- Record expenses.
- Refund only with an approved reason; refunds are audited.

### Office / admissions

- Work the admissions pipeline (`INQUIRY → APPLIED → DOCUMENTS_PENDING →
  APPROVED → ADMITTED`) and convert an admitted applicant into a student.
- Issue and return library books; overdue rows stay visible until returned.
- Assign students to transport routes/stops and hostel rooms; keep capacity in
  mind.
- Record inventory receipts/issues; items below reorder level need replenishment.
- Use **Messages** for direct staff–guardian threads; use notices for one-to-many
  announcements.

### Principal / admin

- Review attendance trends and low-attendance lists.
- Approve result publication.
- Review fee collection and outstanding balances.
- Approve or reject staff leave; check the staff attendance register.
- Review payroll runs before marking them paid.
- Review the reports page (enrolment, attendance, fees, payroll, module usage) and
  export CSV for the board or auditors.
- Check the audit page for unexpected changes.
- Keep user roles current; disable leavers immediately.

### Parents / students

- Dashboard shows the child's attendance, fees and notices.
- Pay/see fees and download receipts where online payments are enabled.
- Read notices and results after publication.

---

## 5. Users, security and sessions

- Create one user per person with a unique email.
- Set a temporary password and require a change on first login.
- Review **Settings → Sessions**; revoke lost devices.
- Five failed logins lock the account for 15 minutes.
- Password reset links are single-use and expire.
- If TOTP is enabled, store recovery codes offline.
- Do not put student PII in notice bodies or file names; use the student record.
- Export only the columns you need; exports contain PII.

---

## 6. Desktop app (offline)

The Tauri desktop client uses the same UI and an encrypted local outbox for work
done without connectivity.

- Install from your operator's signed build.
- Sign in normally; the desktop receives its refresh token in the response body
  and keeps it locally.
- Attendance/fee actions taken offline are queued with an idempotency key and
  replayed when the connection returns.
- Pending/synced/failed counts are available from the desktop shell.
- If a sync fails repeatedly, stop and contact support; do not clear the local
  database, because that discards unsynced work.

The desktop build requires Rust and the platform webview; see
[`apps/desktop/README.md`](../apps/desktop/README.md).

---

## 7. Month-end and year-end

Month-end:

- [ ] Reconcile collected fees against bank deposits.
- [ ] Review refunds and expenses.
- [ ] Check attendance summaries for anomalies.
- [ ] Export the ledger for accounts.

Year-end:

- [ ] Publish final results and report cards.
- [ ] Close the academic year; create the next year.
- [ ] Promote students / create new class sections.
- [ ] Carry forward fee balances per policy.
- [ ] Archive notices that are no longer relevant.
- [ ] Review user accounts and remove leavers.

---

## 8. Getting help

Include in every support request:

- school slug and the affected user's email,
- what you expected and what happened,
- the approximate time (with timezone),
- the `X-Request-Id` response header if the UI shows an error reference,
- a screenshot with PII redacted.

Never send passwords, full student records or payment credentials in a ticket.
