// scripts/test-account-deletion.ts
//
// Testing account deletion without hand-building a business every time.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE PROBLEM
//
// Deleting an account is a one-shot, irreversible operation whose interesting
// cases all need a populated business behind them: future bookings to cancel,
// live pages to close, an unpaid invoice to refuse on. Setting that up by hand
// takes half an hour, and you get to use it exactly once.
//
// THREE COMMANDS, CHEAPEST FIRST
//
//   plan <email>       Read-only. Reports exactly what deletion WOULD do to
//                      this account — what blocks it, who would be emailed,
//                      what would be closed, detached and deleted. Nothing is
//                      written, so it is safe to run against your own live
//                      account, as often as you like. Most questions about
//                      whether the policy is right are answered here without
//                      deleting anything.
//
//   seed [--blocked]   Creates a THROWAWAY account with a full business behind
//                      it and prints its login. Delete it from the UI like a
//                      real user. `--blocked` adds an unpaid invoice so the
//                      refusal path is what you are testing instead.
//
//   verify <user-id>   Run after a real deletion. Sweeps every business and
//                      account table for rows still keyed to that user, and
//                      checks the auth user is gone. This is the claim the
//                      route makes; this is what proves it.
//
// A full end-to-end is three commands and about a minute:
//
//   npx tsx scripts/test-account-deletion.ts seed
//   # log in as the printed address, Settings → delete the account
//   npx tsx scripts/test-account-deletion.ts verify <printed user id>
//
// SAFETY
//
// `plan` and `verify` never write. `seed` only ever writes to an account it
// created itself, whose address is always under the throwaway domain below, so
// it cannot touch a real one. Nothing here deletes anything — deleting is what
// you are testing, and it happens through the product.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

import { BUSINESS_OWNED_TABLES } from '../lib/business-os/businessOwnedTables';
import {
  CASCADE_ROOT_TABLE,
  accountTablesToProcess,
  keyColumnFor,
  policyFor,
} from '../lib/business-os/account/accountDeletionPolicy';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * Every seeded account lives here.
 *
 * `seed` refuses to write anywhere else, which is what stops a mistyped
 * argument turning a fixture run into damage to a real account.
 */
const THROWAWAY_DOMAIN = 'deletion-test.invalid';
const THROWAWAY_PASSWORD = 'deletion-test-password-1234';

// ── helpers ─────────────────────────────────────────────────────────────────

