import { describe, expect, it } from 'vitest';
import { analyzeLegacyBackup, legacyClassKey, nameKey, parseLegacyBackupJson } from '../src/import/prototype';

const backup = {
  settings: {
    schoolName: 'Pipara Academy',
    academicYear: '2023-2030',
    theme: 'dark',
    pin: '1234',
    autoLock: true,
  },
  classes: [{ id: 'cls1', name: 'Class 10', sections: ['A', 'B'], subjects: ['Math', 'Science'] }],
  subjects: [
    { id: 'sub1', name: 'Mathematics', code: 'MATH101', teacher: 'Dr. Robert Miller' },
    { id: 'sub2', name: 'Science', code: 'SCI101', teacher: '' },
  ],
  teachers: [
    {
      id: 'tch1',
      employeeId: 'TCH001',
      name: 'Dr. Robert Miller',
      email: 'robert@school.edu',
      phone: '555-0201',
      subject: 'Mathematics',
      qualification: 'PhD',
      joinedDate: '2010-06-01',
    },
  ],
  students: [
    {
      id: 'stu1',
      admissionNo: 'STU001',
      name: 'John Smith',
      class: '10',
      section: 'A',
      rollNo: '1',
      gender: 'Male',
      dob: '2007-05-15',
      parentName: 'Michael Smith',
      phone: '555-0101',
      address: '123 Main Street',
    },
    {
      id: 'stu2',
      admissionNo: 'STU002',
      name: 'Emma Johnson',
      class: '10',
      section: 'A',
      rollNo: '2',
      gender: 'Female',
      dob: '2007-08-22',
      parentName: 'Sarah Johnson',
      phone: '555-0102',
    },
  ],
  attendance: [
    {
      date: '2026-04-15',
      class: '10',
      section: 'A',
      students: [
        { studentId: 'stu1', status: 'present', rollNo: '1' },
        { studentId: 'stu2', status: 'absent', remark: 'Sick' },
      ],
    },
  ],
  exams: [
    { id: 'exam1', name: 'Unit Test 1', class: '10', subject: 'Mathematics', date: '2026-04-15', maxMarks: 100 },
  ],
  results: [
    {
      studentId: 'stu1',
      examName: 'Unit Test 1',
      class: '10',
      subject: 'Mathematics',
      marksObtained: 88,
      maxMarks: 100,
      grade: 'A',
    },
  ],
  fees: [
    { id: 'pay1', studentId: 'stu1', amount: 5000, status: 'paid', date: '2026-04-10', method: 'Cash' },
  ],
  feeStructure: [
    { id: 'fee1', class: '10', term: 'Annual', amount: 50000, description: 'Annual Fee' },
  ],
  timetable: [
    {
      id: 'tt1',
      class: '10',
      section: 'A',
      periods: [
        { day: 'Monday', period1: 'Math - Dr. Robert Miller', period2: 'Free' },
      ],
    },
  ],
  notices: [{ id: 'n1', title: 'Sports Day', content: 'Friday', priority: 'high', date: '2026-04-20' }],
};

