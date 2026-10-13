/**
 * The caller's own plan — the read behind the "Your plan" settings section.
 *
 *   GET /api/business-os/entitlements/my-plan
 *
 * ── This is a customer route, and `requireAdmin` does NOT belong on it ──────
 * The admin entitlements endpoints (`/api/admin/business-os/entitlements/**`)
 * stay admin-only and are untouched. This is the normal signed-in-customer
 * pattern: `getUser()`, 401 when there is no session.
 *
 * ── THE TENANT ISOLATION PROPERTY, AND WHY IT IS STRUCTURAL ────────────────
 * **This handler accepts no input at all.** No path parameter, no query string,
 * no body. The account it resolves is `user.id` from the verified session and
 * there is no code path by which a caller can name a different one.
 *
 * That is deliberate and it is the whole isolation argument. The usual shape —
 * take an id, then check it belongs to the caller — puts one comparison between
 * a customer and somebody else's entitlements, and this is the first entitlement
 * data a non-admin can see. An endpoint that cannot be asked about another
 * account cannot leak one, however the check is later refactored.
 *
 * It is also why there is no Zod schema here: Zod validates input, and the
 * absence of input is the property being protected. `route.test.ts` asserts that
 * the handler never reads `nextUrl.searchParams` or a body, so the day somebody
 * adds `?accountId=` the test fails rather than the customer.
 *
 * ── Read-only (S-4a step 1), and still so with buying (plan payments P-4.2) ──
 * There is no POST and nothing here writes. Buying happens at the checkout
 * route; this read only DESCRIBES it, in `purchase` (`planPurchaseView.ts`):
 * what the owner may Choose (the same predicate the checkout refuses on), and
 * "Renews on" / "Ends on" from OUR billing record. That billing row is read by
 * the session user and the server key's mode, never by a request value, and no
 * Stripe call is made here (SR-11; SA W-9). For a paid tier, the plan's ending
 * sentence is replaced by the record's one when the record knows it (F-2). The plan read goes through `EntitlementService`, the only module
 * that talks to the entitlement repository; the reader's language is read
 * through `userPreferencesRepository.findLocale(user.id)`, the session user's
 * own row, never a caller-named one.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md §6.5 WS-2
 */

import { NextRequest, NextResponse } from 'next/server';

import { getUser } from '@/lib/auth';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { buildCustomerPlanView } from '@/lib/business-os/entitlements/customerPlanView';
import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n/config';
import { getEntitlementService } from '@/lib/business-os/entitlements/EntitlementService';
import { billingEndsWhen, readPlanPurchaseView } from '@/lib/business-os/billing/planPurchaseView';
import type { PlanPurchaseWire } from '@/lib/business-os/billing/planPurchaseTypes';
import { createLogger } from '@/lib/logger';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosMyPlanAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // The ONLY account this route can resolve. Not a parameter, by design.
    //
    // Through `resolveAccountId` rather than passing `user.id` straight in
    // (SA P-1). `AccountId` is `string`, so a raw user id type-checks
    // everywhere — which is why this is a seam and not a type. The day an
    // account stops being a user (T-2) one function changes instead of every
    // call site, and on THIS route the symptom of getting it wrong is a
    // customer shown somebody else's plan.
    const accountId = resolveAccountId(user.id);
    const snapshot = await getEntitlementService().getSnapshot(accountId);
    /*
     * The reader's language, from THEIR OWN session — never from the request.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * This started as `?lang=`, and the route's own guard test refused it: the
     * property it protects is that there is NOTHING to read here, so no
     * `?accountId=` can ever be honoured. Weakening "nothing to read" to
     * "nothing dangerous to read" on a tenant-isolation route, for copy, is the
     * wrong trade — so the language comes from the same verified session the
     * account id does.
     *
     * Only the config's LABELS need it — plan names and feature names, which are
     * data. The sentences travel as dictionary keys and are rendered by the
     * component, so they follow the same translations as every other screen and
     * change the instant the reader switches language.
     *
     * Unreadable means English. A plan section in the wrong language is a
     * nuisance; one that fails is a broken screen.
     *
     * `findLocale`, not `findPreferredLanguage`: this route has always matched
     * the stored value exactly against `isValidLocale`, and the latter trims and
     * lowercases first. The repository scopes by `user_id` and never throws, so
     * a failed read lands on the English fallback below.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: prefs, error: prefsError } = await userPreferencesRepository.findLocale(user.id);
    if (prefsError) {
      requestLogger.warn({ err: prefsError }, 'Preferred language unreadable; using the default');
    }

    const stored = prefs?.preferredLanguage;
    const locale: Locale = stored && isValidLocale(stored) ? stored : defaultLocale;

    const view = buildCustomerPlanView({
      resolution: snapshot.resolution,
      unavailable: snapshot.unavailable,
      locale,
    });

    /*
     * What may be bought, and what our billing record says (P-4.2). Keyed by the
     * SESSION user and the server key's mode inside the view; no Stripe call.
     * A failure here never hides the plan: the section then shows no Choose
     * button and the plan's own sentence.
     */
    let purchase: PlanPurchaseWire | null = null;
    try {
      purchase = await readPlanPurchaseView({ userId: user.id, accountId, snapshot });
    } catch (err) {
      requestLogger.warn({ err, event: 'bos_billing_purchase_view_failed' }, 'Purchase view unavailable; plan shown without it');
    }

    // F-2: a paid tier's "while the plan is paid for" becomes "Renews on" /
    // "Ends on" when our record knows the date. A free plan keeps its own.
    const recordEndsWhen = view.kind === 'tier' ? billingEndsWhen(purchase?.billing ?? null) : null;

    requestLogger.info(
      {
        userId: user.id,
        status: view.status,
        planId: view.planId,
        included: view.included.length,
        stale: snapshot.stale,
        offer: purchase ? purchase.offer.kind : null,
        billing: purchase?.billing?.state ?? null,
      },
      'Customer plan read'
    );

    return NextResponse.json({
      success: true,
      data: { ...view, endsWhen: recordEndsWhen ?? view.endsWhen, purchase },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read the customer plan');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not load your plan',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
