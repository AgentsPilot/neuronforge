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

    // Update our database
    await supabase
      .from('user_subscriptions')
      .upsert({
        user_id: userId,
        stripe_customer_id: customer.id
      }, {
        onConflict: 'user_id'
      });

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
