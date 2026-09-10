'use client';

/**
 * Pilot Credits consumed.
 *
 * The total, and nothing else. This card used to break the figure down by
 * category — a coloured ring of segments over a legend naming each one — and
 * that has been removed deliberately: the split was not a decision anyone could
 * act on. Knowing the website consumed more than insights does not tell a
 * business owner to do anything differently, and it invited comparison between
 * slices that only ever moved with whatever the platform happened to run.
 *
 * The ring is now one arc in one colour. It frames the number rather than
 * dividing it, so there is no proportion to misread. It is drawn only when
 * there is consumption to represent — a full ring over an empty account would
 * read as usage that never happened.
 *
 * The API still returns a `breakdown` array. It is deliberately not read here;
 * if a drill-down is ever wanted again it belongs on its own surface, not
 * inside the summary tile.
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UsageCard' });

interface UsageData {
  credits: number;
  calls: number;
}

const INK = 'var(--v2-text-primary)';
const MUTED = 'var(--v2-text-secondary)';
const TRACK = 'var(--v2-border)';

/**
 * One colour. The ring frames the total rather than dividing it.
 *
 * It used to carry a segment per category in its own hue, which invited the
 * reader to compare slices — a comparison the card no longer offers and one
 * that was never actionable: nothing here can be spent differently by knowing
 * the website used more than insights.
 */
const ACCENT = '#2a78d6';

function formatCredits(credits: number): string {
  if (credits < 1000) return credits.toLocaleString();
  if (credits < 1_000_000) return `${(credits / 1000).toFixed(1)}K`;
  return `${(credits / 1_000_000).toFixed(1)}M`;
}

const R = 15;
const STROKE = 4;

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
        <div style={{ position: 'relative', width: 132, height: 132 }}>
          <svg
            viewBox="0 0 36 36"
            style={{
              width: '100%',
              height: '100%',
              transform: 'rotate(-90deg)',
              overflow: 'visible',
            }}
            role="img"
            aria-label={`${usage ? formatCredits(usage.credits) : '0'} ${t('usage.credits')}`}
          >
            <circle cx="18" cy="18" r={R} fill="none" stroke={TRACK} strokeWidth={STROKE} />

            {/* Drawn only once there is something to represent: a full ring
                over an empty account reads as usage that has not happened. */}
            {usage && usage.credits > 0 && (
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
                fontSize: '24px',
                fontWeight: 700,
                color: INK,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {usage ? formatCredits(usage.credits) : '—'}
            </span>
            <span style={{ fontSize: '10.5px', color: MUTED, marginTop: 3 }}>
              {t('usage.credits')}
            </span>
          </div>
        </div>
      </div>

      {usage && usage.credits === 0 && !error && (
        <p style={{ fontSize: '12px', color: MUTED, marginTop: 10, textAlign: 'center' }}>
          {t('usage.none')}
        </p>
      )}
    </div>
  );
}
