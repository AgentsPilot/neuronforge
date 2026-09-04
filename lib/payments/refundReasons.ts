/**
 * The handful of reasons a refund usually has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `payment_refunds.reason` is free text, so whatever the owner typed is what
 * every reader gets — a Hebrew business ends up with "no show" sitting in the
 * middle of a Hebrew drawer, because that is what was typed at the time.
 *
 * Free text stays: a reason nobody anticipated is worth recording in the
 * owner's own words. But the COMMON ones are offered as choices and stored as a
 * stable key, so they can be rendered in the reader's language — and so two
 * owners describing the same thing produce the same value for the detector and
 * the CSV, instead of "no show", "noshow" and "didn't turn up".
 *
 * `describeRefundReason` also recognises reasons already stored as loose text,
 * so refunds recorded before this exists still read correctly.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/refundReasons
 */

/** Stored verbatim in `payment_refunds.reason`. Stable — never re-word these. */
export const REFUND_REASON_KEYS = [
  'no_show',
  'cancelled_by_client',
  'service_not_delivered',
  'duplicate_payment',
  'goodwill',
] as const;

export type RefundReasonKey = (typeof REFUND_REASON_KEYS)[number];

/**
 * Loose text that means one of the keys.
 *
 * Lower-cased and stripped of spaces, hyphens and underscores before matching,
 * so "No Show", "no-show" and "noshow" all land on the same key.
 */
const ALIASES: Record<string, RefundReasonKey> = {
  noshow: 'no_show',
  clientnoshow: 'no_show',
  didntshow: 'no_show',
  cancelled: 'cancelled_by_client',
  canceled: 'cancelled_by_client',
  cancelledbyclient: 'cancelled_by_client',
  clientcancelled: 'cancelled_by_client',
  notdelivered: 'service_not_delivered',
  servicenotdelivered: 'service_not_delivered',
  duplicate: 'duplicate_payment',
  duplicatepayment: 'duplicate_payment',
  doublecharge: 'duplicate_payment',
  goodwill: 'goodwill',
};

function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, '');
}

/** The key a stored reason corresponds to, or null when it is genuinely free text. */
export function refundReasonKey(reason: string | null | undefined): RefundReasonKey | null {
  if (!reason) return null;

  const key = normalise(reason);
  if ((REFUND_REASON_KEYS as readonly string[]).includes(key)) return key as RefundReasonKey;

  return ALIASES[key] ?? null;
}

/**
 * How to show a stored reason to a reader.
 *
 * A recognised reason is translated; anything else is returned as written,
 * because the owner's own words are the record and paraphrasing them would be
 * worse than leaving them in the language they were typed in.
 */
export function describeRefundReason(
  reason: string | null | undefined,
  t: (key: string) => string
): string | null {
  if (!reason) return null;

  const key = refundReasonKey(reason);
  return key ? t(`payments.refund.reason.${key}`) : reason;
}

/**
 * English wording for the canonical keys.
 *
 * For readers that have no `t` — the ledger export, whose headers are English
 * by the same convention. Without it the file's Reason column reads `no_show`,
 * which is an identifier rather than a reason and means nothing to whoever the
 * export was made for.
 *
 * Deliberately a separate map from the UI translations: those live in the
 * language files and change with the product's voice, while this exists so a
 * spreadsheet is legible with no locale at all.
 */
export const REFUND_REASON_LABELS_EN: Record<RefundReasonKey, string> = {
  no_show: 'Client did not show up',
  cancelled_by_client: 'Cancelled by the client',
  service_not_delivered: 'Service not delivered',
  duplicate_payment: 'Duplicate payment',
  goodwill: 'Goodwill',
};

/** A stored reason in plain English, leaving free text exactly as it was typed. */
export function refundReasonInEnglish(reason: string | null | undefined): string {
  if (!reason) return '';
  const key = refundReasonKey(reason);
  return key ? REFUND_REASON_LABELS_EN[key] : reason;
}