async function findUserByEmail(email: string) {
  // listUsers pages at 50 by default and these projects have more than that.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

/** Row count for a table scoped to one user, or null if the table cannot be read. */
async function countFor(table: string, userId: string, keyColumn = 'user_id') {
  const { count, error } = await db
    .from(table)
    .select(keyColumn, { count: 'exact', head: true })
    .eq(keyColumn, userId);

  if (error) return null;
  return count ?? 0;
}

function heading(text: string) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

// ── plan ────────────────────────────────────────────────────────────────────

async function plan(email: string) {
  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`No account for ${email}`);
    process.exit(1);
  }

  console.log(`\nDRY RUN — ${email}  (${user.id})`);
  console.log('Nothing below is written. This is what deleting would do.');

  /*
   * Imported lazily so a missing env var or a schema problem inside the
   * blocker check reports as a readable message here, rather than as a module
   * that failed to load before main() ever ran.
   */
  const { findDeletionBlockers, blocksDeletion } = await import(
    '../lib/business-os/account/deletionBlockers'
  );

  // ── Would it be refused? ──────────────────────────────────────────────────
  heading('1. Money check');
  try {
    const blockers = await findDeletionBlockers(user.id);
    if (blocksDeletion(blockers)) {
      console.log('  \x1b[31mREFUSED\x1b[0m — deletion would stop here with a 409.');
      for (const blocker of blockers) {
        // Per-currency and never summed — two currencies are two totals.
        const totals = blocker.totals.map(t => `${t.amount} ${t.currency}`).join(', ');
        console.log(
          `    ${blocker.kind.padEnd(22)} ${blocker.count}${totals ? `  ${totals}` : ''}`
        );
      }
      console.log('\n  Nothing below would run. Settle these first.');
      return;
    }
    console.log('  \x1b[32mclear\x1b[0m — nothing outstanding, deletion would proceed.');
  } catch (err) {
    console.log(`  \x1b[31mCHECK FAILED\x1b[0m — deletion would refuse with a 503.`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  /*
   * ── Step 1: what would close ──────────────────────────────────────────────
   *
   * Errors are printed, never swallowed. Postgres rejects an ENTIRE select for
   * one unknown column, so a single stale name here returns null and the report
   * cheerfully says "0 active links" about a business with live ones — which is
   * how this very section shipped wrong the first time (`short_code` for a
   * column actually called `code`). A dry run that under-reports is worse than
   * no dry run: it is reassurance that happens to be false.
   */
  heading('2. Doors that would be shut');
  const { data: pages, error: pagesError } = await db
    .from('website_pages')
    .select('slug, page_type')
    .eq('user_id', user.id)
    .eq('status', 'live');
  const { data: links, error: linksError } = await db
    .from('smart_links')
    .select('code, destination_type')
    .eq('user_id', user.id)
    .eq('is_active', true);

  if (pagesError) {
    console.log(`  \x1b[31mcould not read pages: ${pagesError.message}\x1b[0m`);
  } else {
    console.log(`  ${pages?.length ?? 0} live page(s) would go back to draft`);
    (pages ?? []).forEach(p => console.log(`    /${p.slug}  (${p.page_type})`));
  }

  if (linksError) {
    console.log(`  \x1b[31mcould not read links: ${linksError.message}\x1b[0m`);
  } else {
    console.log(`  ${links?.length ?? 0} active link(s) would be switched off`);
    (links ?? []).forEach(l => console.log(`    ${l.code}  → ${l.destination_type}`));
  }

  // ── Step 2: who would be emailed ──────────────────────────────────────────
  heading('3. Clients who would be told');
  const { data: bookings, error: bookingsError } = await db
    .from('scheduling_bookings')
    .select('id, start_time, contact_id, crm_contacts(first_name, last_name, email)')
    .eq('user_id', user.id)
    .eq('status', 'confirmed')
    .gte('start_time', new Date().toISOString())
    .order('start_time');

  if (bookingsError) {
    console.log(`  \x1b[31mcould not read bookings: ${bookingsError.message}\x1b[0m`);
  } else if (!bookings?.length) {
    console.log('  No upcoming bookings — nobody would be emailed.');
  } else {
    console.log(`  ${bookings.length} upcoming booking(s) would be cancelled:`);
    for (const booking of bookings as any[]) {
      const contact = booking.crm_contacts;
      const who = contact?.email || '\x1b[31mNO EMAIL — this client would NOT be told\x1b[0m';
      const when = new Date(booking.start_time).toISOString().replace('T', ' ').slice(0, 16);
      console.log(`    ${when}  ${who}`);
    }
  }

  // ── Steps 3 & 4: the sweep ────────────────────────────────────────────────
  heading('4. Account tables');
  let detached = 0;
  let removed = 0;

  for (const table of accountTablesToProcess()) {
    const policy = policyFor(table);
    if (policy.verdict === 'keep') continue;

    const rows = await countFor(table, user.id, keyColumnFor(table));
    if (rows === null) {
      console.log(`  \x1b[31munreadable\x1b[0m ${table}`);
      continue;
    }
    if (rows === 0) continue;

    if (policy.verdict === 'minimise') {
      detached += rows;
      console.log(`  detach   ${table.padEnd(30)} ${rows}`);
    } else {
      removed += rows;
      console.log(`  delete   ${table.padEnd(30)} ${rows}`);
    }
  }
  console.log(`  — ${detached} row(s) kept but detached, ${removed} deleted`);

  // ── Step 5: the cascade ───────────────────────────────────────────────────
  heading('5. Business data (one delete, cascaded)');
  let cascaded = 0;
  const populated: Array<[string, number]> = [];

  for (const table of BUSINESS_OWNED_TABLES) {
    const rows = await countFor(table, user.id);
    if (!rows) continue;
    cascaded += rows;
    populated.push([table, rows]);
  }

  populated.forEach(([table, rows]) => console.log(`  ${table.padEnd(34)} ${rows}`));
  console.log(
    `  — ${cascaded} row(s) across ${populated.length} table(s), removed by deleting one ${CASCADE_ROOT_TABLE} row`
  );

  console.log('\nNothing was written.\n');
}

// ── seed ────────────────────────────────────────────────────────────────────

/**
 * @param into  Layer the fixture onto an EXISTING throwaway account instead of
 *              creating one. `business-fixture.ts` restores a real business
 *              faithfully, but a business with no clients cannot exercise the
 *              cancel-and-notify path — so the two compose: restore the real
 *              shape, then seed the transactional rows it happens to lack.
 */
async function seed(blocked: boolean, into?: string) {
  const stamp = Date.now();
  let email = `deletion-test-${stamp}@${THROWAWAY_DOMAIN}`;
  let userId: string;

  if (into) {
    const { data: existing, error } = await db.auth.admin.getUserById(into);
    if (error || !existing?.user) {
      console.error(`No account ${into}: ${error?.message ?? 'not found'}`);
      process.exit(1);
    }

    // Refuse anything that is not a throwaway. Seeding bookings into a real
    // business would put fake clients in somebody's actual pipeline.
    if (!existing.user.email?.endsWith(`@${THROWAWAY_DOMAIN}`)) {
      console.error(
        `\n${existing.user.email} is not a throwaway account ` +
          `(must end in @${THROWAWAY_DOMAIN}). Refusing to seed into it.\n`
      );
      process.exit(1);
    }

    userId = existing.user.id;
    email = existing.user.email;
    console.log(`\nLayering the fixture onto ${email}`);
  } else {
    console.log(`\nSeeding a throwaway account: ${email}`);

    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      password: THROWAWAY_PASSWORD,
      email_confirm: true,
    });
    if (createError || !created.user) {
      console.error(`Could not create the auth user: ${createError?.message}`);
      process.exit(1);
    }
    userId = created.user.id;
  }

  // Repositories rather than raw inserts: they carry the column defaults and
  // the required-field knowledge, so a fixture cannot drift from the real
  // shape the way a hand-written insert list does.
  const { businessProfileRepository } = await import('../lib/repositories/BusinessProfileRepository');
  const { schedulingServiceRepository, schedulingBookingRepository } = await import(
    '../lib/repositories/SchedulingRepository'
  );
  const { crmContactRepository } = await import('../lib/repositories/CRMContactRepository');
  const { paymentInvoiceRepository } = await import('../lib/repositories/PaymentRepository');
  const { getWebsitePageRepository } = await import('../lib/repositories/WebsitePageRepository');
  const { smartLinkRepository } = await import('../lib/repositories/SmartLinkRepository');

  // When layering, the restored business profile is the one to keep — it is the
  // real shape being tested. Only create one if there is none.
  const existingProfile = into ? await businessProfileRepository.findByUserId(userId) : null;
  const profile = existingProfile?.data
    ? existingProfile
    : await businessProfileRepository.create({
        user_id: userId,
        vertical: 'coaching',
        company_name: `Deletion Test ${stamp}`,
        language: 'en',
        onboarding_completed: true,
      });

  if (profile.error || !profile.data) {
    console.error(`Could not resolve the business profile: ${profile.error?.message}`);
    process.exit(1);
  }

  // A free scheduled service and a priced one, so both branches of the
  // invoicing rules have something to act on.
  const free = await schedulingServiceRepository.create({
    user_id: userId,
    service_name: 'Intro call',
    duration_minutes: 15,
    price: 0,
    is_scheduled: true,
  });
  const paid = await schedulingServiceRepository.create({
    user_id: userId,
    service_name: 'Full session',
    duration_minutes: 60,
    price: 300,
    currency: 'ILS',
    is_scheduled: true,
    collection: 'invoice',
  });

  // Two clients with real-looking addresses, so the cancellation emails have
  // somewhere to go. Nothing is actually sent until you press delete.
  const alice = await crmContactRepository.create({
    user_id: userId,
    first_name: 'Alice',
    last_name: 'Future',
    email: `alice-${stamp}@${THROWAWAY_DOMAIN}`,
    stage: 'client',
  });
  const bob = await crmContactRepository.create({
    user_id: userId,
    first_name: 'Bob',
    last_name: 'Past',
    email: `bob-${stamp}@${THROWAWAY_DOMAIN}`,
    stage: 'client',
  });

  const hour = 60 * 60 * 1000;
  const inDays = (days: number) => new Date(Date.now() + days * 24 * hour);

  const bookings: Array<{ label: string; ok: boolean }> = [];

  // Two ahead — these are what deletion must cancel and email about.
  for (const [days, service] of [
    [3, free.data?.id],
    [10, paid.data?.id],
  ] as Array<[number, string | undefined]>) {
    if (!service || !alice.data) continue;
    const start = inDays(days);
    const result = await schedulingBookingRepository.create({
      user_id: userId,
      service_id: service,
      contact_id: alice.data.id,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + hour).toISOString(),
      timezone: 'Asia/Jerusalem',
      status: 'confirmed',
    });
    bookings.push({ label: `future +${days}d`, ok: !result.error });
  }

  // One behind, already completed. Deletion must NOT email this client: their
  // appointment happened, and telling them it was cancelled would be false.
  if (paid.data && bob.data) {
    const start = new Date(Date.now() - 7 * 24 * hour);
    const result = await schedulingBookingRepository.create({
      user_id: userId,
      service_id: paid.data.id,
      contact_id: bob.data.id,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + hour).toISOString(),
      timezone: 'Asia/Jerusalem',
      status: 'completed',
    });
    bookings.push({ label: 'past, completed', ok: !result.error });
  }

  /*
   * The invoice decides which path you are testing.
   *
   * Paid: deletion proceeds. Unpaid (`--blocked`): the money check refuses
   * with a 409 and nothing else runs — which is the behaviour most worth
   * testing, because it is the one protecting a client mid-payment.
   */
  const invoice = await paymentInvoiceRepository.create({
    user_id: userId,
    contact_id: bob.data?.id ?? null,
    invoice_number: `TEST-${stamp}`,
    amount: 300,
    currency: 'ILS',
    status: blocked ? 'sent' : 'paid',
    line_items: [{ description: 'Full session', quantity: 1, unit_price: 300, total: 300 }],
    due_date: inDays(blocked ? 14 : -14).toISOString(),
    payment_terms: 'due_on_receipt',
    notes: null,
    internal_notes: null,
    sent_at: new Date().toISOString(),
    paid_at: blocked ? null : new Date().toISOString(),
  } as any);

  // A live page and an active link: the doors step 1 has to shut.
  const pages = getWebsitePageRepository(db as unknown as SupabaseClient);
  const page = await pages.create({
    user_id: userId,
    page_type: 'landing',
    slug: `deletion-test-${stamp}`,
    title: 'Deletion test landing page',
    status: 'live',
  });

  const link = await smartLinkRepository.create(userId, {
    name: 'Deletion test booking link',
    destination_url: `https://example.invalid/book/${stamp}`,
    destination_type: 'booking',
    is_active: true,
  });

  // ── report ────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1mSeeded\x1b[0m');
  console.log(`  user id     ${userId}`);
  console.log(`  email       ${email}`);
  console.log(`  password    ${THROWAWAY_PASSWORD}`);
  console.log('');
  console.log(`  business    ${profile.error ? 'FAILED' : 'ok'}`);
  console.log(`  services    ${[free, paid].filter(r => !r.error).length}/2`);
  console.log(`  contacts    ${[alice, bob].filter(r => !r.error).length}/2`);
  console.log(`  bookings    ${bookings.filter(b => b.ok).length}/${bookings.length}  (${bookings.map(b => b.label).join(', ')})`);
  console.log(`  invoice     ${invoice.error ? `FAILED: ${invoice.error.message}` : blocked ? 'UNPAID — deletion should REFUSE' : 'paid'}`);
  console.log(`  page        ${page.error ? `FAILED: ${page.error.message}` : 'live'}`);
  console.log(`  smart link  ${link.error ? `FAILED: ${link.error.message}` : 'active'}`);

  console.log('\n\x1b[1mNext\x1b[0m');
  console.log(`  npx tsx scripts/test-account-deletion.ts plan ${email}`);
  console.log('  then log in as that address and delete the account from Settings');
  console.log(`  npx tsx scripts/test-account-deletion.ts verify ${userId}\n`);
}

