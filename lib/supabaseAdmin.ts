import { createClient } from '@supabase/supabase-js'
import { supabaseFetch } from '@/lib/supabaseFetch'

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Add debugging to see what's actually loaded
console.log('🔍 Supabase Admin Environment Check:', {
  url: url ? '✅ Present' : '❌ Missing',
  serviceRoleKey: serviceRoleKey ? '✅ Present' : '❌ Missing',
  NODE_ENV: process.env.NODE_ENV
})

// Prevent usage if not set, especially during server-side calls
if (!url || !serviceRoleKey) {
  if (typeof window === 'undefined') {
    // server-side: throw fatal error with more details
    console.error('❌ Missing Supabase server env vars:', {
      SUPABASE_URL: url || 'MISSING',
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey ? 'Present' : 'MISSING'
    })
    throw new Error(`❌ Missing Supabase environment variables. URL: ${!!url}, ServiceKey: ${!!serviceRoleKey}`)
  } else {
    // client-side: return null client safely
    console.warn('⚠️ supabaseAdmin should not be used on the client.')
    throw new Error('supabaseAdmin cannot be used on the client side')
  }
}

// Always export a valid client if we get this far
export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  /* Under the same connection cap as `supabaseServer`. A client that opts out
     of the bound re-opens the hole for its own traffic, and ECONNRESET does
     not care which client opened the socket. */
  global: { fetch: supabaseFetch }
})