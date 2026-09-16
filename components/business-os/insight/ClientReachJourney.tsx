'use client';

/**
 * Can a client actually reach you?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A PRESENTATION OF THE READINESS GRAPH. IT DECIDES NOTHING.
 *
 * Every fact here comes from the `ResolvedGraph` the dashboard already built:
 * which steps are outstanding, which are compulsory, and which single one comes
 * next. This component groups those steps into the three things a client does —
 * find you, book a time, pay you — and draws the first one that cannot happen.
 *
 * It is deliberately NOT a second opinion. `SystemReadiness` renders the same
 * graph as a list; this renders it as a path. Two views, one answer. If they
 * ever disagree, the bug is here, not in the graph.
 *
 * WHY A PATH RATHER THAN A LIST
 *
 * The list asks the reader to hold eleven rows of equal weight and work out
 * which matters. The path asks nothing: the break is where the arrow stops.
 * And it is phrased as a consequence for the client rather than a state of the
 * configuration — "nobody can book until you do" instead of "availability: not
 * configured" — because the owner cares about the first and has to translate
 * the second.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { nextStep, type ResolvedGraph, type ResolvedStep, type StepId } from '@/lib/business-os/setup/setupGraph';

type StationId = 'find' | 'book' | 'pay';

/**
 * Which steps stand behind each thing a client does.
 *
 * A grouping for the eye, not a dependency: the graph already owns what blocks
 * what. A step missing from every list here simply never colours a station — it
 * still appears in the readiness list below, and it can still be the callout if
 * the graph names it next.
 *
 * Note how little this table can actually decide. A station reddens only from
 * `graph.blocking`, which is compulsory-and-outstanding, and only six steps can
 * ever be compulsory: `website` (always), `services` (always), `availability`
 * (if the business takes appointments), and `payments` / `profile` / `invoicing`
 * (once money moves). Everything else is here for tidiness and cannot block.
 *
 * `meta_insights` and `google_analytics` are deliberately in no station: they
 * are about the owner seeing their own numbers, not about a client arriving.
 *
 * The one real judgement call is `services`. They are what the page displays,
 * so they could sit under "find you" — but a client cannot book nothing, and
 * "find you" reads better owned solely by whether the page is reachable.
 */
const STATION_STEPS: Record<StationId, StepId[]> = {
  find: ['website', 'design'],
  book: ['services', 'availability', 'intake', 'calendar', 'service_descriptions'],
  pay: ['payments', 'profile', 'invoicing'],
};

const ORDER: StationId[] = ['find', 'book', 'pay'];

const OK = '#22C58B';
const LEAK = '#F26B6B';

const ICONS: Record<StationId, JSX.Element> = {
  find: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </>
  ),
  book: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </>
  ),
  pay: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
};

interface Props {
  /** The graph the dashboard already resolved. Never re-resolved here. */
  graph: ResolvedGraph;
  /** The same dispatcher the readiness list uses, so a step behaves the same in both. */
  onAction?: (action: string, data?: unknown) => void;
}

