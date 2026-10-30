/**
 * The words for removing or disconnecting Stripe, shared by both screens that
 * offer it (Business Setup → Payments in `ConfigurationDialog`, and
 * `StripeConnectStatus`), so they cannot drift (self-service exit SX-5 / D5;
 * SA workplan review W-13, W-16).
 *
 * The routes answer with a stable code and counts, never prose. Any code this
 * file does not know reads as the generic "could not complete, nothing was
 * changed", so a new server code can never print raw text to an owner.
 *
 * Pure: no imports beyond the support address, safe in a client bundle.
 *
 * @module components/payments/stripeConnectExitCopy
 */

import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';

/**
 * U-1 (pending user confirmation): the Remove button's label. To revert to
 * "Delete Account", set this to 'config.stripe.delete_account'. The G-8 blocker
 * text (`settings.account_delete.blocker.stripe_linked`) names this label too.
 */
export const STRIPE_REMOVE_BUTTON_KEY = 'config.stripe.remove_connection';

/** Fallback English when a translation function returns nothing. */
const FALLBACK: Record<string, string> = {
  'config.stripe.remove_connection': 'Remove connection',
  'config.stripe.delete_account': 'Delete Account',
  'config.stripe.remove_title': 'Remove Stripe from your business?',
  'config.stripe.remove_message_express':
    'This closes the Stripe account we set up for you and removes it from your business. You will no longer be able to open its Stripe dashboard. Your past payments stay in your records here. This cannot be undone.',
  'config.stripe.remove_message_standard':
    'This removes our access to your Stripe account. Your Stripe account stays open and stays yours. Your past payments stay in your records here.',
  'config.stripe.refused.generic': 'This could not be completed. Nothing was changed. Please try again.',
  // F-1: Stripe already let go; only our record is left. Never "Nothing was changed".
  'config.stripe.refused.record_not_removed':
    'Stripe has released the account, but we could not finish removing it here. Contact us at {support}.',
  'config.stripe.refused.client_plans_running':
    "{n} client payment plans are still running through Stripe. End them first in Orders, or from each client's record, then try again.",
  'config.stripe.refused.client_plans_running_uncounted':
    "Client payment plans are still running through Stripe. End them first in Orders, or from each client's record, then try again.",
  'config.stripe.refused.client_payments_pending':
    '{n} client payments or refunds are still being processed. Wait for them to finish, then try again.',
  'config.stripe.refused.client_payments_pending_uncounted':
    'Client payments or refunds are still being processed. Wait for them to finish, then try again.',
  'config.stripe.refused.stripe_refused':
    'Stripe did not let us remove this account yet, usually because it still holds money for you (a balance or a payout on its way). Nothing was changed. Try again once Stripe has paid it out.',
  'config.stripe.refused.stripe_unreachable': 'We could not reach Stripe right now. Nothing was changed. Please try again in a few minutes.',
  'config.stripe.refused.check_failed': 'We could not check this right now. Nothing was changed. Please try again.',
  'config.stripe.refused.not_available':
    'We need to finish something on our side before this can be done. Nothing was changed. Contact us at {support}.',
};

type Translate = (key: string) => string | undefined | null;

/** A translation, else the English fallback, else the generic line. */
function say(t: Translate, key: string): string {
  const value = t(key);
  if (typeof value === 'string' && value !== '' && value !== key) return value;
  return FALLBACK[key] ?? FALLBACK['config.stripe.refused.generic'];
}

/** The confirm text for Remove (C-9): Express / Custom closes the account; anything else is the owner's own (Standard). */
export function removeMessageKey(accountType: string | null | undefined): string {
  return accountType === 'express' || accountType === 'custom'
    ? 'config.stripe.remove_message_express'
    : 'config.stripe.remove_message_standard';
}

export function stripeExitLabel(t: Translate, key: string): string {
  return say(t, key);
}

const COUNTED: Record<string, string> = {
  client_plans_running: 'config.stripe.refused.client_plans_running',
  client_payments_pending: 'config.stripe.refused.client_payments_pending',
};

const PLAIN: Record<string, string> = {
  stripe_refused: 'config.stripe.refused.stripe_refused',
  stripe_unreachable: 'config.stripe.refused.stripe_unreachable',
  check_failed: 'config.stripe.refused.check_failed',
  not_available: 'config.stripe.refused.not_available',
  record_not_removed: 'config.stripe.refused.record_not_removed',
};

const has = (table: Record<string, string>, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

interface BlockerLike {
  code?: unknown;
  count?: unknown;
}

/** The existing contact-us refusal, with the one support address. */
function contactLine(t: Translate): string {
  return say(t, 'config.stripe.refused.not_available').replace('{support}', PLACEHOLDER_ERASURE_CONTACT);
}

function countedLine(t: Translate, code: string, count: unknown): string {
  const base = COUNTED[code];
  if (typeof count === 'number' && Number.isFinite(count) && count > 0) return say(t, base).replace('{n}', String(count));
  return say(t, `${base}_uncounted`);
}

/**
 * The owner-facing lines for a refused Remove or Disconnect, from the route's
 * JSON body. `client_money_in_flight` lists each blocker; `client_plans_running`
 * is the Disconnect refusal, whose blockers carry the count.
 */
export function refusalLines(t: Translate, body: unknown): string[] {
  const { error, blockers } = (typeof body === 'object' && body !== null ? body : {}) as { error?: unknown; blockers?: unknown };
  const list: BlockerLike[] = Array.isArray(blockers) ? (blockers as BlockerLike[]) : [];

  if (error === 'client_money_in_flight' || error === 'client_plans_running') {
    const lines = list
      .filter((blocker): blocker is BlockerLike & { code: string } => typeof blocker.code === 'string' && has(COUNTED, blocker.code))
      .map((blocker) => countedLine(t, blocker.code, blocker.count));
    // QA B-1: a blocker we cannot name (`contact_support`, or anything new) is ours to clear, so it reads as
    // contact-us with the support address, once, after the named lines. Never "try again", never dropped.
    const unnamed = list.some((blocker) => !(typeof blocker.code === 'string' && has(COUNTED, blocker.code)));
    if (unnamed) lines.push(contactLine(t));
    if (lines.length > 0) return lines;
    if (error === 'client_plans_running') return [countedLine(t, 'client_plans_running', undefined)];
    // Blocked with nothing to name: only we can clear it.
    return [contactLine(t)];
  }

  if (typeof error === 'string' && has(PLAIN, error)) {
    return [say(t, PLAIN[error]).replace('{support}', PLACEHOLDER_ERASURE_CONTACT)];
  }
  return [say(t, 'config.stripe.refused.generic')];
}
