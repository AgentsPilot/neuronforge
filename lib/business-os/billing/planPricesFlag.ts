/**
 * The server switch for plan-price recognition (plan payments P-2b, merge
 * safety; user decision of 2026-10-06 to build against the "AgentsPilot
 * sandbox" Stripe account).
 *
 * WHY IT EXISTS. P-2b fills the plan lookup keys. With the keys filled, every
 * platform `invoice.paid` / `invoice.payment_failed` makes the webhook ask the
 * Stripe account behind `STRIPE_SECRET_KEY` for those prices. The prices were
 * created in the sandbox, not in production's Stripe account, and production's
 * account gets them only at its own setup (go-live checklist). Until then a
 * filled list in production would log `bos_billing_lookup_key_missing` at
 * `error` with an alert on every catalog load, for no gain.
 *
 * So the catalog uses the configured keys only while this switch is on.
 * **Default: off** (unset, blank or anything unrecognised). Off is exactly
 * P-1's behaviour: no key, no Stripe call, every platform plan invoice denied.
 *
 * Turn it on in an environment only after `npm run check-bos-plan-prices`
 * PASSES against that environment's Stripe account (local: the sandbox;
 * production: production's account, when it has the prices).
 *
 * UNTIL P-3b SHIPS (SA P-2b review F-1): no plan handler is registered, so
 * while this is on, a RECOGNISED plan invoice is logged
 * `bos_billing_plan_unhandled`, the claim is released and the webhook answers
 * 500, and Stripe retries that event for days. So keep it OFF in production
 * until P-3b ships, unless that retry loop is intended (the P-3a demo).
 *
 * Server-only: no `NEXT_PUBLIC_` prefix, so it is never compiled into a client
 * bundle. Reads the variable on every call, so a test or a redeploy changes it
 * without a module reload. Imports only the zero-import flag parser.
 *
 * @module lib/business-os/billing/planPricesFlag
 */

import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';

/** True when the catalog may recognise plan prices. Off by default. */
export function isPlanPriceRecognitionEnabled(): boolean {
  return parseBooleanFlag(process.env.BUSINESS_OS_PLAN_PRICES_ENABLED, false);
}
