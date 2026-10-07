'use client';

/**
 * Credits — what is left of the owner's own plan allowance, this period.
 *
 * Credit deduction slice 6a (workplan §4.6, §4.7; decisions D-a to D-f). The
 * card reads `GET /api/business-os/usage`, which answers from the credit
 * ledger: credits used and left of the owner's OWN allowance, for their OWN
 * billing period. The figures and their shape are `OwnerCreditUsage`; nothing
 * here is computed from anything else. The payload also carries the "by you" /
 * "automatic" split; the card does not show it (user decision 2026-10-01 — the
 * card was too busy). It stays in the API for a later surface.
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────────────
 *   - a monthly plan: "Resets {date}", the ring emptying against the allowance,
 *     "{percent} left" (slice 8a, FR-46 — no credit count), and the
 *     one-sentence explanation as a tooltip on the ring (hover or keyboard
 *     focus; user decision 2026-10-01; unchanged, BD-24);
 *   - a trial: the same against the one-off total — "For your trial", and no
 *     reset date;
 *   - the ring's colour is the BAND of the shown percentage (green / blue /
 *     orange / red, `creditBands.ts` — the one definition, BD-19); the
 *     percentage is always written, so colour is never the only signal, and
 *     the ring's label states it for a screen reader;
 *   - no allowance (no plan row, or none resolvable): credits used in the
 *     ring's centre, with no gauge, no "left" and no tooltip — never "0 of 0"
 *     or "0%". "This month" only for the calendar-month case;
 *   - over the allowance: "0%", an empty ring on a red track. No warning, no
 *     "paused" and no upgrade wording (slice 10).
 *   - a read that failed: the error line — never "0%" or "100%".
 * The percentage follows BD-20 (whole, rounded down; 100% only when nothing
 * was used; "less than 1%"; 0% at or over), from the payload's EXACT used.
 * Credits used (no allowance) are whole credits with "less than 1" (D-c).
 *
 * ── WHEN IT RE-READS (FR-39) ────────────────────────────────────────────────
 * On mount; (a) when an owner AI action on the page finishes (the
 * `creditUsageSignal`); (b) when the tab becomes visible again, or the page is
 * restored from the back-forward cache; (c) on the refresh icon. Never on a
 * timer. One request at a time: a trigger during a read queues exactly one
 * more read, however many arrive.
 *
 * ── CREDIT HISTORY (slice 7a, D-i) ──────────────────────────────────────────
 * One link under the ring opens the history panel. It is shown whenever the
 * card has a result (gauged, trial or no allowance), never while loading or on
 * the error line. The panel is mounted on first open — so the card's own mount
 * makes no extra request — and reads only when it opens. Nothing else on the
 * card changes.
 *
 * Parked (user decision 2026-10-02): the link is drawn only when
 * `isBusinessOsCreditHistoryEnabled()` is on (`NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY`,
 * default off). Off, the card renders exactly as slice 6a built it.
 *
 * ── EXTRA CREDITS (credit deduction slice 11d, S11-D-1 A) ───────────────────
 * Under the ring: "Extra credits" and the payload's `extraCredits`, rounded
 * DOWN to a whole credit ("less than 1" below one), and the one line on how
 * they behave. Shown only when the figure is above 0 (user decision
 * 2026-10-04, BQ-11d-1): not at 0, not while loading, not on the error line.
 * It is a SEPARATE figure: the percentage, its band, the arc, the tooltip and
 * the no-allowance state never read it, and nothing adds it to the plan figure
 * (boost R-5 (c), BD-25; a source rule pins it). No lot list, no source, no
 * reason (S11-D-4 A). It arrives in the same payload, so it re-reads on the
 * same triggers as the rest of the card. The admin view formats its own figure,
 * so the two can differ below one credit by design (SA W11d-11).
 *
 * ── TOP UP (credits boost slice 5a, user decision B 2026-10-07) ─────────────
 * The last row of the card, pushed to the bottom: a "Top up" button that opens
 * the package picker (`BoostPackagesPanel`). Every owner sees it, with no
 * switch. It is shown once the first read has settled — including on the error
 * line, because buying does not depend on reading usage (SA Q-6) — and hidden
 * only while that first read runs, so the card does not jump. The picker is
 * mounted on first open, so the card's own mount makes no extra request. It
 * reads nothing from the card and changes nothing on it: the percentage, the
 * band and "Extra credits" are untouched (FR-24, BD-25).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { BoostPackagesPanel } from '@/components/business-os/BoostPackagesPanel';
import { CreditHistoryPanel } from '@/components/business-os/CreditHistoryPanel';
import { isBusinessOsCreditHistoryEnabled } from '@/lib/utils/featureFlags';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { onCreditUsageChanged } from '@/lib/business-os/client/creditUsageSignal';
import { bandColor, creditPercentLeft } from '@/lib/business-os/credits/creditBands';
import {
  toDisplayedCredits,
  toDisplayedExtraCredits,
  type DisplayedCreditFigure,
} from '@/lib/business-os/credits/creditDisplay';
import type { OwnerCreditUsage } from '@/lib/business-os/credits/ownerCreditUsageTypes';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UsageCard' });

const USAGE_URL = '/api/business-os/usage';

const INK = 'var(--v2-text-primary)';
const MUTED = 'var(--v2-text-secondary)';
const TRACK = 'var(--v2-border)';

/**
 * The frame ring of the no-allowance state. The gauge's colour is the band of
 * the shown percentage (`creditBands.ts`), never a colour chosen here.
 */
