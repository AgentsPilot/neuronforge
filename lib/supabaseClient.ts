// lib/supabaseBrowserClient.ts
'use client'

import { createBrowserClient } from '@supabase/ssr'

// Export URL and key for server-side usage
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createBrowserClient(
  supabaseUrl,
  supabaseAnonKey
)