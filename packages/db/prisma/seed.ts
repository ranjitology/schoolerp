/* eslint-disable no-console -- CLI seed output is intentional */
/**
 * Idempotent demo seed: two fully isolated schools plus a platform operator.
 *
 * Run with `pnpm db:seed` (requires `pnpm build` once so @schoolerp/core/dist
 * exists). Every write happens inside an audited platform transaction because
 * the database enforces FORCE ROW LEVEL SECURITY even for the owner role.
 */
import { Prisma } from '@prisma/client';
import {
  DEFAULT_GRADE_BANDS,
  DEFAULT_PLAN_LIMITS,
  systemRoleDefinitions,
  uuidv7,
} from '@schoolerp/core';
import { hashPassword, hashEntry } from '@schoolerp/core/server';
import { prisma, withPlatform } from '../src';

const PASSWORD = {
  platform: 'Platform#2026!',
  admin: 'SchoolAdmin#2026',
  teacher: 'Teacher#2026',
  accountant: 'Accounts#2026',
  parent: 'Parent#2026',
  student: 'Student#2026',
};

const DEMO_SLUGS = ['green-valley', 'sunrise'];

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDay(base: Date): string {
  return base.toISOString().slice(0, 10);
}

interface DemoSchool {
  slug: string;
  name: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  status: 'ACTIVE' | 'TRIAL';
  planCode: 'trial' | 'starter' | 'growth' | 'enterprise';
  primary: string;
  accent: string;
  adminEmail: string;
  domain: string;
  studentPrefix: string;
  studentNames: Array<[string, string, 'MALE' | 'FEMALE']>;
}

const SCHOOLS: DemoSchool[] = [
  {
    slug: 'green-valley',
    name: 'Green Valley Secondary School',
    legalName: 'Green Valley Secondary School Pvt. Ltd.',
    address: 'Lakeside Road, Pokhara-6, Kaski, Nepal',
    phone: '+977-61-460123',
    email: 'info@greenvalley.edu.np',
    status: 'ACTIVE',
    planCode: 'growth',
    primary: '#166534',
    accent: '#ca8a04',
    adminEmail: 'admin@greenvalley.edu.np',
    domain: 'greenvalley.edu.np',
    studentPrefix: 'GV',
    studentNames: [
      ['Aarav', 'Sharma', 'MALE'],
      ['Sita', 'Gurung', 'FEMALE'],
      ['Bibek', 'Thapa', 'MALE'],
      ['Anisha', 'Karki', 'FEMALE'],
      ['Rohan', 'Adhikari', 'MALE'],
      ['Puja', 'Magar', 'FEMALE'],
      ['Kiran', 'Bhattarai', 'MALE'],
      ['Sneha', 'Poudel', 'FEMALE'],
      ['Nabin', 'Rai', 'MALE'],
      ['Riya', 'Shrestha', 'FEMALE'],
      ['Suman', 'Tamang', 'MALE'],
      ['Asmita', 'Lama', 'FEMALE'],
    ],
  },
  {
    slug: 'sunrise',
    name: 'Sunrise English School',
    legalName: 'Sunrise English School & College',
    address: 'Baneshwor Height, Kathmandu-10, Nepal',
    phone: '+977-1-4789012',
    email: 'hello@sunrise.edu.np',
    status: 'TRIAL',
    planCode: 'trial',
    primary: '#1d4ed8',
    accent: '#db2777',
    adminEmail: 'admin@sunrise.edu.np',
    domain: 'sunrise.edu.np',
    studentPrefix: 'SR',
    studentNames: [
      ['Aayush', 'Basnet', 'MALE'],
      ['Prisha', 'Joshi', 'FEMALE'],
      ['Saugat', 'Bhandari', 'MALE'],
      ['Ishita', 'KC', 'FEMALE'],
      ['Yubraj', 'Khadka', 'MALE'],
      ['Maya', 'Tamang', 'FEMALE'],
      ['Bipin', 'Oli', 'MALE'],
      ['Nirjala', 'Shakya', 'FEMALE'],
      ['Prakash', 'Bista', 'MALE'],
      ['Sujata', 'Dhungana', 'FEMALE'],
      ['Hari', 'Neupane', 'MALE'],
      ['Kritika', 'Aryal', 'FEMALE'],
    ],
  },
];

const SUBJECTS = [
  { code: 'ENG', name: 'English', type: 'THEORY' as const },
  { code: 'NEP', name: 'Nepali', type: 'THEORY' as const },
  { code: 'MAT', name: 'Mathematics', type: 'THEORY' as const },
  { code: 'SCI', name: 'Science', type: 'PRACTICAL' as const },
  { code: 'SOC', name: 'Social Studies', type: 'THEORY' as const },
  { code: 'COM', name: 'Computer Science', type: 'PRACTICAL' as const },
];

const CLASSES = [
  { name: 'Nursery', sequence: 0 },
  { name: 'LKG', sequence: 1 },
  { name: 'UKG', sequence: 2 },
  ...Array.from({ length: 10 }, (_, index) => ({
    name: `Class ${index + 1}`,
    sequence: index + 3,
  })),
];

