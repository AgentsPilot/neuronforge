/**
 * Which Stripe account a business's money moves through.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * This app takes DIRECT charges on connected accounts. A payment intent created
 * on a connected account exists ONLY there — ask the platform about it and
 * Stripe answers "No such payment_intent". So a refund must be issued against
 * the same account as the charge, or it does not happen at all.
 *
 * Two problems made that impossible, and this module addresses both.
 *
 * 1. NOBODY RECORDED THE ACCOUNT. The refund route used a platform client with
 *    no account context and failed for every connected-account charge. The fix
 *    is not to look the account up at refund time — it is to write down where
 *    the charge was made, at the moment it is made. `describeChargeAccount`
 *    produces those columns; `resolveRefundAccount` reads them back.
 *
 * 2. TWO SOURCES OF TRUTH, CONSULTED IN DIFFERENT ORDERS. A connected account id
 *    lives in `stripe_connect_accounts` (Express onboarding) and in
 *    `plugin_connections.profile_data` (the OAuth plugin). `create-checkout`
 *    read the first then the second; `website/checkout` and `payment-intent`
 *    read them the other way round. A business holding both records, if they
 *    ever differed, would be charged on one account and refunded against the
 *    other. `resolveUserConnectAccounts` gives every caller one order.
 *
 * WHY REFUSAL IS THE DEFAULT
 *
 * Until the platform fallback was removed, a revoked Connect account silently
 * produced a PLATFORM charge recorded identically to a connected one. Nothing in
 * the database distinguishes them; only Stripe knows. So for a legacy row the
 * account cannot be inferred, and `resolveRefundAccount` refuses rather than
 * guessing — a wrong guess either fails loudly or refunds the wrong balance,
 * while refusing costs a support ticket.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StripeAccountContext' });

/** Where a connected account id was found. Recorded so drift stays visible. */
export type AccountSource = 'stripe_connect_accounts' | 'plugin_connections';

export interface ConnectAccountCandidate {
  accountId: string;
  source: AccountSource;
}

/**
 * How confident we are about the account a charge lives on.
 *
 * `recorded`   captured at charge time from Stripe's own answer
 * `reconciled` proved against Stripe afterwards by the reconciliation script
 * `unknown`    never recorded — predates this module
 * `ambiguous`  found on more than one account, or on none
 */
export type AccountResolution = 'recorded' | 'reconciled' | 'unknown' | 'ambiguous';

export interface ChargeAccountColumns {
  stripe_connect_account_id: string | null;
  charge_account_kind: 'connect' | 'platform';
  account_resolution: AccountResolution;
}

/**
 * Every connected account this business might be using, most authoritative
 * first.
 *
 * `stripe_connect_accounts` leads because it is the table the Express
 * onboarding flow owns and it carries `charges_enabled`, so it can be checked
 * rather than merely read. `plugin_connections` follows as the OAuth path.
 *
 * Returns a LIST rather than one id on purpose: when a legacy charge has to be
 * located, "which of this user's accounts is it on" is a real question, and
 * finding it on more than one is a real answer — `ambiguous` — that a
 * single-value API could not express.
 */
