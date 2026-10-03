/**
 * Business OS webhook dispatcher (SA-P6).
 *
 * Runs inside `POST /api/stripe/webhook`, after the signature check, the event
 * claim and the Connect split, and before the route's `switch`. It decides, for
 * a PLATFORM event, whether the event belongs to a Business OS billing flow:
 *
 *   - `not_business_os`: not ours; the route's existing `switch` handles it.
 *   - `deny`: ours to refuse. The route logs it, marks the claim completed and
 *     answers 200, and NO handler runs. This is how an unrecognised platform
 *     invoice is kept away from the agent-platform Pilot-Credit conversion.
 *   - `flow`: a recognised Business OS payment, handed to the registered
 *     handler for that flow.
 *
 * Rules:
 *   - Platform only. A Connect event (`event.account` set) is `not_business_os`
 *     before any resolver runs; client payments never reach this module.
 *   - Disjoint by construction. If two resolvers claim an event, or one claims
 *     it and another refuses it, the outcome is `deny resolver_conflict`. A
 *     payment resolved as one flow is never offered to the other.
 *   - No account in the outcome. Nothing here says who the payment belongs to;
 *     that is decided later from our own billing record (SR-8, P-3b).
 *   - A resolver that throws propagates. "I could not tell" must release the
 *     claim so Stripe retries; it must never become a final `deny` (SA Q-6).
 *
 * Boost 4a appends its resolver to `DEFAULT_RESOLVERS` (requirement §9.4).
 *
 * @module lib/business-os/billing/webhookDispatcher
 */

import type Stripe from 'stripe';

import type { Logger } from '@/lib/logger';
import { planResolver } from '@/lib/business-os/billing/planInvoiceResolver';

export type BusinessOsFlow = 'plan' | 'boost';

export type DenyReason =
  | 'unknown_price'
  | 'no_priced_lines'
  | 'mixed_prices'
  | 'lines_truncated'
  | 'metadata_mismatch'
  | 'legacy_subscription_checkout'
  | 'resolver_conflict';

/** What a deny log line carries. Ids and keys only: no metadata values, no customer data. */
export interface DenyDetail {
  readonly eventType: string;
  /** The invoice or session id. */
  readonly objectId: string | null;
  readonly priceIds: readonly string[];
  readonly lookupKeysMatched: readonly string[];
  readonly metadataKeys: readonly string[];
  readonly unpricedLines?: number;
  readonly amountPaid?: number | null;
  readonly livemode: boolean;
  /** For `resolver_conflict`: which flows were involved. */
  readonly flows?: readonly string[];
}

export type DispatchOutcome =
  | { readonly kind: 'not_business_os' }
  | { readonly kind: 'deny'; readonly reason: DenyReason; readonly detail: DenyDetail }
  | { readonly kind: 'flow'; readonly flow: BusinessOsFlow; readonly lookupKeys: readonly string[] };

export interface ResolverContext {
  readonly log: Logger;
}

export interface BusinessOsResolver {
  readonly flow: BusinessOsFlow;
  /** Pure apart from the price catalog read. Never resolves an account. */
  resolve(event: Stripe.Event, ctx: ResolverContext): Promise<DispatchOutcome>;
}

/** Thrown by the route when a recognised flow has no handler yet (P-1 to P-3a). */
export class BusinessOsHandlerMissingError extends Error {
  constructor(readonly flow: BusinessOsFlow) {
    super(`No Business OS handler is registered for flow '${flow}'`);
    this.name = 'BusinessOsHandlerMissingError';
  }
}

/**
 * Log level of each deny reason. `error` lines carry `alert: true`: they are
 * the v1 alert channel (requirement AM-9).
 */
const DENY_LEVEL: Readonly<Record<DenyReason, 'warn' | 'error'>> = {
  unknown_price: 'warn',
  no_priced_lines: 'warn',
  legacy_subscription_checkout: 'warn',
  mixed_prices: 'error',
  lines_truncated: 'error',
  metadata_mismatch: 'error',
  resolver_conflict: 'error',
};

export function denyLevel(reason: DenyReason): 'warn' | 'error' {
  return DENY_LEVEL[reason];
}

export const DEFAULT_RESOLVERS: readonly BusinessOsResolver[] = [planResolver];

export async function dispatchBusinessOsEvent(
  event: Stripe.Event,
  ctx: ResolverContext,
  resolvers: readonly BusinessOsResolver[] = DEFAULT_RESOLVERS
): Promise<DispatchOutcome> {
  // Connect events are client payments, not Business OS billing.
  if (event.account) return { kind: 'not_business_os' };

  // Sequential on purpose: a throw from any resolver must surface as-is.
  const outcomes: Array<{ flow: BusinessOsFlow; outcome: DispatchOutcome }> = [];
  for (const resolver of resolvers) {
    outcomes.push({ flow: resolver.flow, outcome: await resolver.resolve(event, ctx) });
  }

  const decided = outcomes.filter((o) => o.outcome.kind !== 'not_business_os');
  if (decided.length === 0) return { kind: 'not_business_os' };
  if (decided.length === 1) return decided[0].outcome;

  const flows = decided.map((o) => `${o.flow}:${o.outcome.kind}`);
  const object = event.data.object as { id?: string };
  ctx.log.error(
    { event: 'bos_billing_resolver_conflict', flows, alert: true },
    'Business OS billing: more than one resolver decided this event'
  );
  return {
    kind: 'deny',
    reason: 'resolver_conflict',
    detail: {
      eventType: event.type,
      objectId: object.id ?? null,
      priceIds: [],
      lookupKeysMatched: [],
      metadataKeys: [],
      livemode: event.livemode,
      flows,
    },
  };
}
