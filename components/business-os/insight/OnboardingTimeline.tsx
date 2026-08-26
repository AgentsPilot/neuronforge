'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { MaturityLevel } from '@/hooks/useInsights';

// ===========================
// Types
// ===========================

interface OnboardingTimelineProps {
  accountAgeDays: number;
  maturityLevel: MaturityLevel;
  litVectors: number;
}

interface TimelineStage {
  day: number;
  labelKey: string;
  sublabelKey: string;
  maturityLevels: MaturityLevel[];
}

// ===========================
// Timeline Configuration (matching mockup .tl)
// ===========================

const TIMELINE_STAGES: TimelineStage[] = [
  {
    day: 1,
    labelKey: 'timeline.stage.day1',
    sublabelKey: 'timeline.stage.day1.sub',
    maturityLevels: ['cold_start'],
  },
  {
    day: 4,
    labelKey: 'timeline.stage.day4',
    sublabelKey: 'timeline.stage.day4.sub',
    maturityLevels: ['cold_start', 'early'],
  },
  {
    day: 18,
    labelKey: 'timeline.stage.day18',
    sublabelKey: 'timeline.stage.day18.sub',
    maturityLevels: ['early', 'running'],
  },
  {
    day: 60,
    labelKey: 'timeline.stage.day60',
    sublabelKey: 'timeline.stage.day60.sub',
    maturityLevels: ['running'],
  },
  {
    day: 90,
    labelKey: 'timeline.stage.day90',
    sublabelKey: 'timeline.stage.day90.sub',
    maturityLevels: ['mature'],
  },
];

// ===========================
// Component (matching mockup .tl)
// ===========================

export function OnboardingTimeline({
  accountAgeDays,
  maturityLevel,
  litVectors,
}: OnboardingTimelineProps) {
  const { t, isRTL } = useLanguage();

  // Find current stage
  const currentStageIndex = TIMELINE_STAGES.findIndex((stage, index) => {
    const nextStage = TIMELINE_STAGES[index + 1];
    if (!nextStage) return true; // Last stage
    return accountAgeDays < nextStage.day;
  });

  // Get stage status
  const getStageStatus = (index: number): 'done' | 'on' | 'upcoming' => {
    if (index < currentStageIndex) return 'done';
    if (index === currentStageIndex) return 'on';
    return 'upcoming';
  };

  return (
    <div
      className="tl"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: '#FFFFFF',
        border: '1px solid #E7E9F1',
        borderRadius: '18px',
        padding: '18px 16px 14px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
      }}
    >
      {/* Header: .tl-h */}
      <div
        className="tl-h"
        style={{
          fontSize: '11.5px',
          fontWeight: 600,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: '#697187',
          marginBottom: '14px',
          paddingLeft: '2px',
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
        }}
      >
        {t('timeline.header') || 'Tap through the first three months'}
      </div>

      {/* Timeline row: .tl-row */}
      <div
        className="tl-row"
        style={{
          display: 'flex',
          position: 'relative',
        }}
      >
        {/* Connection line: .tl-row::before */}
        <div
          style={{
            content: '""',
            position: 'absolute',
            [isRTL ? 'right' : 'left']: '11%',
            top: '11px',
            height: '2px',
            width: '78%',
            background: '#E7E9F1',
          }}
        />

        {/* Stages: .tl-n */}
        {TIMELINE_STAGES.map((stage, index) => {
          const status = getStageStatus(index);
          const statusClass = status === 'on' ? 'on' : status === 'done' ? 'done' : '';

          return (
            <div
              key={stage.day}
              className={`tl-n ${statusClass}`}
              style={{
                flex: 1,
                position: 'relative',
                textAlign: 'center',
                paddingTop: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '9px',
              }}
            >
              {/* Dot: .tl-dot */}
              <span
                className="tl-dot"
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: status === 'on'
                    ? 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)'
                    : '#FFFFFF',
                  border: status === 'on'
                    ? 'none'
                    : status === 'done'
                    ? '2px solid #F9C79A'
                    : '2px solid #E7E9F1',
                  position: 'relative',
                  zIndex: 1,
                  transition: '0.25s',
                  display: 'grid',
                  placeItems: 'center',
                  boxShadow: status === 'on'
                    ? '0 0 0 4px rgba(249,115,22,0.16)'
                    : 'none',
                }}
              >
                {/* Inner dot: .tl-dot i */}
                <i
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: status === 'on'
                      ? '#FFFFFF'
                      : status === 'done'
                      ? '#F9C79A'
                      : '#E7E9F1',
                    transition: '0.25s',
                    display: 'block',
                  }}
                />
              </span>

              {/* Text: .tl-tx */}
              <span className="tl-tx">
                <b
                  style={{
                    display: 'block',
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    letterSpacing: '-0.01em',
                    color: status === 'on' ? '#C2410C' : '#131A2B',
                  }}
                >
                  {t(stage.labelKey) || `Day ${stage.day}`}
                </b>
                <small
                  style={{
                    display: 'block',
                    fontSize: '11.5px',
                    color: '#697187',
                    marginTop: '1px',
                    lineHeight: 1.35,
                    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  }}
                >
                  {t(stage.sublabelKey) || 'Nothing live'}
                </small>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