export async function resolveUserConnectAccounts(
  db: SupabaseClient,
  userId: string
): Promise<ConnectAccountCandidate[]> {
  const candidates: ConnectAccountCandidate[] = [];

  const { data: express } = await db
    .from('stripe_connect_accounts')
    .select('stripe_account_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (express?.stripe_account_id) {
    candidates.push({ accountId: express.stripe_account_id, source: 'stripe_connect_accounts' });
  }

  const { data: plugin } = await db
    .from('plugin_connections')
    .select('profile_data, status')
    .eq('user_id', userId)
    .eq('plugin_key', 'stripe')
    .maybeSingle();

  const profile = plugin?.profile_data as { stripe_account_id?: string; id?: string } | null;
  const pluginAccountId = profile?.stripe_account_id || profile?.id;

  // Deduplicated: the same account in both tables is the healthy case, and
  // listing it twice would make a probe report a false `ambiguous`.
  if (pluginAccountId && !candidates.some(c => c.accountId === pluginAccountId)) {
    candidates.push({ accountId: pluginAccountId, source: 'plugin_connections' });
  }

  if (candidates.length > 1) {
    // Not an error — but it is the condition under which the old
    // inconsistent lookup order could charge and refund on different accounts.
    logger.warn(
      { userId, accounts: candidates.map(c => `${c.source}:${c.accountId}`) },
      'Business has more than one distinct Stripe account on record'
    );
  }

  return candidates;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CAN THIS BUSINESS BE PAID RIGHT NOW?
 *
 * One answer, in one place, because there were six and they disagreed:
 * `charges_enabled` alone; `charges_enabled && onboarding_completed`;
 * `charges_enabled || onboarding_completed`; `onboarding_completed` alone;
 * `plugin.status === 'active'`; and, on two charge paths, nothing at all.
 *
 * The consequence of that disagreement was not an error message. It was invoice
 * emails going out with a live "Pay Now" button for businesses that could not
 * receive a penny — marked sent, audited as successful, and discovered only by
 * the client, who had no way to tell anyone.
 *
 * `charges_enabled` IS THE WHOLE PREDICATE. It is Stripe's own answer to the
 * only question being asked, and it is the flag Stripe itself enforces when a
 * charge is created — so "we said yes" and "Stripe said yes" cannot diverge.
 *
 * Deliberately NOT `onboarding_completed`: despite the name, both writers store
 * it as `charges_enabled && payouts_enabled`, so it also refuses a business
 * whose money is merely held pending verification. That money is real and will
 * arrive; turning the sale away would be the more expensive mistake.
 *
 * ABSENT EVIDENCE REFUSES. A missing row, a null flag, an id that looks like a
 * placeholder — none of them mean yes. The same rule `resolveRefundAccount`
 * enforces, for the same reason: the dangerous failure here is never an
 * exception, it is a confident guess.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Why a business cannot be paid. Machine-readable so each surface can say it differently. */
export type CollectionBlockReason =
  /** No Stripe Connect account on record. */
  | 'no_account'
  /** An account exists but its details were never submitted to Stripe. */
  | 'never_onboarded'
  /** Details submitted; Stripe has not (yet) enabled charges. */
  | 'verification_pending'
  /** Charges were explicitly turned off — disconnected here, or disabled by Stripe. */
  | 'disconnected';

export type CollectionCapability =
  | { canCollect: true; accountId: string }
  | { canCollect: false; reason: CollectionBlockReason; accountId: string | null };

/** The readiness columns, as `stripe_connect_accounts` stores them. */
export interface ConnectAccountReadiness {
  stripe_account_id?: string | null;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
}

/**
 * Placeholder ids seeded by fixtures and by the minimal-account creators.
 *
 * This guard existed in exactly one route. Moved here so the shared helper is
 * not weaker than the code it replaces — a test account id charging real
 * clients is the failure it prevents.
 */
function isPlaceholderAccount(accountId: string): boolean {
  return accountId.includes('mock') || accountId.includes('test_placeholder');
}

/**
 * The decision, as a pure function of the row.
 *
 * Separated from the query so every case below can be asserted without a
 * database stand-in — and so the rule can be read in one screen.
 */
export function decideCollectionCapability(
  row: ConnectAccountReadiness | null | undefined
): CollectionCapability {
  const accountId = row?.stripe_account_id ?? null;

  if (!accountId || isPlaceholderAccount(accountId)) {
    return { canCollect: false, reason: 'no_account', accountId: null };
  }

  if (row?.charges_enabled === true) {
    // Payouts may still be held. That is the owner's problem to resolve with
    // Stripe, not a reason to refuse the client's card.
    return { canCollect: true, accountId };
  }

  // Everything below is a refusal; the rest is only about saying WHY, because
  // "finish signing up" and "Stripe is still reviewing you" need different
  // answers from the business.
  if (row?.details_submitted !== true) {
    return { canCollect: false, reason: 'never_onboarded', accountId };
  }

  if (row?.charges_enabled === false) {
    // Submitted, and charges are off. Either Stripe disabled them or the
    // business disconnected here — `disconnect` forces this same false.
    return { canCollect: false, reason: 'disconnected', accountId };
  }

  // Details are in and charges are neither true nor false — unknown. Unknown is
  // not permission.
  return { canCollect: false, reason: 'verification_pending', accountId };
}

/**
 * Whether this business can be paid, read from its Connect account.
 *
 * Only `stripe_connect_accounts` is consulted. The `plugin_connections` OAuth
 * row is how a Stripe PLUGIN is connected for automations; it is not how a
 * business is onboarded to take payments, and its `profile_data.charges_enabled`
 * is a snapshot written once at connect time that nothing ever refreshes.
 * Treating a stale copy as authority is how a business ends up believing it can
 * charge when Stripe has already said otherwise.
 */
export async function resolvePaymentCollectionCapability(
  db: SupabaseClient,
  userId: string
): Promise<CollectionCapability> {
  const { data, error } = await db
    .from('stripe_connect_accounts')
    .select('stripe_account_id, charges_enabled, payouts_enabled, details_submitted')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // A failed read is not a "no". It is also not a "yes", and a yes is the
    // only answer that moves money — so it refuses, loudly.
    logger.error({ err: error, userId }, 'Could not read Stripe account readiness — refusing to collect');
    return { canCollect: false, reason: 'no_account', accountId: null };
  }

  return decideCollectionCapability(data);
}

