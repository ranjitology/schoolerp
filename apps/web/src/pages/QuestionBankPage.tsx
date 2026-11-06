import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import type {
  GeneratedPaper,
  Paged,
  QuestionDifficulty,
  QuestionRow,
  QuestionType,
  SubjectRow,
} from '../lib/types';
import { ErrorPanel, TableSkeleton } from '../components/Feedback';

const QUESTION_TYPES: QuestionType[] = ['MCQ', 'SHORT', 'LONG', 'TRUE_FALSE', 'FILL_BLANK'];
const DIFFICULTIES: QuestionDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];

const TYPE_LABELS: Record<QuestionType, string> = {
  MCQ: 'Multiple choice',
  SHORT: 'Short answer',
  LONG: 'Long answer',
  TRUE_FALSE: 'True / false',
  FILL_BLANK: 'Fill in the blank',
};

interface QuestionForm {
  subjectId: string;
  type: QuestionType;
  question: string;
  options: string;
  answer: string;
  marks: string;
  difficulty: QuestionDifficulty;
  tags: string;
}

const EMPTY_FORM: QuestionForm = {
  subjectId: '',
  type: 'MCQ',
  question: '',
  options: '',
  answer: '',
  marks: '1',
  difficulty: 'MEDIUM',
  tags: '',
};

