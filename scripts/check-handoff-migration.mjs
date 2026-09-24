/**
 * Is the auth handoff working, and if not, which half fails?
 *
 * Read-only. Three questions, in the order a sign-in asks them:
 *   1. does the table exist (minting possible)?
 *   2. does the claim function exist (redeeming possible)?
 *   3. are the codes being CONSUMED — `used_at` set — or left unclaimed?
 *
 * A row with `used_at` null means redeem never claimed it: the failure is the
 * claim. A row with `used_at` set means the claim worked and the failure is
 * downstream, in generateLink or verifyOtp.
 *
 *   node scripts/check-handoff-migration.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const t = await db.from('auth_handoff_codes').select('code').limit(1);
console.log('TABLE auth_handoff_codes      :', t.error ? 'MISSING — ' + t.error.message : 'EXISTS');

const r = await db.rpc('claim_auth_handoff_code', { p_code: '00000000-0000-4000-8000-000000000000' });
console.log('RPC   claim_auth_handoff_code :', r.error ? 'MISSING — ' + r.error.message : 'EXISTS');

const { data: rows, error } = await db
  .from('auth_handoff_codes')
  .select('code, created_at, expires_at, used_at')
  .order('created_at', { ascending: false })
  .limit(5);

if (error) {
  console.log('\nCould not read recent codes:', error.message);
} else {
  console.log(`\nMost recent ${rows.length} code(s):`);
  for (const row of rows) {
    const age = Math.round((Date.now() - new Date(row.created_at)) / 1000);
    console.log(
      `  ${row.code.slice(0, 8)}…  created ${age}s ago  ` +
      `expires ${new Date(row.expires_at) > new Date() ? 'in future' : 'PASSED'}  ` +
      `used_at ${row.used_at ? 'SET (claim worked)' : 'NULL (never claimed)'}`
    );
  }
}

/*
 * The step after the claim. If this fails, the claim has already spent the
 * code, so the sign-in cannot be retried — it fails with `session_failed`.
 */
const { data: anyUser } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
const email = anyUser?.users?.[0]?.email;

if (email) {
  const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  console.log(
    '\nadmin.generateLink(magiclink) :',
    linkError
      ? 'FAILS — ' + linkError.message
      : link?.properties?.hashed_token
        ? 'OK (returns hashed_token)'
        : 'RETURNS NO hashed_token — ' + JSON.stringify(Object.keys(link?.properties ?? {}))
  );
} else {
  console.log('\nadmin.generateLink : skipped (no user to test with)');
}
