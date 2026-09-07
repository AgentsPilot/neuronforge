/**
 * CapabilityConditionEvaluator
 *
 * Evaluates activation_conditions from capability_building_blocks
 * to determine which blocks should be auto-activated for a user.
 *
 * Supports flexible JSONB conditions:
 * - min_clients_per_week: number
 * - verticals: string[] (therapist, coach, etc.)
 * - pain_points: string[] (no_shows, late_payments, etc.)
 * - tools: string[] (google_calendar, stripe, etc.)
 * - goals: string[] (online_presence, client_retention, etc.)
 *
 * All conditions in a JSON object are AND'ed together.
 * Array conditions require at least one matching value.
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'CapabilityConditionEvaluator' });

export interface Result<T> {
  data: T | null;
  error: Error | null;
}

export interface BuildingBlockActivationResult {
  activated: string[];
  skipped: string[];
}

interface UserProfile {
  vertical?: string;
  clients_per_week?: number;
  tools?: string[];
  pain_points?: string[];
  goals?: string[];
  /*
   * `has_website` used to be declared here and selected from the table below.
   *
   * It is not a column and never was. Onboarding DERIVES it in memory —
   * `app/api/onboarding/build/route.ts:280` reads it off `online_presence_mode`
   * — and hands it to `capabilityActivationService.activateFromProfile` as part
   * of an activation profile that is used once and discarded. This evaluator
   * later tried to re-read that same shape from `business_profiles`, as though
   * it had been persisted.
   *
   * If a condition ever needs it, derive it the same way: `online_presence_mode`
   * is a real, populated column. Do not add one — whether a site is live is a
   * fact about `website_pages`, not about the profile.
   */
}

interface BuildingBlock {
  id: string;
  block_key: string;
  capability_id: string;
  is_core: boolean;
  is_recommended: boolean;
  activation_conditions: Record<string, any>;
}

