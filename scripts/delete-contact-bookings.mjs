/**
 * Delete a contact's bookings for a day, and everything that hangs off them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `DELETE FROM scheduling_bookings`
 *
 * Ten tables carry a booking reference and three more reach a booking's
 * children, so a bare delete either fails on a foreign key or — worse, where a
 * column allows null — succeeds and leaves money rows pointing at a booking
 * that no longer exists. That is exactly the orphan state the reconcile pass
 * and the insight detectors raise alarms about, so a cleanup script that
 * creates it makes the next test harder to read, not easier.
 *
 * The order below is the FK graph read backwards, taken from the live schema
 * rather than from memory:
 *
 *   proposals ──────────── pointers nulled, never deleted (see below)
 *   payment_reminders ──── invoice_id, installment_id
 *   payment_refunds ────── transaction_id, invoice_id
 *   insight_actions ────── booking_id, invoice_id
 *   email_sends ────────── booking_id, meeting_id
 *   payment_plan_installments
 *   payment_transactions
 *   payment_plan_subscriptions
 *   payment_invoices
 *   scheduling_meetings
 *   abandoned_bookings
 *   scheduling_bookings ── deepest child first, for the self-FK
 *   payment_plans ──────── only if nothing outside the scope still points at it
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS IT REFUSES TO DO
 *
 * SHARED PLANS SURVIVE. `payment_plans` rows are templates and are shared: one
 * on this account is used by ten different bookings. Deleting a plan because
 * one of its bookings is going would silently break the other nine, so a plan
 * is removed only once nothing outside the scope references it at all.
 *
 * PROPOSALS SURVIVE. A quote is a document that existed before the booking and
 * may have been sent to the client. Its pointers are nulled so the delete can
 * proceed; the proposal itself is reported and left alone.
 *
 * THE CONTACT SURVIVES, along with the service. Only bookings are in scope.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DRY RUN BY DEFAULT. Prints every row it would touch and writes nothing.
 *
 *   node scripts/delete-contact-bookings.mjs                     # what would go
 *   node scripts/delete-contact-bookings.mjs --apply             # delete it
 *   node scripts/delete-contact-bookings.mjs --email=a@b.com     # another contact
 *   node scripts/delete-contact-bookings.mjs --days=3            # a wider window
 *   node scripts/delete-contact-bookings.mjs --since=2026-10-01  # from a date
 *   node scripts/delete-contact-bookings.mjs --sweep-unlinked    # + money that
 *                                                                 never linked
 *   node scripts/delete-contact-bookings.mjs --until=…T16:40:00Z  # stop before
 *                                                                 a newer test
 *
 * "Today" means today in the OWNER'S timezone, read from `user_preferences`,
 * because a booking taken at 01:00 in New York is still yesterday in UTC and
 * would otherwise be missed.
 *
 * It stops rather than delete more than `--max` (default 50) bookings, so a
 * mistaken date cannot take out the account's history in one go.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';

const argOf = name => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const APPLY = process.argv.includes('--apply');
const EMAIL = argOf('email') || 'offir.omer@windpoint.io';
const DAYS = Number(argOf('days') || '1');
const SINCE = argOf('since');
const UNTIL = argOf('until');
const MAX = Number(argOf('max') || '50');
const KEEP_STRIPE = process.argv.includes('--keep-stripe');
const SWEEP = process.argv.includes('--sweep-unlinked');

const env = fs.readFileSync('.env.local', 'utf8');
const envVar = key => (env.match(new RegExp('^' + key + '=(.*)$', 'm')) || [])[1]?.trim();
const URL_BASE = envVar('NEXT_PUBLIC_SUPABASE_URL');
const KEY = envVar('SUPABASE_SERVICE_ROLE_KEY');
const STRIPE_KEY = envVar('STRIPE_SECRET_KEY');
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const get = async path => {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`GET ${path}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};

const patch = async (path, values) => {
  if (!APPLY) return [];
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(values),
  });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`PATCH ${path}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};

const del = async path => {
  if (!APPLY) return [];
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=representation' },
  });
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`DELETE ${path}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};

/**
 * Cancel a subscription at Stripe, so it stops billing a booking that is gone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS PART OF THE DELETE AND NOT A SEPARATE CHORE
 *
 * Stripe is the source of truth for the money; these rows are a projection of
 * it. Deleting the projection does not stop the charges. A plan left active
 * bills its next period on schedule, and the webhook then arrives holding a
 * subscription id with no local row to record against — which is precisely the
 * orphaned-money state the reconcile pass exists to shout about.
 *
 * So the cleanup would quietly manufacture the bug it is meant to clear the
 * way for testing. Cancelling first is what makes the delete complete.
 *
 * `--keep-stripe` skips this, for the case where the subscription is wanted and
 * only the local rows are being rebuilt.
 */
