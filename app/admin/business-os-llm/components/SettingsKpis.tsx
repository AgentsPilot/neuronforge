'use client';

/**
 * The Settings tab's KPI strip (Admin Layout Standard §5.4, §7.13; L-10
 * workplan §2.3). Every value is counted from the payload already read (K-9)
 * with the cards' own rules, so a tile and a card can never disagree:
 *
 *   Areas                 areas.length                              no target
 *   Calls                 calls + excludedCalls, the card chip     no target
 *                         (FR-9)
 *   Calls configured off  sum of `areaOffSummary().offCalls`,       anchor to the first card
 *                         sub-line "plus N areas configured off"    showing either (SA Q-1)
 *   Row issues            sum of `areaIssues.length`                anchor to the first card with any
 *
 * Every tile is neutral (SA-R-4, D-4 (a)): the payload carries no status for
 * these counts, and Health's `settings.off` rule ("areas or calls") is not this
 * sum. No tile names an area: the anchor carries it only in its href.
 */

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import { formatCount } from '@/app/admin/components/layout/adminFormat';

import { areaOffSummary } from '../areaState';
import { KPI_AREAS, KPI_AREAS_OFF, KPI_CALLS, KPI_CALLS_OFF, KPI_ROW_ISSUES } from '../copy';
import type { SettingsPayload } from '../types';

export interface SettingsKpisProps {
  payload: SettingsPayload | null;
  /** The first read (or the first after an error) is in flight: the K-10 placeholders. */
  firstLoad: boolean;
}

const PLACEHOLDERS = 4;

export function SettingsKpis({ payload, firstLoad }: SettingsKpisProps) {
  if (!payload) return firstLoad ? <KpiStrip loading placeholderCount={PLACEHOLDERS} /> : null;

  let calls = 0;
  let offCalls = 0;
  let offAreas = 0;
  let rowIssues = 0;
  let firstOff: string | null = null;
  let firstIssue: string | null = null;

  for (const area of payload.areas) {
    // S-4 / QA EDGE-1: a payload without `excludedCalls` costs a count, not the strip.
    const excludedCalls = area.excludedCalls ?? [];
    calls += area.calls.length + excludedCalls.length;

    const { areaShowsOff, offCalls: areaOffCalls } = areaOffSummary(area);
    offCalls += areaOffCalls;
    if (areaShowsOff) offAreas += 1;
    if (firstOff === null && (areaShowsOff || areaOffCalls > 0)) firstOff = area.area;

    rowIssues += area.areaIssues.length;
    if (firstIssue === null && area.areaIssues.length > 0) firstIssue = area.area;
  }

  return (
    <KpiStrip>
      <KpiTile testId="settings-kpi-areas" label={KPI_AREAS} value={formatCount(payload.areas.length)} />
      <KpiTile testId="settings-kpi-calls" label={KPI_CALLS} value={formatCount(calls)} />
      {/* S-2: each href is built inline, so it keeps the `#${string}` type. */}
      {firstOff !== null ? (
        <KpiTile
          testId="settings-kpi-calls-off"
          label={KPI_CALLS_OFF}
          value={formatCount(offCalls)}
          sub={offAreas > 0 ? KPI_AREAS_OFF(offAreas) : null}
          href={`#bos-llm-area-${firstOff}`}
        />
      ) : (
        <KpiTile testId="settings-kpi-calls-off" label={KPI_CALLS_OFF} value={formatCount(offCalls)} />
      )}
      {firstIssue !== null ? (
        <KpiTile
          testId="settings-kpi-row-issues"
          label={KPI_ROW_ISSUES}
          value={formatCount(rowIssues)}
          href={`#bos-llm-area-${firstIssue}`}
        />
      ) : (
        <KpiTile testId="settings-kpi-row-issues" label={KPI_ROW_ISSUES} value={formatCount(rowIssues)} />
      )}
    </KpiStrip>
  );
}
