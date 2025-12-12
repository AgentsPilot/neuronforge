// lib/supabaseServer.ts
// Service role client for server-side operations.
// NOTE: Do NOT add next/headers imports here - this file is imported by client components via repositories.
// For authenticated server client with cookies, use supabaseServerAuth.ts instead.

import { createClient } from '@supabase/supabase-js'

// Service role client - bypasses RLS, use for admin operations
export function createServerSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // use a key that allows secure server-side writes
  )
}
export const supabaseServer = createServerSupabaseClient()