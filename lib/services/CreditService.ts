// lib/services/CreditService.ts
// Core credit management service for Smart Fuel Auto-Plan pricing

import { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe/stripe';
import Stripe from 'stripe';

export interface CalculatorInputs {
  agents: number;
  plugins: number;
  frequency: 'low' | 'medium' | 'high' | 'very_high';
}

export interface CreditBalance {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  monthlyAmount: number;
  monthlyCredits: number;
  status: string;
  agentsPaused: boolean;
}

export class CreditService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Initialize new user with free trial credits
   */
  async initializeUser(userId: string, stripeCustomerId?: string): Promise<void> {
    console.log('🎁 Initializing user with trial credits:', userId);

    const { error: insertError } = await this.supabase
      .from('user_subscriptions')
      .insert({
        user_id: userId,
        balance: 1000,
        total_earned: 0,
        total_spent: 0,
        trial_credits_granted: 1000,
        free_trial_used: true,
        monthly_amount_usd: 0,
        monthly_credits: 0,
        subscription_type: 'dynamic',
        stripe_customer_id: stripeCustomerId,
        status: 'trial'
      });

    if (insertError) {
      console.error('Error initializing user credits:', insertError);
      throw insertError;
    }

    // Log trial credit transaction
    await this.supabase.from('credit_transactions').insert({
      user_id: userId,
      credits_delta: 1000,
      balance_before: 0,
      balance_after: 1000,
      transaction_type: 'trial',
      description: 'Welcome! 1,000 free trial credits',
      metadata: {
        trial_type: 'signup_bonus'
      }
    });

    // Log billing event
    await this.supabase.from('billing_events').insert({
      user_id: userId,
      event_type: 'trial_granted',
      credits_delta: 1000,
      description: 'New user trial credits granted'
    });

    console.log('✅ User initialized with 1,000 trial credits');
  }

  /**
   * Get user's current credit balance
   */
  async getBalance(userId: string): Promise<CreditBalance> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('balance, total_earned, total_spent, monthly_amount_usd, monthly_credits, status, agents_paused')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new Error('User subscription not found');
    }

    return {
      balance: data.balance || 0,
      totalEarned: data.total_earned || 0,
      totalSpent: data.total_spent || 0,
      monthlyAmount: data.monthly_amount_usd || 0,
      monthlyCredits: data.monthly_credits || 0,
      status: data.status || 'inactive',
      agentsPaused: data.agents_paused || false
    };
  }

  /**
   * Check if user has sufficient credits
   */
  async checkSufficientBalance(userId: string, requiredCredits: number = 1): Promise<{ sufficient: boolean; balance: number }> {
    const { balance } = await this.getBalance(userId);
    return {
      sufficient: balance >= requiredCredits,
      balance
    };
  }

  /**
   * Create dynamic subscription from calculator
   */
  async createSubscription(
    userId: string,
    monthlyCredits: number,
    calculatorInputs: CalculatorInputs
  ): Promise<Stripe.Subscription> {
    console.log('💳 Creating subscription for user:', userId, { monthlyCredits });

    // Fetch pricing config from database
    const { AISConfigService } = await import('./AISConfigService');
    const PILOT_CREDIT_COST = await AISConfigService.getSystemConfig(
      this.supabase,
      'pilot_credit_cost_usd',
      0.00048
    );
    const MIN_SUBSCRIPTION_USD = await AISConfigService.getSystemConfig(
      this.supabase,
      'min_subscription_usd',
      10.00
    );

    // Apply minimum credits based on minimum subscription amount
    const minimumCredits = Math.ceil(MIN_SUBSCRIPTION_USD / PILOT_CREDIT_COST);
    const finalMonthlyCredits = Math.max(monthlyCredits, minimumCredits);

    // Calculate amount from credits
    const amountUsd = finalMonthlyCredits * PILOT_CREDIT_COST;

    // Get or create Stripe customer
    const { data: userSub } = await this.supabase
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    let customerId = userSub?.stripe_customer_id;

    if (!customerId) {
      // Get user email
      const { data: user } = await this.supabase.auth.getUser();
      const customer = await stripe.customers.create({
        email: user.user?.email,
        metadata: { user_id: userId }
      });
      customerId = customer.id;

      await this.supabase
        .from('user_subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', userId);
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{
        price_data: {
          currency: 'usd',
          product: process.env.STRIPE_PILOT_CREDITS_PRODUCT_ID!,
          unit_amount: Math.ceil(amountUsd * 100),
          recurring: { interval: 'month' }
        }
      }],
      metadata: {
        user_id: userId,
        monthly_credits: finalMonthlyCredits.toString(),
        subscription_type: 'dynamic',
        calculator_inputs: JSON.stringify(calculatorInputs)
      }
    });

    // Update user subscription
    await this.supabase
      .from('user_subscriptions')
      .update({
        monthly_amount_usd: amountUsd,
        monthly_credits: finalMonthlyCredits,
        stripe_subscription_id: subscription.id,
        status: 'active',
        last_calculator_inputs: calculatorInputs
      })
      .eq('user_id', userId);

    // Log billing event
    await this.supabase.from('billing_events').insert({
      user_id: userId,
      event_type: 'subscription_created',
      stripe_event_id: subscription.id,
      amount_cents: Math.ceil(amountUsd * 100),
      description: `Subscription created: $${amountUsd.toFixed(2)}/month for ${finalMonthlyCredits.toLocaleString()} credits`,
      metadata: {
        monthly_credits: finalMonthlyCredits,
        requested_credits: monthlyCredits,
        calculator_inputs: calculatorInputs
      }
    });

    console.log('✅ Subscription created:', subscription.id);
    return subscription;
  }

  /**
   * Update existing subscription
   */
  async updateSubscription(
    userId: string,
    newMonthlyCredits: number,
    calculatorInputs?: CalculatorInputs
  ): Promise<void> {
    console.log('🔄 Updating subscription for user:', userId);

    const { data: current } = await this.supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!current?.stripe_subscription_id) {
      throw new Error('No active subscription found');
    }

    // Fetch pricing config from database
    const { AISConfigService } = await import('./AISConfigService');
    const PILOT_CREDIT_COST = await AISConfigService.getSystemConfig(
      this.supabase,
      'pilot_credit_cost_usd',
      0.00048
    );
    const MIN_SUBSCRIPTION_USD = await AISConfigService.getSystemConfig(
      this.supabase,
      'min_subscription_usd',
      10.00
    );

    const newAmountUsd = Math.max(newMonthlyCredits * PILOT_CREDIT_COST, MIN_SUBSCRIPTION_USD);
    const currentAmountUsd = current.monthly_amount_usd;

    // Only update if significant change (> $1)
    if (Math.abs(newAmountUsd - currentAmountUsd) < 1.00) {
      console.log('⏭️ Skipping update - change too small');
      return;
    }

    // Update Stripe subscription
    const subscription = await stripe.subscriptions.retrieve(current.stripe_subscription_id);
    await stripe.subscriptions.update(current.stripe_subscription_id, {
      items: [{
        id: subscription.items.data[0].id,
        price_data: {
          currency: 'usd',
          product: process.env.STRIPE_PILOT_CREDITS_PRODUCT_ID!,
          unit_amount: Math.ceil(newAmountUsd * 100),
          recurring: { interval: 'month' }
        }
      }],
      proration_behavior: 'always_invoice',
      metadata: {
        ...subscription.metadata,
        monthly_credits: newMonthlyCredits.toString(),
        calculator_inputs: calculatorInputs ? JSON.stringify(calculatorInputs) : subscription.metadata.calculator_inputs
      }
    });

    // Update database
    await this.supabase
      .from('user_subscriptions')
      .update({
        monthly_amount_usd: newAmountUsd,
        monthly_credits: newMonthlyCredits,
        last_calculator_inputs: calculatorInputs || current.last_calculator_inputs
      })
      .eq('user_id', userId);

    // Log event
    await this.supabase.from('billing_events').insert({
      user_id: userId,
      event_type: 'subscription_updated',
      amount_cents: Math.ceil(newAmountUsd * 100),
      description: `Subscription updated: $${currentAmountUsd.toFixed(2)} → $${newAmountUsd.toFixed(2)}`,
      metadata: {
        old_monthly_credits: current.monthly_credits,
        new_monthly_credits: newMonthlyCredits
      }
    });

    console.log('✅ Subscription updated');
  }

  /**
   * Purchase boost pack (one-time credit purchase)
   */
  async purchaseBoostPack(userId: string, boostPackId: string, stripePaymentIntentId: string): Promise<void> {
    console.log('⚡ Processing boost pack purchase:', { userId, boostPackId });

    // Get boost pack details
    const { data: pack, error: packError } = await this.supabase
      .from('boost_packs')
      .select('*')
      .eq('id', boostPackId)
      .single();

    if (packError || !pack) {
      throw new Error('Boost pack not found');
    }

    const totalCredits = pack.credits_amount + (pack.bonus_credits || 0);
    const currentBalance = await this.getBalance(userId);

    // Update balance
    const newBalance = currentBalance.balance + totalCredits;
    await this.supabase
      .from('user_subscriptions')
      .update({
        balance: newBalance
      })
      .eq('user_id', userId);

    // Log transaction
    await this.supabase.from('credit_transactions').insert({
      user_id: userId,
      boost_pack_id: boostPackId,
      credits_delta: totalCredits,
      balance_before: currentBalance.balance,
      balance_after: newBalance,
      transaction_type: 'boost',
      stripe_payment_intent_id: stripePaymentIntentId,
      description: `Boost pack: ${pack.pack_name}`,
      metadata: {
        base_credits: pack.credits_amount,
        bonus_credits: pack.bonus_credits || 0,
        price_usd: pack.price_usd
      }
    });

    // Log billing event
    await this.supabase.from('billing_events').insert({
      user_id: userId,
      event_type: 'boost_pack_purchased',
      stripe_event_id: stripePaymentIntentId,
      amount_cents: Math.ceil(pack.price_usd * 100),
      credits_delta: totalCredits,
      description: `Boost pack purchased: ${pack.pack_name}`,
      metadata: {
        boost_pack_id: boostPackId,
        pack_name: pack.pack_name
      }
    });

    console.log(`✅ Boost pack applied: ${totalCredits} credits added`);
  }

  /**
   * Charge credits for agent execution (with intensity multiplier)
   */
  async chargeForExecution(
    userId: string,
    agentId: string,
    tokens: number,
    intensityScore: number
  ): Promise<{ charged: number; newBalance: number }> {
    const baseCredits = Math.ceil(tokens / 10);
    const intensityMultiplier = 1.0 + (intensityScore / 10);
    const finalCredits = Math.ceil(baseCredits * intensityMultiplier);

    console.log('💸 Charging for execution:', {
      tokens,
      baseCredits,
      intensityScore,
      intensityMultiplier,
      finalCredits
    });

    const currentBalance = await this.getBalance(userId);
    const newBalance = currentBalance.balance - finalCredits;

    // Update balance
    await this.supabase
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_spent: currentBalance.totalSpent + finalCredits,
        agents_paused: newBalance <= 0
      })
      .eq('user_id', userId);

    // Log transaction
    await this.supabase.from('credit_transactions').insert({
      user_id: userId,
      agent_id: agentId,
      credits_delta: -finalCredits,
      balance_before: currentBalance.balance,
      balance_after: newBalance,
      transaction_type: 'charge',
      activity_type: 'agent_execution',
      description: `Agent execution (${tokens} tokens × ${intensityMultiplier.toFixed(2)} intensity)`,
      metadata: {
        tokens,
        intensity_score: intensityScore,
        base_credits: baseCredits,
        multiplier: intensityMultiplier
      }
    });

    // Check for low balance alert
    if (newBalance < currentBalance.monthlyCredits * 0.25 && newBalance > 0) {
      await this.sendLowBalanceAlert(userId, newBalance, currentBalance.monthlyCredits);
    }

    // Check if agents should be paused
    if (newBalance <= 0) {
      await this.pauseAgents(userId);
    }

    console.log(`✅ Charged ${finalCredits} credits. New balance: ${newBalance}`);
    return { charged: finalCredits, newBalance };
  }

  /**
   * Charge credits for agent creation
   */
  async chargeForCreation(
    userId: string,
    agentId: string,
    tokens: number
  ): Promise<{ charged: number; newBalance: number }> {
    const credits = Math.ceil(tokens / 10);

    console.log('💸 Charging for agent creation:', { tokens, credits });

    const currentBalance = await this.getBalance(userId);
    const newBalance = currentBalance.balance - credits;

    // Update balance
    await this.supabase
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_spent: currentBalance.totalSpent + credits,
        agents_paused: newBalance <= 0
      })
      .eq('user_id', userId);

    // Log transaction
    await this.supabase.from('credit_transactions').insert({
      user_id: userId,
      agent_id: agentId,
      credits_delta: -credits,
      balance_before: currentBalance.balance,
      balance_after: newBalance,
      transaction_type: 'charge',
      activity_type: 'agent_creation',
      description: `Agent creation (${tokens} tokens)`,
      metadata: { tokens }
    });

    console.log(`✅ Charged ${credits} credits for creation. New balance: ${newBalance}`);
    return { charged: credits, newBalance };
  }

  /**
   * Send low balance alert
   */
  private async sendLowBalanceAlert(userId: string, balance: number, monthlyCredits: number): Promise<void> {
    // Check if alert was sent recently (within 24 hours)
    const { data: userSub } = await this.supabase
      .from('user_subscriptions')
      .select('last_low_balance_alert_at')
      .eq('user_id', userId)
      .single();

    const lastAlert = userSub?.last_low_balance_alert_at;
    if (lastAlert) {
      const hoursSinceLastAlert = (Date.now() - new Date(lastAlert).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastAlert < 24) {
        return; // Don't spam alerts
      }
    }

    // Update last alert timestamp
    await this.supabase
      .from('user_subscriptions')
      .update({ last_low_balance_alert_at: new Date().toISOString() })
      .eq('user_id', userId);

    // TODO: Send email notification
    console.log(`⚠️ Low balance alert for user ${userId}: ${balance} credits remaining`);

    // Log event
    await this.supabase.from('billing_events').insert({
      user_id: userId,
      event_type: 'low_balance_alert',
      description: `Low balance warning: ${balance} credits remaining (< 25% of ${monthlyCredits})`,
      metadata: {
        balance,
        monthly_credits: monthlyCredits,
        threshold_percentage: 25
      }
    });
  }

  /**
   * Pause agents when balance reaches zero
   */
  private async pauseAgents(userId: string): Promise<void> {
    console.log('🚫 Pausing agents for user:', userId);

    await this.supabase
      .from('user_subscriptions')
      .update({ agents_paused: true })
      .eq('user_id', userId);

    // TODO: Send email notification

    // Log event
    await this.supabase.from('billing_events').insert({
      user_id: userId,
      event_type: 'agents_paused',
      description: 'Agents paused due to zero credit balance',
      metadata: {
        reason: 'insufficient_credits'
      }
    });
  }

  /**
   * Resume agents when credits are added
   */
  async resumeAgents(userId: string): Promise<void> {
    console.log('▶️ Resuming agents for user:', userId);

    await this.supabase
      .from('user_subscriptions')
      .update({ agents_paused: false })
      .eq('user_id', userId);

    // Log event
    await this.supabase.from('billing_events').insert({
      user_id: userId,
      event_type: 'agents_resumed',
      description: 'Agents resumed after credits added'
    });
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(userId: string, limit: number = 50): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching transaction history:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get billing events
   */
  async getBillingEvents(userId: string, limit: number = 50): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('billing_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching billing events:', error);
      return [];
    }

    return data || [];
  }
}