async function cancelAtStripe(subscription) {
  const stripeId = subscription.stripe_subscription_id;
  if (!stripeId) return 'no stripe id';
  if (!STRIPE_KEY) return 'no STRIPE_SECRET_KEY';
  if (!APPLY) return 'would cancel';

  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      ...(subscription.stripe_connect_account_id
        ? { 'Stripe-Account': subscription.stripe_connect_account_id }
        : {}),
    },
  });

  const body = await res.json();
  if (body.error) return `FAILED: ${String(body.error.message).slice(0, 70)}`;
  return body.status ?? 'cancelled';
}

/** PostgREST `in.()` list. Returns null for an empty set, meaning "skip". */
const inList = ids => (ids.length ? `in.(${ids.join(',')})` : null);

/** Unique, non-null values of `key` across `rows`. */
const pluck = (rows, key) => [...new Set(rows.map(r => r[key]).filter(Boolean))];

// ─────────────────────────── THE DAY, IN THE OWNER'S CLOCK ───────────────────

/** How far `tz` is from UTC at `date`, in ms. */
function offsetAt(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = Number(p.value);
    return acc;
  }, {});

  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUTC - date.getTime();
}

/** The UTC instant at which the local day `daysAgo` days back began in `tz`. */
function startOfLocalDay(tz, daysAgo) {
  const now = new Date();
  const local = new Date(now.getTime() + offsetAt(now, tz));
  local.setUTCDate(local.getUTCDate() - daysAgo);

  const midnightNaive = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());

  /* Refine once: the offset at midnight can differ from the offset now (DST). */
  let instant = midnightNaive - offsetAt(now, tz);
  instant = midnightNaive - offsetAt(new Date(instant), tz);

  return new Date(instant).toISOString();
}

/**
 * Money in the window that never reached a booking at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS REPORTED SEPARATELY, AND NEVER SWEPT BY DEFAULT
 *
 * Everything else here is found by following the booking. A subscription whose
 * `booking_id` was never stamped is invisible to that search, so deleting the
 * booking leaves it behind — still live at Stripe, still billing, and now with
 * nothing whatsoever identifying what it was for.
 *
 * It is reported rather than deleted because nothing proves it belongs to this
 * contact. In the observed cases these rows carry no booking, no `contact_id`,
 * and no attempt in their Stripe metadata either. The only thing tying them to
 * this scope is "created around the same time", and `linkPaymentsToBooking`
 * refuses to reason from timing for good reason: a guess here reaches into
 * another client's money.
 *
 * So the operator decides, with `--sweep-unlinked`.
 */
