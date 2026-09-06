/**
 * CapabilityActivationService
 *
 * Intelligently activates capabilities based on user business profile.
 * Database-driven - NO hardcoded logic! All activation rules come from database.
 *
 * Architecture:
 * - Queries capabilities table for vertical matching
 * - Uses onboarding chat selections as primary signal
 * - Adds dependency-based capabilities (reports depends on payments)
 * - Activates in user_capabilities table
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'CapabilityActivationService' });

export type ActivationSource = 'onboarding' | 'manual' | 'auto_suggested';

export interface CapabilityActivationResult {
  activated: string[];
  skipped: string[];
}

export interface Result<T> {
  data: T | null;
  error: Error | null;
}

interface UserProfile {
  vertical?: string;
  clients_per_week?: number;
  tools?: string[];
  pain_points?: string[];
  goals?: string[];
  has_website?: boolean;
}

interface OnboardingCapability {
  id: string;
  name: string;
  category: string;
}

export class CapabilityActivationService {
  /**
   * Activate capabilities based on business profile + onboarding selections
   * This is the CORE METHOD - uses database-driven intelligence
   *
   * @param userId - User to activate capabilities for
   * @param profile - Business profile data from onboarding
   * @param selectedCapabilities - Capabilities selected during onboarding chat
   * @param source - Where activation originated
   */
  async activateFromProfile(
    userId: string,
    profile: UserProfile,
    selectedCapabilities?: OnboardingCapability[],
    source: ActivationSource = 'onboarding'
  ): Promise<Result<CapabilityActivationResult>> {
    try {
      logger.info(
        { userId, vertical: profile.vertical, source },
        'Starting capability activation from profile'
      );

      // Determine which capabilities to activate (database-driven!)
      const capabilityKeys = await this.determineCapabilitiesFromProfile(profile, selectedCapabilities);

      logger.info(
        { userId, capabilityKeys, count: capabilityKeys.length },
        'Capabilities determined from profile'
      );

      if (capabilityKeys.length === 0) {
        return {
          data: { activated: [], skipped: [] },
          error: null
        };
      }

      // Get capability IDs from database
      const capabilityMap = await this.getCapabilityIds(capabilityKeys);

      // Activate each capability
      const activated: string[] = [];
      const skipped: string[] = [];

      for (const key of capabilityKeys) {
        const capabilityId = capabilityMap.get(key);
        if (!capabilityId) {
          logger.warn({ userId, capabilityKey: key }, 'Capability not found in database');
          skipped.push(key);
          continue;
        }

        const { error } = await this.activateCapability(userId, key, source);
        if (error) {
          logger.error({ userId, capabilityKey: key, err: error }, 'Failed to activate capability');
          skipped.push(key);
        } else {
          activated.push(key);
        }
      }

      logger.info(
        { userId, activated, skipped, source },
        'Capability activation complete'
      );

      return {
        data: { activated, skipped },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to activate capabilities from profile');
      return {
        data: null,
        error: error as Error
      };
    }
  }

  /**
   * Activate a specific capability for a user (manual override)
   */
  async activateCapability(
    userId: string,
    capabilityKey: string,
    source: ActivationSource,
    configuration?: Record<string, any>
  ): Promise<Result<void>> {
    try {
      // Get capability ID
      const { data: capability, error: fetchError } = await supabaseServer
        .from('capabilities')
        .select('id')
        .eq('capability_key', capabilityKey)
        .single();

      if (fetchError || !capability) {
        throw new Error(`Capability not found: ${capabilityKey}`);
      }

      // Check if already activated
      const { data: existing } = await supabaseServer
        .from('user_capabilities')
        .select('id, is_active')
        .eq('user_id', userId)
        .eq('capability_id', capability.id)
        .single();

      if (existing) {
        // Already exists - just ensure it's active
        if (!existing.is_active) {
          await supabaseServer
            .from('user_capabilities')
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq('id', existing.id);

          logger.info({ userId, capabilityKey }, 'Re-activated existing capability');
        } else {
          logger.info({ userId, capabilityKey }, 'Capability already active');
        }
        return { data: null, error: null };
      }

      // Insert new user_capability
      const { error: insertError } = await supabaseServer
        .from('user_capabilities')
        .insert({
          user_id: userId,
          capability_id: capability.id,
          activation_source: source,
          configuration: configuration || {},
          is_active: true
        });

      if (insertError) {
        throw insertError;
      }

      logger.info({ userId, capabilityKey, source }, 'Capability activated');

      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, capabilityKey }, 'Failed to activate capability');
      return { data: null, error: error as Error };
    }
  }

  /**
   * INTELLIGENCE LAYER - Determine which capabilities should be activated
   * DATABASE-DRIVEN - queries capabilities table for vertical matching
   */
  private async determineCapabilitiesFromProfile(
    profile: UserProfile,
    selectedCapabilities?: OnboardingCapability[]
  ): Promise<string[]> {
    const capabilitiesToActivate = new Set<string>();

    // 1. PRIORITY: Use onboarding chat selections (AI already determined needs)
    if (selectedCapabilities && selectedCapabilities.length > 0) {
      logger.info(
        { count: selectedCapabilities.length, capabilities: selectedCapabilities },
        'Processing onboarding chat selections'
      );

      // Map onboarding selections to capability_keys by querying database
      for (const cap of selectedCapabilities) {
        try {
          // First try exact match by capability_key (most reliable - used by computeConfiguration)
          // The id/name from OnboardingConfigurationService is the capability_key (e.g., 'crm', 'scheduling')
          let data;
          const exactMatch = await supabaseServer
            .from('capabilities')
            .select('capability_key')
            .eq('capability_key', cap.id)
            .single();

          if (exactMatch.data) {
            data = exactMatch.data;
          } else {
            // Fallback: try matching by display name (for legacy flows)
            const nameMatch = await supabaseServer
              .from('capabilities')
              .select('capability_key')
              .or(`name_en.ilike.%${cap.name}%,name_es.ilike.%${cap.name}%,name_he.ilike.%${cap.name}%`)
              .limit(1)
              .single();
            data = nameMatch.data;
          }

          if (data) {
            capabilitiesToActivate.add(data.capability_key);
            logger.info({ capabilityId: cap.id, capabilityName: cap.name, capabilityKey: data.capability_key }, 'Matched onboarding selection');
          } else {
            logger.warn({ capabilityId: cap.id, capabilityName: cap.name }, 'Capability not found in database');
          }
        } catch (error) {
          logger.warn({ err: error, capabilityId: cap.id, capabilityName: cap.name }, 'Could not match onboarding capability');
        }
      }
    }

    // 2. Query database for capabilities matching user's vertical
    if (profile.vertical) {
      logger.info({ vertical: profile.vertical }, 'Querying capabilities for vertical');

      const { data: verticalCaps } = await supabaseServer
        .from('capabilities')
        .select('capability_key, verticals');

      if (verticalCaps) {
        verticalCaps.forEach(cap => {
          // If verticals is empty OR contains user's vertical
          if (!cap.verticals || cap.verticals.length === 0 || cap.verticals.includes(profile.vertical!)) {
            capabilitiesToActivate.add(cap.capability_key);
            logger.info(
              { capabilityKey: cap.capability_key, vertical: profile.vertical },
              'Matched capability for vertical'
            );
          }
        });
      }
    }

    // 3. Add dependency-based and conditional capabilities

    // Reports only if they use payments (need financial tracking)
    if (capabilitiesToActivate.has('payments')) {
      capabilitiesToActivate.add('reports');
      logger.info('Added reports capability (dependency on payments)');
    }

    // Website only if they indicated they need it
    const needsWebsite =
      profile.goals?.includes('online_presence') ||
      profile.pain_points?.includes('no_website') ||
      profile.has_website === false;

    if (needsWebsite) {
      capabilitiesToActivate.add('website');
      logger.info({ needsWebsite, has_website: profile.has_website }, 'Added website capability');
    }

    // Insights - activate if they have scheduling or payments (need data to analyze)
    if (capabilitiesToActivate.has('scheduling') || capabilitiesToActivate.has('payments')) {
      capabilitiesToActivate.add('insights');
      logger.info('Added insights capability (has scheduling or payments data)');
    }

    // Automations - for users who want to automate or have high volume
    const wantsAutomation =
      profile.goals?.includes('automation') ||
      profile.goals?.includes('save_time') ||
      profile.pain_points?.includes('manual_tasks') ||
      (profile.clients_per_week && profile.clients_per_week >= 10);

    if (wantsAutomation) {
      capabilitiesToActivate.add('automations');
      logger.info({ wantsAutomation, clients_per_week: profile.clients_per_week }, 'Added automations capability');
    }

    // Campaigns - for users focused on growth/marketing
    const wantsMarketing =
      profile.goals?.includes('grow_business') ||
      profile.goals?.includes('get_clients') ||
      profile.goals?.includes('marketing');

    if (wantsMarketing) {
      capabilitiesToActivate.add('campaigns');
      logger.info({ wantsMarketing }, 'Added campaigns capability');
    }

    // Integrations - if they have external tools
    const hasExternalTools = profile.tools && profile.tools.length > 0;
    if (hasExternalTools) {
      capabilitiesToActivate.add('integrations');
      logger.info({ tools: profile.tools }, 'Added integrations capability');
    }

    return Array.from(capabilitiesToActivate);
  }

  /**
   * Get capability IDs from database by keys
   */
  private async getCapabilityIds(capabilityKeys: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    if (capabilityKeys.length === 0) {
      return map;
    }

    const { data, error } = await supabaseServer
      .from('capabilities')
      .select('id, capability_key')
      .in('capability_key', capabilityKeys);

    if (error) {
      logger.error({ err: error }, 'Failed to fetch capability IDs');
      return map;
    }

    data?.forEach(cap => {
      map.set(cap.capability_key, cap.id);
    });

    return map;
  }
}

// Singleton export
export const capabilityActivationService = new CapabilityActivationService();
