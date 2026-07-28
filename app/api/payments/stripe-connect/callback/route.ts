import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { getStripeService } from '@/lib/stripe/StripeService';
import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { cookies } from 'next/headers';

const logger = createLogger({ module: 'StripeConnectCallback' });
const auditTrail = AuditTrailService.getInstance();

/**
 * GET /api/payments/stripe-connect/callback
 * Handles return from Stripe after onboarding or OAuth
 *
 * Query params:
 * - type: 'onboarding' | 'oauth' | 'refresh'
 * - code: OAuth authorization code (for Standard accounts)
 * - state: CSRF token (for OAuth)
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const paymentsUrl = `${appUrl}/business-os/payments`;

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      // Redirect to login, then back to payments
      return NextResponse.redirect(`${appUrl}/login?redirect=/business-os/payments`);
    }

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    requestLogger.info({ type, hasCode: !!code, userId: user.id }, 'Processing Stripe Connect callback');

    // Handle OAuth errors
    if (error) {
      requestLogger.warn({ error, errorDescription }, 'OAuth error returned from Stripe');
      return NextResponse.redirect(`${paymentsUrl}?setup=error&message=${encodeURIComponent(errorDescription || error)}`);
    }

    const stripeService = getStripeService();
    const stripeConnectRepo = new StripeConnectRepository(supabaseServer);

    // Handle OAuth callback (Standard accounts)
    if (type === 'oauth' && code) {
      // Validate CSRF state token
      const cookieStore = await cookies();
      const savedState = cookieStore.get('stripe_oauth_state')?.value;

      if (!savedState || savedState !== state) {
        requestLogger.warn({ savedState: !!savedState, receivedState: !!state }, 'Invalid OAuth state token');
        return NextResponse.redirect(`${paymentsUrl}?setup=error&message=Invalid+security+token`);
      }

      // Exchange code for account access
      const { accountId } = await stripeService.handleOAuthCallback(code);

      requestLogger.info({ accountId }, 'OAuth callback successful, account connected');

      // Get account status from Stripe
      const status = await stripeService.getConnectAccountStatus(accountId);

      // Check if account already exists in our DB
      const existingAccount = await stripeConnectRepo.findByUserId(user.id);

      if (existingAccount.data) {
        // Update existing record
        await stripeConnectRepo.update(existingAccount.data.id, {
          stripe_account_id: accountId,
          stripe_account_type: 'standard',
          charges_enabled: status.chargesEnabled,
          payouts_enabled: status.payoutsEnabled,
          details_submitted: status.detailsSubmitted,
          onboarding_completed: status.chargesEnabled && status.payoutsEnabled,
          country: status.country,
          currency: status.defaultCurrency || 'USD',
        });
      } else {
        // Create new record
        await stripeConnectRepo.create({
          user_id: user.id,
          stripe_account_id: accountId,
          stripe_account_type: 'standard',
          charges_enabled: status.chargesEnabled,
          payouts_enabled: status.payoutsEnabled,
          details_submitted: status.detailsSubmitted,
          onboarding_completed: status.chargesEnabled && status.payoutsEnabled,
          country: status.country,
          currency: status.defaultCurrency || 'USD',
        });
      }

      // Clear OAuth state cookie
      const response = NextResponse.redirect(`${paymentsUrl}?setup=complete`);
      response.cookies.delete('stripe_oauth_state');

      // Audit log
      auditTrail.log({
        action: 'STRIPE_CONNECT_OAUTH_COMPLETED',
        userId: user.id,
        entityType: 'stripe_connect_account',
        entityId: accountId,
        details: { account_type: 'standard' },
      }).catch(err => requestLogger.error({ err }, 'Audit log failed'));

      return response;
    }

    // Handle Express onboarding return
    if (type === 'onboarding' || type === 'refresh' || !type) {
      // Get user's account from database
      const accountResult = await stripeConnectRepo.findByUserId(user.id);

      if (!accountResult.data) {
        requestLogger.warn('No Stripe Connect account found for user');
        return NextResponse.redirect(`${paymentsUrl}?setup=error&message=No+account+found`);
      }

      const accountId = accountResult.data.stripe_account_id;

      // Fetch latest status from Stripe
      const status = await stripeService.getConnectAccountStatus(accountId);

      requestLogger.info({ accountId, status }, 'Fetched account status from Stripe');

      // Update database with current status
      await stripeConnectRepo.update(accountResult.data.id, {
        charges_enabled: status.chargesEnabled,
        payouts_enabled: status.payoutsEnabled,
        details_submitted: status.detailsSubmitted,
        onboarding_completed: status.chargesEnabled && status.payoutsEnabled,
        country: status.country,
        currency: status.defaultCurrency || 'USD',
        business_type: status.businessType,
      });

      // Determine setup status for redirect
      const setupStatus = status.chargesEnabled && status.payoutsEnabled
        ? 'complete'
        : status.detailsSubmitted
          ? 'pending'
          : 'incomplete';

      // Audit log
      auditTrail.log({
        action: 'STRIPE_CONNECT_ONBOARDING_RETURN',
        userId: user.id,
        entityType: 'stripe_connect_account',
        entityId: accountId,
        details: {
          status: setupStatus,
          charges_enabled: status.chargesEnabled,
          payouts_enabled: status.payoutsEnabled,
        },
      }).catch(err => requestLogger.error({ err }, 'Audit log failed'));

      return NextResponse.redirect(`${paymentsUrl}?setup=${setupStatus}`);
    }

    // Unknown type
    requestLogger.warn({ type }, 'Unknown callback type');
    return NextResponse.redirect(paymentsUrl);

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to process Stripe Connect callback');
    return NextResponse.redirect(`${paymentsUrl}?setup=error&message=Something+went+wrong`);
  }
}
