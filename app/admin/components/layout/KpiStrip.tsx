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
 * `amber` status. Finance F-5, their first consumer, adds the cross-page link
 * mode (`link`, `next/link`, SA Q-2), the other statuses (`green`,
 * `not_measured`, `unavailable`, SA Q-3), a tile with no value, and an
 * optional second line under the status row (`detail`). None of these
 * changes what an existing caller renders (Pin A,
 * `__tests__/KpiStrip.callers.pin.render.test.tsx`).
 *
 * Filter mode is still one real `<a>` with the filtered view's URL, so a
 * modified or middle click, and Copy link, use the address (Q-14). Only a plain
 * left click is taken over: it applies the same patch through the page's
 * `useAdminFilters`, the one write path. A tile with no target is not a link:
 * a `div role="group"` carrying the K-7 name (never a button, never a region).
 *
 * Money MK-0 (KPI restructure review §3.3 LL-1 to LL-5, SA-8, BD-46) adds an
 * optional `indicator`: an uncoloured forward arrow (leading) or clock
 * (lagging) in the tile's top corner, with an in-house accessible tooltip.
 * Interactive content inside a link is invalid, so the icon is NEVER inside the
 * tile's `<a>`: an indicator tile is a `relative` wrapper holding the
 * unchanged tile and, as its sibling, `KpiIndicator` positioned in the corner.
 * A click on the icon therefore never reaches the link. With no `indicator`
 * the tile renders exactly as before (no wrapper, no extra hook), so Pin A
 * holds. `KpiIndicator` is exported for block KPIs too (one copy of the icon,
 * the words and the behaviour).
 */

