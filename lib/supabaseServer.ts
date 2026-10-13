// lib/supabaseServer.ts
// Service role client for server-side operations.
// NOTE: Do NOT add next/headers imports here - this file is imported by client components via repositories.
// For authenticated server client with cookies, use supabaseServerAuth.ts instead.

import { createClient } from '@supabase/supabase-js'
import { supabaseFetch } from '@/lib/supabaseFetch'

// Service role client - bypasses RLS, use for admin operations
export function createServerSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // use a key that allows secure server-side writes
    {
      /*
       * Bounded concurrency. Node's fetch caps nothing per host, so a burst —
       * one contact drawer is nine API routes and thirty-odd queries — opened
       * thirty TLS connections at once and Supabase reset them:
       *
       *     TypeError: fetch failed … read ECONNRESET
       *       at PluginConnectionRepository.findActiveByUser
       *
       * Past the limit a request waits for a slot instead of opening another
       * socket. See `lib/supabaseFetch.ts`.
       */
      global: { fetch: supabaseFetch },
    }
  )
}
export const supabaseServer = createServerSupabaseClient()