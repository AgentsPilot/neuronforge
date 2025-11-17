// lib/services/ExecutionService.ts
// Service for managing user execution quotas and usage

import { SupabaseClient } from '@supabase/supabase-js';

export interface ExecutionQuota {
  quota: number | null; // null = unlimited
  used: number;
  alertThreshold: number;
  percentageUsed: number;
  remaining: number | null; // null = unlimited
  isNearLimit: boolean;
  isOverLimit: boolean;
}

export interface TokenExecutionTier {
  minTokens: number;
  executionsQuota: number | null; // null = unlimited
  configKey: string;
}

export class ExecutionService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get execution quota based on total pilot tokens purchased
   */
  async getExecutionQuotaForTokens(totalPilotTokens: number): Promise<number | null> {
    // Load all token-based tiers from config
    const { data: configs, error } = await this.supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .like('config_key', 'executions_tokens_%')
      .order('config_key', { ascending: true });

    if (error || !configs || configs.length === 0) {
      // Fallback default - unlimited
      return null;
    }

    // Parse tiers and find the appropriate one
    const tiers: TokenExecutionTier[] = configs.map(c => ({
      minTokens: parseInt(c.config_key.replace('executions_tokens_', ''), 10),
      executionsQuota: c.config_value === 'null' ? null : parseInt(c.config_value, 10),
      configKey: c.config_key,
    })).sort((a, b) => b.minTokens - a.minTokens); // Sort descending

    // Find the highest tier that user qualifies for
    for (const tier of tiers) {
      if (totalPilotTokens >= tier.minTokens) {
        return tier.executionsQuota;
      }
    }

    // If no tier matches, use the lowest tier (0 tokens)
    return tiers[tiers.length - 1]?.executionsQuota ?? null;
  }

  /**
   * Calculate and apply execution quota based on user's total tokens purchased
   */
  async applyExecutionQuotaBasedOnTokens(userId: string): Promise<{ success: boolean; quota: number | null }> {
    // Get user's total purchased tokens (balance + total_spent + total_earned)
    const { data: subscription, error: subError } = await this.supabase
      .from('user_subscriptions')
      .select('balance, total_spent, total_earned')
      .eq('user_id', userId)
      .single();

    if (subError || !subscription) {
      throw new Error('User subscription not found');
    }

    // Calculate total pilot credits purchased (tokens / 10)
    const totalTokens = (subscription.balance || 0) + (subscription.total_spent || 0) + (subscription.total_earned || 0);
    const totalPilotTokens = Math.floor(totalTokens / 10);

    // Get appropriate execution quota
    const quota = await this.getExecutionQuotaForTokens(totalPilotTokens);

    // Update user's execution quota
    const { error } = await this.supabase
      .from('user_subscriptions')
      .update({ executions_quota: quota })
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to apply execution quota:', error);
      throw new Error(`Failed to apply execution quota: ${error.message}`);
    }

    const quotaDisplay = quota === null ? 'unlimited' : quota.toLocaleString();
    console.log(`✅ Applied ${quotaDisplay} executions to user ${userId} (${totalPilotTokens} pilot tokens)`);
    return { success: true, quota };
  }

  /**
   * Get user's current execution quota and usage
   */
  async getExecutionQuota(userId: string): Promise<ExecutionQuota> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('executions_quota, executions_used, executions_alert_threshold')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      // Return default quota if not found
      return {
        quota: null, // unlimited by default
        used: 0,
        alertThreshold: 0.9,
        percentageUsed: 0,
        remaining: null,
        isNearLimit: false,
        isOverLimit: false,
      };
    }

    const quota = data.executions_quota;
    const used = data.executions_used || 0;
    const alertThreshold = data.executions_alert_threshold || 0.9;
    const percentageUsed = quota !== null && quota > 0 ? used / quota : 0;
    const remaining = quota !== null ? Math.max(0, quota - used) : null;

    return {
      quota,
      used,
      alertThreshold,
      percentageUsed,
      remaining,
      isNearLimit: quota !== null && percentageUsed >= alertThreshold,
      isOverLimit: quota !== null && used >= quota,
    };
  }

  /**
   * Check if user has sufficient executions available
   */
  async checkExecutionAvailable(userId: string): Promise<{ available: boolean; quota: ExecutionQuota }> {
    const quota = await this.getExecutionQuota(userId);
    return {
      available: quota.quota === null || quota.remaining! > 0,
      quota,
    };
  }

  /**
   * Record a workflow execution
   */
  async recordExecution(userId: string): Promise<{ success: boolean; quota: ExecutionQuota }> {
    // Check if user has enough executions
    const { available, quota } = await this.checkExecutionAvailable(userId);

    if (!available) {
      throw new Error(
        `Execution quota exceeded. Used: ${quota.used}, Quota: ${quota.quota}`
      );
    }

    // Increment executions_used
    const { error } = await this.supabase.rpc('increment_executions_used', {
      p_user_id: userId,
    });

    if (error) {
      console.error('Failed to record execution:', error);
      throw new Error(`Failed to record execution: ${error.message}`);
    }

    // Get updated quota
    const updatedQuota = await this.getExecutionQuota(userId);

    console.log(`✅ Recorded execution for user ${userId} (${updatedQuota.used}/${updatedQuota.quota ?? '∞'})`);

    return { success: true, quota: updatedQuota };
  }

  /**
   * Update user's execution quota (admin only)
   */
  async updateExecutionQuota(
    userId: string,
    newQuota: number | null,
    alertThreshold?: number
  ): Promise<{ success: boolean }> {
    const updateData: any = {
      executions_quota: newQuota,
    };

    if (alertThreshold !== undefined) {
      updateData.executions_alert_threshold = alertThreshold;
    }

    const { error } = await this.supabase
      .from('user_subscriptions')
      .update(updateData)
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to update execution quota:', error);
      throw new Error(`Failed to update execution quota: ${error.message}`);
    }

    const quotaDisplay = newQuota === null ? 'unlimited' : newQuota.toLocaleString();
    console.log(`✅ Updated execution quota for user ${userId}: ${quotaDisplay}`);
    return { success: true };
  }

  /**
   * Get execution statistics for admin dashboard
   */
  async getExecutionStats(): Promise<{
    totalUsers: number;
    totalExecutionsUsed: number;
    averageExecutionsPerUser: number;
    usersWithQuota: number;
  }> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('executions_quota, executions_used');

    if (error || !data) {
      return {
        totalUsers: 0,
        totalExecutionsUsed: 0,
        averageExecutionsPerUser: 0,
        usersWithQuota: 0,
      };
    }

    const totalUsers = data.length;
    const totalExecutionsUsed = data.reduce((sum, user) => sum + (user.executions_used || 0), 0);
    const usersWithQuota = data.filter(user => user.executions_quota !== null).length;
    const averageExecutionsPerUser = totalUsers > 0 ? totalExecutionsUsed / totalUsers : 0;

    return {
      totalUsers,
      totalExecutionsUsed,
      averageExecutionsPerUser,
      usersWithQuota,
    };
  }
}
