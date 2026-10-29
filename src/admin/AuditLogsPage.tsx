import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ScrollText, Search } from 'lucide-react';
import { relativeTime } from '../lib/date';
import { Badge, Button, Card, EmptyState, Field, Select, Spinner, TextInput } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { AUDIT_CATEGORY_LABELS, adminApi, describeAudit, useAsync, type AuditEntry } from './adminApi';

function outcomeBadge(outcome: string) {
  if (outcome === 'success') return <Badge tone="ok">success</Badge>;
  if (outcome === 'denied') return <Badge tone="warn">denied</Badge>;
  return <Badge tone="crit">failure</Badge>;
}

function MetadataCell({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return <span className="text-muted/70">—</span>;
  return (
    <details className="max-w-[320px]">
      <summary className="cursor-pointer select-none text-xs font-semibold text-primary-dark hover:underline">
        {entries.length} detail{entries.length === 1 ? '' : 's'}
      </summary>
      <dl className="mt-1.5 space-y-1 rounded-lg bg-canvas px-2.5 py-2 text-[11px] leading-4">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <dt className="shrink-0 font-semibold text-muted">{key}</dt>
            <dd className="min-w-0 break-words text-ink">
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export default function AuditLogsPage() {
  const [action, setAction] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const params = useMemo(() => {
    const query = new URLSearchParams();
    if (action !== 'all') query.set('action', action);
    if (search.trim()) query.set('q', search.trim());
    query.set('page', String(page));
    query.set('pageSize', '25');
    return query;
  }, [action, search, page]);

  const { data, error, loading } = useAsync(() => adminApi.auditLogs(params), [params.toString()]);

  const categoryActions = useMemo(() => {
    if (category === 'all') return null;
    return new Set(AUDIT_CATEGORY_LABELS[category] ?? []);
  }, [category]);

  const visibleLogs = useMemo(() => {
    if (!data || !categoryActions) return data?.logs ?? [];
    return data.logs.filter((entry) => categoryActions.has(entry.action as never));
  }, [data, categoryActions]);

  const actionOptions = data?.actions ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Audit logs"
        description="Actor, action, target, timestamp and outcome for every administrative and security event. Passwords and tokens are never recorded."
        actions={
          <Badge tone="primary" icon={<ScrollText className="h-3.5 w-3.5" aria-hidden="true" />}>
            {data ? `${data.total} events` : '…'}
          </Badge>
        }
      />

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Search" htmlFor="audit-search" className="sm:flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <TextInput
                id="audit-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search actor, action or target…"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Category" htmlFor="audit-category" className="sm:w-48">
            <Select
              id="audit-category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All categories</option>
              {Object.entries(AUDIT_CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Action" htmlFor="audit-action" className="sm:w-60">
            <Select
              id="audit-action"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All actions</option>
              {actionOptions.map((item) => (
                <option key={item} value={item}>
                  {describeAudit({ action: item } as AuditEntry)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted" role="status">
            <Spinner /> Loading audit logs…
          </div>
        ) : visibleLogs.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<ScrollText className="h-5 w-5 text-muted" aria-hidden="true" />}
              title="No matching events"
              description="Adjust the filters — or perform an administrative action and it will appear here."
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="mt-4 hidden overflow-hidden rounded-xl border border-line md:block">
              <table className="w-full border-collapse bg-white text-sm">
                <thead className="bg-canvas">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      When
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Actor
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Action
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Target
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Outcome
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleLogs.map((entry) => (
                    <tr key={entry.id} className="transition-colors hover:bg-[#F0FDF4]">
                      <td className="whitespace-nowrap px-3 py-3 text-[12px] text-muted" title={entry.at}>
                        {relativeTime(entry.at)}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-3 text-[13px] text-ink">
                        {entry.actorEmail ?? 'system'}
                      </td>
                      <td className="px-3 py-3 text-[13px] font-medium text-ink">
                        {describeAudit(entry)}
                        <span className="block text-[11px] font-normal text-muted">{entry.action}</span>
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-3 text-[12px] text-muted">
                        {entry.targetType ? `${entry.targetType}: ` : ''}
                        {entry.targetId ?? '—'}
                      </td>
                      <td className="px-3 py-3">{outcomeBadge(entry.outcome)}</td>
                      <td className="px-3 py-3">
                        <MetadataCell metadata={entry.metadata} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="mt-4 space-y-3 md:hidden">
              {visibleLogs.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{describeAudit(entry)}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted">
                        {entry.actorEmail ?? 'system'} · {relativeTime(entry.at)}
                      </p>
                    </div>
                    {outcomeBadge(entry.outcome)}
                  </div>
                  <div className="mt-2">
                    <MetadataCell metadata={entry.metadata} />
                  </div>
                </li>
              ))}
            </ul>

            {data && data.pages > 1 ? (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                <p className="text-xs text-muted">
                  Page {data.page} of {data.pages} · {data.total} event{data.total === 1 ? '' : 's'}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={data.page <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={data.page >= data.pages}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
