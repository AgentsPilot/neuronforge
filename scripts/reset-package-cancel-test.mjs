/**
 * Put the ADHD package back the way it was, so the cancel can be tested again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT RESTORES, AND WHY IT IS A BASELINE RATHER THAN AN UNDO
 *
 * An undo reverses the last action. That is no good here: the first test
 * cancelled one booking, and the next test — with the cascade in place — will
 * cancel two, plus their sessions, stages and plan. An undo would have to be
 * rewritten after every run.
 *
 * So this restores a fixed, known-good state instead. Run it as many times as
 * you like, after any cancel, and the package comes back to exactly the point
 * it was at before the first cancellation attempt on 2026-10-21 03:47Z.
 *
 * That state is written down below as data, captured from the live rows. It is
 * NOT the pristine package: it keeps every outcome from the earlier testing —
 * three sessions called off, one moved and held, one missed, one more called
 * off, two added without a charge. Those are real test results and resetting
 * them would throw away the setup that makes this a useful case.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO BOOKINGS
 *
 *   ae0543f1  the job the quote was written for. No sessions. This is the one
 *             the first cancel actually hit.
 *   f00da6a7  the package its acceptance created. Owns the 13 sessions, the 11
 *             stages and the plan. The cascade should now reach it.
 *
 * Both are restored, so the test starts from the same place whichever card you
 * press cancel on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DRY RUN BY DEFAULT. Prints a row-by-row diff and writes nothing.
 *
 *   node scripts/reset-package-cancel-test.mjs            # what would change
 *   node scripts/reset-package-cancel-test.mjs --apply    # change it
 *
 * It does not touch invoices, payments or refunds. Session 4 stays paid and
 * refunded, which is a fact about money that actually moved.
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
  if (!Array.isArray(body)) throw new Error(JSON.stringify(body).slice(0, 300));
  return body;
};

const patch = async (path, values) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(values),
  });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(JSON.stringify(body).slice(0, 300));
  return body;
};

// ─────────────────────────────── THE BASELINE ────────────────────────────────

const QUOTE_BOOKING = 'ae0543f1-d504-4aca-9ecf-967d29fe7275';
const PACKAGE = 'f00da6a7-37fc-4fc1-89bb-8c59c46d5411';
const PROPOSAL = '444f4e59-485d-4081-ba38-8057bdb71897';
const PLAN = 'b4b65734-6577-481c-b114-6d134e513940';

/**
 * A booking that has not been cancelled.
 *
 * `outcome_by` and `outcome_at` are cleared along with the status: the cancel
 * writes all four together, and leaving a timestamp behind would have the
 * journey claiming somebody answered for an appointment that is open again.
 */
const LIVE_BOOKING = {
  status: 'confirmed',
  meeting_status: null,
  cancel_reason: null,
  cancel_note: null,
  cancelled_by: null,
  cancellation_reason: null,
  outcome_by: null,
  outcome_at: null,
};

/**
 * Each session, by session number and attempt.
 *
 * `null` means unanswered and holding its hour, which is what the cascade
 * should change. Everything else is an outcome from earlier testing and must
 * survive the reset.
 */
const SESSIONS = {
  '1/1': 'cancelled',
  '2/1': 'cancelled',
  '3/1': 'cancelled',
  '4/1': 'moved',
  '4/2': 'held',
  '5/1': 'no_show',
  '6/1': 'cancelled',
  '7/1': null,
  '8/1': 'cancelled',
  '9/1': null,
  '10/1': null,
  '11/1': null,
  '12/1': null,
  '13/1': null,
};

/** Each stage by its number. `paid` is money that arrived and is never rewritten. */
const STAGES = {
  1: 'pending',
  2: 'cancelled',
  3: 'cancelled',
  4: 'paid',
  5: 'pending',
  6: 'cancelled',
  7: 'pending',
  8: 'pending',
  9: 'pending',
  10: 'pending',
  11: 'pending',
};

/**
 * The plan as it stood: eleven stages agreed, three of them already called off
 * so the total was lowered three times while the count never was. That drift is
 * part of the baseline, deliberately — it is the state the fix has to cope with.
 */
const PLAN_ROW = { total_amount: 1066.74, installment_count: 11 };

// ──────────────────────────────────── run ────────────────────────────────────

/** Prints one field's change and reports whether there was one. */
const note = (what, from, to) => {
  if (String(from) === String(to)) return false;
  console.log(`  ${what.padEnd(48)} ${String(from).padEnd(12)} -> ${to}`);
  return true;
};

