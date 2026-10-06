'use client';

import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_PAYMENT_TERMS_DAYS } from '@/lib/payments/paymentTerms';
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
import { CountrySelect } from '@/components/ui/CountrySelect';
import { AdminAreaField } from '@/components/ui/AdminAreaField';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { SavedAddressPicker } from '@/components/ui/SavedAddressPicker';
import { legacyCountryToCode } from '@/lib/geo/countries';
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
  /** Days to pay for invoices raised without a human present. */
  invoice_payment_terms_days: number;
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
  /**
   * Show the Stripe connection PANEL?
   *
   * False wherever this section is read as "your bank details" — the place a
   * business arrives precisely BECAUSE it invoices. A panel headed "Payment
   * Setup Required" announces a requirement for the opposite arrangement to
   * the one they chose, on the screen where they came to do the thing they did
   * choose.
   */
  showProcessor?: boolean;
  /**
   * Offered instead, in one line, when there is still something to offer.
   *
   * A business that invoices may well want a card taken now and then, and this
   * is the moment it is thinking about getting paid — so the suggestion stays.
   * What goes is the announcement: an offer with a plain no, rather than a
   * red notice about a step they declined.
   */
  onConnectProcessor?: () => void;
}

export function InvoiceSettingsSection({
  chrome = true,
  userId,
  expanded: expandedProp,
  onToggle,
  showProcessor = true,
  onConnectProcessor,
}: InvoiceSettingsSectionProps) {
  // Without the accordion there is nothing to collapse, so the panel is open.
  const expanded = chrome ? expandedProp === true : true;
  const { t, isRTL, language } = useLanguage();

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
    invoice_payment_terms_days: DEFAULT_PAYMENT_TERMS_DAYS,
    invoice_prices_include_tax: false,
    invoice_tax_rate: '',
    invoice_tax_label: '',
    invoice_document_type: '',
  });

  /*
   * Blank is not zero, and not the default either.
   *
   * Zero is a real answer — due on receipt — so the field cannot treat empty as
   * a number. It is required instead, and the save is blocked while it is
   * empty: substituting a default silently would let a business believe it had
   * chosen terms it never saw, on the one number that decides when its clients
   * are chased.
   */
  /*
   * The country is required, and the save is blocked without it.
   *
   * It is no longer a label on an invoice: it decides which legal sentence goes
   * on a refund email and which tax rules apply. A blank one leaves those
   * silently unanswerable, so it is asked for once rather than guessed at
   * forever. Legacy free text does NOT satisfy it — picking from the list is
   * what turns "Israel" into something the rest of the platform can read.
   */
  const countryMissing = !legacyCountryToCode(settings.invoice_address?.country);

  const termsMissing =
    settings.invoice_payment_terms_days === null ||
    settings.invoice_payment_terms_days === undefined ||
    (settings.invoice_payment_terms_days as unknown as string) === '';

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
            /*
             * The country is resolved to a CODE on the way in.
             *
             * The column still holds what businesses typed before the picker
             * existed — "Israel", "USA". Left alone, the dropdown would show
             * nothing and the owner would think their address had been lost.
             * Anything unrecognised stays as it is and the picker shows it as
             * text until they choose from the list.
             */
            invoice_address: {
              ...(data.data.invoice_address || {}),
              country:
                legacyCountryToCode(data.data.invoice_address?.country) ??
                data.data.invoice_address?.country ??
                '',
            },
            invoice_tax_id: data.data.invoice_tax_id || '',
            invoice_bank_name: data.data.invoice_bank_name || '',
            invoice_bank_account: data.data.invoice_bank_account || '',
            invoice_bank_routing: data.data.invoice_bank_routing || '',
            invoice_payment_instructions: data.data.invoice_payment_instructions || '',
            invoice_footer_text: data.data.invoice_footer_text || '',
            invoice_number_prefix: data.data.invoice_number_prefix || 'INV',
            // `??` — zero is 'due on receipt', which `||` would throw away.
            invoice_payment_terms_days:
              data.data.invoice_payment_terms_days ?? DEFAULT_PAYMENT_TERMS_DAYS,
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
        /*
         * WHICH ENTRY the address fields belong to.
         *
         * Without it the server falls back to the entry this form points at —
         * so opening the PROFILE's address with the pencil, correcting it and
         * saving would rewrite the billing entry with the profile's content and
         * leave the profile's untouched. Silently, and backwards.
         */
        invoice_address_id: editingAddress ?? reusedAddress,
      };

      const response = await fetch('/api/business-os/invoice-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setSuccessMessage(t('settings.invoice.saved') || 'Invoice settings saved');
        /* The address may have become a new entry in the book — a fork, or the
           first one this business has saved. Refetch so the picker shows it
           without a page reload. */
        setAddressBookVersion(v => v + 1);
        setEditingAddress(null);

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

  /** Which saved address, if any, these fields still represent. */
  /**
   * Which entry in the address book the invoice is on.
   *
   * An id now, not a source — every address lives in one book, so "the profile
   * one" is no longer something a form can point at. `null` means the owner is
   * adding a new address, which is the one state that shows the fields.
   */
  const [reusedAddress, setReusedAddress] = useState<string | null>(null);
  /** Bumped after a save so the picker refetches and shows a new entry. */
  const [addressBookVersion, setAddressBookVersion] = useState(0);
  /** The saved entry open in the fields for correcting; it stays selected. */
  const [editingAddress, setEditingAddress] = useState<string | null>(null);


  const updateAddress = (field: keyof InvoiceAddress, value: string) => {
    // These fields no longer represent whatever was picked.
    setReusedAddress(null);
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
              {showProcessor && (
                <div className="mb-4">
                  <label className="flex items-center gap-2 text-xs font-medium text-[var(--v2-text-primary)] mb-2">
                    <CreditCard className="w-4 h-4 text-[var(--v2-text-muted)]" />
                    {t('settings.invoice.payment_connection') || 'Payment Connection'}
                  </label>
                  <StripeConnectStatus detailed />
                </div>
              )}

              {/* Suggested, not announced. */}
              {!showProcessor && onConnectProcessor && (
                <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs text-[var(--v2-text-muted)] m-0 min-w-0">
                    {t('settings.invoice.card_offer') || 'Want clients to be able to pay by card as well?'}
                  </p>
                  <button
                    type="button"
                    onClick={onConnectProcessor}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    {t('settings.invoice.card_offer_action') || 'Connect payments'}
                  </button>
                </div>
              )}

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

                {/*
                  Default payment terms, in days.
                  ─────────────────────────────────────────────────────────────
                  Applies to invoices raised with nobody present to choose — a
                  quote being accepted, a milestone billed. The manual invoice
                  dialog still asks per invoice.

                  Not cosmetic: this number decides when an invoice turns
                  overdue and when the reminders start. Before it existed it was
                  hardcoded to 14 days, agreeing with neither the invoice
                  dialog's default nor whatever the business had written in its
                  own payment instructions.

                  A free number rather than presets, because terms are not a
                  fixed set: 45 and 90 are ordinary arrangements that no preset
                  list contains. Zero is a real answer — payment on receipt —
                  which is why the field is bounded at 0 rather than 1.
                */}
                <div>
                  <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                    {t('settings.invoice.payment_terms')}
                    {/* Required, and marked as such. Silently substituting a
                        default when it is blank would let a business believe it
                        had set terms it never chose — and this number decides
                        when their clients get chased. */}
                    <span className="ms-1" style={{ color: CONFIG_ACCENT }}>*</span>
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={365}
                    step={1}
                    value={settings.invoice_payment_terms_days}
                    onChange={(e) => {
                      /*
                       * An empty field is not zero.
                       *
                       * Clearing the box to retype would otherwise be read as
                       * "due on receipt" on every keystroke, and a save landing
                       * mid-edit would store it. Empty holds until a number
                       * arrives; the value is clamped so a stray digit cannot
                       * put terms outside what the column accepts.
                       */
                      const raw = e.target.value;
                      if (raw === '') {
                        setSettings((prev) => ({
                          ...prev,
                          invoice_payment_terms_days: '' as unknown as number,
                        }));
                        return;
                      }
                      const parsed = Math.min(365, Math.max(0, Math.trunc(Number(raw))));
                      if (Number.isNaN(parsed)) return;
                      setSettings((prev) => ({ ...prev, invoice_payment_terms_days: parsed }));
                    }}
                    required
                    placeholder="30"
                    className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  <p
                    className="mt-1.5 text-xs"
                    style={{
                      color: termsMissing ? '#DC2626' : 'var(--v2-text-secondary)',
                    }}
                  >
                    {termsMissing
                      ? t('settings.invoice.payment_terms_required')
                      : settings.invoice_payment_terms_days === 0
                        ? t('settings.invoice.payment_terms_immediate')
                        : t('settings.invoice.payment_terms_hint')}
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

                <div className="flex items-start gap-3">
                  {/*
                    Toggle FIRST, so it sits on the start side — right in
                    Hebrew, left in English. That is where the checkbox it
                    replaced sat, and where the eye looks for the control before
                    reading what it does.

                    The inner `dir="ltr"` is separate and non-negotiable: the
                    Switch moves its thumb by a fixed rightward
                    `translate-x-[20px]`, so inside an RTL track the thumb would
                    start at the right edge and that shift would carry it clean
                    out. The row around it still mirrors.
                  */}
                  <div dir="ltr" className="mt-0.5 shrink-0">
                    <Switch
                      id="invoice-prices-include-tax"
                      checked={settings.invoice_prices_include_tax}
                      onCheckedChange={(checked) =>
                        setSettings((prev) => ({
                          ...prev,
                          invoice_prices_include_tax: checked,
                        }))
                      }
                      /*
                       * The dialog's accent, not the platform indigo.
                       *
                       * The shared Switch hardcodes `--v2-primary` in its own
                       * class list, and this project's `cn` is a plain join
                       * with no tailwind-merge — so passing an overriding class
                       * would leave both on the element and let CSS source
                       * order decide. An inline style beats every class, which
                       * is the one thing not in question. The checkbox this
                       * replaced used the same accent.
                       */
                      style={
                        settings.invoice_prices_include_tax && !chrome
                          ? { backgroundColor: CONFIG_ACCENT }
                          : undefined
                      }
                    />
                  </div>

                  <label htmlFor="invoice-prices-include-tax" className="min-w-0 cursor-pointer">
                    <span className="block text-sm text-[var(--v2-text-primary)]">
                      {t('settings.invoice.includes_tax')}
                    </span>
                    {/* Said plainly, because this is the fear the toggle
                        creates: nobody's price changes. */}
                    <span className="block text-xs text-[var(--v2-text-muted)] mt-0.5">
                      {t('settings.invoice.includes_tax_hint')}
                    </span>
                  </label>
                </div>

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

                {/*
                  An address this business already gave us, offered before it is
                  asked for a fourth time. Renders nothing when there is nothing
                  to offer, which is most businesses.
                */}
                <SavedAddressPicker
                  use="invoice"
                  current={settings.invoice_address}
                  selectedId={reusedAddress}
                  onSelectedChange={(id) => {
                    setReusedAddress(id);
                    setEditingAddress(null);
                  }}
                  onSelect={(address) =>
                    setSettings(prev => ({
                      ...prev,
                      invoice_address: { ...prev.invoice_address, ...address },
                    }))
                  }
                  locale={language}
                  isRTL={isRTL}
                  t={t}
                  refreshKey={addressBookVersion}
                  onEdit={(option) => {
                    setSettings(prev => ({
                      ...prev,
                      invoice_address: { ...prev.invoice_address, ...option.address },
                    }));
                    // Stays selected while it is corrected — see the profile
                    // section for why clearing it was wrong.
                    setEditingAddress(option.id);
                  }}
                />

                {/*
                  Hidden while a saved address is chosen, for the same reason as
                  the business profile: a form sitting under a chosen answer asks
                  the owner which of two statements about one address is true.
                */}
                {(reusedAddress === null || editingAddress !== null) && (
                  <>
                  <AddressAutocomplete
                    onSelect={(address) => {
                      // Typing an address of your own ends the claim that one of
                      // the saved ones is what is in these fields.
                      setReusedAddress(null);
                      setAddressPicked(false);
                      setSettings(prev => ({
                        ...prev,
                        invoice_address: { ...prev.invoice_address, ...address },
                      }));
                    }}
                    country={settings.invoice_address.country}
                    language={language}
                    isRTL={isRTL}
                    placeholder={t('settings.address.lookup') || 'Start typing your address…'}
                    hint={t('settings.address.lookup_hint') || undefined}
                    className={`w-full py-2.5 text-sm ${FIELD}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />

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

                  {/* FLEX, not a 2-column grid.
                      The state field renders nothing for Israel, the UK and most
                      of Europe — and in a fixed grid that left City at half width
                      with a blank cell beside it. Flexed, City simply takes the
                      whole row when there is no state to share it with. */}
                  <div className="flex gap-3 [&>*]:min-w-0 [&>*]:flex-1">
                    <input
                      type="text"
                      value={settings.invoice_address.city || ''}
                      onChange={(e) => updateAddress('city', e.target.value)}
                      placeholder={t('settings.invoice.city') || 'City'}
                      className={`w-full px-3 py-2.5 text-sm ${FIELD}`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                    <AdminAreaField
                      country={settings.invoice_address.country}
                      value={settings.invoice_address.state || ''}
                      onChange={(value) => updateAddress('state', value)}
                      label={(key) => t(`settings.address.admin.${key}`) || key}
                searchPlaceholder={t('settings.address.admin_search') || 'Type to search…'}
                      emptyLabel={t('settings.address.admin_none') || 'No matches'}
                      isRTL={isRTL}
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
                    <CountrySelect
                      value={settings.invoice_address.country || ''}
                      onChange={(code) => updateAddress('country', code)}
                      locale={language === 'he' ? 'he' : language === 'es' ? 'es' : 'en'}
                      isRTL={isRTL}
                      placeholder={t('settings.invoice.country') || 'Country'}
                      emptyLabel={t('settings.invoice.country_none') || 'No countries found'}
                    />
                  </div>
                  </>
                )}
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
                  disabled={saving || termsMissing || countryMissing}
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
