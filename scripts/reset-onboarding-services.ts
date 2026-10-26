/**
 * Put a test account's published services back to draft, to re-run the flow.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Onboarding creates services as drafts and the build screen asks the owner to
 * finish and publish them. Testing that path twice needs the rows back in the
 * state they started in, and nothing in the product moves a service backwards:
 * publishing is a one-way door on purpose, because a live service a client can
 * see is not something to flip casually.
 *
 * So this is a maintenance script, not a feature. It uses the service role,
 * which bypasses RLS, and therefore scopes every statement by `user_id` found
 * from the company name rather than trusting a caller-supplied id.
 *
 * DRY RUN BY DEFAULT. It prints what it would change and writes nothing until
 * `--apply` is passed, because "reset the test account" and "reset the account
 * I am sitting in front of" look identical from a terminal.
 *
 *   npx tsx scripts/reset-onboarding-services.ts --company="David KPMG"
 *   npx tsx scripts/reset-onboarding-services.ts --company="David KPMG" --apply
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from 'path';

import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const loadSupabase = async () =>
  (await import('../lib/supabaseServer')).supabaseServer;

const arg = (name: string) => {
  const hit = process.argv.find(value => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

async function main() {
  const supabase = await loadSupabase();
  const company = arg('company');
  const apply = process.argv.includes('--apply');

  if (!company) {
    console.error('Which account? Pass --company="Business Name".');
    process.exit(1);
  }

  /* The owner, by the name on their profile. One account, or we stop: two
     businesses sharing a name is exactly when a blind write goes wrong. */
  const { data: profiles, error: profileError } = await supabase
    .from('business_profiles')
    .select('user_id, company_name')
    .eq('company_name', company);

  if (profileError) throw profileError;

  if (!profiles || profiles.length === 0) {
    console.error(`No business called ${JSON.stringify(company)}.`);
    process.exit(1);
  }
  if (profiles.length > 1) {
    console.error(`${profiles.length} businesses share that name. Narrow it before writing anything.`);
    process.exit(1);
  }

  const userId = profiles[0].user_id;
  console.log(`\naccount: ${company}  (${userId})\n`);

  const { data: services, error } = await supabase
    .from('scheduling_services')
    .select('id, service_name, status, is_active, price, duration_minutes, is_scheduled')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  if (!services || services.length === 0) {
    console.log('This account has no services at all.');
    return;
  }

  console.log('--- services as they stand ---');
  for (const service of services) {
    console.log(
      `  ${service.status === 'active' ? '●' : '○'} ${service.service_name}` +
        `\n      status: ${service.status}  active: ${service.is_active}` +
        `  scheduled: ${service.is_scheduled}  price: ${service.price}  length: ${service.duration_minutes}`
    );
  }

  /*
   * THE ANSWER TO THE QUESTION THAT PROMPTED THIS.
   *
   * A service published with `is_scheduled` true and no working hours behind
   * it should have been refused by the publish gate. Printed here because the
   * row itself decides which of the two explanations is true: a row that says
   * `false` means the gate was right and the chip never persisted; a row that
   * says `true` means the gate was asked and did not stop it.
   */
  const { data: profile } = await supabase
    .from('business_profiles')
    .select('scheduling_availability')
    .eq('user_id', userId)
    .maybeSingle();

  const hours = profile?.scheduling_availability;
  const hasHours =
    !!hours &&
    Object.values(hours as Record<string, unknown>).some(day =>
      Array.isArray(day) ? day.length > 0 : !!(day as { enabled?: boolean })?.enabled
    );

  console.log(`\n--- working hours: ${hasHours ? 'SET' : 'NOT SET'} ---`);
  const publishedScheduled = services.filter(
    service => service.status === 'active' && service.is_scheduled !== false
  );
  if (!hasHours && publishedScheduled.length > 0) {
    console.log(
      `  ${publishedScheduled.length} published service(s) ask a client to pick a time while\n` +
        '  no hours exist. The publish gate should have refused these, so the\n' +
        '  rows above say which explanation is true: see the comment in this file.'
    );
  }

  const toReset = services.filter(service => service.status !== 'draft');

  console.log(`\n--- would reset ${toReset.length} service(s) to draft ---`);
  for (const service of toReset) console.log(`  ${service.service_name}`);

  if (toReset.length === 0) {
    console.log('  nothing to do.');
    return;
  }

  if (!apply) {
    console.log('\nDry run. Nothing was written. Add --apply to do it.\n');
    return;
  }

  /* `is_active` too: `publish()` sets both, so resetting one of them would
     leave a row the product reads as half live. */
  const { error: writeError } = await supabase
    .from('scheduling_services')
    .update({ status: 'draft', is_active: false })
    .eq('user_id', userId)
    .in('id', toReset.map(service => service.id));

  if (writeError) throw writeError;

  console.log(`\nReset ${toReset.length} service(s) to draft.\n`);
}

main().catch(error => {
  console.error('\nFAILED:', error?.message || error);
  process.exit(1);
});
