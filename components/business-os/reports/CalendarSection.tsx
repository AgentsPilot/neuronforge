'use client';

import { Calendar, CalendarCheck, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface CalendarSectionProps {
  upcomingCount: number;
  bookingsThisWeek: number;
  bookingsLastWeek?: number;
  weeklyGoal?: number;
  onViewSchedule: () => void;
}

// Simple circular gauge component
function CalendarGauge({ value, max, color }: { value: number; max: number; color: string }) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative w-24 h-24 sm:w-28 sm:h-28">
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="var(--v2-border)"
          strokeWidth="8"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg sm:text-xl font-bold text-[var(--v2-text-primary)]">
          {Math.round(percentage)}%
        </span>
        <span className="text-[10px] text-[var(--v2-text-muted)]">capacity</span>
      </div>
    </div>
  );
}

export function CalendarSection({
  upcomingCount,
  bookingsThisWeek,
  weeklyGoal = 20,
  onViewSchedule
}: CalendarSectionProps) {
  const { t, language } = useLanguage();
  const isRTL = language === 'he';

  return (
    <div
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-5"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(20, 184, 166, 0.15)' }}
        >
          <Calendar className="w-5 h-5 text-[#14B8A6]" />
        </div>
        <span className="text-sm font-semibold text-[var(--v2-text-secondary)]">
          {t('reports.your_calendar') || 'Your Calendar'}
        </span>
      </div>

      {/* Content: Number + Gauge */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-3xl sm:text-4xl font-bold text-[var(--v2-text-primary)] tracking-tight">
            {upcomingCount}
          </p>
          <p className="text-sm text-[var(--v2-text-muted)] mt-1">
            {t('reports.upcoming_sessions') || 'upcoming sessions'}
          </p>
        </div>
        <CalendarGauge value={bookingsThisWeek} max={weeklyGoal} color="#14B8A6" />
      </div>

      {/* Footer: This Week + Action */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--v2-border)]">
        {/* This Week */}
        <div className="flex items-center gap-1.5 text-[#14B8A6]">
          <CalendarCheck className="w-4 h-4" />
          <span className="text-sm font-medium">{bookingsThisWeek}</span>
          <span className="text-xs text-[var(--v2-text-muted)]">
            {t('reports.this_week') || 'this week'}
          </span>
        </div>

        {/* Action Link */}
        <button
          onClick={onViewSchedule}
          className="flex items-center gap-1 text-sm font-medium text-[#14B8A6] hover:underline"
        >
          {t('reports.view_schedule') || 'View schedule'}
          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
}
