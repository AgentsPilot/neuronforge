/**
 * Authentication helper for the Enhanced Prompt Generator simulator.
 *
 * Uses @supabase/ssr's createServerClient with an in-memory cookie jar
 * to ensure cookie format/encoding/chunking matches exactly what getUser()
 * expects. This eliminates cookie format drift risk entirely.
 */

import { createServerClient } from '@supabase/ssr';
import type { AuthState, SimulatorLogger } from '@/simulators/shared/types';

/** In-memory cookie jar populated by @supabase/ssr's internal cookie logic */
let cookieJar: Record<string, string> = {};

/** Cached auth state to avoid re-authenticating per scenario */
let cachedAuthState: AuthState | null = null;

/**
 * Authenticate with Supabase using signInWithPassword.
 * Session is cached across scenarios; re-authenticates only on first call or after clear.
 */
export async function authenticate(logger: SimulatorLogger): Promise<AuthState> {
  if (cachedAuthState?.authenticated) {
    logger.debug('Using cached auth session');
    return cachedAuthState;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.SIMULATOR_USER_EMAIL;
  const password = process.env.SIMULATOR_USER_PASSWORD;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. '
      + 'Ensure .env.local is loaded before calling authenticate().'
    );
  }

  if (!email || !password) {
    throw new Error(
      'Missing SIMULATOR_USER_EMAIL or SIMULATOR_USER_PASSWORD. '
      + 'Set these in .env.local for the simulator test user.'
    );
  }

  logger.info('Authenticating with Supabase...');

  // Reset the cookie jar before sign-in
  cookieJar = {};

  const supabaseSSR = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () =>
        Object.entries(cookieJar).map(([name, value]) => ({ name, value })),
      setAll: (cookies) =>
        cookies.forEach(({ name, value }) => {
          if (value) {
            cookieJar[name] = value;
          } else {
            delete cookieJar[name];
          }
        }),
    },
  });

  const { data, error } = await supabaseSSR.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    const msg = error?.message || 'No session returned';
    logger.error(`Authentication failed: ${msg}`);
    throw new Error(`Auth failed: ${msg}`);
  }

  // The cookieJar is now populated with correctly formatted/chunked cookies
  const cookieHeader = Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  logger.info('Authentication successful', {
    userId: data.user.id,
    email: data.user.email || email,
    cookieCount: Object.keys(cookieJar).length,
  });

  logger.debug('Cookie jar keys', {
    keys: Object.keys(cookieJar),
  });

  cachedAuthState = {
    authenticated: true,
    userId: data.user.id,
    email: data.user.email || email,
    cookieHeader,
  };

  return cachedAuthState;
}

/**
 * Clear cached auth state. Called on 401 responses to trigger re-authentication.
 */
export function clearAuthCache(): void {
  cachedAuthState = null;
  cookieJar = {};
}

/**
 * Get the current cookie header string for HTTP requests.
 * Returns empty string if not authenticated.
 */
export function getCookieHeader(): string {
  return cachedAuthState?.cookieHeader || '';
}
