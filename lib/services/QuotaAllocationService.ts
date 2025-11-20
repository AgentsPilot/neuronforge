// QuotaAllocationService - Automatically allocate storage and execution quotas based on pilot tokens
import { SupabaseClient } from '@supabase/supabase-js';
import { StorageService } from './StorageService';
import { ExecutionService } from './ExecutionService';
import { tokensToPilotCredits } from '../utils/pricingConfig';

export class QuotaAllocationService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Allocate both storage and execution quotas based on user's total pilot tokens
   * This should be called whenever:
   * - User purchases credits
   * - User's balance changes
   * - Admin manually adjusts credits
   */
  async allocateQuotasForUser(userId: string): Promise<{
    success: boolean;
    storageQuotaMB?: number;
    executionQuota?: number | null;
    error?: string;
  }> {
    try {
      console.log(`[QuotaAllocation] Starting quota allocation for user ${userId}`);

      const storageService = new StorageService(this.supabase);
      const executionService = new ExecutionService(this.supabase);

      // Allocate storage quota based on tokens
      const storageResult = await storageService.applyStorageQuotaBasedOnTokens(userId);
      console.log(`[QuotaAllocation] Storage quota allocated: ${storageResult.quotaMB} MB`);

      // Allocate execution quota based on tokens
      const executionResult = await executionService.applyExecutionQuotaBasedOnTokens(userId);
      const quotaDisplay = executionResult.quota === null ? 'unlimited' : executionResult.quota;
      console.log(`[QuotaAllocation] Execution quota allocated: ${quotaDisplay}`);

      return {
        success: true,
        storageQuotaMB: storageResult.quotaMB,
        executionQuota: executionResult.quota,
      };
    } catch (error: any) {
      console.error('[QuotaAllocation] Failed to allocate quotas:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get current quota allocation for a user
   */
  async getUserQuotaInfo(userId: string): Promise<{
    pilotTokens: number;
    storageQuotaMB: number;
    storageUsedMB: number;
    executionQuota: number | null;
    executionsUsed: number;
  } | null> {
    try {
      const { data: subscription, error } = await this.supabase
        .from('user_subscriptions')
        .select('balance, total_spent, total_earned, storage_quota_mb, storage_used_mb, executions_quota, executions_used')
        .eq('user_id', userId)
        .single();

      if (error || !subscription) {
        console.error('[QuotaAllocation] User subscription not found:', error);
        return null;
      }

      // Use total_earned as source of truth for lifetime purchases
      // This avoids triple-counting (balance + spent + earned)
      // Convert LLM tokens to Pilot Credits for UI display using database config
      const totalLlmTokens = subscription.total_earned || 0;
      const pilotTokens = await tokensToPilotCredits(totalLlmTokens, this.supabase);

      return {
        pilotTokens,
        storageQuotaMB: subscription.storage_quota_mb || 0,
        storageUsedMB: subscription.storage_used_mb || 0,
        executionQuota: subscription.executions_quota,
        executionsUsed: subscription.executions_used || 0,
      };
    } catch (error: any) {
      console.error('[QuotaAllocation] Failed to get quota info:', error);
      return null;
    }
  }

  /**
   * Bulk allocate quotas for all users (admin operation)
   * Useful for initial setup or after changing tier configurations
   */
  async allocateQuotasForAllUsers(): Promise<{
    success: boolean;
    processed: number;
    errors: number;
  }> {
    try {
      const { data: subscriptions, error } = await this.supabase
        .from('user_subscriptions')
        .select('user_id');

      if (error || !subscriptions) {
        throw new Error('Failed to fetch user subscriptions');
      }

      console.log(`[QuotaAllocation] Starting bulk allocation for ${subscriptions.length} users`);

      let processed = 0;
      let errors = 0;

      for (const sub of subscriptions) {
        try {
          await this.allocateQuotasForUser(sub.user_id);
          processed++;
        } catch (error) {
          console.error(`[QuotaAllocation] Failed for user ${sub.user_id}:`, error);
          errors++;
        }
      }

      console.log(`[QuotaAllocation] Bulk allocation complete: ${processed} processed, ${errors} errors`);

      return {
        success: true,
        processed,
        errors,
      };
    } catch (error: any) {
      console.error('[QuotaAllocation] Bulk allocation failed:', error);
      return {
        success: false,
        processed: 0,
        errors: 0,
      };
    }
  }
}
