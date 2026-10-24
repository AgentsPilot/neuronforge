/**
 * Close a package that its quote's cancellation left running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * An accepted package quote leaves two booking rows: the job it was written for
 * (`proposals.booking_id`) and the package its acceptance created
 * (`proposals.package_booking_id`). Cancelling the first stopped the quote and
 * left the second running, because every step of the cancellation was scoped to
 * the booking the owner pressed cancel on.
 *
 * The code now cascades. This script is for the row that was already stranded
 * before it did.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DRY RUN BY DEFAULT. Prints exactly what it would change and writes nothing.
 * Add --apply to perform it.
 *
 *   node scripts/close-orphaned-package.mjs                 # show me
 *   node scripts/close-orphaned-package.mjs --apply         # do it
 *
 * It does NOT touch the calendar and does NOT email anyone. The client has
 * already been told the quote is off, and a second message weeks later about a
 * booking they never saw as separate would be worse than silence.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';

const APPLY = process.argv.includes('--apply');

const env = fs.readFileSync('.env.local', 'utf8');
const envVar = key => (env.match(new RegExp('^' + key + '=(.*)$', 'm')) || [])[1]?.trim();
const URL = envVar('NEXT_PUBLIC_SUPABASE_URL');
const KEY = envVar('SUPABASE_SERVICE_ROLE_KEY');

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const get = async path => {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(JSON.stringify(body));
  return body;
};

const patch = async (path, values) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(values),
  });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(JSON.stringify(body));
  return body;
};

/** The stranded package, found the same way the fix now finds it. */
const PACKAGE_ID = 'f00da6a7-37fc-4fc1-89bb-8c59c46d5411';

const money = n => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(n);

