import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';
import { relativeTime } from '../lib/date';
import { Badge, Button, Card, EmptyState, SectionCard, Spinner } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { adminApi, describeAudit, useAsync, type AuditEntry } from './adminApi';

function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'primary',
  to,
}: {
  label: string;
  value: number | string;
  hint: string;
  icon: React.ReactNode;
  tone?: 'primary' | 'warn' | 'crit' | 'info';
  to?: string;
}) {
  const tones = {
    primary: 'bg-primary-soft text-primary-dark',
    warn: 'bg-warn-soft text-[#92400E]',
    crit: 'bg-crit-soft text-[#991B1B]',
    info: 'bg-info-soft text-[#1E40AF]',
  } as const;
  const body = (
    <div className="flex h-full flex-col rounded-xl border border-line bg-white p-4 shadow-card transition-colors hover:border-[#CBD5E1]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`} aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="tnum mt-2 text-2xl font-bold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted">{hint}</p>
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

function AuditLine({ entry }: { entry: AuditEntry }) {
  const failed = entry.outcome !== 'success';
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-ink">
          {describeAudit(entry)}
          {entry.targetId ? <span className="text-muted"> · {entry.targetId}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted">
          {entry.actorEmail ?? 'system'} · {relativeTime(entry.at)}
        </p>
      </div>
      <Badge tone={failed ? 'crit' : entry.outcome === 'denied' ? 'warn' : 'ok'}>
        {entry.outcome}
      </Badge>
    </li>
  );
}

export default function AdminDashboard() {
  const { data, error, loading, reload } = useAsync(() => adminApi.metrics(), []);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Admin dashboard"
        description="Live figures from the Stockora database: clients, accounts, permissions and security events."
        actions={
          <>
            <Link to="/admin/clients?invite=1">
              <Button icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}>Invite client</Button>
            </Link>
            <Link to="/admin/features">
              <Button variant="secondary" icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}>
                Feature access
              </Button>
            </Link>
          </>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
          <Spinner /> Loading metrics…
        </div>
      ) : error ? (
        <Card className="p-6">
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5 text-crit" aria-hidden="true" />}
            title="Could not load metrics"
            description={error}
            action={<Button variant="secondary" onClick={reload}>Retry</Button>}
          />
        </Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-6">
            <MetricCard
              label="Total clients"
              value={data.totalClients}
              hint="Registered organisations"
              icon={<Users className="h-4 w-4" aria-hidden="true" />}
              to="/admin/clients"
            />
            <MetricCard
              label="Active"
              value={data.activeClients}
              hint="Can sign in and use features"
              icon={<Activity className="h-4 w-4" aria-hidden="true" />}
              to="/admin/clients?status=active"
            />
            <MetricCard
              label="Suspended"
              value={data.suspendedClients}
              hint="Access blocked, data kept"
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
              tone="crit"
              to="/admin/clients?status=suspended"
            />
            <MetricCard
              label="Registered users"
              value={data.totalUsers}
              hint={`${data.ownerUsers} owners · ${data.adminUsers} admins`}
              icon={<Users className="h-4 w-4" aria-hidden="true" />}
              to="/admin/security"
            />
            <MetricCard
              label="Custom access"
              value={data.customizedClients}
              hint="Clients deviating from plan defaults"
              icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
              tone="info"
              to="/admin/features"
            />
            <MetricCard
              label="Pending invites"
              value={data.pendingInvitations}
              hint="Account-setup links not yet used"
              icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
              tone="warn"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard
              title="Recent administrative actions"
              description="Client, permission and policy changes."
              icon={<ScrollText className="h-4 w-4" aria-hidden="true" />}
              action={
                <Link to="/admin/audit-logs" className="text-xs font-semibold text-primary-dark hover:underline">
                  View all
                </Link>
              }
            >
              {data.recentActions.length === 0 ? (
                <EmptyState
                  compact
                  icon={<ScrollText className="h-4 w-4 text-muted" aria-hidden="true" />}
                  title="No activity yet"
                  description="Administrative changes will appear here as they happen."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {data.recentActions.map((entry) => (
                    <AuditLine key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Recent security events"
              description="Sign-ins, password changes and denials."
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
              action={
                <Link to="/admin/audit-logs" className="text-xs font-semibold text-primary-dark hover:underline">
                  View all
                </Link>
              }
            >
              {data.securityEvents.length === 0 ? (
                <EmptyState
                  compact
                  icon={<ShieldCheck className="h-4 w-4 text-muted" aria-hidden="true" />}
                  title="No security events"
                  description="Sign-ins, failed attempts and password changes will appear here."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {data.securityEvents.map((entry) => (
                    <AuditLine key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Permission changes"
              description="Latest feature-access updates."
              icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
              action={
                <Link to="/admin/features" className="text-xs font-semibold text-primary-dark hover:underline">
                  Manage
                </Link>
              }
            >
              {data.recentPermissionChanges.length === 0 ? (
                <EmptyState
                  compact
                  icon={<SlidersHorizontal className="h-4 w-4 text-muted" aria-hidden="true" />}
                  title="No permission changes"
                  description="Feature grants and revocations are recorded here."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {data.recentPermissionChanges.map((entry) => (
                    <AuditLine key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </>
      ) : null}
    </div>
  );
}
