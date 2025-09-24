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

export interface OnboardingData {
  profile: ProfileData;
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

const TOTAL_STEPS = 3;

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
    plugins: [
      { id: 'slack', name: 'Slack', description: 'Connect your Slack workspace', enabled: false },
      { id: 'gmail', name: 'Gmail', description: 'Connect your Gmail account', enabled: false },
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
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();
        
        if (error) {
          console.error('Error fetching profile:', error);
        }
        
        setState(prev => ({
          ...prev,
          data: {
            ...prev.data,
            profile: {
              ...prev.data.profile,
              fullName: profile?.full_name || '',
              email: user.email || '', // Load user email
            }
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

  // Remove updatePlugins since plugins are handled by the PluginsStep component directly

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
      case 1: // Plugins step (optional)
        return true;
      case 2: // Role step
        return state.data.role !== null;
      default:
        return false;
    }
  }, [state.currentStep, state.data.role, isProfileValid]);

  // API functions
  const saveOnboardingData = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('No authenticated user found');
      }

      // Update the profiles table with onboarding data
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          company: state.data.profile.company || null,
          job_title: state.data.profile.jobTitle || null,
          timezone: state.data.profile.timezone,
          // Note: full_name and email are already set during signup
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

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
        role: state.data.role
      });
      
      // Save to localStorage as backup
      localStorage.setItem('onboarding_completed', 'true');
      localStorage.setItem('user_profile', JSON.stringify(state.data.profile));
      
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
      await saveOnboardingData();
      return true;
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
      return false;
    }
  }, [saveOnboardingData]);

  // Utility functions
  const getStepTitle = useCallback((step?: number) => {
    const currentStepIndex = step ?? state.currentStep;
    const titles = ['Complete Your Profile', 'Connect Plugins', 'Select Your Role'];
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