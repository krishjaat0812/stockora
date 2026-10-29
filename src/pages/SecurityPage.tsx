import { useState } from 'react';
import { KeyRound, LogOut, ShieldCheck, UserRound, Copy, Check } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { FEATURE_IDS } from '../shared/features';
import { ApiError, apiPost } from '../auth/api';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, InfoNote, SectionCard } from '../components/ui';
import { useToast } from '../components/toast';

/**
 * Client-facing security page: account summary and session control.
 *
 * Password changes are deliberately NOT offered here — they are an
 * administrator action performed from the Admin Panel, so the client app
 * carries no password-change form at all. No email channel is configured
 * in this deployment, so no email is claimed.
 */
export default function SecurityPage() {
  const { user, org, permissions, logout } = useAuth();
  const toast = useToast();

  const [signingOutAll, setSigningOutAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const signOutEverywhere = async () => {
    setSigningOutAll(true);
    try {
      const result = await apiPost<{ revoked: number }>('/api/auth/logout-all');
      toast.success('Sessions revoked', `${result.revoked} session${result.revoked === 1 ? '' : 's'} signed out.`);
      await logout();
    } catch (err) {
      toast.error('Could not sign out', err instanceof ApiError ? err.message : 'Try again.');
      setSigningOutAll(false);
    }
  };

  const copyEmail = async () => {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the email is visible on screen anyway.
    }
  };

  const enabledCount = Object.values(permissions).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Account & security"
        description="Review your account details and active sessions."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Account"
          description="Your identity and organisation membership."
          icon={<UserRound className="h-4 w-4" aria-hidden="true" />}
        >
          <dl className="divide-y divide-line text-sm">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">Email</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-ink">{user?.email}</span>
                <button
                  type="button"
                  onClick={() => void copyEmail()}
                  className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Copy email address"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-ok" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">Name</dt>
              <dd className="font-medium text-ink">{user?.displayName || '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">Role</dt>
              <dd>
                <Badge tone={user?.role === 'owner' ? 'primary' : 'info'}>
                  {user?.role === 'super_admin' ? 'Super Admin' : user?.role === 'admin' ? 'Admin' : 'Client owner'}
                </Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">Organisation</dt>
              <dd className="truncate font-medium text-ink">{org?.name ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">Enabled features</dt>
              <dd className="tnum font-medium text-ink">
                {enabledCount} of {FEATURE_IDS.length}
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            <InfoNote tone="info" icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
              Passwords are managed by your administrator. There is no self-service password
              change here — contact your administrator to have your password set from the Admin
              Panel.
            </InfoNote>
          </div>
        </SectionCard>

        <SectionCard
          title="Sessions"
          description="Sign out everywhere if you suspect a session is compromised."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm leading-6 text-muted">
              Sessions expire automatically after your organisation's configured lifetime. Signing
              out everywhere revokes every session token immediately.
            </p>
            <Button
              variant="secondary"
              loading={signingOutAll}
              icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
              onClick={() => void signOutEverywhere()}
            >
              Sign out of all sessions
            </Button>
          </div>
        </SectionCard>
      </div>

      <Card className="p-4">
        <p className="text-xs leading-5 text-muted">
          Tip: export your inventory as CSV from the Inventory or Reports page before making bulk
          changes.
        </p>
      </Card>
    </div>
  );
}
