'use client';

/**
 * The admin KPI strip and tile (Admin Layout Standard C-11, §5.4 K-1 to K-10).
 *
 * The whole tile is one `<a>` (K-6): never a `<button>`, so a page's button
 * count is unchanged, and never a `<section>` or a region, so its landmark
 * count is unchanged (A-9). Tile content is spans only, because it sits inside
 * the link.
 *
 * L-1b builds what its pilot (Scheduled jobs & queues) uses: the same-page
 * anchor mode (`href="#…"`) and the red status row. The cross-page link mode
 * (SA Q-2), the same-page filter mode (L-2a, R-7) and the other statuses
 * (SA Q-3) arrive with their first consumer.
 */

import { useId } from 'react';
import type { ReactNode } from 'react';
import { AlertOctagon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * K-4 status keys. They mirror Health's `TileStatus` keys
 * (`lib/admin/health/healthTypes.ts`), so a page whose payload already carries
 * a `TileStatus` passes it straight through (SA M-1). L-1b builds `red` only;
 * later statuses use the same keys (`amber`, `green`, `not_measured`,
 * `unavailable`). An absent status is a neutral tile with no status row.
 */
export type KpiTileStatus = 'red';

interface TileStatusStyle {
  label: string;
  icon: LucideIcon;
  card: string;
  accent: string;
}

/**
 * Values copied from Health's `STATUS_STYLES` (`app/admin/components/health/HealthTile.tsx`),
 * the K-4 colour source. Copied, not imported: the shared folder may not import
 * another app folder (§6.1 S-3). The card background is the neutral tile's.
 * When "Healthy" is added, its green comes from `StatusChip.tsx`'s single green
 * constant, never a second one here (S-7, SA Q-3).
 */
const TILE_STATUS_STYLES: Record<KpiTileStatus, TileStatusStyle> = {
  red: {
    label: 'Needs action',
    icon: AlertOctagon,
    card: 'border-red-500/40',
    accent: 'text-red-300',
  },
};

const NEUTRAL_CARD = 'border-slate-700';

export interface KpiStripProps {
  /** K-10: the first read is in flight; render `placeholderCount` fixed-height placeholders and no tiles. */
  loading?: boolean;
  placeholderCount?: number;
  children?: ReactNode;
}

export function KpiStrip({ loading = false, placeholderCount = 4, children }: KpiStripProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {loading
        ? Array.from({ length: placeholderCount }, (_, index) => (
            <div
              key={index}
              aria-hidden="true"
              data-testid="kpi-placeholder"
              className="h-28 animate-pulse rounded-xl border border-slate-700 bg-slate-800/40"
            />
          ))
        : children}
    </div>
  );
}

export interface KpiTileProps {
  label: string;
  /** Already formatted by the page (formatCount, a money formatter, …). */
  value: string;
  /** K-3 / K-8 sub-line, e.g. "at least: 1 of 5 queues could not be checked". */
  sub?: string | null;
  status?: KpiTileStatus | null;
  /** K-6 anchor mode: a same-page anchor such as "#queues". Other modes come later (SA Q-2, R-7). */
  href: `#${string}`;
  testId?: string;
}

export function KpiTile({ label, value, sub, status, href, testId }: KpiTileProps) {
  const subId = useId();
  const style = status ? TILE_STATUS_STYLES[status] : null;
  // K-7: the name starts with the visible label (WCAG 2.5.3) and reads label,
  // value and status. The sub-line is the description, not part of the name.
  const name = style ? `${label}, ${value}, ${style.label.toLowerCase()}` : `${label}, ${value}`;
  const StatusIcon = style?.icon;

  return (
    <a
      href={href}
      data-testid={testId}
      data-status={status ?? 'neutral'}
      aria-label={name}
      aria-describedby={sub ? subId : undefined}
      className={`block rounded-xl border bg-slate-800 p-4 transition-colors hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${style ? style.card : NEUTRAL_CARD}`}
    >
      <span className="block text-sm font-medium text-white">{label}</span>
      <span className="mt-1 block text-2xl font-semibold tabular-nums text-white">{value}</span>
      {sub && (
        <span id={subId} className="mt-1 block text-xs text-slate-400">
          {sub}
        </span>
      )}
      {style && StatusIcon && (
        <span className={`mt-1 flex items-center gap-1 text-xs font-medium ${style.accent}`}>
          <StatusIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {style.label}
        </span>
      )}
    </a>
  );
}