export function QuestionBankPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'bank' | 'paper'>('bank');
  const [subjectId, setSubjectId] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | QuestionType>('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<QuestionForm>(EMPTY_FORM);
  const [paper, setPaper] = useState<GeneratedPaper | null>(null);
  const [paperForm, setPaperForm] = useState({
    subjectId: '',
    title: '',
    totalMarks: '50',
    easy: '0',
    medium: '0',
    hard: '0',
  });
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canRead = hasPermission('exams:read');
  const canWrite = hasPermission('exams:write');
  const canReadAcademics = hasPermission('academics:read');

  const subjectsQuery = useQuery({
    queryKey: ['academics', 'subjects'],
    queryFn: () => api.get<SubjectRow[]>('/academics/subjects'),
    enabled: canRead && canReadAcademics,
  });
  const subjects = useMemo(() => subjectsQuery.data ?? [], [subjectsQuery.data]);

  const questionsQuery = useQuery({
    queryKey: ['question-bank', { subjectId, typeFilter, search }],
    queryFn: () =>
      api.get<Paged<QuestionRow>>(
        `/question-bank${queryString({
          pageSize: 100,
          ...(subjectId ? { subjectId } : {}),
          ...(typeFilter ? { type: typeFilter } : {}),
          ...(search.trim() ? { q: search.trim() } : {}),
        })}`,
      ),
    enabled: canRead,
  });

  const questions = questionsQuery.data?.items ?? [];

  function clearFeedback() {
    setMessage(null);
    setActionError(null);
  }

  function invalidateQuestions() {
    void queryClient.invalidateQueries({ queryKey: ['question-bank'] });
  }

  const createQuestion = useMutation({
    mutationFn: () =>
      api.post<QuestionRow>('/question-bank', {
        subjectId: form.subjectId,
        type: form.type,
        question: form.question,
        options:
          form.type === 'MCQ' || form.type === 'TRUE_FALSE'
            ? form.options
                .split(/[\n,]/)
                .map((option) => option.trim())
                .filter(Boolean)
            : [],
        answer: form.answer,
        marks: Number(form.marks) || 1,
        difficulty: form.difficulty,
        tags: form.tags
          .split(/[\n,]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      setMessage('Question added to the bank.');
      setActionError(null);
      setForm((current) => ({ ...EMPTY_FORM, subjectId: current.subjectId, type: current.type }));
      invalidateQuestions();
    },
    onError: (error) => {
      setMessage(null);
      setActionError(error instanceof ApiError ? error.message : 'Could not save the question');
    },
  });

  const removeQuestion = useMutation({
    mutationFn: (id: string) => api.delete(`/question-bank/${id}`),
    onSuccess: () => {
      setMessage('Question removed.');
      setActionError(null);
      invalidateQuestions();
    },
    onError: (error) => {
      setMessage(null);
      setActionError(error instanceof ApiError ? error.message : 'Could not remove the question');
    },
  });

  const generatePaper = useMutation({
    mutationFn: () =>
      api.post<GeneratedPaper>('/question-bank/papers/generate', {
        subjectId: paperForm.subjectId,
        title: paperForm.title,
        totalMarks: Number(paperForm.totalMarks) || 1,
        distribution: {
          EASY: Number(paperForm.easy) || 0,
          MEDIUM: Number(paperForm.medium) || 0,
          HARD: Number(paperForm.hard) || 0,
        },
      }),
    onSuccess: (result) => {
      setPaper(result);
      setMessage(
        result.totalMarks === result.targetMarks
          ? `Paper assembled with ${result.questions.length} question(s).`
          : `Paper assembled with ${result.questions.length} question(s); the bank could only cover ${result.totalMarks}/${result.targetMarks} marks.`,
      );
      setActionError(null);
    },
    onError: (error) => {
      setPaper(null);
      setMessage(null);
      setActionError(error instanceof ApiError ? error.message : 'Could not generate the paper');
    },
  });

  if (!canRead) {
    return (
      <EmptyState
        title="Question bank access required"
        description="Ask a school administrator for the exams permission."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Question bank"
        description="Curate questions by subject and assemble exam papers in a few clicks."
        actions={
          <div className="flex rounded-lg border border-slate-200 bg-white p-1">
            {(['bank', 'paper'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={
                  tab === value
                    ? 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white'
                    : 'rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50'
                }
              >
                {value === 'bank' ? 'Question bank' : 'Paper assembly'}
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

      {!canReadAcademics ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You also need academics access to load the subject list.
        </p>
      ) : null}

      {tab === 'bank' ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Questions</CardTitle>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label htmlFor="qb-subject">Subject</Label>
                  <Select
                    id="qb-subject"
                    value={subjectId}
                    onChange={(event) => setSubjectId(event.target.value)}
                    className="w-44"
                  >
                    <option value="">All subjects</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.code} · {subject.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="qb-type">Type</Label>
                  <Select
                    id="qb-type"
                    value={typeFilter}
                    onChange={(event) =>
                      setTypeFilter(event.target.value as '' | QuestionType)
                    }
                    className="w-40"
                  >
                    <option value="">All types</option>
                    {QUESTION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="qb-search">Search</Label>
                  <Input
                    id="qb-search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Question text"
                    className="w-48"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {questionsQuery.isLoading ? (
                <div className="p-4">
                  <TableSkeleton rows={6} columns={5} />
                </div>
              ) : questionsQuery.isError ? (
                <div className="p-4">
                  <ErrorPanel
                    error={questionsQuery.error}
                    onRetry={() => void questionsQuery.refetch()}
                  />
                </div>
              ) : questions.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="No questions yet"
                    description="Add the first question using the form beside this list."
                  />
                </div>
              ) : (
                <TableWrap className="rounded-none border-0">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Question</Th>
                        <Th>Type</Th>
                        <Th>Difficulty</Th>
                        <Th className="text-right">Marks</Th>
                        {canWrite ? <Th /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {questions.map((question) => (
                        <tr key={question.id}>
                          <Td className="max-w-md">
                            <p className="font-medium text-slate-900">{question.question}</p>
                            {Array.isArray(question.options) && question.options.length > 0 ? (
                              <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                                {question.options.join(' · ')}
                              </p>
                            ) : null}
                            {Array.isArray(question.tags) && question.tags.length > 0 ? (
                              <p className="mt-1 text-xs text-slate-400">
                                {question.tags.join(', ')}
                              </p>
                            ) : null}
                          </Td>
                          <Td>
                            <Badge tone="info">{TYPE_LABELS[question.type] ?? question.type}</Badge>
                          </Td>
                          <Td>
                            <Badge tone={statusTone(question.difficulty)}>
                              {question.difficulty}
                            </Badge>
                          </Td>
                          <Td className="text-right tabular-nums">{question.marks}</Td>
                          {canWrite ? (
                            <Td>
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={removeQuestion.isPending}
                                onClick={() => removeQuestion.mutate(question.id)}
                              >
                                Delete
                              </Button>
                            </Td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add a question</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Questions are reusable across papers. Tags help with filtering later.
              </p>
            </CardHeader>
            <CardContent>
              {!canWrite ? (
                <p className="text-sm text-slate-500">
                  Your role can read the bank but not change it.
                </p>
              ) : (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    clearFeedback();
                    createQuestion.mutate();
                  }}
                >
                  <div>
                    <Label htmlFor="qb-form-subject">Subject</Label>
                    <Select
                      id="qb-form-subject"
                      value={form.subjectId}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, subjectId: event.target.value }))
                      }
                      required
                    >
                      <option value="">Select a subject</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.code} · {subject.name}
                        </option>
                      ))}
                    </Select>
                    <FieldError>
                      {subjects.length === 0 ? 'Create a subject before adding questions.' : null}
                    </FieldError>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="qb-form-type">Type</Label>
                      <Select
                        id="qb-form-type"
                        value={form.type}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            type: event.target.value as QuestionType,
                          }))
                        }
                      >
                        {QUESTION_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {TYPE_LABELS[type]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="qb-form-difficulty">Difficulty</Label>
                      <Select
                        id="qb-form-difficulty"
                        value={form.difficulty}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            difficulty: event.target.value as QuestionDifficulty,
                          }))
                        }
                      >
                        {DIFFICULTIES.map((difficulty) => (
                          <option key={difficulty} value={difficulty}>
                            {difficulty}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="qb-form-question">Question</Label>
                    <Textarea
                      id="qb-form-question"
                      value={form.question}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, question: event.target.value }))
                      }
                      minLength={3}
                      maxLength={5000}
                      required
                    />
                  </div>
                  {form.type === 'MCQ' || form.type === 'TRUE_FALSE' ? (
                    <div>
                      <Label htmlFor="qb-form-options">Options</Label>
                      <Textarea
                        id="qb-form-options"
                        value={form.options}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, options: event.target.value }))
                        }
                        placeholder="One option per line, or separate with commas"
                        className="min-h-20"
                      />
                    </div>
                  ) : null}
                  <div>
                    <Label htmlFor="qb-form-answer">Answer / marking scheme</Label>
                    <Textarea
                      id="qb-form-answer"
                      value={form.answer}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, answer: event.target.value }))
                      }
                      className="min-h-16"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="qb-form-marks">Marks</Label>
                      <Input
                        id="qb-form-marks"
                        type="number"
                        min={1}
                        max={100}
                        value={form.marks}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, marks: event.target.value }))
                        }
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="qb-form-tags">Tags</Label>
                      <Input
                        id="qb-form-tags"
                        value={form.tags}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, tags: event.target.value }))
                        }
                        placeholder="algebra, unit-1"
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    loading={createQuestion.isPending}
                    disabled={!form.subjectId || form.question.trim().length < 3}
                  >
                    Add question
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Generate a paper</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                The bank picks questions for the chosen subject until the target marks are met.
              </p>
            </CardHeader>
            <CardContent>
              {!canWrite ? (
                <p className="text-sm text-slate-500">
                  Your role can read the bank but not assemble papers.
                </p>
              ) : (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    clearFeedback();
                    generatePaper.mutate();
                  }}
                >
                  <div>
                    <Label htmlFor="paper-subject">Subject</Label>
                    <Select
                      id="paper-subject"
                      value={paperForm.subjectId}
                      onChange={(event) =>
                        setPaperForm((current) => ({
                          ...current,
                          subjectId: event.target.value,
                        }))
                      }
                      required
                    >
                      <option value="">Select a subject</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.code} · {subject.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="paper-title">Paper title</Label>
                    <Input
                      id="paper-title"
                      value={paperForm.title}
                      onChange={(event) =>
                        setPaperForm((current) => ({ ...current, title: event.target.value }))
                      }
                      placeholder="Mid-term Mathematics"
                      minLength={2}
                      maxLength={160}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="paper-marks">Target marks</Label>
                    <Input
                      id="paper-marks"
                      type="number"
                      min={1}
                      max={1000}
                      value={paperForm.totalMarks}
                      onChange={(event) =>
                        setPaperForm((current) => ({
                          ...current,
                          totalMarks: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['easy', 'medium', 'hard'] as const).map((difficulty) => (
                      <div key={difficulty}>
                        <Label htmlFor={`paper-${difficulty}`}>
                          {difficulty[0]?.toUpperCase() + difficulty.slice(1)}
                        </Label>
                        <Input
                          id={`paper-${difficulty}`}
                          type="number"
                          min={0}
                          max={100}
                          value={paperForm[difficulty]}
                          onChange={(event) =>
                            setPaperForm((current) => ({
                              ...current,
                              [difficulty]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    Difficulty values control the order questions are considered (easy first).
                  </p>
                  <Button
                    type="submit"
                    className="w-full"
                    loading={generatePaper.isPending}
                    disabled={!paperForm.subjectId || paperForm.title.trim().length < 2}
                  >
                    Assemble paper
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{paper?.title ?? 'Assembled paper'}</CardTitle>
                {paper ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {paper.questions.length} question(s) · {paper.totalMarks} of{' '}
                    {paper.targetMarks} marks
                  </p>
                ) : null}
              </div>
              {paper ? (
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  Print
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {!paper ? (
                <EmptyState
                  title="No paper assembled yet"
                  description="Choose a subject and target marks to generate a paper."
                />
              ) : paper.questions.length === 0 ? (
                <EmptyState
                  title="No questions selected"
                  description="Add questions to this subject, then try again."
                />
              ) : (
                <ol className="space-y-4">
                  {paper.questions.map((question, index) => (
                    <li key={question.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-slate-900">
                          {index + 1}. {question.question}
                        </p>
                        <Badge tone="neutral">{question.marks} marks</Badge>
                      </div>
                      {question.options.length > 0 ? (
                        <ul className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                          {question.options.map((option, optionIndex) => (
                            <li key={`${question.id}-${optionIndex}`}>
                              {String.fromCharCode(65 + optionIndex)}. {option}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge tone="info">{TYPE_LABELS[question.type] ?? question.type}</Badge>
                        <Badge tone={statusTone(question.difficulty)}>
                          {question.difficulty}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
