'use client';

import { useState, useCallback, useEffect } from 'react';
// Import your Supabase client
import { supabase } from '@/lib/supabaseClient';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'useOnboarding' });

// Types
export interface ProfileData {
  fullName: string;
  email: string; // Add email field
  company: string;
  jobTitle: string;
  timezone: string;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export type UserRole = 'business_owner' | 'manager' | 'consultant' | 'operations' | 'sales' | 'marketing' | 'finance' | 'other';
export type UserDomain = 'sales' | 'marketing' | 'operations' | 'engineering' | 'executive' | 'other';

// Pipeline stage for customization
export interface PipelineStage {
  key: string;
  label: string;
  color: string;
}

// Pipeline template types
export type PipelineTemplate = 'therapist' | 'coach' | 'consultant' | 'sales' | 'default';

export interface OnboardingData {
  profile: ProfileData;
  goal: string; // User's main goal for using agents
  mode: 'on_demand' | 'scheduled' | 'monitor' | 'guided' | null; // Preferred agent mode (matches spec), null until selected
  domain: UserDomain; // Add domain field (kept for backward compatibility)
  plugins: Plugin[];
  role: UserRole | null; // null until user selects a role (kept for backward compat)
  pipelineTemplate: PipelineTemplate | null; // Selected pipeline template
  pipelineStages: PipelineStage[]; // Customized pipeline stages
}

export interface OnboardingState {
  currentStep: number;
  data: OnboardingData;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
}

const TOTAL_STEPS = 4; // Profile, Goal, Trigger (Mode), Pipeline

const initialState: OnboardingState = {
  currentStep: 0,
  data: {
    profile: {
      fullName: '',
      email: '', // Add email to initial state
      company: '',
      jobTitle: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    goal: '', // User's main goal
    mode: null, // null until user selects - forces explicit choice
    domain: 'other', // Add domain to initial state (backward compatibility)
    plugins: [
      { id: 'slack', name: 'Slack', description: 'Connect your Slack workspace', enabled: false },
      { id: 'google-mail', name: 'Gmail', description: 'Connect your Gmail account', enabled: false },
      { id: 'calendar', name: 'Google Calendar', description: 'Connect your calendar', enabled: false },
      { id: 'drive', name: 'Google Drive', description: 'Connect your Google Drive', enabled: false },
    ],
    role: null, // null until user selects - forces explicit choice (kept for backward compat)
    pipelineTemplate: null, // null until user selects a template
    pipelineStages: [], // Empty until template is selected and optionally customized
  },
  isLoading: false,
  error: null,
  isInitialized: false,
};

export const useOnboarding = () => {
  const [state, setState] = useState<OnboardingState>(initialState);

  // Load user data from signup when component mounts
  const loadUserData = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true }));

      // Get current user from Supabase
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Try to fetch profile with domain and role columns
        let { data: profile, error } = await supabase
          .from('profiles')
          .select('full_name, domain, role')
          .eq('id', user.id)
          .single();
        
        // If domain column doesn't exist, fall back to full_name and role only
        if (error && error.code === '42703') {
          logger.debug('Domain column not found, falling back to full_name and role only');
          const { data: fallbackProfile, error: fallbackError } = await supabase
            .from('profiles')
            .select('full_name, role')
            .eq('id', user.id)
            .single();
          
          profile = fallbackProfile ? { ...fallbackProfile, domain: null } : null;
          error = fallbackError;
        }
        
        if (error && error.code !== '42703') {
          logger.error({ err: error }, 'Error fetching profile');
        }
        
        setState(prev => ({
          ...prev,
          data: {
            ...prev.data,
            profile: {
              ...prev.data.profile,
              // Try profile first, then user metadata, then empty string
              fullName: profile?.full_name || user.user_metadata?.full_name || '',
              email: user.email || '',
            },
            domain: (profile?.domain as any) || 'other',
            role: (profile?.role as any) || 'user', // Load existing role
          },
          isInitialized: true,
          isLoading: false,
        }));
      } else {
        logger.debug('No user found');
        setState(prev => ({ 
          ...prev, 
          isInitialized: true, 
          isLoading: false 
        }));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load user data');
      setState(prev => ({ 
        ...prev, 
        isInitialized: true, 
        isLoading: false,
        error: 'Failed to load user data'
      }));
    }
  }, []);

  // Load user data on mount
  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  // Navigation functions
  const nextStep = useCallback(() => {
    setState(prev => ({
      ...prev,
      currentStep: Math.min(prev.currentStep + 1, TOTAL_STEPS - 1),
    }));
  }, []);

  const prevStep = useCallback(() => {
    setState(prev => ({
      ...prev,
      currentStep: Math.max(prev.currentStep - 1, 0),
    }));
  }, []);

  const goToStep = useCallback((step: number) => {
    setState(prev => ({
      ...prev,
      currentStep: Math.max(0, Math.min(step, TOTAL_STEPS - 1)),
    }));
  }, []);

  // Data update functions
  const updateProfile = useCallback((profileData: Partial<ProfileData>) => {
    setState(prev => ({
      ...prev,
      data: {
        ...prev.data,
        profile: { ...prev.data.profile, ...profileData },
      },
    }));
  }, []);

  // Add updateGoal function
  const updateGoal = useCallback((goal: string) => {
    setState(prev => ({
      ...prev,
      data: {
        ...prev.data,
        goal,
      },
    }));
  }, []);

  // Add updateMode function
  const updateMode = useCallback((mode: 'on-demand' | 'scheduled') => {
    setState(prev => ({
      ...prev,
      data: {
        ...prev.data,
        mode,
      },
    }));
  }, []);

  // Add updateDomain function
  const updateDomain = useCallback((domain: UserDomain) => {
    setState(prev => ({
      ...prev,
      data: {
        ...prev.data,
        domain,
      },
    }));
  }, []);

  const updateRole = useCallback((role: UserRole) => {
    setState(prev => ({
      ...prev,
      data: {
        ...prev.data,
        role,
      },
    }));
  }, []);

  // Pipeline functions
  const updatePipelineTemplate = useCallback((template: PipelineTemplate) => {
    setState(prev => ({
      ...prev,
      data: {
        ...prev.data,
        pipelineTemplate: template,
      },
    }));
  }, []);

  const updatePipelineStages = useCallback((stages: PipelineStage[]) => {
    setState(prev => ({
      ...prev,
      data: {
        ...prev.data,
        pipelineStages: stages,
      },
    }));
  }, []);

  // Validation functions - make company and job title optional
  const isProfileValid = useCallback(() => {
    const { fullName, email, timezone } = state.data.profile;
    // Only require fullName, email, and timezone - company and jobTitle are optional
    return fullName.trim() !== '' && email.trim() !== '' && timezone.trim() !== '';
  }, [state.data.profile]);

  const canProceedToNext = useCallback(() => {
    switch (state.currentStep) {
      case 0: // Profile step
        return isProfileValid();
      case 1: // Goal step
        return state.data.goal.trim().length >= 10; // Require at least 10 characters
      case 2: // Trigger/Mode step
        return state.data.mode !== null;
      case 3: // Pipeline step - require template selection OR at least 2 custom stages
        return state.data.pipelineTemplate !== null || state.data.pipelineStages.length >= 2;
      default:
        return false;
    }
  }, [state.currentStep, state.data.goal, state.data.pipelineTemplate, state.data.pipelineStages, state.data.mode, isProfileValid]);

  // API functions
  const saveOnboardingData = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('No authenticated user found');
      }

      // Prepare complete onboarding data for JSONB storage
      const onboardingData = {
        profile: state.data.profile,
        goal: state.data.goal,
        mode: state.data.mode,
        domain: state.data.domain,
        role: state.data.role,
        completedAt: new Date().toISOString(),
      };

      // Personal fields (name, company, job title) are deliberately not logged.
      logger.debug(
        {
          timezone: state.data.profile.timezone,
          goal: state.data.goal,
          mode: state.data.mode,
          role: state.data.role,
          domain: state.data.domain,
        },
        'Saving onboarding profile'
      );

      // Upsert (create or update) the profiles table with ALL onboarding data
      let { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id, // Required for upsert
          full_name: state.data.profile.fullName,
          company: state.data.profile.company || null,
          job_title: state.data.profile.jobTitle || null,
          timezone: state.data.profile.timezone,
          onboarding_goal: state.data.goal || null,
          onboarding_mode: state.data.mode || null,
          domain: state.data.domain || null,
          role: state.data.role,
          onboarding_data: onboardingData, // Store complete data as JSONB
          onboarding: true, // Mark onboarding as completed
          created_at: new Date().toISOString(), // Will be ignored if profile exists
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id' // Update if profile with this id exists
        });

      // If some columns don't exist, try fallback without them
      if (profileError && profileError.code === '42703') {
        logger.warn(
          { migration: '20251118_add_onboarding_fields_to_profiles.sql' },
          'Some onboarding columns not found in database; saving minimal profile data'
        );

        const { error: fallbackError } = await supabase
          .from('profiles')
          .upsert({
            id: user.id, // Required for upsert
            full_name: state.data.profile.fullName,
            company: state.data.profile.company || null,
            job_title: state.data.profile.jobTitle || null,
            timezone: state.data.profile.timezone,
            role: state.data.role, // Keep role as it exists in the table
            created_at: new Date().toISOString(), // Will be ignored if profile exists
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'id' // Update if profile with this id exists
          });

        profileError = fallbackError;

        // Store all onboarding data in localStorage as backup when DB columns don't exist
        localStorage.setItem('onboarding_goal', state.data.goal);
        localStorage.setItem('onboarding_mode', state.data.mode || '');
        localStorage.setItem('user_domain', state.data.domain);
        localStorage.setItem('onboarding_data', JSON.stringify(onboardingData));
      }

      if (profileError) {
        logger.error({ err: profileError }, 'Profile update error');
        throw new Error(`Failed to update profile: ${profileError.message}`);
      }

      /*
       * ───────────────────────────────────────────────────────────────────────
       * THE TIMEZONE HAS TO REACH `user_preferences`, NOT ONLY `profiles`.
       *
       * Onboarding asks for a timezone, infers it from the browser, and makes
       * it a required field — then wrote it to `profiles.timezone` alone. Every
       * consumer reads `user_preferences.timezone`: availability, the booking
       * routes, every client-facing email. That column has a DEFAULT of 'UTC',
       * so a business that answered the question looked, to the whole platform,
       * exactly like one that never had.
       *
       * `scripts/backfill-timezone-preferences.ts` exists to repair this drift
       * after the fact. This is the leak it was repairing.
       *
       * Written as a second upsert rather than folded into the first, because
       * they are different tables with different conflict targets — the same
       * pair `/api/user/profile` and the Business OS settings page already
       * write together.
       *
       * NOT FATAL. An owner who has finished onboarding must not be sent back
       * to the start because a preferences row would not save; the readiness
       * card asks for the timezone again if this did not land.
       * ───────────────────────────────────────────────────────────────────────
       */
      if (state.data.profile.timezone) {
        const { error: prefsError } = await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            timezone: state.data.profile.timezone,
            // Inferred from the browser, shown to them, and accepted by
            // finishing onboarding — an answer, so it counts as confirmed.
            timezone_confirmed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id'
          });

        if (prefsError) {
          logger.warn(
            { err: prefsError, timezone: state.data.profile.timezone },
            'Timezone saved to profiles but not to user_preferences; the readiness card will ask again'
          );
        }
      }

      logger.info(
        {
          timezone: state.data.profile.timezone,
          goal: state.data.goal,
          mode: state.data.mode,
          domain: state.data.domain,
          role: state.data.role,
        },
        'Onboarding data saved to profiles table (incl. onboarding_data JSONB)'
      );

      // Save to localStorage as backup
      localStorage.setItem('onboarding_completed', 'true');
      localStorage.setItem('user_profile', JSON.stringify(state.data.profile));
      localStorage.setItem('user_domain', state.data.domain);
      localStorage.setItem('onboarding_goal', state.data.goal);
      localStorage.setItem('onboarding_mode', state.data.mode || '');
      
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      logger.error({ err: error }, 'Failed to save onboarding data');
      setState(prev => ({ ...prev, error: errorMessage }));
      throw error;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [state.data]);

  const completeOnboarding = useCallback(async () => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('No authenticated user found');
      }

      // Save onboarding data (creates/updates profile)
      await saveOnboardingData();

      // Allocate free tier quotas (tokens, storage, executions).
      // The route grants to the signed-in session user only, once; no user id is sent (S-6 fix).
      logger.debug('Allocating free tier quotas');
      try {
        const allocationResponse = await fetch('/api/onboarding/allocate-free-tier', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        const allocationResult = await allocationResponse.json();

        if (allocationResult.success && allocationResult.alreadyGranted) {
          // A repeat completion (e.g. a second tab) is a success: the grant happened earlier.
          logger.info('Free tier quotas already granted');
        } else if (allocationResult.success) {
          logger.info({ allocation: allocationResult.allocation }, 'Free tier quotas allocated');
        } else {
          logger.error(
            { status: allocationResponse.status, error: allocationResult.error },
            'Failed to allocate free tier quotas'
          );
          // Don't fail onboarding if allocation fails - user can contact support
        }
      } catch (allocationError) {
        logger.error({ err: allocationError }, 'Error during quota allocation');
        // Don't fail onboarding if allocation fails
      }

      // Seed pipeline stages based on user selection
      logger.debug('Seeding pipeline stages');
      try {
        const pipelineStages = state.data.pipelineStages;
        const pipelineTemplate = state.data.pipelineTemplate;

        if (pipelineStages.length >= 2) {
          // User customized stages - use create_custom
          const pipelineResponse = await fetch('/api/crm/pipeline-stages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'create_custom',
              stages: pipelineStages.map(s => ({
                stage_key: s.key,
                stage_label: s.label,
                color: s.color
              }))
            }),
          });

          const pipelineResult = await pipelineResponse.json();
          if (pipelineResult.success) {
            logger.info({ stageCount: pipelineResult.stages?.length }, 'Custom pipeline stages created');
          } else {
            logger.error({ error: pipelineResult.error }, 'Failed to create custom pipeline stages');
          }
        } else if (pipelineTemplate) {
          // User selected a template but didn't customize - seed defaults
          const pipelineResponse = await fetch('/api/crm/pipeline-stages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'seed_defaults',
              vertical: pipelineTemplate
            }),
          });

          const pipelineResult = await pipelineResponse.json();
          if (pipelineResult.success) {
            logger.info({ pipelineTemplate }, 'Default pipeline stages seeded');
          } else {
            logger.error({ error: pipelineResult.error, pipelineTemplate }, 'Failed to seed default pipeline stages');
          }
        }
      } catch (pipelineError) {
        logger.error({ err: pipelineError }, 'Error during pipeline seeding');
        // Don't fail onboarding if pipeline seeding fails
      }

      // Update auth metadata to mark onboarding as complete
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          onboarding_completed: true
        }
      });

      if (metadataError) {
        logger.error({ err: metadataError }, 'Failed to update onboarding status in metadata');
        // Don't fail - profile was created successfully, just log the error
      } else {
        logger.info('Onboarding completed; metadata updated');
      }

      // Log onboarding completion to audit trail via API
      try {
        await fetch('/api/audit/log', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id
          },
          body: JSON.stringify({
            action: 'USER_ONBOARDING_COMPLETED',
            entityType: 'user',
            entityId: user.id,
            resourceName: state.data.profile.fullName || user.email || 'User',
            details: {
              email: state.data.profile.email,
              full_name: state.data.profile.fullName,
              company: state.data.profile.company,
              job_title: state.data.profile.jobTitle,
              timezone: state.data.profile.timezone,
              domain: state.data.domain,
              role: state.data.role,
              onboarding_completed: true
            },
            severity: 'info'
          })
        });
      } catch (auditError) {
        logger.error({ err: auditError }, 'Failed to log onboarding completion to audit trail');
      }

      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to complete onboarding');

      // Log onboarding failure to audit trail via API
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await fetch('/api/audit/log', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': user.id
            },
            body: JSON.stringify({
              action: 'USER_ONBOARDING_FAILED',
              entityType: 'user',
              entityId: user.id,
              resourceName: state.data.profile.fullName || user.email || 'User',
              details: {
                error_message: error instanceof Error ? error.message : 'Unknown error',
                step_reached: state.currentStep,
                profile_data: state.data.profile
              },
              severity: 'warning'
            })
          });
        }
      } catch (auditError) {
        logger.error({ err: auditError }, 'Failed to log onboarding error to audit trail');
      }

      return false;
    }
  }, [saveOnboardingData, state.data, state.currentStep]);

  // Utility functions
  const getStepTitle = useCallback((step?: number) => {
    const currentStepIndex = step ?? state.currentStep;
    const titles = [
      'Welcome! Tell Us About You',
      'What Do You Want to Accomplish?',
      'When Should Your Agent Work?',
      'Set Up Your Client Pipeline'
    ];
    return titles[currentStepIndex] || 'Unknown Step';
  }, [state.currentStep]);

  const getProgress = useCallback(() => {
    return ((state.currentStep + 1) / TOTAL_STEPS) * 100;
  }, [state.currentStep]);

  const isFirstStep = state.currentStep === 0;
  const isLastStep = state.currentStep === TOTAL_STEPS - 1;

  return {
    // State
    currentStep: state.currentStep,
    data: state.data,
    isLoading: state.isLoading,
    error: state.error,
    isInitialized: state.isInitialized,

    // Navigation
    nextStep,
    prevStep,
    goToStep,

    // Data updates
    updateProfile,
    updateGoal,
    updateMode,
    updateDomain, // Add updateDomain (backward compatibility)
    updateRole,
    updatePipelineTemplate,
    updatePipelineStages,

    // Validation
    canProceedToNext,
    isProfileValid,

    // Actions
    completeOnboarding,
    saveOnboardingData,

    // Utilities
    getStepTitle,
    getProgress,
    isFirstStep,
    isLastStep,
    totalSteps: TOTAL_STEPS,
  };
};