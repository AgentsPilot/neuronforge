import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Prevent usage if not set, especially during server-side calls
if (!url || !serviceRoleKey) {
  if (typeof window === 'undefined') {
    // server-side: throw fatal error
    console.error('❌ Missing Supabase server env vars', { url, serviceRoleKey })
    throw new Error('❌ Missing Supabase environment variables.')
  } else {
    // client-side: return null client safely
    console.warn('⚠️ supabaseAdmin should not be used on the client.')
  }
}

// Only export if values exist
export const supabaseAdmin =
  url && serviceRoleKey ? createClient(url, serviceRoleKey) : null