'use client';

/**
 * The KPI strip (§7.1: K-1 to K-5; K-2 and K-4 from slice 1b). Every tile
 * shows its state in TEXT as well as colour, through Health's `STATUS_STYLES`
 * labels as they are (SA-W7, AC-21), and its reason line. The green style comes only from
 * `STATUS_STYLES`, and only for a tile the server proved clear.
 */

import { cn } from '@/lib/utils';
import { STATUS_STYLES } from '@/app/admin/components/health/HealthTile';
import type { FinancePayload, FinanceTile } from '@/lib/business-os/finance/financeTypes';
import { k2Subtitle, TILE_LABELS, TILE_PREVIOUS } from '../financeCopy';
import { atLeast, formatCount, formatCredits, formatUsd } from '../financeFormat';

function Tile({ tile, label, sub, value, extra }: { tile: FinanceTile; label: string; sub?: string; value: string | null; extra?: string | null }) {
  const style = STATUS_STYLES[tile.status];
  const Icon = style.icon;
  return (
    <div className={cn('rounded-xl p-4 space-y-1', style.card)} data-testid={`tile-${tile.id}`} data-status={tile.status}>
      <p className="text-xs text-slate-400">{label}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
      {value !== null && <p className="text-lg font-semibold text-white">{value}</p>}
      {extra && <p className="text-xs text-slate-400">{extra}</p>}
      <p className={cn('flex items-center gap-1 text-xs font-medium', style.accent)}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span data-testid={`tile-${tile.id}-state`}>{style.label}</span>
      </p>
      <p className="text-xs text-slate-300" data-testid={`tile-${tile.id}-headline`}>
        {tile.headline}
      </p>
    </div>
  );
}

export function FinanceKpiStrip({
  tiles,
  farOverAllowancePercent,
}: {
  tiles: FinancePayload['tiles'];
  /** K-2's line, from the payload (data, SA-W10). */
  farOverAllowancePercent: number | null;
}) {
  const { k1, k2, k3, k4, k5 } = tiles;
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="kpi-strip">
      <Tile
        tile={k1}
        label={TILE_LABELS.k1}
        sub={TILE_LABELS.k1Sub}
        value={k1.value ? atLeast(formatUsd(k1.value.value), k1.value.exact) : null}
        extra={k1.previous ? `${TILE_PREVIOUS} ${atLeast(formatUsd(k1.previous.value), k1.previous.exact)}` : null}
      />
      <Tile
        tile={k2}
        label={TILE_LABELS.k2}
        sub={k2Subtitle(farOverAllowancePercent)}
        value={k2.value ? atLeast(formatCount(k2.value.value), k2.value.exact) : null}
      />
      <Tile tile={k3} label={TILE_LABELS.k3} value={k3.value ? atLeast(formatCount(k3.value.value), k3.value.exact) : null} />
      {/* K-4 is in credits, never money: no currency (§8.4). */}
      <Tile tile={k4} label={TILE_LABELS.k4} sub={TILE_LABELS.k4Sub} value={k4.value ? formatCredits(k4.value.value) : null} />
      {/* K-5 never shows a figure in slice 1: no $0 (S1-FR-25). */}
      <Tile tile={k5} label={TILE_LABELS.k5} value={null} />
    </div>
  );
}
