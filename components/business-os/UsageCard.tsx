'use client';

/**
 * Pilot Credits consumed, and what consumed them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FORM: a ring, with the total in the middle and a legend below.
 *
 * A ring only works when the shares sit within roughly an order of magnitude of
 * each other. It failed once already: while development traffic dominated the
 * account the split was 99.3 / 0.5 / 0.2, and the minor arcs came out at 0.52px
 * and 0.21px — invisible. Real usage sits nearer 73 / 20 / 7, where even the
 * smallest segment gets a clearly readable arc.
 *
 * That constraint has not gone away, so the legend below lists EVERY category
 * with its own number: a share too small to see is still readable as a value.
 * The ring is the shape; the legend is the record.
 *
 * GEOMETRY: round caps are what make it read as round, and they are also the trap.
 * A round cap extends the drawn arc by strokeWidth/2 at BOTH ends — so a segment
 * drawn to its exact share renders one full stroke-width too long and laps into
 * its neighbour. The dash is therefore shortened by a whole strokeWidth and then
 * re-centred inside its true span (see `dashStart` below), so the visible arc
 * lands exactly where the share says it should.
 *
 * Every segment gives up the same GAP, so their comparison stays true. Below
 * ~6% a segment's dash hits zero and it renders as a rounded dot: present and
 * findable, but wider than its share. That is the deliberate floor — the number
 * beside it in the legend is the one to read.
 *
 * COLOUR: fixed slots per CATEGORY, never by rank, so a quiet month for one
 * category does not repaint the others. The seven identity hues pass every check
 * in `dataviz/scripts/validate_palette.js` against a white surface — lightness
 * band, chroma floor, CVD separation (worst adjacent pair ΔE 9.1 protan) and
 * normal-vision separation (worst 19.6). Three sit under 3:1 contrast, which is
 * permitted only alongside visible labels; the legend supplies them, so identity
 * never rests on colour alone. "Other" is deliberately gray and deliberately
 * fails the chroma floor: it is a residual bucket, not an identity, and giving it
 * a hue would make it look like one more category.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'UsageCard' });

interface UsageItem {
  key: string;
  credits: number;
  calls: number;
  share: number;
}

interface UsageData {
  credits: number;
  breakdown: UsageItem[];
  calls: number;
}

const INK = '#131A2B';
const MUTED = '#697187';
const TRACK = '#EDF1F7';

/** One slot per category, fixed forever — colour follows the entity, not its rank. */
const CATEGORY_COLOR: Record<string, string> = {
  chat: '#2a78d6',
  automations_built: '#eb6834',
  automations_run: '#1baf7a',
  website: '#eda100',
  insights: '#e87ba4',
  documents: '#4a3aa7',
  help: '#008300',
  other: '#9AA3B2',
};

function formatCredits(credits: number): string {
  if (credits < 1000) return credits.toLocaleString();
  if (credits < 1_000_000) return `${(credits / 1000).toFixed(1)}K`;
  return `${(credits / 1_000_000).toFixed(1)}M`;
}

const R = 15;
const CIRCUMFERENCE = 2 * Math.PI * R;
const STROKE = 4;
/** Visible separation between segments: ~1.4 units ≈ 5px once drawn at 132px. */
const GAP = 1.4;

export function UsageCard() {
  const { t, language } = useLanguage();
  const isRTL = language === 'he';

  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

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

  // The cursor advances by each segment's FULL share, so the gaps are taken out
  // of the segments and never accumulate around the ring.
  //
  // `drawn` sheds a whole STROKE because the round caps add STROKE/2 back at each
  // end, and `dashStart` pushes the dash inward by half of what was shed so the
  // visible arc sits centred on the true span rather than drifting forward.
  let cursor = 0;
  const segments = (usage?.breakdown ?? []).map((item) => {
    const full = item.share * CIRCUMFERENCE;
    const drawn = Math.max(full - GAP - STROKE, 0.01);
    const dashStart = cursor + (full - drawn) / 2;

    cursor += full;
    return { key: item.key, drawn, offset: -dashStart };
  });

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        padding: '18px',
        borderRadius: '20px',
        background: '#FFFFFF',
        border: '1px solid #EDF1F7',
        boxShadow: '0 1px 2px rgba(19, 26, 43, 0.04), 0 8px 24px -16px rgba(19, 26, 43, 0.18)',
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
      {error && <p style={{ fontSize: '11.5px', color: '#B4442E', marginTop: 6 }}>{error}</p>}

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

            {segments.map((segment) => {
              const color = CATEGORY_COLOR[segment.key] ?? CATEGORY_COLOR.other;
              const dimmed = hovered !== null && hovered !== segment.key;

              return (
                <circle
                  key={segment.key}
                  cx="18"
                  cy="18"
                  r={R}
                  fill="none"
                  stroke={color}
                  // +1 on hover is the most the geometry allows: the extra
                  // half-stroke of cap at each end eats into GAP, and anything
                  // thicker would lap the neighbouring segment.
                  strokeWidth={hovered === segment.key ? STROKE + 1 : STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${segment.drawn.toFixed(2)} ${(CIRCUMFERENCE - segment.drawn).toFixed(2)}`}
                  strokeDashoffset={segment.offset.toFixed(2)}
                  opacity={dimmed ? 0.28 : 1}
                  style={{ transition: 'opacity 180ms ease, stroke-width 180ms ease' }}
                />
              );
            })}
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

      {/* Every category, never truncated. One omitted is indistinguishable from
          one that used nothing — and a share too small to see on the ring is
          still readable here as a number. Hovering a row lights its segment. */}
      {usage && usage.breakdown.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {usage.breakdown.map((item) => (
            <div
              key={item.key}
              onMouseEnter={() => setHovered(item.key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '12px',
                padding: '5px 6px',
                borderRadius: '9px',
                background: hovered === item.key ? '#F5F8FC' : 'transparent',
                transition: 'background 150ms ease',
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: CATEGORY_COLOR[item.key] ?? CATEGORY_COLOR.other,
                  flexShrink: 0,
                }}
              />
              {/* Resolved HERE, from the dictionary — the API sends only a key. */}
              <span
                style={{
                  color: MUTED,
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(`usage.category.${item.key}`)}
              </span>
              <span style={{ color: INK, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                {formatCredits(item.credits)}
              </span>
            </div>
          ))}
        </div>
      )}

      {usage && usage.breakdown.length === 0 && !error && (
        <p style={{ fontSize: '12px', color: MUTED, marginTop: 10, textAlign: 'center' }}>
          {t('usage.none')}
        </p>
      )}
    </div>
  );
}
