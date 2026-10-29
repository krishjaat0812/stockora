import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Database,
  Download,
  Info,
  RefreshCw,
  RotateCcw,
  Save,
  Store,
  Upload,
  Wallet,
} from 'lucide-react';
import type { CurrencyCode, Settings } from '../types';
import { useStockora } from '../store/StockoraContext';
import { PageHeader } from '../components/PageHeader';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  InfoNote,
  NumberInput,
  SectionCard,
  Select,
  TextInput,
  cn,
} from '../components/ui';
import { ImportCsvDialog } from '../components/ImportCsvDialog';
import { useToast } from '../components/toast';
import { buildInsights } from '../lib/inventory';
import { fileStamp, inventoryTable, SAMPLE_CSV } from '../lib/csv';
import { ExportDeniedError, downloadCsv, exportCsv } from '../lib/download';
import { useAction } from '../auth/AuthContext';
import { formatCurrency } from '../lib/format';
import { relativeTime } from '../lib/date';

const CURRENCIES: Array<{ value: CurrencyCode; label: string }> = [
  { value: 'INR', label: 'Indian Rupee (₹)' },
  { value: 'USD', label: 'US Dollar ($)' },
  { value: 'EUR', label: 'Euro (€)' },
  { value: 'GBP', label: 'Pound Sterling (£)' },
];