async function main() {
  console.log(APPLY ? '*** APPLYING ***\n' : '--- DRY RUN, nothing will be written ---\n');

  const [booking] = await get(
    `scheduling_bookings?select=id,user_id,status,meeting_status,service_id&id=eq.${PACKAGE_ID}`
  );
  if (!booking) throw new Error('package booking not found');

  const userId = booking.user_id;

  const [proposal] = await get(
    `proposals?select=id,title,status,booking_id,package_booking_id,created_plan_id&package_booking_id=eq.${PACKAGE_ID}`
  );

  console.log('PACKAGE   ', PACKAGE_ID);
  console.log('  status  ', booking.status, '| meeting_status', booking.meeting_status);
  console.log('QUOTE     ', proposal?.title?.trim());
  console.log('  status  ', proposal?.status, '(already stopped when its other booking was cancelled)');
  console.log('  written for booking', proposal?.booking_id, '<- the one that WAS cancelled\n');

  /* ── 1. the sessions still holding their hours ───────────────────────────── */
  const sessions = await get(
    `scheduling_meetings?select=id,session_number,occurrence_number,meeting_status,start_time,external_calendar_event_id&booking_id=eq.${PACKAGE_ID}&order=session_number,occurrence_number`
  );
  const holding = sessions.filter(s => s.meeting_status === null);

  console.log(`1. SESSIONS: ${sessions.length} rows, ${holding.length} still holding an hour`);
  for (const s of holding) {
    console.log(`     s${String(s.session_number).padStart(2)}  ${s.start_time}  -> cancelled`);
  }
  for (const s of sessions.filter(s => s.meeting_status !== null)) {
    console.log(
      `     s${String(s.session_number).padStart(2)}  ${String(s.meeting_status).padEnd(10)} left alone (already answered)`
    );
  }

  /* ── 2. the stages nobody will collect ───────────────────────────────────── */
  const stages = await get(
    `payment_plan_installments?select=id,installment_number,status,amount,payment_plan_id,subscription_id&booking_id=eq.${PACKAGE_ID}&order=installment_number`
  );
  const toClose = stages.filter(
    s => !['paid', 'cancelled'].includes(String(s.status)) && !s.subscription_id
  );
  const offTotal = toClose.reduce((sum, s) => sum + Number(s.amount || 0), 0);

  console.log(`\n2. STAGES: ${stages.length} rows, ${toClose.length} to close`);
  for (const s of stages) {
    const verdict = toClose.includes(s) ? '-> cancelled' : 'left alone';
    console.log(
      `     #${String(s.installment_number).padStart(2)}  ${String(s.status).padEnd(10)} ${String(money(s.amount)).padStart(8)}  ${verdict}`
    );
  }

  /* ── 3. the plan, which is the sum of what is left ───────────────────────── */
  const planId = stages[0]?.payment_plan_id ?? proposal?.created_plan_id;
  const [plan] = planId
    ? await get(`payment_plans?select=id,total_amount,installment_count&id=eq.${planId}`)
    : [null];

  /*
   * RECOMPUTED FROM THE STAGES, not decremented.
   *
   * The running code decrements, which is right when the two numbers already
   * agree with the stages. They do not here: `total_amount` was lowered by each
   * of the three earlier per-session cancellations, and `installment_count` was
   * not, because that path only ever lowered the total. Subtracting would carry
   * that drift forward and leave the plan claiming four payments when one
   * survives.
   *
   * A repair script is exactly where to recompute instead. The stages are the
   * source of truth; these two columns are a cache of them.
   */
  const surviving = stages.filter(s => !toClose.includes(s) && String(s.status) !== 'cancelled');
  const nextTotal = plan ? surviving.reduce((sum, s) => sum + Number(s.amount || 0), 0) : null;
  const nextCount = plan ? surviving.length : null;

  console.log('\n3. PLAN  (recomputed from the surviving stages, not decremented)');
  if (plan) {
    const byDecrement = Math.max(0, Number(plan.installment_count || 0) - toClose.length);
    console.log(`     total_amount      ${money(plan.total_amount)}  ->  ${money(nextTotal)}`);
    console.log(`     installment_count ${plan.installment_count}  ->  ${nextCount}`);
    if (byDecrement !== nextCount) {
      console.log(
        `       (decrementing would have said ${byDecrement}: the count was never lowered by the`
      );
      console.log('        three earlier per-session cancellations, so it had drifted)');
    }
    console.log(`     surviving stages  ${surviving.map(s => '#' + s.installment_number + ':' + s.status).join(' ') || 'none'}`);
  } else {
    console.log('     no plan row found');
  }

  /* ── 4. the booking itself ───────────────────────────────────────────────── */
  console.log('\n4. BOOKING');
  console.log(`     status         ${booking.status} -> cancelled`);
  console.log(`     meeting_status ${booking.meeting_status} -> cancelled`);
  console.log('     cancel_reason  -> stopped_with_quote');

  const withEvents = sessions.filter(s => s.external_calendar_event_id);
  console.log(
    `\nCALENDAR: ${withEvents.length} session(s) carry an event id. NOT TOUCHED by this script.`
  );
  console.log('EMAIL   : none sent. The client was told when the quote was stopped.');

  if (!APPLY) {
    console.log('\n--- nothing was written. Re-run with --apply to perform the above. ---');
    return;
  }

  /* ─────────────────────────────── apply ──────────────────────────────────── */
  const stampedAt = new Date().toISOString();

  if (holding.length) {
    const rows = await patch(
      `scheduling_meetings?booking_id=eq.${PACKAGE_ID}&user_id=eq.${userId}&meeting_status=is.null`,
      { meeting_status: 'cancelled', outcome_by: 'owner', outcome_at: stampedAt }
    );
    console.log(`\nsessions cancelled: ${rows.length}`);
  }

  if (toClose.length) {
    const rows = await patch(
      `payment_plan_installments?booking_id=eq.${PACKAGE_ID}&user_id=eq.${userId}&status=not.in.(paid,cancelled)&subscription_id=is.null`,
      {
        status: 'cancelled',
        cancel_reason: 'stopped_with_quote',
        cancelled_by: 'owner',
        cancelled_at: stampedAt,
        next_retry_at: null,
        updated_at: stampedAt,
      }
    );
    console.log(`stages closed: ${rows.length}`);
  }

  if (plan) {
    await patch(`payment_plans?id=eq.${plan.id}&user_id=eq.${userId}`, {
      total_amount: nextTotal,
      installment_count: nextCount,
    });
    console.log(`plan: ${money(nextTotal)} over ${nextCount}`);
  }

  await patch(`scheduling_bookings?id=eq.${PACKAGE_ID}&user_id=eq.${userId}`, {
    status: 'cancelled',
    meeting_status: 'cancelled',
    cancel_reason: 'stopped_with_quote',
    cancelled_by: 'owner',
    outcome_by: 'owner',
    outcome_at: stampedAt,
    updated_at: stampedAt,
  });
  console.log('booking cancelled');
  console.log('\ndone.');
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
