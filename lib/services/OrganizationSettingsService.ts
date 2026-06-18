/**
 * OrganizationSettingsService - Business settings management
 *
 * Provides access to organization-level business settings including:
 * - Hourly rate for ROI calculations
 * - Currency preferences
 * - Work hours configuration
 *
 * @module lib/services/OrganizationSettingsService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'OrganizationSettingsService' });

// ============================================================================
// Types
// ============================================================================

export interface BusinessSettings {
  hourly_rate_usd: number;
  currency: string;
  work_hours_per_day: number;
  // New fields for AI Advisor context
  industry?: string;
  company_size?: string;
  primary_goal?: string;
  technical_level?: string;
}

export interface BusinessSettingsResult {
  data: BusinessSettings | null;
  error: Error | null;
}

// Default settings for new users
const DEFAULT_SETTINGS: BusinessSettings = {
  hourly_rate_usd: 50,
  currency: 'USD',
  work_hours_per_day: 8,
  // New fields are optional, so no defaults needed
};

// Industry options for dropdown
export const INDUSTRY_OPTIONS = [
  { value: 'b2b_saas', label: 'B2B SaaS' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'agency', label: 'Agency / Consulting' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'finance', label: 'Finance / Banking' },
  { value: 'education', label: 'Education' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'other', label: 'Other' },
] as const;

// Company size options for dropdown
export const COMPANY_SIZE_OPTIONS = [
  { value: 'solo', label: 'Solo / Freelancer' },
  { value: 'small', label: 'Small (2-10 employees)' },
  { value: 'medium', label: 'Medium (11-50 employees)' },
  { value: 'large', label: 'Large (51-500 employees)' },
  { value: 'enterprise', label: 'Enterprise (500+ employees)' },
] as const;

// Primary goal options for dropdown
export const PRIMARY_GOAL_OPTIONS = [
  { value: 'reduce_costs', label: 'Reduce operational costs' },
  { value: 'grow_revenue', label: 'Grow revenue' },
  { value: 'improve_efficiency', label: 'Improve efficiency' },
  { value: 'scale_operations', label: 'Scale operations' },
  { value: 'better_cx', label: 'Better customer experience' },
] as const;

// Technical level options for dropdown
export const TECHNICAL_LEVEL_OPTIONS = [
  { value: 'non_technical', label: 'Non-technical team' },
  { value: 'some_technical', label: 'Some technical skills' },
  { value: 'technical', label: 'Technical team' },
] as const;

// ============================================================================
// Service
// ============================================================================

export class OrganizationSettingsService {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
  }

  /**
   * Get the hourly rate for a user (for ROI calculations)
   * Falls back to profile.hourly_rate_usd, then to default
   */
  async getHourlyRate(userId: string): Promise<number> {
    try {
      // First try organization settings
      const settings = await this.getSettings(userId);
      if (settings.data?.hourly_rate_usd) {
        return settings.data.hourly_rate_usd;
      }

      // Fallback to profile hourly rate
      const { data: profile } = await this.supabase
        .from('profiles')
        .select('hourly_rate_usd')
        .eq('id', userId)
        .single();

      if (profile?.hourly_rate_usd) {
        return profile.hourly_rate_usd;
      }

      // Final fallback to default
      return DEFAULT_SETTINGS.hourly_rate_usd;
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get hourly rate');
      return DEFAULT_SETTINGS.hourly_rate_usd;
    }
  }

  /**
   * Get full business settings for a user
   */
  async getSettings(userId: string): Promise<BusinessSettingsResult> {
    try {
      // Get organization for this user
      const { data: org, error: orgError } = await this.supabase
        .from('organizations')
        .select('settings')
        .eq('owner_user_id', userId)
        .single();

      if (orgError) {
        // No organization found - return defaults
        if (orgError.code === 'PGRST116') {
          logger.debug({ userId }, 'No organization found, using defaults');
          return { data: DEFAULT_SETTINGS, error: null };
        }
        throw orgError;
      }

      // Parse settings from JSONB
      const settings = org?.settings as Partial<BusinessSettings> | null;

      return {
        data: {
          hourly_rate_usd: settings?.hourly_rate_usd ?? DEFAULT_SETTINGS.hourly_rate_usd,
          currency: settings?.currency ?? DEFAULT_SETTINGS.currency,
          work_hours_per_day: settings?.work_hours_per_day ?? DEFAULT_SETTINGS.work_hours_per_day,
          // New optional fields
          industry: settings?.industry,
          company_size: settings?.company_size,
          primary_goal: settings?.primary_goal,
          technical_level: settings?.technical_level,
        },
        error: null,
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get business settings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update business settings for a user
   */
  async updateSettings(
    userId: string,
    updates: Partial<BusinessSettings>
  ): Promise<BusinessSettingsResult> {
    try {
      // Validate updates
      if (updates.hourly_rate_usd !== undefined && updates.hourly_rate_usd < 0) {
        return { data: null, error: new Error('Hourly rate must be non-negative') };
      }
      if (updates.work_hours_per_day !== undefined &&
          (updates.work_hours_per_day < 1 || updates.work_hours_per_day > 24)) {
        return { data: null, error: new Error('Work hours must be between 1 and 24') };
      }

      // Get current organization
      const { data: org, error: orgError } = await this.supabase
        .from('organizations')
        .select('id, settings')
        .eq('owner_user_id', userId)
        .single();

      if (orgError) {
        logger.error({ err: orgError, userId }, 'Organization not found for settings update');
        return { data: null, error: orgError };
      }

      // Merge with existing settings
      const currentSettings = (org.settings as Partial<BusinessSettings>) || {};
      const newSettings: BusinessSettings = {
        hourly_rate_usd: updates.hourly_rate_usd ?? currentSettings.hourly_rate_usd ?? DEFAULT_SETTINGS.hourly_rate_usd,
        currency: updates.currency ?? currentSettings.currency ?? DEFAULT_SETTINGS.currency,
        work_hours_per_day: updates.work_hours_per_day ?? currentSettings.work_hours_per_day ?? DEFAULT_SETTINGS.work_hours_per_day,
        // New optional fields - only include if provided or already set
        industry: updates.industry ?? currentSettings.industry,
        company_size: updates.company_size ?? currentSettings.company_size,
        primary_goal: updates.primary_goal ?? currentSettings.primary_goal,
        technical_level: updates.technical_level ?? currentSettings.technical_level,
      };

      // Update organization settings
      const { error: updateError } = await this.supabase
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', org.id);

      if (updateError) {
        logger.error({ err: updateError, orgId: org.id }, 'Failed to update organization settings');
        return { data: null, error: updateError };
      }

      logger.info({ userId, orgId: org.id, settings: newSettings }, 'Business settings updated');

      return { data: newSettings, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Error updating business settings');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Calculate money saved from time saved
   */
  async calculateMoneySaved(userId: string, timeSavedSeconds: number): Promise<number> {
    const hourlyRate = await this.getHourlyRate(userId);
    const hoursSaved = timeSavedSeconds / 3600;
    return hoursSaved * hourlyRate;
  }

  /**
   * Calculate work days saved from time saved
   */
  async calculateWorkDaysSaved(userId: string, timeSavedSeconds: number): Promise<number> {
    const settings = await this.getSettings(userId);
    const hoursPerDay = settings.data?.work_hours_per_day ?? DEFAULT_SETTINGS.work_hours_per_day;
    const hoursSaved = timeSavedSeconds / 3600;
    return hoursSaved / hoursPerDay;
  }

  /**
   * Check if organization settings are complete (for AI Advisor context)
   * Returns true if industry, company_size, and primary_goal are set
   */
  async areSettingsComplete(userId: string): Promise<boolean> {
    const settings = await this.getSettings(userId);
    if (!settings.data) return false;

    return !!(
      settings.data.industry &&
      settings.data.company_size &&
      settings.data.primary_goal
    );
  }

  /**
   * Get hourly rate for an agent (checks agent-level first, then org, then profile)
   */
  async getAgentHourlyRate(agentId: string, userId: string): Promise<number> {
    try {
      // First check agent-level hourly rate
      const { data: agent } = await this.supabase
        .from('agents')
        .select('hourly_rate_usd')
        .eq('id', agentId)
        .eq('user_id', userId)
        .single();

      if (agent?.hourly_rate_usd) {
        return agent.hourly_rate_usd;
      }

      // Fall back to organization/profile rate
      return await this.getHourlyRate(userId);
    } catch (error) {
      logger.error({ err: error, agentId, userId }, 'Failed to get agent hourly rate');
      return DEFAULT_SETTINGS.hourly_rate_usd;
    }
  }
}

// Singleton export for convenience
export const organizationSettingsService = new OrganizationSettingsService();
