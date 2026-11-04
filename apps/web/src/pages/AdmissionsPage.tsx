import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Badge,
  Button,
  EmptyState,
  FieldError,
  Input,
  Label,
  PageHeader,
  Select,
  StatCard,
  Table,
  TableWrap,
  Td,
  Textarea,
  Th,
  statusTone,
} from '@schoolerp/ui';
import { api, ApiError, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import type { AdmissionListResponse, AdmissionRow, SchoolClass } from '../lib/types';
import { ErrorPanel, Pagination, StatGrid, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

const STATUSES = [
  'INQUIRY',
  'APPLIED',
  'DOCUMENTS_PENDING',
  'APPROVED',
  'REJECTED',
  'ADMITTED',
  'WITHDRAWN',
] as const;

const applicationSchema = z.object({
  studentName: z.string().trim().min(2, 'Student name is required').max(120),
  guardianName: z.string().trim().min(2, 'Guardian name is required').max(120),
  phone: z.string().trim().min(7, 'Phone is required').max(24),
  email: z.string().email('Enter a valid email').or(z.literal('')).optional(),
  classId: z.string().optional(),
  source: z.enum(['WALK_IN', 'PHONE', 'ONLINE', 'REFERRAL', 'SOCIAL']),
  status: z.enum(STATUSES),
  notes: z.string().trim().max(2000).optional(),
});

type ApplicationForm = z.infer<typeof applicationSchema>;

const convertSchema = z.object({
  classId: z.string().min(1, 'Select a class'),
  sectionId: z.string().min(1, 'Select a section'),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  admissionNo: z.string().trim().max(32).optional(),
  dateOfBirth: z.string().optional(),
  rollNo: z.string().trim().max(20).optional(),
});

type ConvertForm = z.infer<typeof convertSchema>;

export function AdmissionsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<AdmissionRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [letterError, setLetterError] = useState<string | null>(null);

  const classesQuery = useQuery({
    queryKey: ['academics', 'classes'],
    queryFn: () => api.get<SchoolClass[]>('/academics/classes'),
  });

  const applicationsQuery = useQuery({
    queryKey: ['admissions', { page, status, search }],
    queryFn: () =>
      api.get<AdmissionListResponse>(
        `/admissions${queryString({
          page,
          pageSize: 25,
          status: status || undefined,
          q: search || undefined,
        })}`,
      ),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      api.patch<AdmissionRow>(`/admissions/${id}`, { status: next }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admissions'] }),
  });

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of applicationsQuery.data?.byStatus ?? []) map.set(row.status, row.count);
    return map;
  }, [applicationsQuery.data]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admissions'] });
    setSelectedIds([]);
  }

  const selectableIds = (applicationsQuery.data?.items ?? [])
    .filter((application) => !application.convertedStudentId)
    .map((application) => application.id);
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : selectableIds);
  }

  async function openOfferLetter(application: AdmissionRow) {
    setLetterError(null);
    try {
      await api.openDocument(
        `/admissions/${application.id}/offer-letter`,
        `offer-${application.id.slice(0, 8)}.html`,
      );
    } catch (caught) {
      setLetterError(
        caught instanceof ApiError ? caught.message : 'Could not open the offer letter',
      );
    }
  }

  return (
    <div>
      <PageHeader
        title="Admissions"
        description="Track enquiries from first contact through enrolment"
        actions={
          hasPermission('admissions:write') ? (
            <div className="flex flex-wrap gap-2">
              {selectedIds.length > 0 ? (
                <Button variant="outline" onClick={() => setBulkOpen(true)}>
                  Bulk admit ({selectedIds.length})
                </Button>
              ) : null}
              <Button onClick={() => setCreateOpen(true)}>New application</Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-6">
        <StatGrid>
          <StatCard label="Enquiries" value={counts.get('INQUIRY') ?? 0} />
          <StatCard label="Applied" value={counts.get('APPLIED') ?? 0} />
          <StatCard
            label="Documents pending"
            value={counts.get('DOCUMENTS_PENDING') ?? 0}
            tone="warning"
          />
          <StatCard label="Admitted" value={counts.get('ADMITTED') ?? 0} tone="positive" />
        </StatGrid>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search applicant, guardian or phone"
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="max-w-[210px]"
        >
          <option value="">All statuses</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {value.replace('_', ' ')}
            </option>
          ))}
        </Select>
      </div>

      {updateStatus.isError ? <ErrorPanel error={updateStatus.error} /> : null}
      {letterError ? (
        <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {letterError}
        </p>
      ) : null}
      {applicationsQuery.isLoading ? (
        <TableSkeleton columns={6} />
      ) : applicationsQuery.isError ? (
        <ErrorPanel error={applicationsQuery.error} onRetry={() => void applicationsQuery.refetch()} />
      ) : (applicationsQuery.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No applications"
          description="Record an enquiry or application to begin the admissions pipeline."
        />
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  {hasPermission('admissions:write') ? (
                    <Th className="w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all applications"
                        checked={allSelected}
                        disabled={selectableIds.length === 0}
                        onChange={toggleAll}
                      />
                    </Th>
                  ) : null}
                  <Th>Applicant</Th>
                  <Th>Guardian</Th>
                  <Th>Class</Th>
                  <Th>Source</Th>
                  <Th>Applied</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {applicationsQuery.data?.items.map((application) => (
                  <tr key={application.id}>
                    {hasPermission('admissions:write') ? (
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${application.studentName}`}
                          checked={selectedIds.includes(application.id)}
                          disabled={Boolean(application.convertedStudentId)}
                          onChange={() => toggleSelected(application.id)}
                        />
                      </Td>
                    ) : null}
                    <Td>
                      <p className="font-medium text-slate-900">{application.studentName}</p>
                      <p className="text-xs text-slate-500">{application.phone}</p>
                    </Td>
                    <Td>
                      <p className="text-sm text-slate-700">{application.guardianName}</p>
                      <p className="text-xs text-slate-500">{application.email ?? '—'}</p>
                    </Td>
                    <Td>{application.className ?? '—'}</Td>
                    <Td>{application.source.replace('_', ' ')}</Td>
                    <Td>{formatDate(application.createdAt)}</Td>
                    <Td>
                      <Badge tone={statusTone(application.status)}>
                        {application.status.replace('_', ' ')}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => void openOfferLetter(application)}>
                          Offer letter
                        </Button>
                        {hasPermission('admissions:write') ? (
                          <>
                            <Select
                              value={application.status}
                              onChange={(event) =>
                                updateStatus.mutate({ id: application.id, next: event.target.value })
                              }
                              className="h-8 max-w-[160px] text-xs"
                            >
                              {STATUSES.map((value) => (
                                <option key={value} value={value}>
                                  {value.replace('_', ' ')}
                                </option>
                              ))}
                            </Select>
                            {!application.convertedStudentId ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConvertTarget(application)}
                              >
                                Admit
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination
            page={applicationsQuery.data?.page ?? 1}
            pageSize={applicationsQuery.data?.pageSize ?? 25}
            total={applicationsQuery.data?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}

      <ApplicationModal
        open={createOpen}
        classes={classesQuery.data ?? []}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          invalidate();
        }}
      />

      <ConvertModal
        application={convertTarget}
        classes={classesQuery.data ?? []}
        onClose={() => setConvertTarget(null)}
        onSaved={() => {
          setConvertTarget(null);
          invalidate();
        }}
      />

      <BulkAdmitModal
        open={bulkOpen}
        ids={selectedIds}
        classes={classesQuery.data ?? []}
        onClose={() => setBulkOpen(false)}
        onSaved={() => {
          setBulkOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}

function ApplicationModal({
  open,
  classes,
  onClose,
  onSaved,
}: {
  open: boolean;
  classes: SchoolClass[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ApplicationForm>({
    resolver: zodResolver(applicationSchema),
    defaultValues: {
      studentName: '',
      guardianName: '',
      phone: '',
      email: '',
      classId: '',
      source: 'WALK_IN',
      status: 'INQUIRY',
      notes: '',
    },
  });

  const create = useMutation({
    mutationFn: (values: ApplicationForm) =>
      api.post<AdmissionRow>('/admissions', {
        ...values,
        email: values.email || undefined,
        classId: values.classId || undefined,
        notes: values.notes || undefined,
      }),
    onSuccess: () => {
      reset();
      onSaved();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New admission application"
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="admission-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save application'}
          </Button>
        </>
      }
    >
      <form
        id="admission-form"
        className="space-y-4"
        onSubmit={handleSubmit((values) => create.mutate(values))}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="admission-student">Student name</Label>
            <Input id="admission-student" {...register('studentName')} />
            <FieldError>{errors.studentName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="admission-guardian">Guardian name</Label>
            <Input id="admission-guardian" {...register('guardianName')} />
            <FieldError>{errors.guardianName?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="admission-phone">Phone</Label>
            <Input id="admission-phone" {...register('phone')} />
            <FieldError>{errors.phone?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="admission-email">Email</Label>
            <Input id="admission-email" type="email" {...register('email')} />
            <FieldError>{errors.email?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="admission-class">Applying for class</Label>
            <Select id="admission-class" {...register('classId')}>
              <option value="">Not sure yet</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="admission-source">Source</Label>
            <Select id="admission-source" {...register('source')}>
              <option value="WALK_IN">Walk in</option>
              <option value="PHONE">Phone</option>
              <option value="ONLINE">Online</option>
              <option value="REFERRAL">Referral</option>
              <option value="SOCIAL">Social media</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="admission-status">Status</Label>
            <Select id="admission-status" {...register('status')}>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="admission-notes">Notes</Label>
          <Textarea id="admission-notes" {...register('notes')} />
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not save application'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function ConvertModal({
  application,
  classes,
  onClose,
  onSaved,
}: {
  application: AdmissionRow | null;
  classes: SchoolClass[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ConvertForm>({
    resolver: zodResolver(convertSchema),
    defaultValues: {
      classId: '',
      sectionId: '',
      gender: 'MALE',
      admissionNo: '',
      dateOfBirth: '',
      rollNo: '',
    },
  });

  const classId = watch('classId');
  const sections = classes.find((klass) => klass.id === classId)?.sections ?? [];

  const convert = useMutation({
    mutationFn: (values: ConvertForm) =>
      api.post<{ studentId: string; admissionNo: string }>(`/admissions/${application?.id}/convert`, {
        classId: values.classId,
        sectionId: values.sectionId,
        gender: values.gender,
        admissionNo: values.admissionNo || undefined,
        dateOfBirth: values.dateOfBirth || undefined,
        rollNo: values.rollNo || undefined,
      }),
    onSuccess: () => {
      reset();
      onSaved();
    },
  });

  return (
    <Modal
      open={Boolean(application)}
      onClose={onClose}
      title="Admit student"
      description={application ? `Convert ${application.studentName} into an enrolled student.` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="convert-form" disabled={isSubmitting || convert.isPending}>
            {convert.isPending ? 'Admitting…' : 'Admit student'}
          </Button>
        </>
      }
    >
      <form id="convert-form" className="space-y-4" onSubmit={handleSubmit((values) => convert.mutate(values))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="convert-class">Class</Label>
            <Select id="convert-class" {...register('classId')}>
              <option value="">Select class</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
            <FieldError>{errors.classId?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="convert-section">Section</Label>
            <Select id="convert-section" {...register('sectionId')}>
              <option value="">Select section</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
            <FieldError>{errors.sectionId?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="convert-gender">Gender</Label>
            <Select id="convert-gender" {...register('gender')}>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="convert-admission-no">Admission no (optional)</Label>
            <Input id="convert-admission-no" {...register('admissionNo')} />
          </div>
          <div>
            <Label htmlFor="convert-dob">Date of birth</Label>
            <Input id="convert-dob" type="date" {...register('dateOfBirth')} />
          </div>
          <div>
            <Label htmlFor="convert-roll">Roll no</Label>
            <Input id="convert-roll" {...register('rollNo')} />
          </div>
        </div>
        {convert.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {convert.error instanceof Error ? convert.error.message : 'Could not admit student'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

interface BulkAdmitResult {
  admitted: number;
  skipped: number;
  skippedIds: string[];
  className: string;
  sectionName: string;
  students: { id: string; admissionNo: string; name: string }[];
}

function BulkAdmitModal({
  open,
  ids,
  classes,
  onClose,
  onSaved,
}: {
  open: boolean;
  ids: string[];
  classes: SchoolClass[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('OTHER');
  const [rollNoStart, setRollNoStart] = useState('');
  const [result, setResult] = useState<BulkAdmitResult | null>(null);

  const sections = classes.find((klass) => klass.id === classId)?.sections ?? [];

  const convert = useMutation({
    mutationFn: () =>
      api.post<BulkAdmitResult>('/admissions/bulk-convert', {
        ids,
        classId,
        sectionId,
        gender,
        ...(rollNoStart ? { rollNoStart: Number(rollNoStart) } : {}),
      }),
    onSuccess: (data) => {
      setResult(data);
      onSaved();
    },
  });

  function close() {
    setClassId('');
    setSectionId('');
    setGender('OTHER');
    setRollNoStart('');
    setResult(null);
    convert.reset();
    onClose();
  }

  const ready = classId !== '' && sectionId !== '' && ids.length > 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Admit ${ids.length} application${ids.length === 1 ? '' : 's'}`}
      description="Every selected applicant is enrolled into the same class and section in one transaction."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={close} type="button">
            Close
          </Button>
          <Button
            loading={convert.isPending}
            disabled={!ready}
            onClick={() => convert.mutate()}
          >
            Admit {ids.length} student{ids.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="form-grid">
          <div>
            <Label htmlFor="bulk-class">Class</Label>
            <Select
              id="bulk-class"
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setSectionId('');
              }}
            >
              <option value="">Select class</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="bulk-section">Section</Label>
            <Select
              id="bulk-section"
              value={sectionId}
              disabled={!classId}
              onChange={(event) => setSectionId(event.target.value)}
            >
              <option value="">Select section</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="bulk-gender">Gender</Label>
            <Select
              id="bulk-gender"
              value={gender}
              onChange={(event) => setGender(event.target.value as typeof gender)}
            >
              <option value="OTHER">Prefer not to say</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="bulk-roll">First roll number (optional)</Label>
            <Input
              id="bulk-roll"
              type="number"
              min={1}
              value={rollNoStart}
              onChange={(event) => setRollNoStart(event.target.value)}
              placeholder="Leave blank to skip roll numbers"
            />
          </div>
        </div>

        {convert.isError ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {convert.error instanceof Error ? convert.error.message : 'Could not admit the applications'}
          </p>
        ) : null}

        {result ? (
          <div className="space-y-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <p>
              Admitted {result.admitted} student{result.admitted === 1 ? '' : 's'} into{' '}
              {result.className} · {result.sectionName}.
              {result.skipped > 0 ? ` ${result.skipped} skipped (already admitted).` : ''}
            </p>
            {result.students.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {result.students.map((student) => (
                  <li key={student.id}>
                    {student.name} · <span className="font-mono">{student.admissionNo}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
