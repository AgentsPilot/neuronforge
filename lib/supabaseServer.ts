// lib/supabaseServer.ts

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Service role client - bypasses RLS, use for admin operations
export function createServerSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // use a key that allows secure server-side writes
  )
}
export const supabaseServer = createServerSupabaseClient()

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