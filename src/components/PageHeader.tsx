import type { ReactNode } from 'react';
import { cn } from './ui';

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-col gap-3 sm:mb-5 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">{eyebrow}</p>
        ) : null}
        <h1 className="text-[22px] font-bold leading-tight text-ink sm:text-[26px] lg:text-[28px]">{title}</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted sm:text-sm">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
