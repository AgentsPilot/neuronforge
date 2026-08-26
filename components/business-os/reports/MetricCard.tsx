'use client';

import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface MetricCardProps {
  icon: LucideIcon;
  iconColor?: string;
  label: string;
  value: string;
  subtitle: string;
  trend?: {
    value: string;
    isPositive: boolean;
    text: string;
  };
  gauge?: {
    percentage: number;
    label: string;
  };
  onAction?: () => void;
  actionLabel?: string;
}

// Simple circular gauge component (copied from RevenueSection)
function RevenueGauge({ value, max, color, label }: { value: number; max: number; color: string; label?: string }) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const circumference = 2 * Math.PI * 40; // radius = 40
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative w-24 h-24 sm:w-28 sm:h-28 overflow-hidden">
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
        {label && (
          <span className="text-[10px] text-[var(--v2-text-muted)]">{label}</span>
        )}
      </div>
    </div>
  );
}

export function MetricCard({
  icon: Icon,
  iconColor = '#22C58B',
  label,
  value,
  subtitle,
  trend,
  gauge,
  onAction,
  actionLabel
}: MetricCardProps) {
  const { language } = useLanguage();
  const isRTL = language === 'he';

  const TrendIcon = trend?.isPositive ? TrendingUp : TrendingDown;

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
          style={{ backgroundColor: `${iconColor}15` }}
        >
          <Icon className="w-5 h-5" style={{ color: iconColor }} />
        </div>
        <span className="text-sm font-semibold text-[var(--v2-text-secondary)]">
          {label}
        </span>
      </div>

      {/* Content: Number + Gauge */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-3xl sm:text-4xl font-bold text-[var(--v2-text-primary)] tracking-tight">
            {value}
          </p>
          <p className="text-sm text-[var(--v2-text-muted)] mt-1">
            {subtitle}
          </p>
        </div>
        {gauge && <RevenueGauge value={gauge.percentage} max={100} color={iconColor} label={gauge.label} />}
      </div>

      {/* Footer: Trend + Action */}
      {(trend || onAction) && (
        <div className="flex items-center justify-between pt-4 border-t border-[var(--v2-border)]">
          {/* Trend */}
          {trend && (
            <div className={`flex items-center gap-1.5 ${trend.isPositive ? 'text-[#22C58B]' : 'text-red-500'}`}>
              <TrendIcon className="w-4 h-4" />
              <span className="text-sm font-medium">
                {trend.isPositive ? '+' : ''}{trend.value}
              </span>
              <span className="text-xs text-[var(--v2-text-muted)]">
                {trend.text}
              </span>
            </div>
          )}

          {/* Action Link */}
          {onAction && actionLabel && (
            <button
              onClick={onAction}
              className="flex items-center gap-1 text-sm font-medium text-[#22C58B] hover:underline"
            >
              {actionLabel}
              <span className="rtl:rotate-180">→</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
