/**
 * The reason an admin gives for deleting an account (data export DE-10b.1,
 * requirement §7, BQ-4). Shared by the delete route (Zod) and the panel
 * (labels), so both read one list. Client-safe: no server imports.
 *
 * "Other" needs a 5 to 500 character note. The note is stored in the receipt
 * only: never logged, never in an audit row (C-9).
 *
 * O-10 (SA, one-way coupling): the test-account hard delete takes only the
 * `test_account` reason. A `full_delete` receipt that said "customer asked"
 * would claim a full erasure our billing rules forbid.
 *
 * @module lib/business-os/account-deletion/reason
 */

import { z } from 'zod';

export const ADMIN_DELETE_REASONS = ['customer_asked', 'test_account', 'other'] as const;
export type AdminDeleteReasonCategory = (typeof ADMIN_DELETE_REASONS)[number];

export const REASON_NOTE_MIN = 5;
export const REASON_NOTE_MAX = 500;

/** Plain-language labels for the panel. */
export const ADMIN_DELETE_REASON_LABELS: Readonly<Record<AdminDeleteReasonCategory, string>> = {
  customer_asked: 'The customer asked',
  test_account: 'Test account',
  other: 'Other',
};

/** The hint under the "Other" note (C-9). */
export const REASON_NOTE_HINT = 'Do not write names, emails or client details here.';

const note = z.string().trim().min(REASON_NOTE_MIN).max(REASON_NOTE_MAX);

/** Any admin reason. `.strict()` on each branch: an unknown key is a 400. */
export const adminDeleteReasonSchema = z.discriminatedUnion('category', [
  z.object({ category: z.literal('customer_asked') }).strict(),
  z.object({ category: z.literal('test_account') }).strict(),
  z.object({ category: z.literal('other'), note }).strict(),
]);

/** The only reason the test-account hard delete accepts (O-10). */
export const hardDeleteReasonSchema = z.object({ category: z.literal('test_account') }).strict();

export type AdminDeleteReason = z.infer<typeof adminDeleteReasonSchema>;

/** The note, or null for a reason that has none. */
export function reasonNoteOf(reason: AdminDeleteReason): string | null {
  return reason.category === 'other' ? reason.note : null;
}

/** What the panel may submit: a category, and a note of the right length when it is "Other". */
export function isReasonComplete(category: AdminDeleteReasonCategory | null, noteText: string): boolean {
  if (category === null) return false;
  if (category !== 'other') return true;
  const length = noteText.trim().length;
  return length >= REASON_NOTE_MIN && length <= REASON_NOTE_MAX;
}
