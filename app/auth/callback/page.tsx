'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'verifying' | 'creating_profile' | 'redirecting' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      try {
        console.log('=== AUTH CALLBACK START ===');
        setStatus('verifying');

        const { data, error } = await supabase.auth.getSession();

        console.log('Session data:', data);
        console.log('Session error:', error);

        if (error) {
          console.error('Session error:', error);
          setStatus('error');
          setErrorMessage('Failed to verify email. Please try logging in.');
          setTimeout(() => router.push('/login?error=verification_failed'), 3000);
          return;
        }

        const user = data.session?.user;

        if (!user) {
          console.error('No user in session');
          setStatus('error');
          setErrorMessage('No active session found. Please try logging in.');
          setTimeout(() => router.push('/login?error=no_session'), 3000);
          return;
        }

        console.log('User found:', {
          id: user.id,
          email: user.email,
          user_metadata: user.user_metadata,
          created_at: user.created_at
        });

        // Ensure profile exists (create if missing)
        setStatus('creating_profile');
        try {
          const { data: existingProfile } = await supabase
            .from('profiles')
            .select('id, full_name')
            .eq('id', user.id)
            .single();

          if (!existingProfile) {
            console.log('Profile not found, creating...');
            const { error: profileError } = await supabase
              .from('profiles')
              .insert({
                id: user.id,
                full_name: user.user_metadata?.full_name || '',
                role: 'user',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });

            if (profileError) {
              console.error('Failed to create profile:', profileError);
              // Don't fail - let onboarding handle it with upsert
              console.log('Profile creation failed, onboarding will handle it');
            } else {
              console.log('Profile created successfully');
            }
          } else {
            console.log('Profile already exists');
          }
        } catch (profileErr) {
          console.error('Profile check/creation error:', profileErr);
          // Don't fail - continue to onboarding
        }

        // Check onboarding status from user metadata
        const onboardingCompleted = user.user_metadata?.onboarding_completed;

        console.log('Onboarding status:', onboardingCompleted);

        setStatus('redirecting');

        if (onboardingCompleted === false || onboardingCompleted === undefined) {
          // User hasn't completed onboarding - redirect to onboarding
          console.log('User needs to complete onboarding, redirecting to /onboarding...');
          setTimeout(() => router.push('/onboarding'), 1000);
        } else {
          // Onboarding complete - go to dashboard
          console.log('Onboarding already completed, redirecting to /dashboard...');
          setTimeout(() => router.push('/dashboard'), 1000);
        }
      } catch (err) {
        console.error('Unexpected error in auth callback:', err);
        setStatus('error');
        setErrorMessage('An unexpected error occurred. Please try logging in.');
        setTimeout(() => router.push('/login'), 3000);
      }
    }

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
      <div className="text-center">
        {status === 'verifying' && (
          <>
            <div className="w-12 h-12 mx-auto mb-4">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <p className="text-lg">Verifying your email...</p>
          </>
        )}
        {status === 'creating_profile' && (
          <>
            <div className="w-12 h-12 mx-auto mb-4">
              <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <p className="text-lg">Setting up your account...</p>
          </>
        )}
        {status === 'redirecting' && (
          <>
            <div className="w-12 h-12 mx-auto mb-4">
              <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg">Success! Redirecting...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-12 h-12 mx-auto mb-4">
              <svg className="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-lg text-red-400">{errorMessage}</p>
            <p className="text-sm text-slate-400 mt-2">Redirecting to login...</p>
          </>
        )}
      </div>
    </div>
  );
}