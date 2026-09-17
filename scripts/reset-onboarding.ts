// scripts/reset-onboarding.ts
//
// Wipe everything the onboarding chat builds, so it can be run again from
// scratch against the same account.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// The build route is idempotent by SKIPPING: it leaves the pipeline alone if
// stages exist (build/route.ts:383) and the services alone if services exist
// (:472). So re-running onboarding on an account that has been through it once
// changes almost nothing — the second answer set is silently ignored, and the
// dashboard you are looking at is still the first one's.
//
// Testing a tailored setup means testing several DIFFERENT answer sets, which
// means the account has to be genuinely empty each time.
//
// HOW IT WORKS NOW
//
// It deletes ONE row: the business_profiles row. Every table a business owns
// carries a foreign key to it with ON DELETE CASCADE
// (supabase/migrations/20260916_business_data_ownership.sql), so the database
// removes the rest.
//
// This replaces a hand-maintained list of tables to delete in order. That list
// named 17 tables and the registry now names 55 — it had fallen 38 behind, with
// every insight table among them, and nothing failed when it drifted because an
// out-of-date list looks exactly like a complete one. Deleting the parent
// cannot go stale.
//
// SAFETY
//
// Prints what it would delete and stops. Nothing is removed without --confirm.
// The auth user itself is never touched — you keep the login, the password and
// the session; only the business built on top of it goes.
//
// Run with:
//   npx tsx scripts/reset-onboarding.ts <user-email>              # dry run
//   npx tsx scripts/reset-onboarding.ts <user-email> --confirm    # do it
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { BUSINESS_OWNED_TABLES, USER_OWNED_TABLES } from '../lib/business-os/businessOwnedTables';

config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * What the reset has to remove BY HAND.
 *
 * Only the tables a business owns but the cascade cannot reach. There is one:
 * the onboarding transcript is deliberately not tied to the profile, because it
 * is written before the profile exists — the chat is what produces it — so a
 * foreign key there would reject the first message of every new account.
 *
 * Everything else is handled by deleting the profile. See
 * lib/business-os/businessOwnedTables.ts for the full ownership map.
 */
const NOT_CASCADED = [
  /*
   * The chat page clears this on load by itself, so this is for the case the
   * page never gets that far: an account left mid-conversation shows the
   * welcome screen with the SERVER still standing at "tell me about your
   * services", and the language you then pick is read as a service description.
   */
  'onboarding_conversations',
];


async function main() {
  const [email, ...flags] = process.argv.slice(2);
  const confirmed = flags.includes('--confirm');

  if (!email) {
    console.error('Usage: npx tsx scripts/reset-onboarding.ts <user-email> [--confirm]');
    process.exit(1);
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
  if (authError) {
    console.error('Could not list users:', authError.message);
    process.exit(1);
  }

  const user = authData.users.find((u: any) => u.email === email);
  if (!user) {
    console.error(`No account for ${email}`);
    process.exit(1);
  }

  console.log(`\n${confirmed ? 'RESETTING' : 'DRY RUN —'} ${email}  (${user.id})\n`);

  /*
   * Counted before anything is deleted, because after the cascade there is
   * nothing left to count. A dry run and a real run print the same list; only
   * the verb differs.
   */
  let total = 0;
  const populated: Array<[string, number]> = [];

  for (const table of BUSINESS_OWNED_TABLES) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // A table absent from this environment is not a failure. Environments
    // differ, and a reset that stops halfway leaves a state nobody intended.
    if (error) continue;

    const rows = count || 0;
    if (!rows) continue;

    total += rows;
    populated.push([table, rows]);
  }

  for (const [table, rows] of populated) {
    console.log(`  ${table.padEnd(34)} ${rows} row${rows === 1 ? '' : 's'}`);
  }
  if (!populated.length) console.log('  (no business data on this account)');

  console.log(`\n  ${total} row${total === 1 ? '' : 's'} across ${populated.length} table${populated.length === 1 ? '' : 's'}`);

  /*
   * The profile is DELETED, and that is what does the work.
   *
   * It used to be emptied instead, to preserve `user_code` — the address every
   * smart link and public page is built from — so that a reset would not
   * invalidate links someone had open. That reasoning does not survive contact
   * with the cascade: ON DELETE CASCADE fires on DELETE, so clearing fields
   * leaves every child row in place, attached to the same user_id, ready to be
   * adopted by the next business built on this account. Emptying the row is
   * precisely the bug this reset exists to undo.
   *
   * The link tradeoff is also smaller than it looks. A reset means the business
   * is gone; a booking link that still resolves to it would be worse than one
   * that stops working.
   */
  if (!confirmed) {
    console.log('\n  business_profiles                  would be DELETED — the cascade takes the rows above');
    console.log(`\n${total} row${total === 1 ? '' : 's'} would go. Re-run with --confirm.\n`);
    return;
  }

  const { error: profileError } = await supabaseAdmin
    .from('business_profiles')
    .delete()
    .eq('user_id', user.id);

  if (profileError) {
    console.error(`\n  business_profiles                  FAILED — ${profileError.message}`);
    console.error('\nNothing else was removed: the cascade is what deletes the rest.\n');
    process.exit(1);
  }

  console.log('\n  business_profiles                  deleted — cascade removed the rows above');

  /*
   * What the cascade cannot reach, done by hand.
   */
  for (const table of NOT_CASCADED) {
    const { error } = await supabaseAdmin.from(table).delete().eq('user_id', user.id);
    console.log(`  ${table.padEnd(34)} ${error ? `FAILED — ${error.message}` : 'deleted'}`);
  }

  /*
   * Verified rather than assumed.
   *
   * The whole point of this rewrite is that one delete removes everything, and
   * a claim like that is worth checking rather than trusting — a table whose
   * constraint was never added would otherwise be silently left behind, which
   * is the exact failure the old hand-maintained list kept producing.
   */
  const leftovers: string[] = [];
  for (const table of BUSINESS_OWNED_TABLES) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if (error) continue;
    if (count) leftovers.push(`${table} (${count})`);
  }

  if (leftovers.length) {
    console.error('\n  ⚠️  SURVIVED THE CASCADE — these tables are missing their constraint:');
    leftovers.forEach(l => console.error(`      ${l}`));
    console.error('      Re-run supabase/migrations/20260916_business_data_ownership.sql\n');
    process.exit(1);
  }

  console.log(
    `\nDone. ${total} row${total === 1 ? '' : 's'} gone. Sign in as ${email} and the ` +
    'onboarding chat will start from nothing.\n' +
    `Kept, by design: ${Object.keys(USER_OWNED_TABLES).length} user-owned tables ` +
    '(preferences, plugin connections, agents, unsubscribes).\n'
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
