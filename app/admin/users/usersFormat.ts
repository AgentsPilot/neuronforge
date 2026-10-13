/**
 * Pure display helpers of the Businesses screen, shared by the list and the
 * drawer body (Admin Layout Standard L-4b). Client-safe: no imports.
 */

const MS_PER_HOUR = 3_600_000;

/**
 * The age line under a timestamp (§5.11: relative time only as a secondary
 * hint under the UTC time; L-4a SA M-3). Always a relative age, never a locale
 * date. Was the list's `listAge`; L-4b renamed it because the drawer's
 * Account timeline uses it too.
 */
export function ageLine(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const hours = Math.floor((Date.now() - time) / MS_PER_HOUR);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** USD with four decimals (moved unchanged from `page.tsx`; F-25 stays open). */
export function formatCost(cost: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  }).format(cost);
}

/** en-US thousands separators (moved unchanged from `page.tsx`). */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}
