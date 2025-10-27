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

export type UserRole = 'admin' | 'user' | 'viewer';
export type UserDomain = 'sales' | 'marketing' | 'operations' | 'engineering' | 'executive' | 'other';

export interface OnboardingData {
  profile: ProfileData;
  domain: UserDomain; // Add domain field
  plugins: Plugin[];
  role: UserRole;
}

export interface OnboardingState {
  currentStep: number;
  data: OnboardingData;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
}

const TOTAL_STEPS = 4; // Updated from 3 to 4 steps

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
    domain: 'other', // Add domain to initial state
    plugins: [
      { id: 'slack', name: 'Slack', description: 'Connect your Slack workspace', enabled: false },
      { id: 'google-mail', name: 'Gmail', description: 'Connect your Gmail account', enabled: false },
      { id: 'calendar', name: 'Google Calendar', description: 'Connect your calendar', enabled: false },
      { id: 'drive', name: 'Google Drive', description: 'Connect your Google Drive', enabled: false },
    ],
    role: 'admin',
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
      case 1: // Domain step
        return state.data.domain !== null;
      case 2: // Plugins step (optional)
        return true;
      case 3: // Role step
        return state.data.role !== null;
      default:
        return false;
    }
  }, [state.currentStep, state.data.domain, state.data.role, isProfileValid]);

  // API functions
  const saveOnboardingData = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('No authenticated user found');
      }

      // Upsert (create or update) the profiles table with onboarding data
      // First, try to upsert with all fields including domain and onboarding flag
      let { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id, // Required for upsert
          full_name: state.data.profile.fullName,
          company: state.data.profile.company || null,
          job_title: state.data.profile.jobTitle || null,
          timezone: state.data.profile.timezone,
          domain: state.data.domain,
          role: state.data.role,
          onboarding: true, // Mark onboarding as completed
          created_at: new Date().toISOString(), // Will be ignored if profile exists
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id' // Update if profile with this id exists
        });

      // If domain or onboarding column doesn't exist, try without it (role column exists)
      if (profileError && profileError.code === '42703') {
        console.log('Domain or onboarding column not found, saving without those fields');
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

        // Store domain in localStorage as backup
        localStorage.setItem('user_domain', state.data.domain);
      }

      if (profileError) {
        console.error('Profile update error:', profileError);
        throw new Error(`Failed to update profile: ${profileError.message}`);
      }

      // Optional: Mark onboarding as completed in the profiles table
      // You could add an onboarding_completed boolean column if needed
      
      console.log('Onboarding data saved successfully:', {
        company: state.data.profile.company,
        job_title: state.data.profile.jobTitle,
        timezone: state.data.profile.timezone,
        domain: state.data.domain,
        role: state.data.role
      });
      
      // Save to localStorage as backup
      localStorage.setItem('onboarding_completed', 'true');
      localStorage.setItem('user_profile', JSON.stringify(state.data.profile));
      localStorage.setItem('user_domain', state.data.domain);
      
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
      'Complete Your Profile', 
      'Choose Your Domain', 
      'Connect Plugins', 
      'Select Your Role'
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
    updateDomain, // Add updateDomain
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