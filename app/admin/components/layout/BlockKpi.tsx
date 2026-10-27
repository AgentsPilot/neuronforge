'use client';

/**
 * A block KPI: the headline figure of a block on a page (Money MK-1, KPI
 * restructure review §3.2 and §5; LL-1 to LL-4). Not a strip tile and not a
 * link: a `div role="group"` named "label, value" (never a landmark, never a
 * button, A-9), with MK-0's leading / lagging `KpiIndicator` in its top corner
 * and an optional status chip in words (K-2's far-over rule on Credits).
 * MK-0a: the indicator is the word pill; its tooltip opens below this box
 * (it is the box's `relative` anchor), and `pr-20` keeps the label clear of it.
 *
 * Money MK-3 (SA-Q-MK3-8, MK-1 ruling): promoted from Finance to this shared
 * folder, byte-identical markup, because a second page uses it (the AI cost
 * page's Leak check, "Businesses with uncharged calls"). Callers: Finance's
 * Credits and Client payments blocks, and the Leak check panel.
 *
 * The value arrives formatted by the caller ("at least" included). Every
 * string comes from the caller's copy module; the indicator's definition is
 * that KPI's one copy constant (LL-4).
 */

import { KpiIndicator, type KpiIndicatorSpec } from './KpiStrip';
import { StatusChip, type StatusTone } from './StatusChip';

export interface BlockKpiProps {
  label: string;
  value: string;
  indicator: KpiIndicatorSpec;
  /** A chip in words beside the figure; absent when there is nothing to flag. */
  chip?: { tone: StatusTone; label: string } | null;
  testId: string;
}

export function BlockKpi({ label, value, indicator, chip, testId }: BlockKpiProps) {
  return (
    <div
      role="group"
      aria-label={`${label}, ${value}`}
      data-testid={`${testId}-kpi`}
      className="relative rounded-lg border border-slate-700 bg-slate-800 p-3 pr-20"
    >
      <span className="block text-sm font-medium text-white">{label}</span>
      <span className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums text-white" data-testid={testId}>
          {value}
        </span>
        {chip && (
          <StatusChip tone={chip.tone} testId={`${testId}-chip`}>
            {chip.label}
          </StatusChip>
        )}
      </span>
      <KpiIndicator indicator={indicator} testId={`${testId}-indicator`} className="absolute right-2 top-2" />
    </div>
  );
}
