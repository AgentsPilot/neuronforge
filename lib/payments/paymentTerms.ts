/**
 * How long a client has to pay, in one place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This was scattered and inconsistent. The manual invoice dialog owned a list
 * of presets — net_7, net_30, net_60 — as a private constant inside a React
 * component, so nothing on the server could reach it. Every invoice raised
 * WITHOUT a human present therefore invented its own number: a hardcoded 14
 * days, matching neither the dialog's `net_30` default nor the business's own
 * printed terms.
 *
 * `due_date` is not decoration. It decides when an invoice turns overdue, when
 * the reminder service chases the client before it, and when it starts chasing
 * after. Getting it wrong makes the business look like it is dunning people who
 * are paying on time.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The terms a business can choose from, as days. */
export interface PaymentTermsPreset {
  /** Stable value stored on the invoice's `payment_terms`. */
  value: string;
  /** i18n key suffix, under `invoice.payment_terms_values.` */
  key: string;
  /** Days from issue until payment is due. -1 means the owner picks a date. */
  days: number;
}

/**
 * Shared with the invoice dialog, which owned this list first.
 *
 * Order is the order they are offered in, shortest terms first — an owner
 * scanning for "the strict one" and "the generous one" finds both ends quickly.
 */
export const PAYMENT_TERMS_PRESETS: PaymentTermsPreset[] = [
  { value: 'receipt', key: 'due_on_receipt', days: 0 },
  { value: 'net7', key: 'net_7', days: 7 },
  { value: 'net15', key: 'net_15', days: 15 },
  { value: 'net30', key: 'net_30', days: 30 },
  { value: 'net60', key: 'net_60', days: 60 },
  { value: 'custom', key: 'custom', days: -1 },
];

/** What a business gets before it has chosen anything. Matches the dialog's default. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

/**
 * The terms that apply to one invoice.
 *
 * The quote wins over the business, because the quote is what the client
 * actually agreed to — a business that changes its default next month must not
 * retroactively shorten terms someone signed.
 *
 * `?? `, not `||`: zero days is "due on receipt", a real and deliberate answer,
 * and `||` would silently discard it in favour of the default.
 */
export function resolveTermsDays(
  proposalDays: number | null | undefined,
  businessDays: number | null | undefined
): number {
  return proposalDays ?? businessDays ?? DEFAULT_PAYMENT_TERMS_DAYS;
}

/**
 * The due date, as `YYYY-MM-DD`.
 *
 * Dates, not timestamps: an invoice is due ON a day, not at an instant, and
 * every consumer — the reminder service, the overdue sweep, the printed
 * document — compares whole days.
 *
 * Stepped at UTC noon so a business west of UTC does not land on the previous
 * calendar day, the same guard the briefing and quote pages use.
 */
export function dueDateFromTerms(days: number, from: Date = new Date()): string {
  const base = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12, 0, 0)
  );
  base.setUTCDate(base.getUTCDate() + Math.max(0, days));
  return base.toISOString().slice(0, 10);
}

/** The preset whose days match, for showing the owner a label rather than a number. */
export function presetForDays(days: number): PaymentTermsPreset | undefined {
  return PAYMENT_TERMS_PRESETS.find(p => p.days === days);
}

/** The value stored on an invoice's `payment_terms` column for these days. */
export function termsValueForDays(days: number): string {
  return presetForDays(days)?.value ?? `net${days}`;
}
