// lib/stripe/StripeService.ts
// Stripe service: platform customers, the agent platform's subscription
// lifecycle, and Stripe Connect.

import Stripe from 'stripe';
import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StripeService' });

/**
 * StripeService
 *
 * Handles Stripe operations for the platform:
 * - Platform customers (agent platform and Business OS)
 * - Agent-platform subscription lifecycle: portal, cancel, reactivate, invoices
 * - Webhook signature verification
 * - Stripe Connect accounts for Business OS client payments
 *
 * Plan payments P-10 removed the Pilot-Credit purchase side
 * (`createCustomCreditSubscription`, `updateSubscriptionAmount`): both minted
 * ad-hoc prices and had no caller left (reuse plan §4.6 *Dies*, L-9). The
 * boost-pack checkout is switched off but kept (Credits Boost FR-40).
 */
export class StripeService {
  private stripe: Stripe;

  constructor(stripeSecretKey: string) {
    if (!stripeSecretKey) {
      throw new Error('Stripe secret key is required');
    }
    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-10-29.clover'
    });
  }

  /**
   * Find or create a Stripe customer. Shared by the agent platform and
   * Business OS (plan payments P-2a, reuse plan Q-T8).
   *
   * Stripe only: no database access and no product-specific side effect. Each
   * product persists the returned id in its own record (agent platform:
   * `user_subscriptions`; Business OS: `business_os_billing_accounts`).
   *
   * Semantics are exactly the ones `getOrCreateCustomer` always had, so the
   * agent platform does not change (characterisation suite
   * `lib/stripe/__tests__/getOrCreateCustomer.characterisation.test.ts`):
   * - with `existingCustomerId`, the customer is retrieved; if the call
   *   resolves the id is reused, INCLUDING a customer deleted at Stripe
   *   (`{ deleted: true }`), a kept quirk (SA ruling Q-6);
   * - if the retrieve throws, it warns and falls through to create;
   * - otherwise it creates with exactly `{ email, name, metadata }`, and passes
   *   request options only when an idempotency key is given (the agent
   *   platform passes none: adding one would change its behaviour).
   *
   * `livemode` is `null` for a reused deleted customer: Stripe's
   * `DeletedCustomer` has no `livemode` field (SA P2-C3).
   *
   * Deliberately placed above `getOrCreateCustomer` and takes no database
   * client: the user_subscriptions lockdown guard reads the slice from
   * `getOrCreateCustomer` to `createBoostPackCheckout`, and only two methods
   * of this class may take one.
   */
  async findOrCreatePlatformCustomer(params: {
    existingCustomerId?: string | null;
    email: string;
    name?: string;
    metadata: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<{ customerId: string; created: boolean; livemode: boolean | null }> {
    const { existingCustomerId, email, name, metadata, idempotencyKey } = params;

    if (existingCustomerId) {
      // Verify customer exists in Stripe
      try {
        const retrieved = await this.stripe.customers.retrieve(existingCustomerId);
        return {
          customerId: existingCustomerId,
          created: false,
          livemode: retrieved.deleted ? null : retrieved.livemode,
        };
      } catch (error) {
        logger.warn({ err: error, customerId: existingCustomerId }, 'Stripe customer not found, creating a new one');
        // Fall through to create new customer
      }
    }

    // Create new Stripe customer. The two-argument form only with a key, so a
    // call without one is exactly the call the agent platform always made.
    const customer = idempotencyKey
      ? await this.stripe.customers.create({ email, name, metadata }, { idempotencyKey })
      : await this.stripe.customers.create({ email, name, metadata });

    return { customerId: customer.id, created: true, livemode: customer.livemode };
  }

  /**
   * Get or create Stripe customer for user (agent platform).
   *
   * The Stripe half lives in `findOrCreatePlatformCustomer`; this caller keeps
   * the `user_subscriptions` read and seed, with the statements unchanged (Q-T8).
   */
  async getOrCreateCustomer(
    supabase: SupabaseClient,
    userId: string,
    email: string,
    name?: string
  ): Promise<string> {
    // Check if customer already exists in our database
    const { data: userSub } = await supabase
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    // No idempotency key: the agent platform never sent one.
    const found = await this.findOrCreatePlatformCustomer({
      existingCustomerId: userSub?.stripe_customer_id,
      email,
      name,
      metadata: {
        user_id: userId
      }
    });

    if (!found.created) {
      return found.customerId;
    }

    // Named `customer` so the user_subscriptions statements below stay as they were.
    const customer = { id: found.customerId };

    // Update our database - only update stripe_customer_id on existing rows
    const { data: existing } = await supabase
      .from('user_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      // Update existing subscription with new customer ID
      await supabase
        .from('user_subscriptions')
        .update({ stripe_customer_id: customer.id })
        .eq('user_id', userId);
    } else {
      // Insert new subscription row with minimum required fields
      await supabase
        .from('user_subscriptions')
        .insert({
          user_id: userId,
          stripe_customer_id: customer.id,
          monthly_amount_usd: 10.00,
          monthly_credits: 20833
        });
    }

    return customer.id;
  }

  /**
   * Create one-time boost pack purchase
   *
   * NO CALLER since plan payments P-10. The AgentsPilot boost purchase is
   * switched off, not deleted (Credits Boost FR-40, user decision Q14):
   * `create-checkout` refuses every purchase with 410. This method, the
   * webhook's `boost_pack` branch and the `boost_packs` /
   * `boost_pack_purchases` tables are kept so the purchase can be revived.
   * Deleting any of them needs an SA-approved plan. A revival must pass the
   * service-role client (W-4) and add back a reviewed caller to the
   * user_subscriptions lockdown guard.
   */
  async createBoostPackCheckout(params: {
    supabase: SupabaseClient;
    userId: string;
    email: string;
    name?: string;
    boostPackId: string;
    successUrl: string;
    cancelUrl: string;
    currency?: string; // Optional currency code (defaults to USD)
  }): Promise<Stripe.Checkout.Session> {
    const {
      supabase,
      userId,
      email,
      name,
      boostPackId,
      successUrl,
      currency = 'usd' // Default to USD if not specified
    } = params;

    // Get boost pack details
    const { data: boostPack, error } = await supabase
      .from('boost_packs')
      .select('*')
      .eq('id', boostPackId)
      .single();

    if (error || !boostPack) {
      throw new Error('Boost pack not found');
    }

    // Use pre-calculated credits from database (no runtime calculation!)
    // Admin has already calculated and stored the correct values
    const totalCredits = boostPack.credits_amount + (boostPack.bonus_credits || 0);

    // Get or create customer
    const customerId = await this.getOrCreateCustomer(supabase, userId, email, name);

    // Normalize currency code to lowercase for Stripe
    const stripeCurrency = currency.toLowerCase();

    // Create checkout session for one-time payment with embedded UI support
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: stripeCurrency,
            unit_amount: Math.round(boostPack.price_usd * 100), // Convert to cents (or smallest currency unit)
            product_data: {
              name: boostPack.pack_name,
              description: `${totalCredits.toLocaleString()} Pilot Credits${boostPack.bonus_credits ? ` (includes ${boostPack.bonus_credits.toLocaleString()} bonus)` : ''}`,
              metadata: {
                boost_pack_id: boostPackId,
                credits: totalCredits.toString(),
                bonus_credits: (boostPack.bonus_credits || 0).toString()
              }
            }
          },
          quantity: 1
        }
      ],
      ui_mode: 'embedded', // Enable embedded checkout
      return_url: successUrl, // Fallback URL (won't be used with onComplete callback)
      metadata: {
        user_id: userId,
        boost_pack_id: boostPackId,
        credits: totalCredits.toString(),
        purchase_type: 'boost_pack'
      }
    });

    return session;
  }

  /**
   * Create customer portal session for subscription management
   */
  async createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<Stripe.BillingPortal.Session> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    });

    return session;
  }

  /**
   * Cancel subscription at period end
   */
  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });

    return subscription;
  }

  /**
   * Reactivate canceled subscription
   */
  async reactivateSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false
    });

    return subscription;
  }

  /**
   * Get subscription details
   */
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return await this.stripe.subscriptions.retrieve(subscriptionId);
  }

  /**
   * List customer invoices
   */
  async listInvoices(customerId: string, limit: number = 10): Promise<Stripe.Invoice[]> {
    const invoices = await this.stripe.invoices.list({
      customer: customerId,
      limit
    });

    return invoices.data;
  }

  /**
   * Every invoice Stripe considers paid since a moment, for reconciliation.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Stripe is the authority on "money arrived"; our tables are only a record of
   * it. This read exists so something can compare the two, because between
   * 2026-09-26 and 2026-10-05 they disagreed for fourteen payments and nothing
   * noticed: production held a signing secret no Stripe destination signs with,
   * so every delivery was refused with a 400 and the money was recorded nowhere.
   *
   * `accountId` is the connected account to ask, or `null` for the platform's
   * own. A direct charge on a connected account exists ONLY there, so asking
   * the platform about it returns nothing — see `lib/payments/stripeAccountContext`.
   *
   * Filters on `created` rather than on the moment of payment, because Stripe
   * offers no filter for the latter. An invoice created before the window can
   * still be paid inside it, so callers get `created >= createdSince` and must
   * narrow by `status_transitions.paid_at` themselves.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async listPaidInvoices(params: {
    accountId: string | null;
    createdSince: Date;
    limit?: number;
    startingAfter?: string;
  }): Promise<{ invoices: Stripe.Invoice[]; hasMore: boolean }> {
    const page = await this.stripe.invoices.list(
      {
        status: 'paid',
        created: { gte: Math.floor(params.createdSince.getTime() / 1000) },
        limit: params.limit ?? 100,
        ...(params.startingAfter ? { starting_after: params.startingAfter } : {}),
      },
      params.accountId ? { stripeAccount: params.accountId } : undefined
    );

    return { invoices: page.data, hasMore: page.has_more };
  }

  /**
   * Construct webhook event from raw body
   */
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
    webhookSecret: string
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  // ============================================
  // STRIPE CONNECT METHODS
  // For accepting payments from business clients
  // ============================================

  /**
   * Create Stripe Express account for new users
   * Express accounts are the simplest - Stripe handles all KYC/verification
   */
  async createExpressAccount(params: {
    email: string;
    country?: string;
    businessType?: 'individual' | 'company';
    businessProfile?: {
      name?: string;
      url?: string;
      mcc?: string; // Merchant Category Code (industry)
      product_description?: string;
    };
    individual?: {
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
      dob?: { day: number; month: number; year: number };
      address?: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postal_code?: string;
        country?: string;
      };
      ssn_last_4?: string;
    };
    // Note: tosAcceptance is NOT supported for Express accounts - Stripe handles TOS during hosted onboarding
  }): Promise<{ accountId: string }> {
    const accountParams: Stripe.AccountCreateParams = {
      type: 'express',
      email: params.email,
      country: params.country || 'US',
      business_type: params.businessType || 'individual',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    };

    // Add business profile if provided
    if (params.businessProfile) {
      accountParams.business_profile = {
        name: params.businessProfile.name,
        url: params.businessProfile.url,
        mcc: params.businessProfile.mcc,
        product_description: params.businessProfile.product_description,
      };
    }

    // Add individual details if provided (for individual business type)
    if (params.individual && params.businessType === 'individual') {
      accountParams.individual = {};

      if (params.individual.first_name) accountParams.individual.first_name = params.individual.first_name;
      if (params.individual.last_name) accountParams.individual.last_name = params.individual.last_name;
      if (params.individual.email) accountParams.individual.email = params.individual.email;
      if (params.individual.phone) accountParams.individual.phone = params.individual.phone;
      if (params.individual.dob) accountParams.individual.dob = params.individual.dob;
      if (params.individual.ssn_last_4) accountParams.individual.ssn_last_4 = params.individual.ssn_last_4;

      if (params.individual.address) {
        accountParams.individual.address = {
          line1: params.individual.address.line1,
          line2: params.individual.address.line2,
          city: params.individual.address.city,
          state: params.individual.address.state,
          postal_code: params.individual.address.postal_code,
          country: params.individual.address.country || params.country || 'US',
        };
      }
    }

    // Note: TOS acceptance is NOT allowed for Express accounts
    // Express accounts handle TOS acceptance during Stripe's hosted onboarding flow
    // Only Custom accounts with controller.requirement_collection = 'application' can accept TOS via API

    const account = await this.stripe.accounts.create(accountParams);

    return { accountId: account.id };
  }

  /**
   * Create Express account with minimal information
   * Stripe's embedded onboarding will collect everything else
   * This provides the simplest onboarding experience
   */
  async createExpressAccountMinimal(params: {
    email?: string;
    country?: string;
  }): Promise<{ accountId: string }> {
    const accountParams: Stripe.AccountCreateParams = {
      type: 'express',
      country: params.country || 'US',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    };

    // Only add email if provided
    if (params.email) {
      accountParams.email = params.email;
    }

    const account = await this.stripe.accounts.create(accountParams);

    return { accountId: account.id };
  }

  /**
   * Create Account Link for Express onboarding
   * This generates a URL where the user completes their Stripe setup
   */
  async createAccountLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
    type?: 'account_onboarding' | 'account_update';
  }): Promise<string> {
    const accountLink = await this.stripe.accountLinks.create({
      account: params.accountId,
      refresh_url: params.refreshUrl,
      return_url: params.returnUrl,
      type: params.type || 'account_onboarding',
    });

    return accountLink.url;
  }

  /**
   * Generate OAuth link for existing Stripe account owners (Standard accounts)
   */
  generateStandardOAuthLink(params: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const baseUrl = 'https://connect.stripe.com/oauth/authorize';
    const queryParams = new URLSearchParams({
      response_type: 'code',
      client_id: params.clientId,
      scope: 'read_write',
      redirect_uri: params.redirectUri,
      state: params.state,
    });

    return `${baseUrl}?${queryParams.toString()}`;
  }

  /**
   * Exchange OAuth authorization code for account access (Standard accounts)
   */
  async handleOAuthCallback(code: string): Promise<{
    accountId: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const response = await this.stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    return {
      accountId: response.stripe_user_id!,
      accessToken: response.access_token!,
      refreshToken: response.refresh_token!,
    };
  }

  /**
   * Retrieve account status from Stripe
   */
  async getConnectAccountStatus(accountId: string): Promise<{
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    country: string | null;
    defaultCurrency: string | null;
    businessType: string | null;
  }> {
    const account = await this.stripe.accounts.retrieve(accountId);

    return {
      chargesEnabled: account.charges_enabled || false,
      payoutsEnabled: account.payouts_enabled || false,
      detailsSubmitted: account.details_submitted || false,
      country: account.country || null,
      defaultCurrency: account.default_currency || null,
      businessType: account.business_type || null,
    };
  }

  /**
   * Generate Express Dashboard login link
   * Only works for Express accounts
   */
  async createExpressDashboardLink(accountId: string): Promise<string> {
    const loginLink = await this.stripe.accounts.createLoginLink(accountId);
    return loginLink.url;
  }

  /**
   * Delete a connected account from Stripe
   * Stripe recommends platform-initiated deletion via API
   */
  async deleteConnectedAccount(accountId: string): Promise<void> {
    await this.stripe.accounts.del(accountId);
  }

  /**
   * Get full account details from Stripe for pre-filling forms
   * Used when continuing onboarding to show what's already been provided
   */
  async getConnectAccountDetails(accountId: string): Promise<{
    email: string | null;
    country: string | null;
    businessType: string | null;
    businessProfile: {
      name: string | null;
      url: string | null;
      mcc: string | null;
    };
    individual: {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
      dob: { day: number; month: number; year: number } | null;
      address: {
        line1: string | null;
        line2: string | null;
        city: string | null;
        state: string | null;
        postalCode: string | null;
        country: string | null;
      } | null;
      ssnLast4Provided: boolean;
    } | null;
    requirements: {
      currentlyDue: string[];
      eventuallyDue: string[];
      pastDue: string[];
    };
  }> {
    const account = await this.stripe.accounts.retrieve(accountId);

    const individual = account.individual;
    const businessProfile = account.business_profile;

    return {
      email: account.email || null,
      country: account.country || null,
      businessType: account.business_type || null,
      businessProfile: {
        name: businessProfile?.name || null,
        url: businessProfile?.url || null,
        mcc: businessProfile?.mcc || null,
      },
      individual: individual ? {
        firstName: individual.first_name || null,
        lastName: individual.last_name || null,
        email: individual.email || null,
        phone: individual.phone || null,
        dob: individual.dob ? {
          day: individual.dob.day!,
          month: individual.dob.month!,
          year: individual.dob.year!,
        } : null,
        address: individual.address ? {
          line1: individual.address.line1 || null,
          line2: individual.address.line2 || null,
          city: individual.address.city || null,
          state: individual.address.state || null,
          postalCode: individual.address.postal_code || null,
          country: individual.address.country || null,
        } : null,
        ssnLast4Provided: individual.ssn_last_4_provided || false,
      } : null,
      requirements: {
        currentlyDue: account.requirements?.currently_due || [],
        eventuallyDue: account.requirements?.eventually_due || [],
        pastDue: account.requirements?.past_due || [],
      },
    };
  }

  /**
   * Update a connected account with additional information
   * Used to complete onboarding for Express accounts
   */
  async updateConnectedAccount(
    accountId: string,
    data: {
      businessProfile?: {
        name?: string;
        url?: string;
        mcc?: string;
      };
      individual?: {
        first_name?: string;
        last_name?: string;
        email?: string;
        phone?: string;
        dob?: {
          day: number;
          month: number;
          year: number;
        };
        address?: {
          line1?: string;
          line2?: string;
          city?: string;
          state?: string;
          postal_code?: string;
          country?: string;
        };
        ssn_last_4?: string;
      };
      tosAcceptance?: {
        date: number;
        ip: string;
      };
    }
  ): Promise<void> {
    const updateParams: Stripe.AccountUpdateParams = {};

    if (data.businessProfile) {
      updateParams.business_profile = {
        name: data.businessProfile.name,
        url: data.businessProfile.url,
        mcc: data.businessProfile.mcc,
      };
    }

    if (data.individual) {
      updateParams.individual = {
        first_name: data.individual.first_name,
        last_name: data.individual.last_name,
        email: data.individual.email,
        phone: data.individual.phone,
        dob: data.individual.dob,
        address: data.individual.address,
        ssn_last_4: data.individual.ssn_last_4,
      };
    }

    if (data.tosAcceptance) {
      updateParams.tos_acceptance = {
        date: data.tosAcceptance.date,
        ip: data.tosAcceptance.ip,
      };
    }

    await this.stripe.accounts.update(accountId, updateParams);
  }
}

// Export singleton instance (created with env var)
let stripeServiceInstance: StripeService | null = null;

export function getStripeService(): StripeService {
  if (!stripeServiceInstance) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    stripeServiceInstance = new StripeService(stripeKey);
  }
  return stripeServiceInstance;
}
