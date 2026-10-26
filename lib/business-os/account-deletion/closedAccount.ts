/**
 * The closed ("tombstone") login of a deleted account (data export DE-10b.1,
 * SA Review 2 TQ-21). The cleanup function rewrites its email to
 * `deleted-{ref}@deleted.invalid`, where `{ref}` is the first 12 hex digits of
 * the deletion receipt id, never anything derived from the old email.
 *
 * `.invalid` is reserved (RFC 2606) and never delivers. `emailTransport`
 * refuses every `.invalid` recipient, and finance and admin pages (DE-10b.2)
 * label the account "Deleted account {ref}" from this helper, so no join
 * changes. Pure and client-safe.
 *
 * @module lib/business-os/account-deletion/closedAccount
 */

const CLOSED_ACCOUNT_EMAIL = /^deleted-([0-9a-f]{12})@deleted\.invalid$/;

/** True for the exact placeholder the cleanup function writes, nothing looser. */
export function isClosedAccountEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && CLOSED_ACCOUNT_EMAIL.test(email);
}

/** The 12-hex reference of a closed account, or null for any other email. */
export function closedAccountRef(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const match = CLOSED_ACCOUNT_EMAIL.exec(email);
  return match ? match[1] : null;
}

/**
 * How an admin page names a login (data export DE-10b.2, SA TQ-21): "Deleted
 * account {ref}" for a closed account, the email otherwise. Joins and ids do
 * not change; only the label does.
 */
export function adminAccountLabel(email: string | null | undefined): string | null {
  const ref = closedAccountRef(email);
  if (ref !== null) return `Deleted account ${ref}`;
  return typeof email === 'string' && email !== '' ? email : null;
}
