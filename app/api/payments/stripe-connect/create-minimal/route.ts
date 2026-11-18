/**
 * Create a Stripe Connect Account
 * POST /api/payments/stripe-connect/create-minimal
 *
 * Creates a Stripe Express account, then hands the owner to Stripe's embedded
 * onboarding for identity and bank details.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "MINIMAL" USED TO MEAN "EMPTY"
 *
 * This sent a country and an email and nothing else, on the reasoning that
 * Stripe's form would collect the rest. It does — by asking the owner for a
 * business name, website, phone, address, industry and description that are all
 * sitting in `business_profiles`, typed during setup. So the account is still
 * created here with as little ceremony as possible, but everything we already
 * know goes with it (`buildStripePrefill`), and Stripe asks only for what it
 * alone can collect.
 *
 * ── THE PREFILL CANNOT BREAK CONNECTING ─────────────────────────────────────
 * `accounts.create` rejects the whole call over one field it dislikes — an MCC
 * off its list, a malformed phone number. Prefill is a convenience, so a
 * refusal of that shape is retried with no prefill at all rather than shown to
 * the owner: worst case they get exactly the experience they got before.
 *
 * ── AND THE COUNTRY IS NO LONGER ASSUMED ────────────────────────────────────
 * It was `.default('US')` here and a hardcoded `'US'` at the one call site, so
 * every account ever created on this platform is American. `accounts.country`
 * is immutable, the settlement currency follows from it, and an Israeli
 * business pricing in shekels could not be paid at all. It is now required, and
 * must be a country we actually support.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { settlementCurrencyFor } from '@/lib/payments/countryCurrency';
import { isSupportedCountry } from '@/lib/payments/stripeCountries';
import { buildStripePrefill, stripeReadiness, type BusinessFacts } from '@/lib/payments/stripePrefill';

const logger = createLogger({ module: 'StripeConnectCreateMinimal' });
const auditTrail = AuditTrailService.getInstance();

const createMinimalSchema = z.object({
  /*
   * Required, and checked against the list the picker offers. No default: the
   * caller has just asked the owner this question, and a server-side fallback
   * would quietly undo the one screen that exists to prevent an unfixable
   * account.
   */
  country: z
    .string()
    .length(2)
    .refine(isSupportedCountry, { message: 'Unsupported country for a Stripe account' }),
  /*
   * Sole trader or company. Required for the same reason as the country: it
   * decides which object Stripe reads, and it was hardcoded to 'individual'.
   * A live company account therefore received five fields in the block Stripe
   * ignores, and its owner retyped the address and the EIN we already held.
   */
  business_type: z.enum(['individual', 'company']),
});

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

    // 2. Parse input (the country, which the caller has just asked the owner)
    const body = await request.json().catch(() => ({}));
    const validated = createMinimalSchema.parse(body);

    requestLogger.info({ userId: user.id, country: validated.country }, 'Creating minimal Stripe Connect account');

    const stripeService = getStripeService();
    const stripeConnectRepo = new StripeConnectRepository(supabaseServer);

    // 3. Check if user already has a Stripe Connect account
    const existingAccount = await stripeConnectRepo.findByUserId(user.id);

    // Check if existing account is a mock/test account that should be replaced
    const isMockAccount = (accountId: string) => accountId.includes('mock') || accountId.includes('test_placeholder');

    if (existingAccount.data && !isMockAccount(existingAccount.data.stripe_account_id)) {
      // Real account exists - return it so embedded onboarding can continue
      requestLogger.info({ existingAccountId: existingAccount.data.stripe_account_id }, 'User has existing account, returning for continuation');
      return NextResponse.json({
        success: true,
        accountId: existingAccount.data.stripe_account_id,
        isExisting: true,
        message: 'Existing account found. Continue with embedded onboarding.',
      });
    }

    // If mock account exists, delete it first so we can create a real one
    if (existingAccount.data && isMockAccount(existingAccount.data.stripe_account_id)) {
      requestLogger.warn({ mockAccountId: existingAccount.data.stripe_account_id }, 'Deleting mock Stripe account to replace with real account');
      await supabaseServer
        .from('stripe_connect_accounts')
        .delete()
        .eq('user_id', user.id);
    }

    /*
     * 4. Everything we already know, so Stripe does not ask for it again.
     *
     * Read here rather than accepted from the client: these are facts about the
     * business and the client has no authority over them. An unreadable profile
     * is not an error — it means no prefill, which is the old behaviour.
     */
    const { data: profile, error: profileError } = await businessProfileRepository.findByUserId(user.id);
    if (profileError) {
      requestLogger.warn({ err: profileError, userId: user.id }, 'Business profile unreadable, creating without prefill');
    }

    const facts = (profile as BusinessFacts | null) ?? null;

    /*
     * ── THE GATE ──────────────────────────────────────────────────────────────
     *
     * An account opened on an empty profile is worse than no account. Stripe
     * fixes the country at creation from an address we do not have, bills under
     * a business name we cannot supply, and asks the owner for all of it inside
     * a form where we can neither explain the questions nor keep the answers
     * consistent with their invoices.
     *
     * Enforced HERE as well as on the screen, because a gate the browser can
     * skip is a suggestion. 409 rather than 400: nothing is wrong with the
     * request, the account is simply not in a state where this can proceed, and
     * the blockers are named so the caller can say which.
     *
     * Deliberately AFTER the existing-account return above: an owner who is
     * continuing an onboarding they already started is never blocked by a
     * profile field that has since been emptied.
     */
    const readiness = stripeReadiness(facts);
    if (!readiness.canConnect) {
      requestLogger.warn(
        { userId: user.id, blockers: readiness.blockers },
        'Refusing to create a Stripe account on an incomplete business profile'
      );

      return NextResponse.json(
        {
          success: false,
          error: 'Your business details are incomplete',
          blockers: readiness.blockers,
        },
        { status: 409 }
      );
    }

    const currency = settlementCurrencyFor(validated.country);

    const prefill = buildStripePrefill({
      facts,
      email: user.email,
      fullName:
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null,
      businessType: validated.business_type,
      country: validated.country,
      currency,
    });

    /*
     * `createExpressAccount` takes a required email, and applies `individual`
     * only when `businessType` is passed EXPLICITLY — its own default does not
     * satisfy the check, so omitting it silently drops the whole prefill. An
     * owner without an email takes the minimal path rather than sending Stripe
     * an empty string.
     */
    const hasPrefill =
      Boolean(user.email) &&
      Boolean(prefill.businessProfile || prefill.individual || prefill.company);

    const createPrefilled = (withBank: boolean) =>
      stripeService.createExpressAccount({
        email: user.email as string,
        country: validated.country,
        businessType: validated.business_type,
        businessProfile: prefill.businessProfile,
        individual: prefill.individual,
        company: prefill.company,
        externalAccount: withBank ? prefill.externalAccount : undefined,
      });

    const createBare = () =>
      stripeService.createExpressAccountMinimal({
        email: user.email || undefined,
        country: validated.country,
      });

    let accountId: string;
    let prefillApplied = hasPrefill;
    let bankApplied = hasPrefill && Boolean(prefill.externalAccount);

    try {
      accountId = hasPrefill ? (await createPrefilled(true)).accountId : (await createBare()).accountId;
    } catch (createError) {
      if (!hasPrefill) throw createError;

      /*
       * ── DEGRADE IN STEPS, NOT STRAIGHT TO NOTHING ─────────────────────────
       *
       * `accounts.create` rejects the whole call over one field it dislikes, so
       * a single bad value used to cost the owner every prefilled field. The
       * bank account is by far the likeliest offender — it is parsed out of
       * free text meant for printing on an invoice — so it is dropped first and
       * the rest is kept. Only if Stripe still refuses does everything go.
       */
      if (bankApplied) {
        requestLogger.warn(
          { err: createError, country: validated.country },
          'Account creation refused with a payout account, retrying without the bank details'
        );
        try {
          accountId = (await createPrefilled(false)).accountId;
          bankApplied = false;
        } catch (secondError) {
          requestLogger.warn(
            { err: secondError, country: validated.country },
            'Prefilled account creation refused, retrying with no prefill'
          );
          accountId = (await createBare()).accountId;
          prefillApplied = false;
          bankApplied = false;
        }
      } else {
        requestLogger.warn(
          { err: createError, country: validated.country },
          'Prefilled account creation refused, retrying with no prefill'
        );
        accountId = (await createBare()).accountId;
        prefillApplied = false;
      }
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE SIGNER, FOR A COMPANY, AFTER THE ACCOUNT EXISTS.
     *
     * A company account carries no `individual` block, so until now everything
     * we knew about the human was dropped on that path and "Verify your
     * personal details" opened with every field empty — a name and a phone
     * number retyped from our own tables.
     *
     * A SEPARATE CALL because Stripe models the signer as a Person rather than
     * a field on the account, and it needs the account id to attach to.
     *
     * NON-FATAL, and that is the whole reason it sits outside the try/catch
     * ladder above: this is prefill, a convenience. The account is already
     * created and already works. A refusal here costs three typed fields; a
     * refusal that propagated would cost an owner the account they just made,
     * which is the trade the degrade-in-steps block above exists to refuse.
     *
     * Skipped entirely when the prefill was abandoned: if Stripe would not take
     * the company block, sending the person from the same source invites the
     * same rejection for no gain.
     */
    let representativeApplied = false;
    if (validated.business_type === 'company' && prefillApplied && prefill.representative) {
      try {
        await stripeService.createAccountRepresentative({
          accountId,
          firstName: prefill.representative.first_name,
          lastName: prefill.representative.last_name,
          email: prefill.representative.email,
          phone: prefill.representative.phone,
        });
        representativeApplied = true;
      } catch (representativeError) {
        requestLogger.warn(
          { err: representativeError, accountId },
          'Could not prefill the account representative — onboarding will ask for it'
        );
      }
    }

    requestLogger.info(
      {
        accountId,
        country: validated.country,
        businessType: validated.business_type,
        prefillApplied,
        bankApplied,
        representativeApplied,
        knownCount: prefill.known.length,
      },
      'Stripe Express account created'
    );

    // 5. Save account to database
    const saveResult = await stripeConnectRepo.create({
      user_id: user.id,
      stripe_account_id: accountId,
      stripe_account_type: 'express',
      stripe_email: user.email || null,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      onboarding_completed: false,
      country: validated.country,
      /*
       * `country === 'US' ? 'USD' : 'EUR'` stood here for twenty-four
       * countries, so every non-US account was filed as euros — shekels,
       * pounds and yen included. The helper answers null rather than guessing.
       */
      currency,
      /*
       * The three columns this insert never named, which the row type requires.
       *
       * `business_type` we now actually know, because the prefill above tells
       * Stripe the same thing — it was simply never written, so every account
       * created through this route read as an unknown business type (the same
       * gap `create-account-custom` already closed). The two pause columns are
       * an owner's own decision to stop taking cards, which has not happened
       * at creation: null means cards are on.
       */
      business_type: validated.business_type,
      paused_at: null,
      paused_by: null,
    });

    if (saveResult.error) {
      requestLogger.error({ err: saveResult.error }, 'Failed to save Stripe Connect account to database');
      // Continue anyway - account was created in Stripe
    }

    // 6. Audit log (non-blocking)
    auditTrail.log({
      action: 'STRIPE_CONNECT_ACCOUNT_CREATED',
      userId: user.id,
      entityType: 'stripe_connect_account',
      entityId: accountId,
      details: {
        account_type: 'express',
        country: validated.country,
        currency: settlementCurrencyFor(validated.country),
        minimal_onboarding: true,
        /* Whether the owner's own details went with it, and how many — the
           country is immutable, so this record is the only account of what the
           account was opened with. */
        business_type: validated.business_type,
        prefill_applied: prefillApplied,
        prefill_fields: prefillApplied ? prefill.known.length : 0,
        /* Whether the payout account went with it, so a "why am I being asked
           for my bank again" question has an answer in the record. */
        bank_prefilled: bankApplied,
      },
    }).catch(err => requestLogger.error({ err }, 'Audit log failed'));

    return NextResponse.json({
      success: true,
      accountId,
      isExisting: false,
      country: validated.country,
      currency: settlementCurrencyFor(validated.country),
      prefillApplied,
      bankApplied,
      message: 'Account created. Complete setup with embedded onboarding.',
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ zodErrors: error.errors }, 'Validation failed');
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Failed to create minimal Stripe Connect account');

    return NextResponse.json(
      { success: false, error: 'Failed to create payment account' },
      { status: 500 }
    );
  }
}
