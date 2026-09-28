/**
 * The second line of a money row's client column: which paper this is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT INLINE IN `MoneyRow`
 *
 * It was, and it was wrong in a way nothing could catch. The chain read the
 * invoice number only when `entries.length === 1`, so a booking holding more
 * than one — two invoices, or an invoice raised alongside a separate payment —
 * matched no branch and rendered no reference at all. The row knew the numbers
 * and declined to name any of them because it could not name them all.
 *
 * There is no component test harness for this file's caller (`jest-environment-
 * jsdom` is not installed), so a branch like that can only be pinned by pulling
 * it out. It is pure: an item and a translator in, a string or null out.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { MoneyItem } from '@/lib/payments/moneyItems';

/** The `t` this needs: a key in, a string out, falsy when it has no translation. */
type Translate = (key: string) => string;

/**
 * Document numbers on this row, in order, excluding one that merely repeats
 * the row's own title — naming a row twice tells the reader nothing.
 */
export function documentNumbersFor(item: MoneyItem): string[] {
  return item.entries
    .map(entry => entry.invoiceNumber)
    .filter((number): number is string => Boolean(number) && number !== item.title);
}

export function moneyRowReference(item: MoneyItem, t: Translate): string | null {
  // A plan describes itself by its shape, not by a document number.
  if (item.method === 'plan' && item.plan) {
    const plan = t('payments.method.plan') || 'Plan';
    const payments = t('payments.payments_lower') || 'payments';
    return `${plan} · ${item.plan.installmentCount} ${payments}`;
  }

  const numbers = documentNumbersFor(item);
  if (numbers.length === 1) return numbers[0];
  /*
   * The first, and how many more. The column has room for one identifier, and
   * "+1" is short, language-neutral and honest about there being another —
   * where showing nothing simply lost the reference.
   */
  if (numbers.length > 1) return `${numbers[0]} +${numbers.length - 1}`;

  // Nothing was invoiced: say how the money arrived instead.
  const lead = item.entries[0];
  if (lead?.paymentMethod && item.method === 'direct') {
    return t(`payments.payment_method.${lead.paymentMethod}`) || lead.paymentMethod;
  }

  return null;
}