/**
 * The same answer, safe to hand to a browser or a public endpoint.
 *
 * The account id never crosses that line: a connected account id is not secret
 * exactly, but it is not the public's business either, and nothing client-side
 * needs it to decide whether to draw a Pay button.
 */
export function toPublicCollectionState(
  capability: CollectionCapability
): { canCollect: boolean; reason?: CollectionBlockReason } {
  return capability.canCollect
    ? { canCollect: true }
    : { canCollect: false, reason: capability.reason };
}

/**
 * The columns to write on a transaction, given where the charge was actually
 * made.
 *
 * `null` is a real answer here and means the platform — which is why
 * `charge_account_kind` exists alongside it. A null id on its own cannot
 * distinguish "the platform took this" from "nobody wrote it down", and
 * conflating those is what makes a refund guess.
 */
export function describeChargeAccount(accountId: string | null | undefined): ChargeAccountColumns {
  return {
    stripe_connect_account_id: accountId ?? null,
    charge_account_kind: accountId ? 'connect' : 'platform',
    account_resolution: 'recorded',
  };
}

/** Just enough of the Stripe SDK to locate a payment intent. */
export interface PaymentIntentLocator {
  paymentIntents: {
    retrieve: (id: string, options?: { stripeAccount: string }) => Promise<unknown>;
  };
}

/**
 * Ask Stripe which account a payment intent actually lives on.
 *
 * Used where the account cannot be taken from a webhook: the website booking
 * flow finalises from the browser, and a client-supplied account id is not
 * evidence of anything. The payment intent id is checked against the platform
 * and then against each of the business's accounts, and whichever one returns it
 * is the truth.
 *
 * Stripe namespaces resource ids per account, so a connected account's payment
 * intent is genuinely absent from the platform — a 404 here is an answer, not a
 * failure. At most one lookup can succeed; finding none means the id was wrong
 * or invented, which is exactly why this is not taken on trust.
 *
 * Costs one extra Stripe read per booking, on a path that runs once per payment,
 * and buys the difference between a refundable payment and an unrefundable one.
 */
export async function locatePaymentIntentAccount(
  stripe: PaymentIntentLocator,
  paymentIntentId: string,
  candidates: ConnectAccountCandidate[]
): Promise<ChargeAccountColumns> {
  const found: Array<string | null> = [];

  try {
    await stripe.paymentIntents.retrieve(paymentIntentId);
    found.push(null); // the platform
  } catch {
    // Absent here. Expected for every connected-account charge.
  }

  for (const candidate of candidates) {
    try {
      await stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: candidate.accountId });
      found.push(candidate.accountId);
    } catch {
      // Absent on this account too.
    }
  }

  if (found.length === 1) {
    return describeChargeAccount(found[0]);
  }

  // Nowhere, or somehow more than one. Either way the account is not known well
  // enough to refund against, and `ambiguous` is what stops a later guess.
  logger.warn(
    { paymentIntentId, matches: found.length },
    found.length === 0
      ? 'Payment intent not found on the platform or any of the business accounts'
      : 'Payment intent resolved to more than one account'
  );

  return {
    stripe_connect_account_id: found.length === 1 ? found[0] : null,
    charge_account_kind: 'platform',
    account_resolution: 'ambiguous',
  };
}

