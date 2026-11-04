/**
 * Migration assistant for the legacy single-file prototype backup.
 *
 * The prototype stored name-based relationships (`class: '10'`,
 * `subject: 'Math'`) and major-unit amounts. This module converts a parsed
 * backup object into ID-ready, money-in-minor-unit import records while
 * reporting every unresolved reference. It never writes to the database; the
 * API import job persists the result inside one tenant transaction.
 *
 * Imported keys: settings, students, teachers, classes, subjects, attendance,
 * exams, results, fees, feeStructure, timetable, notices.
 */
import { parseMoneyToMinor } from '../money';

export type ImportSeverity = 'error' | 'warning';

export interface ImportIssue {
  path: string;
  code: string;
  message: string;
  severity: ImportSeverity;
}

export interface ImportedSettings {
  schoolName?: string;
  academicYear?: string;
  theme?: 'light' | 'dark';
  locale?: string;
  currency?: string;
  timezone?: string;
}

export interface ImportedClass {
  key: string;
  name: string;
  sequence: number;
}

export interface ImportedSection {
  key: string;
  classKey: string;
  name: string;
}

export interface ImportedSubject {
  key: string;
  code: string;
  name: string;
  classKeys: string[];
  teacherName?: string;
}

export interface ImportedTeacher {
  employeeNo: string;
  fullName: string;
  email?: string;
  phone?: string;
  qualification?: string;
  experience?: string;
  joinedOn?: string;
  subjectNames: string[];
}

export interface ImportedStudent {
  legacyId?: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  fullName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dob?: string;
  classKey: string;
  sectionKey: string;
  rollNo?: string;
  guardianName?: string;
  phone?: string;
  address?: string;
}

export interface ImportedFeeHead {
  code: string;
  name: string;
}

export interface ImportedFeeStructure {
  classKey: string;
  feeHeadCode: string;
  term: string;
  amountMinor: number;
}

export interface ImportedExamSubject {
  examName: string;
  classKey: string;
  subjectKey: string;
  examDate?: string;
  maxMarks: number;
}

export interface ImportedResult {
  studentKey: string;
  examName: string;
  classKey: string;
  subjectKey: string;
  marksObtained: number;
  maxMarks: number;
  absent: boolean;
}

export interface ImportedAttendanceRecord {
  studentKey: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'LEAVE';
  remark?: string;
}

export interface ImportedAttendanceSession {
  date: string;
  classKey: string;
  sectionKey: string;
  records: ImportedAttendanceRecord[];
}

export interface ImportedTimetableSlot {
  classKey: string;
  sectionKey: string;
  dayOfWeek: number;
  periodIndex: number;
  subjectKey?: string;
  teacherName?: string;
  raw: string;
}

export interface ImportedNotice {
  title: string;
  body: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  publishedAt?: string;
}

export interface ImportedPayment {
  studentKey: string;
  amountMinor: number;
  status: 'PENDING' | 'PAID';
  paidOn?: string;
  method?: string;
  legacyId?: string;
}

export interface ImportStats {
  classes: number;
  sections: number;
  subjects: number;
  teachers: number;
  students: number;
  feeHeads: number;
  feeStructures: number;
  exams: number;
  results: number;
  attendanceSessions: number;
  attendanceRecords: number;
  timetableSlots: number;
  notices: number;
  payments: number;
}

export interface LegacyImportResult {
  settings: ImportedSettings;
  classes: ImportedClass[];
  sections: ImportedSection[];
  subjects: ImportedSubject[];
  teachers: ImportedTeacher[];
  students: ImportedStudent[];
  feeHeads: ImportedFeeHead[];
  feeStructures: ImportedFeeStructure[];
  exams: ImportedExamSubject[];
  results: ImportedResult[];
  attendanceSessions: ImportedAttendanceSession[];
  timetableSlots: ImportedTimetableSlot[];
  notices: ImportedNotice[];
  payments: ImportedPayment[];
  issues: ImportIssue[];
  stats: ImportStats;
}

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Rec {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Normalises a display name for case/whitespace-insensitive matching. */
export function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** "Class 10" and "10" resolve to the same legacy class. */
export function legacyClassKey(value: string): string {
  return nameKey(value)
    .replace(/^class\s+/, '')
    .replace(/^0+(?=\d)/, '');
}

function codeFrom(name: string, fallbackPrefix: string, used: Set<string>): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 16) || fallbackPrefix;
  let code = base;
  let suffix = 2;
  while (used.has(code)) {
    code = `${base.slice(0, 12)}-${suffix}`;
    suffix += 1;
  }
  used.add(code);
  return code;
}

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

