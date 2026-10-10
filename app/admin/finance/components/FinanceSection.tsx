'use client';

/**
 * One section's frame (L-5): a heading, a subtitle naming the source and the
 * window, and the section's own status. A section that could not load says so
 * with a Retry, and the others still render (S1-FR-6).
 */

import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { FinanceSectionStatus } from '@/lib/business-os/finance/financeTypes';
import { RETRY, SECTION_COULD_NOT_LOAD, SECTION_OK, SECTION_PARTIAL } from '../financeCopy';

const BADGE: Record<FinanceSectionStatus, { text: string; className: string }> = {
  ok: { text: SECTION_OK, className: 'border-slate-600 text-slate-300' },
  partial: { text: SECTION_PARTIAL, className: 'border-amber-500/40 text-amber-300' },
  unknown: { text: SECTION_COULD_NOT_LOAD, className: 'border-slate-600 text-slate-400' },
};

interface Props {
  id: string;
  title: string;
  subtitle: string;
  status: FinanceSectionStatus;
  onRetry: () => void;
  children?: ReactNode;
}

export function FinanceSection({ id, title, subtitle, status, onRetry, children }: Props) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={`section-${id}`}
      data-status={status}
      className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-3"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-base font-semibold text-white">
            {title}
          </h2>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        <span className={cn('rounded border px-2 py-0.5 text-[11px]', BADGE[status].className)} data-testid={`section-${id}-status`}>
          {BADGE[status].text}
        </span>
      </header>
      {status === 'unknown' ? (
        <div className="flex items-center gap-3 text-sm text-slate-300" role="status">
          <span>{SECTION_COULD_NOT_LOAD}</span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            {RETRY}
          </button>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
