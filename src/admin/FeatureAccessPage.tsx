import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, RotateCcw, Save, SlidersHorizontal, Users } from 'lucide-react';
import { relativeTime } from '../lib/date';
import {
  ACTIONS,
  ACTION_DESCRIPTIONS,
  ACTION_LABELS,
  FEATURES,
  FEATURE_IDS,
  GROUP_LABELS,
  dependentFeatures,
  type ActionId,
  type FeatureGroup,
  type FeatureId,
} from '../shared/features';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  InfoNote,
  Select,
  Spinner,
  TextInput,
} from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/toast';
import { adminApi, useAsync, type FeatureActionSelection, type FeatureAccessRow } from './adminApi';

type StatusFilter = 'all' | 'enabled' | 'disabled' | 'restricted';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All features' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'restricted', label: 'Partly restricted' },
];

function defaultActionMap(row: FeatureAccessRow): Partial<Record<ActionId, boolean>> {
  const map: Partial<Record<ActionId, boolean>> = {};
  for (const action of row.supportedActions) map[action] = true;
  return { ...map, ...row.actionOverrides };
}

function actionMapEqual(a: Partial<Record<ActionId, boolean>>, b: Partial<Record<ActionId, boolean>>) {
  return ACTIONS.every((action) => Boolean(a[action]) === Boolean(b[action]));
}

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={checked ? 'h-6 w-11 rounded-full bg-primary transition-colors' : 'h-6 w-11 rounded-full bg-line transition-colors'}
      style={{ position: 'relative' }}
    >
      <span
        className={checked ? 'absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-card' : 'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-card'}
        aria-hidden="true"
      />
    </button>
  );
}

function sourceBadge(row: { planDefault: boolean; override: boolean | null }) {
  if (row.override === true) return <Badge tone="ok">Override · granted</Badge>;
  if (row.override === false) return <Badge tone="crit">Override · denied</Badge>;
  return <Badge tone="primary">Plan default</Badge>;
}