const DAY_NUMBERS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const STATUS_MAP: Record<string, ImportedAttendanceRecord['status']> = {
  present: 'PRESENT',
  p: 'PRESENT',
  absent: 'ABSENT',
  a: 'ABSENT',
  late: 'LATE',
  l: 'LATE',
  'half day': 'HALF_DAY',
  'half-day': 'HALF_DAY',
  halfday: 'HALF_DAY',
  leave: 'LEAVE',
  excused: 'LEAVE',
};

export function analyzeLegacyBackup(backup: unknown): LegacyImportResult {
  const root = asRecord(backup);
  const issues: ImportIssue[] = [];
  const addIssue = (
    path: string,
    code: string,
    message: string,
    severity: ImportSeverity = 'warning',
  ): void => {
    issues.push({ path, code, message, severity });
  };

  const settings: ImportedSettings = {};
  const rawSettings = asRecord(root.settings);
  if (str(rawSettings.pin)) {
    addIssue(
      'settings.pin',
      'pin_not_importable',
      'Plaintext PIN was intentionally not imported. Users must set passwords after migration.',
    );
  }
  const schoolName = str(rawSettings.schoolName);
  if (schoolName) settings.schoolName = schoolName;
  const academicYear = str(rawSettings.academicYear);
  if (academicYear) settings.academicYear = academicYear;
  const theme = str(rawSettings.theme).toLowerCase();
  if (theme === 'light' || theme === 'dark') settings.theme = theme;
  const locale = str(rawSettings.locale);
  if (locale) settings.locale = locale;
  const currency = str(rawSettings.currency).toUpperCase();
  if (currency) settings.currency = currency;
  const timezone = str(rawSettings.timezone);
  if (timezone) settings.timezone = timezone;

  // ---------- Classes & sections ----------
  const classes = new Map<string, ImportedClass>();
  const sections = new Map<string, ImportedSection>();
  const classOrder: ImportedClass[] = [];

  const ensureClass = (rawName: string, path: string): ImportedClass | null => {
    const key = legacyClassKey(rawName);
    if (!key) {
      addIssue(path, 'class_missing', 'Class name is empty; record skipped', 'error');
      return null;
    }
    const existing = classes.get(key);
    if (existing) return existing;
    const digits = Number.parseInt(key.replace(/\D/g, ''), 10);
    const created: ImportedClass = {
      key,
      name: rawName.trim(),
      sequence: Number.isFinite(digits) && digits > 0 ? digits : classOrder.length + 1,
    };
    classes.set(key, created);
    classOrder.push(created);
    return created;
  };

  const ensureSection = (classKey: string, rawName: string, path: string): ImportedSection | null => {
    const name = str(rawName, 'A').toUpperCase() || 'A';
    const key = `${classKey}|${name}`;
    const existing = sections.get(key);
    if (existing) return existing;
    if (!classes.has(classKey)) {
      addIssue(path, 'unknown_class', `Section ${name} references unknown class ${classKey}`, 'error');
      return null;
    }
    const created: ImportedSection = { key, classKey, name };
    sections.set(key, created);
    return created;
  };

  asArray(root.classes).forEach((item, index) => {
    const record = asRecord(item);
    const rawName = str(record.name) || str(record.className);
    const created = ensureClass(rawName, `classes[${index}]`);
    if (!created) return;
    for (const section of asArray(record.sections)) {
      const sectionName = isRecord(section) ? str(section.name) : str(section);
      if (sectionName) ensureSection(created.key, sectionName, `classes[${index}].sections`);
    }
  });

  // ---------- Teachers ----------
  const teachers: ImportedTeacher[] = [];
  const teachersByName = new Map<string, ImportedTeacher>();
  asArray(root.teachers).forEach((item, index) => {
    const record = asRecord(item);
    const fullName = str(record.name) || str(record.fullName);
    if (!fullName) {
      addIssue(`teachers[${index}]`, 'teacher_name_missing', 'Teacher without a name was skipped', 'error');
      return;
    }
    const teacher: ImportedTeacher = {
      employeeNo: str(record.employeeId) || str(record.employeeNo) || `TCH${index + 1}`,
      fullName,
      subjectNames: str(record.subject)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const email = str(record.email);
    if (email) teacher.email = email;
    const phone = str(record.phone);
    if (phone) teacher.phone = phone;
    const qualification = str(record.qualification);
    if (qualification) teacher.qualification = qualification;
    const experience = str(record.experience);
    if (experience) teacher.experience = experience;
    const joined = str(record.joinedDate);
    if (joined && validIsoDate(joined)) teacher.joinedOn = joined;
    teachers.push(teacher);
    teachersByName.set(nameKey(fullName), teacher);
  });

  // ---------- Subjects ----------
  const subjects = new Map<string, ImportedSubject>();
  const subjectCodes = new Set<string>();
  const classSubjectKeys = new Map<string, Set<string>>();

  asArray(root.classes).forEach((item) => {
    const record = asRecord(item);
    const classKey = legacyClassKey(str(record.name) || str(record.className));
    if (!classKey) return;
    const names = asArray(record.subjects)
      .map((s) => (isRecord(s) ? str(s.name) : str(s)))
      .filter(Boolean);
    for (const name of names) {
      const key = nameKey(name);
      let subject = subjects.get(key);
      if (!subject) {
        subject = { key, code: codeFrom(name, 'SUB', subjectCodes), name, classKeys: [] };
        subjects.set(key, subject);
      }
      if (!subject.classKeys.includes(classKey)) subject.classKeys.push(classKey);
      const set = classSubjectKeys.get(classKey) ?? new Set<string>();
      set.add(key);
      classSubjectKeys.set(classKey, set);
    }
  });

  const ensureSubject = (rawName: string, path: string): ImportedSubject | null => {
    const name = rawName.trim();
    if (!name) return null;
    const key = nameKey(name);
    let subject = subjects.get(key);
    if (!subject) {
      subject = { key, code: codeFrom(name, 'SUB', subjectCodes), name, classKeys: [] };
      subjects.set(key, subject);
      addIssue(path, 'implicit_subject', `Subject "${name}" was created from a reference`);
    }
    return subject;
  };

  asArray(root.subjects).forEach((item, index) => {
    const record = asRecord(item);
    const name = str(record.name);
    if (!name) {
      addIssue(`subjects[${index}]`, 'subject_name_missing', 'Subject without a name was skipped', 'error');
      return;
    }
    const key = nameKey(name);
    let subject = subjects.get(key);
    if (!subject) {
      subject = { key, code: codeFrom(name, 'SUB', subjectCodes), name, classKeys: [] };
      subjects.set(key, subject);
    }
    const explicitCode = str(record.code);
    if (explicitCode && !subjectCodes.has(explicitCode.toUpperCase())) {
      subject.code = explicitCode.toUpperCase();
      subjectCodes.add(subject.code);
    }
    const teacherName = str(record.teacher);
    if (teacherName) {
      subject.teacherName = teacherName;
      if (!teachersByName.has(nameKey(teacherName))) {
        addIssue(
          `subjects[${index}].teacher`,
          'unresolved_teacher',
          `Teacher "${teacherName}" was not found in teachers; mapping left unresolved`,
        );
      }
    }
  });

  // ---------- Students ----------
  const students: ImportedStudent[] = [];
  const studentsByAdmission = new Map<string, ImportedStudent>();
  const legacyIdToAdmission = new Map<string, string>();
  const studentsByName = new Map<string, ImportedStudent>();

  asArray(root.students).forEach((item, index) => {
    const record = asRecord(item);
    const fullName = str(record.name) || str(record.fullName);
    const path = `students[${index}]`;
    if (!fullName) {
      addIssue(path, 'student_name_missing', 'Student without a name was skipped', 'error');
      return;
    }
    const classRaw = str(record.class) || str(record.className);
    const cls = ensureClass(classRaw, path);
    if (!cls) {
      addIssue(path, 'student_class_missing', 'Student without a class was skipped', 'error');
      return;
    }
    const sectionRaw = str(record.section) || 'A';
    const section = ensureSection(cls.key, sectionRaw, path);
    if (!section) return;

    const parts = fullName.split(/\s+/);
    const firstName = parts[0] ?? fullName;
    const lastName = parts.slice(1).join(' ');
    const genderRaw = str(record.gender).toLowerCase();
    const gender: ImportedStudent['gender'] =
      genderRaw === 'male' || genderRaw === 'm'
        ? 'MALE'
        : genderRaw === 'female' || genderRaw === 'f'
          ? 'FEMALE'
          : 'OTHER';

    const admissionNo = str(record.admissionNo) || `LEGACY-${String(index + 1).padStart(4, '0')}`;
    if (studentsByAdmission.has(admissionNo)) {
      addIssue(path, 'duplicate_admission', `Duplicate admission number ${admissionNo}; skipped`, 'error');
      return;
    }

    const student: ImportedStudent = {
      admissionNo,
      firstName,
      lastName,
      fullName,
      gender,
      classKey: cls.key,
      sectionKey: section.key,
    };
    const legacyId = str(record.id);
    if (legacyId) {
      student.legacyId = legacyId;
      legacyIdToAdmission.set(legacyId, admissionNo);
    }
    const dob = str(record.dob);
    if (dob) {
      if (validIsoDate(dob)) student.dob = dob;
      else addIssue(`${path}.dob`, 'invalid_date', 'Date of birth is not a valid YYYY-MM-DD date');
    }
    const rollNo = str(record.rollNo);
    if (rollNo) student.rollNo = rollNo;
    const guardianName =
      str(record.parentName) || str(record.guardianName) || str(record.fatherName) || str(record.motherName);
    if (guardianName) student.guardianName = guardianName;
    const phone = str(record.phone) || str(record.guardianPhone) || str(record.contact);
    if (phone) student.phone = phone;
    const address = str(record.address);
    if (address) student.address = address;

    students.push(student);
    studentsByAdmission.set(admissionNo, student);
    studentsByName.set(nameKey(fullName), student);
  });

  const resolveStudent = (record: Rec): ImportedStudent | null => {
    const legacyId = str(record.studentId) || str(record.id);
    if (legacyId && legacyIdToAdmission.has(legacyId)) {
      const admission = legacyIdToAdmission.get(legacyId);
      return admission ? (studentsByAdmission.get(admission) ?? null) : null;
    }
    const admissionNo = str(record.admissionNo);
    if (admissionNo && studentsByAdmission.has(admissionNo)) {
      return studentsByAdmission.get(admissionNo) ?? null;
    }
    const name = str(record.studentName) || str(record.name);
    if (name) return studentsByName.get(nameKey(name)) ?? null;
    return null;
  };

  // ---------- Fee heads & structures ----------
  const feeHeads = new Map<string, ImportedFeeHead>();
  const feeHeadCodes = new Set<string>();
  const feeStructures: ImportedFeeStructure[] = [];

  const ensureFeeHead = (name: string): ImportedFeeHead => {
    const clean = name.trim() || 'Tuition';
    const key = nameKey(clean);
    const existing = feeHeads.get(key);
    if (existing) return existing;
    const head: ImportedFeeHead = { code: codeFrom(clean, 'FEE', feeHeadCodes), name: clean };
    feeHeads.set(key, head);
    return head;
  };

  asArray(root.feeStructure).forEach((item, index) => {
    const record = asRecord(item);
    const path = `feeStructure[${index}]`;
    const cls = ensureClass(str(record.class) || str(record.className), path);
    if (!cls) return;
    const description = str(record.description) || str(record.feeHead) || str(record.term) || 'Tuition';
    const head = ensureFeeHead(description);
    const amountMajor = num(record.amount);
    if (amountMajor === null) {
      addIssue(path, 'fee_amount_invalid', 'Fee amount is missing or invalid; skipped', 'error');
      return;
    }
    let amountMinor: number;
    try {
      amountMinor = parseMoneyToMinor(amountMajor, settings.currency ?? 'NPR');
    } catch (error) {
      addIssue(path, 'fee_amount_invalid', error instanceof Error ? error.message : 'Invalid amount', 'error');
      return;
    }
    feeStructures.push({
      classKey: cls.key,
      feeHeadCode: head.code,
      term: str(record.term) || 'Annual',
      amountMinor,
    });
  });

  // ---------- Exams ----------
  const exams = new Map<string, ImportedExamSubject>();
  const examOrder: ImportedExamSubject[] = [];

  const ensureExamSubject = (
    examName: string,
    classKey: string,
    subject: ImportedSubject,
    maxMarks: number,
    examDate: string | undefined,
    path: string,
  ): ImportedExamSubject => {
    const key = `${nameKey(examName)}|${classKey}|${subject.key}|${maxMarks}`;
    const existing = exams.get(key);
    if (existing) return existing;
    const created: ImportedExamSubject = {
      examName: examName.trim() || 'Imported Exam',
      classKey,
      subjectKey: subject.code,
      maxMarks,
    };
    if (examDate && validIsoDate(examDate)) created.examDate = examDate;
    else if (examDate) addIssue(`${path}.date`, 'invalid_date', 'Exam date is invalid');
    exams.set(key, created);
    examOrder.push(created);
    return created;
  };

  asArray(root.exams).forEach((item, index) => {
    const record = asRecord(item);
    const path = `exams[${index}]`;
    const examName = str(record.name) || str(record.examName);
    const cls = ensureClass(str(record.class) || str(record.className), path);
    if (!cls || !examName) {
      addIssue(path, 'exam_incomplete', 'Exam name or class missing; skipped', 'error');
      return;
    }
    const subject = ensureSubject(str(record.subject) || str(record.subjectName), `${path}.subject`);
    if (!subject) {
      addIssue(path, 'exam_subject_missing', 'Exam subject missing; skipped', 'error');
      return;
    }
    const maxMarks = num(record.maxMarks) ?? 100;
    if (num(record.maxMarks) === null) {
      addIssue(path, 'default_max_marks', 'Max marks missing; defaulted to 100');
    }
    if (!subject.classKeys.includes(cls.key)) subject.classKeys.push(cls.key);
    ensureExamSubject(examName, cls.key, subject, maxMarks, str(record.date), path);
  });

  // ---------- Results ----------
  const results: ImportedResult[] = [];
  asArray(root.results).forEach((item, index) => {
    const record = asRecord(item);
    const path = `results[${index}]`;
    const student = resolveStudent(record);
    if (!student) {
      addIssue(path, 'unresolved_student', 'Result references an unknown student; skipped', 'error');
      return;
    }
    const cls = classes.get(student.classKey);
    const examName = str(record.examName) || str(record.name);
    const subject = ensureSubject(str(record.subject) || str(record.subjectName), path);
    if (!cls || !examName || !subject) {
      addIssue(path, 'result_incomplete', 'Result is missing exam or subject; skipped', 'error');
      return;
    }
    const maxMarks = num(record.maxMarks) ?? 100;
    const status = str(record.status).toLowerCase();
    const absent = status === 'absent' || status === 'a';
    const marks = num(record.marksObtained) ?? num(record.marks) ?? 0;
    if (!absent && (marks < 0 || marks > maxMarks)) {
      addIssue(path, 'marks_out_of_range', 'Marks outside 0..maxMarks; skipped', 'error');
      return;
    }
    ensureExamSubject(examName, cls.key, subject, maxMarks, undefined, path);
    results.push({
      studentKey: student.admissionNo,
      examName,
      classKey: cls.key,
      subjectKey: subject.code,
      marksObtained: absent ? 0 : marks,
      maxMarks,
      absent,
    });
  });

  // ---------- Attendance ----------
  const attendanceSessions: ImportedAttendanceSession[] = [];
  asArray(root.attendance).forEach((sessionItem, index) => {
    const record = asRecord(sessionItem);
    const path = `attendance[${index}]`;
    const date = str(record.date);
    if (!validIsoDate(date)) {
      addIssue(path, 'invalid_date', 'Attendance date invalid; session skipped', 'error');
      return;
    }
    const cls = ensureClass(str(record.class) || str(record.className), path);
    if (!cls) return;
    const section = ensureSection(cls.key, str(record.section) || 'A', path);
    if (!section) return;

    const records: ImportedAttendanceRecord[] = [];
    asArray(record.students).forEach((studentItem, studentIndex) => {
      const entry = asRecord(studentItem);
      const student = resolveStudent(entry);
      if (!student) {
        addIssue(
          `${path}.students[${studentIndex}]`,
          'unresolved_student',
          'Attendance entry references an unknown student; skipped',
          'error',
        );
        return;
      }
      const rawStatus = str(entry.status).toLowerCase();
      const status = STATUS_MAP[rawStatus];
      if (!status) {
        addIssue(
          `${path}.students[${studentIndex}].status`,
          'unknown_attendance_status',
          `Unknown attendance status "${rawStatus}"; skipped`,
          'error',
        );
        return;
      }
      const imported: ImportedAttendanceRecord = { studentKey: student.admissionNo, status };
      const remark = str(entry.remark);
      if (remark) imported.remark = remark;
      records.push(imported);
    });

    if (records.length > 0) {
      attendanceSessions.push({ date, classKey: cls.key, sectionKey: section.key, records });
    }
  });

  // ---------- Timetable ----------
  const timetableSlots: ImportedTimetableSlot[] = [];
  asArray(root.timetable).forEach((item, index) => {
    const record = asRecord(item);
    const path = `timetable[${index}]`;
    const cls = ensureClass(str(record.class) || str(record.className), path);
    if (!cls) return;
    const section = ensureSection(cls.key, str(record.section) || 'A', path);
    if (!section) return;

    asArray(record.periods).forEach((dayItem, dayIndex) => {
      const day = asRecord(dayItem);
      const dayName = nameKey(str(day.day));
      const dayOfWeek = DAY_NUMBERS[dayName];
      if (!dayOfWeek) {
        addIssue(`${path}.periods[${dayIndex}].day`, 'unknown_day', `Unknown weekday "${dayName}"`, 'error');
        return;
      }
      for (const [key, value] of Object.entries(day)) {
        const match = /^period(\d+)$/i.exec(key);
        if (!match) continue;
        const periodIndex = Number(match[1]);
        const raw = str(value);
        if (!raw || /^(free|break|lunch)$/i.test(raw)) continue;
        const [subjectPart, teacherPart] = raw.split(/\s+-\s+/);
        const subject = ensureSubject(subjectPart ?? raw, `${path}.${key}`);
        if (!subject) continue;
        const slot: ImportedTimetableSlot = {
          classKey: cls.key,
          sectionKey: section.key,
          dayOfWeek,
          periodIndex,
          raw,
        };
        if (subject) slot.subjectKey = subject.code;
        if (teacherPart) slot.teacherName = teacherPart.trim();
        timetableSlots.push(slot);
      }
    });
  });

  // ---------- Notices ----------
  const notices: ImportedNotice[] = [];
  asArray(root.notices).forEach((item, index) => {
    const record = asRecord(item);
    const title = str(record.title);
    if (!title) {
      addIssue(`notices[${index}]`, 'notice_title_missing', 'Notice without a title was skipped', 'error');
      return;
    }
    const priorityRaw = str(record.priority).toLowerCase();
    const priority: ImportedNotice['priority'] =
      priorityRaw === 'high' || priorityRaw === 'urgent'
        ? 'HIGH'
        : priorityRaw === 'low'
          ? 'LOW'
          : 'NORMAL';
    const notice: ImportedNotice = {
      title,
      body: str(record.content) || str(record.body) || str(record.message),
      priority,
    };
    const publishedAt = str(record.date) || str(record.publishedAt);
    if (publishedAt && validIsoDate(publishedAt.slice(0, 10))) {
      notice.publishedAt = publishedAt.slice(0, 10);
    }
    notices.push(notice);
  });

  // ---------- Payments (legacy `fees`) ----------
  const payments: ImportedPayment[] = [];
  asArray(root.fees).forEach((item, index) => {
    const record = asRecord(item);
    const path = `fees[${index}]`;
    const student = resolveStudent(record);
    if (!student) {
      addIssue(path, 'unresolved_student', 'Fee record references an unknown student; skipped', 'error');
      return;
    }
    const amount = num(record.amount) ?? num(record.paidAmount) ?? num(record.total);
    if (amount === null) {
      addIssue(path, 'fee_amount_invalid', 'Fee amount missing; skipped', 'error');
      return;
    }
    let amountMinor: number;
    try {
      amountMinor = parseMoneyToMinor(amount, settings.currency ?? 'NPR');
    } catch (error) {
      addIssue(path, 'fee_amount_invalid', error instanceof Error ? error.message : 'Invalid amount', 'error');
      return;
    }
    const statusRaw = nameKey(str(record.status));
    const payment: ImportedPayment = {
      studentKey: student.admissionNo,
      amountMinor,
      status: statusRaw === 'paid' ? 'PAID' : 'PENDING',
    };
    const paidOn = str(record.date) || str(record.paidDate);
    if (paidOn && validIsoDate(paidOn)) payment.paidOn = paidOn;
    const method = str(record.method);
    if (method) payment.method = method;
    const legacyId = str(record.id);
    if (legacyId) payment.legacyId = legacyId;
    payments.push(payment);
  });
  if (payments.length > 0) {
    addIssue(
      'fees',
      'payments_require_reconciliation',
      'Legacy fee records are imported as a payment journal. Map them to invoices in the import review step before posting.',
    );
  }

  const classList = [...classOrder].sort((a, b) => a.sequence - b.sequence);
  const sectionList = [...sections.values()].sort((a, b) => a.key.localeCompare(b.key));
  const subjectList = [...subjects.values()].sort((a, b) => a.code.localeCompare(b.code));
  const feeHeadList = [...feeHeads.values()].sort((a, b) => a.code.localeCompare(b.code));

  return {
    settings,
    classes: classList,
    sections: sectionList,
    subjects: subjectList,
    teachers,
    students,
    feeHeads: feeHeadList,
    feeStructures,
    exams: examOrder,
    results,
    attendanceSessions,
    timetableSlots,
    notices,
    payments,
    issues,
    stats: {
      classes: classList.length,
      sections: sectionList.length,
      subjects: subjectList.length,
      teachers: teachers.length,
      students: students.length,
      feeHeads: feeHeadList.length,
      feeStructures: feeStructures.length,
      exams: examOrder.length,
      results: results.length,
      attendanceSessions: attendanceSessions.length,
      attendanceRecords: attendanceSessions.reduce((sum, s) => sum + s.records.length, 0),
      timetableSlots: timetableSlots.length,
      notices: notices.length,
      payments: payments.length,
    },
  };
}

export function parseLegacyBackupJson(json: string): LegacyImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return analyzeLegacyBackup({});
  }
  return analyzeLegacyBackup(parsed);
}
