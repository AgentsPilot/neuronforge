'use client';

import { AlertCircle } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

export interface ConfidenceThreshold {
  current: number;
  needed: number;
  metric: string;
  note?: string;
}

interface ConfidenceBarProps {
  threshold: ConfidenceThreshold;
  accentColor?: string;
}

// ===========================
// Component
// ===========================

export function ConfidenceBar({ threshold, accentColor = '#F59E0B' }: ConfidenceBarProps) {
  const { t, isRTL } = useLanguage();

  const { current, needed, metric, note } = threshold;
  const progress = Math.min((current / needed) * 100, 100);
  const isComplete = current >= needed;

  // Don't render if we have enough data
  if (isComplete) {
    return null;
  }

  // Get localized metric name
  const getMetricLabel = () => {
    const key = `insight.metric.${metric}`;
    const translated = t(key);
    return translated !== key ? translated : metric.replace(/_/g, ' ');
  };

  // Build the explanation note
  const getExplanationNote = () => {
    if (note) return note;
    return t('insight.confidence.note', { needed: String(needed), metric: getMetricLabel() }) ||
      `I need about ${needed} ${getMetricLabel()} before I'd trust what this is telling me`;
  };

  return (
    <div
      className="rounded-xl"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        padding: '14px 18px',
        background: 'rgba(245, 158, 11, 0.06)',
        border: '1px solid rgba(245, 158, 11, 0.2)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle
          className="w-4 h-4 flex-shrink-0"
          style={{ color: accentColor }}
          strokeWidth={2}
        />
        <span
          className="text-[13px] font-semibold"
          style={{
            color: accentColor,
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
          }}
        >
          {t('insight.confidence.title') || 'Not enough data yet'}
        </span>
      </div>

      {/* Progress Bar */}
      <div
        className="relative w-full h-2 rounded-full mb-3 overflow-hidden"
        style={{ background: 'rgba(245, 158, 11, 0.15)' }}
      >
        <div
          className="absolute top-0 h-full rounded-full transition-all duration-500"
          style={{
            [isRTL ? 'right' : 'left']: 0,
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${accentColor}80, ${accentColor})`,
          }}
        />
        {/* Threshold marker */}
        <div
          className="absolute top-0 w-0.5 h-full"
          style={{
            [isRTL ? 'right' : 'left']: '100%',
            transform: 'translateX(-50%)',
            background: accentColor,
            opacity: 0.5,
          }}
        />
      </div>

      {/* Progress Text */}
      <div className="flex items-center justify-between text-[12px] mb-2">
        <span
          className="font-medium"
          style={{
            color: accentColor,
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
          }}
        >
          {current} {getMetricLabel()}
        </span>
        <span
          className="text-[var(--v2-text-muted)]"
          style={{
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
          }}
        >
          {t('insight.confidence.progress', { current: String(current), needed: String(needed) }) ||
            `${current} of ${needed}`}
        </span>
      </div>

      {/* Explanation */}
      <p
        className="text-[12px] text-[var(--v2-text-muted)]"
        style={{
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : 'inherit',
          lineHeight: 1.5,
        }}
      >
        {getExplanationNote()}
      </p>
    </div>
  );
}
