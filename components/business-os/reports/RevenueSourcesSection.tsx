'use client';

import { CreditCard, FileText } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

/**
 * Income reaches the business through two channels: paid directly at purchase,
 * or invoiced to the client. Bookings are not a third channel — they are the
 * origin of both — so they are deliberately not represented here.
 */
interface RevenueSource {
  type: 'payments' | 'invoices';
  amount: number;
  count: number;
}

interface RevenueSourcesSectionProps {
  payments: RevenueSource;
  /** Invoices carry a paid/outstanding split, since an issued invoice is not yet income. */
  invoices: RevenueSource & { paid: number; outstanding: number };
}

// Simple bar representation for each revenue source (copied from GrowthGraph MetricBar)
function SourceBar({
  icon: Icon,
  label,
  amount,
  count,
  formattedAmount,
  maxValue,
  color,
  percentage,
  getLabel,
  footnote
}: {
  icon: typeof CreditCard;
  label: string;
  amount: number;
  count: number;
  formattedAmount: string;
  maxValue: number;
  color: string;
  percentage: number;
  getLabel: (key: string) => string;
  footnote?: string;
}) {
  const barPercentage = maxValue > 0 ? Math.min((amount / maxValue) * 100, 100) : 0;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color }} />
          <span className="text-xs text-[var(--v2-text-secondary)] truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-[var(--v2-text-primary)]">{formattedAmount}</span>
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
        {count} {count === 1 ? getLabel('item') : getLabel('items')}
        {footnote && <> · {footnote}</>}
      </div>
    </div>
  );
}

export function RevenueSourcesSection({
  payments,
  invoices
}: RevenueSourcesSectionProps) {
  const { language, formatCurrency } = useLanguage();
  const isRTL = language === 'he';

  const labels: Record<string, Record<string, string>> = {
    payments: {
      en: 'Paid directly',
      es: 'Pago directo',
      he: 'תשלום ישיר'
    },
    invoices: {
      en: 'Invoiced',
      es: 'Facturado',
      he: 'חשבוניות'
    },
    title: {
      en: 'How income was collected',
      es: 'Cómo se cobraron los ingresos',
      he: 'איך התקבלה ההכנסה'
    },
    paid: {
      en: 'paid',
      es: 'cobrado',
      he: 'שולם'
    },
    outstanding: {
      en: 'outstanding',
      es: 'por cobrar',
      he: 'ממתין'
    },
    item: {
      en: 'item',
      es: 'elemento',
      he: 'פריט'
    },
    items: {
      en: 'items',
      es: 'elementos',
      he: 'פריטים'
    }
  };

  const getLabel = (key: string) => labels[key]?.[language] || labels[key]?.en || key;

  // Calculate total and percentages
  const total = payments.amount + invoices.amount;
  const maxValue = Math.max(payments.amount, invoices.amount, 1);

  const paymentsPercentage = total > 0 ? Math.round((payments.amount / total) * 100) : 0;
  const invoicesPercentage = total > 0 ? Math.round((invoices.amount / total) * 100) : 0;

  // An issued invoice isn't income until it's paid — spell out the split rather
  // than letting one number imply money that hasn't arrived.
  const invoicesFootnote = invoices.outstanding > 0
    ? `${formatCurrency(invoices.paid, { showFree: false })} ${getLabel('paid')} · ${formatCurrency(invoices.outstanding, { showFree: false })} ${getLabel('outstanding')}`
    : undefined;

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

      {/* Bars */}
      <div className="flex flex-col sm:flex-row items-stretch gap-4 sm:gap-6">
        <SourceBar
          icon={CreditCard}
          label={getLabel('payments')}
          amount={payments.amount}
          count={payments.count}
          formattedAmount={formatCurrency(payments.amount, { showFree: false })}
          maxValue={maxValue}
          color="#22C58B"
          percentage={paymentsPercentage}
          getLabel={getLabel}
        />
        <SourceBar
          icon={FileText}
          label={getLabel('invoices')}
          amount={invoices.amount}
          count={invoices.count}
          formattedAmount={formatCurrency(invoices.amount, { showFree: false })}
          maxValue={maxValue}
          color="#8B5CF6"
          percentage={invoicesPercentage}
          getLabel={getLabel}
          footnote={invoicesFootnote}
        />
      </div>
    </div>
  );
}
