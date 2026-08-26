'use client';

import { Banknote, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface RevenueSectionProps {
  revenue30d: number;
  revenueThisWeek: number;
  revenueLastWeek: number;
  monthlyGoal?: number;
  pendingAmount?: number;
  onViewTransactions: () => void;
}

// Simple circular gauge component
function RevenueGauge({ value, max, color }: { value: number; max: number; color: string }) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const circumference = 2 * Math.PI * 40; // radius = 40
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative w-24 h-24 sm:w-28 sm:h-28">
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="var(--v2-border)"
          strokeWidth="8"
        />
        {/* Progress circle */}
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
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg sm:text-xl font-bold text-[var(--v2-text-primary)]">
          {Math.round(percentage)}%
        </span>
        <span className="text-[10px] text-[var(--v2-text-muted)]">of goal</span>
      </div>
    </div>
  );
}

export function RevenueSection({
  revenue30d,
  revenueThisWeek,
  revenueLastWeek,
  monthlyGoal = 10000,
  onViewTransactions
}: RevenueSectionProps) {
  const { t, formatCurrency, language } = useLanguage();
  const isRTL = language === 'he';

  const weekDiff = revenueThisWeek - revenueLastWeek;
  const isPositive = weekDiff >= 0;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

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
          style={{ backgroundColor: 'rgba(34, 197, 139, 0.15)' }}
        >
          <Banknote className="w-5 h-5 text-[#22C58B]" />
        </div>
        <span className="text-sm font-semibold text-[var(--v2-text-secondary)]">
          {t('reports.revenue') || 'Revenue'}
        </span>
      </div>

      {/* Content: Number + Gauge */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-3xl sm:text-4xl font-bold text-[var(--v2-text-primary)] tracking-tight">
            {formatCurrency(revenue30d, { showFree: false })}
          </p>
          <p className="text-sm text-[var(--v2-text-muted)] mt-1">
            {t('reports.this_month') || 'this month'}
          </p>
        </div>
        <RevenueGauge value={revenue30d} max={monthlyGoal} color="#22C58B" />
      </div>

      {/* Footer: Trend + Action */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--v2-border)]">
        {/* Weekly Trend */}
        <div className={`flex items-center gap-1.5 ${isPositive ? 'text-[#22C58B]' : 'text-red-500'}`}>
          <TrendIcon className="w-4 h-4" />
          <span className="text-sm font-medium">
            {isPositive ? '+' : ''}{formatCurrency(weekDiff, { showFree: false })}
          </span>
          <span className="text-xs text-[var(--v2-text-muted)]">
            {t('reports.from_last_week') || 'from last week'}
          </span>
        </div>

        {/* Action Link */}
        <button
          onClick={onViewTransactions}
          className="flex items-center gap-1 text-sm font-medium text-[#22C58B] hover:underline"
        >
          {t('reports.view_transactions') || 'View transactions'}
          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
}