export class CapabilityConditionEvaluator {
  /**
   * Auto-activate building blocks based on user profile
   * Called after capability activation during onboarding
   *
   * @param userId - User to activate building blocks for
   * @returns List of activated and skipped building blocks
   */
  async activateBlocksForProfile(
    userId: string
  ): Promise<Result<BuildingBlockActivationResult>> {
    try {
      logger.info({ userId }, 'Starting building block activation');

      // 1. Get user's profile data
      const profile = await this.getUserProfile(userId);
      if (!profile) {
        logger.warn({ userId }, 'No profile found for user');
        return {
          data: { activated: [], skipped: [] },
          error: null
        };
      }

      // 2. Get user's active capabilities
      const { data: userCapabilities, error: capError } = await supabaseServer
        .from('user_capabilities')
        .select('capability_id, capabilities(capability_key)')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (capError) {
        throw capError;
      }

      if (!userCapabilities || userCapabilities.length === 0) {
        logger.info({ userId }, 'No active capabilities for user');
        return {
          data: { activated: [], skipped: [] },
          error: null
        };
      }

      const capabilityIds = userCapabilities.map(uc => uc.capability_id);

      logger.info(
        { userId, capabilityCount: capabilityIds.length },
        'Found active capabilities'
      );

      // 3. Get all building blocks for active capabilities
      const { data: blocks, error: blocksError } = await supabaseServer
        .from('capability_building_blocks')
        .select('*')
        .in('capability_id', capabilityIds);

      if (blocksError) {
        throw blocksError;
      }

      if (!blocks || blocks.length === 0) {
        logger.info({ userId }, 'No building blocks found for active capabilities');
        return {
          data: { activated: [], skipped: [] },
          error: null
        };
      }

      logger.info(
        { userId, blockCount: blocks.length },
        'Evaluating building blocks'
      );

      // 4. Evaluate each building block
      const activated: string[] = [];
      const skipped: string[] = [];

      for (const block of blocks as BuildingBlock[]) {
        // Core blocks always activate
        if (block.is_core) {
          const { error: activateError } = await this.activateBlock(userId, block.id);
          if (activateError) {
            logger.error(
              { err: activateError, userId, blockKey: block.block_key },
              'Failed to activate core building block'
            );
            skipped.push(block.block_key);
          } else {
            activated.push(block.block_key);
            logger.info(
              { userId, blockKey: block.block_key },
              'Activated core building block'
            );
          }
          continue;
        }

        // Evaluate conditions for non-core blocks
        const shouldActivate = await this.evaluateConditions(
          userId,
          profile,
          block.activation_conditions || {}
        );

        if (shouldActivate) {
          const { error: activateError } = await this.activateBlock(userId, block.id);
          if (activateError) {
            logger.error(
              { err: activateError, userId, blockKey: block.block_key },
              'Failed to activate building block'
            );
            skipped.push(block.block_key);
          } else {
            activated.push(block.block_key);
            logger.info(
              {
                userId,
                blockKey: block.block_key,
                conditions: block.activation_conditions
              },
              'Activated building block based on conditions'
            );
          }
        } else {
          skipped.push(block.block_key);
          logger.info(
            {
              userId,
              blockKey: block.block_key,
              conditions: block.activation_conditions
            },
            'Skipped building block - conditions not met'
          );
        }
      }

      logger.info(
        { userId, activated, skipped },
        'Building block activation complete'
      );

      return {
        data: { activated, skipped },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to activate building blocks');
      return {
        data: null,
        error: error as Error
      };
    }
  }

  /**
   * Evaluate if a building block's conditions are met
   *
   * Conditions can include:
   * - min_clients_per_week: number
   * - verticals: string[] (therapist, coach, etc.)
   * - pain_points: string[] (no_shows, late_payments, etc.)
   * - tools: string[] (google_calendar, stripe, etc.)
   * - goals: string[] (online_presence, client_retention, etc.)
   *
   * All conditions must match (AND logic)
   * For array conditions, at least one value must match
   */
  async evaluateConditions(
    userId: string,
    profile: UserProfile,
    conditions: Record<string, any>
  ): Promise<boolean> {
    // Empty conditions = always activate
    if (!conditions || Object.keys(conditions).length === 0) {
      return true;
    }

    // Check min_clients_per_week
    if (conditions.min_clients_per_week !== undefined) {
      if (!profile.clients_per_week || profile.clients_per_week < conditions.min_clients_per_week) {
        logger.debug(
          {
            userId,
            required: conditions.min_clients_per_week,
            actual: profile.clients_per_week
          },
          'min_clients_per_week condition not met'
        );
        return false;
      }
    }

    // Check verticals
    if (conditions.verticals && Array.isArray(conditions.verticals) && conditions.verticals.length > 0) {
      if (!profile.vertical || !conditions.verticals.includes(profile.vertical)) {
        logger.debug(
          {
            userId,
            required: conditions.verticals,
            actual: profile.vertical
          },
          'verticals condition not met'
        );
        return false;
      }
    }

    // Check pain_points
    if (conditions.pain_points && Array.isArray(conditions.pain_points) && conditions.pain_points.length > 0) {
      const hasMatchingPainPoint = conditions.pain_points.some(
        (pp: string) => profile.pain_points?.includes(pp)
      );
      if (!hasMatchingPainPoint) {
        logger.debug(
          {
            userId,
            required: conditions.pain_points,
            actual: profile.pain_points
          },
          'pain_points condition not met'
        );
        return false;
      }
    }

    // Check tools
    if (conditions.tools && Array.isArray(conditions.tools) && conditions.tools.length > 0) {
      const hasMatchingTool = conditions.tools.some(
        (tool: string) => profile.tools?.includes(tool)
      );
      if (!hasMatchingTool) {
        logger.debug(
          {
            userId,
            required: conditions.tools,
            actual: profile.tools
          },
          'tools condition not met'
        );
        return false;
      }
    }

    // Check goals
    if (conditions.goals && Array.isArray(conditions.goals) && conditions.goals.length > 0) {
      const hasMatchingGoal = conditions.goals.some(
        (goal: string) => profile.goals?.includes(goal)
      );
      if (!hasMatchingGoal) {
        logger.debug(
          {
            userId,
            required: conditions.goals,
            actual: profile.goals
          },
          'goals condition not met'
        );
        return false;
      }
    }

    // All conditions met
    return true;
  }

  /**
   * Activate a specific building block for a user
   */
  private async activateBlock(
    userId: string,
    blockId: string
  ): Promise<Result<void>> {
    try {
      // Check if already activated
      const { data: existing } = await supabaseServer
        .from('user_capability_blocks')
        .select('id, is_active')
        .eq('user_id', userId)
        .eq('block_id', blockId)
        .single();

      if (existing) {
        // Already exists - just ensure it's active
        if (!existing.is_active) {
          await supabaseServer
            .from('user_capability_blocks')
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq('id', existing.id);

          logger.info({ userId, blockId }, 'Re-activated existing building block');
        } else {
          logger.debug({ userId, blockId }, 'Building block already active');
        }
        return { data: null, error: null };
      }

      // Insert new user_capability_block
      const { error: insertError } = await supabaseServer
        .from('user_capability_blocks')
        .insert({
          user_id: userId,
          block_id: blockId,
          is_active: true,
          configuration: {}
        });

      if (insertError) {
        throw insertError;
      }

      logger.info({ userId, blockId }, 'Building block activated');

      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, blockId }, 'Failed to activate building block');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get user's profile data for condition evaluation
   */
  private async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const { data: profile, error } = await supabaseServer
        .from('business_profiles')
        /*
         * Every name here must be a real column.
         *
         * This asked for `has_website` too, and Postgres rejects the WHOLE
         * select for one unknown column — so this query failed on every call,
         * for every user, since the day it was written. `getUserProfile` threw,
         * logged, and returned null, and no capability condition has ever seen
         * profile data. A silent, total failure that looked like "this user has
         * no profile".
         */
        .select('vertical, clients_per_week, tools, pain_points, goals')
        .eq('user_id', userId)
        .single();

      if (error) {
        throw error;
      }

      return profile as UserProfile;
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to fetch user profile');
      return null;
    }
  }
}

// Singleton export
export const capabilityConditionEvaluator = new CapabilityConditionEvaluator();
