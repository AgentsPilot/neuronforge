'use client';

/**
 * The comparison cells of one Model pricing row (AI model price review slice
 * 4, user decision UF-5). Presentational; the page owns the Model and Actions
 * cells and the per-token editor.
 *
 * Every price is the server's decimal string printed as is, with no
 * arithmetic (R-1): "$0.075", never "$0.08". Colour, gap and words come from
 * the server (RR-4); the chips always carry words and an icon (MP-NFR-8).
 */

import type { ComparisonRow } from '@/lib/ai/pricing-research/comparisonModel';
import { unitGapText, type UnitComparison } from '@/lib/ai/pricing-research/coverageColour';
import { BLOCKING_FLAGS, type PendingLineFlag } from '@/lib/ai/pricing-research/lineFlags';
import { HTTPS_PREFIX } from '@/lib/ai/pricing-research/pendingLineSchema';
import { isOfficialSourceUrl } from '@/lib/ai/pricing-research/officialSources';
import { formatUtc, formatUtcDate } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_TD, ADMIN_TD_NUM } from '@/app/admin/components/layout/adminTable';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import {
  BASIS_WORDS,
  CACHED_PREFIX,
  NEEDS_A_REASON,
  ROW_STATE_WORDS,
  SOURCE_WORDS,
  STATUS_WORDS,
} from '@/app/admin/system-config/priceReviewCopy';
import type { PriceTableRow, StoredPriceRowLike } from '@/app/admin/system-config/priceTableRows';

const MUTED = 'block text-[11px] text-slate-400';
const DASH = '—';

function money(value: string | null): string {
  return value === null ? DASH : `$${value}`;
}

/** The gap of a compared unit; a dash when one side is missing. */
function gapCell(unit: UnitComparison): string {
  return unit.status === 'no_change' || unit.status === 'covered' || unit.status === 'undercharging' ? unitGapText(unit) : DASH;
}

function basisWords(unit: UnitComparison): string | null {
  if (unit.current === null) return unit.status === 'not_priced' ? BASIS_WORDS.unpriced : null;
  return BASIS_WORDS[unit.currentBasis] ?? null;
}

