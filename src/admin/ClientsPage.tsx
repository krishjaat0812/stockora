import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Search,
  UserPlus,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { relativeTime } from '../lib/date';
import { PLANS } from '../shared/features';
import { Badge, Button, Card, EmptyState, Field, Modal, Select, Spinner, TextInput } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/toast';
import { adminApi, useAsync } from './adminApi';

function SetupLinkPanel({ link, notice, onClose }: { link: string; notice?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Copy failed', 'Select the link and copy it manually.');
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-warn/30 bg-warn-soft p-3 text-xs leading-5 text-[#78350F]">
        <span className="font-semibold">Account-setup link:</span>{' '}
        {notice ??
          'Send this secure link to the client. It expires in 14 days and can only be used once.'}{' '}
        No password was created or stored — the client chooses their own.
      </div>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          aria-label="Account setup link"
          className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink"
        />
        <Button
          onClick={() => void copy()}
          icon={copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Button variant="secondary" className="w-full" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}

function InviteClientDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [organizationName, setOrganizationName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [planId, setPlanId] = useState('growth');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ setupLink?: string; devNotice?: string } | null>(null);

  useEffect(() => {
    if (open) {
      setErrors({});
      setFormError(null);
      setResult(null);
    }
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (organizationName.trim().length < 2) next.organizationName = 'Enter the shop or organisation name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const response = await adminApi.createClient({
        organizationName: organizationName.trim(),
        ownerName: ownerName.trim(),
        email: email.trim().toLowerCase(),
        planId,
      });
      setResult({ setupLink: response.setupLink, devNotice: response.devNotice });
      onCreated();
    } catch (err) {
      const apiError = err as { message?: string; body?: { errors?: Record<string, string> } };
      setFormError(apiError.message ?? 'Could not create the client.');
      if (apiError.body?.errors) setErrors(apiError.body.errors);
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    setOrganizationName('');
    setOwnerName('');
    setEmail('');
    setResult(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={result ? 'Client invited' : 'Invite a new client'}
      description={
        result
          ? undefined
          : 'The client receives a secure setup link and chooses their own password. You will never see it.'
      }
      size="sm"
    >
      {result ? (
        <SetupLinkPanel link={result.setupLink ?? ''} notice={result.devNotice} onClose={close} />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          {formError ? (
            <div className="rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
              {formError}
            </div>
          ) : null}
          <Field label="Shop / organisation name" htmlFor="invite-org" error={errors.organizationName} required>
            <TextInput
              id="invite-org"
              value={organizationName}
              invalid={Boolean(errors.organizationName)}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="e.g. Green Valley Grocers"
            />
          </Field>
          <Field label="Owner name" htmlFor="invite-owner" hint="Shown on the account; optional.">
            <TextInput
              id="invite-owner"
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              placeholder="e.g. Ravi Verma"
            />
          </Field>
          <Field label="Owner email" htmlFor="invite-email" error={errors.email} required>
            <TextInput
              id="invite-email"
              type="email"
              value={email}
              invalid={Boolean(errors.email)}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@shop.com"
            />
          </Field>
          <Field label="Plan" htmlFor="invite-plan" hint="Sets the default feature set; you can override per client.">
            <Select id="invite-plan" value={planId} onChange={(event) => setPlanId(event.target.value)}>
              {PLANS.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {plan.description}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}>
              Send invitation
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function ClientsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all');
  const [sort, setSort] = useState(searchParams.get('sort') ?? 'created');
  const [dir, setDir] = useState<'asc' | 'desc'>(searchParams.get('dir') === 'asc' ? 'asc' : 'desc');
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(searchParams.get('invite') === '1');

  useEffect(() => {
    if (searchParams.get('invite') === '1') {
      setInviteOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('invite');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const params = useMemo(() => {
    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    if (status !== 'all') query.set('status', status);
    query.set('sort', sort);
    query.set('dir', dir);
    query.set('page', String(page));
    query.set('pageSize', '10');
    return query;
  }, [search, status, sort, dir, page]);

  const { data, error, loading, reload } = useAsync(() => adminApi.clients(params), [params.toString()]);

  const setSortKey = (key: string) => {
    if (sort === key) setDir((value) => (value === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir('asc');
    }
    setPage(1);
  };

  const header = (key: string, label: string, className = '') => (
    <th scope="col" className={`px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted ${className}`}>
      <button
        type="button"
        onClick={() => setSortKey(key)}
        className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort === key ? <span aria-hidden="true">{dir === 'asc' ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clients"
        description="Every registered shop organisation: status, plan, feature access and sign-in activity."
        actions={
          <Button icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setInviteOpen(true)}>
            Invite client
          </Button>
        }
      />

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Search" htmlFor="client-search" className="sm:flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <TextInput
                id="client-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search by shop, owner or email…"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Status" htmlFor="client-status" className="sm:w-44">
            <Select
              id="client-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </Field>
          <Field label="Sort by" htmlFor="client-sort" className="sm:w-44">
            <Select id="client-sort" value={sort} onChange={(event) => setSortKey(event.target.value)}>
              <option value="created">Registration date</option>
              <option value="name">Organisation name</option>
              <option value="status">Status</option>
              <option value="features">Enabled features</option>
              <option value="login">Last sign-in</option>
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
            <Spinner /> Loading clients…
          </div>
        ) : !data || data.clients.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<Users className="h-5 w-5 text-muted" aria-hidden="true" />}
              title={search || status !== 'all' ? 'No clients match these filters' : 'No clients yet'}
              description={
                search || status !== 'all'
                  ? 'Try a different search term or clear the status filter.'
                  : 'Invite your first shop to give it its own isolated workspace and feature set.'
              }
              action={
                <Button onClick={() => setInviteOpen(true)} icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}>
                  Invite client
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="mt-4 hidden overflow-hidden rounded-xl border border-line md:block">
              <table className="w-full border-collapse bg-white text-sm">
                <thead className="bg-canvas">
                  <tr className="border-b border-line">
                    {header('name', 'Organisation')}
                    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Owner
                    </th>
                    {header('status', 'Status')}
                    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Plan
                    </th>
                    {header('features', 'Features')}
                    {header('login', 'Last sign-in')}
                    <th scope="col" className="px-3 py-2.5" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.clients.map((client) => (
                    <tr key={client.id} className="transition-colors hover:bg-[#F0FDF4]">
                      <td className="px-3 py-3">
                        <Link
                          to={`/admin/clients/${client.id}`}
                          className="font-semibold text-ink hover:text-primary-dark hover:underline"
                        >
                          {client.name}
                        </Link>
                        <p className="mt-0.5 text-[11px] text-muted">
                          Registered {relativeTime(client.createdAt)}
                          {client.customized ? ' · custom access' : ''}
                        </p>
                      </td>
                      <td className="max-w-[200px] px-3 py-3">
                        <p className="truncate text-[13px] text-ink">{client.ownerName || '—'}</p>
                        <p className="truncate text-[11px] text-muted">{client.ownerEmail ?? '—'}</p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={client.status === 'active' ? 'ok' : 'crit'}>{client.status}</Badge>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-ink">{client.planName}</td>
                      <td className="tnum px-3 py-3 text-[13px] text-ink">
                        {client.enabledFeatures}/{client.totalFeatures}
                        {client.customized ? (
                          <Badge tone="info" className="ml-2">
                            custom
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-[12px] text-muted">
                        {client.lastLoginAt ? relativeTime(client.lastLoginAt) : 'Never'}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link to={`/admin/clients/${client.id}`} className="text-xs font-semibold text-primary-dark hover:underline">
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="mt-4 space-y-3 md:hidden">
              {data.clients.map((client) => (
                <li key={client.id} className="rounded-xl border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/admin/clients/${client.id}`} className="truncate font-semibold text-ink hover:underline">
                        {client.name}
                      </Link>
                      <p className="mt-0.5 truncate text-[11px] text-muted">{client.ownerEmail ?? 'No owner email'}</p>
                    </div>
                    <Badge tone={client.status === 'active' ? 'ok' : 'crit'}>{client.status}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-canvas px-2 py-1.5">
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Plan</dt>
                      <dd className="truncate text-xs font-semibold text-ink">{client.planName}</dd>
                    </div>
                    <div className="rounded-lg bg-canvas px-2 py-1.5">
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Features</dt>
                      <dd className="tnum text-xs font-semibold text-ink">
                        {client.enabledFeatures}/{client.totalFeatures}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-canvas px-2 py-1.5">
                      <dt className="text-[10px] uppercase tracking-wide text-muted">Sign-in</dt>
                      <dd className="truncate text-xs font-semibold text-ink">
                        {client.lastLoginAt ? relativeTime(client.lastLoginAt) : 'Never'}
                      </dd>
                    </div>
                  </dl>
                  <Link
                    to={`/admin/clients/${client.id}`}
                    className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
                  >
                    Manage client
                  </Link>
                </li>
              ))}
            </ul>

            {data.pages > 1 ? (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                <p className="text-xs text-muted">
                  Page {data.page} of {data.pages} · {data.total} client{data.total === 1 ? '' : 's'}
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

      <div className="flex items-start gap-2 rounded-xl border border-line bg-white px-4 py-3 text-xs leading-5 text-muted">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        Suspending a client blocks sign-in and revokes its sessions immediately, but never deletes its
        inventory or settings.
      </div>

      <InviteClientDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={() => reload()}
      />
    </div>
  );
}
