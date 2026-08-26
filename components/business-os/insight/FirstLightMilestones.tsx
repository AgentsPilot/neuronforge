'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

export interface Milestone {
  t: string;        // Title (e.g., 'First visitor')
  s: string;        // Status/description (e.g., 'Waiting to go live.')
  w: string;        // When it happened (e.g., 'Day 1')
  lit: boolean;     // Whether achieved
}

interface FirstLightMilestonesProps {
  milestones: Milestone[];
}

// ===========================
// Component (matching mockup .fl)
// ===========================

export function FirstLightMilestones({ milestones }: FirstLightMilestonesProps) {
  const { isRTL, t } = useLanguage();

  if (!milestones.length) {
    return null;
  }

  return (
    <div
      className="fl"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        marginTop: '16px',
        background: '#FFFFFF',
        border: '1px solid #E7E9F1',
        borderRadius: '18px',
        padding: '20px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
      }}
    >
      {/* Header: .fl-h */}
      <div
        className="fl-h"
        style={{
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
          fontSize: '16.5px',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: '#131A2B',
        }}
      >
        {t('insight.firstLight.title') || 'First light'}
      </div>

      {/* Subheader: .fl-s */}
      <div
        className="fl-s"
        style={{
          fontSize: '13px',
          color: '#697187',
          margin: '3px 0 16px',
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
        }}
      >
        {t('insight.firstLight.subtitle') || 'Three things you\'re waiting for'}
      </div>

      {/* Milestone rows: .fl-row */}
      {milestones.map((milestone, index) => (
        <div
          key={index}
          className={`fl-row ${milestone.lit ? 'lit' : ''}`}
          style={{
            display: 'flex',
            gap: '13px',
            alignItems: 'flex-start',
            padding: '13px 0',
            borderBottom: index < milestones.length - 1 ? '1px solid #E7E9F1' : 'none',
            paddingBottom: index === milestones.length - 1 ? 0 : '13px',
          }}
        >
          {/* Tick circle: .fl-tick */}
          <span
            className="fl-tick"
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              border: milestone.lit ? 'none' : '2px dashed #D5D9E4',
              background: milestone.lit ? '#22C58B' : '#fff',
              boxShadow: milestone.lit ? '0 0 0 4px rgba(34,197,139,0.16)' : 'none',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{
                width: '13px',
                height: '13px',
                stroke: '#fff',
                fill: 'none',
                strokeWidth: 3,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                opacity: milestone.lit ? 1 : 0,
              }}
            >
              <path d="M4 12l6 6L20 5" />
            </svg>
          </span>

          {/* Content: .fl-m */}
          <div className="fl-m" style={{ flex: 1, minWidth: 0 }}>
            <b
              style={{
                fontSize: '14.5px',
                fontWeight: 600,
                display: 'block',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                color: '#131A2B',
              }}
            >
              {milestone.t}
            </b>
            <small
              style={{
                fontSize: '13px',
                color: milestone.lit ? '#1B9A6C' : '#697187',
                display: 'block',
                marginTop: '1px',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {milestone.s}
            </small>
          </div>

          {/* When: .fl-when */}
          {milestone.w && (
            <span
              className="fl-when"
              style={{
                fontSize: '11.5px',
                color: '#8A93A8',
                whiteSpace: 'nowrap',
                paddingTop: '2px',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {milestone.w}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
