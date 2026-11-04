export interface AuthUser {
  id: string;
  schoolId: string;
  schoolSlug: string;
  schoolName: string;
  email: string;
  fullName: string;
  roleCode: string;
  permissions: string[];
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  avatarKey: string | null;
}

export interface LoginResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  user: AuthUser;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SchoolClass {
  id: string;
  name: string;
  sequence: number;
  sections: { id: string; name: string; _count?: { students: number } }[];
  _count?: { students: number };
}

export interface GuardianBrief {
  fullName: string;
  phone: string;
  relation: string;
}

export interface StudentRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  gender: string;
  dateOfBirth?: string | null;
  classId: string;
  sectionId: string;
  rollNo?: string | null;
  status: string;
  admissionDate?: string;
  phone?: string | null;
  email?: string | null;
  address?: unknown;
  medicalNotes?: string | null;
  previousSchool?: string | null;
  version?: number;
  className?: string;
  sectionName?: string;
  guardian?: GuardianBrief | null;
  guardians?: { id?: string; fullName: string; phone: string; relation: string; isPrimary?: boolean }[];
  documents?: { id: string; title: string; kind: string; storageKey: string }[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AttendanceTotals {
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
  total: number;
  attendancePercent: number;
}

export interface AttendanceSession {
  session: {
    id: string;
    date: string;
    period: number;
    submittedAt: string;
  } | null;
  records: { studentId: string; status: string; remark?: string | null; student?: StudentRow }[];
}

export interface AttendanceStudentSummary {
  studentId: string;
  admissionNo: string;
  name: string;
  rollNo: string | null;
  className: string;
  sectionName: string;
  summary: AttendanceTotals;
}

export interface AttendanceReport {
  from: string;
  to: string;
  policy: { lowAttendanceThreshold: number };
  overall: AttendanceTotals;
  students: AttendanceStudentSummary[];
  lowAttendance: { studentId: string; summary: AttendanceTotals }[];
}

export interface DashboardOverview {
  generatedAt: string;
  school: { id: string };
  counts: {
    students: number;
    staff: number;
    classes: number;
    pendingLeaves: number;
    admissions: Record<string, number>;
  };
  attendance: { today: AttendanceTotals; trend: (AttendanceTotals & { date: string })[] };
  fees: {
    totalBilledMinor: number;
    totalPaidMinor: number;
    outstandingMinor: number;
    collectionPercent: number;
    invoiceCount: number;
    overdueInvoices: number;
    monthCollectedMinor: number;
    monthPaymentCount: number;
  };
  notices: { id: string; title: string; priority: string; publishedAt: string | null; createdAt: string }[];
  exams: { id: string; name: string; type: string; status: string; startsOn: string | null; endsOn: string | null }[];
  policy: { lowAttendanceThreshold: number };
}

export interface ChildCard {
  student: {
    id: string;
    admissionNo: string;
    name: string;
    rollNo: string | null;
    className: string;
    sectionName: string;
    classId: string;
    sectionId: string;
    status: string;
    guardians: { fullName: string; relation: string; phone: string }[];
  };
  attendance: AttendanceTotals;
  fees: {
    totalBilledMinor: number;
    totalPaidMinor: number;
    outstandingMinor: number;
    invoices: InvoiceRow[];
  };
  results: { id: string; exam: string; subject: string; marksObtained: number; maxMarks: number; isAbsent: boolean }[];
  homework: { id: string; title: string; subject: string; dueDate: string }[];
  timetable: TimetableSlot[];
}

export interface DashboardMe {
  role: string;
  fullName: string;
  staff?: { id: string; employeeNo: string; firstName: string; lastName: string; employmentType: string } | null;
  timetable?: TimetableSlot[];
  notices: NoticeRow[];
  overview?: DashboardOverview | null;
  children?: ChildCard[];
}

export interface TimetableSlot {
  id: string;
  dayOfWeek: number;
  room: string | null;
  subject: string;
  subjectCode: string;
  className: string;
  sectionName: string;
  period: { name: string; startTime: string; endTime: string; sequence: number };
}

export interface NoticeRow {
  id: string;
  title: string;
  body: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | string;
  status: string;
  audience?: unknown;
  publishAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt?: string;
  createdBy: string | null;
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
  deliveryCount?: number;
}

export interface InvoiceRow {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  currency?: string;
  subtotalMinor: number;
  discountMinor: number;
  fineMinor: number;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: string;
  student?: { id: string; admissionNo: string; name: string; className?: string; sectionName?: string };
  lineCount?: number;
  createdAt?: string;
}

export interface FeeSummary {
  from: string;
  to: string;
  ledger: {
    totalBilledMinor: number;
    totalPaidMinor: number;
    outstandingMinor: number;
    advanceMinor: number;
    netDueMinor: number;
    collectionPercent: number;
  };
  period: {
    collectedMinor: number;
    paymentCount: number;
    expensesMinor: number;
    expenseCount: number;
    netMinor: number;
  };
  byMethod: { method: string; amountMinor: number; count: number }[];
  overdue: { count: number; amountMinor: number };
}

export interface Defaulter {
  studentId: string;
  admissionNo: string;
  name: string;
  className: string;
  sectionName: string;
  phone: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  outstandingMinor: number;
  invoiceCount: number;
  oldestDueDate: string;
  maxOverdueDays: number;
}

export interface StudentLedger {
  student: {
    id: string;
    admissionNo: string;
    name: string;
    className: string;
    sectionName: string;
  };
  summary: {
    totalBilledMinor: number;
    totalPaidMinor: number;
    outstandingMinor: number;
    advanceMinor: number;
    netDueMinor: number;
  };
  invoices: InvoiceRow[];
  payments: {
    id: string;
    receiptNumber: string;
    amountMinor: number;
    method: string;
    paidAt: string;
    status: string;
    refundedMinor: number;
  }[];
}

export interface FeeHead {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isRecurring: boolean;
  isActive: boolean;
  _count?: { feeStructures: number };
}

// ---------------------------------------------------------------- Phase 3: HR & payroll

export interface StaffRow {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  email: string | null;
  phone: string | null;
  status: string;
  employmentType: string;
  baseSalaryMinor: number;
  joinedOn: string | null;
  qualification: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  address: string | null;
  experienceYears: number;
  photoKey: string | null;
  leaveCount?: number;
  payslipCount?: number;
  documents?: StaffDocumentRow[];
  leaves?: StaffLeaveRow[];
  attendance?: StaffAttendanceRow[];
}

export interface StaffDocumentRow {
  id: string;
  kind: string;
  title: string;
  storageKey: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface StaffLeaveRow {
  id: string;
  staffId: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  reason: string;
  approvedByUserId: string | null;
  createdAt: string;
  days?: number;
  staffName?: string;
}

export interface StaffAttendanceRow {
  id: string;
  staffId: string;
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  remark: string | null;
  staffName?: string;
  employeeNo?: string;
}

export interface HrSummary {
  total: number;
  active: number;
  onLeave: number;
  pendingLeaves: number;
  byEmploymentType: { type: string; count: number }[];
  latestPayroll: PayrollRunRow | null;
}

export interface PayrollRunRow {
  id: string;
  year: number;
  month: number;
  status: string;
  totalMinor: number;
  processedAt: string | null;
  createdAt: string;
  payslipCount?: number;
}

export interface PayslipRow {
  id: string;
  payrollRunId: string;
  staffId: string;
  baseMinor: number;
  allowancesMinor: number;
  deductionsMinor: number;
  netMinor: number;
  pdfKey: string | null;
  createdAt: string;
  staffName?: string;
  employeeNo?: string;
}

export interface PayrollRunDetail extends PayrollRunRow {
  payslips: PayslipRow[];
}

// ---------------------------------------------------------------- Phase 3: admissions

export interface AdmissionRow {
  id: string;
  academicYearId: string | null;
  classId: string | null;
  studentName: string;
  guardianName: string;
  phone: string;
  email: string | null;
  status: string;
  source: string;
  notes: string | null;
  convertedStudentId: string | null;
  createdAt: string;
  updatedAt: string;
  className?: string | null;
  academicYearName?: string | null;
}

export interface AdmissionListResponse extends Paged<AdmissionRow> {
  byStatus: { status: string; count: number }[];
}

// ---------------------------------------------------------------- Phase 3: library

export interface LibraryBookRow {
  id: string;
  isbn: string | null;
  title: string;
  author: string;
  category: string;
  copies: number;
  available: number;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryIssueRow {
  id: string;
  bookId: string;
  studentId: string;
  issueDate: string;
  dueDate: string;
  returnDate: string | null;
  fineMinor: number;
  status: string;
  bookTitle?: string;
  studentName?: string;
  admissionNo?: string | null;
  overdue?: boolean;
}

export interface LibrarySummary {
  titles: number;
  copies: number;
  available: number;
  issued: number;
  overdue: number;
  finesMinor: number;
}

// ---------------------------------------------------------------- Phase 3: transport

export interface TransportRouteRow {
  id: string;
  name: string;
  vehicleNo: string;
  driverName: string;
  driverPhone: string;
  fareMinor: number;
  stops: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransportAssignmentRow {
  id: string;
  routeId: string;
  studentId: string;
  stop: string;
  createdAt: string;
  routeName?: string;
  vehicleNo?: string | null;
  studentName?: string;
  admissionNo?: string | null;
}

export interface TransportSummary {
  routes: number;
  activeRoutes: number;
  assignments: number;
  monthlyFareMinor: number;
}

// ---------------------------------------------------------------- Phase 3: hostel

export interface HostelRoomRow {
  id: string;
  hostelId: string;
  roomNo: string;
  capacity: number;
  occupied: number;
  rentMinor: number;
}

export interface HostelRow {
  id: string;
  name: string;
  type: string;
  capacity: number;
  wardenId: string | null;
  createdAt: string;
  rooms?: HostelRoomRow[];
  roomCount?: number;
  beds?: number;
  occupied?: number;
}

export interface HostelAllocationRow {
  id: string;
  hostelId: string;
  roomId: string;
  studentId: string;
  startDate: string;
  endDate: string | null;
  status: string;
  studentName?: string;
  admissionNo?: string | null;
  hostelName?: string | null;
  roomNo?: string | null;
  rentMinor?: number;
}

export interface HostelSummary {
  hostels: number;
  rooms: number;
  beds: number;
  occupied: number;
  allocations: number;
}

// ---------------------------------------------------------------- Phase 3: inventory

export interface InventoryItemRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  reorderLevel: number;
  unitPriceMinor: number;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransactionRow {
  id: string;
  itemId: string;
  type: string;
  quantity: number;
  reference: string | null;
  notes: string | null;
  createdAt: string;
}

export interface InventorySummary {
  items: number;
  lowStock: number;
  units: number;
  valueMinor: number;
  lowStockItems: InventoryItemRow[];
}

// ---------------------------------------------------------------- Phase 3: homework

export interface HomeworkRow {
  id: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  title: string;
  description: string;
  dueDate: string;
  attachmentKey: string | null;
  createdByUserId: string | null;
  createdAt: string;
  className?: string;
  sectionName?: string;
  subjectName?: string;
}

// ---------------------------------------------------------------- Phase 4: messaging

export interface MessageParticipant {
  id: string;
  fullName: string;
  email: string | null;
  roleCode: string | null;
  roleName?: string;
}

export interface MessageRow {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  readBy: string[];
  createdAt: string;
  senderName?: string;
}

export interface MessageThreadRow {
  id: string;
  subject: string;
  participantIds: string[];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: MessageRow | null;
  participants?: MessageParticipant[];
}

export interface MessageThreadDetail extends MessageThreadRow {
  messages: MessageRow[];
}

// ---------------------------------------------------------------- Phase 5: analytics

export interface ReportOverview {
  students: number;
  studentGrowthPercent: number;
  staff: number;
  collectedThisMonthMinor: number;
  collectionChangePercent: number;
  outstandingMinor: number;
  attendanceRate: number;
  pendingAdmissions: number;
  aging: { label: string; amountMinor: number; count: number }[];
}

export interface ReportEnrollment {
  students: number;
  classes: number;
  sections: number;
  byStatus: { key: string; count: number }[];
  byGender: { key: string; count: number }[];
  byClassSection: {
    classId: string;
    className: string;
    sectionId: string;
    sectionName: string;
    students: number;
  }[];
}

export interface ReportAttendance {
  from: string;
  to: string;
  total: number;
  present: number;
  rate: number;
  byStatus: { key: string; count: number }[];
  daily: { date: string; total: number; present: number; rate: number }[];
}

export interface ReportFees {
  from: string;
  to: string;
  collectedMinor: number;
  billedMinor: number;
  outstandingMinor: number;
  expensesMinor: number;
  series: { period: string; value: number }[];
  aging: { label: string; amountMinor: number; count: number }[];
  methods: { key: string; count: number }[];
}

export interface ReportModules {
  libraryBooks: number;
  libraryIssued: number;
  transportRoutes: number;
  hostelBeds: number;
  hostelOccupied: number;
  inventoryItems: number;
  messageThreads: number;
}

export interface ReportPayroll {
  runs: PayrollRunRow[];
  latest: {
    run: PayrollRunRow;
    grossMinor: number;
    deductionsMinor: number;
    netMinor: number;
  } | null;
}

// ---------------------------------------------------------------- Phase 6: settings

export interface SchoolSettings {
  id: string;
  name: string;
  slug: string;
  status: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  logoKey: string | null;
  plan?: { code: string; name: string; limits: unknown; interval: string; priceMinor: number } | null;
  subscription?: {
    id: string;
    status: string;
    currentPeriodEnd: string | null;
  } | null;
  settings: {
    id: string;
    legalName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    locale: string;
    currency: string;
    timezone: string;
    calendarSystem: string;
    academicYearStartMonth: number;
    academicYearStartDay: number;
    workingDays: unknown;
    periodsPerDay: number;
    periodMinutes: number;
    branding: unknown;
    attendance: unknown;
    fees: unknown;
    enableParentPortal: boolean;
  } | null;
  grading: {
    name: string;
    bands: { grade: string; minPercent: number; maxPercent: number; gpa: number; remark?: string }[];
  } | null;
}

export interface AcademicYearRow {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  isLocked: boolean;
}

