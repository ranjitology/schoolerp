import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
} from '@schoolerp/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import type {
  AcademicYearOption,
  ExamReportCards,
  ExamRow,
  ExamStatus,
  SchoolClass,
  SubjectRow,
} from '../lib/types';
import { ErrorPanel, TableSkeleton } from '../components/Feedback';

const EXAM_TYPES = [
  { value: 'UNIT_TEST', label: 'Unit test' },
  { value: 'MID_TERM', label: 'Mid-term' },
  { value: 'FINAL', label: 'Final' },
  { value: 'PRACTICAL', label: 'Practical' },
  { value: 'PROJECT', label: 'Project' },
  { value: 'INTERNAL', label: 'Internal' },
] as const;

const TABS = [
  { value: 'exams', label: 'Exams' },
  { value: 'marks', label: 'Marks entry' },
  { value: 'cards', label: 'Report cards' },
] as const;

type Tab = (typeof TABS)[number]['value'];

interface DraftSubject {
  classId: string;
  subjectId: string;
  maxMarks: string;
  passMarks: string;
}

const emptySubject = (classId = ''): DraftSubject => ({
  classId,
  subjectId: '',
  maxMarks: '100',
  passMarks: '33',
});

function examTone(status: ExamStatus): 'neutral' | 'info' | 'success' | 'warning' {
  switch (status) {
    case 'PUBLISHED':
      return 'success';
    case 'LOCKED':
      return 'neutral';
    case 'ONGOING':
      return 'warning';
    case 'COMPLETED':
      return 'info';
    default:
      return 'neutral';
  }
}