const ACCENT = '#2a78d6';

/**
 * The error line's own colour: an error is not a band (SA SQ-39). Unchanged
 * from slice 6a; its text contrast is a recorded follow-up (slice 8 workplan R-8).
 */
const ERROR_INK = '#F97316';

const R = 15;
const STROKE = 4;

/** Circumference of the ring, for the dash maths below. Declared after R:
 *  reading it above the declaration is a TDZ throw at module load, not a
 *  compile error, so nothing catches it until the page is opened. */
const CIRCUMFERENCE = 2 * Math.PI * R;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The payload, checked before it is shown: a malformed answer is an error, never a zero. */
function isOwnerCreditUsage(value: unknown): value is OwnerCreditUsage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<OwnerCreditUsage>;
  const kinds = ['monthly', 'trial_total', 'calendar_month'];
  if (!v.period || !kinds.includes(v.period.kind as string)) return false;
  if (v.period.resetsOn !== null && typeof v.period.resetsOn !== 'string') return false;
  if (v.allowance !== null) {
    if (!v.allowance || !isFiniteNumber(v.allowance.amount) || !['month', 'total'].includes(v.allowance.per)) return false;
  }
  if (!isFiniteNumber(v.used) || !isFiniteNumber(v.usedByOwner) || !isFiniteNumber(v.usedAutomatic)) return false;
  // Slice 11d: required. Missing or negative is an error line, never a hidden figure.
  return isFiniteNumber(v.extraCredits) && v.extraCredits >= 0;
}

