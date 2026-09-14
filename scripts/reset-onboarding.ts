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

config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * Everything the build writes, child-first.
 *
 * Order matters: a row with a NOT NULL foreign key has to go before the row it
 * points at, and `crm_contacts` is pointed at by six tables — which is the same
 * fact that makes CRM structural rather than optional.
 */
const TABLES_IN_DELETE_ORDER = [
  // Anything hanging off a booking or a contact.
  'scheduling_bookings',
  'payment_transactions',
  'payment_installments',
  'payment_invoices',
  'proposals',
  'crm_activities',
  'crm_tasks',
  'crm_contacts',
  // The catalogue and how it is sold.
  'payment_plans',
  'scheduling_services',
  // Intake.
  'intake_forms',
  'user_intake_settings',
  // Anything a client could reach.
  'website_pages',
  'smart_links',
  // The pipeline, and what onboarding decided.
  'crm_pipeline_stages',
  'user_capabilities',
  /*
   * The transcript, and the state machine's position in it.
   *
   * The chat page clears this on load by itself, so it is here for the case the
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

  let total = 0;

  for (const table of TABLES_IN_DELETE_ORDER) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (error) {
      // A table that does not exist in this environment is not a failure — say
      // so and carry on, rather than stopping halfway through a delete.
      console.log(`  ${table.padEnd(24)} skipped (${error.message})`);
      continue;
    }

    const rows = count || 0;
    total += rows;

    if (!rows) {
      console.log(`  ${table.padEnd(24)} —`);
      continue;
    }

    if (!confirmed) {
      console.log(`  ${table.padEnd(24)} ${rows} row${rows === 1 ? '' : 's'}`);
      continue;
    }

    const { error: deleteError } = await supabaseAdmin.from(table).delete().eq('user_id', user.id);
    console.log(
      `  ${table.padEnd(24)} ${deleteError ? `FAILED — ${deleteError.message}` : `deleted ${rows}`}`
    );
  }

  /*
   * The profile is EMPTIED, not deleted.
   *
   * `user_code` lives on it and is what every smart link and public page is
   * addressed by. Dropping the row mints a new code on the next build, which
   * quietly invalidates every link you had open in a tab — so the row stays and
   * the answers on it are cleared.
   */
  const profileReset = {
    onboarding_completed: false,
    vertical: null,
    sub_vertical: null,
    description: null,
    clients_per_week: null,
    pain_points: null,
    goals: null,
    tools: null,
    online_presence_mode: null,
    payment_mode: null,
    collection_method: null,
  };

  if (confirmed) {
    const { error } = await supabaseAdmin
      .from('business_profiles')
      .update(profileReset)
      .eq('user_id', user.id);

    console.log(`\n  business_profiles         ${error ? `FAILED — ${error.message}` : 'cleared (user_code kept)'}`);
  } else {
    console.log(`\n  business_profiles         would clear ${Object.keys(profileReset).length} answers (user_code kept)`);
  }

  console.log(
    confirmed
      ? `\nDone. Sign in as ${email} and the onboarding chat will start from nothing.\n`
      : `\n${total} rows would go. Re-run with --confirm.\n`
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