async function main(): Promise<void> {
  const [platformHash, adminHash, teacherHash, accountantHash, parentHash, studentHash] =
    await Promise.all([
      hashPassword(PASSWORD.platform),
      hashPassword(PASSWORD.admin),
      hashPassword(PASSWORD.teacher),
      hashPassword(PASSWORD.accountant),
      hashPassword(PASSWORD.parent),
      hashPassword(PASSWORD.student),
    ]);

  await withPlatform(
    async (tx) => {
      // Demo resets cascade into append-only audit rows. Opt in for this
      // transaction only; the trigger still requires a role with TRUNCATE
      // on audit_logs, which the runtime erp_app role does not have.
      await tx.$executeRawUnsafe(`SELECT set_config('schoolerp.audit_seed_reset', 'on', true)`);

      await tx.announcement.deleteMany({});

      // Phase 3-7 tables keep scalar schoolIds without relations, so school
      // deletion does not cascade them. Clear the demo tenants' rows first.
      const existing = await tx.school.findMany({
        where: { slug: { in: DEMO_SLUGS } },
        select: { id: true },
      });
      const existingIds = existing.map((row) => row.id);
      if (existingIds.length > 0) {
        const where = { schoolId: { in: existingIds } };
        await tx.libraryIssue.deleteMany({ where });
        await tx.libraryBook.deleteMany({ where });
        await tx.transportAssignment.deleteMany({ where });
        await tx.transportRoute.deleteMany({ where });
        await tx.hostelAllocation.deleteMany({ where });
        await tx.hostelRoom.deleteMany({ where });
        await tx.hostel.deleteMany({ where });
        await tx.inventoryTransaction.deleteMany({ where });
        await tx.inventoryItem.deleteMany({ where });
        await tx.questionBank.deleteMany({ where });
        await tx.message.deleteMany({ where });
        await tx.messageThread.deleteMany({ where });
        await tx.meterUsage.deleteMany({ where });
        await tx.staffAttendance.deleteMany({ where });
        await tx.staffLeave.deleteMany({ where });
        await tx.payrollRun.deleteMany({ where });
        await tx.admissionApplication.deleteMany({ where });
        await tx.homework.deleteMany({ where });
        await tx.backgroundJob.deleteMany({ where });
      }

      await tx.school.deleteMany({ where: { slug: { in: DEMO_SLUGS } } });
      await tx.plan.deleteMany({
        where: { code: { in: ['trial', 'starter', 'growth', 'enterprise', 'standard', 'premium'] } },
      });

      const planIds = new Map<string, string>();
      for (const [code, name, priceMinor] of [
        ['trial', 'Trial', 0],
        ['starter', 'Starter', 1_499_000],
        ['growth', 'Growth', 2_499_000],
        ['enterprise', 'Enterprise', 4_999_000],
      ] as const) {
        const plan = await tx.plan.create({
          data: {
            id: uuidv7(),
            code,
            name,
            description:
              code === 'trial'
                ? '30-day evaluation with homework module'
                : code === 'starter'
                  ? 'Core ERP for small schools'
                  : code === 'growth'
                    ? 'Core ERP plus library and transport for growing schools'
                    : 'All modules, higher quotas and priority support',
            priceMinor,
            interval: 'YEARLY',
            limits: DEFAULT_PLAN_LIMITS[code] as unknown as Prisma.InputJsonValue,
          },
        });
        planIds.set(code, plan.id);
      }

      const platform = await tx.platformUser.upsert({
        where: { email: 'platform@schoolerp.local' },
        update: { passwordHash: platformHash, role: 'SUPER_ADMIN', status: 'ACTIVE' },
        create: {
          id: uuidv7(),
          email: 'platform@schoolerp.local',
          passwordHash: platformHash,
          fullName: 'Platform Operator',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
      });

      await tx.announcement.create({
        data: {
          id: uuidv7(),
          title: 'Scheduled maintenance â€” Sunday 02:00â€“03:00 NPT',
          body: 'The API will be read-only for up to 20 minutes while we apply an index migration. Offline desktop clients will queue writes and sync afterwards.',
          audience: 'ALL',
          severity: 'INFO',
          schoolIds: [],
          createdBy: platform.id,
        },
      });

      for (const school of SCHOOLS) {
        await seedSchool(tx, school, {
          planId: planIds.get(school.planCode)!,
          adminHash,
          teacherHash,
          accountantHash,
          parentHash,
          studentHash,
        });
      }
    },
    {
      // Remote databases (e.g. Neon) add latency to every statement, so the
      // whole demo seed can legitimately exceed the default 30s budget.
      timeoutMs: Number(process.env.SEED_TX_TIMEOUT_MS ?? 900_000),
    },
  );

  console.log('Seed complete.');
  console.log('  Platform: platform@schoolerp.local /', PASSWORD.platform);
  console.log('  Green Valley admin: admin@greenvalley.edu.np /', PASSWORD.admin);
  console.log('  Sunrise admin: admin@sunrise.edu.np /', PASSWORD.admin);
  console.log('  Teacher (GV): teacher@greenvalley.edu.np /', PASSWORD.teacher);
  console.log('  Accountant (GV): accounts@greenvalley.edu.np /', PASSWORD.accountant);
  console.log('  Parent (GV): parent@greenvalley.edu.np /', PASSWORD.parent);
}

interface Hashes {
  planId: string;
  adminHash: string;
  teacherHash: string;
  accountantHash: string;
  parentHash: string;
  studentHash: string;
}

async function seedSchool(
  tx: Prisma.TransactionClient,
  school: DemoSchool,
  hashes: Hashes,
): Promise<void> {
  const schoolId = uuidv7();
  const now = new Date();
  const yearStart = date('2026-04-15');
  const yearEnd = date('2027-04-14');

  await tx.school.create({
    data: {
      id: schoolId,
      slug: school.slug,
      name: school.name,
      status: school.status,
      planId: hashes.planId,
      trialEndsAt: school.status === 'TRIAL' ? addDays(now, 21) : null,
      currency: 'NPR',
      locale: 'en-NP',
      timezone: 'Asia/Kathmandu',
      calendarSystem: 'AD',
      branding: { primaryColor: school.primary, accentColor: school.accent },
      limitsOverride: {},
      modulesOverride: {},
      settings: {
        create: {
          legalName: school.legalName,
          address: school.address,
          phone: school.phone,
          email: school.email,
          website: `https://${school.domain}`,
          branding: {
            primaryColor: school.primary,
            accentColor: school.accent,
            tagline: 'Every child, every day',
            darkModeDefault: false,
          },
          attendance: {
            lateCountsPresent: true,
            halfDayWeight: 0.5,
            excludeLeaveFromDenominator: true,
            lowAttendanceThreshold: 75,
          },
          fees: {
            receiptPrefix: school.studentPrefix,
            fiscalYearStartMonth: 7,
            fiscalYearStartDay: 16,
            lateFine: { type: 'FLAT_DAILY', dailyMinor: 2000, graceDays: 5, maxMinor: 100_000 },
            allowAdvancePayment: true,
          },
          workingDays: [1, 2, 3, 4, 5, 6],
          periodsPerDay: 7,
          periodMinutes: 45,
        },
      },
      subscription: {
        create: {
          planId: hashes.planId,
          status: school.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
          trialEndsAt: school.status === 'TRIAL' ? addDays(now, 21) : null,
          currentPeriodStart: yearStart,
          currentPeriodEnd: yearEnd,
        },
      },
    },
  });

  const roles = new Map<string, string>();
  for (const role of systemRoleDefinitions()) {
    const created = await tx.role.create({
      data: {
        id: uuidv7(),
        schoolId,
        code: role.code,
        name: role.name,
        permissions: [...role.permissions],
        isSystem: true,
      },
    });
    roles.set(role.code, created.id);
  }

  const admin = await tx.user.create({
    data: {
      id: uuidv7(),
      schoolId,
      roleId: roles.get('SCHOOL_ADMIN')!,
      email: school.adminEmail,
      passwordHash: hashes.adminHash,
      fullName: `${school.slug === 'green-valley' ? 'Gita' : 'Ramesh'} ${school.slug === 'green-valley' ? 'Poudel' : 'Sharma'}`,
      phone: school.phone,
      status: 'ACTIVE',
      totpEnabled: false,

    },
  });

  const teacher = await tx.user.create({
    data: {
      id: uuidv7(),
      schoolId,
      roleId: roles.get('TEACHER')!,
      email: `teacher@${school.domain}`,
      passwordHash: hashes.teacherHash,
      fullName: 'Suman Karki',
      phone: '+977-9800000001',
      status: 'ACTIVE',

    },
  });

  const accountant = await tx.user.create({
    data: {
      id: uuidv7(),
      schoolId,
      roleId: roles.get('ACCOUNTANT')!,
      email: `accounts@${school.domain}`,
      passwordHash: hashes.accountantHash,
      fullName: 'Bimala Shrestha',
      status: 'ACTIVE',

    },
  });

  const parent = await tx.user.create({
    data: {
      id: uuidv7(),
      schoolId,
      roleId: roles.get('PARENT')!,
      email: `parent@${school.domain}`,
      passwordHash: hashes.parentHash,
      fullName: 'Aarav Sharma (Guardian)',
      phone: '+977-9800000002',
      status: 'ACTIVE',

    },
  });

  const studentUser = await tx.user.create({
    data: {
      id: uuidv7(),
      schoolId,
      roleId: roles.get('STUDENT')!,
      email: `student@${school.domain}`,
      passwordHash: hashes.studentHash,
      fullName: 'Aarav Sharma',
      status: 'ACTIVE',

    },
  });

  const staff = await Promise.all(
    [
      { first: 'Gita', last: 'Poudel', userId: admin.id, role: 'Principal' },
      { first: 'Suman', last: 'Karki', userId: teacher.id, role: 'Mathematics Teacher' },
      { first: 'Bimala', last: 'Shrestha', userId: accountant.id, role: 'Accountant' },
      { first: 'Laxmi', last: 'Gurung', userId: null, role: 'English Teacher' },
      { first: 'Deepak', last: 'Thapa', userId: null, role: 'Science Teacher' },
      { first: 'Sarita', last: 'Rai', userId: null, role: 'Primary Teacher' },
    ].map(async (person, index) =>
      tx.staff.create({
        data: {
          id: uuidv7(),
          schoolId,
          userId: person.userId,
          employeeNo: `${school.studentPrefix}-T${String(index + 1).padStart(3, '0')}`,
          firstName: person.first,
          lastName: person.last,
          email: `staff${index + 1}@${school.domain}`,
          phone: `+977-98000000${20 + index}`,
          gender: index % 2 === 0 ? 'FEMALE' : 'MALE',
          qualification: person.role,
          joinedOn: date('2022-04-15'),
          employmentType: 'FULL_TIME',
          status: 'ACTIVE',
          baseSalaryMinor: 4_500_000 + index * 350_000,
        },
      }),
    ),
  );

  const academicYear = await tx.academicYear.create({
    data: {
      id: uuidv7(),
      schoolId,
      name: '2026-27',
      startDate: yearStart,
      endDate: yearEnd,
      calendarSystem: 'AD',
      isCurrent: true,
    },
  });

  const terms = await Promise.all(
    [
      ['First Term', 1, '2026-04-15', '2026-08-14'],
      ['Second Term', 2, '2026-08-15', '2026-12-14'],
      ['Third Term', 3, '2026-12-15', '2027-04-14'],
    ].map(async ([name, sequence, start, end]) =>
      tx.term.create({
        data: {
          id: uuidv7(),
          schoolId,
          academicYearId: academicYear.id,
          name: name as string,
          sequence: sequence as number,
          startDate: date(start as string),
          endDate: date(end as string),
        },
      }),
    ),
  );

  const classes = new Map<string, string>();
  const sections = new Map<string, string>();
  for (const klass of CLASSES) {
    const created = await tx.class.create({
      data: { id: uuidv7(), schoolId, name: klass.name, sequence: klass.sequence },
    });
    classes.set(klass.name, created.id);
    for (const sectionName of ['A', 'B']) {
      const section = await tx.section.create({
        data: {
          id: uuidv7(),
          schoolId,
          classId: created.id,
          name: sectionName,
          capacity: 48,
          room: `${klass.sequence + 1}${sectionName}`,
        },
      });
      sections.set(`${klass.name}:${sectionName}`, section.id);
    }
  }

  const subjects = new Map<string, string>();
  for (const subject of SUBJECTS) {
    const created = await tx.subject.create({
      data: {
        id: uuidv7(),
        schoolId,
        code: subject.code,
        name: subject.name,
        type: subject.type,
        credit: subject.type === 'PRACTICAL' ? 1.5 : 1,
      },
    });
    subjects.set(subject.code, created.id);
  }

  for (const className of ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10']) {
    for (const subject of SUBJECTS.slice(0, 4)) {
      const classSubject = await tx.classSubject.create({
        data: {
          id: uuidv7(),
          schoolId,
          classId: classes.get(className)!,
          subjectId: subjects.get(subject.code)!,
          weeklyPeriods: subject.code === 'MAT' ? 6 : 4,
        },
      });
      await tx.teachingAssignment.create({
        data: {
          id: uuidv7(),
          schoolId,
          academicYearId: academicYear.id,
          classSubjectId: classSubject.id,
          staffId: staff[1 + (subject.code === 'ENG' ? 1 : 0)]!.id,
        },
      });
    }
  }

  const periods = await Promise.all(
    [
      ['Period 1', 1, '09:30', '10:15', false],
      ['Period 2', 2, '10:15', '11:00', false],
      ['Break', 3, '11:00', '11:20', true],
      ['Period 3', 4, '11:20', '12:05', false],
      ['Period 4', 5, '12:05', '12:50', false],
      ['Lunch', 6, '12:50', '13:30', true],
      ['Period 5', 7, '13:30', '14:15', false],
      ['Period 6', 8, '14:15', '15:00', false],
    ].map(async ([name, sequence, start, end, isBreak]) =>
      tx.timetablePeriod.create({
        data: {
          id: uuidv7(),
          schoolId,
          name: name as string,
          sequence: sequence as number,
          startTime: start as string,
          endTime: end as string,
          isBreak: isBreak as boolean,
        },
      }),
    ),
  );
  const teachingPeriods = periods.filter((period) => !period.isBreak);

  for (const className of ['Class 6', 'Class 7']) {
    for (let day = 1; day <= 5; day += 1) {
      for (let index = 0; index < 5; index += 1) {
        const subject = SUBJECTS[index % SUBJECTS.length]!;
        await tx.timetableSlot.create({
          data: {
            id: uuidv7(),
            schoolId,
            academicYearId: academicYear.id,
            dayOfWeek: day,
            periodId: teachingPeriods[index]!.id,
            classId: classes.get(className)!,
            sectionId: sections.get(`${className}:A`)!,
            subjectId: subjects.get(subject.code)!,
            staffId: staff[1]!.id,
            room: `${classes.get(className)!.slice(-1)}A`,
          },
        });
      }
    }
  }

  const scale = await tx.gradingScale.create({
    data: {
      id: uuidv7(),
      schoolId,
      name: 'Nepal Standard (A+ to NG)',
      isDefault: true,
      bands: {
        create: DEFAULT_GRADE_BANDS.map((band, index) => ({
          id: uuidv7(),
          schoolId,
          grade: band.grade,
          minPercent: band.minPercent,
          maxPercent: band.maxPercent,
          gpa: band.gpa,
          remark: band.remark ?? null,
          sequence: index + 1,
        })),
      },
    },
  });
  void scale;

  const studentIds: string[] = [];
  for (const [index, [first, last, gender]] of school.studentNames.entries()) {
    const className = index % 2 === 0 ? 'Class 6' : 'Class 7';
    const sectionName = index % 4 < 2 ? 'A' : 'B';
    const admissionNo = `${school.studentPrefix}-2083-${String(index + 1).padStart(3, '0')}`;
    const isPrimaryDemo = index === 0;
    const student = await tx.student.create({
      data: {
        id: uuidv7(),
        schoolId,
        userId: isPrimaryDemo ? studentUser.id : null,
        admissionNo,
        firstName: first,
        lastName: last,
        gender,
        dateOfBirth: date(index % 2 === 0 ? '2014-06-12' : '2013-11-03'),
        bloodGroup: index % 3 === 0 ? 'O+' : index % 3 === 1 ? 'A+' : 'B+',
        classId: classes.get(className)!,
        sectionId: sections.get(`${className}:${sectionName}`)!,
        rollNo: String(index + 1),
        status: 'ACTIVE',
        admissionDate: date('2026-04-15'),
        phone: `+977-98111${String(index + 1).padStart(5, '0')}`,
        address: {
          line1: `${index + 1} Lakeside Marg`,
          city: school.slug === 'green-valley' ? 'Pokhara' : 'Kathmandu',
          district: school.slug === 'green-valley' ? 'Kaski' : 'Kathmandu',
        },
        guardians: {
          create: [
            {
              id: uuidv7(),
              schoolId,
              userId: isPrimaryDemo ? parent.id : null,
              relation: 'FATHER',
              fullName: `${first === 'Aarav' ? 'Ramesh' : 'Suresh'} ${last}`,
              phone: `+977-98000${String(index + 10).padStart(5, '0')}`,
              email: isPrimaryDemo ? parent.email : `guardian${index + 1}@${school.domain}`,
              occupation: index % 2 === 0 ? 'Engineer' : 'Teacher',
              isPrimary: true,
            },
          ],
        },
      },
    });
    studentIds.push(student.id);
  }

  const today = date(isoDay(now));
  for (const className of ['Class 6', 'Class 7']) {
    for (let offset = 0; offset < 5; offset += 1) {
      const attendanceDate = addDays(today, -offset);
      const day = attendanceDate.getUTCDay();
      if (day === 0 || day === 6) continue;
      const session = await tx.attendanceSession.create({
        data: {
          id: uuidv7(),
          schoolId,
          classId: classes.get(className)!,
          sectionId: sections.get(`${className}:A`)!,
          date: attendanceDate,
          period: 1,
          markedByUserId: teacher.id,
          idempotencyKey: `${school.slug}:${className}:A:${isoDay(attendanceDate)}:1`,
        },
      });
      const roster = await tx.student.findMany({
        where: { schoolId, classId: classes.get(className)!, sectionId: sections.get(`${className}:A`)! },
        select: { id: true },
        orderBy: { rollNo: 'asc' },
      });
      await tx.attendanceRecord.createMany({
        data: roster.map((student, index) => ({
          id: uuidv7(),
          schoolId,
          sessionId: session.id,
          studentId: student.id,
          date: attendanceDate,
          status:
            (index + offset) % 11 === 0
              ? ('ABSENT' as const)
              : (index + offset) % 7 === 0
                ? ('LATE' as const)
                : ('PRESENT' as const),
        })),
      });
    }
  }

  const exam = await tx.exam.create({
    data: {
      id: uuidv7(),
      schoolId,
      academicYearId: academicYear.id,
      termId: terms[0]!.id,
      name: 'First Term Examination 2083',
      type: 'FINAL',
      startsOn: date('2026-08-01'),
      endsOn: date('2026-08-12'),
      status: 'PUBLISHED',
      publishedAt: addDays(now, -10),
    },
  });

  for (const [className, subjectCodes] of [
    ['Class 6', ['ENG', 'NEP', 'MAT', 'SCI']],
    ['Class 7', ['ENG', 'NEP', 'MAT', 'SCI']],
  ] as const) {
    for (const subjectCode of subjectCodes) {
      const examSubject = await tx.examSubject.create({
        data: {
          id: uuidv7(),
          schoolId,
          examId: exam.id,
          classId: classes.get(className)!,
          subjectId: subjects.get(subjectCode)!,
          maxMarks: 100,
          passMarks: 33,
          weight: 100,
          examDate: date('2026-08-03'),
        },
      });
      const roster = await tx.student.findMany({
        where: { schoolId, classId: classes.get(className)! },
        select: { id: true },
      });
      await tx.mark.createMany({
        data: roster.map((student, index) => ({
          id: uuidv7(),
          schoolId,
          examSubjectId: examSubject.id,
          studentId: student.id,
          marksObtained: 55 + ((index * 7 + subjectCode.charCodeAt(0)) % 41),
          enteredByUserId: teacher.id,
        })),
      });
    }
  }

  const feeHeads = new Map<string, string>();
  for (const [code, name, amountMinor] of [
    ['TUI', 'Monthly Tuition', 650_000],
    ['ADM', 'Admission Fee', 500_000],
    ['TRN', 'Transport', 180_000],
    ['EXM', 'Examination Fee', 120_000],
  ] as const) {
    const head = await tx.feeHead.create({
      data: {
        id: uuidv7(),
        schoolId,
        code,
        name,
        isRecurring: code === 'TUI' || code === 'TRN',
      },
    });
    feeHeads.set(code, head.id);
    void amountMinor;
  }

  for (const className of ['Class 6', 'Class 7', 'Class 8']) {
    for (const [code, amountMinor] of [
      ['TUI', 650_000],
      ['ADM', 500_000],
      ['EXM', 120_000],
    ] as const) {
      await tx.feeStructure.create({
        data: {
          id: uuidv7(),
          schoolId,
          academicYearId: academicYear.id,
          classId: classes.get(className)!,
          feeHeadId: feeHeads.get(code)!,
          amountMinor,
          installments: code === 'TUI' ? 10 : 1,
          dueDay: 10,
        },
      });
    }
  }

  await tx.numberSequence.create({
    data: {
      id: uuidv7(),
      schoolId,
      kind: 'RECEIPT',
      period: '2083-84',
      prefix: school.studentPrefix,
      nextValue: 1,
    },
  });

  for (const [index, studentId] of studentIds.entries()) {
    const invoiceId = uuidv7();
    const total = 650_000 + 120_000;
    const isPaid = index % 3 === 0;
    await tx.invoice.create({
      data: {
        id: invoiceId,
        schoolId,
        studentId,
        academicYearId: academicYear.id,
        number: `${school.studentPrefix}-INV-${String(index + 1).padStart(5, '0')}`,
        issueDate: addDays(today, -15),
        dueDate: addDays(today, 15),
        subtotalMinor: total,
        discountMinor: 0,
        totalMinor: total,
        paidMinor: isPaid ? total : 0,
        status: isPaid ? 'PAID' : 'ISSUED',
        createdByUserId: accountant.id,
        lines: {
          create: [
            {
              id: uuidv7(),
              schoolId,
              feeHeadId: feeHeads.get('TUI')!,
              description: 'Monthly tuition â€” Kartik',
              amountMinor: 650_000,
            },
            {
              id: uuidv7(),
              schoolId,
              feeHeadId: feeHeads.get('EXM')!,
              description: 'First term examination fee',
              amountMinor: 120_000,
            },
          ],
        },
      },
    });
    if (isPaid) {
      await tx.payment.create({
        data: {
          id: uuidv7(),
          schoolId,
          studentId,
          amountMinor: total,
          method: index % 2 === 0 ? 'ESEWA' : 'CASH',
          paidAt: addDays(today, -10),
          receiptNumber: `${school.studentPrefix}-RCPT-${String(index + 1).padStart(5, '0')}`,
          idempotencyKey: `seed-payment-${school.slug}-${index}`,
          receivedByUserId: accountant.id,
          status: 'POSTED',
          allocations: {
            create: [{ id: uuidv7(), schoolId, invoiceId, amountMinor: total }],
          },
        },
      });
    }
  }

  await tx.notice.createMany({
    data: [
      {
        id: uuidv7(),
        schoolId,
        title: 'Parentsâ€™ Day â€” Saturday 10:00',
        body: 'All guardians are invited to the annual Parentsâ€™ Day. Class-wise sessions begin at 10:00 in the main hall. Please collect your childâ€™s progress report from the class teacher.',
        priority: 'HIGH',
        status: 'PUBLISHED',
        audience: { roles: ['PARENT'], classes: ['Class 6', 'Class 7'] },
        publishAt: addDays(now, -2),
        publishedAt: addDays(now, -2),
        createdByUserId: admin.id,
      },
      {
        id: uuidv7(),
        schoolId,
        title: 'Second term fee due on 10th',
        body: 'Second term fees can be paid at the accounts counter or via eSewa. A late fine of NPR 20 per day applies after the 5-day grace period.',
        priority: 'NORMAL',
        status: 'PUBLISHED',
        audience: { roles: ['PARENT'] },
        publishAt: addDays(now, -5),
        publishedAt: addDays(now, -5),
        createdByUserId: accountant.id,
      },
      {
        id: uuidv7(),
        schoolId,
        title: 'Staff meeting â€” Friday 15:30',
        body: 'Agenda: term results moderation, attendance follow-up and the new homework policy.',
        priority: 'NORMAL',
        status: 'DRAFT',
        audience: { roles: ['TEACHER', 'PRINCIPAL'] },
        createdByUserId: admin.id,
      },
    ],
  });

  const todayIso = isoDay(now);

  // Staff attendance for the last five working days.
  for (const [index, person] of staff.entries()) {
    for (let offset = 0; offset < 5; offset += 1) {
      const attendanceDate = addDays(today, -offset);
      const day = attendanceDate.getUTCDay();
      if (day === 0 || day === 6) continue;
      await tx.staffAttendance.create({
        data: {
          id: uuidv7(),
          schoolId,
          staffId: person.id,
          date: attendanceDate,
          status: (index + offset) % 9 === 0 ? 'LATE' : 'PRESENT',
          checkIn: (index + offset) % 9 === 0 ? '09:48' : '09:25',
          checkOut: '16:10',
        },
      });
    }
  }

  await tx.staffLeave.createMany({
    data: [
      {
        id: uuidv7(),
        schoolId,
        staffId: staff[2]!.id,
        type: 'SICK',
        status: 'APPROVED',
        startDate: addDays(today, -6),
        endDate: addDays(today, -5),
        reason: 'Viral fever — medical note submitted.',
        approvedByUserId: admin.id,
      },
      {
        id: uuidv7(),
        schoolId,
        staffId: staff[4]!.id,
        type: 'CASUAL',
        status: 'PENDING',
        startDate: addDays(today, 4),
        endDate: addDays(today, 5),
        reason: 'Family function outside the valley.',
      },
    ],
  });

  // Previous-month payroll with one payslip per staff member.
  const payrollDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const payslips = staff.map((person) => {
    const baseMinor = person.baseSalaryMinor ?? 0;
    const allowancesMinor = Math.round(baseMinor * 0.1);
    const deductionsMinor = Math.round(baseMinor * 0.05);
    return {
      id: uuidv7(),
      schoolId,
      staffId: person.id,
      baseMinor,
      allowancesMinor,
      deductionsMinor,
      netMinor: baseMinor + allowancesMinor - deductionsMinor,
    };
  });
  await tx.payrollRun.create({
    data: {
      id: uuidv7(),
      schoolId,
      year: payrollDate.getUTCFullYear(),
      month: payrollDate.getUTCMonth() + 1,
      status: 'PAID',
      totalMinor: payslips.reduce((sum, slip) => sum + slip.netMinor, 0),
      processedAt: addDays(now, -18),
      payslips: { create: payslips },
    },
  });

  await tx.admissionApplication.createMany({
    data: [
      {
        id: uuidv7(),
        schoolId,
        academicYearId: academicYear.id,
        classId: classes.get('Class 1')!,
        studentName: 'Nisha Adhikari',
        guardianName: 'Prakash Adhikari',
        phone: '+977-9846000101',
        email: `admissions1@${school.domain}`,
        status: 'INQUIRY',
        source: 'WALK_IN',
        notes: 'Asked about transport on the Lakeside route.',
      },
      {
        id: uuidv7(),
        schoolId,
        academicYearId: academicYear.id,
        classId: classes.get('Nursery')!,
        studentName: 'Rudra Shrestha',
        guardianName: 'Manisha Shrestha',
        phone: '+977-9846000102',
        status: 'APPLIED',
        source: 'ONLINE',
      },
      {
        id: uuidv7(),
        schoolId,
        academicYearId: academicYear.id,
        classId: classes.get('Class 6')!,
        studentName: 'Sampada Ghimire',
        guardianName: 'Bishnu Ghimire',
        phone: '+977-9846000103',
        email: `admissions3@${school.domain}`,
        status: 'DOCUMENTS_PENDING',
        source: 'PHONE',
        notes: 'Transfer certificate pending from previous school.',
      },
      {
        id: uuidv7(),
        schoolId,
        academicYearId: academicYear.id,
        classId: classes.get('Class 6')!,
        studentName: 'Aayush Bhandari',
        guardianName: 'Kamala Bhandari',
        phone: '+977-9846000104',
        status: 'APPROVED',
        source: 'REFERRAL',
      },
      {
        id: uuidv7(),
        schoolId,
        academicYearId: academicYear.id,
        classId: classes.get('Class 9')!,
        studentName: 'Kritika Karki',
        guardianName: 'Nabin Karki',
        phone: '+977-9846000105',
        status: 'ADMITTED',
        source: 'WALK_IN',
      },
    ],
  });

  for (const [className, subjectCode, title, description, dueInDays] of [
    ['Class 6', 'MAT', 'Fractions worksheet', 'Complete exercises 4.1–4.3 in the workbook and show all working.', 3],
    ['Class 6', 'SCI', 'Plant cell diagram', 'Draw and label a plant cell. Write two differences from an animal cell.', 5],
    ['Class 7', 'ENG', 'Book review — Muna Madan', 'Write a 300-word review focusing on the theme of sacrifice.', 4],
    ['Class 7', 'MAT', 'Algebra practice set', 'Solve the linear equations on the worksheet; check your answers.', 2],
  ] as const) {
    await tx.homework.create({
      data: {
        id: uuidv7(),
        schoolId,
        classId: classes.get(className)!,
        sectionId: sections.get(`${className}:A`)!,
        subjectId: subjects.get(subjectCode)!,
        title,
        description,
        dueDate: addDays(today, dueInDays),
        createdByUserId: teacher.id,
      },
    });
  }

  const libraryBooks = await Promise.all(
    [
      ['978-9937-1-0001-1', 'Muna Madan', 'Laxmi Prasad Devkota', 'Literature', 5, 'Rack A1'],
      ['978-9937-1-0002-8', 'Seto Bagh', 'Diamond Shumsher Rana', 'Literature', 3, 'Rack A2'],
      ['978-9937-1-0003-5', 'Concepts of Physics', 'H. C. Verma', 'Science', 4, 'Rack B1'],
      ['978-9937-1-0004-2', 'Nepal: A Historical Miscellany', 'Various', 'History', 2, 'Rack C1'],
    ].map(async ([isbn, title, author, category, copies, location]) =>
      tx.libraryBook.create({
        data: {
          id: uuidv7(),
          schoolId,
          isbn: isbn as string,
          title: title as string,
          author: author as string,
          category: category as string,
          copies: copies as number,
          available: copies as number,
          location: location as string,
        },
      }),
    ),
  );
  await tx.libraryIssue.create({
    data: {
      id: uuidv7(),
      schoolId,
      bookId: libraryBooks[0]!.id,
      studentId: studentIds[0]!,
      issuedByUserId: admin.id,
      issueDate: addDays(now, -4),
      dueDate: addDays(today, 6),
      status: 'ISSUED',
    },
  });
  await tx.libraryBook.update({
    where: { id: libraryBooks[0]!.id },
    data: { available: libraryBooks[0]!.available - 1 },
  });

  const route = await tx.transportRoute.create({
    data: {
      id: uuidv7(),
      schoolId,
      name: 'Lakeside — School',
      vehicleNo: `GA ${school.studentPrefix} 1234`,
      driverName: 'Dil Bahadur Gurung',
      driverPhone: '+977-9856000201',
      fareMinor: 180_000,
      stops: ['Lakeside', 'Srijana Chowk', 'Prithvi Chowk', 'School'] as unknown as Prisma.InputJsonValue,
      active: true,
    },
  });
  await tx.transportAssignment.create({
    data: {
      id: uuidv7(),
      schoolId,
      routeId: route.id,
      studentId: studentIds[0]!,
      stop: 'Srijana Chowk',
    },
  });

  const hostel = await tx.hostel.create({
    data: {
      id: uuidv7(),
      schoolId,
      name: 'Ganesh Boys Hostel',
      type: 'BOYS',
      capacity: 24,
      wardenId: staff[5]!.id,
    },
  });
  const hostelRooms = await Promise.all(
    ['101', '102'].map(async (roomNo) =>
      tx.hostelRoom.create({
        data: {
          id: uuidv7(),
          schoolId,
          hostelId: hostel.id,
          roomNo,
          capacity: 3,
          occupied: roomNo === '101' ? 1 : 0,
          rentMinor: 450_000,
        },
      }),
    ),
  );
  await tx.hostelAllocation.create({
    data: {
      id: uuidv7(),
      schoolId,
      hostelId: hostel.id,
      roomId: hostelRooms[0]!.id,
      studentId: studentIds[2]!,
      startDate: date('2026-04-20'),
      status: 'ACTIVE',
    },
  });

  const inventoryItems = await Promise.all(
    [
      ['STAT-001', 'Whiteboard marker', 'Stationery', 120, 30, 4_500, 'Store room 1'],
      ['STAT-002', 'A4 copy paper (ream)', 'Stationery', 45, 20, 68_000, 'Store room 1'],
      ['LAB-001', 'Beaker 250 ml', 'Laboratory', 8, 12, 32_000, 'Science lab'],
      ['FURN-001', 'Student desk', 'Furniture', 36, 10, 480_000, 'Warehouse'],
    ].map(async ([sku, name, category, quantity, reorderLevel, unitPriceMinor, location]) =>
      tx.inventoryItem.create({
        data: {
          id: uuidv7(),
          schoolId,
          sku: sku as string,
          name: name as string,
          category: category as string,
          quantity: quantity as number,
          reorderLevel: reorderLevel as number,
          unitPriceMinor: unitPriceMinor as number,
          location: location as string,
        },
      }),
    ),
  );
  await tx.inventoryTransaction.createMany({
    data: inventoryItems.map((item, index) => ({
      id: uuidv7(),
      schoolId,
      itemId: item.id,
      type: index % 2 === 0 ? 'ISSUE' : 'RECEIPT',
      quantity: index % 2 === 0 ? 5 : 20,
      reference: `SEED-${index + 1}`,
      notes: index % 2 === 0 ? 'Issued to department' : 'Opening stock correction',
      performedByUserId: accountant.id,
    })),
  });

  await tx.questionBank.createMany({
    data: [
      {
        id: uuidv7(),
        schoolId,
        subjectId: subjects.get('MAT')!,
        type: 'MCQ',
        question: 'What is the value of 7 × 8?',
        options: ['54', '56', '58', '64'] as unknown as Prisma.InputJsonValue,
        answer: '56',
        marks: 1,
        difficulty: 'EASY',
        tags: ['arithmetic', 'multiplication'] as unknown as Prisma.InputJsonValue,
        createdByUserId: teacher.id,
      },
      {
        id: uuidv7(),
        schoolId,
        subjectId: subjects.get('MAT')!,
        type: 'SHORT',
        question: 'Solve for x: 3x + 5 = 20.',
        options: [] as unknown as Prisma.InputJsonValue,
        answer: 'x = 5',
        marks: 2,
        difficulty: 'MEDIUM',
        tags: ['algebra'] as unknown as Prisma.InputJsonValue,
        createdByUserId: teacher.id,
      },
      {
        id: uuidv7(),
        schoolId,
        subjectId: subjects.get('SCI')!,
        type: 'MCQ',
        question: 'Which organelle is known as the powerhouse of the cell?',
        options: ['Nucleus', 'Ribosome', 'Mitochondria', 'Vacuole'] as unknown as Prisma.InputJsonValue,
        answer: 'Mitochondria',
        marks: 1,
        difficulty: 'EASY',
        tags: ['cell biology'] as unknown as Prisma.InputJsonValue,
        createdByUserId: teacher.id,
      },
      {
        id: uuidv7(),
        schoolId,
        subjectId: subjects.get('ENG')!,
        type: 'LONG',
        question: 'Discuss the theme of sacrifice in Muna Madan.',
        options: [] as unknown as Prisma.InputJsonValue,
        answer: 'A structured essay referencing Muna and Madan’s choices.',
        marks: 5,
        difficulty: 'HARD',
        tags: ['literature', 'essay'] as unknown as Prisma.InputJsonValue,
        createdByUserId: teacher.id,
      },
    ],
  });

  const thread = await tx.messageThread.create({
    data: {
      id: uuidv7(),
      schoolId,
      subject: 'Aarav — term progress check-in',
      createdByUserId: teacher.id,
      participantIds: [teacher.id, parent.id] as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.message.createMany({
    data: [
      {
        id: uuidv7(),
        schoolId,
        threadId: thread.id,
        senderId: teacher.id,
        body: 'Namaste, Aarav has settled well this term. His mathematics has improved and he participates eagerly in science practicals.',
        readBy: [parent.id] as unknown as Prisma.InputJsonValue,
        createdAt: addDays(now, -2),
      },
      {
        id: uuidv7(),
        schoolId,
        threadId: thread.id,
        senderId: parent.id,
        body: 'Thank you for the update. We will keep encouraging the reading habit at home. Could you share the homework schedule?',
        readBy: [teacher.id, parent.id] as unknown as Prisma.InputJsonValue,
        createdAt: addDays(now, -1),
      },
    ],
  });

  // Usage meters for the current month (used by the platform usage console).
  const period = todayIso.slice(0, 7);
  await tx.meterUsage.createMany({
    data: [
      { id: uuidv7(), schoolId, metric: 'students', value: studentIds.length, period },
      { id: uuidv7(), schoolId, metric: 'staff', value: staff.length, period },
      { id: uuidv7(), schoolId, metric: 'storage_mb', value: school.slug === 'green-valley' ? 512 : 128, period },
      { id: uuidv7(), schoolId, metric: 'api_calls', value: school.slug === 'green-valley' ? 18_420 : 3_120, period },
      { id: uuidv7(), schoolId, metric: 'sms_sent', value: school.slug === 'green-valley' ? 764 : 96, period },
    ],
  });

  // Platform invoices make the control-plane billing screen meaningful.
  const planPriceMinor =
    school.planCode === 'growth'
      ? 2_499_000
      : school.planCode === 'starter'
        ? 1_499_000
        : school.planCode === 'enterprise'
          ? 4_999_000
          : 0;
  if (planPriceMinor > 0) {
    await tx.platformInvoice.createMany({
      data: [
        {
          id: uuidv7(),
          schoolId,
          number: `${school.studentPrefix}-PLAT-2026-001`,
          amountMinor: planPriceMinor,
          status: 'PAID',
          dueAt: addDays(now, -20),
          paidAt: addDays(now, -18),
          lineItems: [
            { description: 'Annual subscription', amountMinor: planPriceMinor },
          ] as unknown as Prisma.InputJsonValue,
        },
        {
          id: uuidv7(),
          schoolId,
          number: `${school.studentPrefix}-PLAT-2026-002`,
          amountMinor: planPriceMinor,
          status: 'OPEN',
          dueAt: addDays(now, 20),
          lineItems: [
            { description: 'Annual subscription renewal', amountMinor: planPriceMinor },
          ] as unknown as Prisma.InputJsonValue,
        },
      ],
    });
  }

  const auditCreatedAt = new Date();
  const auditAfter = { slug: school.slug, students: studentIds.length };
  const auditPrevHash = '0'.repeat(64);
  await tx.auditLog.create({
    data: {
      id: uuidv7(),
      schoolId,
      actorUserId: admin.id,
      actorType: 'USER',
      action: 'school.seeded',
      entity: 'School',
      entityId: schoolId,
      after: auditAfter,
      requestId: 'seed',
      createdAt: auditCreatedAt,
      prevHash: auditPrevHash,
      hash: hashEntry(auditPrevHash, {
        schoolId,
        actorUserId: admin.id,
        actorType: 'USER',
        action: 'school.seeded',
        entity: 'School',
        entityId: schoolId,
        before: null,
        after: auditAfter,
        requestId: 'seed',
        createdAt: auditCreatedAt.toISOString(),
      }),
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