export interface RefundAccountTarget {
  stripe_connect_account_id?: string | null;
  account_resolution?: string | null;
}

export type RefundAccountDecision =
  /** Issue the refund against this account. `null` means the platform. */
  | { ok: true; stripeAccount: string | null }
  /** Do not call Stripe. The account is not known well enough to be safe. */
  | { ok: false; reason: 'ACCOUNT_UNRESOLVED'; detail: string };

/**
 * Where to send a refund, or a refusal.
 *
 * Only `recorded` and `reconciled` are trusted. Everything else refuses — see
 * the module header for why guessing is worse than failing.
 */
/** The slice of a Supabase client `resolveAccountOwner` uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the client's
// generated types differ between the browser and service-role clients; this
// helper only ever reads two columns and is exercised by its own tests.
export type AccountLookupDb = any;

export function resolveRefundAccount(tx: RefundAccountTarget): RefundAccountDecision {
  const resolution = tx.account_resolution ?? 'unknown';

  if (resolution === 'recorded' || resolution === 'reconciled') {
    return { ok: true, stripeAccount: tx.stripe_connect_account_id ?? null };
  }

  return {
    ok: false,
    reason: 'ACCOUNT_UNRESOLVED',
    detail:
      resolution === 'ambiguous'
        ? 'This payment was found on more than one Stripe account, so refunding it could return money from the wrong balance.'
        : 'It is not recorded which Stripe account took this payment, so it cannot be refunded safely until reconciled.',
  };
}

/**
 * The options object for a Stripe SDK call against a resolved account.
 *
 * Returns `undefined` for the platform rather than `{ stripeAccount: undefined }`
 * — passing the key with an undefined value is not the same as omitting it, and
 * the SDK treats them differently.
 */
export function stripeRequestOptions(
  stripeAccount: string | null
): { stripeAccount: string } | undefined {
  return stripeAccount ? { stripeAccount } : undefined;
}

/**
 * Which business owns a Stripe connected account.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The inverse of `resolveUserConnectAccounts`, and it exists for one reason:
 * webhook handlers must be able to prove that the record a Connect event points
 * at actually belongs to the account the event came from.
 *
 * Without that proof, every Connect handler is addressable by id alone. A
 * connected business can create an object on ITS OWN account carrying another
 * tenant's invoice UUID in metadata, pay it, and have our webhook mark that
 * tenant's invoice paid and insert a payment row under their user_id. The money
 * went to the attacker's balance; the victim's books say they were paid.
 *
 * Both tables are checked because either may hold the id, exactly as the
 * forward lookup does.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function resolveAccountOwner(
  db: AccountLookupDb,
  stripeAccountId: string
): Promise<string | null> {
  const direct = await db
    .from('stripe_connect_accounts')
    .select('user_id')
    .eq('stripe_account_id', stripeAccountId)
    .maybeSingle();

  if (direct.data?.user_id) return direct.data.user_id;

  // The OAuth path stores it inside profile_data, which cannot be queried by a
  // column, so the stripe connections are read and matched in memory. There are
  // few of them per deployment and this runs once per webhook.
  const viaPlugin = await db
    .from('plugin_connections')
    .select('user_id, profile_data, status')
    .eq('plugin_key', 'stripe');

  for (const row of viaPlugin.data ?? []) {
    const profile = row.profile_data as { stripe_account_id?: string; id?: string } | null;
    const id = profile?.stripe_account_id ?? profile?.id;
    if (id === stripeAccountId) return row.user_id;
  }

  return null;
}
