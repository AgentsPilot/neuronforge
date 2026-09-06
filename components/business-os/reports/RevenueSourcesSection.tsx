'use client';

import { CreditCard, FileText, CalendarClock } from 'lucide-react';
import { useLanguage, type CurrencyCode } from '@/lib/business-os/LanguageContext';

/**
 * Income reaches the business three ways: paid directly at purchase, invoiced to
 * the client, or collected over a payment plan. Bookings are not a fourth — they
 * are the origin of all three — so they are deliberately not represented here.
 *
 * Plans were missing entirely, and every payment was counted as "direct" even
 * when it settled an invoice; the invoices row then had to subtract whatever a
 * payment had already covered, so an invoice paid by card rendered as "1 invoice,
 * 0.00". These three rows now sum to the revenue card above them, which is the
 * only reason a reader would look at them together.
 */
interface RevenueSource {
  type: 'payments' | 'invoices' | 'plans';
  amount: number;
  count: number;
}

/** A source whose money is partly promised: issued, not yet arrived. */
type SplitSource = RevenueSource & { paid: number; outstanding: number };

interface RevenueSourcesSectionProps {
  payments: RevenueSource;
  invoices: SplitSource;
  /**
   * Optional so a caller that has not been updated renders exactly as before —
   * and so a business with no plans shows two bars, not an empty third.
   */
  plans?: SplitSource;
  /**
   * The currency these amounts are in, from the money itself.
   *
   * Without it `formatCurrency` picks a symbol from the interface LANGUAGE —
   * Hebrew means shekels — so a business billing in dollars had its revenue
   * stamped ₪. Optional so an un-updated caller behaves exactly as before.
   */
  currency?: CurrencyCode;
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
  invoices,
  plans,
  currency
}: RevenueSourcesSectionProps) {
  const { language, formatCurrency } = useLanguage();
  /** Money in its own currency, never the reader's. See the `currency` prop. */
  const money = (amount: number | null) =>
    formatCurrency(amount, { showFree: false, currencyOverride: currency });
  const isRTL = language === 'he';

  const labels: Record<string, Record<string, string>> = {
    payments: {
      en: 'Paid directly',
      es: 'Pago directo',
      he: 'תשלום ישיר'
    },
    plans: {
      en: 'Payment plans',
      es: 'Planes de pago',
      he: 'תוכניות תשלום'
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
  const showPlans = Boolean(plans && plans.amount > 0);
  const planAmount = showPlans ? plans!.amount : 0;

  const total = payments.amount + invoices.amount + planAmount;
  const maxValue = Math.max(payments.amount, invoices.amount, planAmount, 1);

  const paymentsPercentage = total > 0 ? Math.round((payments.amount / total) * 100) : 0;
  const invoicesPercentage = total > 0 ? Math.round((invoices.amount / total) * 100) : 0;
  const plansPercentage = total > 0 ? Math.round((planAmount / total) * 100) : 0;

  // An issued invoice isn't income until it's paid — spell out the split rather
  // than letting one number imply money that hasn't arrived.
  const split = (source: SplitSource) =>
    source.outstanding > 0
      ? `${money(source.paid)} ${getLabel('paid')} · ${money(source.outstanding)} ${getLabel('outstanding')}`
      : undefined;

  const invoicesFootnote = split(invoices);

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
          formattedAmount={money(payments.amount)}
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
          formattedAmount={money(invoices.amount)}
          maxValue={maxValue}
          color="#8B5CF6"
          percentage={invoicesPercentage}
          getLabel={getLabel}
          footnote={invoicesFootnote}
        />
        {showPlans && (
          <SourceBar
            icon={CalendarClock}
            label={getLabel('plans')}
            amount={plans!.amount}
            count={plans!.count}
            formattedAmount={money(plans!.amount)}
            maxValue={maxValue}
            color="#D14E97"
            percentage={plansPercentage}
            getLabel={getLabel}
            footnote={split(plans!)}
          />
        )}
      </div>
    </div>
  );
}
