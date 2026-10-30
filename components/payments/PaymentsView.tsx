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
import { useRouter } from 'next/navigation';
import { Download, Plus, Receipt, FileSpreadsheet } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { MoneyList } from '@/components/payments/MoneyList';
import { MoneySearchField } from '@/components/payments/MoneySearchField';
import { businessDayFor } from '@/lib/business-os/businessDay';
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
  const router = useRouter();
  const { t, language } = useLanguage();
  /* The parser speaks these three; anything else reads as English. */
  const searchLanguage = language === 'he' || language === 'es' ? language : 'en';

  const [searchQuery, setSearchQuery] = useState('');

  /*
   * The business's own date, for reading "october" and "last 30 days".
   *
   * The BROWSER's zone, which is the closest thing the client has to the
   * business clock and is right for the overwhelming majority of owners: they
   * are sitting in the timezone they trade in. The ROUTE resolves the real one
   * from `user_preferences` and parses the same string again, so the filter
   * that actually runs is always on the authoritative clock. A traveller would
   * see a chip whose label is a day out from the rows it returns, and the rows
   * are the ones that are right.
   */
  const today = businessDayFor(
    new Date(),
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  ).date;

  /*
   * The vocabulary is no longer listed here.
   *
   * There was a row of example tokens under the box, and the ⊕ panel now shows
   * the same periods as buttons that also report whether they are ON. Keeping
   * both would put two teaching surfaces under one input, and the hint row was
   * the one that could not say what was already applied.
   *
   * `relativePeriods` in the parser's module is where that list lives now, so
   * the picker cannot offer a phrase the reader does not understand.
   */
  /** The money list's own actions, so Export can sit in the page header. */
  const [moneyApi, setMoneyApi] = useState<{
    exportCsv: () => void;
    hasRows: boolean;
    knownEmpty: boolean;
  } | null>(null);

  /*
   * Both exports are switched off when there is nothing to put in the file.
   *
   * They answer different questions, so they read different signals. Export
   * saves WHAT IS ON SCREEN, so an empty view is an empty file. The ledger
   * spans its own date range and ignores this page's search and filter, so it
   * only goes dark when the business genuinely has no money records — never
   * because somebody typed a search term that matched nothing.
   *
   * Both stay live until the list has reported, so neither flickers off and on
   * while the first page loads.
   */
  const canExportView = !moneyApi || moneyApi.hasRows;
  const canExportLedger = !moneyApi || !moneyApi.knownEmpty;
  const [showInvoiceModal, setShowInvoiceModal] = useState(openCreate);
  const [showLedgerExport, setShowLedgerExport] = useState(false);
  /*
   * The view export now FETCHES every matching row before writing the file,
   * rather than serialising the page it already had. That is a round trip, so
   * the button has to say it is working — a download that appears to do nothing
   * gets clicked again, and then twice more.
   */
  const [exportingView, setExportingView] = useState(false);
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
            <MoneySearchField
              className="hidden md:block w-56 lg:w-80"
              value={searchQuery}
              onChange={setSearchQuery}
              today={today}
              placeholder={t('payments.search_money_placeholder') || 'Search bookings and invoices...'}
              language={searchLanguage}
              t={t}
            />

            {/* Two exports, deliberately, because they answer different
                questions. This one saves WHAT IS ON SCREEN — the rows loaded,
                filtered as the user filtered them. It stays exactly as it was. */}
            {moneyApi && (
              <button
                onClick={async () => {
                  setExportingView(true);
                  try {
                    await moneyApi.exportCsv();
                  } finally {
                    setExportingView(false);
                  }
                }}
                disabled={!canExportView || exportingView}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-border)] transition-all disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--v2-surface)] disabled:hover:text-[var(--v2-text-secondary)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                title={
                  canExportView
                    ? t('payments.export.all_tooltip') || 'Export'
                    : t('payments.export.nothing')
                }
              >
                <Download className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${exportingView ? 'animate-pulse' : ''}`} />
                <span className="hidden sm:inline">
                  {exportingView
                    ? t('payments.export.working') || 'Preparing…'
                    : t('payments.bulk.export') || 'Export'}
                </span>
              </button>
            )}

            {/* And this one builds the accountant's file for a whole period,
                server-side. Reachable from here as well as from Reports, so
                there is one answer to "how do I get this to my accountant"
                wherever the question is asked. */}
            <button
              onClick={() => setShowLedgerExport(true)}
              disabled={!canExportLedger}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-border)] transition-all disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--v2-surface)] disabled:hover:text-[var(--v2-text-secondary)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={canExportLedger ? t('ledger.export_title') : t('payments.export.nothing')}
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
        <MoneySearchField
          className="md:hidden"
          value={searchQuery}
          onChange={setSearchQuery}
          today={today}
          placeholder={t('payments.search_placeholder') || 'Search transactions...'}
          language={searchLanguage}
          t={t}
        />

        {/* Transactions / Invoices view */}
        <div
          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <MoneyList
            /*
             * Into the CRM, on the client's own name.
             *
             * `section=payments` and the booking id, so the drawer opens on
             * Payments & Invoices with the order already expanded rather than
             * on Details with a list to hunt through. The CRM page has read
             * these three params since it was built; nothing here is new
             * machinery, it was simply never linked to from the orders page.
             */
            onOpenContact={(contactId, bookingId) => {
              const params = new URLSearchParams({ contact: contactId, section: 'payments' });
              if (bookingId) params.set('booking', bookingId);
              router.push(`/business-os/crm?${params.toString()}`);
            }}
            /*
             * The booking route, which is a DIFFERENT section from the one
             * above. `section=bookings` plus `booking=<id>` is what
             * `BookingsTab` reads as `focusBookingId`: it adds the id to its
             * open set and scrolls the card into view. Sending `payments` here
             * would land the owner on the right client and the wrong tab, with
             * the booking they clicked still to be found by hand.
             */
            onOpenBooking={(contactId, bookingId) => {
              const params = new URLSearchParams({
                contact: contactId,
                section: 'bookings',
                booking: bookingId,
              });
              router.push(`/business-os/crm?${params.toString()}`);
            }}
            searchQuery={searchQuery}
            /* The same `today` the search field reads the string with, so the
               chips it draws and the terms the list acts on cannot describe
               two different spans. */
            today={today}
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
