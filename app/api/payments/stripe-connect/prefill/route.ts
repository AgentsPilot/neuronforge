/**
 * What we would send Stripe, before we send it.
 *
 * GET /api/payments/stripe-connect/prefill
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two screens read this. The first asks the owner to confirm the country, which
 * is the one answer `accounts.create` fixes forever; the second shows the facts
 * we already hold so they confirm rather than retype them inside Stripe's form.
 *
 * It returns only what the owner typed themselves, back to the same owner, so
 * there is nothing here they cannot already see in Settings. The Stripe payload
 * itself is assembled server-side at creation time from the same builder — the
 * client never posts business facts back to us, because it has no business
 * being the authority on them.
 *
 * @module app/api/payments/stripe-connect/prefill
 */

import { NextRequest, NextResponse } from 'next/server';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { buildStripePrefill, stripeReadiness, type BusinessFacts } from '@/lib/payments/stripePrefill';
import { settlementCurrencyFor } from '@/lib/payments/countryCurrency';
import { isSupportedCountry } from '@/lib/payments/stripeCountries';

const logger = createLogger({ module: 'StripeConnectPrefill' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile, error } = await businessProfileRepository.findByUserId(user.id);

    if (error) {
      /*
       * A profile we cannot read is not a failure of this screen: the owner can
       * still pick a country and connect with nothing prefilled, which is
       * exactly today's behaviour. So this answers with empty facts rather than
       * an error the dialog would have to render.
       */
      requestLogger.warn({ err: error, userId: user.id }, 'Business profile unreadable, offering empty prefill');
    }

    const facts = (profile as BusinessFacts | null) ?? null;

    /*
     * Both optional, and both change the answer.
     *
     * The first call has neither: the screen has not asked yet, and it is
     * fetching the suggestions. The confirm step calls again WITH them, so the
     * facts it lists are exactly the ones about to be sent — which block Stripe
     * will read depends on the business type, and whether a payout account can
     * be built depends on the country.
     */
    const askedCountry = request.nextUrl.searchParams.get('country');
    const askedType = request.nextUrl.searchParams.get('business_type');
    const businessType = askedType === 'individual' || askedType === 'company' ? askedType : null;
    const country = isSupportedCountry(askedCountry) ? (askedCountry as string).toUpperCase() : null;

    /*
     * The gate. Returned so the screen can say exactly what is missing and
     * where to fix it, and enforced again in `create-minimal` so a client that
     * skips this screen cannot open an account on an empty profile.
     */
    const readiness = stripeReadiness(facts);

    const prefill = buildStripePrefill({
      facts,
      email: user.email,
      fullName:
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null,
      businessType,
      country,
      currency: settlementCurrencyFor(country),
    });

    /*
     * A suggestion we cannot open an account in is no suggestion. Stripe would
     * refuse the code and the picker could not show it, so the screen asks
     * instead of offering something unusable.
     */
    const suggestedCountry = isSupportedCountry(prefill.suggestedCountry)
      ? prefill.suggestedCountry
      : null;

    requestLogger.info(
      {
        userId: user.id,
        suggestedCountry,
        countrySource: suggestedCountry ? prefill.countrySource : null,
        knownCount: prefill.known.length,
        blockers: readiness.blockers,
        canConnect: readiness.canConnect,
        businessType,
        suggestedBusinessType: prefill.suggestedBusinessType,
        bankPrefillable: Boolean(prefill.externalAccount),
      },
      'Stripe prefill assembled'
    );

    return NextResponse.json({
      success: true,
      data: {
        suggestedCountry,
        countrySource: suggestedCountry ? prefill.countrySource : null,
        /** What that country means for payouts, shown beside the picker. */
        currency: settlementCurrencyFor(suggestedCountry),
        known: prefill.known,
        /** So the screen can say how much Stripe will not have to ask for. */
        knownCount: prefill.known.length,
        /**
         * Sole trader or company, as the facts imply. Null means the screen
         * must ask: getting it wrong sends the whole prefill into the block
         * Stripe does not read.
         */
        suggestedBusinessType: prefill.suggestedBusinessType,
        /** True only when the bank details on file will actually be sent. */
        bankPrefillable: Boolean(prefill.externalAccount),
        /** The gate: what must be completed first, and what merely helps. */
        blockers: readiness.blockers,
        nudges: readiness.nudges,
        canConnect: readiness.canConnect,
      },
    });
  } catch (err) {
    requestLogger.error({ err }, 'Failed to assemble Stripe prefill');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not read your business details',
        details: process.env.NODE_ENV === 'development' ? String(err) : undefined,
      },
      { status: 500 }
    );
  }
}