async function findUnlinkedMoney(since, untilFilter) {
  const subs = await get(
    `payment_plan_subscriptions?booking_id=is.null&created_at=gte.${since}${untilFilter}` +
    `&select=id,stripe_subscription_id,stripe_connect_account_id,contact_id,status,created_at,periods_paid,installment_count`
  );

  const stages = subs.length
    ? await get(`payment_plan_installments?subscription_id=${inList(subs.map(r => r.id))}` +
        `&select=id,installment_number,status,amount,transaction_id`)
    : [];

  const txIds = pluck(stages, 'transaction_id');

  if (subs.length) {
    console.log(`\n⚠️  ${subs.length} subscription(s) in this window NEVER reached a booking`);
    console.log(`    (${stages.length} stage(s), ${txIds.length} charge(s) behind them)`);
    for (const sub of subs) {
      console.log(`    ${sub.id.slice(0, 8)}  ${sub.stripe_subscription_id ?? 'no stripe id'}  ` +
        `${sub.created_at.slice(11, 19)}  local=${sub.status}  contact=${sub.contact_id ? 'set' : 'NULL'}`);
    }
    console.log(SWEEP
      ? `    --sweep-unlinked given: these will be cancelled and deleted too.`
      : `    Nothing identifies these as this contact's, so they are LEFT ALONE.\n` +
        `    Pass --sweep-unlinked to cancel and delete them as well.`);
  }

  return { subs, stages, txIds };
}

/** Cancel and delete what `findUnlinkedMoney` found. Only on --sweep-unlinked. */
async function sweepUnlinkedMoney(unlinked) {
  if (!SWEEP || !unlinked.subs.length) return;

  if (!KEEP_STRIPE) {
    for (const sub of unlinked.subs) {
      console.log(`  stripe ${sub.stripe_subscription_id ?? '—'}: ${await cancelAtStripe(sub)}`);
    }
  }

  for (const [table, filter] of [
    ['payment_plan_installments', inList(unlinked.stages.map(r => r.id))],
    ['payment_transactions', inList(unlinked.txIds)],
    ['payment_plan_subscriptions', inList(unlinked.subs.map(r => r.id))],
  ]) {
    if (!filter) continue;
    const rows = await del(`${table}?id=${filter}`);
    console.log(`  ${String(rows.length).padStart(4)}× ${table} swept (was unlinked)`);
  }
}

// ───────────────────────────────── THE WORK ──────────────────────────────────

