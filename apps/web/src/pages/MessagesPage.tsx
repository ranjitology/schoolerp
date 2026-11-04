import { useEffect, useState } from 'react';
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
  Textarea,
  cn,
} from '@schoolerp/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, initials } from '../lib/format';
import type {
  MessageParticipant,
  MessageThreadDetail,
  MessageThreadRow,
  Paged,
} from '../lib/types';
import { ErrorPanel, Pagination, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

const threadSchema = z.object({
  subject: z.string().trim().min(2, 'Subject is required').max(160),
  participantIds: z.array(z.string()).min(1, 'Choose at least one participant'),
  message: z.string().trim().min(1, 'Write a first message').max(5000),
});

type ThreadForm = z.infer<typeof threadSchema>;

export function MessagesPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const threadsQuery = useQuery({
    queryKey: ['messages', 'threads', page],
    queryFn: () => api.get<Paged<MessageThreadRow>>(`/messages/threads?page=${page}&pageSize=25`),
  });

  const participantsQuery = useQuery({
    queryKey: ['messages', 'participants'],
    queryFn: () => api.get<{ items: MessageParticipant[] }>('/messages/participants'),
  });

  const participants = participantsQuery.data?.items ?? [];
  const nameFor = (id: string) =>
    participants.find((participant) => participant.id === id)?.fullName ?? 'Unknown user';

  const threads = threadsQuery.data?.items ?? [];
  const activeId = selectedId ?? threads[0]?.id ?? null;

  return (
    <div>
      <PageHeader
        title="Messages"
        description="Internal conversations between staff, guardians and students"
        actions={
          hasPermission('messages:write') ? (
            <Button onClick={() => setCreateOpen(true)}>New conversation</Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Conversations</p>
            <p className="text-xs text-slate-500">{threadsQuery.data?.total ?? 0} threads</p>
          </div>
          {threadsQuery.isLoading ? (
            <div className="p-4">
              <TableSkeleton rows={4} columns={2} />
            </div>
          ) : threadsQuery.isError ? (
            <div className="p-4">
              <ErrorPanel error={threadsQuery.error} onRetry={() => void threadsQuery.refetch()} />
            </div>
          ) : threads.length === 0 ? (
            <EmptyState
              title="No conversations"
              description="Start a conversation with another member of your school."
            />
          ) : (
            <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
              {threads.map((thread) => {
                const others = (thread.participants ?? [])
                  .filter((participant) => participant.fullName !== 'Unknown user')
                  .map((participant) => participant.fullName);
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(thread.id)}
                      className={cn(
                        'w-full px-4 py-3 text-left transition hover:bg-slate-50',
                        activeId === thread.id && 'bg-brand-50',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-900">{thread.subject}</p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {formatDateTime(thread.updatedAt)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {others.length ? others.join(', ') : 'No participants'}
                      </p>
                      {thread.lastMessage ? (
                        <p className="mt-1 truncate text-xs text-slate-400">{thread.lastMessage.body}</p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {threadsQuery.data ? (
            <div className="border-t border-slate-100 px-3 py-2">
              <Pagination
                page={threadsQuery.data.page}
                pageSize={threadsQuery.data.pageSize}
                total={threadsQuery.data.total}
                onPage={setPage}
              />
            </div>
          ) : null}
        </div>

        <ThreadPanel
          threadId={activeId}
          nameFor={nameFor}
          canWrite={hasPermission('messages:write')}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ['messages'] })}
        />
      </div>

      <CreateThreadModal
        open={createOpen}
        participants={participants}
        onClose={() => setCreateOpen(false)}
        onSaved={(thread) => {
          setCreateOpen(false);
          setSelectedId(thread.id);
          void queryClient.invalidateQueries({ queryKey: ['messages'] });
        }}
      />
    </div>
  );
}

function ThreadPanel({
  threadId,
  nameFor,
  canWrite,
  onChanged,
}: {
  threadId: string | null;
  nameFor: (id: string) => string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const threadQuery = useQuery({
    queryKey: ['messages', 'thread', threadId],
    queryFn: () => api.get<MessageThreadDetail>(`/messages/threads/${threadId}`),
    enabled: Boolean(threadId),
  });

  useEffect(() => {
    setBody('');
  }, [threadId]);

  const send = useMutation({
    mutationFn: () =>
      api.post<unknown>(`/messages/threads/${threadId}/messages`, { body: body.trim() }),
    onSuccess: () => {
      setBody('');
      onChanged();
      void queryClient.invalidateQueries({ queryKey: ['messages', 'thread', threadId] });
    },
  });

  const thread = threadQuery.data;

  if (!threadId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white">
        <EmptyState title="Select a conversation" description="Choose a thread to read and reply." />
      </div>
    );
  }

  return (
    <div className="flex min-h-[500px] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <p className="text-base font-semibold text-slate-900">
          {thread?.subject ?? 'Conversation'}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {(thread?.participants ?? []).map((participant) => participant.fullName).join(', ') ||
            'Loading participants…'}
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {threadQuery.isLoading ? (
          <TableSkeleton rows={4} columns={2} />
        ) : threadQuery.isError ? (
          <ErrorPanel error={threadQuery.error} onRetry={() => void threadQuery.refetch()} />
        ) : (thread?.messages.length ?? 0) === 0 ? (
          <EmptyState title="No messages yet" description="Send the first message below." />
        ) : (
          thread?.messages.map((message) => (
            <div key={message.id} className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                {initials(message.senderName ?? nameFor(message.senderId))}
              </span>
              <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-800">
                    {message.senderName ?? nameFor(message.senderId)}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {formatDateTime(message.createdAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{message.body}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {canWrite ? (
        <div className="border-t border-slate-100 px-5 py-3">
          {send.isError ? (
            <p role="alert" className="mb-2 text-sm text-rose-600">
              {send.error instanceof Error ? send.error.message : 'Could not send message'}
            </p>
          ) : null}
          <div className="flex items-end gap-2">
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write a reply…"
              className="min-h-16 flex-1"
            />
            <Button
              disabled={!body.trim() || send.isPending}
              onClick={() => send.mutate()}
              className="mb-0.5"
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CreateThreadModal({
  open,
  participants,
  onClose,
  onSaved,
}: {
  open: boolean;
  participants: MessageParticipant[];
  onClose: () => void;
  onSaved: (thread: { id: string }) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ThreadForm>({
    resolver: zodResolver(threadSchema),
    defaultValues: { subject: '', participantIds: [], message: '' },
  });

  const create = useMutation({
    mutationFn: (values: ThreadForm) =>
      api.post<{ id: string }>('/messages/threads', values),
    onSuccess: (thread) => {
      reset();
      onSaved(thread);
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New conversation"
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="thread-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Starting…' : 'Start conversation'}
          </Button>
        </>
      }
    >
      <form
        id="thread-form"
        className="space-y-4"
        onSubmit={handleSubmit((values) => create.mutate(values))}
      >
        <div>
          <Label htmlFor="thread-subject">Subject</Label>
          <Input id="thread-subject" {...register('subject')} />
          <FieldError>{errors.subject?.message}</FieldError>
        </div>
        <div>
          <Label>Participants</Label>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {participants.length === 0 ? (
              <p className="px-2 py-1 text-sm text-slate-500">No other users available.</p>
            ) : (
              participants.map((participant) => (
                <label
                  key={participant.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    value={participant.id}
                    {...register('participantIds')}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="flex-1 truncate">{participant.fullName}</span>
                  {participant.roleName ? (
                    <Badge tone="neutral">{participant.roleName}</Badge>
                  ) : null}
                </label>
              ))
            )}
          </div>
          <FieldError>{errors.participantIds?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="thread-message">First message</Label>
          <Textarea id="thread-message" {...register('message')} />
          <FieldError>{errors.message?.message}</FieldError>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not start conversation'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
