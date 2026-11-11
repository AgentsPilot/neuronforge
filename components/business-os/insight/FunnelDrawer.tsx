'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

export interface DrawerStat {
  v: string;        // Value (e.g., '9', '$540')
  l: string;        // Label (e.g., 'Got in touch')
  s: string;        // Subtext (e.g., 'all answered')
  good?: boolean;   // Green styling
  bad?: boolean;    // Red styling
}

export interface DrawerPerson {
  n: string;        // Name
  /*
   * Status (e.g., 'opened booking page'). Optional: the funnel panels name the
   * stage in their eyebrow, so repeating it under every name printed the same
   * word down the whole list and said nothing the heading had not.
   */
  s?: string;
  since: string;    // Time since (e.g., '2d')
  col: string;      // Avatar color
}

export interface DrawerTodo {
  t: string;        // Title
  s: string;        // Subtext
  done: boolean;
  action?: string;  // Button label (translated)
  actionKey?: string; // Original action key for callback
}

export interface ConfidenceData {
  t: string;        // Title (e.g., 'Not enough to judge')
  p: string;        // Explanation
  cur: number;      // Current value
  need: number;     // Needed value
}

export interface ChecklistItem {
  label: string;        // Short label (e.g., 'Website', 'Payments')
  done: boolean;
  action?: string;      // Action key for callback
  actionLabel?: string; // Translated CTA (e.g., 'Connect') — outstanding items only
  required?: boolean;   // false = recommended; shown, but never blocks "all set"
  detail?: string;      // What this gap breaks, in the client's terms
}

export interface DrawerContent {
  ey: string;       // Eyebrow (e.g., 'Between got in touch and booked')
  t: string;        // Title (e.g., 'Where you're losing them')
  p: string;        // Description paragraph
  hero?: boolean;   // Red border if leak
  stats?: DrawerStat[];
  conf?: ConfidenceData;
  /*
   * Pilot suggestion. `act` is the BUTTON LABEL and was also sent to
   * `onAction` as the key, so a translated label could never carry a working
   * action — the handler would receive "Open the CRM" and match nothing.
   * `actKey` separates the two, exactly as `DrawerTodo` already does.
   */
  pl?: { tx: string; act: string; actKey?: string };
  people?: DrawerPerson[];
  todos?: DrawerTodo[];
  checklist?: ChecklistItem[];  // Compact checklist for Day 1
}

interface FunnelDrawerProps {
  content: DrawerContent | null;
  onAction?: (action: string) => void;
  /**
   * Dismiss the panel. Optional: the Day 1 checklist content is always-on and
   * has nothing to close back to, so only the funnel drill-down supplies it.
   *
   * Pressing the station or connector again also closes it, but that is a
   * hidden affordance — nobody discovers a toggle by guessing, and the panel is
   * tall enough that being unable to put it away is the complaint it was meant
   * to answer.
   */
  onClose?: () => void;
}

// ===========================
// Component (matching mockup .lv-dr)
// ===========================

