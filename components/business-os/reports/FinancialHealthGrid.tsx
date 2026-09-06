'use client';

import { CheckCircle2, FileText, AlertCircle, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

interface HealthMetric {
  value: string;
  subtitle: string;
  status: 'success' | 'warning' | 'danger';
}

interface FinancialHealthGridProps {
  successRate: HealthMetric;
  collectionRate: HealthMetric;
  outstanding: HealthMetric;
  refundRate: HealthMetric;
}

export function FinancialHealthGrid({
  successRate,
  collectionRate,
  outstanding,
  refundRate
}: FinancialHealthGridProps) {
  const { language } = useLanguage();
  const isRTL = language === 'he';

  const labels: Record<string, Record<string, string>> = {
    successRate: {
      en: 'Success Rate',
      es: 'Tasa de Éxito',
      he: 'שיעור הצלחה'
    },
    collectionRate: {
      en: 'Collection Rate',
      es: 'Tasa de Cobro',
      he: 'שיעור גביה'
    },
    outstanding: {
      en: 'Late Payments',
      es: 'Pagos Atrasados',
      he: 'פיגור בתשלום'
    },
    refundRate: {
      en: 'Refund Rate',
      es: 'Tasa de Reembolso',
      he: 'שיעור החזרים'
    },
    title: {
      en: 'Financial Health',
      es: 'Salud Financiera',
      he: 'בריאות פיננסית'
    }
  };

  const getLabel = (key: string) => labels[key]?.[language] || labels[key]?.en || key;

  const getMetricColor = (key: string) => {
    switch (key) {
      case 'successRate':
        return {
          border: 'border-emerald-400 dark:border-emerald-500',
          accent: 'bg-emerald-500',
          dot: 'bg-emerald-500',
          text: 'text-emerald-600 dark:text-emerald-400',
          value: 'text-emerald-600 dark:text-emerald-400'
        };
      case 'collectionRate':
        return {
          border: 'border-blue-400 dark:border-blue-500',
          accent: 'bg-blue-500',
          dot: 'bg-blue-500',
          text: 'text-blue-600 dark:text-blue-400',
          value: 'text-blue-600 dark:text-blue-400'
        };
      case 'outstanding':
        return {
          border: 'border-orange-400 dark:border-orange-500',
          accent: 'bg-orange-500',
          dot: 'bg-orange-500',
          text: 'text-orange-600 dark:text-orange-400',
          value: 'text-orange-600 dark:text-orange-400'
        };
      case 'refundRate':
        return {
          border: 'border-purple-400 dark:border-purple-500',
          accent: 'bg-purple-500',
          dot: 'bg-purple-500',
          text: 'text-purple-600 dark:text-purple-400',
          value: 'text-purple-600 dark:text-purple-400'
        };
      default:
        return {
          border: 'border-gray-400 dark:border-gray-500',
          accent: 'bg-gray-500',
          dot: 'bg-gray-500',
          text: 'text-gray-600 dark:text-gray-400',
          value: 'text-gray-600 dark:text-gray-400'
        };
    }
  };

  const metrics = [
    { key: 'successRate', data: successRate, icon: CheckCircle2 },
    { key: 'collectionRate', data: collectionRate, icon: FileText },
    { key: 'outstanding', data: outstanding, icon: AlertCircle },
    { key: 'refundRate', data: refundRate, icon: RotateCcw }
  ];

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

      {/* Stats Grid - Copied from PaymentTransactionList pattern */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map(({ key, data, icon: Icon }) => {
          const colors = getMetricColor(key);

          return (
            <div
              key={key}
              className={`p-4 bg-[var(--v2-surface)] border-2 transition-all duration-200 ${colors.border}`}
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                <span className={`text-xs font-semibold ${colors.text} uppercase tracking-wider`}>
                  {getLabel(key)}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <Icon className={`w-4 h-4 ${colors.text}`} />
                <span className={`text-2xl font-bold ${colors.value}`}>
                  {data.value}
                </span>
              </div>
              <div className="text-xs text-[var(--v2-text-muted)] mt-1">
                {data.subtitle}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