export default function FeatureAccessPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const clientsState = useAsync(
    () => adminApi.clients(new URLSearchParams({ pageSize: '100', sort: 'name' })),
    [],
  );
  const plansState = useAsync(() => adminApi.plans(), []);

  const [clientId, setClientId] = useState(searchParams.get('client') ?? '');
  const [tab, setTab] = useState<'client' | 'plans'>('client');
  const [planId, setPlanId] = useState('starter');
  const [draft, setDraft] = useState<Record<FeatureId, boolean> | null>(null);
  const [baseline, setBaseline] = useState<Record<FeatureId, boolean> | null>(null);
  const [rows, setRows] = useState<FeatureAccessRow[]>([]);
  const [planName, setPlanName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState<{ feature: FeatureId; affected: FeatureId[] } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [actionDraft, setActionDraft] = useState<FeatureActionSelection | null>(null);
  const [actionBaseline, setActionBaseline] = useState<FeatureActionSelection>({});
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pendingChanges, setPendingChanges] = useState<string[] | null>(null);

  const clients = clientsState.data?.clients ?? [];

  // Default to the first client when none is selected.
  useEffect(() => {
    if (!clientId && clients.length > 0) setClientId(clients[0].id);
  }, [clients, clientId]);

  useEffect(() => {
    const param = searchParams.get('client');
    if (param) setClientId(param);
  }, [searchParams]);

  const loadFeatures = async (id: string, keepDraft = false) => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const payload = await adminApi.clientFeatures(id);
      setRows(payload.features);
      setPlanName(payload.planName);
      const effective = Object.fromEntries(
        payload.features.map((row) => [row.id, row.effective]),
      ) as Record<FeatureId, boolean>;
      const actions = Object.fromEntries(
        payload.features.map((row) => [row.id, defaultActionMap(row)]),
      ) as FeatureActionSelection;
      if (!keepDraft) {
        setDraft({ ...effective });
        setActionDraft(actions);
      }
      setBaseline(effective);
      setActionBaseline(actions);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFeatures(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Keep the URL shareable.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (clientId) next.set('client', clientId);
    else next.delete('client');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const featureDirty = useMemo(() => {
    if (!draft || !baseline) return false;
    return FEATURE_IDS.some((id) => draft[id] !== baseline[id]);
  }, [draft, baseline]);

  const actionDirty = useMemo(() => {
    if (!actionDraft) return false;
    return Object.keys(actionDraft).some((key) => {
      const feature = key as FeatureId;
      return !actionMapEqual(actionDraft[feature] ?? {}, actionBaseline[feature] ?? {});
    });
  }, [actionDraft, actionBaseline]);

  const dirty = featureDirty || actionDirty;

  const lastModified = useMemo(() => {
    const stamps = rows.map((row) => row.updatedAt).filter(Boolean) as string[];
    return stamps.sort().pop() ?? null;
  }, [rows]);

  const applyToggle = (feature: FeatureId, value: boolean) => {
    if (!draft) return;
    if (!value) {
      const affected = dependentFeatures(feature, FEATURE_IDS.filter((id) => draft[id]));
      if (affected.length > 0) {
        setConfirmDisable({ feature, affected });
        return;
      }
      setDraft({ ...draft, [feature]: false });
      return;
    }
    // Enabling requires the feature's dependencies to be enabled as well.
    const definition = FEATURES.find((item) => item.id === feature);
    const missing = (definition?.dependencies ?? []).filter((dep) => !draft[dep]);
    if (missing.length > 0) {
      toast.error(
        'Dependency required',
        `${definition?.label} requires ${missing
          .map((dep) => FEATURES.find((item) => item.id === dep)?.label ?? dep)
          .join(', ')} to be enabled first.`,
      );
      return;
    }
    setDraft({ ...draft, [feature]: true });
  };

  const groupSet = (group: FeatureGroup, value: boolean) => {
    if (!draft) return;
    const next = { ...draft };
    const groupFeatures = FEATURES.filter((feature) => feature.group === group);
    if (value) {
      for (const feature of groupFeatures) {
        const depsOk = feature.dependencies.every((dep) => next[dep]);
        if (depsOk) next[feature.id] = true;
      }
    } else {
      // Turning a group off may cascade; confirm once for the whole group.
      const affected = new Set<FeatureId>();
      for (const feature of groupFeatures) {
        if (!next[feature.id]) continue;
        for (const dep of dependentFeatures(feature.id, FEATURE_IDS.filter((id) => next[id]))) {
          affected.add(dep);
        }
      }
      for (const feature of groupFeatures) next[feature.id] = false;
      for (const dep of affected) {
        // Only clear dependents that live outside the group being disabled.
        if (!groupFeatures.some((feature) => feature.id === dep)) next[dep] = false;
      }
      setDraft(next);
      if (affected.size > 0) {
        toast.info('Related features updated', 'Dependent features outside this group were turned off too.');
      }
      return;
    }
    setDraft(next);
  };

  const featureLabel = (id: FeatureId) => FEATURES.find((item) => item.id === id)?.label ?? id;

  /** Every pending change, in plain language, for the pre-save review. */
  const buildChangeList = (): string[] => {
    const list: string[] = [];
    if (draft && baseline) {
      for (const id of FEATURE_IDS) {
        if (draft[id] !== baseline[id]) {
          list.push(`${featureLabel(id)}: ${draft[id] ? 'enable' : 'disable'}`);
        }
      }
    }
    if (actionDraft) {
      for (const key of Object.keys(actionDraft)) {
        const feature = key as FeatureId;
        const next = actionDraft[feature] ?? {};
        const prev = actionBaseline[feature] ?? {};
        for (const action of ACTIONS) {
          if (Boolean(next[action]) !== Boolean(prev[action])) {
            list.push(
              `${featureLabel(feature)} · ${ACTION_LABELS[action]}: ${next[action] ? 'allow' : 'block'}`,
            );
          }
        }
      }
    }
    return list;
  };

  const requestSave = () => {
    if (!draft || !clientId) return;
    const changes = buildChangeList();
    if (changes.length === 0) {
      toast.success('No changes to apply', 'This client already matches what is saved.');
      return;
    }
    setPendingChanges(changes);
  };

  const save = async () => {
    if (!draft || !clientId) return;
    const selection = FEATURE_IDS.filter((id) => draft[id]);
    setSaving(true);
    try {
      const result = await adminApi.saveClientFeatures(clientId, selection, actionDraft ?? undefined);
      setRows(result.features);
      setPlanName(result.planName);
      const effective = Object.fromEntries(
        result.features.map((row) => [row.id, row.effective]),
      ) as Record<FeatureId, boolean>;
      const restored = Object.fromEntries(
        result.features.map((row) => [row.id, defaultActionMap(row)]),
      ) as FeatureActionSelection;
      setDraft({ ...effective });
      setBaseline({ ...effective });
      setActionDraft(restored);
      setActionBaseline(restored);
      const changes = result.changed;
      toast.success(
        'Feature access saved',
        changes.length === 0
          ? 'Permissions saved.'
          : changes
              .map((change) => `${FEATURES.find((f) => f.id === change.feature)?.label}: ${change.to ? 'enabled' : 'disabled'}`)
              .join(' · '),
      );
      clientsState.reload();
    } catch (err) {
      toast.error('Save failed', (err as Error).message);
    } finally {
      setSaving(false);
      setPendingChanges(null);
    }
  };

  const resetToPlan = async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      const result = await adminApi.resetClientFeatures(clientId);
      setRows(result.features);
      setPlanName(result.planName);
      const effective = Object.fromEntries(
        result.features.map((row) => [row.id, row.effective]),
      ) as Record<FeatureId, boolean>;
      const restored = Object.fromEntries(
        result.features.map((row) => [row.id, defaultActionMap(row)]),
      ) as FeatureActionSelection;
      setDraft({ ...effective });
      setBaseline({ ...effective });
      setActionDraft(restored);
      setActionBaseline(restored);
      toast.success('Reset to plan defaults', `All overrides cleared for ${result.planName}.`);
      clientsState.reload();
    } catch (err) {
      toast.error('Reset failed', (err as Error).message);
    } finally {
      setSaving(false);
      setResetOpen(false);
    }
  };

  const groups = Object.keys(GROUP_LABELS) as FeatureGroup[];

  const toggleAction = (feature: FeatureId, action: ActionId) => {
    if (!actionDraft) return;
    const current = actionDraft[feature] ?? {};
    const value = !current[action];
    const next: Partial<Record<ActionId, boolean>> = { ...current, [action]: value };
    // Mirror the server: View is the master switch, and granting any other
    // action implies the feature must be visible first.
    if (action === 'view' && !value) {
      for (const other of ACTIONS) if (other !== 'view') next[other] = false;
    }
    if (action !== 'view' && value) next.view = true;
    setActionDraft({ ...actionDraft, [feature]: next });
  };

  const visibleFeatures = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return FEATURES.filter((feature) => {
      if (needle && !`${feature.label} ${feature.description}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (statusFilter === 'all') return true;
      const row = rows.find((item) => item.id === feature.id);
      const enabled = draft ? draft[feature.id] : Boolean(row?.effective);
      const restricted = row
        ? row.supportedActions.some((action) => !row.actions[action])
        : false;
      if (statusFilter === 'enabled') return enabled;
      if (statusFilter === 'disabled') return !enabled;
      return enabled && restricted;
    });
  }, [query, statusFilter, rows, draft]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Feature access"
        description="Decide exactly which Stockora modules each client can use. Changes apply to signed-in clients immediately and are enforced by the server."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setResetOpen(true)}
              disabled={!clientId || loading}
            >
              Reset to plan defaults
            </Button>
            <Button
              icon={<Save className="h-4 w-4" aria-hidden="true" />}
              loading={saving}
              disabled={!dirty || loading}
              onClick={requestSave}
            >
              Save changes
            </Button>
          </>
        }
      />

      {/* Tab switch */}
      <div className="flex gap-1 rounded-xl border border-line bg-white p-1" role="tablist" aria-label="Feature access scope">
        {(
          [
            { id: 'client', label: 'Client access', icon: <Users className="h-4 w-4" aria-hidden="true" /> },
            { id: 'plans', label: 'Plan defaults', icon: <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-none ${
              tab === item.id ? 'bg-primary text-white' : 'text-muted hover:bg-canvas hover:text-ink'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'client' ? (
        <>
          <Card className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <Field label="Client organisation" htmlFor="feature-client" className="sm:max-w-md">
                <Select
                  id="feature-client"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  disabled={clientsState.loading}
                >
                  {clients.length === 0 ? <option value="">No clients yet</option> : null}
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} · {client.planName}
                      {client.status === 'suspended' ? ' (suspended)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="text-right text-xs text-muted">
                <p>
                  Plan: <span className="font-semibold text-ink">{planName || '—'}</span>
                </p>
                {lastModified ? <p>Last change {relativeTime(lastModified)}</p> : null}
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
                <Spinner /> Loading permissions…
              </div>
            ) : loadError ? (
              <div className="mt-4 rounded-xl border border-crit/25 bg-crit-soft px-4 py-3 text-sm font-medium text-[#7F1D1D]" role="alert">
                {loadError}
              </div>
            ) : !clientId ? (
              <div className="mt-4">
                <EmptyState
                  compact
                  icon={<Users className="h-4 w-4 text-muted" aria-hidden="true" />}
                  title="No client selected"
                  description="Invite a client first, then assign features here."
                  action={
                    <Link to="/admin/clients?invite=1">
                      <Button size="sm">Invite client</Button>
                    </Link>
                  }
                />
              </div>
            ) : draft ? (
              <>
                {dirty ? (
                  <div className="mt-4">
                    <InfoNote tone="warn" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
                      Unsaved changes. Signed-in users pick them up within seconds of saving — the
                      server rejects restricted operations immediately.
                    </InfoNote>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Field label="Search features" htmlFor="feature-search" className="sm:max-w-xs">
                    <TextInput
                      id="feature-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="e.g. inventory, export"
                    />
                  </Field>
                  <Field label="Show" htmlFor="feature-status" className="sm:max-w-xs">
                    <Select
                      id="feature-status"
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <p className="pb-2 text-xs text-muted">
                    {visibleFeatures.length} of {FEATURES.length} features shown
                  </p>
                </div>

                <div className="mt-5 space-y-6">
                  {groups.map((group) => (
                    <section
                      key={group}
                      aria-labelledby={`group-${group}`}
                      hidden={
                        !FEATURES.some(
                          (feature) =>
                            feature.group === group && visibleFeatures.includes(feature),
                        )
                      }
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 id={`group-${group}`} className="text-xs font-semibold uppercase tracking-wide text-muted">
                          {GROUP_LABELS[group]}
                        </h3>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => groupSet(group, true)}
                            className="text-[11px] font-semibold text-primary-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            Enable group
                          </button>
                          <span className="text-line" aria-hidden="true">
                            |
                          </span>
                          <button
                            type="button"
                            onClick={() => groupSet(group, false)}
                            className="text-[11px] font-semibold text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            Disable group
                          </button>
                        </div>
                      </div>
                      <ul className="overflow-hidden rounded-xl border border-line">
                        {FEATURES.filter(
                          (feature) =>
                            feature.group === group && visibleFeatures.includes(feature),
                        ).map((feature) => {
                          const row = rows.find((item) => item.id === feature.id);
                              const enabled = draft[feature.id];
                          return (
                            <li
                              key={feature.id}
                              className="flex flex-col gap-3 border-b border-line bg-white px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-ink">{feature.label}</p>
                                  {row ? sourceBadge(row) : null}
                                  {row?.override !== null && row?.override !== undefined ? (
                                    <Badge tone="neutral" title="When this permission was last changed">
                                      {row.updatedAt ? relativeTime(row.updatedAt) : ''}
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-0.5 text-xs leading-5 text-muted">{feature.description}</p>
                                {feature.dependencies.length > 0 ? (
                                  <p className="mt-0.5 text-[11px] text-muted/80">
                                    Requires{' '}
                                    {feature.dependencies
                                      .map((dep) => FEATURES.find((item) => item.id === dep)?.label ?? dep)
                                      .join(', ')}
                                  </p>
                                ) : null}
                                {enabled && row && actionDraft ? (
                                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                                    <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                      Allowed actions
                                    </span>
                                    {row.supportedActions.map((action) => {
                                      const allowed = Boolean((actionDraft[feature.id] ?? {})[action]);
                                      return (
                                        <button
                                          key={action}
                                          type="button"
                                          role="switch"
                                          aria-checked={allowed}
                                          title={ACTION_DESCRIPTIONS[action]}
                                          aria-label={`${ACTION_LABELS[action]} ${
                                            allowed ? 'allowed' : 'blocked'
                                          } for ${feature.label}`}
                                          onClick={() => toggleAction(feature.id, action)}
                                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                                            allowed
                                              ? 'border-primary/30 bg-primary-soft text-primary-dark'
                                              : 'border-line bg-canvas text-muted line-through'
                                          }`}
                                        >
                                          {ACTION_LABELS[action]}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-3">
                                <span
                                  className={`text-xs font-semibold ${enabled ? 'text-primary-dark' : 'text-muted'}`}
                                  aria-hidden="true"
                                >
                                  {enabled ? 'Enabled' : 'Disabled'}
                                </span>
                                <Toggle
                                  checked={enabled}
                                  onChange={(value) => applyToggle(feature.id, value)}
                                  label={`${enabled ? 'Disable' : 'Enable'} ${feature.label} for this client`}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              </>
            ) : null}
          </Card>

          <Card className="p-4">
            <p className="text-xs leading-5 text-muted">
              How precedence works: an active account and organisation are required, then the plan
              default applies, and an explicit override on this client always wins. Disabled clients
              lose everything. Every request is re-checked on the server — hiding a navigation item
              is only a convenience.
            </p>
          </Card>
        </>
      ) : (
        <PlanDefaultsTab
          plans={plansState.data?.plans ?? []}
          loading={plansState.loading}
          error={plansState.error}
          planId={planId}
          onPlanChange={setPlanId}
          onSaved={() => plansState.reload()}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmDisable)}
        title={`Disable ${FEATURES.find((item) => item.id === confirmDisable?.feature)?.label ?? ''}?`}
        message={
          <div className="space-y-2">
            <p>
              These enabled features depend on it and will be turned off as well:
            </p>
            <ul className="list-inside list-disc font-medium text-ink">
              {(confirmDisable?.affected ?? []).map((feature) => (
                <li key={feature}>{FEATURES.find((item) => item.id === feature)?.label ?? feature}</li>
              ))}
            </ul>
            <p className="text-xs">
              Clients currently using those pages will be redirected to an allowed screen on their
              next refresh. Nothing is deleted — enabling again restores access.
            </p>
          </div>
        }
        confirmLabel="Turn all off"
        destructive
        onCancel={() => setConfirmDisable(null)}
        onConfirm={() => {
          if (confirmDisable && draft) {
            const next = { ...draft };
            next[confirmDisable.feature] = false;
            for (const dep of confirmDisable.affected) next[dep] = false;
            setDraft(next);
          }
          setConfirmDisable(null);
        }}
      />

      <ConfirmDialog
        open={pendingChanges !== null}
        title="Review changes"
        message={
          <div className="space-y-2">
            <p>Applying these changes to this client:</p>
            <ul className="max-h-56 list-inside list-disc overflow-y-auto">
              {(pendingChanges ?? []).map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
            <p className="text-xs">
              Restrictions take effect on the client’s next request — signed-in users are not
              signed out, but blocked operations are rejected immediately by the server.
            </p>
          </div>
        }
        confirmLabel="Apply changes"
        onCancel={() => setPendingChanges(null)}
        onConfirm={() => void save()}
      />

      <ConfirmDialog
        open={resetOpen}
        title="Reset to plan defaults?"
        message={`Every individual override for this client will be removed and the ${planName || 'plan'} defaults will apply again.`}
        confirmLabel="Reset overrides"
        onCancel={() => setResetOpen(false)}
        onConfirm={() => void resetToPlan()}
      />
    </div>
  );
}

