'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { TipGlyph } from '@/components/business-os/insight/tipMarker';

// ===========================
// Types
// ===========================

export interface Tip {
  at: string;       // Which station/gap this tip relates to
  n: number;        // Tip number badge
  t: string;        // Title (e.g., "One thing I'd do")
  s: string;        // Suggestion text
  /**
   * The station or connector this tip is about, in the map's own words.
   *
   * `at` is a key — 'found', 'g2' — which is meaningless to a reader. The
   * marker pinned to a station and the strip holding the text are two separate
   * pieces of the card, and nothing said they were the same subject: clicking
   * the marker looked like it did nothing, because the text that answered it
   * was already sitting above with no indication it belonged to that station.
   */
  about?: string;
}

interface TipsStepperProps {
  tips: Tip[];
  onSelectTip?: (tip: Tip) => void;
  /**
   * Which tip to show, when the choice was made elsewhere.
   *
   * Every tip carries a numbered marker pinned to the station or connector it
   * is about. Clicking one set a `tipIndex` in the dashboard that reached
   * nothing — this component kept its own index and took no prop — so the
   * marker looked like a control and did nothing when pressed. The number sat
   * beside a station's visitor count with no way to find out what it referred
   * to.
   *
   * A hint, not a controlled value: the arrow below still moves through the
   * tips on its own, and a new hint moves it again.
   */
  activeIndex?: number;
  /**
   * Bumped whenever a marker is clicked, to flash this strip.
   *
   * `activeIndex` alone cannot do it. With a single tip the index never moves,
   * so pressing the marker changed nothing on screen and the control read as
   * broken — the complaint that prompted this. A counter changes on every
   * press, including a press that selects the tip already showing.
   */
  pulseKey?: number;
}

// ===========================
// Component (matching mockup .lv-tips)
// ===========================

