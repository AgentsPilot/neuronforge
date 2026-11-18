import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { buildStripePrefill, type BusinessFacts } from '@/lib/payments/stripePrefill';
import Stripe from 'stripe';

const logger = createLogger({ module: 'StripeAccountSession' });

/**
 * POST /api/payments/stripe-connect/account-session
 * Creates an Account Session for Stripe Connect embedded components.
 * This allows embedding Stripe's onboarding UI directly in our app.
 */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Get user's existing Stripe Connect account
    const { data: account, error: accountError } = await stripeConnectRepository.findByUserId(user.id);

    if (accountError || !account) {
      return NextResponse.json(
        { success: false, error: 'No Stripe account found. Please create one first.' },
        { status: 404 }
      );
    }

    requestLogger.info({ userId: user.id, stripeAccountId: account.stripe_account_id }, 'Creating account session');

    // 3. Create account session using Stripe SDK directly
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-10-29.clover' as any,
    });

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * BACKFILL WHAT WE KNOW, ON AN ACCOUNT THAT ALREADY EXISTS.
     *
     * Prefill used to happen at `accounts.create` and nowhere else, so an
     * account made before we learned a fact — or before the mapping that
     * derives it existed — stayed empty forever. Measured: `business_profile
     * .mcc` sat in Stripe's `currently_due` on an account whose owner had told
     * us their trade, because the industry table only covered five verticals
     * when that account was opened. Filling the table fixed new accounts and
     * did nothing for the one in front of the owner.
     *
     * HERE because this route runs immediately before the embedded form
     * mounts, every time it mounts. Whatever we can answer is answered a moment
     * before the owner would otherwise be asked.
     *
     * ── THE THREE RULES ──────────────────────────────────────────────────────
     *
     *   1. BUSINESS FACTS ONLY. `business_profile` is what the business does
     *      and where it lives on the web: name, url, industry, description.
     *      Nothing about a PERSON is written here — a date of birth, a home
     *      address or an ID number is an attestation by a named human, and
     *      pushing one silently in the background is not ours to do.
     *   2. ONLY WHAT IS BLANK. Each field is sent only when Stripe holds
     *      nothing for it, so an owner who corrected something inside Stripe's
     *      own form never has it overwritten by our older copy.
     *   3. NON-FATAL. A failure logs and the session is created anyway. This is
     *      a convenience; the form works without it, and an account session
     *      that refused to open over a missing industry code would be a far
     *      worse bug than the one it fixes.
     * ─────────────────────────────────────────────────────────────────────────
     */
    try {
      const { data: profile } = await businessProfileRepository.findByUserId(user.id);

      if (profile) {
        const current = await stripe.accounts.retrieve(account.stripe_account_id);
        /* Annotated, not inferred: `business_profile ?? {}` widens to a union
           with the empty object, and every field read below then fails
           against `{}`. Partial is the honest shape — Stripe returns the
           section with any subset of it filled. */
        const held: Partial<Stripe.Account.BusinessProfile> = current.business_profile ?? {};

        const prefill = buildStripePrefill({
          facts: profile as BusinessFacts,
          email: user.email,
          fullName: null,
          businessType: null,
          country: current.country ?? null,
          currency: null,
        });

        const wanted = prefill.businessProfile ?? {};
        const patch: Stripe.AccountUpdateParams.BusinessProfile = {};

        if (!held.mcc && wanted.mcc) patch.mcc = wanted.mcc;
        if (!held.name && wanted.name) patch.name = wanted.name;
        if (!held.url && wanted.url) patch.url = wanted.url;
        if (!held.product_description && wanted.product_description) {
          patch.product_description = wanted.product_description;
        }

        if (Object.keys(patch).length > 0) {
          await stripe.accounts.update(account.stripe_account_id, { business_profile: patch });
          requestLogger.info(
            { stripeAccountId: account.stripe_account_id, filled: Object.keys(patch) },
            'Backfilled what Stripe was missing from the business profile'
          );
        }
      }
    } catch (backfillError) {
      requestLogger.warn(
        { err: backfillError, stripeAccountId: account.stripe_account_id },
        'Could not backfill the business profile — the form will ask for it'
      );
    }

    const accountSession = await stripe.accountSessions.create({
      account: account.stripe_account_id,
      components: {
        account_onboarding: {
          enabled: true,
          features: {
            external_account_collection: true,
          },
        },
      },
      /*
       * ── WHERE "ONLY WHAT IS DUE NOW" IS SET, AND WHERE IT IS NOT ──────────
       *
       * Not here. `collection_options` is not an Account Session parameter —
       * it is a property of the embedded component itself, set in the browser
       * through `setCollectionOptions` on the `account-onboarding` instance
       * (see `StripeEmbeddedOnboarding`). Putting it in this call does not
       * merely fail to work: `accountSessions.create` rejects unknown
       * parameters, so it would take the whole onboarding form down.
       *
       * Left as a note rather than silence, because the session is the obvious
       * place to look for it and the next reader will look here first.
       */
    });

    requestLogger.info({ stripeAccountId: account.stripe_account_id }, 'Account session created');

    return NextResponse.json({
      success: true,
      clientSecret: accountSession.client_secret,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to create account session');

    return NextResponse.json(
      { success: false, error: 'Failed to create account session' },
      { status: 500 }
    );
  }
}