export function UsedByCell({ row }: { row: ComparisonRow | null }) {
  if (!row) return <td className={ADMIN_TD}>{DASH}</td>;
  return (
    <td className={ADMIN_TD}>
      {row.areas.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {row.areas.map((tag) => (
            <li key={tag.area}>
              <StatusChip tone="neutral">{`${tag.label}${tag.enabled ? '' : ' (off)'}`}</StatusChip>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-slate-400">{row.usageLabel}</span>
      )}
    </td>
  );
}

function unitOf(row: ComparisonRow, name: string): UnitComparison | undefined {
  return row.units.find((unit) => unit.unit === name);
}

/** One group (input or output): ours, provider, gap; the cached sub-line under input (NR-5). */
function TokenGroup({ unit, cached }: { unit: UnitComparison | undefined; cached?: UnitComparison }) {
  const showCached = cached !== undefined && (cached.current !== null || cached.pending !== null);
  const basis = unit ? basisWords(unit) : null;
  return (
    <>
      <td className={ADMIN_TD_NUM}>
        <span>{money(unit?.current ?? null)}</span>
        {basis && <span className={MUTED}>{basis}</span>}
        {showCached && (
          <span className={MUTED} data-testid="cached-ours">
            {`${CACHED_PREFIX} ${money(cached.current)}`}
            {basisWords(cached) ? ` (${basisWords(cached)})` : ''}
          </span>
        )}
      </td>
      <td className={ADMIN_TD_NUM}>
        <span>{money(unit?.pending ?? null)}</span>
        {showCached && <span className={MUTED} data-testid="cached-provider">{`${CACHED_PREFIX} ${money(cached.pending)}`}</span>}
      </td>
      <td className={ADMIN_TD_NUM}>
        <span>{unit ? gapCell(unit) : DASH}</span>
        {showCached && <span className={MUTED} data-testid="cached-gap">{`${CACHED_PREFIX} ${gapCell(cached)}`}</span>}
      </td>
    </>
  );
}

/** The six price cells: input and output groups, or one merged image cell (NR-5). */
export function PriceCells({ row }: { row: ComparisonRow }) {
  if (row.kind === 'image') {
    return (
      <td className={ADMIN_TD} colSpan={6}>
        <ul className="space-y-1" aria-label={`Image prices for ${row.modelName}`}>
          {row.units.map((unit) => {
            const basis = basisWords(unit);
            return (
              <li key={unit.unit} className="whitespace-nowrap tabular-nums">
                {`${unit.unit.replace(/^image /, '')}, per image: ours ${money(unit.current)}${basis ? ` (${basis})` : ''} · provider ${money(unit.pending)} · gap ${gapCell(unit)}`}
              </li>
            );
          })}
        </ul>
      </td>
    );
  }
  return (
    <>
      <TokenGroup unit={unitOf(row, 'input')} cached={unitOf(row, 'cached_input')} />
      <TokenGroup unit={unitOf(row, 'output')} />
    </>
  );
}

export function EmptyPriceCells() {
  return (
    <td className={ADMIN_TD} colSpan={6}>
      <span className="text-slate-400">{DASH}</span>
    </td>
  );
}

function comparedChip(row: ComparisonRow) {
  if (row.colour === 'red') return <StatusChip tone="danger">{STATUS_WORDS.undercharging}</StatusChip>;
  if (row.colour === 'green') return <StatusChip tone="ok">{STATUS_WORDS.covered}</StatusChip>;
  if (row.pending.length === 0) return <StatusChip tone="unknown">{STATUS_WORDS.noNewPrice}</StatusChip>;
  const isNew = row.pending.some((view) => view.flags.includes('new_model'));
  return <StatusChip tone="unknown">{isNew ? STATUS_WORDS.newModel : STATUS_WORDS.notCompared}</StatusChip>;
}

/** Each distinct flag of the row's pending lines, in words (labels from the server, SA RC-3). */
function flagWords(row: ComparisonRow): string[] {
  const seen = new Map<string, string>();
  for (const view of row.pending) {
    for (const flag of view.flags) {
      if (seen.has(flag)) continue;
      const label = view.flagLabels.find((entry) => entry.flag === flag)?.label ?? flag;
      const blocking = (BLOCKING_FLAGS as readonly string[]).includes(flag as PendingLineFlag);
      seen.set(flag, blocking ? `${label} (${NEEDS_A_REASON})` : label);
    }
  }
  return [...seen.values()];
}

export function StatusCell<T extends StoredPriceRowLike>({ row }: { row: PriceTableRow<T> }) {
  if (row.kind === 'retired') {
    return (
      <td className={ADMIN_TD}>
        <StatusChip tone="neutral">{`${ROW_STATE_WORDS.retired} ${formatUtcDate(row.retiredOn)}`}</StatusChip>
      </td>
    );
  }
  if (row.kind === 'starts_later') {
    return (
      <td className={ADMIN_TD}>
        <StatusChip tone="neutral">{`${ROW_STATE_WORDS.startsLater} ${formatUtcDate(row.startsOn)}`}</StatusChip>
      </td>
    );
  }
  if (row.kind === 'superseded') {
    return (
      <td className={ADMIN_TD}>
        <StatusChip tone="neutral">{ROW_STATE_WORDS.superseded}</StatusChip>
      </td>
    );
  }
  const comparison = row.comparison;
  const flags = flagWords(comparison);
  const showSummary = comparison.colour !== 'grey' && comparison.summary !== STATUS_WORDS.covered;
  return (
    <td className={ADMIN_TD}>
      {comparedChip(comparison)}
      {showSummary && <span className={MUTED} data-testid="row-summary">{comparison.summary}</span>}
      {flags.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200" aria-label="Flags">
          {flags.map((words) => (
            <li key={words}>{words}</li>
          ))}
        </ul>
      )}
    </td>
  );
}

/** RC-9: a link only for an allow-listed host (or the exact https prefix when the provider is unknown). */
function safeSourceUrl(provider: string | null, url: string): boolean {
  return provider ? isOfficialSourceUrl(provider, url) : url.startsWith(HTTPS_PREFIX);
}

export function SourceCell({ row }: { row: ComparisonRow | null }) {
  if (!row || row.pending.length === 0) return <td className={ADMIN_TD}>{DASH}</td>;
  const seen = new Set<string>();
  const sources = row.pending.filter((view) => {
    const key = `${view.sourceUrl}|${view.checkedOn}|${view.createdBy}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <td className={ADMIN_TD}>
      <ul className="space-y-1">
        {sources.map((view) => (
          <li key={`${view.lineId}`}>
            {safeSourceUrl(row.provider, view.sourceUrl) ? (
              <a
                href={view.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-300 underline hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              >
                {SOURCE_WORDS.link}
              </a>
            ) : (
              <span className="text-slate-400">{DASH}</span>
            )}
            <span className={MUTED}>{`${SOURCE_WORDS.checked} ${formatUtcDate(view.checkedOn)}`}</span>
            <span className={MUTED}>{`${SOURCE_WORDS.enteredBy} ${view.createdBy}, ${formatUtc(view.createdAt)}`}</span>
            <span className={MUTED}>{`${SOURCE_WORDS.crossCheck} ${view.crossCheck}`}</span>
          </li>
        ))}
      </ul>
    </td>
  );
}
