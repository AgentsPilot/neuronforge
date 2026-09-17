'use client';

/**
 * Pilot Credits remaining this month.
 *
 * The card counts DOWN. It used to show credits consumed inside a ring that was
 * always a full circle — the ring framed the number rather than measuring
 * anything, because there was no total to measure against. A figure that only
 * ever rises answers "how much have I burned?", which nobody asked; the
 * question an owner has is "how much is left?", and that needs a ceiling.
 *
 * The ceiling is one parameter — `monthly_ai_allowance_usd`, default $10 —
 * converted to Pilot Credits by the API at the same rate Stripe bills against.
 * The ring now empties as the month is spent, so its fill IS the answer and the
 * number at its centre is what remains.
 *
 * Where no allowance applies (the key set to 0, or missing) the API sends null
 * and the card falls back to the old behaviour: consumption shown, no gauge
 * drawn. A gauge with no ceiling would be a full ring that never moves.
 *
 * The API still returns a `breakdown` array. It is deliberately not read here;
 * if a drill-down is ever wanted again it belongs on its own surface, not
 * inside the summary tile. That reasoning has not changed: knowing the website
 * outspent insights does not tell anyone to do anything differently.
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UsageCard' });

interface UsageData {
  credits: number;
  calls: number;
  /** Monthly ceiling in Pilot Credits; null when none applies. */
  allowance: number | null;
  /** Already clamped at zero by the API — consumption can exceed the ceiling. */
  remaining: number | null;
}

const INK = 'var(--v2-text-primary)';
const MUTED = 'var(--v2-text-secondary)';
const TRACK = 'var(--v2-border)';

/**
 * One colour for the arc, and one for the last fifth of it.
 *
 * Still no segment-per-category: that invited comparison between slices nobody
 * could act on. A low-balance state is different — it is the one thing this
 * card can tell you that changes what you do next, so it gets the platform's
 * alert orange rather than a second arbitrary hue.
 */
const ACCENT = '#2a78d6';
const LOW = '#F97316';

/** Below this share of the allowance the arc turns orange. */
const LOW_THRESHOLD = 0.2;

function formatCredits(credits: number): string {
  if (credits < 1000) return credits.toLocaleString();
  if (credits < 1_000_000) return `${(credits / 1000).toFixed(1)}K`;
  return `${(credits / 1_000_000).toFixed(1)}M`;
}

const R = 15;
const STROKE = 4;

/** Circumference of the ring, for the dash maths below. Declared after R:
 *  reading it above the declaration is a TDZ throw at module load, not a
 *  compile error, so nothing catches it until the page is opened. */
const CIRCUMFERENCE = 2 * Math.PI * R;

export function UsageCard() {
  const { t, language } = useLanguage();
  const isRTL = language === 'he';

  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/business-os/usage?range=last_30d');
        const result = await response.json();

        if (result.success) {
          setUsage(result.data as UsageData);
        } else {
          setError(result.error ?? `HTTP ${response.status}`);
          logger.warn({ status: response.status, error: result.error }, 'Usage fetch failed');
        }
      } catch (err) {
        setError((err as Error).message);
        logger.warn({ err }, 'Usage fetch threw');
      }
    })();
  }, []);

  /*
   * What the ring measures.
   *
   * `gauged` is the whole question: with an allowance the ring is a gauge that
   * empties, without one it is the frame it used to be. Every branch below
   * reads this rather than re-testing the nulls, so the two modes cannot drift
   * apart.
   */
  const allowance = usage?.allowance ?? null;
  const remaining = usage?.remaining ?? null;
  const gauged = usage !== null && allowance !== null && allowance > 0 && remaining !== null;

  const share = gauged ? remaining! / allowance! : 0;
  const isLow = gauged && share <= LOW_THRESHOLD;

  // The figure at the centre: what is LEFT under an allowance, what was SPENT
  // without one.
  const headline = usage ? formatCredits(gauged ? remaining! : usage.credits) : '—';

  return (
    <div
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
      {/* "Usage" described every card on the dashboard equally well. Naming the
          unit says what this one is about, and what it is not: the money the
          business takes is counted elsewhere.

          The date never shrinks: it is the shorter string and the one that
          fixes the scale of everything below, so the title gives up the room
          when a translation runs long. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
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
        <span style={{ fontSize: '11px', color: MUTED, flexShrink: 0 }}>{t('usage.last30days')}</span>
      </div>

      {/* Says WHY it is empty. A blank card and a broken card look identical
          otherwise, which is what made this undiagnosable the first time. */}
      {error && <p style={{ fontSize: '11.5px', color: '#F97316', marginTop: 6 }}>{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14, marginBottom: 4 }}>
        <div style={{ position: 'relative', width: 156, height: 156 }}>
          <svg
            viewBox="0 0 36 36"
            style={{
              width: '100%',
              height: '100%',
              transform: 'rotate(-90deg)',
              overflow: 'visible',
            }}
            role="img"
            aria-label={
              gauged
                ? `${formatCredits(remaining!)} ${t('usage.credits')} ${t('usage.available')}`
                : `${usage ? formatCredits(usage.credits) : '0'} ${t('usage.credits')}`
            }
          >
            <circle cx="18" cy="18" r={R} fill="none" stroke={TRACK} strokeWidth={STROKE} />

            {/*
              The arc is what is LEFT, so it shrinks anticlockwise from full as
              the month is spent — the track showing through is the spend.

              `strokeDasharray` makes one dash the length of the whole ring and
              `strokeDashoffset` hides the spent part of it. Offset grows with
              consumption, which is why the two are the arithmetic inverse of
              each other and not the same number.

              No round cap here, unlike the old full ring: at a low balance a
              rounded end overhangs its own arc and reads as more left than
              there is. Butt ends make a 2% sliver look like 2%.
            */}
            {gauged && remaining! > 0 && (
              <circle
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

            {/* No allowance configured: the ring goes back to being a frame
                around the spend, drawn only when there is spend to frame. */}
            {!gauged && usage && usage.credits > 0 && (
              <circle
                cx="18"
                cy="18"
                r={R}
                fill="none"
                stroke={ACCENT}
                strokeWidth={STROKE}
                strokeLinecap="round"
              />
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
            }}
          >
            <span
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
            <span style={{ fontSize: '12px', color: MUTED, marginTop: 4 }}>
              {gauged ? t('usage.available') : t('usage.credits')}
            </span>
            {/* The denominator, so the arc has a scale. Without it a half-full
                ring is a proportion of nothing in particular. */}
            {gauged && (
              <span style={{ fontSize: '11px', color: MUTED, marginTop: 2 }}>
                {t('usage.of')} {formatCredits(allowance!)}
              </span>
            )}
          </div>
        </div>
      </div>

      {usage && !gauged && usage.credits === 0 && !error && (
        <p style={{ fontSize: '12px', color: MUTED, marginTop: 10, textAlign: 'center' }}>
          {t('usage.none')}
        </p>
      )}
    </div>
  );
}
