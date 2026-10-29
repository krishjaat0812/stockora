import { useEffect, useState, type FormEvent } from 'react';
import { Check, KeyRound, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { relativeTime } from '../lib/date';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InfoNote,
  Modal,
  NumberInput,
  Select,
  Spinner,
  TextInput,
} from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/toast';
import { useAuth } from '../auth/AuthContext';
import { adminApi, CAPABILITY_LABELS, useAsync, type StaffMember } from './adminApi';

function PolicyForm() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => adminApi.securityPolicy(), []);
  const [form, setForm] = useState({
    minLength: 12,
    sessionTtlHours: 168,
    loginMaxAttempts: 5,
    loginWindowMinutes: 15,
    resetTtlMinutes: 30,
    allowClientPasswordChange: true,
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        minLength: data.minLength,
        sessionTtlHours: data.sessionTtlHours,
        loginMaxAttempts: data.loginMaxAttempts,
        loginWindowMinutes: data.loginWindowMinutes,
        resetTtlMinutes: data.resetTtlMinutes,
        allowClientPasswordChange: data.allowClientPasswordChange,
      });
      setDirty(false);
    }
  }, [data]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await adminApi.saveSecurityPolicy(form);
      toast.success('Security policy updated', 'New limits apply to future sign-ins and resets.');
      setDirty(false);
      reload();
    } catch (err) {
      toast.error('Save failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted" role="status">
          <Spinner /> Loading policy…
        </div>
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="p-6">
        <div className="rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
          {error}
        </div>
      </Card>
    );
  }

  const update = (key: keyof typeof form, value: number) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const toggleClientPasswordChange = () => {
    setForm((current) => ({
      ...current,
      allowClientPasswordChange: !current.allowClientPasswordChange,
    }));
    setDirty(true);
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Password &amp; session policy</h2>
          <p className="mt-0.5 text-xs text-muted">
            Enforced by the server on every sign-in, reset and session check.
          </p>
        </div>
        <Badge tone="primary" title="Password hashing algorithm">
          {data?.hashing}
        </Badge>
      </div>

      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Minimum password length"
          htmlFor="policy-min"
          hint="Length-based so passphrases stay easy to use."
        >
          <NumberInput
            id="policy-min"
            min={8}
            max={128}
            value={form.minLength}
            onChange={(event) => update('minLength', Number(event.target.value))}
          />
        </Field>
        <Field label="Session lifetime (hours)" htmlFor="policy-ttl" hint="168 hours = 7 days.">
          <NumberInput
            id="policy-ttl"
            min={1}
            max={720}
            value={form.sessionTtlHours}
            onChange={(event) => update('sessionTtlHours', Number(event.target.value))}
          />
        </Field>
        <Field
          label="Max sign-in attempts"
          htmlFor="policy-attempts"
          hint="Per email + IP before the pair is locked out."
        >
          <NumberInput
            id="policy-attempts"
            min={3}
            max={50}
            value={form.loginMaxAttempts}
            onChange={(event) => update('loginMaxAttempts', Number(event.target.value))}
          />
        </Field>
        <Field label="Sign-in attempt window (minutes)" htmlFor="policy-window">
          <NumberInput
            id="policy-window"
            min={1}
            max={240}
            value={form.loginWindowMinutes}
            onChange={(event) => update('loginWindowMinutes', Number(event.target.value))}
          />
        </Field>
        <Field label="Reset link lifetime (minutes)" htmlFor="policy-reset" hint="Single-use, expiring links.">
          <NumberInput
            id="policy-reset"
            min={5}
            max={1440}
            value={form.resetTtlMinutes}
            onChange={(event) => update('resetTtlMinutes', Number(event.target.value))}
          />
        </Field>
        <div className="sm:col-span-2">
          <div className="rounded-xl border border-line bg-canvas p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  Allow clients to change their own passwords
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted">
                  {form.allowClientPasswordChange
                    ? 'The self-service endpoint stays open for API clients. The client app has no password form — an administrator sets each password from the client page.'
                    : 'Every client account is blocked from changing its own password. Administrators set passwords from the client page, and per-client exceptions can be granted there.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.allowClientPasswordChange}
                aria-label="Allow clients to change their own passwords"
                onClick={toggleClientPasswordChange}
                className={`h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  form.allowClientPasswordChange ? 'bg-primary' : 'bg-line'
                }`}
                style={{ position: 'relative' }}
              >
                <span
                  aria-hidden="true"
                  className={
                    form.allowClientPasswordChange
                      ? 'absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-card'
                      : 'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-card'
                  }
                />
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-end justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" disabled={!dirty} onClick={() => reload()}>
            Discard
          </Button>
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save policy
          </Button>
        </div>
      </form>

      <div className="mt-4">
        <InfoNote tone="info" icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
          Passwords are stored only as PBKDF2-SHA-256 hashes with a per-user salt and{' '}
          {(data?.hashing ?? '').replace('PBKDF2-SHA-256, ', '')}. Reset and invitation tokens are
          stored hashed, expire automatically and are single-use. No plaintext password or token is
          ever stored, logged or shown to an administrator.
        </InfoNote>
      </div>
    </Card>
  );
}

