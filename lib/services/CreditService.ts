// lib/services/CreditService.ts
// Core credit management service for Smart Fuel Auto-Plan pricing

import { SupabaseClient } from '@supabase/supabase-js';
import { tokensToPilotCredits, pilotCreditsToTokens } from '@/lib/utils/pricingConfig';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CreditService' });

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
    logger.info({ userId }, 'Initializing user with trial credits');

    // Trial credits: 1,000 Pilot Credits → tokens (fetched from database)
    const trialPilotCredits = 1000;
    const trialTokens = await pilotCreditsToTokens(trialPilotCredits, this.supabase);

    const { error: insertError } = await this.supabase
      .from('user_subscriptions')
      .insert({
        user_id: userId,
        balance: trialTokens,
        total_earned: 0,
        total_spent: 0,
        trial_credits_granted: trialTokens,
        free_trial_used: true,
        monthly_amount_usd: 0,
        monthly_credits: 0,
        subscription_type: 'dynamic',
        stripe_customer_id: stripeCustomerId,
        status: 'trial'
      });

    if (insertError) {
      logger.error({ err: insertError, userId }, 'Error initializing user credits');
      throw insertError;
    }

    // Log trial credit transaction
    await this.supabase.from('credit_transactions').insert({
      user_id: userId,
      credits_delta: trialTokens,
      balance_before: 0,
      balance_after: trialTokens,
      transaction_type: 'trial',
      description: `Welcome! ${trialPilotCredits.toLocaleString()} free trial Pilot Credits`,
      metadata: {
        trial_type: 'signup_bonus',
        pilot_credits: trialPilotCredits,
        tokens: trialTokens
      }
    });

    // Log billing event
    await this.supabase.from('billing_events').insert({
      user_id: userId,
      event_type: 'trial_granted',
      credits_delta: trialTokens,
      description: `New user trial: ${trialPilotCredits.toLocaleString()} Pilot Credits granted`
    });

    logger.info({ userId, trialPilotCredits, trialTokens }, 'User initialized with trial Pilot Credits');
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
   * Charge credits for agent execution (with intensity multiplier)
   */
  async chargeForExecution(
    userId: string,
    agentId: string,
    tokens: number,
    intensityScore: number
  ): Promise<{ charged: number; newBalance: number }> {
    // Use database-driven token-to-credit conversion
    const baseCredits = await tokensToPilotCredits(tokens, this.supabase);
    const intensityMultiplier = 1.0 + (intensityScore / 10);
    const finalCredits = Math.ceil(baseCredits * intensityMultiplier);

    logger.info(
      { userId, agentId, tokens, baseCredits, intensityScore, intensityMultiplier, finalCredits },
      'Charging for execution'
    );

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
      transaction_type: 'deduction', // DB constraint requires 'deduction' for charges
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

    logger.info({ userId, agentId, charged: finalCredits, newBalance }, 'Charged credits for execution');
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
    // Use database-driven token-to-credit conversion
    const credits = await tokensToPilotCredits(tokens, this.supabase);

    logger.info({ userId, agentId, tokens, credits }, 'Charging for agent creation');

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
      transaction_type: 'deduction', // DB constraint requires 'deduction' for charges
      activity_type: 'agent_creation',
      description: `Agent creation (${tokens} tokens)`,
      metadata: { tokens }
    });

    logger.info({ userId, agentId, charged: credits, newBalance }, 'Charged credits for agent creation');
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
    logger.warn({ userId, balance }, 'Low balance alert');

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
    logger.info({ userId }, 'Pausing agents');

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
    logger.info({ userId }, 'Resuming agents');

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
      logger.error({ err: error, userId }, 'Error fetching transaction history');
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
      logger.error({ err: error, userId }, 'Error fetching billing events');
      return [];
    }

    return data || [];
  }

  /**
   * Check if user is allowed to execute an agent
   * Combines account frozen check with balance check
   */
  async checkExecutionAllowed(
    userId: string,
    estimatedCost?: number
  ): Promise<{
    allowed: boolean;
    frozen: boolean;
    balance: number;
    reason?: string;
    freeTierExpiresAt?: string | null;
  }> {
    const { data: subscription, error } = await this.supabase
      .from('user_subscriptions')
      .select('account_frozen, free_tier_expires_at, balance')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error({ err: error, userId }, 'Error checking execution allowed; failing open');
      // On error, allow execution (fail open for better UX)
      return { allowed: true, frozen: false, balance: 0 };
    }

    if (!subscription) {
      // No subscription record - allow execution (new user)
      return { allowed: true, frozen: false, balance: 0 };
    }

    const balance = subscription.balance || 0;
    const frozen = subscription.account_frozen || false;

    if (frozen) {
      return {
        allowed: false,
        frozen: true,
        balance,
        reason: 'Your free tier has expired. Please purchase tokens to continue using agents.',
        freeTierExpiresAt: subscription.free_tier_expires_at
      };
    }

    if (estimatedCost && balance < estimatedCost) {
      return {
        allowed: false,
        frozen: false,
        balance,
        reason: `Insufficient balance. Required: ${estimatedCost} tokens, Available: ${balance} tokens.`
      };
    }

    return { allowed: true, frozen: false, balance };
  }

  /**
   * Charge tokens with intensity multiplier (stores as tokens, not credits)
   * Used by run-agent route for tracking actual token consumption
   */
  async chargeTokensWithIntensity(
    userId: string,
    agentId: string,
    rawTokens: number,
    intensityScore: number,
    metadata: { executionType: string; agentName: string }
  ): Promise<{ charged: number; newBalance: number; multiplier: number }> {
    const intensityMultiplier = 1.0 + (intensityScore / 10);
    const adjustedTokens = Math.ceil(rawTokens * intensityMultiplier);

    logger.info(
      { userId, agentId, rawTokens, intensityScore, intensityMultiplier, adjustedTokens },
      'Charging tokens with intensity'
    );

    // Get current balance and total_spent
    const { data: currentSub } = await this.supabase
      .from('user_subscriptions')
      .select('balance, total_spent')
      .eq('user_id', userId)
      .maybeSingle();

    const currentBalance = currentSub?.balance || 0;
    const currentTotalSpent = currentSub?.total_spent || 0;
    const newBalance = currentBalance - adjustedTokens;
    const newTotalSpent = currentTotalSpent + adjustedTokens;

    // Update balance and total_spent
    const { error: updateError } = await this.supabase
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_spent: newTotalSpent,
        agents_paused: newBalance <= 0
      })
      .eq('user_id', userId);

    if (updateError) {
      logger.error({ err: updateError, userId }, 'Failed to update balance');
      throw updateError;
    }

    logger.info(
      { userId, adjustedTokens, balanceBefore: currentBalance, newBalance, totalSpentBefore: currentTotalSpent, newTotalSpent },
      'Token spending tracked'
    );

    // Log transaction for audit trail
    const { error: txError } = await this.supabase.from('credit_transactions').insert({
      user_id: userId,
      agent_id: agentId,
      credits_delta: -adjustedTokens,
      balance_before: currentBalance,
      balance_after: newBalance,
      transaction_type: 'deduction',
      activity_type: 'agent_execution',
      description: `${metadata.executionType} execution: ${rawTokens} tokens × ${intensityMultiplier.toFixed(2)} intensity`,
      metadata: {
        execution_type: metadata.executionType,
        raw_tokens: rawTokens,
        intensity_score: intensityScore,
        multiplier: intensityMultiplier,
        adjusted_tokens: adjustedTokens,
        agent_name: metadata.agentName
      }
    });

    if (txError) {
      logger.error({ err: txError, userId }, 'Failed to log transaction');
      // Non-fatal - balance already updated
    } else {
      logger.debug({ userId }, 'Transaction logged');
    }

    // Check if agents should be paused
    if (newBalance <= 0) {
      await this.pauseAgents(userId);
    }

    return { charged: adjustedTokens, newBalance, multiplier: intensityMultiplier };
  }
}
