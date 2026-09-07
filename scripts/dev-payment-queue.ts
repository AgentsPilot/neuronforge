/**
 * Dev harness for the payment queue-drain flows (Business OS Payments).
 *
 * Vercel cron does NOT run locally, so this script plays the scheduler's role: it
 * seeds work into the queue, fires the drain endpoints over HTTP (twice, concurrently,
 * to prove the claim prevents double-processing), and prints the resulting row states.
 *
 * DEV ONLY — it writes real rows into whatever Supabase your .env.local points at.
 * It refuses to run when NODE_ENV=production.
 *
 * Prereqs:
 *   1. A dev DB with the 3 queue-drain migrations applied (the claim_due_* / reap_stale_*
 *      RPCs must exist). Local:  supabase start  &&  supabase db push
 *   2. .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY pointing at it.
 *   3. The dev server running (npm run dev) — dev bypass means no CRON_SECRET is needed.
 *
 * Usage:
 *   npx tsx scripts/dev-payment-queue.ts --reminders
 *   npx tsx scripts/dev-payment-queue.ts --automation
 *   npx tsx scripts/dev-payment-queue.ts --all
 *   npx tsx scripts/dev-payment-queue.ts --cleanup      # delete rows this harness created
 *
 * Required env:
 *   HARNESS_USER_ID       a real auth user id in the dev DB.
 * Optional env:
 *   HARNESS_CONTACT_ID    a real crm_contacts id owned by HARNESS_USER_ID. If set, the
 *                         reminder dispatches as 'sent'; if omitted, contact_id is null and
 *                         the reminder resolves to 'failed' (Contact not found) — either way
 *                         the claim/exactly-once behaviour is identical (attempts=1, one run).
 *   DEV_BASE_URL          default http://localhost:3000
 */

import { config } from 'dotenv';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

config({ path: path.resolve(process.cwd(), '.env.local') });

const BASE_URL = process.env.DEV_BASE_URL || 'http://localhost:3000';
const USER_ID = process.env.HARNESS_USER_ID || '';
const CONTACT_ID = process.env.HARNESS_CONTACT_ID || null;
const HARNESS_TAG = { __harness: 'dev-payment-queue' };

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') die('Refusing to run with NODE_ENV=production.');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  die('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.');
}

const db: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** Fire a GET cron endpoint twice, concurrently — the double-processing stress test. */
async function fireConcurrently(pathname: string): Promise<void> {
  const url = `${BASE_URL}${pathname}`;
  console.log(`  ↯ firing ${url} ×2 concurrently…`);
  const results = await Promise.allSettled([fetch(url), fetch(url)]);
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') console.log(`    run ${i + 1}: HTTP ${r.value.status}`);
    else console.log(`    run ${i + 1}: ERROR ${String(r.reason)}`);
  });
}

async function runReminders(): Promise<void> {
  console.log('\n=== Task A — reminders drain ===');
  const dueAt = new Date(Date.now() - 60_000).toISOString(); // 1 min ago → due now

  const { data: rem, error } = await db
    .from('payment_reminders')
    .insert({
      user_id: USER_ID,
      contact_id: CONTACT_ID, // null → dispatch resolves to 'failed' (Contact not found)
      reminder_type: 'upcoming_due',
      channel: 'email',
      scheduled_at: dueAt,
      status: 'pending',
      metadata: HARNESS_TAG,
    })
    .select()
    .single();
  if (error) die(`seed reminder failed: ${error.message}`);
  console.log(`  seeded reminder ${rem.id} (status=pending, due 60s ago)`);

  await fireConcurrently('/api/cron/payment-reminders');

  const { data: after } = await db
    .from('payment_reminders')
    .select('id, status, attempts, claimed_by, sent_at, error_message')
    .eq('id', rem.id)
    .single();
  console.log('  result:', after);
  console.log(
    after?.attempts === 1
      ? `  ✅ dispatched exactly once (attempts=1, status=${after.status})`
      : `  ⚠️ unexpected attempts=${after?.attempts} — inspect above`
  );
}

