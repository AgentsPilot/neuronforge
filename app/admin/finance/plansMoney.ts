/**
 * The plan MRR line formatters (plan payments P-8a.1; moved here by Money MK-8
 * so the Subscriptions block and the plan drawer print MRR the same way). One
 * line per currency, never a total across currencies; an unreadable currency
 * code is never assumed to be USD. US dollars print as "$" (USD-1).
 */

import { formatMinorAmount } from '@/lib/business-os/currency';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
import type { SubscriptionsMrrLine } from '@/lib/admin/billing/subscriptionsTypes';

import { MRR_PAST_DUE_COUNTED, MRR_UNKNOWN_CURRENCY } from './plansCopy';

export function money(hundredths: number, currency: string | null): string {
  // An unreadable currency code is never assumed to be USD.
  if (currency === null) return `${MRR_UNKNOWN_CURRENCY} ${formatCount(hundredths)} (hundredths)`;
  return formatMinorAmount(hundredths, currency, 'en-US');
}

export function mrrParts(line: SubscriptionsMrrLine): string {
  const parts = [`${formatCount(line.subscriptions)} subscription${line.subscriptions === 1 ? '' : 's'}`];
  if (line.cancellingHundredths > 0) parts.push(`of which cancelling ${money(line.cancellingHundredths, line.currency)}`);
  if (line.pastDueHundredths > 0) parts.push(`of which ${MRR_PAST_DUE_COUNTED} ${money(line.pastDueHundredths, line.currency)}`);
  if (line.overflow) parts.push('not exact');
  return parts.join(' · ');
}
