/* eslint-disable no-console -- CLI verification output is intentional */
/**
 * Verifies a seeded database through the real RLS-scoped access paths.
 *
 * Run with `pnpm --filter @schoolerp/db verify:seed` after migrations and seed.
 * It prints per-tenant row counts and proves that a tenant-scoped transaction
 * cannot read another tenant's students.
 */
import { prisma, withPlatform, withTenant } from '../src';

interface TenantSummary {
  slug: string;
  name: string;
  status: string;
  users: number;
  students: number;
  staff: number;
  attendance: number;
  notices: number;
  exams: number;
}

async function main(): Promise<void> {
  const { platformUsers, platformInvoices, tenants } = await withPlatform(
    async (tx) => {
      const schools = await tx.school.findMany({
        orderBy: { slug: 'asc' },
        select: { id: true, slug: true, name: true, status: true },
      });

      const summaries: TenantSummary[] = [];
      for (const school of schools) {
        const [users, students, staff, attendance, notices, exams] = await Promise.all([
          tx.user.count({ where: { schoolId: school.id } }),
          tx.student.count({ where: { schoolId: school.id } }),
          tx.staff.count({ where: { schoolId: school.id } }),
          tx.attendanceRecord.count({ where: { schoolId: school.id } }),
          tx.notice.count({ where: { schoolId: school.id } }),
          tx.exam.count({ where: { schoolId: school.id } }),
        ]);
        summaries.push({
          slug: school.slug,
          name: school.name,
          status: school.status,
          users,
          students,
          staff,
          attendance,
          notices,
          exams,
        });
      }

      return {
        platformUsers: await tx.platformUser.count(),
        platformInvoices: await tx.platformInvoice.count(),
        tenants: summaries,
      };
    },
    { timeoutMs: 120_000 },
  );

  console.log('Platform users:', platformUsers);
  console.log('Platform invoices:', platformInvoices);
  console.table(tenants);

  // RLS proof: under one tenant's scope, only that tenant's students are
  // visible and a known student from another tenant cannot be fetched by id.
  const bySlug = new Map(tenants.map((tenant) => [tenant.slug, tenant]));
  const greenValley = bySlug.get('green-valley');
  const sunrise = bySlug.get('sunrise');

  if (!greenValley || !sunrise) {
    throw new Error('Expected the green-valley and sunrise demo tenants to exist');
  }

  const [greenValleyId, sunriseId] = await withPlatform(async (tx) => {
    const schools = await tx.school.findMany({
      where: { slug: { in: ['green-valley', 'sunrise'] } },
      select: { id: true, slug: true },
    });
    const ids = new Map(schools.map((school) => [school.slug, school.id]));
    return [ids.get('green-valley') ?? '', ids.get('sunrise') ?? ''] as const;
  });

  const rls = await withTenant({ schoolId: greenValleyId }, async (tx) => {
    const visible = await tx.student.findMany({ select: { id: true, schoolId: true } });
    const sunriseStudent = await tx.student.findFirst({
      where: { schoolId: sunriseId },
      select: { id: true },
    });
    return {
      visibleStudents: visible.length,
      leakedRows: visible.filter((row) => row.schoolId !== greenValleyId).length,
      crossTenantRow: sunriseStudent?.id ?? null,
    };
  });

  console.log('RLS check (green-valley scope):', rls);

  if (rls.leakedRows > 0 || rls.crossTenantRow !== null) {
    throw new Error('RLS verification failed: cross-tenant rows are visible');
  }
  if (rls.visibleStudents !== greenValley.students) {
    throw new Error(
      `RLS verification failed: expected ${greenValley.students} students, saw ${rls.visibleStudents}`,
    );
  }

  console.log('Seed and RLS verification passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
