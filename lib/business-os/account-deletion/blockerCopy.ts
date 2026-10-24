/**
 * The cleanup function's guard rows, as plain-word blocker codes for the
 * self-delete drawer (data export DE-10b.2; workplan §2.5; user decisions
 * 2026-10-18 TL-6 and NBQ-5).
 *
 * Only Stripe-live money blocks a customer: a running plan (G-6), a connected
 * Stripe account (G-8), running client payment plans and pending client
 * payments or refunds (G-9). Sent or overdue invoices do NOT block (TL-6): in
 * the anonymise modes the function reports them as a note. Everything else the
 * function can refuse on is something only we can fix, so it reads "contact
 * us". An unknown guard fails safe to the same code.
 *
 * Pure and client-safe. The guard ids come from the generated function
 * (`supabase/migrations/20261081_operator_account_cleanup_anonymise.sql`); a
 * test reads that file, so a new guard without a mapping fails CI.
 *
 * @module lib/business-os/account-deletion/blockerCopy
 */

export const BLOCKER_CODES = [
  'plan_running',
  'stripe_connected',
  'client_plans_running',
  'client_payments_pending',
  'admin_account',
  'contact_support',
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];

/** One plain-word blocker. `count` only where the copy names a number. */
export interface BlockerView {
  code: BlockerCode;
  count?: number;
}

/** The fields of a guard row this module reads (structurally a `CleanupBlocker`). */
export interface GuardRowLike {
  guard: string;
  item?: string;
  found?: number | null;
}

/**
 * Every guard the function can emit, and what it means to a customer. `null`:
 * never shown (G-12, the files, is cleared by the storage step). `'by_item'`:
 * G-9 has several rows, told apart by their item text.
 */
export const GUARD_CODES: Readonly<Record<string, BlockerCode | 'by_item' | null>> = {
  'G-1': 'contact_support',
  'G-2': 'contact_support',
  'G-2a': 'contact_support',
  'G-3': 'contact_support',
  'G-4': 'admin_account',
  // G-5 and G-7 are notes in the anonymise modes (billing kept). Should one ever block, only we can clear it.
  'G-5': 'contact_support',
  'G-6': 'plan_running',
  'G-7': 'contact_support',
  'G-8': 'stripe_connected',
  'G-9': 'by_item',
  'G-10': 'contact_support',
  'G-11': 'contact_support',
  'G-12': null,
  'G-13': 'contact_support',
  // G-14 (consent rows) and G-15 (invite circle) are notes in the anonymise modes.
  'G-14': 'contact_support',
  'G-15': 'contact_support',
  'G-16': 'contact_support',
  'G-17': 'contact_support',
  'G-18': 'contact_support',
  'G-19': 'contact_support',
  'G-20': 'contact_support',
  'G-21': 'contact_support',
  'G-22': 'contact_support',
};

/** The G-9 rows, by the item text the function writes. Anything else under G-9 is ours to clear. */
function g9Code(item: string | undefined): BlockerCode {
  const text = (item ?? '').toLowerCase();
  if (text.includes('payment plan')) return 'client_plans_running';
  if (text.includes('still pending') || text.includes('refund')) return 'client_payments_pending';
  return 'contact_support';
}

export function blockerCodeOf(row: GuardRowLike): BlockerCode | null {
  const mapped = Object.prototype.hasOwnProperty.call(GUARD_CODES, row.guard) ? GUARD_CODES[row.guard] : 'contact_support';
  if (mapped === 'by_item') return g9Code(row.item);
  return mapped;
}

const COUNTED: ReadonlySet<BlockerCode> = new Set(['client_plans_running', 'client_payments_pending']);

/**
 * The blockers to show, once each, in the fixed order of `BLOCKER_CODES`, with
 * the summed count where the copy names one.
 */
export function toBlockerViews(rows: readonly GuardRowLike[]): BlockerView[] {
  const counts = new Map<BlockerCode, number>();
  for (const row of rows) {
    const code = blockerCodeOf(row);
    if (code === null) continue;
    const found = typeof row.found === 'number' && Number.isFinite(row.found) && row.found > 0 ? row.found : 0;
    counts.set(code, (counts.get(code) ?? 0) + found);
  }
  return BLOCKER_CODES.filter((code) => counts.has(code)).map((code) =>
    COUNTED.has(code) && (counts.get(code) ?? 0) > 0 ? { code, count: counts.get(code) } : { code }
  );
}

/**
 * True when the function reported that our billing rows will be kept (G-5 live
 * money, or G-7 a legacy Stripe trace). The drawer then says the payment
 * history is kept without personal details. It deliberately does not say the
 * customer paid real money: a G-7 legacy trace alone sets it (DE-10b.1 QA I-a).
 */
export function willKeepBilling(notes: readonly GuardRowLike[]): boolean {
  return notes.some((note) => (note.guard === 'G-5' || note.guard === 'G-7') && (note.found ?? 1) > 0);
}
