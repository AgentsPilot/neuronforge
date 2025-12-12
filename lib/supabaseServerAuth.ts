// lib/supabaseServerAuth.ts
// Server-only authenticated client - uses next/headers, only import in Server Components or API routes

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Authenticated server client - respects RLS, validates user session from cookies
 * Use this for user-facing API routes that need authentication
 *
 * @example
 * const supabase = await createAuthenticatedServerClient();
 * const { data: { user }, error } = await supabase.auth.getUser();
 */
export async function createAuthenticatedServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: async () => {},
        remove: async () => {},
      },
    }
  )
}