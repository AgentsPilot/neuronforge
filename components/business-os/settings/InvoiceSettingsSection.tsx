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
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { StripeConnectStatus } from '@/components/payments/StripeConnectStatus';

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
}

interface InvoiceSettingsSectionProps {
  userId: string;
  expanded: boolean;
  onToggle: () => void;
}

export function InvoiceSettingsSection({
  userId,
  expanded,
  onToggle,
}: InvoiceSettingsSectionProps) {
  const { t, isRTL } = useLanguage();
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

      const response = await fetch('/api/business-os/invoice-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
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
      className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)]"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
    >
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

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-[var(--v2-border)] pt-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-primary)]" />
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

              {/* Success/Error Messages */}
              {successMessage && (
                <div
                  className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-center gap-2"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Check className="w-4 h-4 text-green-600" />
                  <p className="text-sm text-green-700 dark:text-green-400">{successMessage}</p>
                </div>
              )}
              {errorMessage && (
                <div
                  className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-2"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
                </div>
              )}

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
                    } py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
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
                    } py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
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
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
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
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />

                <input
                  type="text"
                  value={settings.invoice_address.line2 || ''}
                  onChange={(e) => updateAddress('line2', e.target.value)}
                  placeholder={t('settings.invoice.address_line2') || 'Suite, unit, building (optional)'}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />

                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={settings.invoice_address.city || ''}
                    onChange={(e) => updateAddress('city', e.target.value)}
                    placeholder={t('settings.invoice.city') || 'City'}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  <input
                    type="text"
                    value={settings.invoice_address.state || ''}
                    onChange={(e) => updateAddress('state', e.target.value)}
                    placeholder={t('settings.invoice.state') || 'State/Province'}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={settings.invoice_address.postal_code || ''}
                    onChange={(e) => updateAddress('postal_code', e.target.value)}
                    placeholder={t('settings.invoice.postal_code') || 'Postal code'}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  <input
                    type="text"
                    value={settings.invoice_address.country || ''}
                    onChange={(e) => updateAddress('country', e.target.value)}
                    placeholder={t('settings.invoice.country') || 'Country'}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
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
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
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
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  <input
                    type="text"
                    value={settings.invoice_bank_routing}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, invoice_bank_routing: e.target.value }))
                    }
                    placeholder={t('settings.invoice.bank_routing') || 'Routing number'}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
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
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)] resize-none"
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
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)] resize-none"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={saveSettings}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-[var(--v2-primary)] text-white font-medium disabled:opacity-50 flex items-center gap-2"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {t('common.save') || 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default InvoiceSettingsSection;
