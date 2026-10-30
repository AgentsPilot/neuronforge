/**
 * Releasing a business's Stripe Connect account at Stripe, before our record
 * of it may go (self-service exit SX-5 / D5; C-5; SA workplan review W-3, W-4,
 * W-11, W-13).
 *
 * Stripe decides, in this order:
 *
 *   1. retrieve   what the account is. `standard` (the owner's own account,
 *                 OAuth-linked) is released by deauthorize; `platform`
 *                 (Express / Custom, ours) by delete; a deleted object means it
 *                 is already gone. W-4: ONLY this step may conclude "already
 *                 gone", and only for an error shape on ALREADY_GONE_ON_RETRIEVE.
 *   2. deauthorize   confirmed only when Stripe echoes the same account id.
 *                    Every refusal is `not_available` (W-11): a deauthorize does
 *                    not wait on a balance, so "try again after the payout"
 *                    would be untrue.
 *   3. delete        confirmed only on `{ deleted: true, id }`. An invalid-request
 *                    refusal (a balance, a payout on its way) is `stripe_refused`,
 *                    the one honest "Stripe won't let go" answer (BQ-19).
 *
 * Anything this module cannot classify is a refusal. Nothing here touches our
 * database: the caller removes its rows only on `released`.
 *
 * Never logged or returned: Stripe's error message (it can name the account or
 * the platform). Only `{ type, code, statusCode }`.
 *
 * @module lib/business-os/account-deletion/connectRelease
 */

import 'server-only';
import { getStripeService } from '@/lib/stripe/StripeService';

/** The parts of a Stripe error this module reads. Never the message. */
export interface StripeErrorFacts {
  type: string | null;
  code: string | null;
  statusCode: number | null;
}

export type ReleaseStep = 'config' | 'retrieve' | 'deauthorize' | 'delete';

export type ConnectReleaseOutcome =
  | { kind: 'released'; how: 'deleted' | 'deauthorized' | 'already_gone'; accountKind: 'standard' | 'platform' | 'deleted' | 'unknown' }
  | {
      kind: 'refused';
      reason: 'stripe_refused' | 'stripe_unreachable' | 'not_available';
      step: ReleaseStep;
      stripe?: StripeErrorFacts;
    };

/**
 * Retrieve error shapes that prove an account is gone (W-4). A shape goes here
 * only when the sandbox spike recorded it for a revoked or deleted account AND
 * it is NOT the answer a test key gives for a live account id (case d).
 *
 * EMPTY on purpose: the spike of 2026-10-30 could not run (the available test
 * key is not a Connect platform; workplan §14). Until shapes are recorded, a
 * retrieve error is a refusal, never a release.
 */
export const ALREADY_GONE_ON_RETRIEVE: ReadonlyArray<{ code: string; statusCode: number }> = [];

export interface ConnectReleaseDeps {
  retrieveKind(accountId: string): Promise<'standard' | 'platform' | 'deleted'>;
  deauthorize(params: { clientId: string; accountId: string }): Promise<{ stripeUserId: string }>;
  del(accountId: string): Promise<{ id: string; deleted: boolean }>;
  /** W-3: the one server-side `STRIPE_CLIENT_ID`. Null when unset. */
  clientId(): string | null;
  alreadyGoneShapes?: ReadonlyArray<{ code: string; statusCode: number }>;
}

export function stripeErrorFacts(error: unknown): StripeErrorFacts {
  if (typeof error !== 'object' || error === null) return { type: null, code: null, statusCode: null };
  const { type, code, statusCode } = error as { type?: unknown; code?: unknown; statusCode?: unknown };
  return {
    type: typeof type === 'string' ? type : null,
    code: typeof code === 'string' ? code : null,
    statusCode: typeof statusCode === 'number' ? statusCode : null,
  };
}

const TRANSIENT_TYPES: ReadonlySet<string> = new Set(['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError']);

/** Stripe could not answer right now: worth "try again in a few minutes". */
export function isTransient(facts: StripeErrorFacts): boolean {
  if (facts.type !== null && TRANSIENT_TYPES.has(facts.type)) return true;
  return facts.statusCode === 429 || (facts.statusCode !== null && facts.statusCode >= 500);
}

function matchesShape(facts: StripeErrorFacts, shapes: ReadonlyArray<{ code: string; statusCode: number }>): boolean {
  return shapes.some((shape) => shape.code === facts.code && shape.statusCode === facts.statusCode);
}

export function defaultConnectReleaseDeps(): ConnectReleaseDeps {
  return {
    retrieveKind: (accountId) => getStripeService().retrieveConnectedAccountKind(accountId),
    deauthorize: (params) => getStripeService().deauthorizeConnectedAccount(params),
    del: (accountId) => getStripeService().deleteConnectedAccount(accountId),
    clientId: () => {
      const value = process.env.STRIPE_CLIENT_ID?.trim();
      return value ? value : null;
    },
  };
}

export async function releaseConnectedAccount(
  accountId: string,
  deps: ConnectReleaseDeps = defaultConnectReleaseDeps()
): Promise<ConnectReleaseOutcome> {
  const goneShapes = deps.alreadyGoneShapes ?? ALREADY_GONE_ON_RETRIEVE;

  let kind: 'standard' | 'platform' | 'deleted';
  try {
    kind = await deps.retrieveKind(accountId);
  } catch (error) {
    const facts = stripeErrorFacts(error);
    if (matchesShape(facts, goneShapes)) return { kind: 'released', how: 'already_gone', accountKind: 'unknown' };
    return { kind: 'refused', reason: isTransient(facts) ? 'stripe_unreachable' : 'not_available', step: 'retrieve', stripe: facts };
  }

  if (kind === 'deleted') return { kind: 'released', how: 'already_gone', accountKind: 'deleted' };

  if (kind === 'standard') {
    const clientId = deps.clientId();
    if (!clientId) return { kind: 'refused', reason: 'not_available', step: 'config' };
    try {
      const answer = await deps.deauthorize({ clientId, accountId });
      if (answer.stripeUserId === accountId) return { kind: 'released', how: 'deauthorized', accountKind: 'standard' };
      return { kind: 'refused', reason: 'not_available', step: 'deauthorize' };
    } catch (error) {
      const facts = stripeErrorFacts(error);
      // W-11: never `stripe_refused` here.
      return { kind: 'refused', reason: isTransient(facts) ? 'stripe_unreachable' : 'not_available', step: 'deauthorize', stripe: facts };
    }
  }

  try {
    const answer = await deps.del(accountId);
    if (answer.deleted && answer.id === accountId) return { kind: 'released', how: 'deleted', accountKind: 'platform' };
    return { kind: 'refused', reason: 'not_available', step: 'delete' };
  } catch (error) {
    const facts = stripeErrorFacts(error);
    if (isTransient(facts)) return { kind: 'refused', reason: 'stripe_unreachable', step: 'delete', stripe: facts };
    if (facts.type === 'StripeInvalidRequestError') return { kind: 'refused', reason: 'stripe_refused', step: 'delete', stripe: facts };
    return { kind: 'refused', reason: 'not_available', step: 'delete', stripe: facts };
  }
}