function PlanDefaultsTab({
  plans,
  loading,
  error,
  planId,
  onPlanChange,
  onSaved,
}: {
  plans: Array<{ id: string; name: string; description: string; features: FeatureId[] }>;
  loading: boolean;
  error: string | null;
  planId: string;
  onPlanChange: (id: string) => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const plan = plans.find((item) => item.id === planId) ?? plans[0];
  const [draft, setDraft] = useState<Record<FeatureId, boolean> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (plan) {
      setDraft(Object.fromEntries(FEATURE_IDS.map((id) => [id, plan.features.includes(id)])) as Record<FeatureId, boolean>);
    }
  }, [plan]);

  const dirty = useMemo(() => {
    if (!draft || !plan) return false;
    return FEATURE_IDS.some((id) => draft[id] !== plan.features.includes(id));
  }, [draft, plan]);

  const save = async () => {
    if (!draft || !plan) return;
    setSaving(true);
    try {
      await adminApi.savePlan(plan.id, FEATURE_IDS.filter((id) => draft[id]));
      toast.success(
        'Plan defaults saved',
        `${plan.name} now grants ${FEATURE_IDS.filter((id) => draft[id]).length} features.`,
      );
      onSaved();
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
          <Spinner /> Loading plans…
        </div>
      </Card>
    );
  }
  if (error || !plan || !draft) {
    return (
      <Card className="p-6">
        <EmptyState
          compact
          icon={<AlertTriangle className="h-4 w-4 text-muted" aria-hidden="true" />}
          title="Plans unavailable"
          description={error ?? 'No plans were returned by the server.'}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Field label="Plan" htmlFor="plan-select" className="sm:max-w-xs">
            <Select id="plan-select" value={plan.id} onChange={(event) => onPlanChange(event.target.value)}>
              {plans.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted">{plan.description}</p>
            <Button loading={saving} disabled={!dirty} onClick={() => void save()} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
              Save plan
            </Button>
          </div>
        </div>

        <ul className="mt-4 overflow-hidden rounded-xl border border-line">
          {FEATURES.map((feature) => (
            <li
              key={feature.id}
              className="flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{feature.label}</p>
                <p className="mt-0.5 text-xs text-muted">{feature.description}</p>
              </div>
              <Toggle
                checked={draft[feature.id]}
                onChange={(value) => {
                  if (!value) {
                    const affected = dependentFeatures(feature.id, FEATURE_IDS.filter((id) => draft[id]));
                    if (affected.length > 0) {
                      const next = { ...draft };
                      next[feature.id] = false;
                      for (const dep of affected) next[dep] = false;
                      setDraft(next);
                      toast.info?.('Dependent features disabled', 'Features that require this one were turned off too.');
                      return;
                    }
                  } else {
                    const missing = feature.dependencies.filter((dep) => !draft[dep]);
                    if (missing.length > 0) {
                      toast.error(
                        'Dependency required',
                        `${feature.label} requires ${missing
                          .map((dep) => FEATURES.find((item) => item.id === dep)?.label ?? dep)
                          .join(', ')}.`,
                      );
                      return;
                    }
                  }
                  setDraft({ ...draft, [feature.id]: value });
                }}
                label={`${draft[feature.id] ? 'Disable' : 'Enable'} ${feature.label} in this plan`}
              />
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <InfoNote tone="info">
            Plan defaults apply to every client on this plan unless that client has an explicit
            override. Clients with overrides keep them after you edit the plan.
          </InfoNote>
        </div>
      </Card>
    </div>
  );
}
