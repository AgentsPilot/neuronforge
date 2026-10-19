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
 *
 * MK-0a (the user's decisions, 2026-10-19): the indicator is a WORD PILL,
 * "Leading" or "Lagging", neutral (not colour-coded, BD-11), instead of the
 * arrow / clock icon. Its tooltip is placed against the tile's (or block KPI's)
 * `relative` box, BELOW it, the box's width, and flips ABOVE it near the bottom
 * of the viewport, so the tile's value and label stay readable. Every tile in a
 * strip has the same size: equal columns, equal rows (`auto-rows-fr`), and an
 * indicator tile fills its cell (`h-full`). This reaches every strip caller.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, HelpCircle } from 'lucide-react';
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

/** MK-0a: the pill's word (the user's Option A); the accessible name stays `KPI_INDICATOR_WORDS[kind].name`. */
export const KPI_INDICATOR_PILL: Record<KpiIndicatorKind, string> = { leading: 'Leading', lagging: 'Lagging' };

/** The room assumed before the tooltip can be measured (MK-0a flip). */
const TOOLTIP_ROOM_PX = 160;
/** QA (MK-0a): the flip keeps this margin beyond the tooltip's own height, plus the 8px gap to the box. */
const TOOLTIP_FLIP_MARGIN_PX = 8;
/** QA (MK-0a): the tooltip keeps this gutter from the viewport's sides (a right-column tile on a phone). */
const TOOLTIP_GUTTER_PX = 16;
/** The tooltip's minimum width, as its class (`min-w-[14rem]`). */
const TOOLTIP_MIN_WIDTH_PX = 224;
/** Moving the pointer from the pill to the tooltip crosses a small gap: close only after this (WCAG 1.4.13 hoverable). */
const HOVER_CLOSE_MS = 150;

export type KpiTooltipPlacement = 'below' | 'above';

/**
 * Pure, for the test: where the tooltip goes for a box at `rect` in a viewport
 * `viewportHeight` tall. QA (MK-0a): it needs its measured height (or the
 * assumed room while unmeasured) plus the gap and a margin under the box,
 * otherwise it flips above when there is more room there.
 */
export function tooltipPlacementFor(
  rect: { top: number; bottom: number },
  viewportHeight: number,
  tooltipHeight = 0
): KpiTooltipPlacement {
  const needed = (tooltipHeight > 0 ? tooltipHeight : TOOLTIP_ROOM_PX) + 2 * TOOLTIP_FLIP_MARGIN_PX;
  const below = viewportHeight - rect.bottom;
  const above = rect.top;
  return below < needed && above > below ? 'above' : 'below';
}

/**
 * QA (MK-0a), pure for the test: keep the tooltip inside the viewport. It starts
 * at the box's left edge, at least 14rem wide; when that would run past the
 * viewport's right side (less a 16px gutter), it is right-aligned to the box's
 * right edge instead, its width capped so it also keeps the gutter on the left.
 * Null: it fits as it is, so nothing is added to the markup.
 */
export function tooltipClampFor(
  rect: { left: number; right: number; width: number },
  viewportWidth: number
): { right: 0; left: 'auto'; minWidth: 0; width: number } | null {
  const width = Math.max(rect.width, TOOLTIP_MIN_WIDTH_PX);
  if (rect.left + width <= viewportWidth - TOOLTIP_GUTTER_PX) return null;
  return { right: 0, left: 'auto', minWidth: 0, width: Math.max(0, Math.min(width, rect.right - TOOLTIP_GUTTER_PX)) };
}

export interface KpiIndicatorProps {
  indicator: KpiIndicatorSpec;
  testId?: string;
  /** Placement: the tile passes its corner; a block KPI may pass its own. */
  className?: string;
}

