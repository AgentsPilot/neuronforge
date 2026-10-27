'use client';

/**
 * The owner's plan payment banner, under the Business OS tabs on every page
 * (plan payments P-6a.2; workplan §5.6, §13).
 *
 * It renders what it is sent and decides nothing: `readPaymentNotice` (server)
 * asked `planPaymentNotice`, the one predicate Settings → Plan also uses. A
 * client component only because the sentences come from the platform
 * dictionary (`useLanguage`), so they follow the reader's language and
 * direction (Hebrew right to left) like every other Business OS line.
 *
 * Links: `action_required` opens Stripe's hosted invoice page in a new tab
 * (`noopener noreferrer`); every other kind goes to Settings → Plan, which
 * offers "Update card" (Stripe's portal, plan payments P-7a.2) whenever the
 * owner has a Business OS subscription on our record, and otherwise says where
 * Stripe's emailed link is.
 *
 * Imports nothing from the entitlements module and no server file: the type
 * comes from the import-free predicate module.
 */

import { AlertTriangle } from 'lucide-react';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { PaymentNoticeWire } from '@/lib/business-os/billing/planPaymentNotice';
import { SETTINGS_PLAN_PATH } from '@/components/business-os/settings/planPurchaseCopy';

/** `{name}` slots filled by a function replacer, so a `$` in a value is printed as is. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : slot));
}

/** The pause date on the account's own clock, as every other billing instant. */
function formatDay(iso: string, language: string, timeZone: string): string | null {
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return null;
  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
  return day.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: timeZone || 'UTC' });
}

export function PlanPaymentBanner({ notice }: { notice: PaymentNoticeWire | null }) {
  const { t, isRTL, language, timezone } = useLanguage();
  if (!notice) return null;

  const plan = notice.planLabel ?? t('billing.notice.plan_fallback');
  let sentence: string;
  switch (notice.kind) {
    case 'payment_failed': {
      const by = notice.pauseBy ? formatDay(notice.pauseBy, language, timezone) : null;
      sentence = by
        ? fill(t('billing.notice.payment_failed_by'), { plan, date: by })
        : fill(t('billing.notice.payment_failed'), { plan });
      break;
    }
    case 'paused':
      sentence = fill(t('billing.notice.paused'), { plan });
      break;
    case 'action_required':
      sentence = fill(t('billing.notice.action_required'), { plan });
      break;
    case 'ended':
      sentence = fill(t('billing.notice.ended'), { plan });
      break;
    default: {
      const unreachable: never = notice;
      return unreachable;
    }
  }

  const linkClass = 'shrink-0 text-sm font-medium text-[var(--v2-primary)] underline';
  return (
    <div
      role="status"
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="plan-payment-banner"
      data-kind={notice.kind}
      className="w-full border-b border-[var(--v2-error-border)] bg-[var(--v2-error-bg)]"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--v2-error-icon)]" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-[var(--v2-error-text)]">{sentence}</p>
        {notice.kind === 'action_required' ? (
          <a href={notice.confirmUrl} target="_blank" rel="noopener noreferrer" className={linkClass} data-testid="plan-payment-banner-confirm">
            {t('billing.notice.confirm_payment')}
          </a>
        ) : (
          <a href={SETTINGS_PLAN_PATH} className={linkClass} data-testid="plan-payment-banner-plan">
            {t('billing.notice.open_plan')}
          </a>
        )}
      </div>
    </div>
  );
}
