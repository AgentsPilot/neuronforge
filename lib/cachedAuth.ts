// lib/cachedAuth.ts
// Cached auth utility to reduce Supabase auth calls
// Each getUser() call makes a network request to Supabase - this caches results for 30 seconds

import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth'
import { User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// Simple in-memory cache for auth results
const authCache = new Map<string, { user: User; timestamp: number }>()
const AUTH_CACHE_TTL = 30000 // 30 seconds

/**
 * Get the current authenticated user with caching.
 * Caches the result for 30 seconds using the access token as the cache key.
 * This eliminates redundant Supabase auth calls within the same session.
 *
 * @returns The authenticated user or null if not authenticated
 */
export async function getCachedUser(): Promise<User | null> {
  const cookieStore = await cookies()

  // Try multiple possible cookie names for the access token
  const accessToken =
    cookieStore.get('sb-access-token')?.value ||
    cookieStore.get(`sb-${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0]}-auth-token`)?.value

  if (!accessToken) {
    return null
  }

  // Check cache first
  const cached = authCache.get(accessToken)
  if (cached && Date.now() - cached.timestamp < AUTH_CACHE_TTL) {
    return cached.user
  }

  // Cache miss - validate with Supabase
  const supabase = await createAuthenticatedServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  // Cache the result
  authCache.set(accessToken, { user, timestamp: Date.now() })

  // Cleanup old entries periodically to prevent memory leaks
  if (authCache.size > 1000) {
    const now = Date.now()
    for (const [key, value] of authCache.entries()) {
      if (now - value.timestamp > AUTH_CACHE_TTL) {
        authCache.delete(key)
      }
    }
  }

  return user
}

/**
 * Invalidate the auth cache for the current user.
 * Call this after logout or when the user's session changes.
 */
export async function invalidateAuthCache(): Promise<void> {
  const cookieStore = await cookies()
  const accessToken =
    cookieStore.get('sb-access-token')?.value ||
    cookieStore.get(`sb-${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0]}-auth-token`)?.value

  if (accessToken) {
    authCache.delete(accessToken)
  }
}

/**
 * Clear the entire auth cache.
 * Useful for testing or when you need to force re-validation of all users.
 */
export function clearAuthCache(): void {
  authCache.clear()
}
