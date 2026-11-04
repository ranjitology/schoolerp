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
  Textarea,
  Th,
  cn,
} from '@schoolerp/ui';
import { api, queryString } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMoney } from '../lib/format';
import type {
  InventoryItemRow,
  InventorySummary,
  InventoryTransactionRow,
  Paged,
} from '../lib/types';
import { ErrorPanel, Pagination, StatGrid, TableSkeleton } from '../components/Feedback';
import { Modal } from '../components/Modal';

type Tab = 'items' | 'transactions';

const itemSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').max(40),
  name: z.string().trim().min(1, 'Name is required').max(160),
  category: z.string().trim().min(1, 'Category is required').max(80),
  quantity: z.string().trim().min(1, 'Quantity is required'),
  reorderLevel: z.string().trim().min(1, 'Reorder level is required'),
  unitPrice: z.string().trim().optional(),
  location: z.string().trim().max(120).optional(),
});

type ItemForm = z.infer<typeof itemSchema>;

const movementSchema = z.object({
  type: z.enum(['IN', 'OUT', 'ADJUST']),
  quantity: z.string().trim().min(1, 'Quantity is required'),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

type MovementForm = z.infer<typeof movementSchema>;

export function InventoryPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('items');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [lowStock, setLowStock] = useState('false');
  const [itemOpen, setItemOpen] = useState(false);
  const [movementTarget, setMovementTarget] = useState<InventoryItemRow | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: () => api.get<InventorySummary>('/inventory/summary'),
  });

  const itemsQuery = useQuery({
    queryKey: ['inventory', 'items', { page, search, lowStock }],
    queryFn: () =>
      api.get<Paged<InventoryItemRow>>(
        `/inventory/items${queryString({
          page,
          pageSize: 25,
          q: search || undefined,
          lowStock,
        })}`,
      ),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Stock levels, reorder alerts and movements"
        actions={
          hasPermission('inventory:write') ? (
            <Button onClick={() => setItemOpen(true)}>Add item</Button>
          ) : undefined
        }
      />

      <div className="mb-6">
        <StatGrid>
          <StatCard label="Item types" value={summaryQuery.data?.items ?? '—'} />
          <StatCard
            label="Low stock"
            value={summaryQuery.data?.lowStock ?? '—'}
            tone={summaryQuery.data?.lowStock ? 'danger' : 'positive'}
          />
          <StatCard label="Total units" value={summaryQuery.data?.units ?? '—'} />
          <StatCard label="Stock value" value={formatMoney(summaryQuery.data?.valueMinor ?? 0)} />
        </StatGrid>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['items', 'Stock items'],
            ['transactions', 'Movement history'],
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

      {tab === 'items' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search SKU, name or category"
              className="max-w-xs"
            />
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={lowStock === 'true'}
                onChange={(event) => {
                  setLowStock(event.target.checked ? 'true' : 'false');
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-slate-300"
              />
              Low stock only
            </label>
          </div>
          {itemsQuery.isLoading ? (
            <TableSkeleton columns={6} />
          ) : itemsQuery.isError ? (
            <ErrorPanel error={itemsQuery.error} onRetry={() => void itemsQuery.refetch()} />
          ) : (itemsQuery.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No inventory items" description="Add an item to start tracking stock." />
          ) : (
            <>
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      <Th>Category</Th>
                      <Th>Quantity</Th>
                      <Th>Reorder at</Th>
                      <Th>Unit price</Th>
                      <Th>Location</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {itemsQuery.data?.items.map((item) => (
                      <tr key={item.id}>
                        <Td>
                          <p className="font-medium text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-500">{item.sku}</p>
                        </Td>
                        <Td>{item.category}</Td>
                        <Td className="tabular-nums">
                          <span
                            className={
                              item.quantity <= item.reorderLevel ? 'font-medium text-rose-600' : 'text-slate-700'
                            }
                          >
                            {item.quantity}
                          </span>
                        </Td>
                        <Td className="tabular-nums">{item.reorderLevel}</Td>
                        <Td className="tabular-nums">{formatMoney(item.unitPriceMinor)}</Td>
                        <Td>{item.location ?? '—'}</Td>
                        <Td>
                          {hasPermission('inventory:write') ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setMovementTarget(item)}
                            >
                              Record movement
                            </Button>
                          ) : null}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
              <Pagination
                page={itemsQuery.data?.page ?? 1}
                pageSize={itemsQuery.data?.pageSize ?? 25}
                total={itemsQuery.data?.total ?? 0}
                onPage={setPage}
              />
            </>
          )}
        </>
      ) : (
        <TransactionsTab items={itemsQuery.data?.items ?? []} />
      )}

      <ItemModal
        open={itemOpen}
        onClose={() => setItemOpen(false)}
        onSaved={() => {
          setItemOpen(false);
          invalidate();
        }}
      />
      <MovementModal
        item={movementTarget}
        onClose={() => setMovementTarget(null)}
        onSaved={() => {
          setMovementTarget(null);
          invalidate();
        }}
      />
    </div>
  );
}

function TransactionsTab({ items }: { items: InventoryItemRow[] }) {
  const [itemId, setItemId] = useState('');
  const transactionsQuery = useQuery({
    queryKey: ['inventory', 'transactions', itemId],
    queryFn: () =>
      api.get<InventoryTransactionRow[]>(
        `/inventory/transactions${queryString({ itemId: itemId || undefined })}`,
      ),
  });

  const itemMap = new Map(items.map((item) => [item.id, item.name]));

  return (
    <div>
      <div className="mb-4">
        <Select
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
          className="max-w-[240px]"
        >
          <option value="">All items</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </div>
      {transactionsQuery.isLoading ? (
        <TableSkeleton columns={5} />
      ) : transactionsQuery.isError ? (
        <ErrorPanel error={transactionsQuery.error} onRetry={() => void transactionsQuery.refetch()} />
      ) : (transactionsQuery.data?.length ?? 0) === 0 ? (
        <EmptyState title="No movements" description="Stock movements will appear here." />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Type</Th>
                <Th>Quantity</Th>
                <Th>Reference</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {transactionsQuery.data?.map((transaction) => (
                <tr key={transaction.id}>
                  <Td className="font-medium text-slate-900">
                    {itemMap.get(transaction.itemId) ?? 'Item'}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        transaction.type === 'IN'
                          ? 'success'
                          : transaction.type === 'OUT'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {transaction.type}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums">{transaction.quantity}</Td>
                  <Td>{transaction.reference ?? '—'}</Td>
                  <Td>{formatDateTime(transaction.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

function ItemModal({
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
  } = useForm<ItemForm>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      sku: '',
      name: '',
      category: '',
      quantity: '0',
      reorderLevel: '0',
      unitPrice: '',
      location: '',
    },
  });

  const create = useMutation({
    mutationFn: (values: ItemForm) =>
      api.post<InventoryItemRow>('/inventory/items', {
        sku: values.sku,
        name: values.name,
        category: values.category,
        quantity: Number(values.quantity),
        reorderLevel: Number(values.reorderLevel),
        unitPriceMinor: values.unitPrice ? Math.round(Number(values.unitPrice) * 100) : 0,
        location: values.location || undefined,
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
      title="Add inventory item"
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="item-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Save item'}
          </Button>
        </>
      }
    >
      <form id="item-form" className="space-y-4" onSubmit={handleSubmit((values) => create.mutate(values))}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="item-sku">SKU</Label>
            <Input id="item-sku" {...register('sku')} />
            <FieldError>{errors.sku?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="item-name">Name</Label>
            <Input id="item-name" {...register('name')} />
            <FieldError>{errors.name?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="item-category">Category</Label>
            <Input id="item-category" {...register('category')} placeholder="Stationery, furniture…" />
            <FieldError>{errors.category?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="item-location">Location</Label>
            <Input id="item-location" {...register('location')} />
          </div>
          <div>
            <Label htmlFor="item-quantity">Opening quantity</Label>
            <Input id="item-quantity" type="number" min="0" {...register('quantity')} />
            <FieldError>{errors.quantity?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="item-reorder">Reorder level</Label>
            <Input id="item-reorder" type="number" min="0" {...register('reorderLevel')} />
            <FieldError>{errors.reorderLevel?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="item-price">Unit price</Label>
            <Input id="item-price" type="number" min="0" step="0.01" {...register('unitPrice')} />
          </div>
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not save item'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function MovementModal({
  item,
  onClose,
  onSaved,
}: {
  item: InventoryItemRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MovementForm>({
    resolver: zodResolver(movementSchema),
    defaultValues: { type: 'IN', quantity: '1', reference: '', notes: '' },
  });

  const create = useMutation({
    mutationFn: (values: MovementForm) =>
      api.post<InventoryTransactionRow>(`/inventory/items/${item?.id}/movements`, {
        type: values.type,
        quantity: Number(values.quantity),
        reference: values.reference || undefined,
        notes: values.notes || undefined,
      }),
    onSuccess: () => {
      reset();
      onSaved();
    },
  });

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      title={item ? `Stock movement · ${item.name}` : 'Stock movement'}
      description={item ? `Current quantity: ${item.quantity}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="movement-form" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Record movement'}
          </Button>
        </>
      }
    >
      <form
        id="movement-form"
        className="space-y-4"
        onSubmit={handleSubmit((values) => create.mutate(values))}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="movement-type">Movement</Label>
            <Select id="movement-type" {...register('type')}>
              <option value="IN">Stock in</option>
              <option value="OUT">Stock out</option>
              <option value="ADJUST">Adjustment</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="movement-quantity">Quantity</Label>
            <Input id="movement-quantity" type="number" min="1" {...register('quantity')} />
            <FieldError>{errors.quantity?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="movement-reference">Reference</Label>
            <Input id="movement-reference" {...register('reference')} placeholder="PO / requisition" />
          </div>
        </div>
        <div>
          <Label htmlFor="movement-notes">Notes</Label>
          <Textarea id="movement-notes" {...register('notes')} />
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-rose-600">
            {create.error instanceof Error ? create.error.message : 'Could not record movement'}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
