'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface GrowthGraphProps {
  revenue: number;
  bookings: number;
  contacts: number;
  loading?: boolean;
}

// Simple bar representation for each metric
function MetricBar({
  label,
  value,
  formattedValue,
  maxValue,
  color,
  trend
}: {
  label: string;
  value: number;
  formattedValue: string;
  maxValue: number;
  color: string;
  trend: 'up' | 'down' | 'neutral';
}) {
  const percentage = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-[var(--v2-text-muted)]';

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--v2-text-secondary)] truncate">{label}</span>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-[var(--v2-text-primary)]">{formattedValue}</span>
          <TrendIcon className={`w-3 h-3 ${trendColor}`} />
        </div>
      </div>
      <div className="h-2 bg-[var(--v2-border)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(percentage, 5)}%`,
            backgroundColor: color
          }}
        />
      </div>
    </div>
  );
}

export function GrowthGraph({ revenue, bookings, contacts, loading }: GrowthGraphProps) {
  const { language, formatCurrency } = useLanguage();
  const isRTL = language === 'he';

  const labels: Record<string, Record<string, string>> = {
    revenue: {
      en: 'Revenue',
      es: 'Ingresos',
      he: 'הכנסות'
    },
    bookings: {
      en: 'Bookings',
      es: 'Reservas',
      he: 'הזמנות'
    },
    contacts: {
      en: 'Network',
      es: 'Red',
      he: 'רשת'
    },
    title: {
      en: 'This Month',
      es: 'Este Mes',
      he: 'החודש'
    }
  };

  const getLabel = (key: string) => labels[key]?.[language] || labels[key]?.en || key;

  // Calculate max values for relative bar sizing
  // Using reasonable thresholds for a small business
  const revenueMax = Math.max(revenue, 5000); // $5k baseline
  const bookingsMax = Math.max(bookings, 30); // 30 bookings baseline
  const contactsMax = Math.max(contacts, 100); // 100 contacts baseline

  // Determine trends (in real app, would compare to previous period)
  // For now, use simple heuristics
  const revenueTrend: 'up' | 'down' | 'neutral' = revenue > 1000 ? 'up' : revenue > 0 ? 'neutral' : 'down';
  const bookingsTrend: 'up' | 'down' | 'neutral' = bookings > 10 ? 'up' : bookings > 0 ? 'neutral' : 'down';
  const contactsTrend: 'up' | 'down' | 'neutral' = contacts > 20 ? 'up' : contacts > 0 ? 'neutral' : 'down';

  if (loading) {
    return (
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-3"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="flex items-center gap-4 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex-1">
              <div className="flex justify-between mb-1">
                <div className="h-3 bg-[var(--v2-border)] rounded w-12" />
                <div className="h-3 bg-[var(--v2-border)] rounded w-8" />
              </div>
              <div className="h-2 bg-[var(--v2-border)] rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-3"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center gap-4 sm:gap-6">
        <MetricBar
          label={getLabel('revenue')}
          value={revenue}
          formattedValue={formatCurrency(revenue)}
          maxValue={revenueMax}
          color="#22C58B"
          trend={revenueTrend}
        />
        <MetricBar
          label={getLabel('bookings')}
          value={bookings}
          formattedValue={String(bookings)}
          maxValue={bookingsMax}
          color="#3B82F6"
          trend={bookingsTrend}
        />
        <MetricBar
          label={getLabel('contacts')}
          value={contacts}
          formattedValue={String(contacts)}
          maxValue={contactsMax}
          color="#8B5CF6"
          trend={contactsTrend}
        />
      </div>
    </div>
  );
}