export function ExamsPage() {
  const { hasPermission, user } = useAuth();
  const queryClient = useQueryClient();
  const canRead = hasPermission('exams:read');
  const canWrite = hasPermission('exams:write');
  const canPublish = hasPermission('results:publish');

  const [tab, setTab] = useState<Tab>('exams');
  const [examId, setExamId] = useState('');
  const [classId, setClassId] = useState('');
  const [examSubjectId, setExamSubjectId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof EXAM_TYPES)[number]['value']>('MID_TERM');
  const [academicYearId, setAcademicYearId] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [subjectDrafts, setSubjectDrafts] = useState<DraftSubject[]>([emptySubject()]);

  const [markDraft, setMarkDraft] = useState<
    Record<string, { value: string; absent: boolean }>
  >({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const examsQuery = useQuery({
    queryKey: ['academics', 'exams'],
    queryFn: () => api.get<ExamRow[]>('/academics/exams'),
    enabled: canRead,
  });
  const yearsQuery = useQuery({
    queryKey: ['academics', 'years'],
    queryFn: () => api.get<AcademicYearOption[]>('/academics/years'),
    enabled: canRead,
  });
  const classesQuery = useQuery({
    queryKey: ['academics', 'classes'],
    queryFn: () => api.get<SchoolClass[]>('/academics/classes'),
    enabled: canRead,
  });
  const subjectsQuery = useQuery({
    queryKey: ['academics', 'subjects'],
    queryFn: () => api.get<SubjectRow[]>('/academics/subjects'),
    enabled: canRead,
  });

  const exams = useMemo(() => examsQuery.data ?? [], [examsQuery.data]);
  const years = useMemo(() => yearsQuery.data ?? [], [yearsQuery.data]);
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const subjects = useMemo(() => subjectsQuery.data ?? [], [subjectsQuery.data]);

  useEffect(() => {
    if (!examId && exams.length > 0) setExamId(exams[0]!.id);
  }, [examId, exams]);

  useEffect(() => {
    if (!academicYearId && years.length > 0) {
      const current = years.find((year) => year.isCurrent) ?? years[0];
      if (current) setAcademicYearId(current.id);
    }
  }, [academicYearId, years]);

  const examDetailQuery = useQuery({
    queryKey: ['academics', 'exam', examId],
    queryFn: () => api.get<ExamRow>(`/academics/exams/${examId}`),
    enabled: canRead && Boolean(examId),
  });

  const selectedExam =
    (examDetailQuery.data?.id === examId ? examDetailQuery.data : null) ??
    exams.find((exam) => exam.id === examId) ??
    null;
  const examSubjects = useMemo(() => selectedExam?.subjects ?? [], [selectedExam]);

  const examClasses = useMemo(() => {
    const seen = new Map<string, string>();
    for (const subject of examSubjects) {
      if (!seen.has(subject.classId)) {
        seen.set(subject.classId, subject.class?.name ?? classLabel(classes, subject.classId));
      }
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [classes, examSubjects]);

  const reportQuery = useQuery({
    queryKey: ['academics', 'report-cards', examId, classId],
    queryFn: () =>
      api.get<ExamReportCards>(
        `/academics/exams/${examId}/report-cards?classId=${encodeURIComponent(classId)}`,
      ),
    enabled: canRead && Boolean(examId && classId),
  });

  const cards = useMemo(() => reportQuery.data?.cards ?? [], [reportQuery.data]);

  const selectedSubject = useMemo(
    () =>
      examSubjects.find((subject) => subject.id === examSubjectId && subject.classId === classId) ??
      null,
    [classId, examSubjectId, examSubjects],
  );

  useEffect(() => {
    if (!selectedSubject) {
      setMarkDraft({});
      setDirty(new Set());
      return;
    }
    const next: Record<string, { value: string; absent: boolean }> = {};
    for (const card of cards) {
      const mark = card.subjects.find((subject) => subject.examSubjectId === selectedSubject.id);
      next[card.studentId] = {
        value: mark && !mark.isAbsent ? String(mark.marksObtained) : '',
        absent: Boolean(mark?.isAbsent),
      };
    }
    setMarkDraft(next);
    setDirty(new Set());
  }, [cards, selectedSubject]);

  useEffect(() => {
    if (examSubjects.length === 0) {
      setClassId('');
      setExamSubjectId('');
      return;
    }
    const stillValid = examSubjects.some((subject) => subject.classId === classId);
    if (!classId || !stillValid) {
      const firstClass = examSubjects[0]!.classId;
      setClassId(firstClass);
      setExamSubjectId('');
    }
  }, [classId, examSubjects]);

  useEffect(() => {
    const forClass = examSubjects.filter((subject) => subject.classId === classId);
    if (forClass.length === 0) {
      setExamSubjectId('');
      return;
    }
    if (!forClass.some((subject) => subject.id === examSubjectId)) {
      setExamSubjectId(forClass[0]!.id);
    }
  }, [classId, examId, examSubjects, examSubjectId]);

  const createExam = useMutation({
    mutationFn: () => {
      const validSubjects = subjectDrafts.filter(
        (subject) => subject.classId && subject.subjectId,
      );
      if (!name.trim() || !academicYearId || validSubjects.length === 0) {
        throw new Error('Add an exam name, academic year and at least one subject');
      }
      return api.post<ExamRow>('/academics/exams', {
        name: name.trim(),
        type,
        academicYearId,
        startsOn: startsOn || undefined,
        endsOn: endsOn || undefined,
        subjects: validSubjects.map((subject) => ({
          classId: subject.classId,
          subjectId: subject.subjectId,
          maxMarks: Number(subject.maxMarks) || 100,
          passMarks: Number(subject.passMarks) || 0,
        })),
      });
    },
    onSuccess: (exam) => {
      setMessage(`Exam “${exam.name}” created.`);
      setActionError(null);
      setName('');
      setStartsOn('');
      setEndsOn('');
      setSubjectDrafts([emptySubject()]);
      setExamId(exam.id);
      setClassId('');
      setExamSubjectId('');
      setTab('exams');
      void queryClient.invalidateQueries({ queryKey: ['academics', 'exams'] });
    },
    onError: (error) => {
      setMessage(null);
      setActionError(error instanceof Error ? error.message : 'Could not create the exam');
    },
  });

  const saveMarks = useMutation({
    mutationFn: () => {
      if (!selectedSubject) throw new Error('Choose a subject first');
      const records = [...dirty]
        .map((studentId) => {
          const entry = markDraft[studentId];
          if (!entry) return null;
          const marksObtained = Number(entry.value);
          if (!entry.absent && (entry.value === '' || Number.isNaN(marksObtained))) return null;
          return {
            studentId,
            marksObtained: entry.absent ? 0 : marksObtained,
            isAbsent: entry.absent,
          };
        })
        .filter((record): record is NonNullable<typeof record> => Boolean(record));
      if (records.length === 0) throw new Error('Enter at least one mark');
      return api.post<{ saved: number }>(
        `/academics/exams/subjects/${selectedSubject.id}/marks`,
        { records },
      );
    },
    onSuccess: (result) => {
      setMessage(`${result.saved} mark(s) saved.`);
      setActionError(null);
      setDirty(new Set());
      void queryClient.invalidateQueries({
        queryKey: ['academics', 'report-cards', examId, classId],
      });
      void queryClient.invalidateQueries({ queryKey: ['academics', 'exam', examId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => {
      setMessage(null);
      setActionError(error instanceof Error ? error.message : 'Could not save the marks');
    },
  });

  const publishResults = useMutation({
    mutationFn: () => api.post<{ alreadyPublished: boolean; publishedAt: string | null }>(
      `/academics/exams/${examId}/publish`,
    ),
    onSuccess: (result) => {
      setMessage(
        result.alreadyPublished
          ? 'These results were already published.'
          : 'Results published. Report cards are now visible to the portal.',
      );
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['academics', 'exams'] });
      void queryClient.invalidateQueries({ queryKey: ['academics', 'exam', examId] });
      void queryClient.invalidateQueries({ queryKey: ['academics', 'report-cards'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => {
      setMessage(null);
      setActionError(error instanceof Error ? error.message : 'Could not publish the results');
    },
  });

  const queueReportCards = useMutation({
    mutationFn: () =>
      api.post<{ id: string; status: string }>(`/academics/exams/${examId}/report-cards/job`, {
        classId,
      }),
    onSuccess: () => {
      setMessage('Report-card generation queued. Track the job under Settings → Jobs.');
      setActionError(null);
    },
    onError: (error) => {
      setMessage(null);
      setActionError(error instanceof Error ? error.message : 'Could not queue report cards');
    },
  });

  if (!canRead) {
    return (
      <EmptyState
        title="Exams access required"
        description="Ask a school administrator for the exams permission."
      />
    );
  }

  function chooseExam(id: string) {
    setExamId(id);
    setClassId('');
    setExamSubjectId('');
    setDirty(new Set());
    setMessage(null);
    setActionError(null);
  }

  function updateSubject(index: number, patch: Partial<DraftSubject>) {
    setSubjectDrafts((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function availableSubjects(classIdValue: string): SubjectRow[] {
    return subjects.filter(
      (subject) =>
        !subject.classSubjects ||
        subject.classSubjects.length === 0 ||
        subject.classSubjects.some((mapping) => mapping.classId === classIdValue),
    );
  }

  function updateMark(studentId: string, patch: { value?: string; absent?: boolean }) {
    setMarkDraft((current) => ({
      ...current,
      [studentId]: {
        value: current[studentId]?.value ?? '',
        absent: current[studentId]?.absent ?? false,
        ...patch,
      },
    }));
    setDirty((current) => new Set(current).add(studentId));
  }

  const published = selectedExam?.status === 'PUBLISHED' || selectedExam?.status === 'LOCKED';
  const marksForSubject = selectedSubject
    ? cards.map((card) => ({
        card,
        mark: card.subjects.find((subject) => subject.examSubjectId === selectedSubject.id),
      }))
    : [];

  return (
    <div className="space-y-6">
      <div className="no-print space-y-6">
        <PageHeader
          title="Exams & report cards"
          description="Create exams, enter marks, publish results and print report cards."
          actions={
            <div className="flex rounded-lg border border-slate-200 bg-white p-1">
              {TABS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTab(item.value)}
                  aria-pressed={tab === item.value}
                  className={
                    tab === item.value
                      ? 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
                      : 'rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50'
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          }
        />

        {message ? (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            {message}
          </p>
        ) : null}
        {actionError ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {actionError}
          </p>
        ) : null}

        {tab === 'exams' ? (
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Exam schedule</CardTitle>
                {selectedExam ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={examTone(selectedExam.status)}>{selectedExam.status}</Badge>
                    {canPublish && !published ? (
                      <Button
                        size="sm"
                        loading={publishResults.isPending}
                        onClick={() => publishResults.mutate()}
                      >
                        Publish results
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                {examsQuery.isLoading ? (
                  <TableSkeleton rows={4} columns={5} />
                ) : examsQuery.isError ? (
                  <ErrorPanel error={examsQuery.error} onRetry={() => void examsQuery.refetch()} />
                ) : exams.length === 0 ? (
                  <EmptyState
                    title="No exams yet"
                    description="Create the first exam to start entering marks."
                  />
                ) : (
                  <TableWrap>
                    <Table>
                      <thead>
                        <tr>
                          <Th>Exam</Th>
                          <Th>Type</Th>
                          <Th>Status</Th>
                          <Th>Subjects</Th>
                          <Th>Starts</Th>
                          <Th className="text-right">Actions</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {exams.map((exam) => (
                          <tr key={exam.id} className={exam.id === examId ? 'bg-brand-50/40' : undefined}>
                            <Td>
                              <p className="font-medium text-slate-900">{exam.name}</p>
                              <p className="text-xs text-slate-500">
                                {exam.academicYear?.name ?? exam.term?.name ?? 'Academic year'}
                              </p>
                            </Td>
                            <Td className="capitalize">{exam.type.toLowerCase().replaceAll('_', ' ')}</Td>
                            <Td>
                              <Badge tone={examTone(exam.status)}>{exam.status}</Badge>
                            </Td>
                            <Td>{exam._count?.subjects ?? exam.subjects?.length ?? '—'}</Td>
                            <Td>{formatDate(exam.startsOn)}</Td>
                            <Td className="text-right">
                              <Button
                                variant={exam.id === examId ? 'primary' : 'outline'}
                                size="sm"
                                onClick={() => {
                                  chooseExam(exam.id);
                                  setTab('marks');
                                }}
                              >
                                {exam.id === examId ? 'Selected' : 'Open marks'}
                              </Button>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableWrap>
                )}
              </CardContent>
            </Card>

            {canWrite ? (
              <Card>
                <CardHeader>
                  <CardTitle>Create exam</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createExam.mutate();
                    }}
                  >
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <Label htmlFor="exam-name">Name</Label>
                        <Input
                          id="exam-name"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          placeholder="Second terminal examination"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="exam-year">Academic year</Label>
                        <Select
                          id="exam-year"
                          value={academicYearId}
                          onChange={(event) => setAcademicYearId(event.target.value)}
                          required
                        >
                          <option value="">Select a year</option>
                          {years.map((year) => (
                            <option key={year.id} value={year.id}>
                              {year.name}
                              {year.isCurrent ? ' (current)' : ''}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="exam-type">Type</Label>
                        <Select
                          id="exam-type"
                          value={type}
                          onChange={(event) =>
                            setType(event.target.value as (typeof EXAM_TYPES)[number]['value'])
                          }
                        >
                          {EXAM_TYPES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="exam-starts">Starts on</Label>
                        <Input
                          id="exam-starts"
                          type="date"
                          value={startsOn}
                          onChange={(event) => setStartsOn(event.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="exam-ends">Ends on</Label>
                        <Input
                          id="exam-ends"
                          type="date"
                          value={endsOn}
                          onChange={(event) => setEndsOn(event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-800">Subjects</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setSubjectDrafts((current) => [
                              ...current,
                              emptySubject(current[current.length - 1]?.classId ?? ''),
                            ])
                          }
                        >
                          Add subject
                        </Button>
                      </div>
                      {subjectDrafts.map((row, index) => (
                        <div
                          key={index}
                          className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-5"
                        >
                          <div>
                            <Label htmlFor={`exam-subject-class-${index}`}>Class</Label>
                            <Select
                              id={`exam-subject-class-${index}`}
                              value={row.classId}
                              onChange={(event) =>
                                updateSubject(index, {
                                  classId: event.target.value,
                                  subjectId: '',
                                })
                              }
                              required
                            >
                              <option value="">Select</option>
                              {classes.map((klass) => (
                                <option key={klass.id} value={klass.id}>
                                  {klass.name}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`exam-subject-${index}`}>Subject</Label>
                            <Select
                              id={`exam-subject-${index}`}
                              value={row.subjectId}
                              onChange={(event) =>
                                updateSubject(index, { subjectId: event.target.value })
                              }
                              disabled={!row.classId}
                              required
                            >
                              <option value="">Select</option>
                              {availableSubjects(row.classId).map((subject) => (
                                <option key={subject.id} value={subject.id}>
                                  {subject.name} ({subject.code})
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor={`exam-subject-max-${index}`}>Max marks</Label>
                            <Input
                              id={`exam-subject-max-${index}`}
                              type="number"
                              min={1}
                              max={1000}
                              value={row.maxMarks}
                              onChange={(event) =>
                                updateSubject(index, { maxMarks: event.target.value })
                              }
                              required
                            />
                          </div>
                          <div>
                            <Label htmlFor={`exam-subject-pass-${index}`}>Pass marks</Label>
                            <Input
                              id={`exam-subject-pass-${index}`}
                              type="number"
                              min={0}
                              max={1000}
                              value={row.passMarks}
                              onChange={(event) =>
                                updateSubject(index, { passMarks: event.target.value })
                              }
                              required
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={subjectDrafts.length === 1}
                              onClick={() =>
                                setSubjectDrafts((current) =>
                                  current.filter((_item, rowIndex) => rowIndex !== index),
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end">
                      <Button type="submit" loading={createExam.isPending}>
                        Create exam
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label htmlFor="exam-picker">Exam</Label>
                  <Select
                    id="exam-picker"
                    value={examId}
                    onChange={(event) => chooseExam(event.target.value)}
                  >
                    <option value="">Select an exam</option>
                    {exams.map((exam) => (
                      <option key={exam.id} value={exam.id}>
                        {exam.name} · {exam.status}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="exam-class">Class</Label>
                  <Select
                    id="exam-class"
                    value={classId}
                    onChange={(event) => {
                      setClassId(event.target.value);
                      setExamSubjectId('');
                    }}
                    disabled={examClasses.length === 0}
                  >
                    <option value="">Select a class</option>
                    {examClasses.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </Select>
                </div>
                {tab === 'marks' ? (
                  <div>
                    <Label htmlFor="exam-subject-picker">Subject</Label>
                    <Select
                      id="exam-subject-picker"
                      value={examSubjectId}
                      onChange={(event) => setExamSubjectId(event.target.value)}
                      disabled={!classId}
                    >
                      <option value="">Select a subject</option>
                      {examSubjects
                        .filter((subject) => subject.classId === classId)
                        .map((subject) => (
                          <option key={subject.id} value={subject.id}>
                            {subject.subject?.name ?? subject.subjectId} · {Number(subject.maxMarks)} marks
                          </option>
                        ))}
                    </Select>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {!examId || !classId ? (
              <EmptyState
                title={tab === 'marks' ? 'Choose an exam and class' : 'Choose an exam and class'}
                description={
                  tab === 'marks'
                    ? 'Marks entry is scoped to one exam subject at a time.'
                    : 'Report cards are generated for one class at a time.'
                }
              />
            ) : reportQuery.isLoading ? (
              <TableSkeleton rows={8} columns={5} />
            ) : reportQuery.isError ? (
              <ErrorPanel error={reportQuery.error} onRetry={() => void reportQuery.refetch()} />
            ) : tab === 'marks' ? (
              <Card>
                <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Marks entry</CardTitle>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedSubject?.subject?.name ?? 'Select a subject'} ·{' '}
                      {cards.length} student(s)
                    </p>
                  </div>
                  {canWrite ? (
                    <Button
                      loading={saveMarks.isPending}
                      disabled={!selectedSubject || published || dirty.size === 0}
                      onClick={() => saveMarks.mutate()}
                    >
                      Save {dirty.size > 0 ? `${dirty.size} changed` : 'marks'}
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {published ? (
                    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      Results are published. Marks are read-only.
                    </p>
                  ) : null}
                  {!selectedSubject ? (
                    <EmptyState
                      title="Choose a subject"
                      description="Select a subject to load its mark sheet."
                    />
                  ) : cards.length === 0 ? (
                    <EmptyState
                      title="No students in this class"
                      description="Add students or choose another class."
                    />
                  ) : (
                    <TableWrap>
                      <Table>
                        <thead>
                          <tr>
                            <Th>Roll</Th>
                            <Th>Student</Th>
                            <Th>Admission no.</Th>
                            <Th className="text-right">
                              Marks / {Number(selectedSubject.maxMarks)}
                            </Th>
                            <Th>Absent</Th>
                            <Th>Grade</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {marksForSubject.map(({ card, mark }) => {
                            const entry = markDraft[card.studentId] ?? { value: '', absent: false };
                            return (
                              <tr key={card.studentId}>
                                <Td className="tabular-nums">{card.rollNo ?? '—'}</Td>
                                <Td className="font-medium text-slate-900">{card.name}</Td>
                                <Td>{card.admissionNo}</Td>
                                <Td className="text-right">
                                  <Input
                                    type="number"
                                    min={0}
                                    max={Number(selectedSubject.maxMarks)}
                                    step="0.01"
                                    value={entry.absent ? '' : entry.value}
                                    disabled={!canWrite || published || entry.absent}
                                    onChange={(event) =>
                                      updateMark(card.studentId, { value: event.target.value })
                                    }
                                    aria-label={`Marks for ${card.name}`}
                                    className="ml-auto w-28 text-right"
                                  />
                                </Td>
                                <Td>
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                                    checked={entry.absent}
                                    disabled={!canWrite || published}
                                    onChange={(event) =>
                                      updateMark(card.studentId, { absent: event.target.checked })
                                    }
                                    aria-label={`Mark ${card.name} absent`}
                                  />
                                </Td>
                                <Td>
                                  {mark ? (
                                    <Badge tone={mark.passed ? 'success' : 'warning'}>
                                      {mark.isAbsent ? 'ABSENT' : mark.grade}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-slate-400">Not entered</span>
                                  )}
                                </Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </TableWrap>
                  )}
                  {canPublish && !published ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-sm text-slate-600">
                        Publish after every subject has been entered to lock marks.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={publishResults.isPending}
                        onClick={() => publishResults.mutate()}
                      >
                        Publish results
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-600">
                    {cards.length} report card(s) ·{' '}
                    {cards.filter((card) => card.passed).length} passed
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {canPublish ? (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={queueReportCards.isPending}
                        onClick={() => queueReportCards.mutate()}
                      >
                        Queue PDF job
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.print()}
                      disabled={cards.length === 0}
                    >
                      Print
                    </Button>
                  </div>
                </div>

                {cards.length === 0 ? (
                  <EmptyState
                    title="No report cards"
                    description="Enter marks for this class, then refresh the report cards."
                  />
                ) : (
                  <div className="print-area space-y-4">
                    <div className="hidden print:block">
                      <h1 className="text-xl font-bold">{user?.schoolName ?? 'School'}</h1>
                      <p className="text-sm">
                        {reportQuery.data?.exam.name} · {examClassLabel(examClasses, classId)} ·{' '}
                        Generated {formatDate(new Date())}
                      </p>
                    </div>
                    {cards.map((card) => (
                      <Card key={card.studentId} className="print-page break-inside-avoid">
                        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <CardTitle>
                              {card.name}{' '}
                              <span className="text-sm font-normal text-slate-500">
                                ({card.admissionNo})
                              </span>
                            </CardTitle>
                            <p className="mt-1 text-sm text-slate-500">
                              Class {examClassLabel(examClasses, classId)} · Section{' '}
                              {card.sectionName} · Roll {card.rollNo ?? '—'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge tone={card.passed ? 'success' : 'warning'}>
                              {card.passed ? 'PASSED' : 'FAILED'}
                            </Badge>
                            <Badge tone="info">Rank {card.rank}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <TableWrap>
                            <Table>
                              <thead>
                                <tr>
                                  <Th>Subject</Th>
                                  <Th className="text-right">Marks</Th>
                                  <Th className="text-right">Max</Th>
                                  <Th>Grade</Th>
                                  <Th>Result</Th>
                                </tr>
                              </thead>
                              <tbody>
                                {card.subjects.map((subject) => (
                                  <tr key={subject.examSubjectId}>
                                    <Td>
                                      <span className="font-medium text-slate-900">
                                        {subject.subject}
                                      </span>{' '}
                                      <span className="text-xs text-slate-500">
                                        ({subject.code})
                                      </span>
                                    </Td>
                                    <Td className="text-right tabular-nums">
                                      {subject.isAbsent ? 'Absent' : subject.marksObtained}
                                    </Td>
                                    <Td className="text-right tabular-nums">{subject.maxMarks}</Td>
                                    <Td>{subject.isAbsent ? '—' : subject.grade}</Td>
                                    <Td>
                                      <Badge tone={subject.passed ? 'success' : 'warning'}>
                                        {subject.passed ? 'Pass' : 'Fail'}
                                      </Badge>
                                    </Td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          </TableWrap>
                          <div className="grid gap-3 sm:grid-cols-4">
                            <Summary label="Total" value={`${card.totalObtained} / ${card.totalMax}`} />
                            <Summary label="Percentage" value={`${card.percentage.toFixed(1)}%`} />
                            <Summary label="Grade" value={card.grade} />
                            <Summary label="GPA" value={card.gpa.toFixed(2)} />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function classLabel(classes: SchoolClass[], classId: string): string {
  return classes.find((klass) => klass.id === classId)?.name ?? 'Class';
}

function examClassLabel(entries: { id: string; label: string }[], classId: string): string {
  return entries.find((entry) => entry.id === classId)?.label ?? 'Class';
}