export function ClientReachJourney({ graph, onAction }: Props) {
  const { t, isRTL } = useLanguage();

  /**
   * `t` returns the KEY when a translation is missing, so the `t(k) || fallback`
   * idiom used elsewhere in this folder can never fall back. This one can.
   */
  const tr = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const font = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';
  const display = isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif';

  /** The step the graph chose. The first consumer of `nextStep` in the product. */
  const next = useMemo(() => nextStep(graph), [graph]);

  /**
   * A station is blocked by any compulsory step still outstanding behind it.
   *
   * `graph.blocking` is exactly that set, already filtered — so this is a
   * lookup, not a judgement.
   */
  const blockedBy = useMemo(() => {
    const map = {} as Record<StationId, ResolvedStep[]>;
    for (const station of ORDER) {
      map[station] = graph.blocking.filter(step =>
        STATION_STEPS[station].includes(step.item.id as StepId)
      );
    }
    return map;
  }, [graph]);

  const firstBroken = ORDER.find(station => blockedBy[station].length > 0) ?? null;

  /**
   * What the callout points at.
   *
   * The graph's own `next` when it is compulsory — that is the whole reason
   * `nextStep` exists, and it already respects prerequisites.
   *
   * But `next` falls back to the first merely-READY step when no compulsory one
   * is actionable (`setupGraph.ts:536-544`), and that step can be optional. A
   * callout reading "your page still wears the default look" underneath a
   * station drawn red for a missing website would be describing a different
   * problem from the one the card is pointing at. So when `next` is not
   * compulsory, the first blocker behind the first broken station wins, and the
   * picture and the sentence stay about the same thing.
   */
  const focus: ResolvedStep | null =
    next?.mandatory
      ? next
      : (firstBroken ? blockedBy[firstBroken][0] ?? next ?? null : next ?? null);

  const stationLabel: Record<StationId, string> = {
    find: tr('reach.station.find', 'Find you'),
    book: tr('reach.station.book', 'Book a time'),
    pay: tr('reach.station.pay', 'Pay you'),
  };

  return (
    <div
      className="crj"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: '18px',
        padding: '18px 16px 16px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        marginBottom: '24px',
      }}
    >
      <div
        style={{
          fontSize: '11.5px',
          fontWeight: 600,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: 'var(--v2-text-secondary)',
          marginBottom: '14px',
          paddingInlineStart: '2px',
          fontFamily: font,
        }}
      >
        {tr('reach.title', 'Can a client reach you?')}
      </div>

      <div className="crj-scroll">
        <div className="crj-flow">
          {ORDER.map((station, index) => {
            const broken = blockedBy[station].length > 0;
            /* Only the link INTO a broken station is cut. A break at "pay"
               says nothing about whether they could book. */
            const cutAhead = index > 0 && broken;

            return (
              <div key={station} style={{ display: 'contents' }}>
                {index > 0 && (
                  <div className={`crj-link${cutAhead ? ' cut' : ''}`}>
                    {cutAhead && <span className="crj-x">✕</span>}
                    <span className="crj-track">
                      {!cutAhead && <i />}
                    </span>
                  </div>
                )}

                <div className={`crj-stn${broken ? ' broken' : ''}`}>
                  <span className="crj-ic">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#fff"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {ICONS[station]}
                    </svg>
                  </span>
                  <span className="crj-t" style={{ fontFamily: display }}>
                    {stationLabel[station]}
                  </span>
                  <span className="crj-s" style={{ fontFamily: font }}>
                    {broken
                      ? tr('reach.state.blocked', 'blocked')
                      : tr('reach.state.ready', 'ready')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* The one thing to do, named as a consequence for the client. */}
      {focus && (
        <div
          className="crj-callout"
          style={{
            marginTop: '16px',
            border: `1.5px solid ${LEAK}`,
            background: 'rgba(242,107,107,0.07)',
            borderRadius: '14px',
            padding: '15px 16px',
            display: 'flex',
            gap: '14px',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: '220px' }}>
            <div
              style={{
                fontSize: '14.5px',
                fontWeight: 600,
                color: 'var(--v2-text-primary)',
                lineHeight: 1.4,
                fontFamily: font,
              }}
            >
              {tr(`reach.blocked.${focus.item.id}`, focus.item.title)}
            </div>
            <div
              style={{
                fontSize: '13px',
                color: 'var(--v2-text-secondary)',
                marginTop: '3px',
                lineHeight: 1.45,
                fontFamily: font,
              }}
            >
              {focus.item.missing?.length
                ? `${tr('readiness.stillNeeds', 'Still needs:')} ${focus.item.missing.join(' · ')}`
                : focus.item.description}
            </div>
          </div>

          {focus.item.action && onAction && (
            <button
              onClick={() => onAction(focus.item.action!, { stepId: focus.item.id })}
              className="crj-btn"
              style={{ fontFamily: font }}
            >
              {tr(`reach.fix.${focus.item.id}`, tr('readiness.setUpNow', 'Set up now'))}
            </button>
          )}
        </div>
      )}

      {/*
        The layout rules, in a stylesheet rather than inline.

        Inline styles carry no media query and outrank any rule that does, so a
        row of fixed-width stations has no way to become a column on a phone.
        This is the same shape FunnelMap now uses, for the same reason.
      */}
      <style jsx global>{`
        .crj-flow {
          display: flex;
          align-items: stretch;
        }
        /* Scrolls inside its own box rather than pushing the page sideways. */
        .crj-scroll {
          overflow-x: auto;
        }

        .crj-stn {
          flex: 0 0 auto;
          width: 118px;
          text-align: center;
          padding: 14px 6px 12px;
          border-radius: 15px;
          border: 1.5px solid var(--v2-border);
          background: var(--v2-surface);
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .crj-stn.broken {
          border-color: ${LEAK};
          box-shadow: 0 0 0 3px rgba(242,107,107,0.12);
        }
        .crj-ic {
          width: 34px;
          height: 34px;
          border-radius: 11px;
          display: grid;
          place-items: center;
          margin: 0 auto 9px;
          background: linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%);
          box-shadow: 0 5px 14px -6px rgba(249,115,22,0.7);
        }
        .crj-stn.broken .crj-ic {
          background: ${LEAK};
          box-shadow: none;
        }
        .crj-ic svg {
          width: 17px;
          height: 17px;
        }
        .crj-t {
          display: block;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.2;
          color: var(--v2-text-primary);
        }
        .crj-s {
          display: block;
          font-size: 11.5px;
          margin-top: 4px;
          color: ${OK};
        }
        .crj-stn.broken .crj-s {
          color: ${LEAK};
          font-weight: 600;
        }

        .crj-link {
          flex: 1;
          min-width: 34px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 7px;
          padding: 0 4px;
        }
        .crj-track {
          width: 100%;
          height: 3px;
          border-radius: 3px;
          background: #EAF7F1;
          position: relative;
          overflow: hidden;
        }
        .crj-link.cut .crj-track {
          height: 0;
          background: transparent;
          border-top: 2.5px dashed ${LEAK};
          overflow: visible;
        }
        .crj-track > i {
          position: absolute;
          top: -2.5px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${OK};
          animation: crjFlow 2.8s linear infinite;
        }
        .crj-x {
          font-size: 15px;
          font-weight: 700;
          color: ${LEAK};
          line-height: 1;
        }
        @keyframes crjFlow {
          from { left: -8px; }
          to { left: 100%; }
        }

        .crj-btn {
          flex: 0 0 auto;
          border: none;
          background: #F97316;
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          padding: 10px 16px;
          border-radius: 11px;
          cursor: pointer;
          box-shadow: 0 6px 16px -8px rgba(249,115,22,0.9);
          transition: filter 0.15s, transform 0.15s;
        }
        .crj-btn:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        /* Phone: the path turns vertical. A horizontal scroll would hide the
           break, and the break is the entire point of the card. */
        @media (max-width: 700px) {
          .crj-scroll {
            overflow: visible;
          }
          .crj-flow {
            flex-direction: column;
          }
          .crj-stn {
            width: 100%;
            display: grid;
            grid-template-columns: auto 1fr auto;
            align-items: center;
            column-gap: 13px;
            text-align: start;
            padding: 12px 15px;
          }
          .crj-ic {
            margin: 0;
          }
          .crj-s {
            margin-top: 0;
          }
          .crj-link {
            flex: 0 0 auto;
            min-width: 0;
            min-height: 34px;
            flex-direction: row;
            justify-content: flex-start;
            gap: 10px;
            padding-inline-start: 32px;
          }
          .crj-track {
            width: 3px;
            height: auto;
            align-self: stretch;
            flex: 0 0 auto;
            /* Visible: a 3px box would clip the 8px dot to a sliver. */
            overflow: visible;
          }
          .crj-link.cut .crj-track {
            width: 0;
            height: auto;
            border-top: none;
            border-inline-start: 2.5px dashed ${LEAK};
          }
          .crj-track > i {
            left: 50%;
            margin-inline-start: -4px;
            animation-name: crjFlowV;
          }
        }
        @keyframes crjFlowV {
          from { top: -8px; }
          to { top: 100%; }
        }

        @media (prefers-reduced-motion: reduce) {
          .crj-track > i {
            animation: none;
            inset-inline-start: 45%;
          }
        }
      `}</style>
    </div>
  );
}
