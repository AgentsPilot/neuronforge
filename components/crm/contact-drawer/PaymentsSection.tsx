'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt, CreditCard, Plus, DollarSign, Calendar, ExternalLink, FileText, RotateCcw } from 'lucide-react';
import { RefundModal } from '@/components/payments/RefundModal';
import { buildMoneyItems, totalMoney, type MoneyEntry, type MoneyItem } from '@/lib/payments/moneyItems';
import { buildEntryActions } from '@/lib/payments/entryActions';
import { MoneyDetailDrawer } from '@/components/payments/MoneyDetailDrawer';
import { MoneyRow } from '@/components/payments/MoneyRow';
import type { SessionCardData } from './types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from '../CollapsibleSection';

interface PaymentTransaction {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  payment_method: string;
  description: string;
  created_at: string;
  stripe_payment_intent_id?: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'refunded' | 'partially_refunded';
  /** Derived from the invoice's payments by trigger. */
  refunded_amount?: number | null;
  due_date?: string;
  created_at: string;
  line_items?: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
}

interface PaymentsSectionProps {
  contactId: string;
  contactName: string;
  contactEmail?: string;
  /**
   * The contact's bookings, so each money row can be headed by the session it
   * paid for. Already loaded by the drawer — passed in rather than refetched.
   */
  sessions?: SessionCardData[];
  t: (key: string) => string;
  isRTL: boolean;
  language?: string;
  isLoading?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  onCreateInvoice?: () => void;
  onInvoiceCreated?: () => void;
}

const INVOICE_STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  draft: { color: 'text-slate-500', bg: 'bg-slate-500/10' },
  sent: { color: 'text-blue-500', bg: 'bg-blue-500/10' },
  paid: { color: 'text-green-500', bg: 'bg-green-500/10' },
  overdue: { color: 'text-red-500', bg: 'bg-red-500/10' },
  cancelled: { color: 'text-gray-500', bg: 'bg-gray-500/10' },
  refunded: { color: 'text-orange-500', bg: 'bg-orange-500/10' },
  partially_refunded: { color: 'text-amber-500', bg: 'bg-amber-500/10' }
};

const PAYMENT_STATUS_STYLES = {
  pending: { color: 'text-amber-500', bg: 'bg-amber-500/10' },
  completed: { color: 'text-green-500', bg: 'bg-green-500/10' },
  succeeded: { color: 'text-green-500', bg: 'bg-green-500/10' },
  failed: { color: 'text-red-500', bg: 'bg-red-500/10' },
  refunded: { color: 'text-gray-500', bg: 'bg-gray-500/10' }
};

