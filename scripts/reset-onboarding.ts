/**
 * Onboarding reset for ONE account, so a fresh chat can be tested.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *   npm run onboarding:reset -- --user=<uuid>              # dry run
 *   npm run onboarding:reset -- --user=<uuid> --delete      # apply
 *
 * DRY RUN UNLESS `--delete` IS PASSED, and that default is the point: it
 * prints the row count per table and changes nothing, so the blast radius is
 * read before it is taken.
 *
 * It also refuses to touch anything when the id is not a real auth user, which
 * is the one mistake worth guarding here: a mistyped uuid would otherwise
 * delete nothing and report success, or delete somebody else's account.
 *
 * Service role deliberately: this spans tables no per-user repository owns, and
 * a reset has to be exact about what it removes. It is a developer tool and is
 * never imported by the app.
 *
 * WHY IT EXISTS: a stalled onboarding leaves an account that cannot be retested
 * and does not look broken. `business_profiles` holds an all-null row created
 * lazily by some other endpoint, `onboarding_conversations` holds the transcript
 * that makes the chat resume mid-interview, and nothing in the UI removes
 * either.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { supabaseServer } from '@/lib/supabaseServer';

const USER = process.argv.find(a => a.startsWith('--user='))?.split('=')[1];
const DELETE = process.argv.includes('--delete');

/**
 * Everything onboarding creates or touches, in child-before-parent order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `website_pages`, NOT `website_landing_pages`.
 *
 * The first version of this list named `website_landing_pages`, which exists
 * and is not the table the website uses. So the dry run printed
 * "website_landing_pages 0" for an account that had a generated homepage, and
 * read as "no website to remove" when there was one.
 *
 * It then vanished anyway, because `website_pages.user_id` carries
 * `website_pages_business_fk` into `business_profiles` — so deleting the
 * profile took the site with it. The script got the right outcome for the
 * wrong reason and reported the wrong thing, which is the worst combination
 * available in a tool somebody uses to decide whether a reset worked.
 *
 * `business_profiles` stays LAST for that same reason: every child here
 * references it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TABLES = [
  'onboarding_conversations',
  'scheduling_services',
  'crm_pipeline_stages',
  'crm_contacts',
  'user_intake_settings',
  /* `website_blocks` is NOT listed: it has no `user_id` at all, only
     `page_id ... ON DELETE CASCADE`, so it goes with the page. A line for it
     here would be filtered on a column that does not exist and reported as a
     silent "skip", which reads like a table that was checked. */
  'website_pages',
  'business_profiles',
];

async function main() {
  if (!USER) {
    console.error('Pass --user=<uuid>. There is deliberately no default: a reset\n'
      + 'tool that defaults to an account is a tool that resets the wrong one.');
    process.exit(1);
  }

  const { data: auth } = await supabaseServer.auth.admin.getUserById(USER);
  console.log(`account: ${USER}`);
  console.log(`email  : ${auth?.user?.email ?? '(not found in auth)'}`);
  console.log(`created: ${auth?.user?.created_at ?? '?'}\n`);

  if (!auth?.user) {
    console.log('No such auth user. Refusing to touch anything.');
    return;
  }

  console.log(DELETE ? 'DELETING:' : 'would delete (dry run):');
  for (const table of TABLES) {
    const { count, error } = await supabaseServer
      .from(table).select('*', { count: 'exact', head: true }).eq('user_id', USER);

    if (error) { console.log(`  ${table.padEnd(26)} skip (${error.code})`); continue; }
    if (!count) { console.log(`  ${table.padEnd(26)} 0`); continue; }

    if (!DELETE) { console.log(`  ${table.padEnd(26)} ${count}`); continue; }

    const { error: delError } = await supabaseServer.from(table).delete().eq('user_id', USER);
    console.log(`  ${table.padEnd(26)} ${count} -> ${delError ? 'FAILED ' + delError.message : 'deleted'}`);
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE ORGANIZATION'S SETTINGS, which a reset used to leave behind.
   *
   * `organizations` is NOT in the table list above, and must not be: the row is
   * created once for the account and other things hang off it. But its
   * `settings` blob holds `industry`, `company_size`, `primary_goal` and
   * `technical_level` — four of the six fields the readiness card calls
   * "Business details".
   *
   * So a reset wiped the business and left those four answered. The owner
   * started a brand new business and its setup card said the details were
   * complete, from values typed weeks earlier against a business that no longer
   * existed. That is exactly the confusion this script is meant to prevent.
   *
   * CLEARED, not deleted. Two accounts in this database legitimately carry
   * `settings = {}`, so an empty blob is a state the app already handles;
   * removing the row is not.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { data: org } = await supabaseServer
    .from('organizations')
    .select('id, settings')
    .eq('owner_user_id', USER)
    .maybeSingle();

  const orgKeys = Object.keys((org?.settings ?? {}) as Record<string, unknown>).length;

  if (!org) {
    console.log(`  ${'organizations.settings'.padEnd(26)} no row`);
  } else if (!orgKeys) {
    console.log(`  ${'organizations.settings'.padEnd(26)} already empty`);
  } else if (!DELETE) {
    console.log(`  ${'organizations.settings'.padEnd(26)} ${orgKeys} keys -> would clear`);
  } else {
    const { error } = await supabaseServer
      .from('organizations')
      .update({ settings: {} })
      .eq('id', org.id);
    console.log(`  ${'organizations.settings'.padEnd(26)} ${orgKeys} keys -> ${error ? 'FAILED ' + error.message : 'cleared'}`);
  }

  console.log(DELETE
    ? '\nDone. The next visit to /onboarding-chat starts a new interview.'
    : '\nNothing changed. Re-run with --delete to apply.');
}
main().catch(e => { console.error(e); process.exit(1); });
