// lib/services/CreditService.ts
// Core credit management service for Smart Fuel Auto-Plan pricing

import { SupabaseClient } from '@supabase/supabase-js';
// Stripe integration removed - payment processing coming soon

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
   * NOTE: Stripe integration removed - payment processing coming soon
   */
  async createSubscription(
    _userId: string,
    _monthlyCredits: number,
    _calculatorInputs: CalculatorInputs
  ): Promise<any> {
    throw new Error('Payment integration not yet implemented. Please contact support.');
  }

  /**
   * Update existing subscription
   * NOTE: Stripe integration removed - payment processing coming soon
   */
  async updateSubscription(
    _userId: string,
    _newMonthlyCredits: number,
    _calculatorInputs?: CalculatorInputs
  ): Promise<void> {
    throw new Error('Payment integration not yet implemented. Please contact support.');
  }

  /**
   * Purchase boost pack (one-time credit purchase)
   * NOTE: Stripe integration removed - payment processing coming soon
   */
  async purchaseBoostPack(_userId: string, _boostPackId: string, _stripePaymentIntentId: string): Promise<void> {
    throw new Error('Payment integration not yet implemented. Please contact support.');
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
