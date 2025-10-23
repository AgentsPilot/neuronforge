'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    async function handleCallback() {
      console.log('=== AUTH CALLBACK START ===');

      const { data, error } = await supabase.auth.getSession();

      console.log('Session data:', data);
      console.log('Session error:', error);

      if (error) {
        console.error('Session error:', error);
        router.push('/login?error=verification_failed');
        return;
      }

      const user = data.session?.user;

      if (!user) {
        console.error('No user in session');
        router.push('/login?error=no_session');
        return;
      }

      console.log('User found:', {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
        created_at: user.created_at
      });

      // Check onboarding status from user metadata
      const onboardingCompleted = user.user_metadata?.onboarding_completed;

      console.log('Onboarding status:', onboardingCompleted);

      if (onboardingCompleted === false || onboardingCompleted === undefined) {
        // User hasn't completed onboarding - redirect to onboarding
        console.log('User needs to complete onboarding, redirecting to /onboarding...');
        router.push('/onboarding');
      } else {
        // Onboarding complete - go to dashboard
        console.log('Onboarding already completed, redirecting to /dashboard...');
        router.push('/dashboard');
      }
    }

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
      <p className="text-lg">Verifying your email...</p>
    </div>
  );
}