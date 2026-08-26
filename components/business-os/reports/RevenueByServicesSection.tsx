'use client';

import { Briefcase } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { REPORTS_COLORS, DISPLAY_LIMITS } from '@/lib/business-os/reports/constants';

interface ServiceRevenue {
  service_id: string;
  service_name: string;
  revenue: number;
  count: number;
}

interface RevenueByServicesSectionProps {
  services: ServiceRevenue[];
}

// Simple bar representation for each service (copied from GrowthGraph MetricBar)
function ServiceBar({
  serviceName,
  revenue,
  count,
  formattedRevenue,
  maxValue,
  color,
  percentage,
  getLabel
}: {
  serviceName: string;
  revenue: number;
  count: number;
  formattedRevenue: string;
  maxValue: number;
  color: string;
  percentage: number;
  getLabel: (key: string) => string;
}) {
  const barPercentage = maxValue > 0 ? Math.min((revenue / maxValue) * 100, 100) : 0;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4" style={{ color }} />
          <span className="text-xs text-[var(--v2-text-secondary)] truncate">{serviceName}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-[var(--v2-text-primary)]">{formattedRevenue}</span>
          <span className="text-[10px] text-[var(--v2-text-muted)]">({percentage}%)</span>
        </div>
      </div>
      <div className="h-2 bg-[var(--v2-border)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(barPercentage, 5)}%`,
            backgroundColor: color
          }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--v2-text-muted)]">
        {count} {count === 1 ? getLabel('booking') : getLabel('bookings')}
      </div>
    </div>
  );
}

export function RevenueByServicesSection({
  services
}: RevenueByServicesSectionProps) {
  const { language, formatCurrency } = useLanguage();
  const isRTL = language === 'he';

  const labels: Record<string, Record<string, string>> = {
    title: {
      en: 'Revenue by Service',
      es: 'Ingresos por Servicio',
      he: 'הכנסות לפי שירות'
    },
    noServices: {
      en: 'No service revenue data',
      es: 'Sin datos de ingresos por servicio',
      he: 'אין נתוני הכנסות לפי שירות'
    },
    booking: {
      en: 'booking',
      es: 'reserva',
      he: 'הזמנה'
    },
    bookings: {
      en: 'bookings',
      es: 'reservas',
      he: 'הזמנות'
    }
  };

  const getLabel = (key: string) => labels[key]?.[language] || labels[key]?.en || key;

  // Calculate total and percentages
  const total = services.reduce((sum, s) => sum + s.revenue, 0);
  const maxValue = Math.max(...services.map(s => s.revenue), 1);

  // Sort services by revenue (highest first) and take top services
  const topServices = [...services]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, DISPLAY_LIMITS.MAX_SERVICES);

  if (topServices.length === 0) {
    return (
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-5"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <div className="mb-4">
          <span className="text-sm font-semibold text-[var(--v2-text-secondary)]">
            {getLabel('title')}
          </span>
        </div>
        <div className="text-center py-8 text-sm text-[var(--v2-text-muted)]">
          {getLabel('noServices')}
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-5"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="mb-4">
        <span className="text-sm font-semibold text-[var(--v2-text-secondary)]">
          {getLabel('title')}
        </span>
      </div>

      {/* Service Bars */}
      <div className="space-y-4">
        {topServices.map((service, index) => {
          const percentage = total > 0 ? Math.round((service.revenue / total) * 100) : 0;
          const color = REPORTS_COLORS.SERVICE_PALETTE[index % REPORTS_COLORS.SERVICE_PALETTE.length];

          return (
            <ServiceBar
              key={service.service_id}
              serviceName={service.service_name}
              revenue={service.revenue}
              count={service.count}
              formattedRevenue={formatCurrency(service.revenue, { showFree: false })}
              maxValue={maxValue}
              color={color}
              percentage={percentage}
              getLabel={getLabel}
            />
          );
        })}
      </div>
    </div>
  );
}
