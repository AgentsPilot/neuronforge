'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types (matching mockup .adv-proj)
// ===========================

export interface ProjectionColumn {
  label: string;   // e.g. "If you do nothing"
  value: string;   // e.g. "1 booked of 3"
  subtext?: string; // e.g. "$180 this month"
}

interface BeforeAfterPanelProps {
  left: ProjectionColumn;
  right: ProjectionColumn;
}

// ===========================
// Component (matching mockup .adv-proj exactly)
// CSS Reference from mockup:
// .adv-proj{display:flex;align-items:stretch;gap:0;margin-top:16px;border:1px solid var(--line);border-radius:14px;overflow:hidden}
// .pj{flex:1;padding:13px 15px;min-width:0}
// .pj + .pj{border-left:1px solid var(--line);background:#F6FBF8}
// .pj-lb{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
// .pj-v{font-family:var(--display);font-size:16px;font-weight:600;letter-spacing:-.02em}
// .pj + .pj .pj-v{color:#1B9A6C}
// .pj-s{font-size:12.5px;color:var(--muted);margin-top:3px}
// ===========================

export function BeforeAfterPanel({ left, right }: BeforeAfterPanelProps) {
  const { t, isRTL } = useLanguage();

  return (
    <div
      className="adv-proj"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        marginTop: '16px',
        border: '1px solid var(--v2-border)',
        borderRadius: '14px',
        overflow: 'hidden',
      }}
    >
      {/* Left column: .pj */}
      <div
        className="pj"
        style={{
          flex: 1,
          padding: '13px 15px',
          minWidth: 0,
        }}
      >
        {/* Label: .pj-lb */}
        <div
          className="pj-lb"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--v2-text-secondary)',
            marginBottom: '4px',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
          }}
        >
          {left.label || t('insight.projection.do_nothing') || 'If you do nothing'}
        </div>

        {/* Value: .pj-v */}
        <div
          className="pj-v"
          style={{
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
            fontSize: '16px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--v2-text-primary)',
          }}
        >
          {left.value}
        </div>

        {/* Subtext: .pj-s */}
        {left.subtext && (
          <div
            className="pj-s"
            style={{
              fontSize: '12.5px',
              color: 'var(--v2-text-secondary)',
              marginTop: '3px',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {left.subtext}
          </div>
        )}
      </div>

      {/* Right column: .pj (second) - has green background and green value text */}
      <div
        className="pj"
        style={{
          flex: 1,
          padding: '13px 15px',
          minWidth: 0,
          background: '#F6FBF8',
          borderInlineStart: '1px solid var(--v2-border)',
        }}
      >
        {/* Label: .pj-lb */}
        <div
          className="pj-lb"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--v2-text-secondary)',
            marginBottom: '4px',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
          }}
        >
          {right.label || t('insight.projection.handle_it') || 'If I handle it'}
        </div>

        {/* Value: .pj-v (green for positive outcome) */}
        <div
          className="pj-v"
          style={{
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
            fontSize: '16px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: '#22C58B',
          }}
        >
          {right.value}
        </div>

        {/* Subtext: .pj-s */}
        {right.subtext && (
          <div
            className="pj-s"
            style={{
              fontSize: '12.5px',
              color: 'var(--v2-text-secondary)',
              marginTop: '3px',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {right.subtext}
          </div>
        )}
      </div>
    </div>
  );
}
