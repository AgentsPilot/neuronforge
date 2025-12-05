'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter, usePathname } from 'next/navigation';

export function SessionHandler() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Check for tokens in URL hash (from marketing site login)
    const hash = window.location.hash;

    if (hash && hash.includes('access_token')) {
      console.log('[SessionHandler] Found tokens in URL hash');

      const params = new URLSearchParams(hash.substring(1));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');

      if (access_token && refresh_token) {
        console.log('[SessionHandler] Setting session from marketing site...');

        supabase.auth.setSession({
          access_token,
          refresh_token,
        }).then(({ data, error }) => {
          if (error) {
            console.error('[SessionHandler] Error setting session:', error);
            router.push('/login?error=session_failed');
          } else {
            console.log('[SessionHandler] Session set successfully for user:', data.user?.email);
            // Clear hash from URL
            window.history.replaceState(null, '', pathname);
            // Force a re-render to update auth state
            router.refresh();
          }
        });
      }
    }
  }, [pathname, router]);

  return null;
}
