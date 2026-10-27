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
 *
 * Client payments in approximate dollars (FIN BD-56, slice 1b, SA-RR-CPU
 * SA-Q-5): an optional `note`, a small line inside the tile under the figure
 * ("Our customers' revenue, not ours"). Absent, nothing renders, so the
 * existing callers' markup is byte-identical (CPU-5, the hash test). It is
 * content of the group, not part of its accessible name.
 *
 * Block KPI 5-grid (2026-10-27, SA-CR-KPIGRID G-1, SA-R-KPIGRID-2): the frame
 * is the top tile's (`rounded-xl p-4`). Section rows are narrower than the top
 * strip on a phone (131 px), so below `sm` the pill sits in the flow above the
 * label (frame `pr-4`), the value is `text-xl`, and the chip has its own line
 * and may wrap. From `sm` up the pill is the top tile's corner pill (`pr-20`).
 */

import { KpiIndicator, type KpiIndicatorSpec } from './KpiStrip';
import { StatusChip, type StatusTone } from './StatusChip';

export interface BlockKpiProps {
  label: string;
  value: string;
  indicator: KpiIndicatorSpec;
  /** A chip in words beside the figure; absent when there is nothing to flag. */
  chip?: { tone: StatusTone; label: string } | null;
  /** SA-Q-5: a small line inside the tile, under the figure; absent, nothing renders. */
  note?: string;
  testId: string;
}

export function BlockKpi({ label, value, indicator, chip, note, testId }: BlockKpiProps) {
  return (
    <div
      role="group"
      aria-label={`${label}, ${value}`}
      data-testid={`${testId}-kpi`}
      className="relative flex flex-col rounded-xl border border-slate-700 bg-slate-800 p-4 pr-4 sm:pr-20"
    >
      <span className="block text-sm font-medium text-white">{label}</span>
      <span className="mt-1 block text-xl font-semibold tabular-nums text-white sm:text-2xl" data-testid={testId}>
        {value}
      </span>
      {chip && (
        // SA-R-KPIGRID-2 (B-1, B-3): the chip on its own line under the value, allowed to wrap, as KpiTile's status line does.
        <span className="mt-1 block max-w-full [&>span]:whitespace-normal">
          <StatusChip tone={chip.tone} testId={`${testId}-chip`}>
            {chip.label}
          </StatusChip>
        </span>
      )}
      {note && (
        <span className="mt-1 block text-[11px] text-slate-400" data-testid={`${testId}-note`}>
          {note}
        </span>
      )}
      {/* SA-R-KPIGRID-2 (B-2): below sm the pill is in the flow, above the label (order-first; DOM order unchanged);
          from sm up it is the top tile's corner pill. */}
      <KpiIndicator
        indicator={indicator}
        testId={`${testId}-indicator`}
        className="order-first mb-1 self-start sm:absolute sm:right-2 sm:top-2 sm:mb-0"
      />
    </div>
  );
}
