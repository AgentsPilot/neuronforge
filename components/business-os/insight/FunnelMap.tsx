'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

export interface FunnelStation {
  k: string;       // Stage key (e.g., 'lead', 'active_client', 'completed')
  n: string;       // Value (e.g., '11', '—', '$540')
  lb: string;      // Label (e.g., 'Lead', 'Active Client')
  off?: boolean;   // Blueprint state (dashed, not yet live)
  color?: string;  // Stage color from pipeline (e.g., '#94A3B8')
}

export interface FunnelGap {
  k: string;       // Gap identifier (e.g., 'g1', 'g2', 'g3')
  state: 'ok' | 'leak' | 'watch' | 'off';
  lb?: string;     // Optional label (e.g., "I handle these now")
}

export interface GhostProjection {
  t: string;       // Title (e.g., "About 40 people a week...")
  s: string;       // Subtitle
  tag: string;     // Tag (e.g., "My estimate from your area...")
}

interface FunnelMapProps {
  stations: FunnelStation[];
  gaps: FunnelGap[];
  tips?: { at: string; n: number }[];
  selectedKey?: string;
  onSelectNode?: (key: string) => void;
  ghost?: GhostProjection;
}

// ===========================
// Icons (from mockup)
// ===========================

// Icons for known stage types + generic fallback for dynamic pipeline stages
const ICONS: Record<string, JSX.Element> = {
  // Legacy funnel icons
  found: (
    <svg viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </svg>
  ),
  touch: (
    <svg viewBox="0 0 24 24">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  booked: (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </svg>
  ),
  paid: (
    <svg viewBox="0 0 24 24">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  ),
  // CRM pipeline stage icons
  lead: (
    <svg viewBox="0 0 24 24">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  inquiry: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  ),
  intake: (
    <svg viewBox="0 0 24 24">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  ),
  active_client: (
    <svg viewBox="0 0 24 24">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  discovery_call: (
    <svg viewBox="0 0 24 24">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72" />
    </svg>
  ),
  proposal: (
    <svg viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  negotiation: (
    <svg viewBox="0 0 24 24">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  completed: (
    <svg viewBox="0 0 24 24">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  inactive: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <path d="M4.93 4.93l14.14 14.14" />
    </svg>
  ),
  past_client: (
    <svg viewBox="0 0 24 24">
      <path d="M12 2v20M2 12h20" />
    </svg>
  ),
  closed_won: (
    <svg viewBox="0 0 24 24">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
  closed_lost: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  ),
  // Generic fallback icon (user/contact)
  default: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="5" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2" />
    </svg>
  ),
};

// Helper to get icon for a stage (with fallback)
function getStageIcon(stageKey: string): JSX.Element {
  return ICONS[stageKey] || ICONS.default;
}

// ===========================
// Component (matching mockup .lv-map)
// ===========================

export function FunnelMap({
  stations,
  gaps,
  tips = [],
  selectedKey,
  onSelectNode,
  ghost,
}: FunnelMapProps) {
  const { isRTL, t } = useLanguage();

  // Get tip badge for a station/gap
  const getTipBadge = (key: string) => {
    const tip = tips.find((t) => t.at === key);
    return tip ? tip.n : null;
  };

  return (
    <div
      className="lv-map"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: '18px',
        padding: '26px 20px 20px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
      }}
    >
      {/* Flow: .lv-flow */}
      <div
        className="lv-flow"
        style={{
          display: 'flex',
          alignItems: 'stretch',
        }}
      >
        {stations.map((station, index) => (
          <div key={station.k} style={{ display: 'contents' }}>
            {/* Station: .lv-st */}
            <button
              className={`lv-st ${station.off ? 'off' : ''} ${selectedKey === station.k ? 'on' : ''}`}
              onClick={() => onSelectNode?.(station.k)}
              style={{
                flex: '0 0 auto',
                width: '118px',
                textAlign: 'center',
                position: 'relative',
                padding: '14px 6px 12px',
                borderRadius: '15px',
                background: station.off
                  ? 'repeating-linear-gradient(135deg, var(--v2-bg) 0 7px, var(--v2-surface-hover) 7px 8px)'
                  : 'var(--v2-surface)',
                // Longhand only. This carried `border` as well, and React warns
                // on every rerender that mixing the shorthand with borderStyle
                // and borderColor for the same value leads to styling bugs —
                // which is exactly what it did: the shorthand reset style to
                // `solid`, so whether a blueprint station drew dashed depended
                // on the order React happened to apply the two. Selecting a
                // station rerenders, so the warning repeated for every click.
                borderWidth: '1.5px',
                borderStyle: station.off ? 'dashed' : 'solid',
                borderColor: station.off ? 'var(--v2-border)' : (selectedKey === station.k ? '#F97316' : 'var(--v2-border)'),
                boxShadow: selectedKey === station.k ? '0 0 0 3px rgba(249,115,22,0.11)' : 'none',
                transition: '0.3s',
                cursor: 'pointer',
              }}
            >
              {/* Icon: .lv-ic */}
              <span
                className="lv-ic"
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '11px',
                  background: station.off
                    ? 'var(--v2-border)'
                    : station.color
                    ? station.color
                    : 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 9px',
                  boxShadow: station.off ? 'none' : '0 5px 14px -6px rgba(249,115,22,0.7)',
                }}
              >
                <span
                  style={{
                    width: '17px',
                    height: '17px',
                    display: 'block',
                  }}
                >
                  {/* Clone the SVG with proper styles */}
                  <svg
                    viewBox="0 0 24 24"
                    style={{
                      width: '17px',
                      height: '17px',
                      stroke: station.off ? 'var(--v2-text-muted)' : '#fff',
                      fill: 'none',
                      strokeWidth: 2,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                    }}
                  >
                    {getStageIcon(station.k).props.children}
                  </svg>
                </span>
              </span>

              {/* Value: .lv-n */}
              <span
                className="lv-n"
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                  fontSize: '23px',
                  fontWeight: 600,
                  letterSpacing: '-0.03em',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.1,
                  color: station.off ? 'var(--v2-text-muted)' : 'var(--v2-text-primary)',
                  display: 'block',
                }}
              >
                {station.n}
              </span>

              {/* Label: .lv-lb */}
              <span
                className="lv-lb"
                style={{
                  fontSize: '12px',
                  color: 'var(--v2-text-secondary)',
                  marginTop: '3px',
                  lineHeight: 1.3,
                  display: 'block',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {station.lb}
              </span>

              {/* Tip badge: .lv-mk */}
              {getTipBadge(station.k) !== null && (
                <span
                  className="lv-mk"
                  style={{
                    position: 'absolute',
                    top: '-9px',
                    [isRTL ? 'left' : 'right']: '-9px',
                    width: '23px',
                    height: '23px',
                    borderRadius: '50%',
                    background: '#FFB24D',
                    color: '#5A3A05',
                    fontSize: '12px',
                    fontWeight: 700,
                    display: 'grid',
                    placeItems: 'center',
                    boxShadow: '0 3px 9px -2px rgba(255,178,77,0.9)',
                    animation: 'mkPop 0.4s ease-out',
                  }}
                >
                  {getTipBadge(station.k)}
                </span>
              )}
            </button>

            {/* Gap between stations: .lv-gap */}
            {index < gaps.length && (
              <button
                className={`lv-gap ${gaps[index].state} ${selectedKey === gaps[index].k ? 'on' : ''}`}
                onClick={() => onSelectNode?.(gaps[index].k)}
                style={{
                  flex: 1,
                  minWidth: '34px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '0 4px',
                  cursor: 'pointer',
                  position: 'relative',
                  background: 'none',
                  border: 'none',
                }}
              >
                {/* Track: .lv-track */}
                <span
                  className="lv-track"
                  style={{
                    width: '100%',
                    height: gaps[index].state === 'watch' || gaps[index].state === 'off' ? '0' : '3px',
                    borderRadius: '3px',
                    background: gaps[index].state === 'ok'
                      ? '#EAF7F1'
                      : gaps[index].state === 'leak'
                      ? '#FBE5E5'
                      : 'transparent',
                    borderTop: (gaps[index].state === 'watch' || gaps[index].state === 'off')
                      ? `2.5px dotted ${gaps[index].state === 'off' ? '#E0E3EC' : '#C9CEDC'}`
                      : 'none',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Flow dots (only for ok/leak states) */}
                  {(gaps[index].state === 'ok' || gaps[index].state === 'leak') && (
                    <>
                      <i
                        style={{
                          position: 'absolute',
                          top: '-2.5px',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: gaps[index].state === 'ok' ? '#22C58B' : '#F26B6B',
                          animation: 'lvFlow 2.8s linear infinite',
                        }}
                      />
                      {gaps[index].state === 'ok' && (
                        <>
                          <i
                            style={{
                              position: 'absolute',
                              top: '-2.5px',
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: '#22C58B',
                              animation: 'lvFlow 2.8s linear infinite',
                              animationDelay: '0.9s',
                            }}
                          />
                          <i
                            style={{
                              position: 'absolute',
                              top: '-2.5px',
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: '#22C58B',
                              animation: 'lvFlow 2.8s linear infinite',
                              animationDelay: '1.8s',
                            }}
                          />
                        </>
                      )}
                    </>
                  )}
                </span>

                {/* Gap label: .lv-gap-lb */}
                {gaps[index].lb && (
                  <span
                    className="lv-gap-lb"
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      textAlign: 'center',
                      lineHeight: 1.25,
                      color: gaps[index].state === 'leak' ? '#F26B6B' : 'var(--v2-text-secondary)',
                      textDecoration: selectedKey === gaps[index].k ? 'underline' : 'none',
                      textUnderlineOffset: '3px',
                      fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                    }}
                  >
                    {gaps[index].lb}
                  </span>
                )}

                {/* Tip badge on gap: .lv-mk */}
                {getTipBadge(gaps[index].k) !== null && (
                  <span
                    className="lv-mk"
                    style={{
                      position: 'absolute',
                      top: '-2px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '23px',
                      height: '23px',
                      borderRadius: '50%',
                      background: '#FFB24D',
                      color: '#5A3A05',
                      fontSize: '12px',
                      fontWeight: 700,
                      display: 'grid',
                      placeItems: 'center',
                      boxShadow: '0 3px 9px -2px rgba(255,178,77,0.9)',
                      animation: 'mkPop 0.4s ease-out',
                    }}
                  >
                    {getTipBadge(gaps[index].k)}
                  </span>
                )}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Ghost projection: .lv-ghost */}
      {ghost && (
        <div
          className="lv-ghost"
          style={{
            marginTop: '18px',
            border: '1.5px dashed rgba(245, 158, 11, 0.35)',
            background: 'rgba(245, 158, 11, 0.08)',
            borderRadius: '13px',
            padding: '12px 14px',
            display: 'flex',
            gap: '11px',
            alignItems: 'flex-start',
          }}
        >
          <span
            style={{
              width: '16px',
              height: '16px',
              flexShrink: 0,
              marginTop: '2px',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{
                width: '16px',
                height: '16px',
                stroke: '#C09456',
                fill: 'none',
                strokeWidth: 2,
              }}
            >
              <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
            </svg>
          </span>
          <div>
            <b
              style={{
                fontSize: '13.5px',
                fontWeight: 600,
                display: 'block',
                lineHeight: 1.4,
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                color: 'var(--v2-text-primary)',
              }}
            >
              {ghost.t}
            </b>
            <span
              className="lv-gh-tag"
              style={{
                fontSize: '12px',
                color: '#A18B6B',
                marginTop: '3px',
                display: 'block',
                lineHeight: 1.4,
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {ghost.s}
            </span>
            <span
              className="lv-gh-tag"
              style={{
                fontSize: '12px',
                color: '#A18B6B',
                marginTop: '3px',
                display: 'block',
                lineHeight: 1.4,
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {ghost.tag}
            </span>
          </div>
        </div>
      )}

      {/* Legend: .lv-legend */}
      <div
        className="lv-legend"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          marginTop: '20px',
          paddingTop: '15px',
          borderTop: '1px solid var(--v2-border)',
          fontSize: '12px',
          color: 'var(--v2-text-secondary)',
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
        }}
      >
        <span className="lg-k" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <i className="lg-s" style={{ width: '15px', height: '3px', borderRadius: '3px', background: '#22C58B' }} />
          {t('insight.legend.flowing') || 'flowing'}
        </span>
        <span className="lg-k" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <i className="lg-s leak" style={{ width: '15px', height: '3px', borderRadius: '3px', background: '#F26B6B' }} />
          {t('insight.legend.leaking') || 'leaking'}
        </span>
        <span className="lg-k" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <i className="lg-s watch" style={{ width: '15px', height: '0', borderTop: '2.5px dotted #C9CEDC' }} />
          {t('insight.legend.notEnough') || 'not enough to judge'}
        </span>
        <span className="lg-k" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <i className="lg-s mk" style={{ width: '15px', height: '15px', borderRadius: '50%', background: '#FFB24D' }} />
          {t('insight.legend.tip') || 'something I\'d do'}
        </span>
      </div>

      {/* Global keyframes */}
      <style jsx global>{`
        @keyframes lvFlow {
          from { left: -8px; }
          to { left: 100%; }
        }
        @keyframes mkPop {
          from {
            transform: scale(0.4);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