export function TipsStepper({ tips, onSelectTip, activeIndex, pulseKey }: TipsStepperProps) {
  const { isRTL, t } = useLanguage();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pulsing, setPulsing] = useState(false);

  /*
   * Flash once per marker press, then clear.
   *
   * Skipped on the first render — `pulseKey` arrives with a value, and
   * animating on mount would make the card twitch on every page load for a
   * click nobody made.
   */
  const firstPulse = useRef(true);
  useEffect(() => {
    if (firstPulse.current) {
      firstPulse.current = false;
      return;
    }
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 620);
    return () => clearTimeout(timer);
  }, [pulseKey]);

  /*
   * Follow the marker that was clicked, then go back to minding our own index.
   *
   * Guarded on the bounds because the tip list is rebuilt as the business
   * changes: a stale index from a list that has shrunk would show nothing at
   * all, which is the failure this whole change exists to remove.
   */
  useEffect(() => {
    if (activeIndex === undefined) return;
    if (activeIndex < 0 || activeIndex >= tips.length) return;
    setCurrentIndex(activeIndex);
  }, [activeIndex, tips.length]);

  if (!tips.length) {
    return null;
  }

  const currentTip = tips[currentIndex];

  const handleNext = () => {
    const nextIndex = (currentIndex + 1) % tips.length;
    setCurrentIndex(nextIndex);
    onSelectTip?.(tips[nextIndex]);
  };

  return (
    <div
      className="lv-tips"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: 'linear-gradient(180deg, rgba(249, 115, 22, 0.10), rgba(249, 115, 22, 0.03))',
        border: '1px solid rgba(249, 115, 22, 0.30)',
        borderRadius: '18px',
        padding: '14px 16px',
        marginBottom: '16px',
        // The flash that answers a marker press. Respects reduced-motion via
        // the keyframes below, which collapse to a plain hold.
        animation: pulsing ? 'lvTipPulse 0.62s ease-out' : undefined,
      }}
    >
      {/*
        Orb: .lv-orb

        It was an empty gradient circle that bobbed. Decorative, and the only
        thing it told the reader was that something here was orange — on a card
        whose whole job is to hand over ONE suggestion worth acting on.

        A bulb says that without a word, in any of the three languages. The
        circle stays: it is what the card is recognised by, and the marker the
        map pins to a station is the same family of shape.

        `#5A2408` because the glyph has to hold across the whole gradient, not
        just its middle. Measured against both ends and the centre, it is the
        only candidate that stays above 3:1 everywhere (3.49:1 at worst); white
        falls to 1.76:1 at the light end and disappears.
      */}
      <span
        className="lv-orb"
        style={{
          width: '26px',
          height: '26px',
          borderRadius: '50%',
          background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
          flexShrink: 0,
          boxShadow: '0 0 0 4px rgba(249,115,22,0.13)',
          animation: 'lvBob 3.4s ease-in-out infinite',
          display: 'grid',
          placeItems: 'center',
          color: '#5A2408',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          style={{ display: 'block' }}
        >
          {/* The glass, then the two lines of the base. */}
          <path d="M9 18h6" />
          <path d="M10 21.5h4" />
          <path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.6v.1h6v-.1c0-.6.3-1.2.8-1.6A6.5 6.5 0 0 0 12 2.5Z" />
        </svg>
      </span>

      {/* Tip content: .lv-tips-t */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontSize: '14.5px',
            fontWeight: 600,
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            color: 'var(--v2-text-primary)',
          }}
        >
          {currentTip.t}
          {/*
            Where on the map this tip is pinned.

            It carries the MARKER, not just the station's name. As a bare label
            it read as part of the sentence above it — "One thing to do  Found
            you" — because nothing said it was a place rather than a
            continuation of the title. Repeating the little orange dot from the
            map, with the same glyph inside it, makes it a reference to that
            marker instead, and needs no words to say so in any language.
          */}
          {currentTip.about && (
            <span
              style={{
                marginInlineStart: '10px',
                /*
                 * LOGICAL padding, not physical.
                 *
                 * This was `1px 8px 1px 3px` — tight on the left, where the
                 * marker sits in English. In Hebrew the flex row reverses and
                 * the marker moves to the RIGHT, so the tight edge stayed on
                 * the side with the text on it: the word pressed against the
                 * border while a gap opened behind the marker. Every Hebrew
                 * account saw a lopsided pill.
                 */
                paddingBlock: '2px',
                paddingInlineStart: '3px',
                paddingInlineEnd: '9px',
                borderRadius: '999px',
                background: 'rgba(249, 115, 22, 0.14)',
                border: '1px solid rgba(249, 115, 22, 0.28)',
                /*
                 * Theme-aware, because the dashboard is dark.
                 *
                 * This was `#C2410C`, a hex picked against white. Over the
                 * badge's own tint on the dark surface it measures 2.35:1 —
                 * against the 4.5 a 11.5px label needs — so on every dark
                 * account the word inside the pill was barely legible. It was
                 * not quite right on light either, at 4.48:1.
                 *
                 * The platform already keeps a warning triple per theme.
                 * Measured over this tint: 6.13:1 light, 9.77:1 dark.
                 */
                color: 'var(--v2-status-warning-text, #92400E)',
                fontSize: '11.5px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                verticalAlign: 'middle',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              {/* The same marker the map pins to that station — see `tipMarker`. */}
              <span
                aria-hidden
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: '#FFB24D',
                  color: '#5A3A05',
                  fontSize: '9.5px',
                  fontWeight: 700,
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                <TipGlyph n={currentTip.n} total={tips.length} size={16} />
              </span>
              {currentTip.about}
            </span>
          )}
        </div>
        <small
          style={{
            display: 'block',
            fontWeight: 400,
            color: 'var(--v2-text-secondary)',
            fontSize: '13px',
            marginTop: '1px',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
          }}
        >
          {currentTip.s}
        </small>
      </div>

      {/* Counter: .lv-tips-c */}
      {tips.length > 1 && (
        <span
          style={{
            fontSize: '12.5px',
            color: 'var(--v2-text-secondary)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
          }}
        >
          {currentIndex + 1} {t('insight.tips.of') || 'of'} {tips.length}
        </span>
      )}

      {/* Next button: .lv-next */}
      {tips.length > 1 && (
        <button
          onClick={handleNext}
          style={{
            border: '1.5px solid #F3D2B4',
            background: 'var(--v2-surface)',
            borderRadius: '11px',
            padding: '8px 13px',
            fontSize: '13px',
            fontWeight: 600,
            color: '#F97316',
            whiteSpace: 'nowrap',
            transition: '0.15s',
            cursor: 'pointer',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#FFF3E8';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--v2-surface)';
          }}
        >
          {/* Arrow icon */}
          <svg
            viewBox="0 0 24 24"
            style={{
              width: '14px',
              height: '14px',
              stroke: '#F97316',
              fill: 'none',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              transform: isRTL ? 'rotate(180deg)' : 'none',
            }}
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      )}

      {/* Global keyframes for bob animation */}
      <style jsx global>{`
        @keyframes lvBob {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-3px);
          }
        }

        /* The acknowledgement of a marker press: a brief lift and ring. */
        @keyframes lvTipPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.42);
          }
          55% {
            box-shadow: 0 0 0 7px rgba(249, 115, 22, 0);
            border-color: rgba(249, 115, 22, 0.75);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(249, 115, 22, 0);
          }
        }

        /*
         * Someone who has asked for less motion still needs the answer to
         * "did my click register" — so the ring holds rather than travelling.
         */
        @media (prefers-reduced-motion: reduce) {
          @keyframes lvTipPulse {
            0%, 100% {
              box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.32);
            }
          }
          @keyframes lvBob {
            0%, 100% {
              transform: none;
            }
          }
        }
      `}</style>
    </div>
  );
}
