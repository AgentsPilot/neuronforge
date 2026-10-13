// lib/supabaseServerAuth.ts
// Server-only authenticated client - uses next/headers, only import in Server Components or API routes

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseFetch } from '@/lib/supabaseFetch'

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
      /*
       * Under the same connection cap as `supabaseServer` and `supabaseAdmin`.
       *
       * This client was the one left outside it, and it is the one that fails:
       * `supabaseFetch`'s own header quotes `GoTrueClient._getUser` ECONNRESET
       * as the symptom it was written for, while the auth client went on
       * opening sockets without a bound. A dropped auth socket surfaces as a
       * false 401 — a signed-in owner told they are not signed in — which is
       * the worst shape this failure takes.
       */
      global: { fetch: supabaseFetch },
    }
  )
}