export function UsageCard() {
  const { t, language, isRTL, timeZoneOptions } = useLanguage();

  const [usage, setUsage] = useState<OwnerCreditUsage | null>(null);
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMounted, setHistoryMounted] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpMounted, setTopUpMounted] = useState(false);
  // Focus returns here when the picker closes (QA5a-D1).
  const topUpRef = useRef<HTMLButtonElement | null>(null);
  // Parked behind a flag (default off): off, nothing below is drawn or mounted.
  const historyEnabled = isBusinessOsCreditHistoryEnabled();
  const explainId = useId();

  // One request at a time. Refs, not state: a trigger must see the CURRENT
  // flags, not the ones captured at its last render.
  const inFlightRef = useRef<AbortController | null>(null);
  const pendingRef = useRef(false);
  const readRef = useRef<() => void>(() => {});

  const read = useCallback(() => {
    if (inFlightRef.current) {
      // Coalesce: however many triggers arrive during a read, one more read.
      pendingRef.current = true;
      return;
    }
    const controller = new AbortController();
    inFlightRef.current = controller;
    setReading(true);

    void (async () => {
      try {
        const response = await fetch(USAGE_URL, { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (inFlightRef.current !== controller) return;
        if (response.ok && body?.success && isOwnerCreditUsage(body.data)) {
          setUsage(body.data);
          setFailed(false);
        } else {
          setUsage(null);
          setFailed(true);
          logger.warn({ status: response.status }, 'Credits read failed');
        }
      } catch (err) {
        if (inFlightRef.current !== controller) return;
        setUsage(null);
        setFailed(true);
        logger.warn({ err }, 'Credits read threw');
      } finally {
        // An aborted read (unmount) is no longer the current one: leave the
        // flags to whoever owns them now.
        if (inFlightRef.current === controller) {
          inFlightRef.current = null;
          setReading(false);
          if (pendingRef.current) {
            pendingRef.current = false;
            readRef.current();
          }
        }
      }
    })();
  }, []);

  useEffect(() => {
    // Every trigger (and the queued re-read) goes through this ref, so it
    // always reaches the current `read`.
    readRef.current = read;
    read();

    const offSignal = onCreditUsageChanged(() => readRef.current());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') readRef.current();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // Restored from the back-forward cache: the page did not remount.
      if (event.persisted) readRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      offSignal();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      const inFlight = inFlightRef.current;
      inFlightRef.current = null;
      pendingRef.current = false;
      inFlight?.abort();
    };
  }, [read]);

  const numbers = new Intl.NumberFormat(language, { maximumFractionDigits: 0 });
  const figure = (f: DisplayedCreditFigure) => (f.kind === 'less_than_one' ? t('usage.less_than_one') : numbers.format(f.value));

  const allowance = usage?.allowance ?? null;
  // The percentage, its band and the exact share, from the payload's EXACT
  // used (SQ-40) — not D-c's displayed used. Null means no gauge.
  const position = usage && allowance && allowance.amount > 0 ? creditPercentLeft(usage.used, allowance.amount) : null;
  const gauged = position !== null;
  const isTrial = usage?.period.kind === 'trial_total';
  // What a credit is (D-b). Only beside an allowance (DV-3): both variants say
  // the plan includes an amount, which is not true without one.
  const explain = usage && gauged ? t(isTrial ? 'usage.explain.trial' : 'usage.explain.monthly') : null;
  const shown = usage
    ? toDisplayedCredits({
        used: usage.used,
        usedByOwner: usage.usedByOwner,
        usedAutomatic: usage.usedAutomatic,
        allowanceAmount: gauged ? allowance!.amount : null,
      })
    : null;

  const percentFormat = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 });
  // Intl gives each language its own spacing and sign ("64%", "64 %").
  const formatPercent = (whole: number) => percentFormat.format(whole / 100);
  const isLessThanOne = position?.shown.kind === 'less_than_one';
  const percentText = position
    ? position.shown.kind === 'less_than_one'
      ? t('usage.less_than_percent', { percent: formatPercent(1) })
      : formatPercent(position.shown.value)
    : null;
  // At or over the allowance: no arc, and the track itself carries the red band.
  const nothingLeft = position !== null && position.share === 0;

  /** Beside the title: the reset date, the trial, "this month" — or nothing (no allowance). */
  let periodLabel: string | null = null;
  let resetsLong: string | null = null;
  if (usage) {
    if (usage.period.kind === 'calendar_month') {
      periodLabel = t('usage.this_month');
    } else if (gauged && isTrial) {
      periodLabel = t('usage.for_trial');
    } else if (gauged && usage.period.resetsOn) {
      const resets = new Date(usage.period.resetsOn);
      if (!Number.isNaN(resets.getTime())) {
        // In the BUSINESS's clock and the reader's language.
        const date = new Intl.DateTimeFormat(language, timeZoneOptions({ day: 'numeric', month: 'short' })).format(resets);
        periodLabel = t('usage.resets_on', { date });
        resetsLong = new Intl.DateTimeFormat(language, timeZoneOptions({ day: 'numeric', month: 'long' })).format(resets);
      }
    }
  }

  // Slice 11d: the extra figure, or null (block hidden). Read here only; never
  // part of the percentage, the band or any sum (a source rule pins it).
  const extraShown = usage ? toDisplayedExtraCredits(usage.extraCredits) : null;

  const headline = !usage || !shown ? '—' : gauged ? percentText! : figure(shown.used);
  const headlineLabel = gauged ? t('usage.left') : t('usage.used');
  // The number carries the meaning; the band's colour name is never read (AC-42).
  const ringLabel =
    !usage || !shown
      ? t('usage.title')
      : gauged
        ? isTrial
          ? t('usage.sr.trial', { percent: percentText! })
          : resetsLong
            ? t('usage.sr.monthly', { percent: percentText!, date: resetsLong })
            : t('usage.sr.plain', { percent: percentText! })
        : `${headline} ${headlineLabel}`;

  return (
    <div
      data-testid="credits-card"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        padding: '18px',
        borderRadius: '20px',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        boxShadow: 'var(--v2-shadow-card, 0 1px 2px rgba(19, 26, 43, 0.04), 0 8px 24px -16px rgba(19, 26, 43, 0.18))',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* The period label never shrinks: it is the shorter string and the one
          that fixes the scale of everything below, so the title gives up the
          room when a translation runs long. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: '13px',
            color: INK,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {t('usage.title')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {periodLabel && (
            <span data-testid="credits-period" style={{ fontSize: '11px', color: MUTED }}>
              {periodLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => readRef.current()}
            disabled={reading}
            aria-label={t('usage.refresh')}
            title={t('usage.refresh')}
            aria-busy={reading}
            data-testid="credits-refresh"
            style={{
              display: 'inline-flex',
              padding: 2,
              border: 'none',
              background: 'transparent',
              color: MUTED,
              cursor: reading ? 'default' : 'pointer',
              opacity: reading ? 0.6 : 1,
            }}
          >
            {/* A CSS animation, not a timer (AC-33). */}
            <RefreshCw size={13} className={reading ? 'animate-spin' : undefined} aria-hidden="true" />
          </button>
        </span>
      </div>

      {/* Says WHY it is empty. A blank card and a broken card look identical
          otherwise — and a failed read is never shown as zero. */}
      {failed && (
        <p data-testid="credits-error" style={{ fontSize: '11.5px', color: ERROR_INK, marginTop: 6 }}>
          {t('usage.error')}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14, marginBottom: 4 }}>
        {/* The ring carries the explanation as a tooltip (user decision
            2026-10-01). No tooltip primitive is installed, so this follows the
            codebase's hand-rolled pattern (DarkModeToggle): state-driven, opened
            by hover AND keyboard focus, closed by Escape, and always in the DOM
            so `aria-describedby` reads it to a screen reader. */}
        <div
          data-testid="credits-ring"
          role="img"
          aria-label={ringLabel}
          data-band={position ? position.band : undefined}
          aria-describedby={explain ? explainId : undefined}
          tabIndex={explain ? 0 : undefined}
          onMouseEnter={explain ? () => setExplainOpen(true) : undefined}
          onMouseLeave={explain ? () => setExplainOpen(false) : undefined}
          onFocus={explain ? () => setExplainOpen(true) : undefined}
          onBlur={explain ? () => setExplainOpen(false) : undefined}
          onKeyDown={
            explain
              ? (event) => {
                  if (event.key === 'Escape') setExplainOpen(false);
                }
              : undefined
          }
          className={explain ? 'rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-primary)]' : undefined}
          style={{ position: 'relative', width: 156, height: 156, cursor: explain ? 'help' : undefined }}
        >
          <svg
            viewBox="0 0 36 36"
            style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)', overflow: 'visible' }}
            aria-hidden="true"
          >
            <circle
              data-testid="credits-track"
              cx="18"
              cy="18"
              r={R}
              fill="none"
              stroke={nothingLeft ? bandColor(position!.band) : TRACK}
              strokeWidth={STROKE}
            />

            {/*
              The arc is what is LEFT, so it shrinks from full as the period is
              spent — the track showing through is the spend. No round cap: at a
              low balance a rounded end overhangs its own arc and reads as more
              left than there is.
            */}
            {position && position.share > 0 && (
              <circle
                data-testid="credits-arc"
                data-band={position.band}
                cx="18"
                cy="18"
                r={R}
                fill="none"
                stroke={bandColor(position.band)}
                strokeWidth={STROKE}
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - position.share)}
                style={{ transition: 'stroke-dashoffset 600ms ease, stroke 300ms ease' }}
              />
            )}

            {/* No allowance: the ring is a frame around the spend, drawn only
                when there is spend to frame. A gauge with no ceiling would be a
                full ring that never moves. */}
            {!gauged && shown && !shown.nothingUsed && (
              <circle cx="18" cy="18" r={R} fill="none" stroke={ACCENT} strokeWidth={STROKE} strokeLinecap="round" />
            )}
          </svg>

          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              textAlign: 'center',
            }}
          >
            <span
              data-testid="credits-headline"
              data-size={isLessThanOne ? 'small' : 'large'}
              style={{
                // "less than 1%" / "menos del 1 %" does not fit the ring at the
                // headline size (SQ-47): a smaller size, wrapping inside the ring.
                fontSize: isLessThanOne ? '15px' : '29px',
                maxWidth: isLessThanOne ? 104 : undefined,
                fontWeight: 700,
                color: INK,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
                lineHeight: isLessThanOne ? 1.15 : 1,
              }}
            >
              {headline}
            </span>
            {usage && <span style={{ fontSize: '12px', color: MUTED, marginTop: 4 }}>{headlineLabel}</span>}
          </div>

          {explain && (
            <div
              id={explainId}
              role="tooltip"
              data-testid="credits-explain-tooltip"
              data-open={explainOpen ? 'true' : 'false'}
              style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginTop: 8,
                width: 240,
                padding: '8px 10px',
                fontSize: '11.5px',
                lineHeight: 1.45,
                textAlign: 'start',
                color: INK,
                background: 'var(--v2-surface)',
                border: '1px solid var(--v2-border)',
                borderRadius: 10,
                boxShadow: 'var(--v2-shadow-card)',
                pointerEvents: 'none',
                zIndex: 50,
                visibility: explainOpen ? 'visible' : 'hidden',
                opacity: explainOpen ? 1 : 0,
                transition: 'opacity 150ms ease',
              }}
            >
              {explain}
            </div>
          )}
        </div>
      </div>

      {/* Extra credits (slice 11d): plain text, not a gauge: no colour, no
          icon, no band. Hidden at 0 (BQ-11d-1). */}
      {extraShown && (
        <div
          data-testid="credits-extra"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 6, textAlign: 'center' }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
            <span style={{ fontSize: '12px', color: MUTED }}>{t('usage.extra.label')}</span>
            <span
              data-testid="credits-extra-figure"
              style={{ fontSize: '13px', fontWeight: 600, color: INK, fontVariantNumeric: 'tabular-nums' }}
            >
              {figure(extraShown)}
            </span>
          </div>
          <p
            data-testid="credits-extra-explain"
            style={{ fontSize: '11.5px', lineHeight: 1.4, color: MUTED, marginTop: 2, textAlign: 'center' }}
          >
            {t('usage.extra.explain')}
          </p>
        </div>
      )}

      {historyEnabled && usage && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
          <button
            type="button"
            data-testid="credits-history-link"
            onClick={() => {
              setHistoryMounted(true);
              setHistoryOpen(true);
            }}
            style={{
              fontSize: '11.5px',
              color: 'var(--v2-primary)',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            {t('credits.history.link')}
          </button>
        </div>
      )}

      {historyEnabled && historyMounted && <CreditHistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} />}

      {/* Top up (boost slice 5a): after the first read settles, error line included (SA Q-6). */}
      {(usage || failed) && (
        <div style={{ marginTop: 'auto', paddingTop: 12 }}>
          <button
            ref={topUpRef}
            type="button"
            data-testid="credits-top-up"
            onClick={() => {
              setTopUpMounted(true);
              setTopUpOpen(true);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: '100%',
              height: 34,
              borderRadius: 10,
              border: '1px solid var(--v2-border)',
              background: 'var(--v2-surface)',
              color: 'var(--v2-primary)',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus size={14} aria-hidden="true" />
            {t('usage.boost.top_up')}
          </button>
        </div>
      )}

      {topUpMounted && <BoostPackagesPanel open={topUpOpen} onOpenChange={setTopUpOpen} returnFocusRef={topUpRef} />}
    </div>
  );
}