async function main() {
  console.log(APPLY ? '*** APPLYING ***\n' : '--- DRY RUN, nothing will be written ---\n');

  const [quoteBooking] = await get(
    `scheduling_bookings?select=id,user_id,status,meeting_status,cancel_reason,cancelled_by,outcome_at&id=eq.${QUOTE_BOOKING}`
  );
  const [pkg] = await get(
    `scheduling_bookings?select=id,user_id,status,meeting_status,cancel_reason,cancelled_by,outcome_at&id=eq.${PACKAGE}`
  );
  if (!quoteBooking || !pkg) throw new Error('one of the two bookings was not found');

  const userId = pkg.user_id;

  console.log('BOOKINGS');
  for (const [label, row] of [
    ['ae0543f1 (the quote\'s job)', quoteBooking],
    ['f00da6a7 (the package)', pkg],
  ]) {
    const dirty =
      note(`${label}  status`, row.status, LIVE_BOOKING.status) |
      note(`${label}  meeting_status`, row.meeting_status, LIVE_BOOKING.meeting_status) |
      note(`${label}  cancel_reason`, row.cancel_reason, LIVE_BOOKING.cancel_reason);
    if (!dirty) console.log(`  ${label.padEnd(46)} already live`);
  }

  const [proposal] = await get(
    `proposals?select=id,status,stop_reason,stopped_at&id=eq.${PROPOSAL}`
  );
  console.log('\nQUOTE');
  if (!note('  status', proposal?.status, 'accepted')) console.log('  already accepted');
  note('  stop_reason', proposal?.stop_reason, null);
  note('  stopped_at', proposal?.stopped_at ? 'set' : null, null);

  const sessions = await get(
    `scheduling_meetings?select=id,session_number,occurrence_number,meeting_status&booking_id=eq.${PACKAGE}&order=session_number,occurrence_number`
  );
  console.log('\nSESSIONS');
  const sessionFixes = [];
  for (const s of sessions) {
    const key = `${s.session_number}/${s.occurrence_number}`;
    const want = key in SESSIONS ? SESSIONS[key] : undefined;
    if (want === undefined) {
      console.log(`  s${key} is not in the baseline and is left alone`);
      continue;
    }
    if (String(s.meeting_status) !== String(want)) {
      sessionFixes.push({ id: s.id, want });
      console.log(`  s${key.padEnd(6)} ${String(s.meeting_status).padEnd(12)} -> ${want}`);
    }
  }
  if (!sessionFixes.length) console.log('  all 14 already match the baseline');

  const stages = await get(
    `payment_plan_installments?select=id,installment_number,status&payment_plan_id=eq.${PLAN}&order=installment_number`
  );
  console.log('\nSTAGES');
  const stageFixes = [];
  for (const st of stages) {
    const want = STAGES[st.installment_number];
    if (!want) continue;
    if (st.status !== want) {
      stageFixes.push({ id: st.id, want });
      console.log(`  #${String(st.installment_number).padEnd(5)} ${String(st.status).padEnd(12)} -> ${want}`);
    }
  }
  if (!stageFixes.length) console.log('  all 11 already match the baseline');

  const [plan] = await get(
    `payment_plans?select=id,total_amount,installment_count&id=eq.${PLAN}`
  );
  console.log('\nPLAN');
  const planDirty =
    note('  total_amount', plan?.total_amount, PLAN_ROW.total_amount) |
    note('  installment_count', plan?.installment_count, PLAN_ROW.installment_count);
  if (!planDirty) console.log('  already 1,066.74 over 11');

  if (!APPLY) {
    console.log('\n--- nothing written. Re-run with --apply to restore the baseline. ---');
    return;
  }

  // ────────────────────────────────── apply ──────────────────────────────────

  for (const id of [QUOTE_BOOKING, PACKAGE]) {
    await patch(`scheduling_bookings?id=eq.${id}&user_id=eq.${userId}`, {
      ...LIVE_BOOKING,
      updated_at: new Date().toISOString(),
    });
  }
  console.log('\nbookings restored to confirmed');

  await patch(`proposals?id=eq.${PROPOSAL}&user_id=eq.${userId}`, {
    status: 'accepted',
    stop_reason: null,
    stop_note: null,
    stopped_at: null,
    updated_at: new Date().toISOString(),
  });
  console.log('quote restored to accepted');

  for (const fix of sessionFixes) {
    await patch(`scheduling_meetings?id=eq.${fix.id}&user_id=eq.${userId}`, {
      meeting_status: fix.want,
      /* An unanswered session has nobody and no moment attached to it. */
      ...(fix.want === null ? { outcome_by: null, outcome_at: null } : {}),
    });
  }
  if (sessionFixes.length) console.log(`sessions restored: ${sessionFixes.length}`);

  for (const fix of stageFixes) {
    await patch(`payment_plan_installments?id=eq.${fix.id}&user_id=eq.${userId}`, {
      status: fix.want,
      ...(fix.want === 'pending'
        ? { cancel_reason: null, cancel_note: null, cancelled_by: null, cancelled_at: null }
        : {}),
      updated_at: new Date().toISOString(),
    });
  }
  if (stageFixes.length) console.log(`stages restored: ${stageFixes.length}`);

  await patch(`payment_plans?id=eq.${PLAN}&user_id=eq.${userId}`, PLAN_ROW);
  console.log('plan restored to 1,066.74 over 11');

  console.log('\nready to test the cancel again.');
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
