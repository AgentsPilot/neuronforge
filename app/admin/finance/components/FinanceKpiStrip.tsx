'use client';

/**
 * The KPI strip (§7.1: K-1 to K-5; K-2 and K-4 from slice 1b), on the shared
 * admin `KpiStrip` / `KpiTile` since Finance F-5 (Admin Layout Standard §5.4).
 *
 * Every tile renders the status the payload carries, and decides none
 * (standard K-5 (i)): the red and amber rules stay data in `financeRules.ts`.
 * A coloured tile shows its state in words as well as colour (the shared K-4
 * labels, equal to Health's); a neutral tile has no status row (K-4, F-5
 * SA-W1). The payload's headline is the tile's second line (`detail`), and
 * K-1's same-days-last-month figure joins its sub-line (F-5 SA-W4).
 *
 * Display only (AC-181): every value below is the same formatter call as
 * before F-5, moved, not rewritten (pinned by `financeTiles.pin.render.test.tsx`).
 *
 * Slice 4a (S4-FR-7, SA-W47, SA-WR-34): K-5 shows the boost net for the filter
 * window from `tile.money`, printed ONLY through `formatMoney` (one currency) or
 * a copy string (several currencies, unknown); never a bare number, never a
 * sum of two currencies, never "At least". Its caption names the window.
 *
 * Clicks (F-5, BD-31): K-1 opens AI cost & usage (cross-page); K-2 to K-5 jump
 * to their own section. The view decides how (`targetFor`): a plain anchor
 * where the sections are mounted, the same-page filter mode on the Accounts tab.
 */

import { KpiStrip, KpiTile, type KpiTileFilter, type KpiTileStatus } from '@/app/admin/components/layout/KpiStrip';
import type { FinancePayload, FinanceTile, FinanceTileMoney } from '@/lib/business-os/finance/financeTypes';
import { k1SubLine, k2Subtitle, k5Caption, K5_UNKNOWN, k5SeveralCurrencies, TILE_LABELS } from '../financeCopy';
import { atLeast, formatCount, formatCredits, formatMoney, formatUsd } from '../financeFormat';

/** The sections a tile can jump to (their `FinanceSection` ids). */
export type FinanceTileSection = 'credits' | 'accounts' | 'revenue';

/** A same-page anchor where the section is on screen, else the shared filter mode (Accounts tab). */
export type FinanceTileTarget = { href: `#${FinanceTileSection}` } | { filter: KpiTileFilter };

/** K-5's value: "USD 10.00", "N currencies, see Our revenue", "Unknown", or nothing (no data yet). */
function k5Value(money: FinanceTileMoney | undefined): string | null {
  if (!money) return null;
  switch (money.kind) {
    case 'one':
      return formatMoney(money.net, money.currency);
    case 'several':
      return k5SeveralCurrencies(money.currencies);
    case 'unknown':
      return K5_UNKNOWN;
    default:
      return null;
  }
}

/** The payload's status as the shared tile's: `neutral` is no status (K-4); the rest pass through. */
function tileStatus(status: FinanceTile['status']): KpiTileStatus | null {
  return status === 'neutral' ? null : status;
}

/** K-10: the first read is in flight. Outside the `kpi-strip` wrapper, so a wait for the strip means figures. */
export function FinanceKpiPlaceholders() {
  return <KpiStrip loading placeholderCount={5} />;
}

export function FinanceKpiStrip({
  tiles,
  farOverAllowancePercent,
  windowLabel,
  aiCostHref,
  targetFor,
}: {
  tiles: FinancePayload['tiles'];
  /** K-2's line, from the payload (data, SA-W10). */
  farOverAllowancePercent: number | null;
  /** The filter window, for K-5's caption only (SA-Q25, SA-W52). */
  windowLabel: string;
  /** K-1's link to AI cost & usage (`k1AnalyticsHref`: This month and the business, SA-W7 (a)). */
  aiCostHref: `/${string}`;
  /** Where a section tile goes on the current view. */
  targetFor: (section: FinanceTileSection) => FinanceTileTarget;
}) {
  const { k1, k2, k3, k4, k5 } = tiles;
  return (
    <div data-testid="kpi-strip">
      <KpiStrip>
        <KpiTile
          testId={`tile-${k1.id}`}
          label={TILE_LABELS.k1}
          value={k1.value ? atLeast(formatUsd(k1.value.value), k1.value.exact) : null}
          sub={k1SubLine(k1.previous ? atLeast(formatUsd(k1.previous.value), k1.previous.exact) : null)}
          status={tileStatus(k1.status)}
          detail={k1.headline}
          link={aiCostHref}
        />
        <KpiTile
          testId={`tile-${k2.id}`}
          label={TILE_LABELS.k2}
          value={k2.value ? atLeast(formatCount(k2.value.value), k2.value.exact) : null}
          sub={k2Subtitle(farOverAllowancePercent)}
          status={tileStatus(k2.status)}
          detail={k2.headline}
          {...targetFor('credits')}
        />
        <KpiTile
          testId={`tile-${k3.id}`}
          label={TILE_LABELS.k3}
          value={k3.value ? atLeast(formatCount(k3.value.value), k3.value.exact) : null}
          status={tileStatus(k3.status)}
          detail={k3.headline}
          {...targetFor('accounts')}
        />
        {/* K-4 is in credits, never money: no currency (§8.4). */}
        <KpiTile
          testId={`tile-${k4.id}`}
          label={TILE_LABELS.k4}
          value={k4.value ? formatCredits(k4.value.value) : null}
          sub={TILE_LABELS.k4Sub}
          status={tileStatus(k4.status)}
          detail={k4.headline}
          {...targetFor('credits')}
        />
        {/* K-5: the boost net for the window, from `money` only (SA-W47); no value when there is no data yet. */}
        <KpiTile
          testId={`tile-${k5.id}`}
          label={TILE_LABELS.k5}
          value={k5Value(k5.money)}
          sub={k5Caption(windowLabel)}
          status={tileStatus(k5.status)}
          detail={k5.headline}
          {...targetFor('revenue')}
        />
      </KpiStrip>
    </div>
  );
}
