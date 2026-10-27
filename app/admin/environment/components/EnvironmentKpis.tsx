'use client';

/**
 * The Environment page's KPI strip (admin environment view EC-4; requirement
 * FR-20; Admin Layout Standard K-1 to K-10; SA Q4-5, Q4-6, Q4-8).
 *
 * Five tiles, every figure from the server's counts (K-5, K-9): Set, Required
 * not set, Should not be set here, Values to check and Uncategorised. Amber
 * only above 0, never green; "Not measured yet" when the environment is not
 * recognised. A tile is a same-page anchor to the first visible matching row
 * (or the Uncategorised card), and not a link when there is no target (K-6).
 * The tile model is built in `environmentDisplay.ts`, so the words are tested
 * without a render.
 */

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import type { EnvironmentViewPayload } from '@/lib/admin/environment-types';

import { kpiTiles, type VisibleView } from '../environmentDisplay';

export interface EnvironmentKpisProps {
  /** Null before the first read and after a failed one. */
  data: EnvironmentViewPayload | null;
  loading: boolean;
  view: VisibleView | null;
}

export function EnvironmentKpis({ data, loading, view }: EnvironmentKpisProps) {
  // K-10: placeholders while the first read is in flight; no strip after an error.
  if (!data || !view) return loading ? <KpiStrip loading placeholderCount={5} /> : null;
  return (
    <KpiStrip>
      {kpiTiles(data, view).map((tile) =>
        tile.href ? (
          <KpiTile key={tile.testId} testId={tile.testId} label={tile.label} value={tile.value} sub={tile.sub} status={tile.status} href={tile.href} />
        ) : (
          <KpiTile key={tile.testId} testId={tile.testId} label={tile.label} value={tile.value} sub={tile.sub} status={tile.status} />
        )
      )}
    </KpiStrip>
  );
}
