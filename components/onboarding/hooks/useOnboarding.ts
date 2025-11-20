'use client';

import { useState, useCallback, useEffect } from 'react';
// Import your Supabase client
import { supabase } from '@/lib/supabaseClient';

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

export interface OnboardingData {
  profile: ProfileData;
  goal: string; // User's main goal for using agents
  mode: 'on_demand' | 'scheduled' | 'monitor' | 'guided' | null; // Preferred agent mode (matches spec), null until selected
  domain: UserDomain; // Add domain field (kept for backward compatibility)
  plugins: Plugin[];
  role: UserRole | null; // null until user selects a role
}

export interface OnboardingState {
  currentStep: number;
  data: OnboardingData;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
}

const TOTAL_STEPS = 4; // Profile, Goal, Trigger (Mode), Role

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
    role: null, // null until user selects - forces explicit choice
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
          console.log('Domain column not found, falling back to full_name and role only');
          const { data: fallbackProfile, error: fallbackError } = await supabase
            .from('profiles')
            .select('full_name, role')
            .eq('id', user.id)
            .single();
          
          profile = fallbackProfile ? { ...fallbackProfile, domain: null } : null;
          error = fallbackError;
        }
        
        if (error && error.code !== '42703') {
          console.error('Error fetching profile:', error);
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
        console.log('No user found');
        setState(prev => ({ 
          ...prev, 
          isInitialized: true, 
          isLoading: false 
        }));
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
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
      case 3: // Role step
        return state.data.role !== null;
      default:
        return false;
    }
  }, [state.currentStep, state.data.goal, state.data.role, state.data.mode, isProfileValid]);

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

      console.log('🔍 DEBUG: About to save profile with data:', {
        full_name: state.data.profile.fullName,
        company: state.data.profile.company,
        job_title: state.data.profile.jobTitle,
        timezone: state.data.profile.timezone,
        onboarding_goal: state.data.goal,
        onboarding_mode: state.data.mode,
        role: state.data.role,
        domain: state.data.domain,
        onboarding_data: onboardingData,
      });

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
        console.log('⚠️ Some onboarding columns not found in database. Saving minimal profile data.');
        console.log('Please run migration: 20251118_add_onboarding_fields_to_profiles.sql');

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
        console.error('❌ Profile update error:', profileError);
        throw new Error(`Failed to update profile: ${profileError.message}`);
      }

      console.log('✅ Onboarding data saved successfully to profiles table:');
      console.log('📝 Profile:', {
        full_name: state.data.profile.fullName,
        email: state.data.profile.email,
        company: state.data.profile.company,
        job_title: state.data.profile.jobTitle,
        timezone: state.data.profile.timezone,
      });
      console.log('🎯 Goal:', state.data.goal);
      console.log('⚡ Mode:', state.data.mode);
      console.log('🏢 Domain:', state.data.domain);
      console.log('👤 Role:', state.data.role);
      console.log('💾 Complete data saved to onboarding_data JSONB column');

      // Save to localStorage as backup
      localStorage.setItem('onboarding_completed', 'true');
      localStorage.setItem('user_profile', JSON.stringify(state.data.profile));
      localStorage.setItem('user_domain', state.data.domain);
      localStorage.setItem('onboarding_goal', state.data.goal);
      localStorage.setItem('onboarding_mode', state.data.mode || '');
      
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('Failed to save onboarding data:', error);
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

      // Allocate free tier quotas (tokens, storage, executions)
      console.log('🎁 Allocating free tier quotas...');
      try {
        const allocationResponse = await fetch('/api/onboarding/allocate-free-tier', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId: user.id }),
        });

        const allocationResult = await allocationResponse.json();

        if (allocationResult.success) {
          console.log('✅ Free tier quotas allocated:', allocationResult.allocation);
        } else {
          console.error('⚠️ Failed to allocate free tier quotas:', allocationResult.error);
          // Don't fail onboarding if allocation fails - user can contact support
        }
      } catch (allocationError) {
        console.error('⚠️ Error during quota allocation:', allocationError);
        // Don't fail onboarding if allocation fails
      }

      // Update auth metadata to mark onboarding as complete
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          onboarding_completed: true
        }
      });

      if (metadataError) {
        console.error('Failed to update onboarding status in metadata:', metadataError);
        // Don't fail - profile was created successfully, just log the error
      } else {
        console.log('Onboarding completed successfully - metadata updated');
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
        console.error('Failed to log onboarding completion to audit trail:', auditError);
      }

      return true;
    } catch (error) {
      console.error('Failed to complete onboarding:', error);

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
        console.error('Failed to log onboarding error to audit trail:', auditError);
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
      'Choose Your Access Level'
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