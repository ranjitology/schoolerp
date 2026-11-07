import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FieldError,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
  Textarea,
  statusTone,
} from '@schoolerp/ui';
import { api, ApiError, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  getCachedClasses,
  getCachedStudents,
  paginateCachedStudents,
  withOfflineFallback,
} from '../lib/offline';
import type { Paged, SchoolClass, StudentRow } from '../lib/types';
import { Pagination, TableSkeleton, ErrorPanel } from '../components/Feedback';
import { Modal } from '../components/Modal';

const studentFormSchema = z.object({
  admissionNo: z.string().trim().min(1, 'Admission number is required').max(32),
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().max(60).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dateOfBirth: z.string().optional(),
  classId: z.string().min(1, 'Select a class'),
  sectionId: z.string().min(1, 'Select a section'),
  rollNo: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(24).optional(),
  guardianName: z.string().trim().max(120).optional(),
  guardianPhone: z.string().trim().max(24).optional(),
  guardianRelation: z.enum(['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER']),
});

type StudentForm = z.infer<typeof studentFormSchema>;

const EMPTY_FORM: StudentForm = {
  admissionNo: '',
  firstName: '',
  lastName: '',
  gender: 'MALE',
  dateOfBirth: '',
  classId: '',
  sectionId: '',
  rollNo: '',
  phone: '',
  guardianName: '',
  guardianPhone: '',
  guardianRelation: 'GUARDIAN',
};