/**
 * Per-client override for the self-service password-change policy. The
 * effective value is what the Worker enforces on /api/auth/change-password.
 */
function ClientPasswordPolicyCard() {
  const toast = useToast();
  const clientsState = useAsync(
    () => adminApi.clients(new URLSearchParams({ pageSize: '100', sort: 'name' })),
    [],
  );
  const clients = clientsState.data?.clients ?? [];
  const [clientId, setClientId] = useState('');
  const policyState = useAsync(
    () => adminApi.clientPasswordPolicy(clientId),
    [clientId],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clientId && clients.length > 0) setClientId(clients[0].id);
  }, [clients, clientId]);

  const policy = policyState.data;
  const clientName = clients.find((client) => client.id === clientId)?.name ?? 'this client';

  const save = async (value: 'inherit' | 'allow' | 'deny') => {
    if (!clientId) return;
    setSaving(true);
    try {
      await adminApi.saveClientPasswordPolicy(clientId, value);
      policyState.reload();
      toast.success(
        'Client password policy saved',
        `${clientName} now ${
          value === 'inherit'
            ? 'follows the global policy'
            : value === 'allow'
              ? 'may change its own password'
              : 'may not change its own password'
        }.`,
      );
    } catch (err) {
      toast.error('Save failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const options: Array<{ value: 'inherit' | 'allow' | 'deny'; label: string }> = [
    { value: 'inherit', label: 'Follow global policy' },
    { value: 'allow', label: 'Always allow' },
    { value: 'deny', label: 'Always deny' },
  ];

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink">Client Authentication &amp; Password Policies</h2>
        <p className="mt-0.5 text-xs text-muted">
          The global switch above is the default. Use this to make an exception for one client.
        </p>
      </div>

      {!clientId ? (
        <p className="text-sm text-muted">
          {clientsState.loading ? 'Loading clients…' : 'No clients to configure yet.'}
        </p>
      ) : policyState.loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted" role="status">
          <Spinner /> Loading policy…
        </div>
      ) : policyState.error ? (
        <div className="rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
          {policyState.error}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Client organisation" htmlFor="password-policy-client">
            <Select
              id="password-policy-client"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={clientsState.loading}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} · {client.planName}
                </option>
              ))}
            </Select>
          </Field>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Self-service password change
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Password change policy">
              {options.map((option) => {
                const active = policy?.override === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={saving}
                    aria-pressed={active}
                    onClick={() => void save(option.value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active
                        ? 'border-primary bg-primary text-white'
                        : 'border-line bg-white text-muted hover:bg-canvas hover:text-ink'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <InfoNote tone={policy?.effective ? 'info' : 'warn'}>
            Currently, users in {clientName}{' '}
            <strong className="font-semibold text-ink">
              {policy?.effective ? 'can' : 'cannot'}
            </strong>{' '}
            change their own password
            {policy?.override === 'inherit'
              ? ` (following the global policy, which is ${policy.globalDefault ? 'on' : 'off'})`
              : ' (explicit override)'}
            . The server rejects the request on /api/auth/change-password — and the client app
            now carries no password-change form at all, so administrators set passwords from the
            client page. Reset links are a separate workflow and stay available either way.
          </InfoNote>
        </div>
      )}
    </Card>
  );
}

function InviteStaffDialog({
  open,
  onClose,
  capabilityCatalog,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  capabilityCatalog: string[];
  onInvited: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>(['clients:read', 'audit:read']);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ link?: string; notice?: string } | null>(null);

  useEffect(() => {
    if (open) {
      setEmail('');
      setDisplayName('');
      setCapabilities(['clients:read', 'audit:read']);
      setResult(null);
    }
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Invalid email', 'Enter a valid email address.');
      return;
    }
    if (displayName.trim().length < 2) {
      toast.error('Name required', 'Enter the administrator’s name.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await adminApi.inviteStaff({
        email: email.trim().toLowerCase(),
        displayName: displayName.trim(),
        capabilities,
      });
      setResult({ link: response.setupLink, notice: response.devNotice });
      onInvited();
    } catch (err) {
      toast.error('Invitation failed', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={result ? 'Administrator invited' : 'Invite an administrator'}
      description={
        result ? undefined : 'They receive a setup link and choose their own password. You never see it.'
      }
      size="sm"
    >
      {result ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-warn/30 bg-warn-soft p-3 text-xs leading-5 text-[#78350F]">
            {result.notice ?? 'Send this setup link to the administrator. It expires in 14 days and works once.'}
          </div>
          <input
            readOnly
            value={result.link ?? ''}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Administrator setup link"
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink"
          />
          <Button
            className="w-full"
            onClick={() => {
              void navigator.clipboard.writeText(result.link ?? '');
              toast.success('Link copied');
            }}
            icon={<Check className="h-4 w-4" aria-hidden="true" />}
          >
            Copy link
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name" htmlFor="staff-name" required>
            <TextInput id="staff-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. Neha Gupta" />
          </Field>
          <Field label="Email" htmlFor="staff-email" required>
            <TextInput id="staff-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@stockora.dev" />
          </Field>
          <fieldset>
            <legend className="field-label">Permissions</legend>
            <ul className="mt-1 space-y-2">
              {capabilityCatalog.map((capability) => (
                <li key={capability} className="flex items-start gap-2.5">
                  <input
                    id={`cap-${capability}`}
                    type="checkbox"
                    checked={capabilities.includes(capability)}
                    onChange={(event) =>
                      setCapabilities((current) =>
                        event.target.checked
                          ? [...current, capability]
                          : current.filter((item) => item !== capability),
                      )
                    }
                    className="mt-0.5 h-4 w-4 rounded border-line accent-[#15803D]"
                  />
                  <label htmlFor={`cap-${capability}`} className="cursor-pointer text-sm text-ink">
                    <span className="font-semibold">{capability}</span>
                    <span className="block text-xs text-muted">{CAPABILITY_LABELS[capability]}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}>
              Create invitation
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditStaffDialog({
  member,
  capabilityCatalog,
  onClose,
  onSaved,
}: {
  member: StaffMember | null;
  capabilityCatalog: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (member) setCapabilities(member.capabilities);
  }, [member]);

  if (!member) return null;

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.updateStaff(member.id, { capabilities });
      toast.success('Permissions updated', `${member.email} now holds: ${capabilities.join(', ') || 'none'}.`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Update failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Permissions — ${member.displayName}`}
      description={member.role === 'super_admin' ? 'Super Admin capabilities are fixed.' : 'Choose what this administrator may do.'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {member.role === 'super_admin' ? null : (
            <Button loading={saving} onClick={() => void save()}>
              Save permissions
            </Button>
          )}
        </>
      }
    >
      <ul className="space-y-2">
        {capabilityCatalog.map((capability) => {
          const locked = member.role === 'super_admin';
          return (
            <li key={capability} className="flex items-start gap-2.5">
              <input
                id={`edit-cap-${capability}`}
                type="checkbox"
                disabled={locked}
                checked={locked || capabilities.includes(capability)}
                onChange={(event) =>
                  setCapabilities((current) =>
                    event.target.checked
                      ? [...current, capability]
                      : current.filter((item) => item !== capability),
                  )
                }
                className="mt-0.5 h-4 w-4 rounded border-line accent-[#15803D] disabled:opacity-50"
              />
              <label htmlFor={`edit-cap-${capability}`} className={locked ? 'cursor-not-allowed text-sm text-muted' : 'cursor-pointer text-sm text-ink'}>
                <span className="font-semibold">{capability}</span>
                <span className="block text-xs text-muted">{CAPABILITY_LABELS[capability]}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

export default function AdminSecurityPage() {
  const { user } = useAuth();
  const toast = useToast();
  const staffState = useAsync(() => adminApi.staff(), []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);

  const toggleStatus = async (member: StaffMember) => {
    try {
      await adminApi.updateStaff(member.id, {
        status: member.status === 'active' ? 'disabled' : 'active',
      });
      toast.success(
        member.status === 'active' ? 'Administrator disabled' : 'Administrator enabled',
        member.status === 'active' ? `${member.email} can no longer sign in.` : `${member.email} can sign in again.`,
      );
      staffState.reload();
    } catch (err) {
      toast.error('Update failed', (err as Error).message);
    }
  };

  const capabilityCatalog = staffState.data?.capabilityCatalog ?? Object.keys(CAPABILITY_LABELS);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Security & staff"
        description="Platform-wide password policy, session rules and the administrators who can manage clients."
      />

      <PolicyForm />

      <ClientPasswordPolicyCard />

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Users className="h-4 w-4 text-primary" aria-hidden="true" /> Administrative staff
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Granular capabilities — an admin who can view clients is not automatically allowed to
              change security settings.
            </p>
          </div>
          <Button size="sm" icon={<UserPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setInviteOpen(true)}>
            Invite administrator
          </Button>
        </div>

        {staffState.loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted" role="status">
            <Spinner /> Loading staff…
          </div>
        ) : staffState.error ? (
          <div className="rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
            {staffState.error}
          </div>
        ) : !staffState.data || staffState.data.staff.length === 0 ? (
          <EmptyState
            compact
            icon={<ShieldCheck className="h-4 w-4 text-muted" aria-hidden="true" />}
            title="No administrators"
            description="Invite an administrator to share management of clients and permissions."
          />
        ) : (
          <ul className="space-y-3">
            {staffState.data.staff.map((member) => (
              <li key={member.id} className="rounded-xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-ink">{member.displayName}</p>
                      <Badge tone={member.role === 'super_admin' ? 'primary' : 'info'}>
                        {member.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                      </Badge>
                      <Badge tone={member.status === 'active' ? 'ok' : member.status === 'invited' ? 'warn' : 'crit'}>
                        {member.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {member.email} ·{' '}
                      {member.lastLoginAt ? `last sign-in ${relativeTime(member.lastLoginAt)}` : 'never signed in'}
                      {member.status === 'invited' ? ' · invitation pending' : ''}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {member.role === 'super_admin' ? (
                        <li>
                          <Badge tone="primary">all capabilities</Badge>
                        </li>
                      ) : member.capabilities.length === 0 ? (
                        <li>
                          <Badge tone="neutral">no capabilities</Badge>
                        </li>
                      ) : (
                        member.capabilities.map((capability) => (
                          <li key={capability}>
                            <Badge tone="neutral">{capability}</Badge>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(member)}>
                      Permissions
                    </Button>
                    {user?.role === 'super_admin' && member.id !== user.id ? (
                      <Button
                        size="sm"
                        variant={member.status === 'active' ? 'danger' : 'primary'}
                        onClick={() => void toggleStatus(member)}
                      >
                        {member.status === 'active' ? 'Disable' : 'Enable'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {staffState.data && staffState.data.staff.length > 1 ? (
          <div className="mt-4">
            <InfoNote tone="warn" icon={<X className="h-4 w-4" aria-hidden="true" />}>
              Only a Super Admin can change another Super Admin’s account, and disabling an account
              revokes its sessions immediately.
            </InfoNote>
          </div>
        ) : null}
      </Card>

      <InviteStaffDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        capabilityCatalog={capabilityCatalog}
        onInvited={() => staffState.reload()}
      />
      <EditStaffDialog
        member={editing}
        capabilityCatalog={capabilityCatalog}
        onClose={() => setEditing(null)}
        onSaved={() => staffState.reload()}
      />
    </div>
  );
}
