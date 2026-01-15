import { User } from '@supabase/supabase-js';
import { UserProfileRepository } from '@/lib/repositories';
import type { UserContext } from './types';

/**
 * Build UserContext from Supabase auth user
 * Fast path - uses only auth metadata (no DB call)
 */
export function buildUserContextFromAuth(user: User): UserContext {
  return {
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    email: user.email || '',
    role: user.user_metadata?.role || '',
    company: user.user_metadata?.company || '',
    domain: user.user_metadata?.domain || '',
    ...(user.user_metadata?.timezone && { timezone: user.user_metadata.timezone })
  };
}

/**
 * Build enriched UserContext from profiles table + auth
 * Slower but more complete - fetches from profiles table
 */
export async function buildUserContextFromProfile(user: User): Promise<UserContext> {
  const profileRepo = new UserProfileRepository();
  const { data: profile } = await profileRepo.findById(user.id);

  const timezone = profile?.timezone || user.user_metadata?.timezone;
  return {
    full_name: profile?.full_name || user.user_metadata?.full_name || '',
    email: user.email || '',
    role: profile?.role || user.user_metadata?.role || '',
    company: profile?.company || user.user_metadata?.company || '',
    domain: user.user_metadata?.domain || '',
    ...(timezone && { timezone })
  };
}

/**
 * Merge server context with client-provided overrides
 * Client values take priority when provided
 */
export function mergeUserContext(
  serverContext: UserContext,
  clientContext?: Partial<UserContext>
): UserContext {
  if (!clientContext) return serverContext;
  return { ...serverContext, ...clientContext };
}
