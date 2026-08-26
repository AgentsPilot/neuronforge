/**
 * Stage Type Utilities
 *
 * Centralized utilities for semantic pipeline stage classification.
 * Use these functions instead of hardcoding stage_key checks.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StageTypeUtils' });

// Semantic stage type classification
export type StageType = 'lead' | 'prospect' | 'client' | 'past_client' | 'lost' | 'archived';

// Stage type constants for common queries
export const CLIENT_STAGE_TYPES: StageType[] = ['client'];
export const ACTIVE_PIPELINE_TYPES: StageType[] = ['lead', 'prospect'];
export const TERMINAL_STAGE_TYPES: StageType[] = ['past_client', 'lost', 'archived'];
export const ALL_STAGE_TYPES: StageType[] = ['lead', 'prospect', 'client', 'past_client', 'lost', 'archived'];

/**
 * Get all stage_keys for a user that match the given stage_type(s)
 *
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param stageTypes - Single stage type or array of stage types
 * @returns Array of stage_key strings
 */
export async function getStageKeysByType(
  supabase: SupabaseClient,
  userId: string,
  stageTypes: StageType | StageType[]
): Promise<string[]> {
  const types = Array.isArray(stageTypes) ? stageTypes : [stageTypes];

  const { data, error } = await supabase
    .from('crm_pipeline_stages')
    .select('stage_key')
    .eq('user_id', userId)
    .in('stage_type', types);

  if (error) {
    logger.error({ err: error, userId, stageTypes: types }, 'Failed to get stage keys by type');
    return [];
  }

  return data?.map(s => s.stage_key) || [];
}

/**
 * Find the primary "client" stage for a user (for auto-promotion after payment)
 * Returns the stage with is_primary_client_stage=true, or falls back to first client stage by position
 *
 * @param supabase - Supabase client
 * @param userId - User ID
 * @returns The primary client stage or null if not found
 */
export async function findClientStage(
  supabase: SupabaseClient,
  userId: string
): Promise<{ stage_key: string; stage_label: string; stage_type: StageType } | null> {
  // First try to find explicitly marked primary client stage
  const { data: primaryStage, error: primaryError } = await supabase
    .from('crm_pipeline_stages')
    .select('stage_key, stage_label, stage_type')
    .eq('user_id', userId)
    .eq('is_primary_client_stage', true)
    .maybeSingle();

  if (primaryError) {
    logger.error({ err: primaryError, userId }, 'Failed to find primary client stage');
  }

  if (primaryStage) {
    return primaryStage as { stage_key: string; stage_label: string; stage_type: StageType };
  }

  // Fallback: find first stage with stage_type='client' ordered by position
  const { data: clientStage, error: clientError } = await supabase
    .from('crm_pipeline_stages')
    .select('stage_key, stage_label, stage_type')
    .eq('user_id', userId)
    .eq('stage_type', 'client')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (clientError) {
    logger.error({ err: clientError, userId }, 'Failed to find client stage by type');
    return null;
  }

  return clientStage as { stage_key: string; stage_label: string; stage_type: StageType } | null;
}

/**
 * Get the stage_type for a specific stage_key
 *
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param stageKey - The stage key to look up
 * @returns The stage type or null if not found
 */
export async function getStageType(
  supabase: SupabaseClient,
  userId: string,
  stageKey: string
): Promise<StageType | null> {
  const { data, error } = await supabase
    .from('crm_pipeline_stages')
    .select('stage_type')
    .eq('user_id', userId)
    .eq('stage_key', stageKey)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      logger.error({ err: error, userId, stageKey }, 'Failed to get stage type');
    }
    return null;
  }

  return data.stage_type as StageType;
}

/**
 * Check if a stage_key represents a client stage for the given user
 *
 * @param supabase - Supabase client
 * @param userId - User ID
 * @param stageKey - The stage key to check
 * @returns True if this is a client stage
 */
export async function isClientStage(
  supabase: SupabaseClient,
  userId: string,
  stageKey: string
): Promise<boolean> {
  const stageType = await getStageType(supabase, userId, stageKey);
  return stageType === 'client';
}

/**
 * Infer stage_type from a stage label using keyword matching
 * Used when users create custom pipeline stages
 *
 * @param stageLabel - The display label for the stage
 * @returns Inferred stage type
 */
export function inferStageTypeFromLabel(stageLabel: string): StageType {
  const label = stageLabel.toLowerCase();

  // Client indicators (highest priority for positive conversion)
  if (
    label.includes('client') ||
    label.includes('customer') ||
    label.includes('won') ||
    label.includes('active') ||
    label.includes('enrolled') ||
    label.includes('member') ||
    label.includes('retained') ||
    label.includes('vip') ||
    label.includes('premium')
  ) {
    return 'client';
  }

  // Past client indicators
  if (
    label.includes('completed') ||
    label.includes('past') ||
    label.includes('former') ||
    label.includes('churned') ||
    label.includes('inactive') ||
    label.includes('ended') ||
    label.includes('finished')
  ) {
    return 'past_client';
  }

  // Lost indicators
  if (
    label.includes('lost') ||
    label.includes('rejected') ||
    label.includes('declined') ||
    label.includes('cancelled') ||
    label.includes('no show') ||
    label.includes('no-show')
  ) {
    return 'lost';
  }

  // Archived indicators
  if (
    label.includes('archived') ||
    label.includes('deleted') ||
    label.includes('hidden')
  ) {
    return 'archived';
  }

  // Prospect indicators (qualified leads in conversation)
  if (
    label.includes('proposal') ||
    label.includes('meeting') ||
    label.includes('intake') ||
    label.includes('trial') ||
    label.includes('assessment') ||
    label.includes('consultation') ||
    label.includes('discovery') ||
    label.includes('qualified') ||
    label.includes('negotiation') ||
    label.includes('pending') ||
    label.includes('follow')
  ) {
    return 'prospect';
  }

  // Default to lead for unrecognized patterns
  return 'lead';
}

/**
 * Build an array of stage_keys that can be used for client filtering
 * Includes fallback for users without stage_type data
 *
 * @param supabase - Supabase client
 * @param userId - User ID
 * @returns Array of stage keys representing client stages
 */
export async function buildClientStageFilter(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const clientStageKeys = await getStageKeysByType(supabase, userId, 'client');

  // If we found stages with stage_type, use them
  if (clientStageKeys.length > 0) {
    return clientStageKeys;
  }

  // Fallback: use legacy heuristic for users without stage_type populated
  // This matches the old findActiveClientStage() behavior
  logger.warn({ userId }, 'No client stage_type found, using legacy fallback');

  const { data: allStages } = await supabase
    .from('crm_pipeline_stages')
    .select('stage_key, stage_label')
    .eq('user_id', userId);

  if (!allStages || allStages.length === 0) {
    return ['client']; // Ultimate fallback
  }

  // Use known client stage keys
  const knownClientKeys = ['active_client', 'active', 'client', 'closed_won', 'customer'];
  const matchedKeys = allStages
    .filter(s => knownClientKeys.includes(s.stage_key))
    .map(s => s.stage_key);

  if (matchedKeys.length > 0) {
    return matchedKeys;
  }

  // Try label matching
  const labelMatched = allStages
    .filter(s =>
      s.stage_label.toLowerCase().includes('active') ||
      s.stage_label.toLowerCase().includes('client')
    )
    .map(s => s.stage_key);

  return labelMatched.length > 0 ? labelMatched : ['client'];
}
