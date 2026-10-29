import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  MousePointerClick,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { useStockora } from '../store/StockoraContext';
import { Button, cn } from './ui';
import { useToast } from './toast';

/**
 * Guided three-minute demo tour: walks the seeded dataset story across the
 * Overview, Action Center, Expiry Monitor, Reorder Planner, a live stock
 * change on Inventory, and the controlled impact comparison in Reports.
 * Started from the Overview quick actions (stockora:start-tour event).
 */

interface TourStep {
  route: string;
  time: string;
  title: string;
  body: string;
  icon: React.ReactNode;
  /** Optional interactive demo action rendered inside the card. */
  action?: 'rice';
}

const STEPS: TourStep[] = [
  {
    route: '/',
    time: '0:00',
    title: 'Overview: what needs attention today',
    body: 'Five KPI cards, the inventory-health donut (2 healthy · 0 low-only · 1 expiry-only · 3 combined) and the daily briefing are all computed live from the six seeded products — no hardcoded figures.',
    icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />,
  },
  {
    route: '/actions',
    time: '0:30',
    title: 'Action Center: combined risk, one card',
    body: 'Milk, Bread and Yogurt each appear exactly once with both risk reasons — low stock AND near expiry — plus stock, days remaining and a recommended next step. Priority 1 beats single-risk items.',
    icon: <ListChecks className="h-4 w-4" aria-hidden="true" />,
  },
  {
    route: '/expiry',
    time: '1:00',
    title: 'Expiry Monitor: risks stock-only tools miss',
    body: 'Juice has 30 units in stock — a stock-only system would call it healthy — but it expires in 2 days. Expiry-aware detection flags it as expiry-only, never as low stock.',
    icon: <CalendarClock className="h-4 w-4" aria-hidden="true" />,
  },
  {
    route: '/reorder',
    time: '1:30',
    title: 'Reorder Planner: show the math',
    body: 'Bread: ceil(10 × (1 + 2) − 4) = 26 units. Every suggestion displays the formula, inputs and an expiry warning — these are recommendations, never automatic purchase orders.',
    icon: <ClipboardList className="h-4 w-4" aria-hidden="true" />,
  },
  {
    route: '/inventory',
    time: '2:00',
    title: 'Live update: change Rice stock to 6',
    body: 'Try it: drop Rice from 25 to 6 (its reorder level is 8). The KPI cards, health chart, Action Center and reorder suggestions all recalculate instantly — then restore it.',
    icon: <MousePointerClick className="h-4 w-4" aria-hidden="true" />,
    action: 'rice',
  },
  {
    route: '/reports',
    time: '2:30',
    title: 'Impact & responsiveness',
    body: 'The controlled acceptance-test comparison shows 3/7 stock-only flags versus 7/7 combined flags with 0 false alarms on the seeded dataset — labelled as a controlled test, not real-world claims. Resize the window: the layout adapts from 320px mobile to desktop.',
    icon: <Lightbulb className="h-4 w-4" aria-hidden="true" />,
  },
];

export const START_TOUR_EVENT = 'stockora:start-tour';

export function DemoTour() {
  const navigate = useNavigate();
  const toast = useToast();
  const { products, updateProduct, insights } = useStockora();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [riceApplied, setRiceApplied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const rice = products.find((product) => product.sku === 'R102') ?? null;
  const riceInsight = insights.find((insight) => insight.product.sku === 'R102') ?? null;

  const step = STEPS[index];

  const close = useCallback(() => {
    setActive(false);
    // Undo the scripted demo edit so the seed data stays predictable.
    if (riceApplied && rice && rice.currentStock === 6) {
      updateProduct(rice.id, { ...rice, currentStock: 25 });
      toast.info('Demo change restored', 'Rice 5kg is back to 25 units.');
    }
    setRiceApplied(false);
  }, [riceApplied, rice, updateProduct, toast]);

  useEffect(() => {
    const onStart = () => {
      setIndex(0);
      setRiceApplied(false);
      setActive(true);
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, []);

  useEffect(() => {
    if (!active || !step) return;
    navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  useEffect(() => {
    if (!active) return;
    cardRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowRight' && index < STEPS.length - 1) setIndex((value) => value + 1);
      if (event.key === 'ArrowLeft' && index > 0) setIndex((value) => value - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, index, close]);

  if (!active || !step) return null;

  const applyRice = (stock: number) => {
    if (!rice) return;
    updateProduct(rice.id, { ...rice, currentStock: stock });
    if (stock === 6) {
      setRiceApplied(true);
      toast.success('Rice is now low stock', 'Watch the KPI cards, health chart and Action Center update.');
    }
  };

  const lastIndex = index === STEPS.length - 1;
  const riceIsLow = rice?.currentStock === 6;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-end sm:justify-end sm:p-5">
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby="demo-tour-title"
        className="pointer-events-auto w-full max-w-md focus:outline-none"
      >
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-modal">
          {/* Progress header */}
          <div className="flex items-center justify-between gap-3 border-b border-line bg-primary-dark px-4 py-2.5 text-white">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              3-minute demo tour
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">
                {step.time} · step {index + 1}/{STEPS.length}
              </span>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-white/80 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Close demo tour"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="h-1 w-full bg-line" aria-hidden="true">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
            />
          </div>

          <div className="px-4 py-4">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-dark">
                {step.icon}
              </span>
              <div className="min-w-0">
                <h2 id="demo-tour-title" className="text-sm font-bold leading-5 text-ink">
                  {step.title}
                </h2>
                <p className="mt-1.5 text-[13px] leading-5 text-muted">{step.body}</p>
              </div>
            </div>

            {step.action === 'rice' && rice ? (
              <div className="mt-3 rounded-xl border border-line bg-canvas px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-ink">
                    Rice 5kg · stock{' '}
                    <span className="tnum">{rice.currentStock}</span> · reorder level{' '}
                    <span className="tnum">{rice.reorderLevel}</span>
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-bold',
                      riceInsight?.isLowStock ? 'bg-crit-soft text-crit' : 'bg-ok-soft text-[#166534]',
                    )}
                  >
                    {riceInsight?.isLowStock ? 'Low stock' : 'Healthy'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={riceIsLow ? 'secondary' : 'primary'}
                    disabled={riceIsLow}
                    onClick={() => applyRice(6)}
                  >
                    Set stock to 6
                  </Button>
                  <Button
                    size="sm"
                    variant={riceIsLow ? 'primary' : 'secondary'}
                    disabled={!riceIsLow}
                    icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => applyRice(25)}
                  >
                    Restore to 25
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={index === 0}
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
                icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
              >
                Back
              </Button>
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {STEPS.map((item, position) => (
                  <span
                    key={item.time}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      position === index ? 'w-4 bg-primary' : 'w-1.5 bg-line',
                    )}
                  />
                ))}
              </div>
              <Button
                size="sm"
                onClick={() => (lastIndex ? close() : setIndex((value) => value + 1))}
                icon={lastIndex ? undefined : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              >
                {lastIndex ? 'Finish tour' : 'Next'}
              </Button>
            </div>
            <p className="mt-2 text-center text-[10px] text-muted">
              Arrow keys move between steps · Esc closes · the Rice change is undone when the tour ends
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
