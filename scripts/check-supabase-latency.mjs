/**
 * How long does this machine take to reach Supabase, and does it hold?
 *
 * Read-only. Five sequential round trips against the auth endpoint and a small
 * table read, reporting each. A dev server showing 25-30s responses and
 * `ECONNRESET` from `auth-js` is either the network between here and Supabase
 * or the project itself — this says which, without guessing from app logs.
 *
 *   node scripts/check-supabase-latency.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
console.log('Project:', url, '\n');

const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY);

const time = async (label, fn) => {
  const started = Date.now();
  try {
    const { error } = await fn();
    const ms = Date.now() - started;
    console.log(`  ${label.padEnd(22)} ${String(ms).padStart(6)}ms  ${error ? 'ERROR ' + error.message : 'ok'}`);
  } catch (err) {
    console.log(`  ${label.padEnd(22)} ${String(Date.now() - started).padStart(6)}ms  THREW ${err?.message ?? err}`);
  }
};

for (let i = 1; i <= 5; i++) {
  console.log(`Round ${i}`);
  await time('business_profiles', () => db.from('business_profiles').select('user_id').limit(1));
  await time('auth.admin.listUsers', () => db.auth.admin.listUsers({ page: 1, perPage: 1 }));
}