import { useEffect, useId, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Clock, HelpCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { OK_GREEN } from './StatusChip';

/**
 * K-4 status keys. They mirror Health's `TileStatus` keys
 * (`lib/admin/health/healthTypes.ts`), so a page whose payload already carries
 * a `TileStatus` passes it straight through (SA M-1); Health's `neutral` is an
 * absent status here: a neutral tile with no status row (K-4).
 */
export type KpiTileStatus = 'red' | 'amber' | 'green' | 'not_measured' | 'unavailable';

interface TileStatusStyle {
  label: string;
  icon: LucideIcon;
  card: string;
  accent: string;
}

/**
 * Values copied from Health's `STATUS_STYLES` (`app/admin/components/health/HealthTile.tsx`),
 * the K-4 colour source. Copied, not imported: the shared folder may not import
 * another app folder (§6.1 S-3). The card background is the neutral tile's:
 * Health draws its two grey statuses on a lighter card, which is not copied,
 * because overriding the base would rely on class order (S-9, F-5 SA-W2).
 * "Healthy" takes its green from `StatusChip.tsx`'s single green constant,
 * never a second one here (S-7, SA Q-3).
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
  green: {
    label: 'Healthy',
    icon: CheckCircle2,
    card: OK_GREEN.card,
    accent: OK_GREEN.accent,
  },
  not_measured: {
    label: 'Not measured yet',
    icon: CircleDashed,
    card: 'border-dashed border-slate-600',
    accent: 'text-slate-400',
  },
  unavailable: {
    label: 'Could not check',
    icon: HelpCircle,
    card: 'border-slate-600',
    accent: 'text-slate-400',
  },
};

const NEUTRAL_CARD = 'border-slate-700';
/** A filter tile whose filter is the applied one (T-7 accent). */
const CURRENT_CARD = 'border-purple-500 ring-1 ring-purple-500/50';
const TILE_BASE = 'block rounded-xl border bg-slate-800 p-4';
const LINK_EXTRAS =
  'transition-colors hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

// ── MK-0: the leading / lagging indicator (§3.3, SA-8) ──────────────────────

export type KpiIndicatorKind = 'leading' | 'lagging';

export interface KpiIndicatorSpec {
  kind: KpiIndicatorKind;
  /** Tooltip line 1: the KPI in plain words, from the caller's one copy constant per KPI (LL-4). */
  definition: string;
}

/** LL-2 line 2 and the LL-3 name prefix, one copy each (LL-4). */
export const KPI_INDICATOR_WORDS: Record<KpiIndicatorKind, { name: string; line: string }> = {
  leading: { name: 'Leading indicator', line: 'Leading indicator: it tells you early what is coming' },
  lagging: { name: 'Lagging indicator', line: 'Lagging indicator: it tells you what already happened' },
};

const INDICATOR_ICONS: Record<KpiIndicatorKind, LucideIcon> = { leading: ArrowRight, lagging: Clock };

export interface KpiIndicatorProps {
  indicator: KpiIndicatorSpec;
  testId?: string;
  /** Placement: the tile passes its corner; a block KPI may pass its own. */
  className?: string;
}

/**
 * The icon and its tooltip (SA-8). A native button (focusable, with the LL-3
 * name) and a `role="tooltip"` linked by `aria-describedby`, always in the
 * DOM and hidden while closed. Opens on hover (the tooltip itself is hoverable)
 * and on focus; closes on leave, on blur and on Escape, which is heard while
 * open, so it dismisses without moving focus or the pointer (WCAG 1.4.13).
 * QA-MK0-N1: an OPEN tooltip consumes that Escape, so a drawer around it does
 * not close on the same press. The listener is on WINDOW in the CAPTURE phase,
 * the first stop of the event path, ahead of Radix's document capture listener
 * (`@radix-ui/react-use-escape-keydown`), and it stops propagation and prevents
 * the default. A CLOSED tooltip has no listener, so the next Escape passes
 * through untouched and the drawer closes. A click opens it (touch; in a browser the click also focuses
 * the button), and never navigates; blur, leave or Escape closes it. The icon
 * is not colour-coded, so it never competes with the status colours (LL-1).
 */
export function KpiIndicator({ indicator, testId, className = '' }: KpiIndicatorProps) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused || pinned) && !dismissed;
  const words = KPI_INDICATOR_WORDS[indicator.kind];
  const Icon = INDICATOR_ICONS[indicator.kind];

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      setDismissed(true);
      setPinned(false);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [open]);

  return (
    <span
      className={`inline-flex ${className}`.trim()}
      data-testid={testId}
      data-indicator={indicator.kind}
      onMouseEnter={() => {
        // A new hover after an Escape opens it again.
        setDismissed(false);
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={`${words.name}. ${indicator.definition}`}
        aria-describedby={tooltipId}
        onFocus={() => {
          setDismissed(false);
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        onClick={() => {
          // Opens only: a toggle would close it at once, because the same click focuses the button.
          setDismissed(false);
          setPinned(true);
        }}
        className="rounded p-0.5 text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!open}
        className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-600 bg-slate-900 p-2 text-left text-xs text-slate-300 shadow-lg"
      >
        <span className="block">{indicator.definition}</span>
        <span className="mt-1 block text-slate-400">{words.line}</span>
      </span>
    </span>
  );
}

/** Room for the corner icon, added to the tile only when it has one. */
const INDICATOR_PAD = ' pr-9';

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
  /**
   * Already formatted by the page (formatCount, a money formatter, …). Null
   * or absent: the tile has no figure yet, so no value line (Finance F-5).
   */
  value?: string | null;
  /** K-3 / K-8 sub-line, e.g. "at least: 1 of 5 queues could not be checked". */
  sub?: string | null;
  /**
   * A second line, under the status row: the reason the status is what it is
   * (Finance F-5, the payload's headline). Part of the description, not the name.
   */
  detail?: string | null;
  status?: KpiTileStatus | null;
  testId?: string;
  /**
   * MK-0: the leading / lagging icon and its tooltip (§3.3). Optional: absent
   * or null renders exactly as before. Rendered BESIDE the tile's link, never
   * inside it (see the header).
   */
  indicator?: KpiIndicatorSpec | null;
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
        link?: never;
      }
    | { filter: KpiTileFilter; href?: never; link?: never }
    /** K-6 cross-page mode: another admin page, through `next/link` (Finance F-5). */
    | { link: `/${string}`; href?: never; filter?: never }
    /** No target: not a link (K-6). */
    | { href?: never; filter?: never; link?: never }
  );

/**
 * A plain left click with no modifier: the only click the filter mode takes over.
 * Exported for the AI cost & usage drill link, the same "real link, plain left
 * click applies in place" contract (§5.8 D-3, L-2b SA Q-3): one implementation.
 */
export function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
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
  const { label, value, sub, detail, status, testId, indicator } = props;
  const subId = useId();
  // Derived, not a second useId: an extra hook call would shift every later id on the page.
  const detailId = `${subId}-detail`;
  const hasValue = value !== null && value !== undefined;
  const style = status ? TILE_STATUS_STYLES[status] : null;
  // K-7: the name starts with the visible label (WCAG 2.5.3) and reads label,
  // value and status. The sub-line and the detail are the description, not the name.
  const name = [label, hasValue ? value : null, style ? style.label.toLowerCase() : null]
    .filter((part): part is string => part !== null)
    .join(', ');
  const describedBy =
    [sub ? subId : null, detail ? detailId : null].filter((id): id is string => id !== null).join(' ') || undefined;
  const StatusIcon = style?.icon;
  const pad = indicator ? INDICATOR_PAD : '';
  // MK-0: with an indicator, the tile and its icon side by side in one relative box; without, the tile itself.
  const withIndicator = (tile: ReactNode) =>
    indicator ? (
      <div className="relative" data-testid={testId ? `${testId}-box` : undefined}>
        {tile}
        <KpiIndicator
          indicator={indicator}
          testId={testId ? `${testId}-indicator` : undefined}
          className="absolute right-2 top-2"
        />
      </div>
    ) : (
      tile
    );

  const content = (
    <>
      <span className="block text-sm font-medium text-white">{label}</span>
      {hasValue && <span className="mt-1 block text-2xl font-semibold tabular-nums text-white">{value}</span>}
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
      {detail && (
        <span id={detailId} className="mt-1 block text-xs text-slate-300">
          {detail}
        </span>
      )}
    </>
  );

  const shared = {
    'data-testid': testId,
    'data-status': status ?? 'neutral',
    'aria-describedby': describedBy,
  };

  if (props.filter) {
    const { href, apply, current } = props.filter;
    const isCurrent = current === true;
    const card = style ? style.card : isCurrent ? CURRENT_CARD : NEUTRAL_CARD;
    return withIndicator(
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
        className={`${TILE_BASE} ${LINK_EXTRAS} ${card}${pad}`}
      >
        {content}
      </a>
    );
  }

  if (props.href) {
    return withIndicator(
      <a
        href={props.href}
        data-testid={testId}
        data-status={status ?? 'neutral'}
        aria-label={name}
        aria-describedby={describedBy}
        className={`block rounded-xl border bg-slate-800 p-4 transition-colors hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${style ? style.card : NEUTRAL_CARD}${pad}`}
      >
        {content}
      </a>
    );
  }

  // K-6 cross-page mode: `next/link`, so a plain click is a client navigation
  // and a modified click, a middle click and Copy link use the real address.
  if (props.link) {
    return withIndicator(
      <Link
        href={props.link}
        data-testid={testId}
        data-status={status ?? 'neutral'}
        aria-label={name}
        aria-describedby={describedBy}
        className={`${TILE_BASE} ${LINK_EXTRAS} ${style ? style.card : NEUTRAL_CARD}${pad}`}
      >
        {content}
      </Link>
    );
  }

  // K-6: no target, so not a link and not a button. `role="group"` carries the
  // K-7 name, which a plain div may not; a group is not a landmark (A-9).
  return withIndicator(
    <div role="group" {...shared} aria-label={name} className={`${TILE_BASE} ${style ? style.card : NEUTRAL_CARD}${pad}`}>
      {content}
    </div>
  );
}
