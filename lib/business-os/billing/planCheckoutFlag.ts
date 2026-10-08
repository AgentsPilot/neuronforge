/**
 * The server switch for the Business OS plan checkout (plan payments P-3a,
 * workplan §3.1, §3.7; SA Q-6 and the price-switch ruling).
 *
 * While it is off, `POST /api/business-os/billing/plan/checkout` answers 404
 * and reads nothing: no session, no database, no Stripe call.
 *
 * **Default: off** (unset, blank or anything unrecognised).
 *
 * ORDER WITH THE PRICE SWITCH. The checkout refuses (503, alert) unless
 * `BUSINESS_OS_PLAN_PRICES_ENABLED` is also on: money the webhook cannot
 * recognise must never be taken. So turn this on only where the price switch
 * is on and `npm run check-bos-plan-prices` passes, and never in production
 * before P-3b ships (requirement §9.5 row 15 turns it on there at go-live).
 *
 * Server-only: no `NEXT_PUBLIC_` prefix, so it is never compiled into a client
 * bundle. Reads the variable on every call, so a test or a redeploy changes it
 * without a module reload. Imports only the zero-import flag parser, as
 * `planPricesFlag.ts` does (P2b-Q1 precedent).
 *
 * @module lib/business-os/billing/planCheckoutFlag
 */

import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';

/** True when owners may open a plan checkout. Off by default. */
export function isPlanCheckoutEnabled(): boolean {
  return parseBooleanFlag(process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED, false);
}
