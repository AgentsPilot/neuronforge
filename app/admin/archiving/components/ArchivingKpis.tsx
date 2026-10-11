'use client';

/**
 * Archiving's KPI strip (Admin Layout Standard §7.6, K-1 to K-10).
 *
 * Four tiles, every figure from the page's one overview read (K-9): Rows now,
 * Eligible now (for the retention chosen on each source card, so the tile and
 * the card can never disagree), Archived total and Last run. Each is a
 * same-page anchor to the part of the page that explains it (K-6).
 *
 * Colour (K-5, SA Q-2): only Last run carries a status, from the run's own
 * payload status: Failed is red, Partial and Stalled amber. Succeeded, Running
 * and "None yet" are neutral tiles whose value says the word; the chips in the
 * card and the run history keep the full map, green included. No thresholds
 * (D-4 (a)).
 *
 * The tile test ids are `kpi-*`, never the card's own ids (SA M-1). No fetch
 * and no write here: the page owns both.
 */

import { KpiStrip, KpiTile, type KpiTileStatus } from '@/app/admin/components/layout/KpiStrip';
import type { StatusTone } from '@/app/admin/components/layout/StatusChip';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import {
  DEFAULT_RETENTION_DAYS,
  type ArchiveSourceKey,
  type RetentionDays,
} from '@/lib/archiving/config';
import type { ArchiveRunSummary, ArchiveSourceOverview, ArchivingOverview } from '@/lib/archiving/types';

/**
 * The retention chosen on each source card. Partial, so a source the payload
 * adds later reads the default through `retentionFor`, never `undefined` (SA S-1).
 */
export type RetentionChoice = Partial<Record<ArchiveSourceKey, RetentionDays>>;

export function retentionFor(choice: RetentionChoice, key: ArchiveSourceKey): RetentionDays {
  return choice[key] ?? DEFAULT_RETENTION_DAYS;
}

/**
 * A run's status as the admin reads it: the word first, the chip tone second
 * (§5.9, K-5 (i)). One map, shared by the chips and the Last run tile, so they
 * cannot disagree. A `running` run whose request has died reads "Stalled".
 */
export function runStatus(run: ArchiveRunSummary): { label: string; tone: StatusTone } {
  if (run.status === 'running' && run.isStale) return { label: 'Stalled', tone: 'warn' };
  switch (run.status) {
    case 'running':
      return { label: 'Running', tone: 'info' };
    case 'succeeded':
      return { label: 'Succeeded', tone: 'ok' };
    case 'partial':
      return { label: 'Partial', tone: 'warn' };
    case 'failed':
      return { label: 'Failed', tone: 'danger' };
  }
}

interface TileFigures {
  value: string;
  sub: string | null;
  status: KpiTileStatus | null;
}

/** Last run: the newest run's word, red for danger, amber for warn, otherwise neutral (SA Q-2). */
export function lastRunTile(runs: readonly ArchiveRunSummary[]): TileFigures {
  const latest = runs[0];
  if (!latest) return { value: 'None yet', sub: null, status: null };
  const { label, tone } = runStatus(latest);
  return {
    value: label,
    sub: `${formatUtc(latest.startedAt)} · ${formatCount(latest.rowsArchived)} rows`,
    status: tone === 'danger' ? 'red' : tone === 'warn' ? 'amber' : null,
  };
}

/**
 * Eligible now: the sum, per source, of the selected option's count. The
 * sub-line names the retention and cutoff only with exactly one source (SA
 * S-2); a missing option reads as the card does, "—" and "Not available".
 */
export function eligibleTile(
  sources: readonly ArchiveSourceOverview[],
  choice: RetentionChoice
): Omit<TileFigures, 'status'> {
  const selected = sources.map((source) => {
    const days = retentionFor(choice, source.key);
    return source.options.find((option) => option.retentionDays === days);
  });
  if (selected.some((option) => option === undefined)) return { value: '—', sub: 'Not available' };
  const total = selected.reduce((sum, option) => sum + (option ? option.eligibleRows : 0), 0);
  const only = selected.length === 1 ? selected[0] : undefined;
  return {
    value: formatCount(total),
    sub: only ? `At ${only.retentionDays} days, before ${formatUtc(only.cutoff)}` : null,
  };
}

export interface ArchivingKpisProps {
  /** Null before the first read and after a failed one. */
  overview: ArchivingOverview | null;
  /** A read is in flight. */
  loading: boolean;
  retention: RetentionChoice;
}

export function ArchivingKpis({ overview, loading, retention }: ArchivingKpisProps) {
  // K-10: placeholders while a read with nothing on screen is in flight; no
  // strip at all when there is nothing to show (the error says why).
  if (!overview) return loading ? <KpiStrip loading placeholderCount={4} /> : null;

  const rowsNow = overview.sources.reduce((sum, source) => sum + source.totalRows, 0);
  const archived = overview.sources.reduce((sum, source) => sum + source.archivedTotal, 0);
  const eligible = eligibleTile(overview.sources, retention);
  const lastRun = lastRunTile(overview.runs);

  return (
    <KpiStrip>
      <KpiTile testId="kpi-rows-now" label="Rows now" value={formatCount(rowsNow)} href="#sources" />
      <KpiTile
        testId="kpi-eligible-now"
        label="Eligible now"
        value={eligible.value}
        sub={eligible.sub}
        href="#sources"
      />
      <KpiTile testId="kpi-archived-total" label="Archived total" value={formatCount(archived)} href="#run-history" />
      <KpiTile
        testId="kpi-last-run"
        label="Last run"
        value={lastRun.value}
        sub={lastRun.sub}
        status={lastRun.status}
        href="#run-history"
      />
    </KpiStrip>
  );
}
