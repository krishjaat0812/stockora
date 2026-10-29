import { cn } from './ui';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('h-9 w-9 shrink-0', className)}
      role="img"
      aria-label="Stockora logo"
    >
      <rect width="40" height="40" rx="11" fill="#15803D" />
      <path d="M10 16.2 20 11l10 5.2L20 21.4 10 16.2Z" fill="#FFFFFF" />
      <path d="m10 20.9 8.2 4v6.2L10 27v-6.1Z" fill="#DCFCE7" />
      <path d="m30 20.9-8.2 4v6.2L30 27v-6.1Z" fill="#A7F3D0" />
      <path d="m20 24.7 3.3-1.6.2-3-.7-.4-2.8 1.5-2.8-1.5-.7.4.2 3 3.3 1.6Z" fill="#14532D" opacity="0.22" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact ? (
        <span className="flex flex-col leading-tight">
          <span className="text-lg font-bold tracking-tight text-ink">Stockora</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
            Inventory intelligence
          </span>
        </span>
      ) : null}
    </span>
  );
}
