'use client';

import React, { useState, useEffect } from 'react';
import {
  FileText,
  Building2,
  MapPin,
  CreditCard,
  Hash,
  MessageSquare,
  ChevronRight,
  Loader2,
  Check,
  AlertCircle,
  Save,
  Percent,
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { CONFIG_ACCENT, configAccentButton } from '@/components/business-os/configAccent';
import { TabFooter } from '@/components/business-os/settings/TabFooter';
import { StripeConnectStatus } from '@/components/payments/StripeConnectStatus';
import {
  defaultDocumentType,
  type DocumentType,
} from '@/lib/payments/documentType';

interface InvoiceAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

interface InvoiceSettings {
  invoice_company_name: string;
  invoice_address: InvoiceAddress;
  invoice_tax_id: string;
  invoice_bank_name: string;
  invoice_bank_account: string;
  invoice_bank_routing: string;
  invoice_payment_instructions: string;
  invoice_footer_text: string;
  invoice_number_prefix: string;
  /** Display only. The platform never adds tax to a price. */
  invoice_prices_include_tax: boolean;
  invoice_tax_rate: string;
  invoice_tax_label: string;
  /** Empty string = follow the derived default. See lib/payments/documentType. */
  invoice_document_type: DocumentType | '';
}

/** '' is "Automatic" — follow the derived default rather than pinning a word. */
const DOCUMENT_TYPE_OPTIONS: readonly (DocumentType | '')[] = [
  '',
  'receipt',
  'invoice',
  'tax_invoice',
];

interface InvoiceSettingsSectionProps {
  /**
   * Draw the accordion header?
   *
   * False inside a configuration tab, where the tab bar already names the
   * panel — a header here would be a second title for the same thing, and the
   * collapse control would hide content the tab exists to show.
   */
  chrome?: boolean;
  userId: string;
  /** Ignored when `chrome` is false: a tab is always open. */
  expanded?: boolean;
  onToggle?: () => void;
}

export function InvoiceSettingsSection({
  chrome = true,
  userId,
  expanded: expandedProp,
  onToggle,
}: InvoiceSettingsSectionProps) {
  // Without the accordion there is nothing to collapse, so the panel is open.
  const expanded = chrome ? expandedProp === true : true;
  const { t, isRTL } = useLanguage();

  /*
   * Shared field styling.
   *
   * The focus ring follows the host: pink inside the configuration dialog so a
   * focused field matches its tab, the platform primary on the onboarding build
   * screen. Both class strings are written out literally because Tailwind scans
   * source text and never sees an interpolated variant.
   */
  const FIELD = `border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-primary)] transition-colors focus:outline-none focus:ring-2 ${
    chrome
      ? 'focus:ring-[var(--v2-primary)]/40 focus:border-[var(--v2-primary)]'
      : 'focus:ring-[#D14E97]/40 focus:border-[#D14E97]'
  }`;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const [settings, setSettings] = useState<InvoiceSettings>({
    invoice_company_name: '',
    invoice_address: {},
    invoice_tax_id: '',
    invoice_bank_name: '',
    invoice_bank_account: '',
    invoice_bank_routing: '',
    invoice_payment_instructions: '',
    invoice_footer_text: '',
    invoice_number_prefix: 'INV',
    invoice_prices_include_tax: false,
    invoice_tax_rate: '',
    invoice_tax_label: '',
    invoice_document_type: '',
  });

  // Load invoice settings
  useEffect(() => {
    if (expanded && loading) {
      loadSettings();
    }
  }, [expanded, userId]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/business-os/invoice-settings');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          setSettings({
            invoice_company_name: data.data.invoice_company_name || '',
            invoice_address: data.data.invoice_address || {},
            invoice_tax_id: data.data.invoice_tax_id || '',
            invoice_bank_name: data.data.invoice_bank_name || '',
            invoice_bank_account: data.data.invoice_bank_account || '',
            invoice_bank_routing: data.data.invoice_bank_routing || '',
            invoice_payment_instructions: data.data.invoice_payment_instructions || '',
            invoice_footer_text: data.data.invoice_footer_text || '',
            invoice_number_prefix: data.data.invoice_number_prefix || 'INV',
            invoice_prices_include_tax: !!data.data.invoice_prices_include_tax,
            // Kept as a STRING while editing. Held as a number, a half-typed
            // "1" on the way to "17" is a saved rate of 1%, and clearing the
            // box becomes NaN.
            invoice_tax_rate:
              data.data.invoice_tax_rate === null || data.data.invoice_tax_rate === undefined
                ? ''
                : String(data.data.invoice_tax_rate),
            invoice_tax_label: data.data.invoice_tax_label || '',
            invoice_document_type: data.data.invoice_document_type || '',
          });
        }
      }
    } catch (error) {
      console.error('Error loading invoice settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setSaving(true);
      setSuccessMessage('');
      setErrorMessage('');

      /*
       * The two fields the form holds as text but the API takes typed.
       *
       * An empty rate box is `null` — "not set" — never 0, which the server
       * rejects and which would mean a real 0% tax if it did not. An empty
       * document type is `null` too, meaning "follow the default": distinct
       * from any of the three named values.
       */
      const rate = settings.invoice_tax_rate.trim();
      const payload = {
        ...settings,
        invoice_tax_rate: rate === '' ? null : Number(rate),
        invoice_document_type: settings.invoice_document_type || null,
      };

      const response = await fetch('/api/business-os/invoice-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setSuccessMessage(t('settings.invoice.saved') || 'Invoice settings saved');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        const data = await response.json();
        setErrorMessage(data.error || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving invoice settings:', error);
      setErrorMessage('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  /*
   * What "Automatic" resolves to right now, recomputed as the business types.
   *
   * Shown inside the option itself rather than as a note below it: the choice
   * "Automatic" is meaningless without the answer, and a business that ticks
   * the tax box watches this change from Receipt to Tax invoice in front of it.
   */
  const suggestedTypeLabel = t(
    `settings.invoice.document_type_${defaultDocumentType({
      invoice_prices_include_tax: settings.invoice_prices_include_tax,
      invoice_tax_id: settings.invoice_tax_id,
    })}`
  );

  const updateAddress = (field: keyof InvoiceAddress, value: string) => {
    setSettings((prev) => ({
      ...prev,
      invoice_address: {
        ...prev.invoice_address,
        [field]: value,
      },
    }));
  };

  return (
    <div
      className={chrome ? 'bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)]' : ''}
      style={chrome ? { borderRadius: 'var(--v2-radius-card)' } : undefined}
    >
      {chrome && (
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-[var(--v2-text-muted)]" />
          <div className="text-start">
            <p className="text-sm font-medium text-[var(--v2-text-primary)]">
              {t('settings.invoice.title') || 'Invoice Settings'}
            </p>
            <p className="text-xs text-[var(--v2-text-secondary)]">
              {t('settings.invoice.subtitle') || 'Configure your invoice details and branding'}
            </p>
          </div>
        </div>
        <ChevronRight
          className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>
      )}

      {expanded && (
        <div className={chrome ? 'px-4 pb-4 space-y-4 border-t border-[var(--v2-border)] pt-4' : 'mx-auto w-full max-w-3xl space-y-5'}>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              {/* `chrome` is what tells the two hosts apart: false means this
                  is a tab in the configuration dialog, which paints its
                  spinners and buttons in its own accent. On the onboarding
                  build screen the section keeps the page's colour. */}
              <Loader2
                className="w-6 h-6 animate-spin"
                style={chrome ? { color: 'var(--v2-primary)' } : { color: CONFIG_ACCENT }}
              />
            </div>
          ) : (
            <>
              {/* Stripe Connect Section */}
              <div className="mb-4">
                <label className="flex items-center gap-2 text-xs font-medium text-[var(--v2-text-primary)] mb-2">
                  <CreditCard className="w-4 h-4 text-[var(--v2-text-muted)]" />
                  {t('settings.invoice.payment_connection') || 'Payment Connection'}
                </label>
                <StripeConnectStatus detailed />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                {/* Company Name */}
                <div>
                  <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                    {t('settings.invoice.company_name') || 'Company Name (for invoices)'}
                  </label>
                  <div className="relative">
                    <Building2
                      className={`w-4 h-4 absolute ${
                        isRTL ? 'right-3' : 'left-3'
                      } top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`}
                    />
                    <input
                      type="text"
                      value={settings.invoice_company_name}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, invoice_company_name: e.target.value }))
                      }
                      placeholder={t('settings.invoice.company_name_placeholder') || 'Your Business Name'}
                      className={`w-full ${
                        isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'
                      } py-2.5 text-sm ${FIELD}`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                  </div>
                </div>

                {/* Invoice Number Prefix */}
                <div>
                  <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                    {t('settings.invoice.number_prefix') || 'Invoice Number Prefix'}
                  </label>
                  <div className="relative">
                    <Hash
                      className={`w-4 h-4 absolute ${
                        isRTL ? 'right-3' : 'left-3'
                      } top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`}
                    />
                    <input
                      type="text"
                      value={settings.invoice_number_prefix}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, invoice_number_prefix: e.target.value }))
                      }
                      placeholder="INV"
                      maxLength={10}
                      className={`w-full ${
                        isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'
                      } py-2.5 text-sm ${FIELD}`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                  </div>
                  <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                    {t('settings.invoice.number_prefix_hint') || 'e.g., INV, BILL, or your initials'}
                  </p>
                </div>

                {/* Tax ID */}
                <div>
                  <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                    {t('settings.invoice.tax_id') || 'Tax ID / VAT Number'}
                  </label>
                  <input
                    type="text"
                    value={settings.invoice_tax_id}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, invoice_tax_id: e.target.value }))
                    }
                    placeholder={t('settings.invoice.tax_id_placeholder') || 'XX-XXXXXXX'}
                    className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>
              </div>

              {/* Tax & document type.
                  Placed directly under the Tax ID because the two together are
                  what decide the suggested document — a business reading down
                  the form meets the cause immediately before the effect. */}
              <div className="space-y-3 pt-3 border-t border-[var(--v2-border)]">
                <label className="flex items-center gap-2 text-xs font-medium text-[var(--v2-text-primary)]">
                  <Percent className="w-4 h-4 text-[var(--v2-text-muted)]" />
                  {t('settings.invoice.tax_section')}
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.invoice_prices_include_tax}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        invoice_prices_include_tax: e.target.checked,
                      }))
                    }
                    className={`mt-0.5 w-4 h-4 ${chrome ? 'accent-[var(--v2-primary)]' : 'accent-[#D14E97]'}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-[var(--v2-text-primary)]">
                      {t('settings.invoice.includes_tax')}
                    </span>
                    {/* Said plainly, because this is the fear the toggle
                        creates: nobody's price changes. */}
                    <span className="block text-xs text-[var(--v2-text-muted)] mt-0.5">
                      {t('settings.invoice.includes_tax_hint')}
                    </span>
                  </span>
                </label>

                {settings.invoice_prices_include_tax && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                        {t('settings.invoice.tax_rate')}
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0.01}
                        max={99.99}
                        step={0.01}
                        value={settings.invoice_tax_rate}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, invoice_tax_rate: e.target.value }))
                        }
                        placeholder="17"
                        className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                        {t('settings.invoice.tax_label')}
                      </label>
                      <input
                        type="text"
                        value={settings.invoice_tax_label}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, invoice_tax_label: e.target.value }))
                        }
                        placeholder={isRTL ? 'מע״מ' : 'VAT'}
                        maxLength={30}
                        className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                    </div>
                  </div>
                )}

                {/* The consequence, in words, before it reaches a client.
                    The platform suggests; the business decides — whether it may
                    issue a tax invoice follows from its registration, which is
                    not something a settings form can know. */}
                <div>
                  <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                    {t('settings.invoice.document_type')}
                  </label>
                  {/* A segmented control, the way the platform does every other
                      short exclusive choice. A native <select> was the one drop
                      -down on this screen and looked borrowed from the browser.

                      Four segments, so the row wraps rather than squeezing:
                      "Tax invoice" is two words in every language here and does
                      not survive a quarter-width segment. */}
                  <div
                    className="flex flex-wrap gap-1 bg-[var(--v2-surface-hover)] p-1"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                    role="radiogroup"
                    aria-label={t('settings.invoice.document_type')}
                  >
                    {DOCUMENT_TYPE_OPTIONS.map((option) => {
                      const selected = settings.invoice_document_type === option;
                      return (
                        <button
                          key={option || 'auto'}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() =>
                            setSettings((prev) => ({ ...prev, invoice_document_type: option }))
                          }
                          className={`flex-1 min-w-[88px] px-3 py-1.5 text-[12.5px] transition-colors ${
                            selected
                              ? 'bg-[var(--v2-bg)] font-medium text-[var(--v2-text-primary)] shadow-sm'
                              : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                          }`}
                          style={{ borderRadius: 'calc(var(--v2-radius-button) - 2px)' }}
                        >
                          {option === ''
                            ? t('settings.invoice.document_type_auto')
                            : t(`settings.invoice.document_type_${option}`)}
                        </button>
                      );
                    })}
                  </div>

                  {/* What "Automatic" currently means, on its own line — inside
                      a segment it would be the one label three times the width
                      of its neighbours. */}
                  {settings.invoice_document_type === '' && (
                    <p className="mt-1.5 text-xs text-[var(--v2-text-secondary)]">
                      {t('settings.invoice.document_type_auto_hint', { type: suggestedTypeLabel })}
                    </p>
                  )}
                  <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                    {t('settings.invoice.document_type_hint')}
                  </p>
                </div>
              </div>

              {/* Address Section */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-xs font-medium text-[var(--v2-text-primary)]">
                  <MapPin className="w-4 h-4 text-[var(--v2-text-muted)]" />
                  {t('settings.invoice.address') || 'Business Address'}
                </label>

                <input
                  type="text"
                  value={settings.invoice_address.line1 || ''}
                  onChange={(e) => updateAddress('line1', e.target.value)}
                  placeholder={t('settings.invoice.address_line1') || 'Street address'}
                  className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />

                <input
                  type="text"
                  value={settings.invoice_address.line2 || ''}
                  onChange={(e) => updateAddress('line2', e.target.value)}
                  placeholder={t('settings.invoice.address_line2') || 'Suite, unit, building (optional)'}
                  className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />

                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={settings.invoice_address.city || ''}
                    onChange={(e) => updateAddress('city', e.target.value)}
                    placeholder={t('settings.invoice.city') || 'City'}
                    className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  <input
                    type="text"
                    value={settings.invoice_address.state || ''}
                    onChange={(e) => updateAddress('state', e.target.value)}
                    placeholder={t('settings.invoice.state') || 'State/Province'}
                    className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={settings.invoice_address.postal_code || ''}
                    onChange={(e) => updateAddress('postal_code', e.target.value)}
                    placeholder={t('settings.invoice.postal_code') || 'Postal code'}
                    className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  <input
                    type="text"
                    value={settings.invoice_address.country || ''}
                    onChange={(e) => updateAddress('country', e.target.value)}
                    placeholder={t('settings.invoice.country') || 'Country'}
                    className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>
              </div>

              {/* Bank Details Section */}
              <div className="space-y-3 pt-2 border-t border-[var(--v2-border)]">
                <label className="flex items-center gap-2 text-xs font-medium text-[var(--v2-text-primary)]">
                  <CreditCard className="w-4 h-4 text-[var(--v2-text-muted)]" />
                  {t('settings.invoice.bank_details') || 'Bank Details (for wire transfers)'}
                </label>

                <input
                  type="text"
                  value={settings.invoice_bank_name}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, invoice_bank_name: e.target.value }))
                  }
                  placeholder={t('settings.invoice.bank_name') || 'Bank name'}
                  className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />

                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={settings.invoice_bank_account}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, invoice_bank_account: e.target.value }))
                    }
                    placeholder={t('settings.invoice.bank_account') || 'Account number'}
                    className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  <input
                    type="text"
                    value={settings.invoice_bank_routing}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, invoice_bank_routing: e.target.value }))
                    }
                    placeholder={t('settings.invoice.bank_routing') || 'Routing number'}
                    className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>
              </div>

              {/* Payment Instructions */}
              <div className="pt-2 border-t border-[var(--v2-border)]">
                <label className="flex items-center gap-2 text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  <MessageSquare className="w-4 h-4 text-[var(--v2-text-muted)]" />
                  {t('settings.invoice.payment_instructions') || 'Payment Instructions'}
                </label>
                <textarea
                  value={settings.invoice_payment_instructions}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      invoice_payment_instructions: e.target.value,
                    }))
                  }
                  placeholder={
                    t('settings.invoice.payment_instructions_placeholder') ||
                    'Payment due within 30 days. Please include invoice number in payment reference.'
                  }
                  rows={3}
                  className={`w-full px-3 py-2.5 text-sm ${FIELD} resize-none`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
              </div>

              {/* Footer Text */}
              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.invoice.footer_text') || 'Invoice Footer'}
                </label>
                <textarea
                  value={settings.invoice_footer_text}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, invoice_footer_text: e.target.value }))
                  }
                  placeholder={
                    t('settings.invoice.footer_placeholder') ||
                    'Thank you for your business!'
                  }
                  rows={2}
                  className={`w-full px-3 py-2.5 text-sm ${FIELD} resize-none`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
              </div>

              {/* Save and its answer. In the dialog this lands in the frozen
                  bar; on the onboarding build screen, where there is no slot to
                  render into, it stays inline as it always did. */}
              <TabFooter
                message={
                  (successMessage && (
                    <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                      <Check className="w-4 h-4 flex-shrink-0 text-green-600" />
                      {successMessage}
                    </p>
                  )) ||
                  (errorMessage && (
                    <p className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-600" />
                      {errorMessage}
                    </p>
                  )) ||
                  null
                }
              >
                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className={`text-sm font-medium disabled:opacity-50 flex items-center gap-2 ${
                    chrome
                      ? 'px-4 py-2 bg-[var(--v2-primary)] text-white'
                      : 'px-6 py-2.5 border transition-all'
                  }`}
                  style={chrome ? { borderRadius: 'var(--v2-radius-button)' } : configAccentButton}
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {t('common.save') || 'Save'}
                </button>
              </TabFooter>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default InvoiceSettingsSection;
