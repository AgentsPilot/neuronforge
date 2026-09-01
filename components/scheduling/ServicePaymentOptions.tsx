'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreditCard } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { ServiceCurrency, PaymentType, InstallmentFrequency, FirstPaymentDue } from '@/lib/repositories/SchedulingRepository';

/**
 * How a service is paid for: in full, or over time.
 *
 * Lifted out of SchedulingServiceModal so the onboarding chat can offer the
 * same thing rather than a lookalike. A plan built while signing up and one
 * built later in the service settings are the same feature — two
 * implementations of it would drift the first time either was touched, and the
 * user would be the one to find out.
 *
 * The modal owns saving; this owns the controls.
 */

const SCHEDULING_COLOR = '#14B8A6';

export interface ServicePaymentValues {
  price: number;
  currency: ServiceCurrency;
  payment_type: PaymentType;
  installment_count: number;
  installment_frequency: InstallmentFrequency;
  first_payment_due: FirstPaymentDue;
  first_payment_days: number;
}

interface ServicePaymentOptionsProps {
  formData: ServicePaymentValues;
  /**
   * The price is agreed with each client rather than set here.
   *
   * A quoted service can still be paid in instalments — a consultant quotes for
   * a project and offers three monthly payments — so the choice has to be
   * available even though there is no total to divide yet. Without this the
   * section hid itself for exactly those services, and the button that opens it
   * led to an empty dialog.
   */
  quoted?: boolean;
  /** Same shape as the modal's own setter, so the markup below is unchanged. */
  setFormData: (updater: (prev: ServicePaymentValues) => ServicePaymentValues) => void;
  getCurrencySymbol: (code: ServiceCurrency) => string;
}