/**
 * The pill and its tooltip (SA-8; MK-0a). A native button (focusable, with the
 * LL-3 name) showing the word "Leading" or "Lagging", and a `role="tooltip"`
 * linked by `aria-describedby`, always in the DOM and hidden while closed.
 *
 * PLACEMENT (MK-0a): the pill sits in the box's corner (`className`); the
 * tooltip is the pill's SIBLING, positioned against the same `relative` box
 * (the tile's wrapper, or a block KPI's box), so it opens BELOW the whole box
 * (`top-full`, the box's width, at least 14rem) and never covers the value. When
 * the viewport has too little room under the box it flips ABOVE
 * (`bottom-full`). `data-placement` says which.
 *
 * Opens on hover and on focus; a click opens it (touch; in a browser the click
 * also focuses the button) and never navigates. Closes on blur, on Escape and
 * on leaving both the pill and the tooltip (after a short delay, so the
 * pointer can cross the gap: WCAG 1.4.13 hoverable). Escape is heard while
 * open, on WINDOW in the CAPTURE phase, ahead of Radix's document listener: an
 * OPEN tooltip consumes it (stopPropagation, preventDefault; QA-MK0-N1), a
 * CLOSED one has no listener, so a drawer's Escape passes through. The pill is
 * not colour-coded (neutral border, secondary text), so it never competes with
 * the status colours (LL-1, BD-11).
 */
export function KpiIndicator({ indicator, testId, className = '' }: KpiIndicatorProps) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [placement, setPlacement] = useState<KpiTooltipPlacement>('below');
  // QA (MK-0a): set only when the tooltip would leave the viewport; null keeps the markup as it was.
  const [clamp, setClamp] = useState<ReturnType<typeof tooltipClampFor>>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = (hovered || focused || pinned) && !dismissed;
  const words = KPI_INDICATOR_WORDS[indicator.kind];

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

  // MK-0a: measure the box (the tooltip's parent) when it opens: below, or above near the viewport's bottom.
  useEffect(() => {
    if (!open) return;
    const box = tooltipRef.current?.parentElement;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    setPlacement(tooltipPlacementFor(rect, window.innerHeight, tooltipRef.current?.offsetHeight ?? 0));
    setClamp(tooltipClampFor(rect, window.innerWidth));
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setHovered(true);
  };
  const leave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHovered(false), HOVER_CLOSE_MS);
  };

  return (
    <>
      <span
        className={`inline-flex ${className}`.trim()}
        data-testid={testId}
        data-indicator={indicator.kind}
        onMouseEnter={() => {
          // A new hover after an Escape opens it again.
          setDismissed(false);
          enter();
        }}
        onMouseLeave={leave}
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
          className="rounded-full border border-slate-600 bg-slate-900/60 px-2 py-0.5 text-[11px] font-medium leading-4 text-slate-300 hover:border-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
        >
          {KPI_INDICATOR_PILL[indicator.kind]}
        </button>
      </span>
      <span
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        hidden={!open}
        data-testid={testId ? `${testId}-tooltip` : undefined}
        data-placement={placement}
        data-align={clamp ? 'end' : undefined}
        style={clamp ?? undefined}
        onMouseEnter={enter}
        onMouseLeave={leave}
        className={`absolute left-0 right-0 z-30 min-w-[14rem] rounded-lg border border-slate-600 bg-slate-900 p-2 text-left text-xs text-slate-300 shadow-lg ${
          placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
        }`}
      >
        <span className="block">{indicator.definition}</span>
        <span className="mt-1 block text-slate-400">{words.line}</span>
      </span>
    </>
  );
}

/** MK-0a: room for the corner pill (so a long label never runs under it), and the full cell height (equal tiles). */
const INDICATOR_PAD = ' h-full pr-20';

export interface KpiStripProps {
  /** K-10: the first read is in flight; render `placeholderCount` fixed-height placeholders and no tiles. */
  loading?: boolean;
  placeholderCount?: number;
  children?: ReactNode;
}

export function KpiStrip({ loading = false, placeholderCount = 4, children }: KpiStripProps) {
  return (
    // MK-0a: equal columns (grid-cols-*) and equal rows (auto-rows-fr); grid items stretch, so every tile is the same size.
    <div className="grid auto-rows-fr grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
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
      <div className="relative h-full" data-testid={testId ? `${testId}-box` : undefined}>
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