export default function SettingsPage() {
  const {
    settings,
    products,
    updateSettings,
    resetDemoData,
    refreshFromStorage,
    lastSavedAt,
    persistenceError,
  } = useStockora();
  const toast = useToast();
  const canImport = useAction('csv_import', 'create');
  const canExport = useAction('csv_export', 'export');
  const [draft, setDraft] = useState<Settings>(settings);
  const [errors, setErrors] = useState<{ shopName?: string; expiryThreshold?: string; safetyBufferDays?: string }>({});
  const [resetOpen, setResetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const dirty =
    draft.shopName !== settings.shopName ||
    draft.expiryThreshold !== settings.expiryThreshold ||
    draft.safetyBufferDays !== settings.safetyBufferDays ||
    draft.currency !== settings.currency ||
    JSON.stringify(draft.notifications) !== JSON.stringify(settings.notifications);

  const preview = useMemo(() => {
    const threshold = Number.isFinite(draft.expiryThreshold) ? draft.expiryThreshold : settings.expiryThreshold;
    const buffer = Number.isFinite(draft.safetyBufferDays) ? draft.safetyBufferDays : settings.safetyBufferDays;
    const insights = buildInsights(products, {
      expiryThreshold: Math.max(0, threshold),
      safetyBufferDays: Math.max(0, buffer),
    });
    return {
      near: insights.filter((insight) => insight.isNearExpiry).length,
      combined: insights.filter((insight) => insight.risk === 'both').length,
      units: insights.reduce((sum, insight) => sum + insight.reorderQuantity, 0),
      low: insights.filter((insight) => insight.isLowStock).length,
    };
  }, [draft.expiryThreshold, draft.safetyBufferDays, products, settings.expiryThreshold, settings.safetyBufferDays]);

  const handleSave = () => {
    const nextErrors: typeof errors = {};
    if (!draft.shopName.trim()) nextErrors.shopName = 'Shop name is required.';
    if (!Number.isInteger(draft.expiryThreshold) || draft.expiryThreshold < 0 || draft.expiryThreshold > 60) {
      nextErrors.expiryThreshold = 'Use a whole number from 0 to 60 days.';
    }
    if (!Number.isInteger(draft.safetyBufferDays) || draft.safetyBufferDays < 0 || draft.safetyBufferDays > 30) {
      nextErrors.safetyBufferDays = 'Use a whole number from 0 to 30 days.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('Settings not saved', 'Check the highlighted fields and try again.');
      return;
    }
    updateSettings({
      ...draft,
      shopName: draft.shopName.trim(),
    });
    toast.success(
      'Settings saved',
      `Expiry classifications and reorder quantities were recalculated with a ${draft.expiryThreshold}-day threshold and ${draft.safetyBufferDays}-day buffer.`,
    );
  };

  const toggleNotification = (key: keyof Settings['notifications']) => {
    setDraft((current) => ({
      ...current,
      notifications: { ...current.notifications, [key]: !current.notifications[key] },
    }));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Shop details, inventory rules and data controls. Changes recalculate the dashboard, actions, expiry view and reorder suggestions after saving."
        actions={
          <>
            {dirty ? <Badge tone="warn">Unsaved changes</Badge> : <Badge tone="ok">Saved</Badge>}
            <Button
              variant="secondary"
              icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                setDraft(settings);
                setErrors({});
              }}
              disabled={!dirty}
            >
              Discard
            </Button>
            <Button icon={<Save className="h-4 w-4" aria-hidden="true" />} onClick={handleSave} disabled={!dirty}>
              Save settings
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <SectionCard
            title="Shop profile"
            description="Used across the header, dashboard briefing and reports."
            icon={<Store className="h-4 w-4" aria-hidden="true" />}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Shop name" htmlFor="settings-shop-name" error={errors.shopName} required>
                <TextInput
                  id="settings-shop-name"
                  value={draft.shopName}
                  maxLength={60}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, shopName: event.target.value }));
                    if (errors.shopName) setErrors((current) => ({ ...current, shopName: undefined }));
                  }}
                  invalid={Boolean(errors.shopName)}
                />
              </Field>
              <Field
                label="Currency"
                htmlFor="settings-currency"
                hint={`Preview: ${formatCurrency(1250, draft.currency)}`}
              >
                <Select
                  id="settings-currency"
                  value={draft.currency}
                  onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value as CurrencyCode }))}
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency.value} value={currency.value}>
                      {currency.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-muted">
              <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Currency affects how unit costs and stock value appear. It does not convert existing values.
            </p>
          </SectionCard>

          <SectionCard
            title="Inventory rules"
            description="These thresholds drive expiry classification and reorder quantities."
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Near-expiry threshold (days)"
                htmlFor="settings-expiry-threshold"
                error={errors.expiryThreshold}
                hint="Default 3 days. Products with 0 days remaining are 'Expires today'."
                required
              >
                <NumberInput
                  id="settings-expiry-threshold"
                  min={0}
                  max={60}
                  step={1}
                  value={draft.expiryThreshold}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, expiryThreshold: Number(event.target.value) }));
                    if (errors.expiryThreshold) setErrors((current) => ({ ...current, expiryThreshold: undefined }));
                  }}
                  invalid={Boolean(errors.expiryThreshold)}
                />
              </Field>
              <Field
                label="Safety buffer (days)"
                htmlFor="settings-safety-buffer"
                error={errors.safetyBufferDays}
                hint="Default 2 days, added to supplier lead time in the reorder formula."
                required
              >
                <NumberInput
                  id="settings-safety-buffer"
                  min={0}
                  max={30}
                  step={1}
                  value={draft.safetyBufferDays}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, safetyBufferDays: Number(event.target.value) }));
                    if (errors.safetyBufferDays) setErrors((current) => ({ ...current, safetyBufferDays: undefined }));
                  }}
                  invalid={Boolean(errors.safetyBufferDays)}
                />
              </Field>
            </div>

            <div className="mt-3 rounded-xl border border-primary/20 bg-primary-soft/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-dark">
                Effect of these values (live preview)
              </p>
              <dl className="mt-1.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted">Low stock</dt>
                  <dd className="tnum font-semibold text-ink">{preview.low}</dd>
                </div>
                <div>
                  <dt className="text-muted">Near expiry</dt>
                  <dd className="tnum font-semibold text-ink">{preview.near}</dd>
                </div>
                <div>
                  <dt className="text-muted">Combined risk</dt>
                  <dd className="tnum font-semibold text-ink">{preview.combined}</dd>
                </div>
                <div>
                  <dt className="text-muted">Units suggested</dt>
                  <dd className="tnum font-semibold text-ink">{preview.units}</dd>
                </div>
              </dl>
              <p className="mt-1.5 text-[10px] leading-4 text-muted">
                Preview uses the values above. Figures update after you save.
              </p>
            </div>
          </SectionCard>

          <SectionCard
            title="Notifications"
            description="Control which in-app alerts appear in the bell menu."
            icon={<Bell className="h-4 w-4" aria-hidden="true" />}
          >
            <fieldset>
              <legend className="sr-only">Notification preferences</legend>
              <div className="space-y-2">
                {[
                  { key: 'lowStock' as const, label: 'Low-stock alerts', hint: 'Product at or below its reorder level' },
                  { key: 'nearExpiry' as const, label: 'Near-expiry alerts', hint: 'Product within the expiry threshold' },
                  { key: 'expired' as const, label: 'Expired product alerts', hint: 'Product past its recorded expiry date' },
                  { key: 'dataUpdates' as const, label: 'Data update messages', hint: 'Imports and product changes' },
                ].map((item) => (
                  <label
                    key={item.key}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                      draft.notifications[item.key] ? 'border-primary/30 bg-primary-soft/30' : 'border-line bg-white',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={draft.notifications[item.key]}
                      onChange={() => toggleNotification(item.key)}
                      className="mt-0.5 h-4 w-4 rounded border-muted/50 text-primary focus:ring-primary"
                    />
                    <span>
                      <span className="block font-medium text-ink">{item.label}</span>
                      <span className="block text-[11px] text-muted">{item.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <InfoNote tone="info" icon={<Info className="h-4 w-4" aria-hidden="true" />}>
              Notifications are in-app only. No email, SMS or push delivery is connected, and alerts are not repeated for
              unchanged conditions.
            </InfoNote>
          </SectionCard>
        </div>

        <div className="space-y-4 xl:col-span-5">
          <SectionCard
            title="Data management"
            description="Import, export, reload or reset this workspace’s dataset."
            icon={<Database className="h-4 w-4" aria-hidden="true" />}
          >
            <div className="space-y-2">
              {canExport ? (
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  icon={<Download className="h-4 w-4 text-primary" aria-hidden="true" />}
                  onClick={() => {
                    void (async () => {
                      try {
                        await exportCsv(
                          `stockora-inventory-${fileStamp()}.csv`,
                          inventoryTable(products),
                          'inventory',
                        );
                        toast.success('Inventory exported', `${products.length} products downloaded as CSV.`);
                      } catch (err) {
                        toast.error(
                          'Export not allowed',
                          err instanceof ExportDeniedError ? err.message : 'Export failed. Try again.',
                        );
                      }
                    })();
                  }}
                >
                  Export inventory CSV
                </Button>
              ) : null}
              {canImport ? (
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  icon={<Upload className="h-4 w-4 text-primary" aria-hidden="true" />}
                  onClick={() => setImportOpen(true)}
                >
                  Import inventory CSV
                </Button>
              ) : null}
              <Button
                variant="secondary"
                className="w-full justify-start"
                icon={<Download className="h-4 w-4 text-primary" aria-hidden="true" />}
                onClick={() => {
                  downloadCsv('stockora-inventory-template.csv', SAMPLE_CSV);
                  toast.success('Template downloaded', 'Use this CSV layout for imports.');
                }}
              >
                Download sample template
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-start"
                icon={<RefreshCw className="h-4 w-4 text-primary" aria-hidden="true" />}
                onClick={async () => {
                  await refreshFromStorage();
                  toast.success('Data reloaded', 'The latest saved inventory is now shown.');
                }}
              >
                Reload saved data
              </Button>
            </div>

            <dl className="mt-3 space-y-1.5 rounded-lg bg-canvas px-3 py-2.5 text-[11px]">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Products stored</dt>
                <dd className="tnum font-semibold text-ink">{products.length}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Storage</dt>
                <dd className="font-semibold text-ink">Your shop’s workspace (server)</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Last saved</dt>
                <dd className="font-semibold text-ink">
                  {lastSavedAt ? relativeTime(lastSavedAt) : 'Not saved yet'}
                </dd>
              </div>
            </dl>

            {persistenceError ? (
              <div className="mt-2">
                <InfoNote tone="warn" icon={<Info className="h-4 w-4" aria-hidden="true" />}>
                  {persistenceError}
                </InfoNote>
              </div>
            ) : null}

            <div className="mt-3 border-t border-line pt-3">
              <p className="text-[11px] leading-4 text-muted">
                Data is stored in this organisation’s workspace and is only visible to your shop’s accounts. Point-of-sale
                integration is not connected. Export a CSV if you need an offline copy.
              </p>
              <Button
                variant="secondary"
                className="mt-2 w-full justify-start border-crit/30 text-crit hover:bg-crit-soft/40"
                icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setResetOpen(true)}
              >
                Reset demo data
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="About Stockora" description="Smart retail inventory and expiry assistant.">
            <p className="text-sm font-semibold text-ink">Smarter stock. Less waste. Better decisions.</p>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-4 text-muted">
              <li>• Low stock: current stock ≤ reorder level.</li>
              <li>• Near expiry: 0 ≤ days remaining ≤ expiry threshold.</li>
              <li>• Days of cover: stock ÷ average daily sales, or N/A.</li>
              <li>
                • Reorder: max(0, ceil(sales × (lead time + buffer) − stock)).
              </li>
            </ul>
            <p className="mt-2 text-[11px] leading-4 text-muted">
              Reorder quantities are suggestions, not purchase orders. Expired products are never recommended for sale.
            </p>
          </SectionCard>
        </div>
      </div>

      <ImportCsvDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ConfirmDialog
        open={resetOpen}
        title="Reset demo data?"
        message={
          <div className="space-y-2">
            <p>
              This restores the six seeded products, clears reviewed actions and activity, and resets settings to their
              defaults (expiry threshold 3 days, safety buffer 2 days).
            </p>
            <p className="font-medium text-ink">Export a CSV first if you need to keep your current products.</p>
          </div>
        }
        confirmLabel="Reset demo data"
        destructive
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          resetDemoData();
          setResetOpen(false);
          setErrors({});
          toast.success('Demo data reset', 'Six demo products restored with fresh expiry dates.');
        }}
      />

      <Card className="flex items-start gap-2 p-3.5">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <p className="text-[11px] leading-4 text-muted">
          Settings and inventory are saved automatically after each confirmed change. Reloading the browser restores the
          most recent saved state.
        </p>
      </Card>
    </div>
  );
}
