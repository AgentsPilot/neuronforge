'use client';

/**
 * One section's frame (L-5): a heading, a subtitle naming the source and the
 * window, and the section's own status. A section that could not load says so
 * with a Retry, and the others still render (S1-FR-6).
 *
 * Slice 2a (SA-W24): an optional `badge`, a shared `StatusChip` beside the
 * heading in EVERY state, `unknown` included (the takings block's "Not our
 * revenue" must not vanish when the block fails). A section that passes no
 * badge renders exactly the DOM it rendered before.
 *
 * Money M-4 (SA-W98, R4-9): an optional `alsoWhenUnknown`, rendered after the
 * could-not-load line ONLY when the section is `unknown`: Section 3's recorded
 * AI cost is its own read and must still show when the charged read failed.
 * A section that passes none renders exactly the DOM it rendered before.
 *
 * Finance F-5 (SA-W8): the section carries its `id` as a DOM id, so a KPI
 * tile can jump to it with a plain `#<id>` anchor, as on Jobs and Archiving.
 * The landmark is unchanged: still named by its heading (A-9).
 */

import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';
import type { FinanceSectionStatus } from '@/lib/business-os/finance/financeTypes';
import { RETRY, SECTION_COULD_NOT_LOAD, SECTION_OK, SECTION_PARTIAL } from '../financeCopy';

/**
 * The section's own status as the shared chip (F-1, §5.9). "OK" is neutral:
 * no green on a section that merely loaded. "Partial" is warn and "Could not
 * load" is unknown, so both carry an icon beside the words (A-7).
 */
const BADGE: Record<FinanceSectionStatus, { text: string; tone: StatusTone }> = {
  ok: { text: SECTION_OK, tone: 'neutral' },
  partial: { text: SECTION_PARTIAL, tone: 'warn' },
  unknown: { text: SECTION_COULD_NOT_LOAD, tone: 'unknown' },
};

interface Props {
  id: string;
  title: string;
  subtitle: string;
  status: FinanceSectionStatus;
  onRetry: () => void;
  children?: ReactNode;
  /** A chip in words beside the heading, shown in every state (SA-W24). */
  badge?: { tone: StatusTone; label: string };
  /** M-4 (SA-W98): content of its own read, shown under the could-not-load line when the section is unknown. */
  alsoWhenUnknown?: ReactNode;
  /**
   * Slice 8.3 (SA-W-8.3-2, E-100): false hides the right-hand status chip, for a
   * block with nothing read yet (the closed History block). Default true: every
   * other caller's DOM is unchanged.
   */
  statusChip?: boolean;
}

export function FinanceSection({ id, title, subtitle, status, onRetry, children, badge, alsoWhenUnknown, statusChip = true }: Props) {
  const headingId = `${id}-heading`;
  const heading = (
    <h2 id={headingId} className="text-base font-semibold text-white">
      {title}
    </h2>
  );
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-testid={`section-${id}`}
      data-status={status}
      className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-3"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {badge ? (
            <div className="flex flex-wrap items-center gap-2">
              {heading}
              <StatusChip tone={badge.tone} testId={`section-${id}-badge`}>
                {badge.label}
              </StatusChip>
            </div>
          ) : (
            heading
          )}
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        {statusChip && (
          <StatusChip tone={BADGE[status].tone} testId={`section-${id}-status`}>
            {BADGE[status].text}
          </StatusChip>
        )}
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
      {status === 'unknown' && alsoWhenUnknown}
    </section>
  );
}
