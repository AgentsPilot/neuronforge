import { createClient } from '@supabase/supabase-js'
import { createLogger } from '@/lib/logger'
import { supabaseFetch } from '@/lib/supabaseFetch'

const logger = createLogger({ module: 'supabaseAdmin' })

/*
 * The project address is `NEXT_PUBLIC_SUPABASE_URL`, the same variable every
 * other Supabase client reads (PROD-1a, A1).
 *
 * This module used to read a second, server-only address variable. Both were
 * settable, both named "the database", and nothing compared them: set them to
 * different projects and the writes made through this service-role client
 * landed in the other project, with RLS bypassed and no error. One variable
 * means there is nothing to disagree. `envConfigHardening.guard.test.ts` (G-4)
 * keeps the retired name from being read again.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Presence only, never a value: the address and the key stay out of the logs.
logger.debug({ hasUrl: !!url, hasServiceRoleKey: !!serviceRoleKey }, 'Supabase admin environment check')

// Prevent usage if not set, especially during server-side calls
if (!url || !serviceRoleKey) {
  if (typeof window === 'undefined') {
    // Server side: fatal. The importers are admin routes and the routing
    // service; none is middleware, so this cannot take every path down.
    logger.error(
      { hasUrl: !!url, hasServiceRoleKey: !!serviceRoleKey },
      'Missing Supabase environment variables for the admin client'
    )
    throw new Error(`Missing Supabase environment variables. URL: ${!!url}, ServiceKey: ${!!serviceRoleKey}`)
  } else {
    logger.warn('supabaseAdmin should not be used on the client')
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
