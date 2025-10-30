// lib/credits/rewardService.ts
// Service for managing reward credit distribution

import { SupabaseClient } from '@supabase/supabase-js';

export interface RewardContext {
  userId: string;
  rewardKey: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
  metadata?: Record<string, any>;
}

export interface RewardResult {
  success: boolean;
  creditsAwarded: number;
  transactionId?: string;
  message: string;
  error?: string;
}

/**
 * Reward Service for Pilot Credits
 *
 * Handles reward credit distribution with:
 * - Eligibility checking
 * - Credit transactions
 * - User reward tracking
 * - Duplicate prevention
 */
export class RewardService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Check if user is eligible for a specific reward
   */
  async isEligible(userId: string, rewardKey: string): Promise<{ eligible: boolean; reason?: string }> {
    try {
      // Get reward configuration
      const { data: rewardConfig, error: configError } = await this.supabase
        .from('reward_config')
        .select('*')
        .eq('reward_key', rewardKey)
        .eq('is_active', true)
        .maybeSingle();

      if (configError || !rewardConfig) {
        return { eligible: false, reason: 'Reward configuration not found' };
      }

      // Check if reward is currently valid (date range)
      const now = new Date();
      if (rewardConfig.valid_from && new Date(rewardConfig.valid_from) > now) {
        return { eligible: false, reason: 'Reward not yet available' };
      }
      if (rewardConfig.valid_until && new Date(rewardConfig.valid_until) < now) {
        return { eligible: false, reason: 'Reward has expired' };
      }

      // Get user reward history for this reward type
      const { data: userReward, error: historyError } = await this.supabase
        .from('user_rewards')
        .select('*')
        .eq('user_id', userId)
        .eq('reward_config_id', rewardConfig.id)
        .maybeSingle();

      if (historyError && historyError.code !== 'PGRST116') {
        console.error('Error checking user reward history:', historyError);
        return { eligible: false, reason: 'Error checking reward eligibility' };
      }

      // Check max_per_user limit
      if (rewardConfig.max_per_user !== null && userReward) {
        if (userReward.redemption_count >= rewardConfig.max_per_user) {
          return { eligible: false, reason: 'Maximum redemptions reached' };
        }
      }

      // Check cooldown period
      if (rewardConfig.cooldown_hours > 0 && userReward?.last_redeemed_at) {
        const lastRedeemed = new Date(userReward.last_redeemed_at);
        const cooldownEnd = new Date(lastRedeemed.getTime() + rewardConfig.cooldown_hours * 60 * 60 * 1000);
        if (now < cooldownEnd) {
          const hoursRemaining = Math.ceil((cooldownEnd.getTime() - now.getTime()) / (60 * 60 * 1000));
          return { eligible: false, reason: `Cooldown active. Try again in ${hoursRemaining} hours` };
        }
      }

      return { eligible: true };
    } catch (error) {
      console.error('Error checking reward eligibility:', error);
      return { eligible: false, reason: 'System error checking eligibility' };
    }
  }

  /**
   * Award reward credits to a user
   *
   * This method:
   * 1. Checks eligibility
   * 2. Creates credit transaction
   * 3. Updates user_credits balance
   * 4. Records reward redemption
   */
  async awardReward(context: RewardContext): Promise<RewardResult> {
    const { userId, rewardKey, relatedEntityId, relatedEntityType, metadata } = context;

    console.log('🎁 [RewardService] Starting awardReward:', { userId, rewardKey, relatedEntityId, relatedEntityType });

    try {
      // Check eligibility
      console.log('🔍 [RewardService] Checking eligibility...');
      const eligibility = await this.isEligible(userId, rewardKey);
      if (!eligibility.eligible) {
        console.warn('❌ [RewardService] Not eligible:', eligibility.reason);
        return {
          success: false,
          creditsAwarded: 0,
          message: eligibility.reason || 'Not eligible for this reward'
        };
      }
      console.log('✅ [RewardService] Eligibility check passed');

      // Get reward configuration
      console.log('📋 [RewardService] Fetching reward configuration...');
      const { data: rewardConfig, error: configError } = await this.supabase
        .from('reward_config')
        .select('*')
        .eq('reward_key', rewardKey)
        .eq('is_active', true)
        .single();

      if (configError || !rewardConfig) {
        console.error('❌ [RewardService] Reward config not found:', configError);
        return {
          success: false,
          creditsAwarded: 0,
          message: 'Reward configuration not found',
          error: configError?.message
        };
      }
      console.log('✅ [RewardService] Reward config loaded:', { credits: rewardConfig.credits_amount });

      // Get or create user_subscriptions record
      console.log('💰 [RewardService] Fetching current user subscription...');
      const { data: existingCredits, error: fetchError } = await this.supabase
        .from('user_subscriptions')
        .select('balance, total_earned')  // Changed from pilot_credits_balance to balance
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('❌ [RewardService] Error fetching user credits:', fetchError);
        return {
          success: false,
          creditsAwarded: 0,
          message: 'Error fetching user credits',
          error: fetchError.message
        };
      }

      const currentCredits = existingCredits?.balance || 0;  // Changed from pilot_credits_balance
      const currentTotalEarned = existingCredits?.total_earned || 0;
      const newCredits = currentCredits + rewardConfig.credits_amount;
      const newTotalEarned = currentTotalEarned + rewardConfig.credits_amount;

      console.log('💰 [RewardService] Credit calculation:', {
        currentCredits,
        creditsToAdd: rewardConfig.credits_amount,
        newCredits
      });

      // Update user_subscriptions balance
      console.log('💾 [RewardService] Updating user_subscriptions balance...');
      const { data: updatedCredits, error: updateError } = await this.supabase
        .from('user_subscriptions')
        .upsert({
          user_id: userId,
          balance: newCredits,  // Changed from pilot_credits_balance
          total_earned: newTotalEarned
        }, {
          onConflict: 'user_id'
        })
        .select('id')
        .single();

      if (updateError) {
        console.error('❌ [RewardService] Error updating user credits:', updateError);
        return {
          success: false,
          creditsAwarded: 0,
          message: 'Failed to update credit balance',
          error: updateError.message
        };
      }
      console.log('✅ [RewardService] User credits updated successfully');

      // Create credit transaction record
      console.log('📝 [RewardService] Creating credit transaction...');
      const { data: transaction, error: transactionError } = await this.supabase
        .from('credit_transactions')
        .insert({
          user_id: userId,
          credits_delta: rewardConfig.credits_amount,  // Changed from pilot_credits_amount
          transaction_type: 'reward',  // Changed from 'credit' to 'reward'
          activity_type: 'reward_credit',
          reward_config_id: rewardConfig.id,
          description: rewardConfig.display_name || rewardConfig.reward_name,
          agent_id: relatedEntityType === 'agent' ? relatedEntityId : null,
          balance_before: currentCredits,
          balance_after: newCredits,
          metadata: {
            ...metadata,
            reward_key: rewardKey,
            related_entity_id: relatedEntityId,
            related_entity_type: relatedEntityType
          }
        })
        .select('id')
        .single();

      if (transactionError) {
        console.error('❌ [RewardService] Error creating credit transaction:', transactionError);
        // Transaction logging failed, but credits were updated - partial success
        return {
          success: true,
          creditsAwarded: rewardConfig.credits_amount,
          message: 'Credits awarded but transaction logging failed',
          error: transactionError.message
        };
      }
      console.log('✅ [RewardService] Credit transaction created:', transaction.id);

      // Update or create user_rewards tracking
      // Ensure related_entity_id is never undefined for the unique constraint
      const entityId = relatedEntityId || null;

      const { data: existingReward, error: rewardFetchError } = await this.supabase
        .from('user_rewards')
        .select('*')
        .eq('user_id', userId)
        .eq('reward_config_id', rewardConfig.id)
        .is('related_entity_id', entityId)
        .maybeSingle();

      if (rewardFetchError && rewardFetchError.code !== 'PGRST116') {
        console.error('Error fetching user reward:', rewardFetchError);
      }

      const rewardData = {
        user_id: userId,
        reward_config_id: rewardConfig.id,
        transaction_id: transaction.id,
        related_entity_id: entityId,
        related_entity_type: relatedEntityType || null,
        redemption_count: (existingReward?.redemption_count || 0) + 1,
        last_redeemed_at: new Date().toISOString(),
        total_credits_earned: (existingReward?.total_credits_earned || 0) + rewardConfig.credits_amount,
        metadata: {
          ...existingReward?.metadata,
          ...metadata,
          last_reward_key: rewardKey
        }
      };

      console.log('Upserting user_reward with data:', rewardData);

      const { error: rewardUpsertError } = await this.supabase
        .from('user_rewards')
        .upsert(rewardData, {
          onConflict: 'user_id,reward_config_id,related_entity_id'
        });

      if (rewardUpsertError) {
        console.error('Error updating user_rewards tracking:', rewardUpsertError);
        console.error('Failed reward data:', rewardData);
        // Tracking failed but credits were awarded - partial success
      } else {
        console.log('Successfully tracked reward in user_rewards');
      }

      return {
        success: true,
        creditsAwarded: rewardConfig.credits_amount,
        transactionId: transaction.id,
        message: `${rewardConfig.credits_amount} credits awarded for ${rewardConfig.display_name}`
      };
    } catch (error) {
      console.error('Error awarding reward:', error);
      return {
        success: false,
        creditsAwarded: 0,
        message: 'System error awarding reward',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Award agent sharing reward
   * Convenience method for the common use case of agent sharing
   */
  async awardAgentSharingReward(userId: string, agentId: string, agentName: string): Promise<RewardResult> {
    return this.awardReward({
      userId,
      rewardKey: 'agent_sharing',
      relatedEntityId: agentId,
      relatedEntityType: 'agent',
      metadata: {
        agent_name: agentName,
        shared_at: new Date().toISOString()
      }
    });
  }

  /**
   * Check if agent has already been shared by this user
   */
  async hasSharedAgent(userId: string, agentId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('user_rewards')
        .select('id')
        .eq('user_id', userId)
        .eq('related_entity_type', 'agent')
        .eq('related_entity_id', agentId)
        .limit(1);

      if (error) {
        console.error('Error checking if agent shared:', error);
        return false;
      }

      return data && data.length > 0;
    } catch (error) {
      console.error('Error in hasSharedAgent:', error);
      return false;
    }
  }

  /**
   * Get user's reward history
   */
  async getUserRewardHistory(userId: string): Promise<any[]> {
    try {
      const { data, error } = await this.supabase
        .from('user_rewards')
        .select(`
          *,
          reward_config:reward_config_id (
            reward_key,
            reward_name,
            display_name,
            credits_amount
          )
        `)
        .eq('user_id', userId)
        .order('last_redeemed_at', { ascending: false });

      if (error) {
        console.error('Error fetching user reward history:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getUserRewardHistory:', error);
      return [];
    }
  }
}