export function ServicePaymentOptions({
  formData,
  setFormData,
  getCurrencySymbol,
  quoted = false,
}: ServicePaymentOptionsProps) {
  const { t } = useLanguage();

  // Nothing to arrange when nothing is charged — the same guard the modal had
  // around this block, except that a quoted service does charge. It simply
  // does not know how much yet.
  if (!quoted && !(formData.price > 0)) return null;

  return (
<div className="space-y-4">
  <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
    <CreditCard className="h-4 w-4" />
    {t('scheduling.modal.payment_options')}
  </h3>

  {/* Payment Type Toggle */}
  <div className="grid grid-cols-2 gap-3">
    <button
      type="button"
      onClick={() => setFormData(prev => ({ ...prev, payment_type: 'full', installment_count: 1 }))}
      className={`p-4 text-start border transition-all ${
        formData.payment_type === 'full'
          ? 'border-[#14B8A6] bg-[#14B8A6]/10'
          : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
      }`}
      style={{ borderRadius: 'var(--v2-radius-button)' }}
    >
      <div className="flex items-center gap-2">
        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
          formData.payment_type === 'full' ? 'border-[#14B8A6]' : 'border-[var(--v2-text-muted)]'
        }`}>
          {formData.payment_type === 'full' && <div className="w-2 h-2 rounded-full bg-[#14B8A6]" />}
        </div>
        <span className={`text-sm font-medium ${formData.payment_type === 'full' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'}`}>
          {t('scheduling.modal.payment_full')}
        </span>
      </div>
      <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
        {t('scheduling.modal.payment_full_desc')}
      </p>
    </button>

    <button
      type="button"
      onClick={() => setFormData(prev => ({ ...prev, payment_type: 'installments', installment_count: prev.installment_count > 1 ? prev.installment_count : 2 }))}
      className={`p-4 text-start border transition-all ${
        formData.payment_type === 'installments'
          ? 'border-[#14B8A6] bg-[#14B8A6]/10'
          : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
      }`}
      style={{ borderRadius: 'var(--v2-radius-button)' }}
    >
      <div className="flex items-center gap-2">
        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
          formData.payment_type === 'installments' ? 'border-[#14B8A6]' : 'border-[var(--v2-text-muted)]'
        }`}>
          {formData.payment_type === 'installments' && <div className="w-2 h-2 rounded-full bg-[#14B8A6]" />}
        </div>
        <span className={`text-sm font-medium ${formData.payment_type === 'installments' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'}`}>
          {t('scheduling.modal.payment_installments')}
        </span>
      </div>
      <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
        {t('scheduling.modal.payment_installments_desc')}
      </p>
    </button>
  </div>

  {/* Installment Details - only show when installments selected */}
  {formData.payment_type === 'installments' && (
    <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
      <div>
        <label htmlFor="installment_count" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
          {t('scheduling.modal.installment_count')}
        </label>
        <input
          id="installment_count"
          type="number"
          min="2"
          max="24"
          value={formData.installment_count}
          onChange={(e) => setFormData(prev => ({ ...prev, installment_count: Math.max(2, Math.min(24, parseInt(e.target.value) || 2)) }))}
          className="w-full px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        />
        <p className="text-xs text-[var(--v2-text-muted)] mt-1.5">
          {/* What one instalment comes to — unless the total is still to be
              agreed, in which case saying nothing is more honest than
              dividing a number nobody has named. */}
          {formData.price > 0 && formData.installment_count >= 2
            ? `${getCurrencySymbol(formData.currency)}${(formData.price / formData.installment_count).toFixed(2)} ${t('scheduling.modal.per_installment')}`
            : ''
          }
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
          {t('scheduling.modal.installment_frequency')}
        </label>
        <Select
          value={formData.installment_frequency}
          onValueChange={(value) => setFormData(prev => ({ ...prev, installment_frequency: value as InstallmentFrequency }))}
        >
          <SelectTrigger
            className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:border-[#14B8A6] focus:ring-[#14B8A6]/20"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)]">
            <SelectItem value="weekly" className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488]">
              {t('scheduling.modal.frequency_weekly')}
            </SelectItem>
            <SelectItem value="biweekly" className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488]">
              {t('scheduling.modal.frequency_biweekly')}
            </SelectItem>
            <SelectItem value="monthly" className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488]">
              {t('scheduling.modal.frequency_monthly')}
            </SelectItem>
            <SelectItem value="quarterly" className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488]">
              {t('scheduling.modal.frequency_quarterly')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )}

  {/* First Payment Due (Optional) */}
  <div className="space-y-3">
    <label className="block text-sm font-medium text-[var(--v2-text-primary)]">
      {t('scheduling.modal.first_payment_due')}
    </label>
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={() => setFormData(prev => ({ ...prev, first_payment_due: 'on_booking', first_payment_days: 0 }))}
        className={`p-3 text-start border transition-all ${
          formData.first_payment_due === 'on_booking'
            ? 'border-[#14B8A6] bg-[#14B8A6]/10'
            : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
        }`}
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <span className={`text-sm font-medium ${formData.first_payment_due === 'on_booking' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'}`}>
          {t('scheduling.modal.payment_on_booking')}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setFormData(prev => ({ ...prev, first_payment_due: 'days_after', first_payment_days: prev.first_payment_days || 7 }))}
        className={`p-3 text-start border transition-all ${
          formData.first_payment_due === 'days_after'
            ? 'border-[#14B8A6] bg-[#14B8A6]/10'
            : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
        }`}
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <span className={`text-sm font-medium ${formData.first_payment_due === 'days_after' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'}`}>
          {t('scheduling.modal.payment_days_after')}
        </span>
      </button>
    </div>

    {formData.first_payment_due === 'days_after' && (
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="1"
          max="365"
          value={formData.first_payment_days}
          onChange={(e) => setFormData(prev => ({ ...prev, first_payment_days: Math.max(1, Math.min(365, parseInt(e.target.value) || 1)) }))}
          className="w-20 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        />
        <span className="text-sm text-[var(--v2-text-secondary)]">
          {t('scheduling.modal.days_after_booking')}
        </span>
      </div>
    )}
  </div>
</div>
  );
}
