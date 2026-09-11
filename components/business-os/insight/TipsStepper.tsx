'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

export interface Tip {
  at: string;       // Which station/gap this tip relates to
  n: number;        // Tip number badge
  t: string;        // Title (e.g., "One thing I'd do")
  s: string;        // Suggestion text
}

interface TipsStepperProps {
  tips: Tip[];
  onSelectTip?: (tip: Tip) => void;
}

// ===========================
// Component (matching mockup .lv-tips)
// ===========================

export function TipsStepper({ tips, onSelectTip }: TipsStepperProps) {
  const { isRTL, t } = useLanguage();
  const [currentIndex, setCurrentIndex] = useState(0);

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
      }}
    >
      {/* Orb: .lv-orb */}
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
        }}
      />

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
      `}</style>
    </div>
  );
}