export function StudentsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);

  const classesQuery = useQuery({
    queryKey: ['academics', 'classes'],
    queryFn: () =>
      withOfflineFallback(
        () => api.get<SchoolClass[]>('/academics/classes'),
        getCachedClasses,
      ),
  });
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);

  const sections = useMemo(
    () => classes.find((klass) => klass.id === classId)?.sections ?? [],
    [classes, classId],
  );

  const studentsQuery = useQuery({
    queryKey: ['students', { page, search, classId, sectionId, status }],
    queryFn: () =>
      withOfflineFallback(
        () =>
          api.get<Paged<StudentRow>>(
            `/students${queryString({
              page,
              pageSize: 25,
              q: search || undefined,
              classId: classId || undefined,
              sectionId: sectionId || undefined,
              status: status || undefined,
              sort: 'firstName',
              order: 'asc',
            })}`,
          ),
        async () =>
          paginateCachedStudents(
            await getCachedStudents({
              classId: classId || undefined,
              sectionId: sectionId || undefined,
              status: status || undefined,
              search: search || undefined,
              limit: 5000,
            }),
            { page, pageSize: 25, search },
          ),
      ),
  });

  function resetFilters() {
    setSearch('');
    setClassId('');
    setSectionId('');
    setStatus('');
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="Students"
        description="Admissions, guardians and class placement"
        actions={
          <>
            {hasPermission('students:export') ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void api.download(
                    `/students/export.csv${queryString({
                      classId: classId || undefined,
                      sectionId: sectionId || undefined,
                    })}`,
                    'students.csv',
                  )
                }
              >
                Export CSV
              </Button>
            ) : null}
            {hasPermission('students:import') ? (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                Import CSV
              </Button>
            ) : null}
            {hasPermission('students:write') ? (
              <Button variant="outline" size="sm" onClick={() => setPromoteOpen(true)}>
                Promote class
              </Button>
            ) : null}
            {hasPermission('students:write') ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                Add student
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Label htmlFor="student-search">Search</Label>
            <Input
              id="student-search"
              type="search"
              placeholder="Name, admission number or phone"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <Label htmlFor="student-class">Class</Label>
            <Select
              id="student-class"
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setSectionId('');
                setPage(1);
              }}
            >
              <option value="">All classes</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="student-section">Section</Label>
            <Select
              id="student-section"
              value={sectionId}
              onChange={(event) => {
                setSectionId(event.target.value);
                setPage(1);
              }}
              disabled={!classId}
            >
              <option value="">All sections</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="student-status">Status</Label>
            <Select
              id="student-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="TRANSFERRED">Transferred</option>
              <option value="GRADUATED">Graduated</option>
              <option value="WITHDRAWN">Withdrawn</option>
              <option value="SUSPENDED">Suspended</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {studentsQuery.isLoading ? (
        <TableSkeleton />
      ) : studentsQuery.isError ? (
        <ErrorPanel error={studentsQuery.error} onRetry={() => void studentsQuery.refetch()} />
      ) : (studentsQuery.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No students match these filters"
          description="Adjust the search or add a student to get started."
          action={
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Admission</Th>
                  <Th>Class</Th>
                  <Th>Guardian</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {studentsQuery.data?.items.map((student) => (
                  <tr key={student.id} className="hover:bg-slate-50">
                    <Td>
                      <Link to={`/students/${student.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {student.fullName ?? `${student.firstName} ${student.lastName}`.trim()}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {student.rollNo ? `Roll ${student.rollNo}` : 'No roll number'}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs text-slate-700">{student.admissionNo}</Td>
                    <Td>
                      <span className="block text-sm text-slate-800">{student.className ?? '—'}</span>
                      <span className="block text-xs text-slate-500">{student.sectionName ?? ''}</span>
                    </Td>
                    <Td>
                      <span className="block text-sm text-slate-800">{student.guardian?.fullName ?? '—'}</span>
                      <span className="block text-xs text-slate-500">{student.guardian?.phone ?? ''}</span>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(student.status)}>{student.status}</Badge>
                    </Td>
                    <Td className="text-right">
                      <Link to={`/students/${student.id}`}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination
            page={studentsQuery.data?.page ?? page}
            pageSize={studentsQuery.data?.pageSize ?? 25}
            total={studentsQuery.data?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}

      <CreateStudentModal
        open={createOpen}
        classes={classes}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['students'] });
        }}
      />
      <ImportStudentsModal open={importOpen} onClose={() => setImportOpen(false)} />
      <PromoteStudentsModal
        open={promoteOpen}
        classes={classes}
        onClose={() => setPromoteOpen(false)}
        onPromoted={() => {
          setPromoteOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['students'] });
        }}
      />
    </div>
  );
}

interface PromotionPreview {
  preview: boolean;
  promoteCount?: number;
  promoted?: number;
  from: { classId: string; sectionId: string | null };
  to: { classId: string; sectionId: string; className: string; sectionName: string };
  students: {
    id: string;
    admissionNo: string;
    name: string;
    rollNo: string | null;
  }[];
}

function PromoteStudentsModal({
  open,
  classes,
  onClose,
  onPromoted,
}: {
  open: boolean;
  classes: SchoolClass[];
  onClose: () => void;
  onPromoted: () => void;
}) {
  const [fromClassId, setFromClassId] = useState('');
  const [fromSectionId, setFromSectionId] = useState('');
  const [toClassId, setToClassId] = useState('');
  const [toSectionId, setToSectionId] = useState('');
  const [rollNoStrategy, setRollNoStrategy] = useState<'KEEP' | 'SEQUENTIAL'>('SEQUENTIAL');
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fromSections = classes.find((klass) => klass.id === fromClassId)?.sections ?? [];
  const toSections = classes.find((klass) => klass.id === toClassId)?.sections ?? [];

  function reset() {
    setFromClassId('');
    setFromSectionId('');
    setToClassId('');
    setToSectionId('');
    setRollNoStrategy('SEQUENTIAL');
    setPreview(null);
    setError(null);
  }

  async function run(commit: boolean) {
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<PromotionPreview>('/students/promote', {
        fromClassId,
        ...(fromSectionId ? { fromSectionId } : {}),
        toClassId,
        toSectionId,
        rollNoStrategy,
        preview: !commit,
      });
      setPreview(result);
      if (commit) {
        onPromoted();
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Promotion failed');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    reset();
    onClose();
  }

  const ready = Boolean(fromClassId && toClassId && toSectionId);

  return (
    <Modal
      open={open}
      title="Promote a class"
      description="Preview the roster, then move everyone into the next class and section in one transaction."
      onClose={close}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Button
            variant="outline"
            loading={busy}
            disabled={!ready}
            onClick={() => void run(false)}
          >
            Preview
          </Button>
          <Button
            loading={busy}
            disabled={!preview || preview.preview === false}
            onClick={() => void run(true)}
          >
            Promote {preview?.promoteCount ? `${preview.promoteCount} students` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="form-grid">
          <div>
            <Label htmlFor="promote-from-class">From class</Label>
            <Select
              id="promote-from-class"
              value={fromClassId}
              onChange={(event) => {
                setFromClassId(event.target.value);
                setFromSectionId('');
                setPreview(null);
              }}
            >
              <option value="">Select a class</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="promote-from-section">From section (optional)</Label>
            <Select
              id="promote-from-section"
              value={fromSectionId}
              disabled={!fromClassId}
              onChange={(event) => {
                setFromSectionId(event.target.value);
                setPreview(null);
              }}
            >
              <option value="">All sections</option>
              {fromSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="promote-to-class">To class</Label>
            <Select
              id="promote-to-class"
              value={toClassId}
              onChange={(event) => {
                setToClassId(event.target.value);
                setToSectionId('');
                setPreview(null);
              }}
            >
              <option value="">Select a class</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="promote-to-section">To section</Label>
            <Select
              id="promote-to-section"
              value={toSectionId}
              disabled={!toClassId}
              onChange={(event) => {
                setToSectionId(event.target.value);
                setPreview(null);
              }}
            >
              <option value="">Select a section</option>
              {toSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="promote-roll">Roll numbers</Label>
            <Select
              id="promote-roll"
              value={rollNoStrategy}
              onChange={(event) => setRollNoStrategy(event.target.value as 'KEEP' | 'SEQUENTIAL')}
            >
              <option value="SEQUENTIAL">Assign sequentially</option>
              <option value="KEEP">Keep existing</option>
            </Select>
          </div>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {preview ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {preview.preview
                  ? `${preview.promoteCount ?? preview.students.length} students ready`
                  : `${preview.promoted ?? preview.students.length} students promoted`}{' '}
                → {preview.to.className} · {preview.to.sectionName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {preview.students.length === 0 ? (
                <p className="text-sm text-slate-500">No students matched this class and section.</p>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Student</Th>
                        <Th>Admission</Th>
                        <Th>Roll</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.students.slice(0, 100).map((student) => (
                        <tr key={student.id}>
                          <Td>{student.name}</Td>
                          <Td className="font-mono text-xs">{student.admissionNo}</Td>
                          <Td>{student.rollNo ?? '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </Modal>
  );
}

function CreateStudentModal({
  open,
  classes,
  onClose,
  onCreated,
}: {
  open: boolean;
  classes: SchoolClass[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<StudentForm>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: EMPTY_FORM,
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const selectedClass = watch('classId');
  const sections = classes.find((klass) => klass.id === selectedClass)?.sections ?? [];

  async function onSubmit(values: StudentForm) {
    setServerError(null);
    try {
      await api.post('/students', {
        admissionNo: values.admissionNo,
        firstName: values.firstName,
        lastName: values.lastName ?? '',
        gender: values.gender,
        ...(values.dateOfBirth ? { dateOfBirth: values.dateOfBirth } : {}),
        classId: values.classId,
        sectionId: values.sectionId,
        ...(values.rollNo ? { rollNo: values.rollNo } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.guardianName && values.guardianPhone
          ? {
              guardian: {
                relation: values.guardianRelation,
                fullName: values.guardianName,
                phone: values.guardianPhone,
                isPrimary: true,
              },
            }
          : {}),
      });
      reset(EMPTY_FORM);
      onCreated();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Could not save the student');
    }
  }

  return (
    <Modal
      open={open}
      title="Add a student"
      description="Creates the student record and, optionally, a primary guardian."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-student-form" loading={isSubmitting}>
            Save student
          </Button>
        </>
      }
    >
      <form id="create-student-form" className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="form-grid">
          <div>
            <Label htmlFor="admissionNo">Admission number</Label>
            <Input id="admissionNo" aria-invalid={Boolean(errors.admissionNo)} {...register('admissionNo')} />
            <FieldError>{errors.admissionNo?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="rollNo">Roll number</Label>
            <Input id="rollNo" {...register('rollNo')} />
          </div>
          <div>
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" aria-invalid={Boolean(errors.firstName)} {...register('firstName')} />
            <FieldError>{errors.firstName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" {...register('lastName')} />
          </div>
          <div>
            <Label htmlFor="gender">Gender</Label>
            <Select id="gender" {...register('gender')}>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="dateOfBirth">Date of birth</Label>
            <Input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
          </div>
          <div>
            <Label htmlFor="classId">Class</Label>
            <Select
              id="classId"
              aria-invalid={Boolean(errors.classId)}
              {...register('classId', {
                onChange: () => setValue('sectionId', ''),
              })}
            >
              <option value="">Select a class</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
            <FieldError>{errors.classId?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="sectionId">Section</Label>
            <Select id="sectionId" aria-invalid={Boolean(errors.sectionId)} {...register('sectionId')} disabled={!selectedClass}>
              <option value="">Select a section</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
            <FieldError>{errors.sectionId?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="phone">Student phone</Label>
            <Input id="phone" inputMode="tel" {...register('phone')} />
          </div>
        </div>

        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Primary guardian (optional)</legend>
          <div className="form-grid">
            <div>
              <Label htmlFor="guardianName">Full name</Label>
              <Input id="guardianName" {...register('guardianName')} />
            </div>
            <div>
              <Label htmlFor="guardianPhone">Phone</Label>
              <Input id="guardianPhone" inputMode="tel" {...register('guardianPhone')} />
            </div>
            <div>
              <Label htmlFor="guardianRelation">Relation</Label>
              <Select id="guardianRelation" {...register('guardianRelation')}>
                <option value="FATHER">Father</option>
                <option value="MOTHER">Mother</option>
                <option value="GUARDIAN">Guardian</option>
                <option value="OTHER">Other</option>
              </Select>
            </div>
          </div>
        </fieldset>

        {serverError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {serverError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

interface ImportPreview {
  mode: 'PREVIEW' | 'COMMIT';
  totalRows: number;
  validRows: number;
  errors: { row: number; field: string; message: string }[];
  preview: unknown[];
  created?: number;
  skipped?: number;
}

function ImportStudentsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [csv, setCsv] = useState('');
  const [defaultSection, setDefaultSection] = useState('A');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(mode: 'PREVIEW' | 'COMMIT') {
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<ImportPreview>('/students/import', {
        csv,
        mode,
        defaultSection,
      });
      setPreview(result);
      if (mode === 'COMMIT') {
        void queryClient.invalidateQueries({ queryKey: ['students'] });
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setPreview(null);
    setError(null);
    setCsv('');
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Import students from CSV"
      description="Preview validates every row before anything is written."
      onClose={close}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Button variant="outline" loading={busy} onClick={() => void run('PREVIEW')} disabled={!csv.trim()}>
            Preview
          </Button>
          <Button
            loading={busy}
            onClick={() => void run('COMMIT')}
            disabled={!preview || preview.validRows === 0}
          >
            Import {preview ? `${preview.validRows} students` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="csv">CSV contents</Label>
          <Textarea
            id="csv"
            rows={8}
            value={csv}
            onChange={(event) => {
              setCsv(event.target.value);
              setPreview(null);
            }}
            placeholder={'admissionNo,firstName,lastName,gender,className,sectionName,rollNo,dateOfBirth,phone,guardianName,guardianPhone'}
            className="font-mono text-xs"
          />
          <p className="mt-1 text-xs text-slate-500">
            Required headers: admissionNo, firstName, gender, className. Section defaults to the
            value below when omitted.
          </p>
        </div>
        <div className="sm:w-48">
          <Label htmlFor="defaultSection">Default section</Label>
          <Input
            id="defaultSection"
            value={defaultSection}
            onChange={(event) => setDefaultSection(event.target.value)}
            maxLength={4}
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {preview ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {preview.mode === 'COMMIT' ? 'Import complete' : 'Preview'} · {preview.validRows} valid
                of {preview.totalRows} rows
              </CardTitle>
            </CardHeader>
            <CardContent>
              {preview.errors.length > 0 ? (
                <div className="max-h-52 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-1">Row</th>
                        <th className="py-1">Field</th>
                        <th className="py-1">Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.errors.slice(0, 50).map((issue, index) => (
                        <tr key={`${issue.row}-${issue.field}-${index}`} className="border-t border-slate-100">
                          <td className="py-1">{issue.row}</td>
                          <td className="py-1 font-mono">{issue.field}</td>
                          <td className="py-1 text-rose-700">{issue.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-emerald-700">No validation issues found.</p>
              )}
              {preview.mode === 'COMMIT' ? (
                <p className="mt-3 text-sm font-medium text-slate-800">
                  Created {preview.created ?? preview.validRows} students.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </Modal>
  );
}
