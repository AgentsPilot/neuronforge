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
  /**
   * Whether this service involves picking a time.
   *
   * Only the wording of the first payment depends on it: a course is bought
   * rather than booked, and "On Booking" described an event that never happens
   * for it. Defaults to true, so the onboarding chat reads exactly as before.
   */
  scheduled?: boolean;
  /** Same shape as the modal's own setter, so the markup below is unchanged. */
  setFormData: (updater: (prev: ServicePaymentValues) => ServicePaymentValues) => void;
  getCurrencySymbol: (code: ServiceCurrency) => string;
}

export function ServicePaymentOptions({
  formData,
  setFormData,
  getCurrencySymbol,
  quoted = false,
  scheduled = true,
}: ServicePaymentOptionsProps) {
  const { t } = useLanguage();

  // Nothing to arrange when nothing is charged — the same guard the modal had
  // around this block, except that a quoted service does charge. It simply
  // does not know how much yet.
  if (!quoted && !(formData.price > 0)) return null;

  /*
   * COMPACT, and the first payment moved inside the plan.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Two changes, both about height, because this section is no longer folded
   * away under Advanced Options: it sits in the service editor beside the price
   * it divides, and a form that scrolls is a form whose consequences are read
   * one at a time.
   *
   *   · the two choices are one-line pills. Their descriptions said what the
   *     words already say, and the editor now states the whole arrangement in a
   *     sentence beneath them, which no subtitle could do.
   *
   *   · "First payment" is INSIDE the instalments block. It is read by exactly
   *     one thing — `planStartDate`, when a plan's periods are scheduled — so
   *     on a single payment it was a control that changed nothing, sitting
   *     beside one that changes everything.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const pill = (on: boolean) =>
    `flex items-center gap-2 px-3 py-2 border text-start transition-all ${
      on
        ? 'border-[#14B8A6] bg-[#14B8A6]/10'
        : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
    }`;

  const dot = (on: boolean) =>
    `w-[15px] h-[15px] rounded-full border-2 flex items-center justify-center shrink-0 ${
      on ? 'border-[#14B8A6]' : 'border-[var(--v2-text-muted)]'
    }`;

  const perInstallment =
    formData.price > 0 && formData.installment_count >= 2
      ? `${getCurrencySymbol(formData.currency)}${(formData.price / formData.installment_count).toFixed(2)}`
      : null;

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-[0.07em] flex items-center gap-2">
        <CreditCard className="h-3.5 w-3.5" />
        {t('scheduling.modal.payment_options')}
      </h3>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFormData(prev => ({ ...prev, payment_type: 'full', installment_count: 1 }))}
          className={pill(formData.payment_type === 'full')}
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <span className={dot(formData.payment_type === 'full')}>
            {formData.payment_type === 'full' && <span className="w-[7px] h-[7px] rounded-full bg-[#14B8A6]" />}
          </span>
          <span
            className={`text-[13px] font-medium ${
              formData.payment_type === 'full' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'
            }`}
          >
            {t('scheduling.modal.payment_full')}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            setFormData(prev => ({
              ...prev,
              payment_type: 'installments',
              installment_count: prev.installment_count > 1 ? prev.installment_count : 2,
            }))
          }
          className={pill(formData.payment_type === 'installments')}
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <span className={dot(formData.payment_type === 'installments')}>
            {formData.payment_type === 'installments' && <span className="w-[7px] h-[7px] rounded-full bg-[#14B8A6]" />}
          </span>
          <span
            className={`text-[13px] font-medium ${
              formData.payment_type === 'installments' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'
            }`}
          >
            {t('scheduling.modal.payment_installments')}
          </span>
        </button>
      </div>

      {formData.payment_type === 'installments' && (
        <div
          className="flex flex-wrap items-end gap-3 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <div className="w-[76px]">
            <label htmlFor="installment_count" className="block text-[11px] font-medium text-[var(--v2-text-secondary)] mb-1">
              {t('scheduling.modal.installment_count')}
            </label>
            <input
              id="installment_count"
              type="number"
              min="2"
              max="24"
              value={formData.installment_count}
              onChange={(e) =>
                setFormData(prev => ({
                  ...prev,
                  installment_count: Math.max(2, Math.min(24, parseInt(e.target.value) || 2)),
                }))
              }
              className="w-full px-2.5 py-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-[13px] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
          </div>

          <div className="w-[140px]">
            <label className="block text-[11px] font-medium text-[var(--v2-text-secondary)] mb-1">
              {t('scheduling.modal.installment_frequency')}
            </label>
            <Select
              value={formData.installment_frequency}
              onValueChange={(value) => setFormData(prev => ({ ...prev, installment_frequency: value as InstallmentFrequency }))}
            >
              <SelectTrigger
                className="w-full h-auto py-1.5 text-[13px] bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:border-[#14B8A6] focus:ring-[#14B8A6]/20"
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

          {/* What one instalment comes to, or nothing where the total is still
              to be agreed: dividing a number nobody has named is worse than
              saying nothing. */}
          {perInstallment && (
            <p className="pb-1.5 text-[12px] font-medium text-[#0D9488]">
              {t('scheduling.modal.each_amount').replace('{amount}', perInstallment)}
            </p>
          )}

          <div className="ms-auto">
            <span className="block text-[11px] font-medium text-[var(--v2-text-secondary)] mb-1">
              {t('scheduling.modal.first_payment_due')}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, first_payment_due: 'on_booking', first_payment_days: 0 }))}
                className={`px-2.5 py-1.5 border text-[12px] font-medium transition-all ${
                  formData.first_payment_due === 'on_booking'
                    ? 'border-[#14B8A6] bg-[#14B8A6]/10 text-[#14B8A6]'
                    : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {scheduled
                  ? t('scheduling.modal.first_when_booked')
                  : t('scheduling.modal.first_when_bought')}
              </button>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, first_payment_due: 'days_after', first_payment_days: prev.first_payment_days || 7 }))}
                className={`px-2.5 py-1.5 border text-[12px] font-medium transition-all ${
                  formData.first_payment_due === 'days_after'
                    ? 'border-[#14B8A6] bg-[#14B8A6]/10 text-[#14B8A6]'
                    : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)]'
                }`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {t('scheduling.modal.first_days_later').replace(
                  '{days}',
                  String(formData.first_payment_days || 7)
                )}
              </button>
            </div>
          </div>

          {formData.first_payment_due === 'days_after' && (
            <div className="w-[76px]">
              <label htmlFor="first_payment_days" className="block text-[11px] font-medium text-[var(--v2-text-secondary)] mb-1">
                {t('scheduling.modal.days_after_booking')}
              </label>
              <input
                id="first_payment_days"
                type="number"
                min="1"
                max="365"
                value={formData.first_payment_days}
                onChange={(e) =>
                  setFormData(prev => ({
                    ...prev,
                    first_payment_days: Math.max(1, Math.min(365, parseInt(e.target.value) || 1)),
                  }))
                }
                className="w-full px-2.5 py-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-[13px] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