export function FunnelDrawer({ content, onAction, onClose }: FunnelDrawerProps) {
  const { isRTL, t } = useLanguage();

  if (!content) {
    return null;
  }

  // A finished checklist is good news — the card shouldn't keep wearing the
  // orange "needs attention" accent once there is nothing left to do.
  // Recommended items are excluded: skipping them is a valid choice, not a gap.
  const checklistComplete =
    !!content.checklist?.length &&
    content.checklist.filter(item => item.required !== false).every(item => item.done);

  return (
    <div
      className={`lv-dr ${content.hero ? 'hero' : ''}`}
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        marginTop: '16px',
        /*
         * THE LEAK WEARS RED, and the tint sits ON the surface rather than on
         * white so it reads in both themes instead of turning the panel into a
         * light card on a dark page.
         *
         * Taken away once, on the reasoning that the map above already draws
         * the leak in red and a second alarm was redundant. Put back on the
         * owner's call: the panel opens on a press now, so it is no longer
         * sitting there competing for attention — and once opened, a card about
         * a leak that looks exactly like every neutral card gives the reader
         * nothing to tell it apart from the ones that are merely informative.
         *
         * The controls inside it stay in the <NeedsYouCard> idiom. It is the
         * CARD that signals, not its buttons.
         */
        background: content.hero
          ? 'linear-gradient(180deg, rgba(220, 38, 38, 0.08), var(--v2-surface))'
          : checklistComplete
            ? 'linear-gradient(180deg, rgba(34, 197, 139, 0.10), var(--v2-surface))'
            : 'var(--v2-surface)',
        border: `1px solid ${content.hero ? 'rgba(220, 38, 38, 0.30)' : checklistComplete ? 'rgba(34, 197, 139, 0.30)' : 'var(--v2-border)'}`,
        borderRadius: '18px',
        padding: '20px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        position: 'relative',
      }}
    >
      {/* Close. Placed against the panel's trailing edge, which flips with the
          writing direction, so it never lands on top of the eyebrow in RTL. */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close') || 'Close'}
          className="inline-flex items-center justify-center rounded-lg transition-colors text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)]"
          style={{
            position: 'absolute',
            top: '12px',
            insetInlineEnd: '12px',
            width: '28px',
            height: '28px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{
              width: '15px',
              height: '15px',
              stroke: 'currentColor',
              fill: 'none',
              strokeWidth: 2.2,
              strokeLinecap: 'round',
            }}
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}

      {/* Eyebrow: .lv-dr-ey */}
      <div
        className="lv-dr-ey"
        style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: isRTL ? 'normal' : '0.08em',
          textTransform: isRTL ? 'none' : 'uppercase',
          /* `#059669` is a dark green chosen against a white card; on the
             dark ground it is barely separable from the surface. The success
             token reads on both, and the orange beside it already did. */
          color: checklistComplete ? 'var(--v2-success)' : '#F97316',
          marginBottom: '5px',
          /* Clear of the close button, which overlays this corner. */
          paddingInlineEnd: '30px',
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
        }}
      >
        {content.ey}
      </div>

      {/* Title: .lv-dr-t */}
      <div
        className="lv-dr-t"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
          fontSize: '18px',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          marginBottom: '5px',
          color: 'var(--v2-text-primary)',
          paddingInlineEnd: '30px',
        }}
      >
        {checklistComplete && (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '22px',
              height: '22px',
              borderRadius: '99px',
              /* A filled accent, not a ground under themed ink — legitimate in
                 either theme. Written as the token anyway: it is the same
                 value, and it says WHY the badge is green. */
              background: 'var(--v2-success)',
              flexShrink: 0,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{
                width: '13px',
                height: '13px',
                stroke: '#FFFFFF',
                fill: 'none',
                strokeWidth: 3.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }}
            >
              <path d="M4 12l6 6L20 5" />
            </svg>
          </span>
        )}
        {content.t}
      </div>

      {/* Description: .lv-dr-p */}
      <div
        className="lv-dr-p"
        /*
         * `unicode-bidi: isolate` so an embedded run cannot reorder the line
         * around it. This line reads "Longest wait: <name>, <n> days", and in
         * Hebrew the name is usually Latin — a left-to-right island inside a
         * right-to-left sentence. The neutral characters touching it (the
         * colon, the comma) then take their direction from whichever side wins,
         * and the punctuation migrates: the colon jumps to the far end and the
         * number lands on the wrong side of the name.
         *
         * The producer wraps the name and the figure in FSI/PDI; this is the
         * other half, keeping the paragraph itself from being dragged around by
         * them.
         */
        style={{
          unicodeBidi: 'isolate',
          fontSize: '14px',
          color: 'var(--v2-text-secondary)',
          marginBottom: '16px',
          maxWidth: '48rem',
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
        }}
      >
        {content.p}
      </div>

      {/* Stats grid: .lv-stats */}
      {content.stats && content.stats.length > 0 && (
        <div
          className="lv-stats"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(content.stats.length, 3)}, 1fr)`,
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          {content.stats.map((stat, index) => (
            <div
              key={index}
              className="lv-stat"
              style={{
                /*
                 * A TOKEN, BECAUSE THIS BOX IS READ IN BOTH THEMES.
                 *
                 * It was `#F8F9FC`, a near-white panel, while the value and
                 * label below it take `var(--v2-text-primary)` and
                 * `--v2-text-secondary`. In dark mode those resolve to light
                 * ink, so the box rendered as two white rectangles with the
                 * figures all but invisible inside them — seen on the funnel's
                 * "40 dropped" panel, where the only two numbers that matter
                 * could not be read at all.
                 *
                 * `--v2-bg` is the sunken tint used for a panel inside a card
                 * everywhere else, and it moves with the theme like the text
                 * on top of it.
                 */
                background: 'var(--v2-bg)',
                border: '1px solid var(--v2-border)',
                borderRadius: '13px',
                padding: '12px 13px',
                minWidth: 0,
              }}
            >
              {/* Value: .lvs-v */}
              <div
                className="lvs-v"
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                  fontSize: '19px',
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                  /*
                   * The state belongs on the FIGURE. `bad` used to tint only
                   * the subtext, so a bucket carrying no subtext — these aging
                   * buckets carry none — showed no state at all: "5 over 30
                   * days" rendered in the same ink as "0 over 30 days".
                   */
                  color: stat.good
                    ? 'var(--v2-success)'
                    : stat.bad
                      ? 'var(--v2-error)'
                      : 'var(--v2-text-primary)',
                }}
              >
                {stat.v}
              </div>
              {/* Label: .lvs-lb */}
              <div
                className="lvs-lb"
                style={{
                  fontSize: '12px',
                  color: 'var(--v2-text-secondary)',
                  marginTop: '1px',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.l}
              </div>
              {/* Subtext: .lvs-sub */}
              <div
                className={`lvs-sub ${stat.good ? 'good' : ''} ${stat.bad ? 'bad' : ''}`}
                style={{
                  fontSize: '11.5px',
                  /* The semantic tokens, which are defined identically in
                     both themes and chosen to read on either ground. `#C0392B`
                     was a dark red that all but vanished once the box behind
                     it stopped being white. */
                  color: stat.good
                    ? 'var(--v2-success)'
                    : stat.bad
                      ? 'var(--v2-error)'
                      : 'var(--v2-text-secondary)',
                  marginTop: '5px',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.s}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The Day 1 setup list now lives in <SystemReadiness>, directly under the
          timeline, so it is visible without drilling into this drawer. `checklist`
          is still accepted — it drives the completed/green treatment above. */}

      {/* Confidence bar: .lv-conf */}
      {content.conf && (
        <div
          className="lv-conf"
          style={{
            /* Same fault, same fix: hardcoded light panel under themed ink. */
            border: '1px solid var(--v2-border)',
            background: 'var(--v2-bg)',
            borderRadius: '13px',
            padding: '13px 14px',
            marginBottom: '16px',
          }}
        >
          {/* Title with icon: .lv-conf-t */}
          <div
            className="lv-conf-t"
            style={{
              fontSize: '13.5px',
              fontWeight: 600,
              marginBottom: '3px',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              color: 'var(--v2-text-primary)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{
                width: '15px',
                height: '15px',
                stroke: '#7C86A0',
                fill: 'none',
                strokeWidth: 2,
              }}
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {content.conf.t}
          </div>
          {/* Explanation: .lv-conf-p */}
          <div
            className="lv-conf-p"
            style={{
              fontSize: '12.5px',
              color: 'var(--v2-text-secondary)',
              marginBottom: '10px',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {content.conf.p}
          </div>
          {/* Progress bar: .lv-conf-bar */}
          <div
            className="lv-conf-bar"
            style={{
              height: '6px',
              borderRadius: '6px',
              /* The unfilled track. A fixed pale grey disappears into a light
                 card and glares out of a dark one. */
              background: 'var(--v2-border)',
              overflow: 'hidden',
            }}
          >
            <i
              style={{
                display: 'block',
                height: '100%',
                borderRadius: '6px',
                /* The filled part must stay legible against the track above in
                   both themes, so it takes the muted ink rather than a fixed
                   mid-grey that only separates from one of them. */
                background: 'var(--v2-text-muted)',
                transition: 'width 0.5s',
                width: `${Math.min((content.conf.cur / content.conf.need) * 100, 100)}%`,
              }}
            />
          </div>
          {/* Scale: .lv-conf-sc */}
          <div
            className="lv-conf-sc"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
              color: 'var(--v2-text-muted)',
              marginTop: '6px',
              fontVariantNumeric: 'tabular-nums',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            <span>{content.conf.cur}</span>
            <span>{content.conf.need}</span>
          </div>
        </div>
      )}

      {/* People list: .lv-p */}
      {content.people && content.people.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          {content.people.map((person, index) => (
            <div
              key={index}
              className="lv-p"
              style={{
                /*
                 * TIGHTER THAN IT WAS: 32px avatars in 10px rows, each name on
                 * its own 14px line, made five people as tall as the card above
                 * them. The row carries a name and a number of days; it does
                 * not need the height of a list item with a subtitle, and the
                 * subtitle is gone.
                 */
                display: 'flex',
                gap: '9px',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: index < content.people!.length - 1 ? '1px solid var(--v2-border)' : 'none',
              }}
            >
              {/* Avatar: .lv-av */}
              <span
                className="lv-av"
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: 700,
                  flexShrink: 0,
                  background: person.col,
                }}
              >
                {person.n.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              {/* Info: .lv-p-m */}
              <div className="lv-p-m" style={{ flex: 1, minWidth: 0 }}>
                <b
                  style={{
                    fontSize: '13px',
                    display: 'block',
                    fontWeight: 600,
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                    color: 'var(--v2-text-primary)',
                  }}
                >
                  {person.n}
                </b>
                {person.s && (
                  <small
                    style={{
                      fontSize: '12.5px',
                      color: 'var(--v2-text-secondary)',
                      fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                    }}
                  >
                    {person.s}
                  </small>
                )}
              </div>
              {/* Tag: .lv-p-tag */}
              <span
                className="lv-p-tag"
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#F97316',
                  background: 'rgba(249, 115, 22, 0.12)',
                  padding: '2px 7px',
                  borderRadius: '20px',
                  whiteSpace: 'nowrap',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {person.since}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Todos: .lv-todo */}
      {content.todos && content.todos.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          {content.todos.map((todo, index) => (
            <div
              key={index}
              className="lv-todo"
              style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                padding: '13px 0',
                borderBottom: index < content.todos!.length - 1 ? '1px solid var(--v2-border)' : 'none',
              }}
            >
              {/* Icon: .lv-td-ic */}
              <span
                className={`lv-td-ic ${todo.done ? 'done' : ''}`}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '10px',
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  background: todo.done ? 'rgba(34, 197, 139, 0.12)' : 'rgba(249, 115, 22, 0.12)',
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: '15px',
                    height: '15px',
                    stroke: todo.done ? '#22C58B' : '#F97316',
                    fill: 'none',
                    strokeWidth: 2,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }}
                >
                  {todo.done ? (
                    <path d="M4 12l6 6L20 5" />
                  ) : (
                    <circle cx="12" cy="12" r="9" />
                  )}
                </svg>
              </span>
              {/* Content: .lv-td-m */}
              <div className="lv-td-m" style={{ flex: 1, minWidth: 0 }}>
                <b
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    display: 'block',
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                    color: 'var(--v2-text-primary)',
                  }}
                >
                  {todo.t}
                </b>
                <small
                  style={{
                    fontSize: '12.5px',
                    color: 'var(--v2-text-secondary)',
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  }}
                >
                  {todo.s}
                </small>
              </div>
              {/* Action button or done tag */}
              {todo.action && !todo.done ? (
                <button
                  className="lv-td-btn"
                  onClick={() => onAction?.(todo.actionKey || todo.action!)}
                  style={{
                    border: 'none',
                    background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
                    color: '#fff',
                    borderRadius: '10px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 5px 14px -7px rgba(249,115,22,0.9)',
                    cursor: 'pointer',
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  }}
                >
                  {todo.action}
                </button>
              ) : todo.done ? (
                <span
                  className="lv-td-tag"
                  style={{
                    fontSize: '12px',
                    color: 'var(--v2-success)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  }}
                >
                  {t('insight.drawer.done') || 'Done'}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Pilot suggestion: .lv-pl */}
      {content.pl && (
        <div
          className="lv-pl"
          style={{
            display: 'flex',
            gap: '11px',
            alignItems: 'flex-start',
            /* The sunken-panel pair <NeedsYouCard> uses for a box inside a
               card, instead of a second orange wash competing with the tags. */
            background: 'var(--v2-bg)',
            border: '1px solid var(--v2-border)',
            borderRadius: '13px',
            padding: '13px 14px',
            marginTop: '16px',
          }}
        >
          {/* Small orb */}
          <span
            className="lv-orb"
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
              flexShrink: 0,
              boxShadow: '0 0 0 3px rgba(249,115,22,0.13)',
              marginTop: '1px',
            }}
          />
          {/* Text */}
          <div
            className="lv-pl-tx"
            style={{
              flex: 1,
              fontSize: '13.5px',
              minWidth: 0,
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              color: 'var(--v2-text-primary)',
            }}
          >
            {content.pl.tx}
          </div>
          {/* Action button */}
          {content.pl.act && (
            <button
              type="button"
              className="lv-pl-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97]"
              onClick={() => onAction?.(content.pl!.actKey ?? content.pl!.act)}
              /*
               * THE SAME BUTTON AS EVERY ROW IN <NeedsYouCard>.
               *
               * Metrics, lift, hover and press all copied rather than
               * approximated. `ap-primary-lift` has to be the class and not an
               * inline shadow for the reason globals.css records: the glow is a
               * colour-mix of the primary, and dark mode swaps it for a plain
               * dark shadow. Written inline it would lose that and go back to
               * glowing on the dark ground.
               */
              style={{
                background: 'var(--v2-primary)',
                color: '#fff',
                whiteSpace: 'nowrap',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {content.pl.act}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