async function main() {
  console.log(`\n${APPLY ? '⚠️  APPLYING' : 'DRY RUN'} — contact ${EMAIL}\n`);

  const contacts = await get(`crm_contacts?email=eq.${encodeURIComponent(EMAIL)}&select=id,first_name,last_name,user_id`);
  if (!contacts.length) {
    console.log(`No contact with that email. Nothing to do.`);
    return;
  }
  if (contacts.length > 1) {
    console.log(`${contacts.length} contacts share that email; all of them are in scope.`);
  }

  const contactIds = contacts.map(c => c.id);
  const ownerId = contacts[0].user_id;
  console.log(`  contact  ${contactIds.map(id => id.slice(0, 8)).join(', ')}  ` +
    `${contacts[0].first_name ?? ''} ${contacts[0].last_name ?? ''}`.trim());

  const prefs = await get(`user_preferences?user_id=eq.${ownerId}&select=timezone`);
  const tz = prefs[0]?.timezone || 'UTC';
  const since = SINCE ? new Date(`${SINCE}T00:00:00Z`).toISOString() : startOfLocalDay(tz, DAYS - 1);
  /*
   * An upper bound, so a cleanup can take the earlier part of a day and leave a
   * booking made since then alone. Without it "today" always includes the test
   * you just set up.
   */
  const until = UNTIL ? new Date(UNTIL).toISOString() : null;
  const untilFilter = until ? `&created_at=lte.${until}` : '';
  console.log(`  window   from ${since}` +
    (until ? ` to ${until}` : '') +
    `  (${tz}${SINCE ? ', --since' : `, last ${DAYS} day(s)`})\n`);

  // ── scope: the contact's bookings in the window, plus every descendant ──
  //
  // A package's second booking is a CHILD of the first and may have been
  // created on another day. Leaving it behind would break the parent's delete
  // on the self-FK, so the scope grows downwards until it stops changing.
  let scope = await get(
    `scheduling_bookings?contact_id=${inList(contactIds)}&created_at=gte.${since}${untilFilter}` +
    `&select=id,status,payment_status,payment_amount,payment_currency,created_at,parent_booking_id,invoice_id,payment_plan_id`
  );

  for (let depth = 0; depth < 10; depth += 1) {
    const filter = inList(scope.map(b => b.id));
    if (!filter) break;
    const children = await get(
      `scheduling_bookings?parent_booking_id=${filter}` +
      `&select=id,status,payment_status,payment_amount,payment_currency,created_at,parent_booking_id,invoice_id,payment_plan_id`
    );
    const known = new Set(scope.map(b => b.id));
    const fresh = children.filter(c => !known.has(c.id));
    if (!fresh.length) break;
    console.log(`  + ${fresh.length} descendant booking(s) pulled in, to keep the tree whole`);
    scope = scope.concat(fresh);
  }

  if (!scope.length) {
    console.log('No bookings in that window.');

    /* Unlinked money has no booking by definition, so it is still worth a look. */
    const orphans = await findUnlinkedMoney(since, untilFilter);

    if (!APPLY) {
      console.log(`\nDry run. Nothing was written.${orphans.subs.length && SWEEP ? ' Re-run with --apply to sweep.' : ''}\n`);
      return;
    }

    console.log(`\n— applying —`);
    await sweepUnlinkedMoney(orphans);
    console.log(`\nDone.\n`);
    return;
  }

  console.log(`— ${scope.length} booking(s) in scope —`);
  for (const b of scope) {
    console.log(`  ${b.id.slice(0, 8)}  ${b.created_at.slice(0, 19).replace('T', ' ')}  ` +
      `${String(b.status ?? '-').padEnd(10)} pay=${String(b.payment_status ?? '-').padEnd(8)} ` +
      `${b.payment_amount ?? ''} ${b.payment_currency ?? ''}` +
      `${b.parent_booking_id ? `  child of ${b.parent_booking_id.slice(0, 8)}` : ''}`);
  }

  if (scope.length > MAX) {
    console.log(`\nRefusing: ${scope.length} bookings is more than --max=${MAX}.`);
    console.log(`Check the window, or raise the cap deliberately.\n`);
    process.exitCode = 1;
    return;
  }

  const bookingIds = scope.map(b => b.id);
  const B = inList(bookingIds);

  // ── everything attached, gathered before anything is deleted ──
  const meetings = await get(`scheduling_meetings?booking_id=${B}&select=id,session_number,meeting_status,start_time`);
  const invoices = await get(`payment_invoices?booking_id=${B}&select=id,invoice_number,status,amount,currency,refunded_amount`);
  const subs = await get(`payment_plan_subscriptions?booking_id=${B}&select=id,payment_plan_id,status,stripe_subscription_id,stripe_connect_account_id,periods_paid,installment_count`);

  const M = inList(meetings.map(r => r.id));
  const I = inList(invoices.map(r => r.id));
  const S = inList(subs.map(r => r.id));

  /*
   * Stages reached four ways. A stage whose `booking_id` was never stamped —
   * the orphan this session was spent fixing — is still found through its
   * subscription, its invoice or its meeting.
   */
  const stageRows = [
    ...(B ? await get(`payment_plan_installments?booking_id=${B}&select=id,installment_number,status,amount,payment_plan_id,transaction_id`) : []),
    ...(S ? await get(`payment_plan_installments?subscription_id=${S}&select=id,installment_number,status,amount,payment_plan_id,transaction_id`) : []),
    ...(I ? await get(`payment_plan_installments?invoice_id=${I}&select=id,installment_number,status,amount,payment_plan_id,transaction_id`) : []),
    ...(M ? await get(`payment_plan_installments?meeting_id=${M}&select=id,installment_number,status,amount,payment_plan_id,transaction_id`) : []),
  ];
  const stages = [...new Map(stageRows.map(r => [r.id, r])).values()];
  const L = inList(stages.map(r => r.id));

  /* Charges reached three ways, for the same reason. */
  const txRows = [
    ...(B ? await get(`payment_transactions?booking_id=${B}&select=id,amount,currency,status,refunded_amount`) : []),
    ...(I ? await get(`payment_transactions?invoice_id=${I}&select=id,amount,currency,status,refunded_amount`) : []),
    ...(inList(pluck(stages, 'transaction_id'))
      ? await get(`payment_transactions?id=${inList(pluck(stages, 'transaction_id'))}&select=id,amount,currency,status,refunded_amount`)
      : []),
  ];
  const txs = [...new Map(txRows.map(r => [r.id, r])).values()];
  const T = inList(txs.map(r => r.id));

  const refunds = [
    ...(T ? await get(`payment_refunds?transaction_id=${T}&select=id,amount,status`) : []),
    ...(I ? await get(`payment_refunds?invoice_id=${I}&select=id,amount,status`) : []),
  ];
  const uniqueRefunds = [...new Map(refunds.map(r => [r.id, r])).values()];

  const reminders = [
    ...(I ? await get(`payment_reminders?invoice_id=${I}&select=id`) : []),
    ...(L ? await get(`payment_reminders?installment_id=${L}&select=id`) : []),
  ];
  const uniqueReminders = [...new Map(reminders.map(r => [r.id, r])).values()];

  const actions = [
    ...(B ? await get(`insight_actions?booking_id=${B}&select=id,kind`) : []),
    ...(I ? await get(`insight_actions?invoice_id=${I}&select=id,kind`) : []),
  ];
  const uniqueActions = [...new Map(actions.map(r => [r.id, r])).values()];

  const emails = [
    ...(B ? await get(`email_sends?booking_id=${B}&select=id,email_kind`) : []),
    ...(M ? await get(`email_sends?meeting_id=${M}&select=id,email_kind`) : []),
  ];
  const uniqueEmails = [...new Map(emails.map(r => [r.id, r])).values()];

  const attempts = B ? await get(`abandoned_bookings?booking_id=${B}&select=id,status`) : [];

  /* Proposals that point at anything going. Nulled, never deleted. */
  const proposals = [
    ...(B ? await get(`proposals?booking_id=${B}&select=id,status,booking_id,package_booking_id,created_invoice_id,created_plan_id`) : []),
    ...(B ? await get(`proposals?package_booking_id=${B}&select=id,status,booking_id,package_booking_id,created_invoice_id,created_plan_id`) : []),
    ...(I ? await get(`proposals?created_invoice_id=${I}&select=id,status,booking_id,package_booking_id,created_invoice_id,created_plan_id`) : []),
  ];
  const uniqueProposals = [...new Map(proposals.map(r => [r.id, r])).values()];

  // ── plans: candidates now, decided after the children are counted ──
  const planIds = [...new Set([
    ...pluck(subs, 'payment_plan_id'),
    ...pluck(stages, 'payment_plan_id'),
    ...pluck(scope, 'payment_plan_id'),
  ])];

  console.log(`\n— attached rows —`);
  const summary = [
    ['scheduling_meetings', meetings.length],
    ['payment_invoices', invoices.length],
    ['payment_transactions', txs.length],
    ['payment_refunds', uniqueRefunds.length],
    ['payment_reminders', uniqueReminders.length],
    ['payment_plan_subscriptions', subs.length],
    ['payment_plan_installments', stages.length],
    ['insight_actions', uniqueActions.length],
    ['email_sends', uniqueEmails.length],
    ['abandoned_bookings', attempts.length],
  ];
  for (const [table, n] of summary) {
    if (n) console.log(`  ${String(n).padStart(4)}  ${table}`);
  }
  if (!summary.some(([, n]) => n)) console.log('  (none)');

  const money = txs.reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
  const returned = txs.reduce((sum, t) => sum + Number(t.refunded_amount ?? 0), 0);
  if (txs.length) {
    console.log(`\n  money on those charges: ${money} charged, ${returned} refunded, ` +
      `${(money - returned).toFixed(2)} net`);
    console.log(`  NOTE: the charges that already settled are NOT reversed — this deletes the`);
    console.log(`        local record of them. Refund at Stripe first if the money should go back.`);
  }

  if (subs.length) {
    console.log(`\n— ${subs.length} Stripe subscription(s) ${KEEP_STRIPE ? 'LEFT ACTIVE (--keep-stripe)' : 'to cancel'} —`);
    for (const sub of subs) {
      console.log(`  ${sub.stripe_subscription_id ?? 'no stripe id'}  ` +
        `local=${sub.status}  ${sub.periods_paid ?? '?'}/${sub.installment_count ?? '?'} periods paid`);
    }
    if (KEEP_STRIPE) {
      console.log(`  ⚠️  these will keep billing, and the webhook will have no row to record against`);
    }
  }

  if (uniqueProposals.length) {
    console.log(`\n— ${uniqueProposals.length} proposal(s): pointers nulled, documents kept —`);
    for (const p of uniqueProposals) console.log(`  ${p.id.slice(0, 8)}  status=${p.status}`);
  }

  // ── which plans are exclusive to this scope ──
  const plansToDelete = [];
  const plansKept = [];

  for (const planId of planIds) {
    const [otherSubs, otherStages, otherBookings, otherProposals] = await Promise.all([
      get(`payment_plan_subscriptions?payment_plan_id=eq.${planId}&select=id,booking_id`),
      get(`payment_plan_installments?payment_plan_id=eq.${planId}&select=id,booking_id`),
      get(`scheduling_bookings?payment_plan_id=eq.${planId}&select=id`),
      get(`proposals?created_plan_id=eq.${planId}&select=id`),
    ]);

    const inScopeSub = new Set(subs.map(r => r.id));
    const inScopeStage = new Set(stages.map(r => r.id));
    const inScopeBooking = new Set(bookingIds);
    const inScopeProposal = new Set(uniqueProposals.map(r => r.id));

    const survivors =
      otherSubs.filter(r => !inScopeSub.has(r.id)).length +
      otherStages.filter(r => !inScopeStage.has(r.id)).length +
      otherBookings.filter(r => !inScopeBooking.has(r.id)).length +
      otherProposals.filter(r => !inScopeProposal.has(r.id)).length;

    if (survivors === 0) plansToDelete.push(planId);
    else plansKept.push({ planId, survivors });
  }

  if (plansToDelete.length) {
    console.log(`\n— ${plansToDelete.length} payment_plan(s) used by nothing else: deleting —`);
    for (const id of plansToDelete) console.log(`  ${id.slice(0, 8)}`);
  }
  if (plansKept.length) {
    console.log(`\n— ${plansKept.length} payment_plan(s) SHARED, kept —`);
    for (const { planId, survivors } of plansKept) {
      console.log(`  ${planId.slice(0, 8)}  still referenced ${survivors}× outside this scope`);
    }
  }

  /*
   * ── MONEY THAT NEVER REACHED A BOOKING ──────────────────────────────────────
   *
   * Everything above was found by following the booking. A subscription whose
   * `booking_id` was never stamped is invisible to that search, so deleting the
   * booking leaves it behind — still live at Stripe, still billing, now with
   * nothing at all to identify what it was for.
   *
   * It is reported rather than swept, because nothing proves it belongs to this
   * contact. These rows carry no booking, and in the observed cases no
   * `contact_id` and no attempt in their Stripe metadata either. The only thing
   * linking them to this scope is "created around the same time", and
   * `linkPaymentsToBooking` refuses to infer from timing for good reason: a
   * guess here destroys another client's money.
   *
   * So the operator decides, with `--sweep-unlinked`.
   */
  const unlinked = await findUnlinkedMoney(since, untilFilter);

  if (!APPLY) {
    console.log(`\nDry run. Nothing was written. Re-run with --apply to delete.\n`);
    return;
  }

  // ─────────────────────────────── DELETE ────────────────────────────────────
  console.log(`\n— applying —`);
  const P = inList(plansToDelete);
  let n;

  /* 0. Stop the billing before removing the rows that track it. */
  if (!KEEP_STRIPE) {
    for (const sub of subs) {
      const outcome = await cancelAtStripe(sub);
      console.log(`  stripe ${sub.stripe_subscription_id ?? '—'}: ${outcome}`);
    }
  }

  /* 1. Pointers first, so the rows they guard can go. */
  for (const p of uniqueProposals) {
    const clear = {};
    if (bookingIds.includes(p.booking_id)) clear.booking_id = null;
    if (bookingIds.includes(p.package_booking_id)) clear.package_booking_id = null;
    if (invoices.some(i => i.id === p.created_invoice_id)) clear.created_invoice_id = null;
    if (plansToDelete.includes(p.created_plan_id)) clear.created_plan_id = null;
    if (Object.keys(clear).length) {
      await patch(`proposals?id=eq.${p.id}`, clear);
      console.log(`  proposals ${p.id.slice(0, 8)}: nulled ${Object.keys(clear).join(', ')}`);
    }
  }

  if (I) { n = await patch(`scheduling_bookings?invoice_id=${I}`, { invoice_id: null }); console.log(`  ${n.length}× scheduling_bookings.invoice_id nulled`); }
  if (P) { n = await patch(`scheduling_bookings?payment_plan_id=${P}`, { payment_plan_id: null }); console.log(`  ${n.length}× scheduling_bookings.payment_plan_id nulled`); }

  /* 2. Leaves upwards. */
  const steps = [
    ['payment_reminders', inList(uniqueReminders.map(r => r.id))],
    ['payment_refunds', inList(uniqueRefunds.map(r => r.id))],
    ['insight_actions', inList(uniqueActions.map(r => r.id))],
    ['email_sends', inList(uniqueEmails.map(r => r.id))],
    ['payment_plan_installments', L],
    ['payment_transactions', T],
    ['payment_plan_subscriptions', S],
    ['payment_invoices', I],
    ['scheduling_meetings', M],
    ['abandoned_bookings', inList(attempts.map(r => r.id))],
  ];

  for (const [table, filter] of steps) {
    if (!filter) continue;
    n = await del(`${table}?id=${filter}`);
    console.log(`  ${String(n.length).padStart(4)}× ${table} deleted`);
  }

  /* 3. Bookings, deepest child first, for the self-FK. */
  const byDepth = [...scope].sort((a, b) => depthOf(b, scope) - depthOf(a, scope));
  for (const b of byDepth) {
    n = await del(`scheduling_bookings?id=eq.${b.id}`);
    console.log(`     1× scheduling_bookings ${b.id.slice(0, 8)} deleted${n.length ? '' : ' (already gone)'}`);
  }

  /* 3b. The unlinked money, only when explicitly asked for. */
  await sweepUnlinkedMoney(unlinked);

  /* 4. Plans last — only the ones nothing else wanted. */
  if (P) { n = await del(`payment_plans?id=${P}`); console.log(`  ${String(n.length).padStart(4)}× payment_plans deleted`); }

  console.log(`\nDone.\n`);
}

/** How many parents a booking has inside the scope. */
function depthOf(booking, scope) {
  let depth = 0;
  let current = booking;
  const byId = new Map(scope.map(b => [b.id, b]));
  while (current?.parent_booking_id && byId.has(current.parent_booking_id) && depth < 10) {
    current = byId.get(current.parent_booking_id);
    depth += 1;
  }
  return depth;
}

main().catch(err => {
  console.error('\nFailed:', err.message, '\n');
  process.exitCode = 1;
});
