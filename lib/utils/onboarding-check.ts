/**
 * Onboarding Status Check Utility
 *
 * Purpose: Determine if user needs onboarding-v2 flow
 * - NEW users → onboarding-v2
 * - Users with business_profiles.onboarding_completed = true → skip
 * - Users with old onboarding_completed metadata → skip (backward compatibility)
 */

import { supabaseServer } from '@/lib/supabaseServer';
import type { User } from '@supabase/supabase-js';

export interface OnboardingStatus {
  needsOnboarding: boolean;
  reason: 'new_user' | 'profile_incomplete' | 'completed' | 'legacy_completed';
  profileCompleteness?: number;
}

/**
 * Check if user needs to go through onboarding-v2
 */
export async function checkOnboardingStatus(user: User): Promise<OnboardingStatus> {
  try {
    // Check business_profiles table first (new onboarding system)
    const { data: profile, error } = await supabaseServer
      .from('business_profiles')
      .select('onboarding_completed, profile_completeness')
      .eq('user_id', user.id)
      .single();

    // If profile exists and onboarding is completed → no need for onboarding
    if (!error && profile && profile.onboarding_completed) {
      return {
        needsOnboarding: false,
        reason: 'completed',
        profileCompleteness: profile.profile_completeness
      };
    }

    // If profile exists but onboarding not completed → needs onboarding
    if (!error && profile && !profile.onboarding_completed) {
      return {
        needsOnboarding: true,
        reason: 'profile_incomplete',
        profileCompleteness: profile.profile_completeness
      };
    }

    // Backward compatibility: Check old user_metadata.onboarding_completed
    const legacyOnboardingCompleted = user.user_metadata?.onboarding_completed;
    if (legacyOnboardingCompleted === true) {
      return {
        needsOnboarding: false,
        reason: 'legacy_completed'
      };
    }

    // No profile found and no legacy flag → new user needs onboarding
    return {
      needsOnboarding: true,
      reason: 'new_user'
    };
  } catch (error) {
    console.error('Error checking onboarding status:', error);

    // On error, default to showing onboarding (safer than skipping)
    return {
      needsOnboarding: true,
      reason: 'new_user'
    };
  }
}

/**
 * Mark onboarding as completed in user metadata (for backward compatibility)
 */
export async function markLegacyOnboardingComplete(userId: string): Promise<{ success: boolean; error?: Error }> {
  try {
    const { error } = await supabaseServer.auth.admin.updateUserById(userId, {
      user_metadata: { onboarding_completed: true }
    });

    if (error) {
      return { success: false, error: error as Error };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}
