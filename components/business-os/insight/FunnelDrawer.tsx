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
  s: string;        // Status (e.g., 'opened booking page')
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
  pl?: { tx: string; act: string };  // Pilot suggestion
  people?: DrawerPerson[];
  todos?: DrawerTodo[];
  checklist?: ChecklistItem[];  // Compact checklist for Day 1
}

interface FunnelDrawerProps {
  content: DrawerContent | null;
  onAction?: (action: string) => void;
}

// ===========================
// Component (matching mockup .lv-dr)
// ===========================

export function FunnelDrawer({ content, onAction }: FunnelDrawerProps) {
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
        background: content.hero
          ? 'linear-gradient(180deg, #FFF9F9, #fff)'
          : checklistComplete
            ? 'linear-gradient(180deg, #F3FDF8, #fff)'
            : '#FFFFFF',
        border: `1px solid ${content.hero ? '#F6C6C6' : checklistComplete ? '#BFE9D5' : '#E7E9F1'}`,
        borderRadius: '18px',
        padding: '20px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
      }}
    >
      {/* Eyebrow: .lv-dr-ey */}
      <div
        className="lv-dr-ey"
        style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: isRTL ? 'normal' : '0.08em',
          textTransform: isRTL ? 'none' : 'uppercase',
          color: checklistComplete ? '#059669' : '#F97316',
          marginBottom: '5px',
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
          color: '#131A2B',
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
              background: '#10B981',
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
        style={{
          fontSize: '14px',
          color: '#697187',
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
                background: '#F8F9FC',
                border: '1px solid #E7E9F1',
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
                  color: '#131A2B',
                }}
              >
                {stat.v}
              </div>
              {/* Label: .lvs-lb */}
              <div
                className="lvs-lb"
                style={{
                  fontSize: '12px',
                  color: '#697187',
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
                  color: stat.good ? '#1B9A6C' : stat.bad ? '#C0392B' : '#697187',
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
            border: '1px solid #DDE2EE',
            background: '#F7F9FD',
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
              color: '#131A2B',
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
              color: '#697187',
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
              background: '#E4E8F2',
              overflow: 'hidden',
            }}
          >
            <i
              style={{
                display: 'block',
                height: '100%',
                borderRadius: '6px',
                background: '#9AA5BE',
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
              color: '#8A93A8',
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
                display: 'flex',
                gap: '11px',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: index < content.people!.length - 1 ? '1px solid #E7E9F1' : 'none',
              }}
            >
              {/* Avatar: .lv-av */}
              <span
                className="lv-av"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  fontSize: '12px',
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
                    fontSize: '14px',
                    display: 'block',
                    fontWeight: 600,
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                    color: '#131A2B',
                  }}
                >
                  {person.n}
                </b>
                <small
                  style={{
                    fontSize: '12.5px',
                    color: '#697187',
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  }}
                >
                  {person.s}
                </small>
              </div>
              {/* Tag: .lv-p-tag */}
              <span
                className="lv-p-tag"
                style={{
                  fontSize: '11.5px',
                  fontWeight: 600,
                  color: '#C2410C',
                  background: '#FFF1E4',
                  padding: '4px 9px',
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
                borderBottom: index < content.todos!.length - 1 ? '1px solid #E7E9F1' : 'none',
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
                  background: todo.done ? '#E6F8F0' : '#FFF1E4',
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: '15px',
                    height: '15px',
                    stroke: todo.done ? '#1B9A6C' : '#F97316',
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
                    color: '#131A2B',
                  }}
                >
                  {todo.t}
                </b>
                <small
                  style={{
                    fontSize: '12.5px',
                    color: '#697187',
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
                    color: '#1B9A6C',
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
            background: '#FFF8F2',
            border: '1px solid #FBDCC0',
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
              color: '#131A2B',
            }}
          >
            {content.pl.tx}
          </div>
          {/* Action button */}
          {content.pl.act && (
            <button
              className="lv-pl-btn"
              onClick={() => onAction?.(content.pl!.act)}
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
              {content.pl.act}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
