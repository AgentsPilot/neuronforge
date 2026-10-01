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
 *     "{left} left of {allowance}", and the one-sentence explanation as a
 *     tooltip on the ring (hover or keyboard focus; user decision 2026-10-01);
 *   - a trial: the same against the one-off total — "For your trial", "of
 *     {n} in total", and no reset date;
 *   - no allowance (no plan row, or none resolvable): credits used in the
 *     ring's centre, with no gauge, no "left" and no tooltip — never "0 of 0".
 *     "This month" only for the calendar-month case;
 *   - over the allowance: "0 left", an empty ring. No warning, no "paused"
 *     and no upgrade wording (slices 8 and 10).
 *   - a read that failed: the error line — never a zero.
 * Whole credits, with "less than 1" (D-c, `creditDisplay.ts`).
 *
 * ── WHEN IT RE-READS (FR-39) ────────────────────────────────────────────────
 * On mount; (a) when an owner AI action on the page finishes (the
 * `creditUsageSignal`); (b) when the tab becomes visible again, or the page is
 * restored from the back-forward cache; (c) on the refresh icon. Never on a
 * timer. One request at a time: a trigger during a read queues exactly one
 * more read, however many arrive.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { onCreditUsageChanged } from '@/lib/business-os/client/creditUsageSignal';
import { toDisplayedCredits, type DisplayedCreditFigure } from '@/lib/business-os/credits/creditDisplay';
import type { OwnerCreditUsage } from '@/lib/business-os/credits/ownerCreditUsageTypes';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UsageCard' });

const USAGE_URL = '/api/business-os/usage';

const INK = 'var(--v2-text-primary)';
const MUTED = 'var(--v2-text-secondary)';
const TRACK = 'var(--v2-border)';

/**
 * One colour for the arc, and one for the last fifth of it.
 *
 * A low balance is the one thing this card can tell you that changes what you
 * do next, so it gets the platform's alert orange rather than a second
 * arbitrary hue. Colour only: no warning text (slice 8).
 */
const ACCENT = '#2a78d6';
const LOW = '#F97316';

/** At or below this share of the allowance the arc turns orange. */
const LOW_THRESHOLD = 0.2;

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
  return isFiniteNumber(v.used) && isFiniteNumber(v.usedByOwner) && isFiniteNumber(v.usedAutomatic);
}

export function UsageCard() {
  const { t, language, isRTL, timeZoneOptions } = useLanguage();

  const [usage, setUsage] = useState<OwnerCreditUsage | null>(null);
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
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
  const gauged = usage !== null && allowance !== null && allowance.amount > 0;
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

  const left = gauged && shown ? shown.left ?? 0 : 0;
  const share = gauged ? Math.min(1, left / allowance!.amount) : 0;
  const isLow = gauged && share <= LOW_THRESHOLD;

  /** Beside the title: the reset date, the trial, "this month" — or nothing (no allowance). */
  let periodLabel: string | null = null;
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
      }
    }
  }

  const headline = !usage || !shown ? '—' : gauged ? numbers.format(left) : figure(shown.used);
  const headlineLabel = gauged ? t('usage.left') : t('usage.used');
  const ofLine = gauged ? t(isTrial ? 'usage.of_total' : 'usage.of', { n: numbers.format(allowance!.amount) }) : null;

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
        <p data-testid="credits-error" style={{ fontSize: '11.5px', color: LOW, marginTop: 6 }}>
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
          aria-label={usage && shown ? `${headline} ${headlineLabel}${ofLine ? ` ${ofLine}` : ''}` : t('usage.title')}
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
            <circle cx="18" cy="18" r={R} fill="none" stroke={TRACK} strokeWidth={STROKE} />

            {/*
              The arc is what is LEFT, so it shrinks from full as the period is
              spent — the track showing through is the spend. No round cap: at a
              low balance a rounded end overhangs its own arc and reads as more
              left than there is.
            */}
            {gauged && left > 0 && (
              <circle
                data-testid="credits-arc"
                data-low={isLow ? 'true' : 'false'}
                cx="18"
                cy="18"
                r={R}
                fill="none"
                stroke={isLow ? LOW : ACCENT}
                strokeWidth={STROKE}
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - share)}
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
              style={{
                fontSize: '29px',
                fontWeight: 700,
                color: INK,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {headline}
            </span>
            {usage && <span style={{ fontSize: '12px', color: MUTED, marginTop: 4 }}>{headlineLabel}</span>}
            {/* The denominator, so the arc has a scale. */}
            {ofLine && (
              <span data-testid="credits-of" style={{ fontSize: '11px', color: MUTED, marginTop: 2 }}>
                {ofLine}
              </span>
            )}
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
    </div>
  );
}
