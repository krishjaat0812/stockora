import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Copy,
  KeyRound,
  MailPlus,
  Package,
  Pencil,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { relativeTime } from '../lib/date';
import { PLANS } from '../shared/features';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  InfoNote,
  Modal,
  Select,
  Spinner,
  TextInput,
} from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/toast';
import { adminApi, describeAudit, useAsync } from './adminApi';

function SetupLinkDialog({
  link,
  notice,
  onClose,
}: {
  link: string | null;
  notice?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <Modal open={Boolean(link)} onClose={onClose} title="Send the setup link" size="sm">
      <div className="space-y-4">
        <div className="rounded-xl border border-warn/30 bg-warn-soft p-3 text-xs leading-5 text-[#78350F]">
          {notice ??
            'Send this secure link to the client. It expires in 14 days and can only be used once. No password was created — the client chooses their own.'}
        </div>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            value={link ?? ''}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Account setup link"
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink"
          />
          <Button
            onClick={() => {
              void navigator.clipboard
                .writeText(link ?? '')
                .then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                })
                .catch(() => toast.error('Copy failed', 'Select and copy the link manually.'));
            }}
            icon={copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function ClientDetailPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => adminApi.client(id), [id]);

  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reinviteOpen, setReinviteOpen] = useState(false);
  const [reinviteEmail, setReinviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupResult, setSetupResult] = useState<{ link: string | null; notice?: string } | null>(null);

  // Administrator-managed password reset for one member of this client.
  const [passwordMember, setPasswordMember] = useState<{
    id: string;
    email: string;
    display_name: string;
  } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const openPasswordDialog = (member: { id: string; email: string; display_name: string }) => {
    setPasswordMember(member);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError(null);
  };

  const savePassword = async () => {
    if (!passwordMember) return;
    if (newPassword.length < 12) {
      setPasswordError('Use at least 12 characters — a passphrase works well.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The passwords do not match.');
      return;
    }
    setSavingPassword(true);
    setPasswordError(null);
    try {
      const result = await adminApi.setClientPassword(client.id, {
        userId: passwordMember.id,
        password: newPassword,
      });
      toast.success(
        'Password set',
        `${passwordMember.email} can sign in with the new password.` +
          (result.revokedSessions > 0
            ? ` ${result.revokedSessions} active session${result.revokedSessions === 1 ? '' : 's'} signed out.`
            : ''),
      );
      setPasswordMember(null);
      reload();
    } catch (err) {
      setPasswordError((err as Error).message);
    } finally {
      setSavingPassword(false);
    }
  };

  useEffect(() => {
    if (data?.invitations) {
      const pending = data.invitations.find((invitation) => !invitation.accepted_at);
      setReinviteEmail((current) => current || pending?.email || data.members.find((m) => m.role === 'owner')?.email || '');
    }
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
        <Spinner /> Loading client…
      </div>
    );
  }
  if (error || !data) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={<ArrowLeft className="h-5 w-5 text-muted" aria-hidden="true" />}
          title="Client not available"
          description={error ?? 'This client could not be loaded.'}
          action={
            <Link to="/admin/clients">
              <Button variant="secondary">Back to clients</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const { client, features, members, invitations, recentActivity, stats } = data;
  const enabled = features.filter((feature) => feature.effective);

  const patchClient = async (body: { name?: string; status?: string; planId?: string }, success: string) => {
    setBusy(true);
    try {
      const result = await adminApi.updateClient(client.id, body);
      if (result.revokedSessions > 0) {
        toast.success(success, `${result.revokedSessions} active session${result.revokedSessions === 1 ? '' : 's'} revoked.`);
      } else {
        toast.success(success);
      }
      reload();
    } catch (err) {
      toast.error('Update failed', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link to="/admin/clients" className="inline-flex items-center gap-1 font-semibold text-primary-dark hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Clients
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-ink">{client.name}</span>
      </div>

      <PageHeader
        title={client.name}
        description={
          <>
            Registered {relativeTime(client.createdAt)} · Plan{' '}
            <span className="font-semibold text-ink">{client.planName}</span>
          </>
        }
        actions={
          <>
            <Badge tone={client.status === 'active' ? 'ok' : 'crit'}>
              {client.status === 'active' ? 'Active' : 'Suspended'}
            </Badge>
            <Button
              variant="secondary"
              icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                setNewName(client.name);
                setRenameOpen(true);
              }}
            >
              Rename
            </Button>
            <Button
              variant={client.status === 'active' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => setSuspendOpen(true)}
            >
              {client.status === 'active' ? 'Suspend access' : 'Reactivate'}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Products', value: stats.productCount ?? '—', icon: <Package className="h-4 w-4" aria-hidden="true" /> },
          { label: 'Members', value: stats.memberCount, icon: <Users className="h-4 w-4" aria-hidden="true" /> },
          { label: 'Enabled features', value: `${enabled.length}/${features.length}`, icon: <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> },
          { label: 'Permission overrides', value: stats.overrideCount, icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" /> },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-line bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{card.label}</p>
              <span className="text-primary" aria-hidden="true">
                {card.icon}
              </span>
            </div>
            <p className="tnum mt-1.5 text-xl font-bold text-ink">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Feature access</h2>
              <p className="mt-0.5 text-xs text-muted">
                {stats.overrideCount > 0
                  ? `${stats.overrideCount} override${stats.overrideCount === 1 ? '' : 's'} on top of the ${client.planName} plan.`
                  : `Following the ${client.planName} plan defaults.`}
              </p>
            </div>
            <Link to={`/admin/features?client=${client.id}`}>
              <Button size="sm" variant="secondary" icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}>
                Manage features
              </Button>
            </Link>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {features.map((feature) => (
              <li key={feature.id}>
                <Badge tone={feature.effective ? 'ok' : 'neutral'} title={feature.description}>
                  {feature.effective ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                  {feature.label}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Plan</h2>
              <p className="mt-0.5 text-xs text-muted">Changing the plan re-bases the default feature set.</p>
            </div>
            <Field label="" htmlFor="client-plan" className="w-44">
              <Select
                id="client-plan"
                value={client.planId}
                disabled={busy}
                onChange={(event) => void patchClient({ planId: event.target.value }, 'Plan updated')}
              >
                {PLANS.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Owner invitation</h3>
                <p className="mt-0.5 text-xs text-muted">
                  {invitations.some((invitation) => !invitation.accepted_at)
                    ? 'An invitation is still pending.'
                    : 'All invitations accepted.'}
                </p>
              </div>
              <Button size="sm" variant="secondary" icon={<MailPlus className="h-4 w-4" aria-hidden="true" />} onClick={() => setReinviteOpen(true)}>
                New setup link
              </Button>
            </div>
            <ul className="mt-3 space-y-2">
              {members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{member.display_name}</p>
                    <p className="truncate text-[11px] text-muted">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={member.status === 'active' ? 'ok' : member.status === 'invited' ? 'warn' : 'crit'}>
                      {member.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
                      disabled={member.status !== 'active'}
                      title={
                        member.status === 'active'
                          ? 'Set a new password for this account'
                          : member.status === 'invited'
                            ? 'Send a setup link until the invitation is accepted'
                            : 'Reactivate the account first'
                      }
                      onClick={() => openPasswordDialog(member)}
                    >
                      Set password
                    </Button>
                  </div>
                </li>
              ))}
              {members.length === 0 ? (
                <li className="text-xs text-muted">No members yet — send a setup link to create the owner account.</li>
              ) : null}
            </ul>
            <div className="mt-3">
              <InfoNote tone="info" icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
                Passwords are managed here: the client app has no password-change form, so an
                administrator sets each account's password. Setting one signs that account out of
                every active session.
              </InfoNote>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
        <p className="mt-0.5 text-xs text-muted">Audit events for this organisation.</p>
        {recentActivity.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              compact
              icon={<CalendarClock className="h-4 w-4 text-muted" aria-hidden="true" />}
              title="No recorded activity"
              description="Sign-ins, permission changes and status changes will appear here."
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {recentActivity.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">{describeAudit(entry)}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {entry.actorEmail ?? 'system'} · {relativeTime(entry.at)}
                  </p>
                </div>
                <Badge tone={entry.outcome === 'success' ? 'ok' : 'crit'}>{entry.outcome}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Rename dialog */}
      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename organisation"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() => {
                if (newName.trim().length < 2) {
                  toast.error('Invalid name', 'Enter at least 2 characters.');
                  return;
                }
                void patchClient({ name: newName.trim() }, 'Organisation renamed').then(() => setRenameOpen(false));
              }}
            >
              Save name
            </Button>
          </>
        }
      >
        <Field label="Organisation name" htmlFor="rename-input" required>
          <TextInput id="rename-input" value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus />
        </Field>
      </Modal>

      {/* Suspend / reactivate confirmation */}
      <ConfirmDialog
        open={suspendOpen}
        title={client.status === 'active' ? `Suspend ${client.name}?` : `Reactivate ${client.name}?`}
        message={
          client.status === 'active' ? (
            <div className="space-y-2">
              <p>
                The owner will be signed out immediately and every API request from this
                organisation will be rejected until you reactivate it.
              </p>
              <p className="font-medium text-ink">
                Inventory, settings and reports are kept — nothing is deleted.
              </p>
            </div>
          ) : (
            <p>The owner will be able to sign in again with their existing account and password.</p>
          )
        }
        confirmLabel={client.status === 'active' ? 'Suspend client' : 'Reactivate client'}
        destructive={client.status === 'active'}
        onCancel={() => setSuspendOpen(false)}
        onConfirm={() => {
          setSuspendOpen(false);
          void patchClient(
            { status: client.status === 'active' ? 'suspended' : 'active' },
            client.status === 'active' ? 'Client suspended' : 'Client reactivated',
          );
        }}
      />

      {/* Re-invite dialog */}
      <Modal
        open={reinviteOpen}
        onClose={() => setReinviteOpen(false)}
        title="Issue a new setup link"
        description="Use this if the original invitation link was lost or expired. The old link stops working once the new one is used."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReinviteOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() => {
                setBusy(true);
                adminApi
                  .reinvite(client.id, { email: reinviteEmail, ownerName: client.name })
                  .then((result) => {
                    setSetupResult({ link: result.setupLink ?? null, notice: result.devNotice });
                    setReinviteOpen(false);
                    reload();
                  })
                  .catch((err: Error) => toast.error('Could not create link', err.message))
                  .finally(() => setBusy(false));
              }}
            >
              Create link
            </Button>
          </>
        }
      >
        <Field label="Owner email" htmlFor="reinvite-email" required hint="The account-setup link is bound to this address.">
          <TextInput
            id="reinvite-email"
            type="email"
            value={reinviteEmail}
            onChange={(event) => setReinviteEmail(event.target.value)}
          />
        </Field>
      </Modal>

      <SetupLinkDialog
        link={setupResult?.link ?? null}
        notice={setupResult?.notice}
        onClose={() => setSetupResult(null)}
      />

      {/* Administrator sets a client password */}
      <Modal
        open={Boolean(passwordMember)}
        onClose={() => setPasswordMember(null)}
        title="Set password"
        description={passwordMember ? `Choose a new password for ${passwordMember.email}.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasswordMember(null)}>
              Cancel
            </Button>
            <Button loading={savingPassword} onClick={() => void savePassword()}>
              Set password
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {passwordError ? (
            <div
              className="rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]"
              role="alert"
            >
              {passwordError}
            </div>
          ) : null}
          <Field
            label="New password"
            htmlFor="admin-new-password"
            hint="At least 12 characters — the server applies the organisation's password policy."
            required
          >
            <TextInput
              id="admin-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              autoFocus
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="admin-confirm-password" required>
            <TextInput
              id="admin-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>
          <InfoNote tone="warn">
            The account is signed out of every session immediately, and the change is written to
            the security audit trail. The old password stops working at once.
          </InfoNote>
        </div>
      </Modal>
    </div>
  );
}
