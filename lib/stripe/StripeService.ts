// lib/stripe/StripeService.ts
// Stripe service for custom credit purchases with recurring billing

import Stripe from 'stripe';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * StripeService
 *
 * Handles Stripe operations for NeuronForge billing:
 * - Custom credit amount purchases (not fixed plans)
 * - Recurring monthly billing at user's chosen amount
 * - One-time boost pack purchases
 * - Subscription management (increase/decrease amount, cancel)
 *
 * Business Model:
 * - User purchases $X worth of credits (e.g., $20 for 100K credits)
 * - This becomes a monthly recurring charge at $X
 * - User can adjust amount for next billing cycle
 * - All credits roll over completely
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
   * Get or create Stripe customer for user
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

    if (userSub?.stripe_customer_id) {
      // Verify customer exists in Stripe
      try {
        await this.stripe.customers.retrieve(userSub.stripe_customer_id);
        return userSub.stripe_customer_id;
      } catch (error) {
        console.warn('Customer not found in Stripe, creating new:', error);
        // Fall through to create new customer
      }
    }

    // Create new Stripe customer
    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: {
        user_id: userId
      }
    });

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
   * Create custom credit purchase with recurring billing
   *
   * User selects Pilot Credits → we calculate price from DB → recurs monthly
   * Example: 100,000 Pilot Credits → price calculated from ais_system_config
   *
   * Pricing: 1 Pilot Credit = 10 LLM tokens (from database)
   * Rate: Fetched from ais_system_config.pilot_credit_cost_usd
   */
  async createCustomCreditSubscription(params: {
    supabase: SupabaseClient;
    userId: string;
    email: string;
    name?: string;
    pilotCredits: number; // Number of Pilot Credits user wants monthly
    successUrl: string;
    cancelUrl: string;
    currency?: string; // Optional currency code (defaults to USD)
  }): Promise<Stripe.Checkout.Session> {
    const {
      supabase,
      userId,
      email,
      name,
      pilotCredits,
      successUrl,
      currency = 'usd' // Default to USD if not specified
    } = params;

    // Fetch pricing from database (ais_system_config table)
    const { data: configData } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit'])
      .limit(2);

    const configMap = new Map(configData?.map(c => [c.config_key, c.config_value]) || []);
    const pricePerCredit = parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048');

    // Calculate price in USD
    const amountUsd = pilotCredits * pricePerCredit;
    const credits = pilotCredits;

    // Get or create customer
    const customerId = await this.getOrCreateCustomer(supabase, userId, email, name);

    // Normalize currency code to lowercase for Stripe
    const stripeCurrency = currency.toLowerCase();

    // Create or get Stripe price for this amount
    // We'll create prices on-the-fly for custom amounts
    const price = await this.stripe.prices.create({
      currency: stripeCurrency,
      unit_amount: Math.round(amountUsd * 100), // Convert to cents (or smallest currency unit)
      recurring: {
        interval: 'month'
      },
      product_data: {
        name: `${credits.toLocaleString()} Pilot Credits`,
        metadata: {
          credits: credits.toString(),
          price_per_credit: pricePerCredit.toString(),
          description: `Monthly recurring: ${credits.toLocaleString()} Pilot Credits for $${amountUsd.toFixed(2)}`
        }
      },
      metadata: {
        user_id: userId,
        credits: credits.toString(),
        subscription_type: 'custom_credits'
      }
    });

    // Create checkout session with embedded UI support
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: price.id,
          quantity: 1
        }
      ],
      ui_mode: 'embedded', // Enable embedded checkout
      return_url: successUrl, // Fallback URL (won't be used with onComplete callback)
      metadata: {
        user_id: userId,
        credits: credits.toString(),
        amount_usd: amountUsd.toString()
      },
      subscription_data: {
        metadata: {
          user_id: userId,
          credits: credits.toString()
        }
      }
    });

    return session;
  }

  /**
   * Create one-time boost pack purchase
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
   * Update subscription to new amount
   * Hybrid proration: upgrades get immediate credits, downgrades wait until next cycle
   *
   * @param subscriptionId - Stripe subscription ID
   * @param newAmountUsd - New monthly amount in USD
   * @param pilotCredits - New monthly Pilot Credits amount (user-facing)
   * @param currentMonthlyAmountUsd - Current monthly amount in USD (for upgrade detection)
   */
  async updateSubscriptionAmount(
    subscriptionId: string,
    newAmountUsd: number,
    pilotCredits: number,
    currentMonthlyAmountUsd: number = 0
  ): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

    // Detect if this is an upgrade (higher amount) or downgrade (lower amount)
    const isUpgrade = newAmountUsd > currentMonthlyAmountUsd;

    console.log(`💡 [StripeService] Subscription update detected:`, {
      current: `$${currentMonthlyAmountUsd.toFixed(2)}`,
      new: `$${newAmountUsd.toFixed(2)}`,
      type: isUpgrade ? 'UPGRADE' : 'DOWNGRADE',
      prorationBehavior: isUpgrade ? 'always_invoice (immediate)' : 'none (next cycle)'
    });

    // Create new price for the new amount
    // Store Pilot Credits in metadata (not tokens)
    const newPrice = await this.stripe.prices.create({
      currency: 'usd',
      unit_amount: Math.round(newAmountUsd * 100),
      recurring: {
        interval: 'month'
      },
      product_data: {
        name: `${pilotCredits.toLocaleString()} Pilot Credits`,
        metadata: {
          credits: pilotCredits.toString(), // Pilot Credits (not tokens)
          description: `Monthly recurring: ${pilotCredits.toLocaleString()} Pilot Credits for $${newAmountUsd.toFixed(2)}`
        }
      },
      metadata: {
        credits: pilotCredits.toString() // Pilot Credits (not tokens)
      }
    });

    // Update subscription with new price
    // Hybrid proration: immediate for upgrades, next cycle for downgrades
    const updatedSubscription = await this.stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: newPrice.id
        }
      ],
      // Upgrades: Charge prorated amount immediately and allocate credits via invoice.paid webhook
      // Downgrades: Change takes effect at next billing cycle, no refund
      proration_behavior: isUpgrade ? 'always_invoice' : 'none',
      metadata: {
        ...subscription.metadata,
        credits: pilotCredits.toString(), // Update credits in subscription metadata
        pilot_credits: pilotCredits.toString() // Also store as pilot_credits for consistency
      }
    });

    return updatedSubscription;
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
