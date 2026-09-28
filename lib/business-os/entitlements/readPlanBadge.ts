import 'server-only';

/**
 * Read the plan pill for the signed-in customer.
 *
 * ── Why this is its own module and not a helper in the layout ────────────────
 * It was a private function inside `app/business-os/layout.tsx`, and QA-10 found
 * the consequence: **the three guarantees the pill's safety rests on had no
 * test**, because the only way to reach them was to render a layout. Two
 * mutations passed 29 tests green — replacing the `catch`'s `return null` with a
 * fallback label, and dropping the session check so the account id became the
 * literal `'anonymous'`.
 *
 * `planBadgeFor` was well covered. The untested part was the **caller**, and the
 * caller is where all three claims live. So the caller moved somewhere it can be
 * called.
 *
 * ── The three guarantees, each asserted in `readPlanBadge.test.ts` ───────────
 *
 *   1. **No session → no pill.** Nothing is read, and the account id is never
 *      invented. A fallback like `'anonymous'` would resolve *somebody* — an
 *      account id is a uuid, so it would resolve to nothing today, and the day it
 *      collides it is another tenant's plan in the chrome of every screen.
 *   2. **A throwing read → no pill.** Not a fallback label, not an error: the
 *      chrome of every screen is the worst place to surface a problem with a
 *      decorative label, and a WRONG label is a claim about what somebody is
 *      paying for.
 *   3. **The id goes through the account seam.** `resolveAccountId`, like every
 *      other caller — `accountSeam.guard` enforces it product-wide.
 *
 * ── Staleness, stated rather than fixed ─────────────────────────────────────
 * `EntitlementService` caches its inputs for 30 s, and Next's router cache holds
 * a rendered layout beyond that. For a champion that is harmless in every
 * direction but one: **when a champion lapses, the pill goes on saying "Founding
 * Partner" for the cache window.** It is small, it is admin-initiated (somebody
 * set an expiry, so somebody knows), and it errs toward generosity rather than
 * toward telling a customer they have lost something. Not worth a
 * cache-invalidation mechanism on a decorative label — but worth knowing before
 * anybody puts something load-bearing here.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md §6.5 WS-2
 */

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { resolveAccountId } from './account';
import { getEntitlementService } from './EntitlementService';
import { planBadgeFor, type PlanBadge } from './planBadge';

const logger = createLogger({ module: 'BusinessOsPlanBadgeRead' });

/** The pill for the current session, or `null` — which renders nothing. */
export async function readPlanBadge(): Promise<PlanBadge | null> {
  try {
    const user = await getUser();

    // No session, no pill. The account id is NEVER substituted or defaulted.
    if (!user) return null;

    const snapshot = await getEntitlementService().getSnapshot(resolveAccountId(user.id));

    return planBadgeFor(snapshot.resolution);
  } catch (error) {
    logger.warn({ err: error }, 'Plan badge unavailable; rendering the chrome without it');
    return null;
  }
}
