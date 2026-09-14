'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

/** One labelled number in the figure row. */
export interface VerdictFigure {
  value: string;
  label: string;
}

interface VerdictCardProps {
  status: 'ok' | 'warn';
  verdict: string;
  verdictSub: string;
  when: string;
  /**
   * Render the verdict as labelled figures rather than as the `verdict`
   * sentence.
   *
   * A verdict that is really a set of numbers — "284 found you. 3 contacts. 3
   * booked — ₪4,350." — reads as a paragraph when it is printed as one, and the
   * four figures that are its entire content have to be picked out of the prose
   * word by word. `verdict` is still required and still carries the sentence:
   * it becomes the card's accessible label, so the structure is visual only and
   * a screen reader hears one coherent line rather than seven orphaned tokens.
   */
  figures?: VerdictFigure[];
  /** A single figure set apart from the row — the money, where there is money. */
  highlight?: string;
  /**
   * Fill the height of its container and drop the standalone bottom margin.
   *
   * Set when the card sits in the day/week grid, where the row's gap owns the
   * spacing and both cards must end level. It has to be a prop rather than a
   * CSS rule: the margin below is an inline style, and inline styles win over
   * a stylesheet — the card stretched to the row height minus its own 14px and
   * came out permanently shorter than the one beside it.
   */
  fillHeight?: boolean;
}

// ===========================
// Component (matching mockup .lv-verdict)
// ===========================

export function VerdictCard({
  status,
  verdict,
  verdictSub,
  when,
  figures,
  highlight,
  fillHeight = false,
}: VerdictCardProps) {
  const { isRTL } = useLanguage();

  const bodyFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';
  const displayFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif';
  const hasFigures = !!figures?.length;
  /** The dot's colour, reused by the last beat and the money it carries. */
  const accent = status === 'warn' ? '#FFB24D' : '#22C58B';

  return (
    <div
      className={`lv-verdict ${status === 'warn' ? 'warn' : ''}`}
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        display: 'flex',
        gap: '13px',
        alignItems: 'flex-start',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: '18px',
        padding: '17px 18px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        marginBottom: fillHeight ? 0 : '14px',
        height: fillHeight ? '100%' : undefined,
        boxSizing: 'border-box',
      }}
    >
      {/* Live pulse dot: .lv-live */}
      <span
        className="lv-live"
        style={{
          width: '9px',
          height: '9px',
          borderRadius: '50%',
          background: status === 'warn' ? '#FFB24D' : '#22C58B',
          flexShrink: 0,
          marginTop: '7px',
          position: 'relative',
        }}
      >
        {/* Pulse animation */}
        <span
          style={{
            content: '""',
            position: 'absolute',
            inset: '-5px',
            borderRadius: '50%',
            background: status === 'warn'
              ? 'rgba(255,178,77,0.3)'
              : 'rgba(34,197,139,0.28)',
            animation: 'lvPulse 2.2s ease-out infinite',
          }}
        />
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* When badge: .lv-v-when */}
        <span
          style={{
            display: 'inline-block',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--v2-text-secondary)',
            background: 'var(--v2-bg)',
            padding: '3px 9px',
            borderRadius: '20px',
            marginBottom: '7px',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
          }}
        >
          {when}
        </span>

        {hasFigures ? (
          /*
           * The week told as a sequence: each beat one line, threaded together
           * so the progression is visible rather than inferred.
           *
           * These three numbers are one story — people arrived, some of them
           * spoke to you, some of those bought — and printed as a single run-on
           * line ("284 found you. 3 contacts. 3 booked — ₪4,350.") that story
           * is flattened into a paragraph whose four figures have to be picked
           * out word by word. Stacked and rail-connected, the shape of the week
           * is legible before any number is read.
           *
           * An ordered list because the order carries meaning: a screen reader
           * should announce it as a sequence, and `verdict` remains the label so
           * the whole thing is still heard as one coherent sentence first.
           */
          <ol
            aria-label={verdict}
            style={{
              listStyle: 'none',
              margin: '0 0 8px',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
            }}
          >
            {figures!.map((figure, index) => {
              const isLast = index === figures!.length - 1;

              return (
                <li
                  key={figure.label}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '7px',
                    paddingInlineStart: '15px',
                  }}
                >
                  {/* The thread between beats. Drawn per-item from this dot down
                      to the next, so it never overshoots the final one. */}
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        insetInlineStart: '2px',
                        top: '12px',
                        bottom: '-7px',
                        width: '1px',
                        background: 'var(--v2-border)',
                      }}
                    />
                  )}

                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      insetInlineStart: 0,
                      top: '6px',
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      background: isLast ? accent : 'var(--v2-border)',
                    }}
                  />

                  <span
                    style={{
                      fontFamily: displayFont,
                      fontSize: '15px',
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                      color: 'var(--v2-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {figure.value}
                  </span>

                  <span
                    style={{
                      fontFamily: bodyFont,
                      fontSize: '13px',
                      color: 'var(--v2-text-secondary)',
                    }}
                  >
                    {figure.label}
                  </span>

                  {/* The money rides the beat that earned it — the last one —
                      rather than trailing the whole list after an em-dash. */}
                  {isLast && highlight && (
                    <span
                      style={{
                        fontFamily: displayFont,
                        fontSize: '15px',
                        fontWeight: 600,
                        letterSpacing: '-0.01em',
                        color: accent,
                        fontVariantNumeric: 'tabular-nums',
                        marginInlineStart: 'auto',
                      }}
                    >
                      {highlight}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          /* Verdict title: .lv-v-t */
          <div
            style={{
              fontFamily: displayFont,
              fontSize: '16.5px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.35,
              marginBottom: '4px',
              color: 'var(--v2-text-primary)',
            }}
          >
            {verdict}
          </div>
        )}

        {/* Verdict subtext: .lv-v-p. Omitted, not emptied — an empty div still
            takes a line box, and the card would hold a blank row under verdicts
            that deliberately have nothing more to say. */}
        {verdictSub && (
          <div
            style={{
              fontSize: '13px',
              lineHeight: 1.45,
              color: 'var(--v2-text-secondary)',
              fontFamily: bodyFont,
            }}
          >
            {verdictSub}
          </div>
        )}
      </div>

      {/* Global keyframes for pulse animation */}
      <style jsx global>{`
        @keyframes lvPulse {
          0% {
            transform: scale(0.6);
            opacity: 0.9;
          }
          100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
