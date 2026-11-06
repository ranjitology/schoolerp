/**
 * Real PostgreSQL RLS test using PGlite (Postgres 16 compiled to WASM).
 *
 * This is the test that matters for tenant isolation: it applies the actual
 * migration + rls.sql, switches to a non-owner role (erp_app), and proves that
 * cross-tenant reads/writes are impossible even with hand-written SQL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCHOOL_A = '01920000-0000-7000-8000-000000000001';
const SCHOOL_B = '01920000-0000-7000-8000-000000000002';
const CLASS_A = '01920000-0000-7000-8000-000000000011';
const CLASS_B = '01920000-0000-7000-8000-000000000012';
const SECTION_A = '01920000-0000-7000-8000-000000000021';
const SECTION_B = '01920000-0000-7000-8000-000000000022';
const STUDENT_A = '01920000-0000-7000-8000-000000000031';
const STUDENT_B = '01920000-0000-7000-8000-000000000032';
const AUDIT_A = '01920000-0000-7000-8000-000000000041';
const BOOK_A = '01920000-0000-7000-8000-000000000051';
const BOOK_B = '01920000-0000-7000-8000-000000000052';
const SUBSTITUTION_A = '01920000-0000-7000-8000-000000000061';
const SUBSTITUTION_B = '01920000-0000-7000-8000-000000000062';
const SLOT_A = '01920000-0000-7000-8000-000000000071';
const SLOT_B = '01920000-0000-7000-8000-000000000072';
const STAFF_A = '01920000-0000-7000-8000-000000000081';
const STAFF_B = '01920000-0000-7000-8000-000000000082';

const migrationDirs = [
  '0001_init',
  '0002_all_phases',
  '0003_audit_seed_reset',
  '0004_phase_completion',
  '0005_timetable_substitutions',
];
const migrations = migrationDirs.map((dir) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', dir, 'migration.sql'), 'utf8'),
);

let db: PGlite;

async function count(sql: string): Promise<number> {
  const result = await db.query<{ count: string }>(sql);
  return Number(result.rows[0]?.count ?? 0);
}

describe('PostgreSQL tenant isolation (RLS)', () => {
  beforeAll(async () => {
    db = new PGlite();
    for (const sql of migrations) {
      await db.exec(sql);
    }
    await db.exec(`
      CREATE ROLE erp_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO erp_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;

      INSERT INTO schools (id, slug, name, status, "updatedAt") VALUES
        ('${SCHOOL_A}', 'green-valley', 'Green Valley School', 'ACTIVE', now()),
        ('${SCHOOL_B}', 'sunrise', 'Sunrise School', 'ACTIVE', now());

      INSERT INTO classes (id, school_id, name, sequence) VALUES
        ('${CLASS_A}', '${SCHOOL_A}', 'Class 6', 1),
        ('${CLASS_B}', '${SCHOOL_B}', 'Class 6', 1);

      INSERT INTO sections (id, school_id, "classId", name) VALUES
        ('${SECTION_A}', '${SCHOOL_A}', '${CLASS_A}', 'A'),
        ('${SECTION_B}', '${SCHOOL_B}', '${CLASS_B}', 'A');

      INSERT INTO students
        (id, school_id, "admissionNo", "firstName", "lastName", gender, "classId", "sectionId", "updatedAt")
      VALUES
        ('${STUDENT_A}', '${SCHOOL_A}', 'A-001', 'Aarav', 'Sharma', 'MALE', '${CLASS_A}', '${SECTION_A}', now()),
        ('${STUDENT_B}', '${SCHOOL_B}', 'B-001', 'Prisha', 'Joshi', 'FEMALE', '${CLASS_B}', '${SECTION_B}', now());

      INSERT INTO library_books (id, school_id, title, author, category, "updatedAt") VALUES
        ('${BOOK_A}', '${SCHOOL_A}', 'Muna Madan', 'Laxmi Prasad Devkota', 'Literature', now()),
        ('${BOOK_B}', '${SCHOOL_B}', 'Seto Bagh', 'Diamond Shumsher Rana', 'Literature', now());

      INSERT INTO timetable_substitutions
        (id, school_id, "slotId", date, "originalStaffId", "substituteStaffId", reason, "updatedAt")
      VALUES
        ('${SUBSTITUTION_A}', '${SCHOOL_A}', '${SLOT_A}', '2026-11-09', '${STAFF_A}', '${STAFF_B}', 'Tenant A cover', now()),
        ('${SUBSTITUTION_B}', '${SCHOOL_B}', '${SLOT_B}', '2026-11-09', '${STAFF_B}', '${STAFF_A}', 'Tenant B cover', now());
    `);
    await db.exec('SET ROLE erp_app;');
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('sees nothing when no tenant context is set (fail closed)', async () => {
    expect(await count('SELECT count(*) FROM students')).toBe(0);
    expect(await count('SELECT count(*) FROM guardians')).toBe(0);
  });

  it('sees only the rows of the current tenant', async () => {
    await db.query(`SELECT set_config('app.school_id', $1, false)`, [SCHOOL_A]);
    const rows = await db.query<{ id: string }>('SELECT id FROM students ORDER BY id');
    expect(rows.rows.map((row) => row.id)).toEqual([STUDENT_A]);
  });

  it('cannot read or update another tenant even with a known id', async () => {
    await db.query(`SELECT set_config('app.school_id', $1, false)`, [SCHOOL_A]);

    expect(await count(`SELECT count(*) FROM students WHERE id = '${STUDENT_B}'`)).toBe(0);

    const updated = await db.query(
      `UPDATE students SET "firstName" = 'Hacked' WHERE id = '${STUDENT_B}'`,
    );
    expect(updated.affectedRows).toBe(0);

    await expect(
      db.query(
        `INSERT INTO students
          (id, school_id, "admissionNo", "firstName", "lastName", gender, "classId", "sectionId", "updatedAt")
         VALUES
          ('01920000-0000-7000-8000-000000000099', '${SCHOOL_B}', 'B-999', 'X', 'Y', 'MALE', '${CLASS_B}', '${SECTION_B}', now())`,
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it('applies the same isolation to Phase 3 tables', async () => {
    await db.query(`SELECT set_config('app.school_id', $1, false)`, [SCHOOL_A]);
    await db.query(`SELECT set_config('app.is_platform', 'false', false)`);

    const rows = await db.query<{ id: string }>('SELECT id FROM library_books ORDER BY id');
    expect(rows.rows.map((row) => row.id)).toEqual([BOOK_A]);

    const updated = await db.query(
      `UPDATE library_books SET title = 'Hacked' WHERE id = '${BOOK_B}'`,
    );
    expect(updated.affectedRows).toBe(0);
  });

  it('applies the same isolation to timetable substitutions', async () => {
    await db.query(`SELECT set_config('app.school_id', $1, false)`, [SCHOOL_A]);
    await db.query(`SELECT set_config('app.is_platform', 'false', false)`);

    const rows = await db.query<{ id: string }>(
      'SELECT id FROM timetable_substitutions ORDER BY id',
    );
    expect(rows.rows.map((row) => row.id)).toEqual([SUBSTITUTION_A]);

    const updated = await db.query(
      `UPDATE timetable_substitutions SET status = 'APPROVED' WHERE id = '${SUBSTITUTION_B}'`,
    );
    expect(updated.affectedRows).toBe(0);
  });

  it('allows cross-tenant work only inside an explicit platform context', async () => {
    await db.query(`SELECT set_config('app.school_id', '', false)`);
    await db.query(`SELECT set_config('app.is_platform', 'true', false)`);
    expect(await count('SELECT count(*) FROM students')).toBe(2);
  });

  it('keeps audit logs append-only', async () => {
    await db.query(`SELECT set_config('app.is_platform', 'false', false)`);
    await db.query(`SELECT set_config('app.school_id', $1, false)`, [SCHOOL_A]);
    await db.query(
      `INSERT INTO audit_logs
        (id, school_id, "actorType", action, entity, "prevHash", hash)
       VALUES ($1, $2, 'USER', 'student.created', 'Student', $3, $4)`,
      [AUDIT_A, SCHOOL_A, '0'.repeat(64), 'a'.repeat(64)],
    );

    await expect(
      db.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [AUDIT_A]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      db.query(`DELETE FROM audit_logs WHERE id = $1`, [AUDIT_A]),
    ).rejects.toThrow(/append-only/i);
  });
});