// ── verify ──────────────────────────────────────────────────────────────────

async function verify(userId: string) {
  console.log(`\nVerifying deletion of ${userId}\n`);

  let survivors = 0;

  // ── The auth user ─────────────────────────────────────────────────────────
  const { data: stillThere } = await db.auth.admin.getUserById(userId);
  if (stillThere?.user) {
    console.log('  \x1b[31mauth user still exists\x1b[0m');
    survivors += 1;
  } else {
    console.log('  \x1b[32mauth user gone\x1b[0m');
  }

  // ── Business data ─────────────────────────────────────────────────────────
  // All 55 of these carry user_id and hang off business_profiles by cascade.
  const businessLeft: Array<[string, number]> = [];
  for (const table of BUSINESS_OWNED_TABLES) {
    const rows = await countFor(table, userId);
    if (rows) businessLeft.push([table, rows]);
  }

  if (businessLeft.length === 0) {
    console.log('  \x1b[32mno business data left\x1b[0m');
  } else {
    console.log(`  \x1b[31m${businessLeft.length} business table(s) still hold rows\x1b[0m`);
    businessLeft.forEach(([table, rows]) => console.log(`    ${table.padEnd(34)} ${rows}`));
    survivors += businessLeft.length;
  }

  /*
   * ── Account data ──────────────────────────────────────────────────────────
   *
   * One rule covers both verdicts: NOTHING may still be keyed to this user.
   *
   * Deleted rows are gone, and minimised rows had `user_id` nulled, so a row
   * that still answers to this id means the sweep skipped it — which is
   * exactly the silent failure the route's log-and-continue design permits.
   * `keep` tables are excluded because keeping the identity is their whole job.
   */
  const accountLeft: Array<[string, number, string]> = [];
  for (const table of accountTablesToProcess()) {
    const policy = policyFor(table);
    if (policy.verdict === 'keep') continue;

    const rows = await countFor(table, userId, keyColumnFor(table));
    if (rows) accountLeft.push([table, rows, policy.verdict]);
  }

  if (accountLeft.length === 0) {
    console.log('  \x1b[32mno account row is still keyed to this user\x1b[0m');
  } else {
    console.log(`  \x1b[31m${accountLeft.length} account table(s) still keyed to this user\x1b[0m`);
    accountLeft.forEach(([table, rows, verdict]) =>
      console.log(`    ${table.padEnd(30)} ${rows}  (should have been ${verdict}d)`)
    );
    survivors += accountLeft.length;
  }

  console.log(
    survivors === 0
      ? '\n\x1b[32mClean. Nothing survived that should not have.\x1b[0m\n'
      : `\n\x1b[31m${survivors} problem(s) above.\x1b[0m\n`
  );

  process.exit(survivors === 0 ? 0 : 1);
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main() {
  const [command, argument] = process.argv.slice(2);

  switch (command) {
    case 'plan':
      if (!argument) return usage('plan needs an email address');
      return plan(argument);

    case 'seed': {
      const intoFlag = process.argv.indexOf('--into');
      return seed(
        process.argv.includes('--blocked'),
        intoFlag > -1 ? process.argv[intoFlag + 1] : undefined
      );
    }

    case 'verify':
      if (!argument) return usage('verify needs a user id');
      return verify(argument);

    default:
      return usage(command ? `unknown command: ${command}` : '');
  }

  function usage(problem: string) {
    if (problem) console.error(`\n${problem}`);
    console.error(`
Usage:
  npx tsx scripts/test-account-deletion.ts plan <email>      read-only: what deletion would do
  npx tsx scripts/test-account-deletion.ts seed [--blocked] [--into <user-id>]
                                                             create a throwaway account to delete,
                                                             or layer clients+bookings onto one
  npx tsx scripts/test-account-deletion.ts verify <user-id>  after deleting: prove nothing survived
`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
