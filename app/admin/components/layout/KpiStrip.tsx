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
 * anchor mode (`href="#…"`) and the red status row. L-2a (AI cost & usage)
 * adds the same-page filter mode (Q-14, R-7), the no-target tile and the
 * `amber` status. The cross-page link mode (SA Q-2) and the other statuses
 * (SA Q-3) arrive with their first consumer.
 *
 * Filter mode is still one real `<a>` with the filtered view's URL, so a
 * modified or middle click, and Copy link, use the address (Q-14). Only a plain
 * left click is taken over: it applies the same patch through the page's
 * `useAdminFilters`, the one write path. A tile with no target is not a link:
 * a `div role="group"` carrying the K-7 name (never a button, never a region).
 */

import { useId } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { AlertOctagon, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * K-4 status keys. They mirror Health's `TileStatus` keys
 * (`lib/admin/health/healthTypes.ts`), so a page whose payload already carries
 * a `TileStatus` passes it straight through (SA M-1). L-1b builds `red` only;
 * later statuses use the same keys (`amber`, `green`, `not_measured`,
 * `unavailable`). An absent status is a neutral tile with no status row.
 */
export type KpiTileStatus = 'red' | 'amber';

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
  amber: {
    label: 'Needs a look',
    icon: AlertTriangle,
    card: 'border-amber-500/40',
    accent: 'text-amber-300',
  },
};

const NEUTRAL_CARD = 'border-slate-700';
/** A filter tile whose filter is the applied one (T-7 accent). */
const CURRENT_CARD = 'border-purple-500 ring-1 ring-purple-500/50';
const TILE_BASE = 'block rounded-xl border bg-slate-800 p-4';
const LINK_EXTRAS =
  'transition-colors hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

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

interface KpiTileBase {
  label: string;
  /** Already formatted by the page (formatCount, a money formatter, …). */
  value: string;
  /** K-3 / K-8 sub-line, e.g. "at least: 1 of 5 queues could not be checked". */
  sub?: string | null;
  status?: KpiTileStatus | null;
  testId?: string;
}

/** K-6 same-page filter tile (Q-14, R-7). */
export interface KpiTileFilter {
  /** The filtered view as a real link: the page path plus `hrefFor(patch)`. */
  href: string;
  /** Applies the same patch through the page's `useAdminFilters`. */
  apply: () => void;
  /** This tile's filter is the applied one (a toggle tile): `aria-current` and the purple ring. A status wins over it. */
  current?: boolean;
}

export type KpiTileProps = KpiTileBase &
  (
    | {
        /** K-6 anchor mode: a same-page anchor such as "#queues" (L-1b). */
        href: `#${string}`;
        filter?: never;
      }
    | { filter: KpiTileFilter; href?: never }
    /** No target: not a link (K-6). */
    | { href?: never; filter?: never }
  );

/** A plain left click with no modifier: the only click the filter mode takes over. */
function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function KpiTile(props: KpiTileProps) {
  const { label, value, sub, status, testId } = props;
  const subId = useId();
  const style = status ? TILE_STATUS_STYLES[status] : null;
  // K-7: the name starts with the visible label (WCAG 2.5.3) and reads label,
  // value and status. The sub-line is the description, not part of the name.
  const name = style ? `${label}, ${value}, ${style.label.toLowerCase()}` : `${label}, ${value}`;
  const StatusIcon = style?.icon;

  const content = (
    <>
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
    </>
  );

  const shared = {
    'data-testid': testId,
    'data-status': status ?? 'neutral',
    'aria-describedby': sub ? subId : undefined,
  };

  if (props.filter) {
    const { href, apply, current } = props.filter;
    const isCurrent = current === true;
    const card = style ? style.card : isCurrent ? CURRENT_CARD : NEUTRAL_CARD;
    return (
      <a
        href={href}
        {...shared}
        aria-label={name}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={(event) => {
          // Modified and non-left clicks keep the browser's own handling of the
          // real address (new tab, new window, download); middle click raises
          // auxclick, not click, so it never reaches here.
          if (!isPlainLeftClick(event)) return;
          event.preventDefault();
          apply();
        }}
        className={`${TILE_BASE} ${LINK_EXTRAS} ${card}`}
      >
        {content}
      </a>
    );
  }

  if (props.href) {
    return (
      <a
        href={props.href}
        data-testid={testId}
        data-status={status ?? 'neutral'}
        aria-label={name}
        aria-describedby={sub ? subId : undefined}
        className={`block rounded-xl border bg-slate-800 p-4 transition-colors hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${style ? style.card : NEUTRAL_CARD}`}
      >
        {content}
      </a>
    );
  }

  // K-6: no target, so not a link and not a button. `role="group"` carries the
  // K-7 name, which a plain div may not; a group is not a landmark (A-9).
  return (
    <div role="group" {...shared} aria-label={name} className={`${TILE_BASE} ${style ? style.card : NEUTRAL_CARD}`}>
      {content}
    </div>
  );
}
