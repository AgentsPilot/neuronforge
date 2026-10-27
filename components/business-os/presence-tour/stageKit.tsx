'use client';

import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

/**
 * The pieces every scene builds its recreated screens from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RECREATED, NOT RENDERED
 *
 * None of this imports the real components. The real smart-link row is wired
 * to fetches, mutation state, a clipboard and three dialogs; mounting it on a
 * stage would run all of that. These are quiet doubles that match it visually,
 * traced from the source and line-referenced in each scene's header.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THEY FOLLOW THE THEME, DELIBERATELY
 *
 * Every surface here uses `--v2-*`, so a dark-mode owner sees their own app in
 * dark mode. `ShareGuide` does the same for our chrome and reserves literal
 * brand hex for OTHER companies' panels (WhatsApp's `#ECE5DD` stays `#ECE5DD`
 * in both themes, because that is what WhatsApp looks like). Keep that split.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRANSFORM AND OPACITY ONLY
 *
 * Every animated prop below lands on `transform` or `opacity`. Nothing here
 * animates width, height, top or left, so no frame of the tour can trigger
 * layout.
 *
 * @module components/business-os/presence-tour/stageKit
 */

/** The app's accents, as used across the Online presence page. */
export const TONE = {
  primary: '#4F6EF7',
  success: '#22C58B',
  purple: '#8B5CF6',
  amber: '#F59E0B',
} as const;

/* ── Cursor ────────────────────────────────────────────────────────────── */

/**
 * The pointer.
 *
 * ⚠️ `x` is a fraction of the INLINE axis, not a pixel offset, and the glyph is
 * never mirrored. A pointer's hotspot is top-left in every OS including Hebrew
 * ones, so a flipped arrow stops reading as a cursor and starts reading as a
 * "back" glyph. Only the PATH it travels mirrors, which `insetInlineStart`
 * does here once, for every scene.
 */
export function Cursor({
  x,
  y,
  isRTL,
  scale = 1,
  opacity = 1,
}: {
  /** 0 = inline start, 1 = inline end. */
  x: number;
  /** Pixels from the top of the positioned ancestor. */
  y: number;
  isRTL: boolean;
  scale?: number;
  opacity?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-30"
      style={{
        insetInlineStart: `${(isRTL ? 1 - x : x) * 100}%`,
        top: y,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#1F2937" stroke="#FFFFFF" strokeWidth="1.4">
        <path d="M5 2l7 18 2.5-7.5L22 10z" />
      </svg>
    </div>
  );
}

/* ── Surfaces ──────────────────────────────────────────────────────────── */

export function Panel({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`border border-[var(--v2-border)] bg-[var(--v2-surface)] ${className}`}
      style={{ borderRadius: 'var(--v2-radius-card, 16px)', ...style }}
    >
      {children}
    </div>
  );
}

/** The coloured square that fronts every card and row on the real page. */
export function IconTile({
  tone = TONE.primary,
  size = 36,
  children,
}: {
  tone?: string;
  size?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, background: `${tone}1A`, color: tone }}
    >
      {children}
    </div>
  );
}

export type BadgeTone = 'live' | 'inactive' | 'draft';

/** Live / Inactive / Draft, matching the real rows. */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  const skin =
    tone === 'live'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      : tone === 'draft'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        : 'bg-[var(--v2-bg)] text-[var(--v2-text-muted)]';

  return (
    <span className={`rounded px-2 py-px text-[11px] font-medium ${skin}`}>{children}</span>
  );
}

/**
 * A recreated button.
 *
 * `pressScale` comes from `press()` in timing.ts, so a click is a scale and
 * never a layout change.
 */
export function Btn({
  children,
  tone = TONE.primary,
  filled = false,
  pressScale = 1,
  className = '',
}: {
  children: ReactNode;
  tone?: string;
  filled?: boolean;
  pressScale?: number;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium ${className}`}
      style={{
        borderRadius: 'var(--v2-radius-button, 10px)',
        border: `1px solid ${tone}`,
        background: filled ? tone : `${tone}1A`,
        color: filled ? '#FFFFFF' : tone,
        transform: `scale(${pressScale})`,
      }}
    >
      {children}
    </div>
  );
}

/**
 * One of the four stat tiles on a link row.
 *
 * Fixed width on the real page (`w-[74px]`), kept here so the row's rhythm
 * matches what the owner will actually see.
 */
export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="w-[74px] shrink-0 px-2 py-1.5 text-center"
      style={{ background: 'var(--v2-bg)', borderRadius: 'var(--v2-radius-button, 10px)' }}
    >
      <div className="text-[13px] font-semibold tabular-nums text-[var(--v2-text-primary)]">
        {value}
      </div>
      <div className="mt-px text-[10px] leading-tight text-[var(--v2-text-muted)]">{label}</div>
    </div>
  );
}

/** A short-link address. Always LTR, as the real page renders it. */
export function GoCode({ code }: { code: string }) {
  return (
    <span dir="ltr" className="font-mono text-xs text-[var(--v2-text-muted)]">
      /go/{code}
    </span>
  );
}

/* ── Narration ─────────────────────────────────────────────────────────── */

/**
 * Whether the script is printed under the stage.
 *
 * Normally it is NOT: the voice carries the words, and a screen with the same
 * sentence written across the bottom while it is being read aloud splits the
 * viewer's attention between two copies of one thing.
 *
 * It falls back to visible when there is no voice to carry it — some devices
 * ship no speech voice for the owner's language, and a wordless animation
 * explains nothing at all. Silent and captionless is the one state this must
 * never reach.
 */
export const CaptionsVisible = createContext(true);

/**
 * The line under the stage.
 *
 * ⚠️ Always `aria-hidden`, whether shown or not. A screen reader gets the
 * complete chapter list from the dialog instead — a film that announces every
 * caption change as it passes is unusable, and the text is already available
 * in full, in order, without scrubbing.
 */
export function Caption({ children, opacity = 1 }: { children: ReactNode; opacity?: number }) {
  const visible = useContext(CaptionsVisible);
  if (!visible) return null;

  return (
    <p
      aria-hidden="true"
      className="mx-auto max-w-[62ch] text-center text-[13px] leading-relaxed text-[var(--v2-text-secondary)]"
      style={{ opacity }}
    >
      {children}
    </p>
  );
}

/** A pointer that drops onto part of the stage to name it. */
export function Marker({ n, opacity = 1, scale = 1 }: { n: number; opacity?: number; scale?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ background: TONE.primary, opacity, transform: `scale(${scale})` }}
    >
      {n}
    </span>
  );
}