describe('legacy prototype import', () => {
  it('normalises names and matches "Class 10" with "10"', () => {
    expect(nameKey('  Dr. Robert   Miller ')).toBe('dr. robert miller');
    expect(legacyClassKey('Class 10')).toBe('10');
    expect(legacyClassKey('10')).toBe('10');
    expect(legacyClassKey('class 09')).toBe('9');
  });

  it('imports settings but never the plaintext PIN', () => {
    const result = analyzeLegacyBackup(backup);
    expect(result.settings).toMatchObject({
      schoolName: 'Pipara Academy',
      academicYear: '2023-2030',
      theme: 'dark',
    });
    expect(result.issues.some((i) => i.code === 'pin_not_importable')).toBe(true);
  });

  it('maps students to class/section keys and guardians', () => {
    const result = analyzeLegacyBackup(backup);
    expect(result.students).toHaveLength(2);
    const john = result.students.find((s) => s.admissionNo === 'STU001');
    expect(john).toMatchObject({
      firstName: 'John',
      lastName: 'Smith',
      classKey: '10',
      sectionKey: '10|A',
      guardianName: 'Michael Smith',
      gender: 'MALE',
    });
    expect(result.classes.map((c) => c.name)).toEqual(['Class 10']);
    expect(result.sections.map((s) => s.name).sort()).toEqual(['A', 'B']);
  });

  it('converts fee amounts from major to minor units', () => {
    const result = analyzeLegacyBackup(backup);
    expect(result.feeStructures[0]?.amountMinor).toBe(5_000_000);
    expect(result.payments[0]).toMatchObject({ studentKey: 'STU001', amountMinor: 500_000, status: 'PAID' });
    expect(result.issues.some((i) => i.code === 'payments_require_reconciliation')).toBe(true);
  });

  it('resolves legacy student ids in attendance and results', () => {
    const result = analyzeLegacyBackup(backup);
    expect(result.attendanceSessions[0]?.records).toEqual([
      { studentKey: 'STU001', status: 'PRESENT' },
      { studentKey: 'STU002', status: 'ABSENT', remark: 'Sick' },
    ]);
    expect(result.results[0]).toMatchObject({
      studentKey: 'STU001',
      examName: 'Unit Test 1',
      marksObtained: 88,
      absent: false,
    });
    expect(result.exams[0]?.maxMarks).toBe(100);
  });

  it('parses free-text timetable into structured slots', () => {
    const result = analyzeLegacyBackup(backup);
    expect(result.timetableSlots).toHaveLength(1);
    expect(result.timetableSlots[0]).toMatchObject({
      classKey: '10',
      sectionKey: '10|A',
      dayOfWeek: 1,
      periodIndex: 1,
      teacherName: 'Dr. Robert Miller',
    });
    expect(result.timetableSlots[0]?.subjectKey).toBeTruthy();
  });

  it('counts imported entities and keeps notices', () => {
    const result = analyzeLegacyBackup(backup);
    expect(result.stats).toMatchObject({
      classes: 1,
      sections: 2,
      teachers: 1,
      students: 2,
      feeStructures: 1,
      attendanceSessions: 1,
      attendanceRecords: 2,
      timetableSlots: 1,
      notices: 1,
    });
    expect(result.notices[0]?.priority).toBe('HIGH');
  });

  it('reports unresolved references instead of silently dropping data', () => {
    const result = analyzeLegacyBackup({
      results: [{ studentName: 'Missing Person', examName: 'X', subject: 'Math', marksObtained: 10 }],
      attendance: [{ date: '2026-01-01', class: 'Class 1', section: 'A', students: [{ studentId: 'nope', status: 'present' }] }],
    });
    expect(result.issues.some((i) => i.code === 'unresolved_student' && i.severity === 'error')).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it('tolerates an empty or malformed backup', () => {
    const result = analyzeLegacyBackup({ students: 'not-an-array', classes: null });
    expect(result.stats.students).toBe(0);
    expect(result.classes).toEqual([]);
  });
});

describe('legacy import edge cases', () => {
  const messy = {
    settings: {
      pin: '',
      schoolName: '  Edge School  ',
      academicYear: 2026,
      theme: 'neon',
      locale: 'en-NP',
      currency: 'inr',
      timezone: 'Asia/Kathmandu',
    },
    classes: [
      { name: 'Class 01', sections: [{ name: 'a' }, '', 42], subjects: ['Math-1', 'Math 1', ''] },
      { className: 'Class 2', sections: ['b'] },
      { name: '', sections: ['x'] },
      'not-a-class',
    ],
    teachers: [
      { fullName: 'No Id Teacher', subject: 'Math, Science', experience: '5 years', joinedDate: '2015-01-01' },
      { name: '', employeeId: 'X' },
      { name: 'Bad Date Teacher', joinedDate: '01/01/2015' },
    ],
    subjects: [
      { name: 'Science', code: 'sci1', teacher: 'Nobody Known' },
      { name: 'Science', code: 'sci1' },
      { name: '', code: 'EMPTY' },
    ],
    students: [
      {
        name: 'Solo Student',
        className: 'Class 01',
        section: 'a',
        gender: 'm',
        dob: '1999-13-40',
        guardianName: 'Guardian',
        contact: '9800000000',
      },
      {
        fullName: 'Father Student',
        class: 'Class 01',
        gender: 'f',
        fatherName: 'Father',
        guardianPhone: '9800000001',
        address: 'Kathmandu',
      },
      {
        name: 'Mother Student',
        class: 'Class 01',
        gender: 'x',
        motherName: 'Mother',
        phone: '9800000002',
      },
      { name: 'No Class Student' },
      { name: '' },
      { name: 'Duplicate Admission', class: 'Class 01', admissionNo: 'STU001' },
      { name: 'Duplicate Admission', class: 'Class 01', admissionNo: 'STU001' },
    ],
    feeStructure: [
      { class: 'Class 01', amount: '1200.50', term: 'Term 1', feeHead: 'Tuition' },
      { class: 'Class 01', amount: 'oops', description: 'Bad' },
      { class: 'Class 01', description: 'Missing amount' },
      { class: 'Class 01', amount: 100 },
    ],
    exams: [
      { name: 'Unit', class: 'Class 01', subject: 'Math-1', maxMarks: '50', date: '2026-02-30' },
      { class: 'Class 01', subject: 'Math-1' },
      { name: 'No Subject', class: 'Class 01' },
      { name: 'No Class', subject: 'Math-1' },
      { name: 'Defaulted Max', class: 'Class 01', subject: 'Math-1' },
    ],
    results: [
      { studentName: 'Solo Student', examName: 'Unit', subject: 'Math-1', status: 'absent', maxMarks: 50 },
      { studentName: 'Solo Student', examName: 'Unit', subject: 'Math-1', status: 'a', maxMarks: 50 },
      { studentName: 'Solo Student', examName: 'Unit', subject: 'Math-1', marks: '101', maxMarks: 50 },
      { studentName: 'Solo Student', subject: 'Math-1' },
      { studentName: 'Solo Student', examName: 'Unit' },
      { admissionNo: 'STU001', examName: 'Unit', subject: 'Math-1', marks: 10 },
    ],
    attendance: [
      {
        date: '2026-01-01',
        class: 'Class 01',
        students: [
          { studentName: 'Solo Student', status: 'late', remark: 'Traffic' },
          { studentName: 'Solo Student', status: 'half-day' },
          { studentName: 'Solo Student', status: 'leave' },
          { studentName: 'Solo Student', status: 'excused' },
          { studentName: 'Solo Student', status: 'unknown' },
          { studentName: 'Missing Student', status: 'present' },
        ],
      },
      { date: 'nope', class: 'Class 01', students: [] },
      { date: '2026-01-02', class: 'Class 01', students: [] },
    ],
    timetable: [
      {
        class: 'Class 01',
        periods: [
          { day: 'Funday', period1: 'Math' },
          { day: 'Tuesday', note: 'ignore', period1: 'Free', period2: 'Break', period3: 'Lunch' },
          { day: 'Wednesday', period1: 'Math 1 - New Teacher', period2: '' },
        ],
      },
      { periods: [{ day: 'Monday', period1: 'Math' }] },
    ],
    notices: [
      { title: 'Low', content: 'Body', priority: 'low', date: '2026-01-01' },
      { title: 'Normal', message: 'Message', priority: 'normal' },
      { title: 'Urgent', body: 'Body', priority: 'urgent', publishedAt: '2026-02-02T10:00:00Z' },
      { title: 'No Date', body: 'Body', date: 'not-a-date' },
      { title: '' },
    ],
    fees: [
      { studentName: 'Solo Student', paidAmount: 25, status: 'pending' },
      { studentName: 'Solo Student', total: 30, status: 'paid', paidDate: '2026-01-01', method: 'Cash', id: 'pay1' },
      { studentName: 'Solo Student', amount: 'bad' },
      { studentName: 'Missing Student', amount: 10 },
    ],
  };

  it('imports messy legacy data without throwing and records every issue class', () => {
    const result = analyzeLegacyBackup(messy);
    const codes = new Set(result.issues.map((issue) => issue.code));

    expect(result.settings).toMatchObject({
      schoolName: 'Edge School',
      academicYear: '2026',
      locale: 'en-NP',
      currency: 'INR',
      timezone: 'Asia/Kathmandu',
    });
    expect(result.settings.theme).toBeUndefined();
    for (const code of [
      'class_missing',
      'teacher_name_missing',
      'subject_name_missing',
      'unresolved_teacher',
      'student_name_missing',
      'student_class_missing',
      'duplicate_admission',
      'invalid_date',
      'fee_amount_invalid',
      'exam_incomplete',
      'default_max_marks',
      'marks_out_of_range',
      'result_incomplete',
      'unknown_attendance_status',
      'unresolved_student',
      'unknown_day',
      'notice_title_missing',
      'payments_require_reconciliation',
    ]) {
      expect(codes.has(code), `expected issue ${code}`).toBe(true);
    }
    expect(result.classes).toHaveLength(2);
    expect(result.subjects.some((subject) => subject.code === 'MATH-1-2')).toBe(true);
    expect(result.attendanceSessions[0]?.records.map((record) => record.status)).toEqual([
      'LATE',
      'HALF_DAY',
      'LEAVE',
      'LEAVE',
    ]);
    expect(result.timetableSlots).toHaveLength(1);
    expect(result.timetableSlots[0]).toMatchObject({ dayOfWeek: 3, teacherName: 'New Teacher' });
    expect(result.notices.map((notice) => notice.priority)).toEqual(['LOW', 'NORMAL', 'HIGH', 'NORMAL']);
    expect(result.payments.map((payment) => payment.status)).toEqual(['PENDING', 'PAID']);
    expect(result.students.find((student) => student.fullName === 'Father Student')).toMatchObject({
      gender: 'FEMALE',
      guardianName: 'Father',
    });
    expect(result.students.find((student) => student.fullName === 'Mother Student')).toMatchObject({
      gender: 'OTHER',
      guardianName: 'Mother',
    });
  });

  it('returns an empty analysis for invalid JSON', () => {
    const result = parseLegacyBackupJson('{not json');
    expect(result.stats.students).toBe(0);
    expect(result.settings).toEqual({});
  });
});