async function runAutomation(): Promise<void> {
  console.log('\n=== Task B — automation drain (emit → enqueue → drain) ===');

  // 1. Persist a payment.failed event (direct insert = deterministic; prod persists via emit()).
  const { data: evt, error: evtErr } = await db
    .from('payment_events')
    .insert({
      user_id: USER_ID,
      event_type: 'payment.failed',
      entity_type: 'invoice',
      entity_id: randomUUID(), // callBlockExecutor is a placeholder, so no real invoice needed
      contact_id: CONTACT_ID,
      metadata: HARNESS_TAG,
    })
    .select()
    .single();
  if (evtErr) die(`seed event failed: ${evtErr.message}`);
  console.log(`  emitted event ${evt.id} (payment.failed)`);

  // 2. Run the REAL enqueuer in-process (seeds default rules, matches the retry rule,
  //    enqueues a 'pending' execution). Awaited here — prod fires it non-blocking from emit().
  const { enqueuePaymentReactions } = await import('@/lib/payments/paymentReactionEnqueuer');
  await enqueuePaymentReactions(evt as never);

  const { data: enq } = await db
    .from('payment_automation_executions')
    .select('id, status, attempts, trigger_event_id')
    .eq('trigger_event_id', evt.id);
  console.log(`  enqueued ${enq?.length ?? 0} execution(s):`, enq);
  if (!enq || enq.length === 0) {
    console.log('  (no rule matched — is the "Auto-retry failed payment" default rule active?)');
  }

  // 3. Drain via HTTP, twice, concurrently.
  await fireConcurrently('/api/cron/payment-retry');

  const { data: after } = await db
    .from('payment_automation_executions')
    .select('id, status, attempts, executed_at, error_message')
    .eq('trigger_event_id', evt.id);
  console.log('  result:', after);
  const done = (after || []).filter((r) => r.status === 'completed');
  console.log(
    (after || []).every((r) => r.attempts === 1)
      ? `  ✅ each execution ran exactly once (${done.length} completed)`
      : '  ⚠️ unexpected attempts — inspect above'
  );
}

async function cleanup(): Promise<void> {
  console.log('\n=== cleanup (harness-created rows) ===');
  const tag = HARNESS_TAG.__harness;

  const { data: evts } = await db
    .from('payment_events')
    .select('id')
    .eq('user_id', USER_ID)
    .contains('metadata', { __harness: tag });
  const evtIds = (evts || []).map((e) => e.id);
  if (evtIds.length) {
    await db.from('payment_automation_executions').delete().in('trigger_event_id', evtIds);
    await db.from('payment_events').delete().in('id', evtIds);
  }
  await db
    .from('payment_reminders')
    .delete()
    .eq('user_id', USER_ID)
    .contains('metadata', { __harness: tag });
  console.log(`  removed ${evtIds.length} event(s) + their executions + harness reminders.`);
  console.log('  (default automation rules left in place — the idempotent seed handles re-runs.)');
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const wantReminders = args.has('--reminders') || args.has('--all');
  const wantAutomation = args.has('--automation') || args.has('--all');
  const wantCleanup = args.has('--cleanup');

  if (!wantReminders && !wantAutomation && !wantCleanup) {
    die('Pass one of: --reminders | --automation | --all | --cleanup');
  }
  if (!USER_ID) die('Set HARNESS_USER_ID to a real auth user id in the dev DB.');

  console.log(`Target DB : ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`Dev server: ${BASE_URL}`);
  console.log(`User      : ${USER_ID}  Contact: ${CONTACT_ID ?? '(none → reminder will "fail")'}`);

  if (wantCleanup) return cleanup();
  if (wantReminders) await runReminders();
  if (wantAutomation) await runAutomation();
  console.log('\nDone. Re-run with --cleanup to remove the seeded rows.\n');
}

main().catch((err) => die(err instanceof Error ? err.stack || err.message : String(err)));