export function PaymentsSection({
  contactId,
  contactName,
  contactEmail,
  sessions = [],
  t,
  isRTL,
  language,
  isLoading = false,
  isOpen,
  onToggle,
  onCreateInvoice,
  onInvoiceCreated
}: PaymentsSectionProps) {
  const router = useRouter();

  /**
   * The invoice being refunded. This section was entirely read-only — every row
   * navigated away to the reports page — so a refund could only be reached from
   * a booking, and an invoice with no booking could not be refunded from the
   * drawer at all.
   */
  const [refundTarget, setRefundTarget] = useState<Invoice | null>(null);
  /** The money row whose full detail is open. */
  const [detail, setDetail] = useState<MoneyItem | null>(null);
  /** A refund the processor or the ledger refused. */
  const [refundError, setRefundError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);

  /**
   * One list, grouped by booking.
   *
   * This had Invoices and Payments as separate sub-tabs, which showed a paid
   * invoice twice — once as an invoice and again as the payment that settled it
   * — and asked the reader to work out they were the same ₪200. It also posed a
   * question nobody has: the owner wants to know whether Sarah's session has
   * been paid for, not whether that is a transaction or an invoice.
   *
   * `buildMoneyItems` does the grouping and is unit-tested, including the case
   * this merge could get badly wrong: counting the same money twice.
   */
  const moneyItems = useMemo(
    () =>
      buildMoneyItems({
        invoices,
        transactions: payments as unknown as Parameters<typeof buildMoneyItems>[0]['transactions'],
        bookings: sessions.map(session => ({
          id: session.booking.id,
          // Products have no time slot, so they fall back to their order date.
          title: session.booking.service?.service_name || t('crm.session') || 'Session',
          startTime: session.booking.start_time ?? session.booking.created_at ?? null,
          contactId,
        })),
        standaloneLabel: t('payments.payment') || 'Payment',
      }),
    [invoices, payments, sessions, contactId, t]
  );

  const totals = useMemo(() => totalMoney(moneyItems), [moneyItems]);

  // Fetch invoices
  const fetchInvoices = async () => {
    setLoadingInvoices(true);
    try {
      const response = await fetch(`/api/payments/invoices?contact_id=${contactId}`);
      const data = await response.json();
      if (data.success) {
        setInvoices(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch invoices:', error);
    } finally {
      setLoadingInvoices(false);
    }
  };

  // Fetch payments
  const fetchPayments = async () => {
    setLoadingPayments(true);
    try {
      const response = await fetch(`/api/payments/transactions?contact_id=${contactId}`);
      const data = await response.json();
      if (data.success) {
        setPayments(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch payments:', error);
    } finally {
      setLoadingPayments(false);
    }
  };

  // Load data when section opens or tab changes
  const handleToggle = (open: boolean) => {
    onToggle?.(open);
  };

  // Fetch data when section opens or active tab changes
  // Both sources, because the list is one list. Fetching per tab is what made
  // the totals unaddable before — each half only knew about itself.
  useEffect(() => {
    if (!isOpen) return;
    if (invoices.length === 0) fetchInvoices();
    if (payments.length === 0) fetchPayments();
  }, [isOpen]);

  // Refresh data when onInvoiceCreated is called
  useEffect(() => {
    if (onInvoiceCreated && isOpen) {
      fetchInvoices();
      fetchPayments();
    }
  }, [onInvoiceCreated]);


  /**
   * The same actions as the reports list. Duplicating the CALLBACKS but not the
   * behaviour: both call the same endpoints, so an invoice sent from the drawer
   * and one sent from reports do exactly the same thing.
   */
  const entryHandlers = buildEntryActions({
    refresh: async () => {
      await fetchInvoices();
      await fetchPayments();
    },
    t,
    onRefund: (entry: MoneyEntry) => {
      const target = invoices.find(i => i.id === entry.invoiceId);
      if (target) setRefundTarget(target);
    },
  });

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat(language || 'en', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(language || 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const translatePaymentMethod = (method: string | null): string => {
    if (!method) return '-';

    // If already in Hebrew (contains Hebrew characters), return as-is
    const hebrewRegex = /[\u0590-\u05FF]/;
    if (hebrewRegex.test(method)) return method;

    // Translation map
    const translations: Record<string, Record<string, string>> = {
      he: {
        'card': 'כרטיס אשראי',
        'credit_card': 'כרטיס אשראי',
        'debit_card': 'כרטיס חיוב',
        'bank_transfer': 'העברה בנקאית',
        'wire_transfer': 'העברה בנקאית',
        'bit': 'ביט',
        'paypal': 'פייפאל',
        'cash': 'מזומן',
        'check': 'צ\'ק',
        'cheque': 'צ\'ק'
      },
      es: {
        'card': 'Tarjeta',
        'credit_card': 'Tarjeta de crédito',
        'debit_card': 'Tarjeta de débito',
        'bank_transfer': 'Transferencia bancaria',
        'wire_transfer': 'Transferencia bancaria',
        'bit': 'Bit',
        'paypal': 'PayPal',
        'cash': 'Efectivo',
        'check': 'Cheque',
        'cheque': 'Cheque'
      }
    };

    const methodLower = method.toLowerCase();
    const langTranslations = translations[language || 'en'];

    if (langTranslations && langTranslations[methodLower]) {
      return langTranslations[methodLower];
    }

    // Capitalize first letter if no translation found
    return method.charAt(0).toUpperCase() + method.slice(1);
  };

  return (
    <>
      {/* `count` was passed here before and is not a prop this component has,
          so it was silently ignored. `badge` is — and it can say something worth
          reading: what is still owed is the reason to open this section. */}
      <CollapsibleSection
        title={t('crm.drawer.payments') || 'Payments & Invoices'}
        icon={<Receipt className="h-4 w-4" />}
        badge={
          moneyItems.length > 0 && (
            <span className="text-xs text-[var(--v2-text-muted)]">
              {totals.outstanding > 0 ? (
                <span className="text-amber-500">
                  {formatCurrency(totals.outstanding, moneyItems[0].currency)}{' '}
                  {t('payments.outstanding') || 'outstanding'}
                </span>
              ) : (
                <span>{formatCurrency(totals.collected, moneyItems[0].currency)}</span>
              )}
            </span>
          )
        }
        isOpen={isOpen}
        onToggle={handleToggle}
        isRTL={isRTL}
      >
        {/* Tabs */}
        {/* ONE list, grouped by booking.
            Invoices and Payments were separate sub-tabs, which showed a paid
            invoice twice — once as the invoice and again as the payment that
            settled it — and left the reader to work out they were the same
            money. The grouping is in buildMoneyItems, where it is tested. */}
        <div className="space-y-2" dir={isRTL ? 'rtl' : 'ltr'}>
          {loadingInvoices || loadingPayments ? (
            <div className="text-center py-8 text-[var(--v2-text-muted)]">
              <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-2" style={{ borderColor: '#8B5CF6', borderTopColor: 'transparent' }}></div>
              {t('common.loading') || 'Loading...'}
            </div>
          ) : moneyItems.length === 0 ? (
            <div className="text-center py-8 text-[var(--v2-text-muted)]">
              <Receipt className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p className="text-sm">{t('payments.no_money_yet') || 'Nothing billed yet'}</p>
            </div>
          ) : (
            <>
              {/* What the list adds up to. Summed over entries, never rows, so a
                  booking with two invoices is not counted twice. */}
              <div className="flex items-center gap-4 px-1 pb-1 text-xs text-[var(--v2-text-muted)]">
                <span>
                  {t('payments.collected') || 'Collected'}{' '}
                  <b className="text-[var(--v2-text-primary)] tabular-nums">
                    {formatCurrency(totals.collected, moneyItems[0].currency)}
                  </b>
                </span>
                {totals.outstanding > 0 && (
                  <span>
                    {t('payments.outstanding') || 'Outstanding'}{' '}
                    <b className="text-amber-600 tabular-nums">
                      {formatCurrency(totals.outstanding, moneyItems[0].currency)}
                    </b>
                  </span>
                )}
                {totals.refunded > 0 && (
                  <span>
                    {t('payments.refunded') || 'Refunded'}{' '}
                    <b className="text-orange-600 tabular-nums">
                      {formatCurrency(totals.refunded, moneyItems[0].currency)}
                    </b>
                  </span>
                )}
              </div>

              {/* Bookings first, then money that belongs to no appointment.
                  Mixed together they read as invoices floating loose; labelled,
                  the hierarchy is obvious. */}
              {moneyItems.some(i => i.kind === 'booking') &&
                moneyItems.some(i => i.kind !== 'booking') && (
                  <div className="pt-1 text-[10.5px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
                    {t('payments.section.bookings') || 'Bookings'}
                  </div>
                )}

              {[...moneyItems]
                .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'booking' ? -1 : 1))
                .map((item, index, sorted) => (
                <div key={item.key}>
                  {/* The divider appears exactly once, where the kinds change. */}
                  {index > 0 &&
                    sorted[index - 1].kind === 'booking' &&
                    item.kind !== 'booking' && (
                      <div className="pt-3 pb-1 text-[10.5px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
                        {t('payments.section.other') || 'Not linked to a booking'}
                      </div>
                    )}
                <MoneyRow
                  item={item}
                  t={t}
                  isRTL={isRTL}
                  formatCurrency={formatCurrency}
                  formatDate={formatDate}
                  // The same detail drawer the reports list opens. The row used
                  // to expand here and carry its own ⋯ menu; both moved, and
                  // this section has to follow or the contact's money becomes
                  // read-only while the reports page can act on it.
                  onSelect={() => setDetail(item)}
                />
                </div>
              ))}
            </>
          )}
        </div>
      </CollapsibleSection>

      {refundError && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11.5px] text-red-600">
          <span className="flex-1">{refundError}</span>
          <button onClick={() => setRefundError(null)} className="shrink-0 underline">
            {t('common.dismiss') || 'Dismiss'}
          </button>
        </div>
      )}

      <MoneyDetailDrawer
        item={detail}
        onClose={() => setDetail(null)}
        t={t}
        isRTL={isRTL}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        {...entryHandlers}
      />

      {refundTarget && (
        <RefundModal
          isOpen={!!refundTarget}
          onClose={() => setRefundTarget(null)}
          /* The invoice is named rather than a transaction: the server resolves
             which payment sits behind it, so this section never has to know. */
          invoiceId={refundTarget.id}
          originalAmount={refundTarget.amount}
          currency={refundTarget.currency}
          alreadyRefunded={refundTarget.refunded_amount || 0}
          isRTL={isRTL}
          onSuccess={() => { setRefundTarget(null); fetchInvoices(); }}
          // Without this a refused refund — 409 NOTHING_REMAINING,
          // ACCOUNT_UNRESOLVED, a 502 from the processor — left the dialog open
          // with the spinner off and nothing said, which reads as "nothing
          // happened" rather than "your money did not move".
          onError={message => setRefundError(message)}
        />
      )}
    </>
  );
}
