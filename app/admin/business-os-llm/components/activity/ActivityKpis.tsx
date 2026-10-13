'use client';

/**
 * The Activity tab's KPI strip (Admin Layout Standard §5.4, §7.11; L-8a
 * workplan §2.6). Every value comes from the payload already read (K-9): no
 * read of its own.
 *
 *   AI actions             the filtered count (exact even when the list is
 *                          capped, SA-R-15); a reset tile clearing Outcome and Area
 *   Failed                 failed rows among those shown; toggle tile outcome=failed
 *   Cost (USD, net)        the sum of the shown rows' net cost; toggle tile sort=cost
 *   Unresolved corrections no target (no filter exists), amber only when the
 *                          tab already shows its amber notice for it (K-5 (ii))
 *
 * Toggle tiles (SA Q-10): when `current`, the href is the toggled-off view
 * (the L-2a precedent), never a dead link to what is already applied. Colour:
 * neutral (D-4 (a)); the only status is Unresolved's amber.
 */

import { useMemo } from 'react';

import { KpiStrip, KpiTile, type KpiTileFilter } from '@/app/admin/components/layout/KpiStrip';

import { formatCount, formatUsd } from '../../costFormat';
import {
  KPI_ACTIONS,
  KPI_AT_LEAST,
  KPI_COST,
  KPI_FAILED,
  KPI_NET_LEFT_OUT,
  KPI_OF_SHOWN,
  KPI_UNKNOWN,
  KPI_UNRESOLVED,
} from '../../activityCopy';
import type { ActivityFilters } from '../../activityFilters';
import type { ActivityPayload } from '../../activityTypes';

export interface ActivityKpisProps {
  payload: ActivityPayload | null;
  /** The first read (or the first after an error) is in flight: the K-10 placeholders. */
  firstLoad: boolean;
  filters: ActivityFilters;
  /** The link and the click action for a patch (the tab's `hrefFor` and `setFilters`). */
  tile: (patch: Partial<ActivityFilters>) => Omit<KpiTileFilter, 'current'>;
}

interface Figures {
  shown: number;
  failed: number;
  netSum: number;
  missingNet: number;
}

/** The counts and the sum, over the rows shown. */
function figuresOf(payload: ActivityPayload): Figures {
  let failed = 0;
  let netSum = 0;
  let missingNet = 0;
  for (const row of payload.rows) {
    if (row.outcome === 'failed') failed += 1;
    if (row.costUsd.net === null) missingNet += 1;
    else netSum += row.costUsd.net;
  }
  return { shown: payload.rows.length, failed, netSum, missingNet };
}

export function ActivityKpis({ payload, firstLoad, filters, tile }: ActivityKpisProps) {
  // S-5: computed once per payload, not on every render of the tab.
  const figures = useMemo(() => (payload ? figuresOf(payload) : null), [payload]);

  if (!payload || !figures) return firstLoad ? <KpiStrip loading placeholderCount={4} /> : null;
  // Nothing to count before charging went live: the tab shows the cut-over line instead.
  if (payload.cutover.coverage === 'entirely_before_cutover') return null;

  const shown = formatCount(figures.shown);
  const ofShown = payload.capped ? KPI_OF_SHOWN(shown) : null;

  const actionsValue =
    payload.total !== null ? formatCount(payload.total) : payload.capped ? KPI_AT_LEAST(shown) : KPI_UNKNOWN;

  const allNetMissing = figures.shown > 0 && figures.missingNet === figures.shown;
  const costValue = allNetMissing ? KPI_UNKNOWN : formatUsd(figures.netSum);
  // S-5: a capped list with some nets missing gets ONE sub-line joining both facts.
  const costSub =
    [ofShown, !allNetMissing && figures.missingNet > 0 ? KPI_NET_LEFT_OUT(formatCount(figures.missingNet)) : null]
      .filter((part): part is string => part !== null)
      .join('; ') || null;

  const failedApplied = filters.outcome === 'failed';
  const costApplied = filters.sort === 'cost';

  return (
    <KpiStrip>
      <KpiTile testId="activity-kpi-actions" label={KPI_ACTIONS} value={actionsValue} filter={tile({ outcome: '', area: '' })} />
      <KpiTile
        testId="activity-kpi-failed"
        label={KPI_FAILED}
        value={formatCount(figures.failed)}
        sub={ofShown}
        filter={{ ...tile({ outcome: failedApplied ? '' : 'failed' }), current: failedApplied }}
      />
      <KpiTile
        testId="activity-kpi-cost"
        label={KPI_COST}
        value={costValue}
        sub={costSub}
        filter={{ ...tile({ sort: costApplied ? 'time' : 'cost' }), current: costApplied }}
      />
      {/* No target (K-6): no filter exists for it. */}
      <KpiTile
        testId="activity-kpi-unresolved"
        label={KPI_UNRESOLVED}
        value={formatCount(payload.unresolvedAdjustments)}
        status={payload.unresolvedAdjustments > 0 ? 'amber' : null}
      />
    </KpiStrip>
  );
}
