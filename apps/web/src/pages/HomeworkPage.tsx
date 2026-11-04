import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  EmptyState,
  FieldError,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableWrap,
  Td,
  Textarea,
  Th,
} from '@schoolerp/ui';
import { api, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, todayIso } from '../lib/format';
import type { HomeworkRow, Paged, SchoolClass } from '../lib/types';
import { ErrorPanel, Pagination, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

interface SubjectRow {
  id: string;
  name: string;
  code: string;
  classSubjects: { classId: string }[];
}

const homeworkSchema = z.object({
  classId: z.string().min(1, 'Select a class'),
  sectionId: z.string().min(1, 'Select a section'),
  subjectId: z.string().min(1, 'Select a subject'),
  title: z.string().trim().min(3, 'Title is required').max(160),
  description: z.string().trim().min(3, 'Description is required').max(10_000),
  dueDate: z.string().min(1, 'Due date is required'),
});

type HomeworkForm = z.infer<typeof homeworkSchema>;

export function HomeworkPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [upcoming, setUpcoming] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<HomeworkRow | null>(null);

  const classesQuery = useQuery({
    queryKey: ['academics', 'classes'],
    queryFn: () => api.get<SchoolClass[]>('/academics/classes'),
  });
  const subjectsQuery = useQuery({
    queryKey: ['academics', 'subjects'],
    queryFn: () => api.get<SubjectRow[]>('/academics/subjects'),
  });

  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const sections = useMemo(
    () => classes.find((klass) => klass.id === classId)?.sections ?? [],
    [classes, classId],
  );

  const homeworkQuery = useQuery({
    queryKey: ['homework', { page, classId, sectionId, subjectId, upcoming }],
    queryFn: () =>
      api.get<Paged<HomeworkRow>>(
        `/homework${queryString({
          page,
          pageSize: 25,
          classId: classId || undefined,
          sectionId: sectionId || undefined,
          subjectId: subjectId || undefined,
          upcoming: upcoming ? 'true' : 'false',
        })}`,
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ removed: boolean }>(`/homework/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['homework'] }),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['homework'] });
  }

  return (
    <div>
      <PageHeader
        title="Homework"
        description="Assignments by class, section and subject"
        actions={
          hasPermission('homework:write') ? (
            <Button onClick={() => setCreateOpen(true)}>Assign homework</Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Select
          value={classId}
          onChange={(event) => {
            setClassId(event.target.value);
            setSectionId('');
            setPage(1);
          }}
          className="max-w-[180px]"
        >
          <option value="">All classes</option>
          {classes.map((klass) => (
            <option key={klass.id} value={klass.id}>
              {klass.name}
            </option>
          ))}
        </Select>
        <Select
          value={sectionId}
          onChange={(event) => {
            setSectionId(event.target.value);
            setPage(1);
          }}
          className="max-w-[150px]"
          disabled={!classId}
        >
          <option value="">All sections</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </Select>
        <Select
          value={subjectId}
          onChange={(event) => {
            setSubjectId(event.target.value);
            setPage(1);
          }}
          className="max-w-[180px]"
        >
          <option value="">All subjects</option>
          {(subjectsQuery.data ?? []).map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={upcoming}
            onChange={(event) => {
              setUpcoming(event.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Upcoming only
        </label>
      </div>

      {remove.isError ? <ErrorPanel error={remove.error} /> : null}
      {homeworkQuery.isLoading ? (
        <TableSkeleton columns={5} />
      ) : homeworkQuery.isError ? (
        <ErrorPanel error={homeworkQuery.error} onRetry={() => void homeworkQuery.refetch()} />
      ) : (homeworkQuery.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No homework assigned" description="Create the first assignment for a class." />
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Class</Th>
                  <Th>Subject</Th>
                  <Th>Due</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {homeworkQuery.data?.items.map((item) => (
                  <tr key={item.id}>
                    <Td>
                      <p className="font-medium text-slate-900">{item.title}</p>
                      <p className="max-w-lg truncate text-xs text-slate-500">{item.description}</p>
                    </Td>
                    <Td>
                      {item.className ?? '—'} · {item.sectionName ?? '—'}
                    </Td>
                    <Td>{item.subjectName ?? '—'}</Td>
                    <Td>{formatDate(item.dueDate)}</Td>
                    <Td>
                      {hasPermission('homework:write') ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => setEditing(item)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(item.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination
            page={homeworkQuery.data?.page ?? 1}
            pageSize={homeworkQuery.data?.pageSize ?? 25}
            total={homeworkQuery.data?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}

      <HomeworkModal
        key={editing?.id ?? 'new'}
        open={createOpen || Boolean(editing)}
        assignment={editing}
        classes={classes}
        subjects={subjectsQuery.data ?? []}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreateOpen(false);
          setEditing(null);
          invalidate();
        }}
      />
    </div>
  );
}

function HomeworkModal({
  open,
  assignment,
  classes,
  subjects,
  onClose,
  onSaved,
}: {
  open: boolean;
  assignment: HomeworkRow | null;
  classes: SchoolClass[];
  subjects: SubjectRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<HomeworkForm>({
    resolver: zodResolver(homeworkSchema),
    defaultValues: assignment
      ? {
          classId: assignment.classId,
          sectionId: assignment.sectionId,
          subjectId: assignment.subjectId,
          title: assignment.title,
          description: assignment.description,
          dueDate: assignment.dueDate.slice(0, 10),
        }
      : {
          classId: '',
          sectionId: '',
          subjectId: '',
          title: '',
          description: '',
          dueDate: todayIso(),
        },
  });

  const classId = watch('classId');
  const sections = classes.find((klass) => klass.id === classId)?.sections ?? [];

  const save = useMutation({
    mutationFn: (values: HomeworkForm) =>
      assignment
        ? api.patch<HomeworkRow>(`/homework/${assignment.id}`, values)
        : api.post<HomeworkRow>('/homework', values),
    onSuccess: () => {
      reset();
      onSaved();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={assignment ? 'Edit homework' : 'Assign homework'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="homework-form" disabled={isSubmitting || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save assignment'}
          </Button>
        </>
      }
    >
      <form
        id="homework-form"
        className="space-y-4"
        onSubmit={handleSubmit((values) => save.mutate(values))}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="homework-class">Class</Label>
            <Select id="homework-class" {...register('classId')}>
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
            <Label htmlFor="homework-section">Section</Label>
            <Select id="homework-section" {...register('sectionId')}>
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
            <Label htmlFor="homework-subject">Subject</Label>
            <Select id="homework-subject" {...register('subjectId')}>
              <option value="">Select subject</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
            <FieldError>{errors.subjectId?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="homework-due">Due date</Label>
            <Input id="homework-due" type="date" {...register('dueDate')} />
            <FieldError>{errors.dueDate?.message}</FieldError>
          </div>
        </div>
        <div>
          <Label htmlFor="homework-title">Title</Label>
          <Input id="homework-title" {...register('title')} />
          <FieldError>{errors.title?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="homework-description">Instructions</Label>
          <Textarea id="homework-description" className="min-h-32" {...register('description')} />
          <FieldError>{errors.description?.message}</FieldError>
        </div>
        {save.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {save.error instanceof Error ? save.error.message : 'Could not save homework'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
