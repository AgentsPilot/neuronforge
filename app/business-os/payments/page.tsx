'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { PaymentTransactionList } from '@/components/payments/PaymentTransactionList';
import { PaymentInvoiceList } from '@/components/payments/PaymentInvoiceList';
import { StripeConnectStatus } from '@/components/payments/StripeConnectStatus';
import { InvoiceModal } from '@/components/payments/InvoiceModal';
import { ArrowLeft, CreditCard, Search, Plus, Download } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// Payments theme color: Amber (#F59E0B / #D97706)
const PAYMENTS_COLOR = '#F59E0B';
const PAYMENTS_GRADIENT = 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)';

type ViewMode = 'transactions' | 'invoices' | 'settings';

export default function PaymentsPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<ViewMode>('transactions');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceListKey, setInvoiceListKey] = useState(0); // To refresh invoice list

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]">
      <BusinessOSHeader />

      {/* Main Content with max-width like dashboard */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">

        {/* Back Button */}
        <button
          onClick={() => router.push('/business-os')}
          className="flex items-center gap-2 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors group"
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          <span className="text-sm font-medium">{t('payments.back_to_dashboard')}</span>
        </button>

        {/* Page Header with amber theme (Payments capability color) */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.2)' }}
            >
              <CreditCard className="w-6 h-6" style={{ color: PAYMENTS_COLOR }} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-[var(--v2-text-primary)]">
                {t('capability.payments.name')}
              </h1>
              <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                {t('payments.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
              <input
                type="text"
                placeholder={t('payments.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10 pe-4 py-2 w-64 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 transition-all"
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  // @ts-expect-error CSS custom property
                  '--tw-ring-color': PAYMENTS_COLOR
                }}
              />
            </div>
            {/* Export Button */}
            <button
              className="flex items-center gap-2 px-4 py-2 text-[var(--v2-text-secondary)] text-sm font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all hover:bg-[var(--v2-border)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('payments.export.tooltip')}
            >
              <Download className="h-4 w-4" />
              {t('payments.export.button')}
            </button>
            {/* Create Invoice Button */}
            <button
              onClick={() => setShowInvoiceModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium shadow-[var(--v2-shadow-button)] transition-all hover:opacity-90"
              style={{
                borderRadius: 'var(--v2-radius-button)',
                background: PAYMENTS_GRADIENT
              }}
            >
              <Plus className="h-4 w-4" />
              {t('payments.create_invoice')}
            </button>
          </div>
        </div>

        {/* Stripe Connect Status Banner */}
        <StripeConnectStatus />

        {/* View Mode Tabs - pill style like dashboard (no icons, matching CRM) */}
        <div
          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-1 inline-flex gap-1"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <button
            className={`px-4 py-2 text-sm font-medium transition-all ${
              viewMode === 'transactions'
                ? 'text-white shadow-sm'
                : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
            }`}
            style={{
              borderRadius: 'var(--v2-radius-button)',
              ...(viewMode === 'transactions' ? { background: PAYMENTS_GRADIENT } : {})
            }}
            onClick={() => setViewMode('transactions')}
          >
            {t('payments.tab_transactions')}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium transition-all ${
              viewMode === 'invoices'
                ? 'text-white shadow-sm'
                : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
            }`}
            style={{
              borderRadius: 'var(--v2-radius-button)',
              ...(viewMode === 'invoices' ? { background: PAYMENTS_GRADIENT } : {})
            }}
            onClick={() => setViewMode('invoices')}
          >
            {t('payments.tab_invoices')}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium transition-all ${
              viewMode === 'settings'
                ? 'text-white shadow-sm'
                : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
            }`}
            style={{
              borderRadius: 'var(--v2-radius-button)',
              ...(viewMode === 'settings' ? { background: PAYMENTS_GRADIENT } : {})
            }}
            onClick={() => setViewMode('settings')}
          >
            {t('payments.tab_settings')}
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center space-y-4">
              <div
                className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto"
                style={{ borderColor: PAYMENTS_COLOR, borderTopColor: 'transparent' }}
              />
              <p className="text-[var(--v2-text-secondary)] font-medium">{t('payments.loading')}</p>
            </div>
          </div>
        ) : (
          <div
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {viewMode === 'transactions' && <PaymentTransactionList searchQuery={searchQuery} />}
            {viewMode === 'invoices' && (
              <PaymentInvoiceList
                key={invoiceListKey}
                searchQuery={searchQuery}
                onCreateInvoice={() => setShowInvoiceModal(true)}
              />
            )}
            {viewMode === 'settings' && (
              <div className="space-y-6">
                <StripeConnectStatus detailed />
                <div className="pt-6 border-t border-[var(--v2-border)]">
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-4">
                    {t('payments.settings_title')}
                  </h3>
                  <p className="text-[var(--v2-text-secondary)] text-sm">
                    {t('payments.settings_description')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Invoice Modal */}
      {showInvoiceModal && (
        <InvoiceModal
          onClose={() => setShowInvoiceModal(false)}
          onSave={() => {
            setShowInvoiceModal(false);
            setInvoiceListKey(prev => prev + 1); // Refresh invoice list
          }}
        />
      )}
    </div>
  );
}
