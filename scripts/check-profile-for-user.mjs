/**
 * Does this auth user have a completed business profile?
 *
 * Read-only. `/onboarding-chat` forwards to `/business-os` only when it can read
 * `business_profiles.onboarding_completed = true` for the SIGNED-IN user, so
 * "why am I sent to onboarding" is usually a question about which account is
 * actually signed in.
 *
 *   node scripts/check-profile-for-user.mjs <userId> [<userId> ...]
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

for (const userId of process.argv.slice(2)) {
  const { data: user } = await db.auth.admin.getUserById(userId);
  const { data: profile } = await db
    .from('business_profiles')
    .select('company_name, onboarding_completed, user_code, created_at')
    .eq('user_id', userId)
    .maybeSingle();

  console.log(`\n${userId}`);
  console.log('  email              :', user?.user?.email ?? '(no such auth user)');
  console.log('  profile row        :', profile ? 'exists' : 'NONE');
  if (profile) {
    console.log('  company            :', profile.company_name);
    console.log('  user_code          :', profile.user_code);
    console.log('  onboarding_completed:', profile.onboarding_completed);
    console.log('  → onboarding-chat would', profile.onboarding_completed ? 'FORWARD to /business-os' : 'KEEP you in setup');
  } else {
    console.log('  → onboarding-chat would KEEP you in setup (no profile to read)');
  }
}
