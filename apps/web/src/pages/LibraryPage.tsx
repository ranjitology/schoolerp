import { useState } from 'react';
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
  Th,
  cn,
  statusTone,
} from '@schoolerp/ui';
import { api, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, todayIso } from '../lib/format';
import type {
  LibraryBookRow,
  LibraryIssueRow,
  LibrarySummary,
  Paged,
  StudentRow,
} from '../lib/types';
import { ErrorPanel, Pagination, StatGrid, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

type Tab = 'catalogue' | 'issues';

const bookSchema = z.object({
  isbn: z.string().trim().max(32).optional(),
  title: z.string().trim().min(1, 'Title is required').max(200),
  author: z.string().trim().min(1, 'Author is required').max(160),
  category: z.string().trim().min(1, 'Category is required').max(80),
  copies: z.string().trim().min(1, 'Copies is required'),
  location: z.string().trim().max(80).optional(),
});

type BookForm = z.infer<typeof bookSchema>;

const issueSchema = z.object({
  bookId: z.string().min(1, 'Select a book'),
  studentId: z.string().min(1, 'Select a student'),
  dueDate: z.string().min(1, 'Due date is required'),
});

type IssueForm = z.infer<typeof issueSchema>;

export function LibraryPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('catalogue');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [bookOpen, setBookOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ['library', 'summary'],
    queryFn: () => api.get<LibrarySummary>('/library/summary'),
  });

  const booksQuery = useQuery({
    queryKey: ['library', 'books', { page, search }],
    queryFn: () =>
      api.get<Paged<LibraryBookRow>>(
        `/library/books${queryString({ page, pageSize: 25, q: search || undefined })}`,
      ),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['library'] });
  }

  return (
    <div>
      <PageHeader
        title="Library"
        description="Catalogue, circulation and overdue tracking"
        actions={
          hasPermission('library:write') ? (
            <>
              <Button variant="outline" onClick={() => setIssueOpen(true)}>
                Issue book
              </Button>
              <Button onClick={() => setBookOpen(true)}>Add title</Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-6">
        <StatGrid>
          <StatCard label="Titles" value={summaryQuery.data?.titles ?? '—'} />
          <StatCard
            label="Copies available"
            value={summaryQuery.data?.available ?? '—'}
            hint={`${summaryQuery.data?.copies ?? 0} total copies`}
            tone="positive"
          />
          <StatCard label="On loan" value={summaryQuery.data?.issued ?? '—'} />
          <StatCard
            label="Overdue"
            value={summaryQuery.data?.overdue ?? '—'}
            tone={summaryQuery.data?.overdue ? 'danger' : 'default'}
            hint={`${formatMoney(summaryQuery.data?.finesMinor ?? 0)} fines collected`}
          />
        </StatGrid>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['catalogue', 'Catalogue'],
            ['issues', 'Loans & returns'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition',
              tab === value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'catalogue' ? (
        <>
          <div className="mb-4">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search title, author or ISBN"
              className="max-w-xs"
            />
          </div>
          {booksQuery.isLoading ? (
            <TableSkeleton columns={5} />
          ) : booksQuery.isError ? (
            <ErrorPanel error={booksQuery.error} onRetry={() => void booksQuery.refetch()} />
          ) : (booksQuery.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No books yet" description="Add a title to start the library catalogue." />
          ) : (
            <>
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Title</Th>
                      <Th>Author</Th>
                      <Th>Category</Th>
                      <Th>ISBN</Th>
                      <Th>Copies</Th>
                      <Th>Available</Th>
                      <Th>Location</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {booksQuery.data?.items.map((book) => (
                      <tr key={book.id}>
                        <Td className="font-medium text-slate-900">{book.title}</Td>
                        <Td>{book.author}</Td>
                        <Td>{book.category}</Td>
                        <Td className="text-xs text-slate-500">{book.isbn ?? '—'}</Td>
                        <Td className="tabular-nums">{book.copies}</Td>
                        <Td className="tabular-nums">
                          <span className={book.available === 0 ? 'text-rose-600' : 'text-emerald-600'}>
                            {book.available}
                          </span>
                        </Td>
                        <Td>{book.location ?? '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
              <Pagination
                page={booksQuery.data?.page ?? 1}
                pageSize={booksQuery.data?.pageSize ?? 25}
                total={booksQuery.data?.total ?? 0}
                onPage={setPage}
              />
            </>
          )}
        </>
      ) : (
        <IssuesTab
          books={booksQuery.data?.items ?? []}
          canWrite={hasPermission('library:write')}
          onChanged={invalidate}
        />
      )}

      <BookModal
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        onSaved={() => {
          setBookOpen(false);
          invalidate();
        }}
      />
      <IssueModal
        open={issueOpen}
        books={booksQuery.data?.items ?? []}
        onClose={() => setIssueOpen(false)}
        onSaved={() => {
          setIssueOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}

function IssuesTab({
  books,
  canWrite,
  onChanged,
}: {
  books: LibraryBookRow[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const issuesQuery = useQuery({
    queryKey: ['library', 'issues', { page, status }],
    queryFn: () =>
      api.get<Paged<LibraryIssueRow>>(
        `/library/issues${queryString({ page, pageSize: 25, status: status || undefined })}`,
      ),
  });

  const returnBook = useMutation({
    mutationFn: (id: string) => api.post<LibraryIssueRow>(`/library/issues/${id}/return`, {}),
    onSuccess: onChanged,
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="max-w-[200px]"
        >
          <option value="">All loans</option>
          <option value="ISSUED">Issued</option>
          <option value="RETURNED">Returned</option>
          <option value="OVERDUE">Overdue</option>
          <option value="LOST">Lost</option>
        </Select>
        <span className="text-xs text-slate-500">{books.length} titles in catalogue</span>
      </div>
      {returnBook.isError ? <ErrorPanel error={returnBook.error} /> : null}
      {issuesQuery.isLoading ? (
        <TableSkeleton columns={6} />
      ) : issuesQuery.isError ? (
        <ErrorPanel error={issuesQuery.error} onRetry={() => void issuesQuery.refetch()} />
      ) : (issuesQuery.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No loans recorded" description="Issue a book to a student to get started." />
      ) : (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Book</Th>
                  <Th>Student</Th>
                  <Th>Issued</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                  <Th>Fine</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {issuesQuery.data?.items.map((issue) => (
                  <tr key={issue.id}>
                    <Td className="font-medium text-slate-900">{issue.bookTitle}</Td>
                    <Td>
                      <p className="text-sm text-slate-700">{issue.studentName}</p>
                      <p className="text-xs text-slate-500">{issue.admissionNo ?? '—'}</p>
                    </Td>
                    <Td>{formatDate(issue.issueDate)}</Td>
                    <Td className={issue.overdue ? 'font-medium text-rose-600' : undefined}>
                      {formatDate(issue.dueDate)}
                    </Td>
                    <Td>
                      <Badge tone={issue.overdue ? 'danger' : statusTone(issue.status)}>
                        {issue.overdue ? 'OVERDUE' : issue.status}
                      </Badge>
                    </Td>
                    <Td className="tabular-nums">{formatMoney(issue.fineMinor)}</Td>
                    <Td>
                      {canWrite && issue.status === 'ISSUED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={returnBook.isPending}
                          onClick={() => returnBook.mutate(issue.id)}
                        >
                          Return
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination
            page={issuesQuery.data?.page ?? 1}
            pageSize={issuesQuery.data?.pageSize ?? 25}
            total={issuesQuery.data?.total ?? 0}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

function BookModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BookForm>({
    resolver: zodResolver(bookSchema),
    defaultValues: { isbn: '', title: '', author: '', category: '', copies: '1', location: '' },
  });

  const create = useMutation({
    mutationFn: (values: BookForm) =>
      api.post<LibraryBookRow>('/library/books', {
        ...values,
        isbn: values.isbn || undefined,
        location: values.location || undefined,
        copies: Number(values.copies),
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
      title="Add library title"
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="book-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save title'}
          </Button>
        </>
      }
    >
      <form id="book-form" className="space-y-4" onSubmit={handleSubmit((values) => create.mutate(values))}>
        <div>
          <Label htmlFor="book-title">Title</Label>
          <Input id="book-title" {...register('title')} />
          <FieldError>{errors.title?.message}</FieldError>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="book-author">Author</Label>
            <Input id="book-author" {...register('author')} />
            <FieldError>{errors.author?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="book-category">Category</Label>
            <Input id="book-category" {...register('category')} placeholder="Textbook, fiction…" />
            <FieldError>{errors.category?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="book-isbn">ISBN</Label>
            <Input id="book-isbn" {...register('isbn')} />
          </div>
          <div>
            <Label htmlFor="book-copies">Copies</Label>
            <Input id="book-copies" type="number" min="1" {...register('copies')} />
            <FieldError>{errors.copies?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="book-location">Location</Label>
            <Input id="book-location" {...register('location')} placeholder="Shelf / rack" />
          </div>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not save title'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function IssueModal({
  open,
  books,
  onClose,
  onSaved,
}: {
  open: boolean;
  books: LibraryBookRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const studentsQuery = useQuery({
    queryKey: ['students', 'library-options'],
    queryFn: () => api.get<Paged<StudentRow>>('/students?pageSize=100'),
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<IssueForm>({
    resolver: zodResolver(issueSchema),
    defaultValues: { bookId: '', studentId: '', dueDate: todayIso() },
  });

  const issue = useMutation({
    mutationFn: (values: IssueForm) => api.post<LibraryIssueRow>('/library/issues', values),
    onSuccess: () => {
      reset();
      onSaved();
    },
  });

  const available = books.filter((book) => book.available > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Issue book"
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="issue-form" disabled={isSubmitting || issue.isPending}>
            {issue.isPending ? 'Issuing…' : 'Issue book'}
          </Button>
        </>
      }
    >
      <form id="issue-form" className="space-y-4" onSubmit={handleSubmit((values) => issue.mutate(values))}>
        <div>
          <Label htmlFor="issue-book">Book</Label>
          <Select id="issue-book" {...register('bookId')}>
            <option value="">Select an available title</option>
            {available.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title} ({book.available} available)
              </option>
            ))}
          </Select>
          <FieldError>{errors.bookId?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="issue-student">Student</Label>
          <Select id="issue-student" {...register('studentId')}>
            <option value="">Select a student</option>
            {(studentsQuery.data?.items ?? []).map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName ?? `${student.firstName} ${student.lastName}`} ({student.admissionNo})
              </option>
            ))}
          </Select>
          <FieldError>{errors.studentId?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="issue-due">Due date</Label>
          <Input id="issue-due" type="date" {...register('dueDate')} />
          <FieldError>{errors.dueDate?.message}</FieldError>
        </div>
        {issue.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {issue.error instanceof Error ? issue.error.message : 'Could not issue book'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
