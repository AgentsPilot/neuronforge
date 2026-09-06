'use client';

/**
 * The money page: invoices and the payments that settle them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MOVED, NOT REBUILT.
 *
 * This is the `money` half of the Reports page, lifted out unchanged — the same
 * controls, the same classes, the same `MoneyList`. Only two things differ, and
 * both are consequences of it becoming its own route rather than choices:
 * the header names Payments instead of Reports, and the controls are no longer
 * wrapped in `viewMode === 'money' &&`, because there is no other view to guard
 * against.
 *
 * `MoneyList` already collapsed invoices and transactions into one list — a paid
 * invoice used to appear twice, once as the invoice and again as the payment
 * that settled it, with no way to add the two totals. Unchanged here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from 'react';
import { Search, Download, Plus, Receipt, FileSpreadsheet } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { MoneyList } from '@/components/payments/MoneyList';
import { InvoiceModal } from '@/components/payments/InvoiceModal';
import { LedgerExportModal } from '@/components/payments/LedgerExportModal';
import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

interface PaymentsViewProps {
  /** Row to scroll to and highlight, from `?invoice=` or `?transaction=`. */
  highlightId?: string | null;
  /** Open the invoice composer immediately, from `?action=create`. */
  openCreate?: boolean;
}

export function PaymentsView({ highlightId = null, openCreate = false }: PaymentsViewProps) {
  const { t } = useLanguage();

  const [searchQuery, setSearchQuery] = useState('');
  /** The money list's own actions, so Export can sit in the page header. */
  const [moneyApi, setMoneyApi] = useState<{ exportCsv: () => void } | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(openCreate);
  const [showLedgerExport, setShowLedgerExport] = useState(false);
  const [invoiceListKey, setInvoiceListKey] = useState(0);

  // `?action=create` can arrive after mount — the chat pushes this route with
  // the flag set — so the modal follows the prop rather than only seeding from it.
  useEffect(() => {
    if (openCreate) setShowInvoiceModal(true);
  }, [openCreate]);

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]">
      <div className={`${PAGE_CONTAINER} py-4 sm:py-6 space-y-4`}>

        {/* Page Header - Compact */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(34, 197, 139, 0.2)' }}
            >
              {/* The icon the money view has always used, in the colour it has
                  always used — Reports keeps its chart icon in the same green. */}
              <Receipt className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: REPORTS_COLORS.PRIMARY }} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)] truncate">
                {t('nav.payments') || 'Orders'}
              </h1>
              <p className="text-xs text-[var(--v2-text-secondary)] hidden sm:block">
                {t('payments.subtitle') || 'Every order, and the money that settles it'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            {/* Search Input */}
            <div className="relative hidden md:block">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
              <input
                type="text"
                placeholder={t('payments.search_money_placeholder') || 'Search bookings and invoices...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10 pe-4 py-2 w-48 lg:w-64 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[#22C58B] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
            </div>

            {/* Two exports, deliberately, because they answer different
                questions. This one saves WHAT IS ON SCREEN — the rows loaded,
                filtered as the user filtered them. It stays exactly as it was. */}
            {moneyApi && (
              <button
                onClick={() => moneyApi.exportCsv()}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-border)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                title={t('payments.export.all_tooltip') || 'Export'}
              >
                <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">{t('payments.bulk.export') || 'Export'}</span>
              </button>
            )}

            {/* And this one builds the accountant's file for a whole period,
                server-side. Reachable from here as well as from Reports, so
                there is one answer to "how do I get this to my accountant"
                wherever the question is asked. */}
            <button
              onClick={() => setShowLedgerExport(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-border)] transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('ledger.export_title')}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden lg:inline">{t('ledger.export_title')}</span>
            </button>

            <button
              onClick={() => setShowInvoiceModal(true)}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-[#22C58B] text-xs sm:text-sm font-medium border border-[#22C58B] bg-[#22C58B]/10 hover:bg-[#22C58B]/20 transition-all whitespace-nowrap"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">{t('payments.create_invoice')}</span>
              <span className="sm:hidden">{t('payments.create_invoice')}</span>
            </button>
          </div>
        </div>

        {/* Mobile Search Bar */}
        <div className="md:hidden relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
          <input
            type="text"
            placeholder={t('payments.search_placeholder') || 'Search transactions...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ps-10 pe-4 py-2 w-full bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[#22C58B] transition-all"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          />
        </div>

        {/* Transactions / Invoices view */}
        <div
          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <MoneyList
            searchQuery={searchQuery}
            highlightId={highlightId}
            refreshKey={invoiceListKey}
            onReady={setMoneyApi}
          />
        </div>
      </div>

      <LedgerExportModal
        isOpen={showLedgerExport}
        onClose={() => setShowLedgerExport(false)}
      />

      {/* Invoice Modal */}
      <InvoiceModal
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
        onSave={() => {
          setShowInvoiceModal(false);
          // Refresh the invoice list
          setInvoiceListKey(prev => prev + 1);
        }}
      />
    </div>
  );
}
