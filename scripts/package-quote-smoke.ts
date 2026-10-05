/**
 * Turn a quote into a PACKAGE, and watch what accepting and paying for it does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The packages feature is complete from acceptance onwards, and the owner-facing
 * half that CREATES one — the Package tick and the date pickers in the quote
 * dialog — is still to come. So there is no way to make a package by clicking,
 * and two steps of the test are otherwise hand-written SQL and a real inbox:
 *
 *   · writing `proposals.sessions`, the dates the package sold;
 *   · opening the quote as the client, which needs a signed token.
 *
 * This does both and nothing else. Every other step of the test is the real
 * product: the client's Accept button, the owner's Mark as paid, the calendar.
 *
 * DEV ONLY. It reads with the service role and makes exactly one write — the
 * `sessions` column on a quote you name. It never accepts, never pays, and
 * never creates a booking: those are the things being tested.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   npm run package:smoke -- --list
 *       The quotes that can become a package: draft or sent, with a service.
 *
 *   npm run package:smoke -- --proposal=<id> [--sessions=3] [--days=7] [--at=10:00]
 *       Writes three weekly dates starting next week at 10:00 business time,
 *       then prints the client link to click Accept on.
 *
 *   npm run package:smoke -- --proposal=<id> --verify
 *   npm run package:smoke -- --latest
 *       What exists now: the container, its meetings, their statuses, the
 *       stages and the invoice. `--latest` finds the newest package itself.
 *       Run it after Accept, and again after Mark as paid.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { supabaseServer } from '../lib/supabaseServer';
import { generateProposalToken } from '../lib/business-os/proposalToken';
import { businessInstant, safeTimezone, shiftBusinessDateKey, businessDateKey } from '../lib/scheduling/businessTime';
import { closedDayVerdict } from '../lib/scheduling/closedDay';

/* eslint-disable no-console -- a CLI's output IS its interface; this is not app code */

const arg = (name: string): string | undefined => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

async function list() {
  const { data, error } = await supabaseServer
    .from('proposals')
    .select('id, title, status, total, currency, service_id, contact_id, sessions, created_at')
    .in('status', ['draft', 'sent', 'viewed'])
    .not('service_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) {
    console.error('Could not read proposals:', error.message);
    return;
  }

  if (!data?.length) {
    console.log('No draft or sent quote with a service on it. Create one from the contact drawer first.');
    return;
  }

  console.log('Quotes that can become a package:\n');
  for (const row of data) {
    const already = row.sessions ? '  ← already a package' : '';
    console.log(`  ${row.id}  ${row.status.padEnd(7)} ${row.currency} ${row.total}  ${row.title}${already}`);
  }
  console.log('\nThen: npm run package:smoke -- --proposal=<id>');
}

/** The newest quote that sold meetings, whatever state it is in. */
async function latestPackageId(): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from('proposals')
    .select('id, title, status, created_at')
    .not('sessions', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Could not look for a package:', error.message);
    return null;
  }

  if (!data) {
    console.log('No quote in the database has sessions on it yet.');
    return null;
  }

  console.log(`Newest package: ${data.title} [${data.status}]  ${data.created_at}\n`);
  return data.id as string;
}

async function verify(proposalId: string) {
  const { data: proposal } = await supabaseServer
    .from('proposals')
    .select('id, status, title, total, currency, sessions, package_booking_id, created_invoice_id, created_plan_id')
    .eq('id', proposalId)
    .maybeSingle();

  if (!proposal) {
    console.error('No such proposal.');
    return;
  }

  console.log(`Quote    ${proposal.title}  [${proposal.status}]  ${proposal.currency} ${proposal.total}`);
  console.log(`Sessions ${JSON.stringify(proposal.sessions)}`);
  console.log(`Package  ${proposal.package_booking_id ?? '— none (not accepted yet, or the migration is not applied)'}`);
  console.log(`Invoice  ${proposal.created_invoice_id ?? '—'}      Plan ${proposal.created_plan_id ?? '—'}`);

  if (proposal.created_invoice_id) {
    const { data: invoice } = await supabaseServer
      .from('payment_invoices')
      .select('invoice_number, status, amount, paid_at')
      .eq('id', proposal.created_invoice_id)
      .maybeSingle();
    if (invoice) {
      console.log(`         ${invoice.invoice_number}  ${invoice.status}  ${invoice.amount}  paid_at=${invoice.paid_at ?? '—'}`);
    }
  }

  if (!proposal.package_booking_id) return;

  const { data: container } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, status, payment_status, start_time, end_time, parent_booking_id, occurrence_number')
    .eq('id', proposal.package_booking_id)
    .maybeSingle();

  console.log('\nThe purchase (must have NO times — that is what keeps it out of the diary):');
  console.log(`  ${container?.id}  ${container?.status}/${container?.payment_status}  start=${container?.start_time ?? 'null'}  end=${container?.end_time ?? 'null'}`);

  /*
   * The money, which for a per-session package is the whole mechanism: one
   * stage per meeting, every one manual, each bound to its own meeting.
   */
  if (proposal.created_plan_id) {
    const { data: stages } = await supabaseServer
      .from('payment_plan_installments')
      .select('installment_number, label, amount, status, trigger, due_date, booking_id, invoice_id')
      .eq('payment_plan_id', proposal.created_plan_id)
      .order('installment_number');

    console.log(`\nStages (${stages?.length ?? 0}):`);
    for (const stage of stages ?? []) {
      console.log(
        `  ${stage.installment_number}.  ${String(stage.status).padEnd(7)} ${String(stage.trigger).padEnd(6)}` +
          `  ${String(stage.amount).padStart(8)}  due=${stage.due_date ?? '—'}` +
          `  booking=${stage.booking_id ? String(stage.booking_id).slice(0, 8) : '—'}` +
          `  invoice=${stage.invoice_id ? String(stage.invoice_id).slice(0, 8) : '—'}  ${stage.label ?? ''}`
      );
    }
  }

  const { data: children } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, status, start_time, end_time, occurrence_number')
    .eq('parent_booking_id', proposal.package_booking_id)
    .order('occurrence_number');

  console.log(`\nIts meetings (${children?.length ?? 0}):`);
  for (const child of children ?? []) {
    console.log(`  ${child.occurrence_number}.  ${child.status.padEnd(9)} ${child.start_time} → ${child.end_time}`);
  }
}

async function makePackage(proposalId: string) {
  const count = Number(arg('sessions') ?? 3);
  const everyDays = Number(arg('days') ?? 7);
  const atHour = arg('at') ?? '10:00';

  const { data: proposal } = await supabaseServer
    .from('proposals')
    .select('id, user_id, status, title, service_id, contact_id, payment_shape')
    .eq('id', proposalId)
    .maybeSingle();

  if (!proposal) {
    console.error('No such proposal.');
    return;
  }

  if (!proposal.service_id) {
    console.error(
      'This quote names no service, and a package needs one: its meetings are bookings,\n' +
      'and scheduling_bookings.service_id is NOT NULL. Acceptance will refuse it.'
    );
    return;
  }

  const { data: contact } = await supabaseServer
    .from('crm_contacts')
    .select('email, first_name')
    .eq('id', proposal.contact_id)
    .maybeSingle();

  const { data: prefs } = await supabaseServer
    .from('user_preferences')
    .select('timezone')
    .eq('user_id', proposal.user_id)
    .maybeSingle();

  const zone = safeTimezone(prefs?.timezone);

  const { data: service } = await supabaseServer
    .from('scheduling_services')
    .select('duration_minutes, service_name')
    .eq('id', proposal.service_id)
    .maybeSingle();

  const duration = service?.duration_minutes || 60;

  /*
   * The dates, stepped on the BUSINESS's calendar from a week today.
   *
   * A week out so the times are in the future whatever hour you run this, and
   * on the business's own clock so `--at=10:00` means ten where the work
   * happens rather than ten where your laptop is.
   */
  const todayKey = businessDateKey(new Date(), zone);
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const dateKey = shiftBusinessDateKey(todayKey, everyDays * (i + 1));
    dates.push(businessInstant(dateKey, atHour, zone).toISOString());
  }

  /*
   * The two things that will bite at acceptance, said here instead.
   *
   * Acceptance skips a date it cannot take rather than refusing the whole
   * package, so a clash or a closed day shows up as a meeting that quietly is
   * not there. Until the date pickers validate this in the dialog (Stage 3),
   * this is the warning.
   */
  const { data: timeOff } = await supabaseServer
    .from('scheduling_availability_exceptions')
    .select('exception_type, start_date, end_date, custom_hours, reason')
    .eq('user_id', proposal.user_id);

  for (const iso of dates) {
    const dateKey = businessDateKey(new Date(iso), zone);
    const closed = closedDayVerdict(timeOff ?? [], dateKey);
    if (closed.closed) {
      console.warn(`  ⚠  ${dateKey} is a day you are CLOSED${closed.reason ? ` (${closed.reason})` : ''}`);
    }

    const end = new Date(new Date(iso).getTime() + duration * 60_000).toISOString();
    const { data: clash } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, start_time')
      .eq('user_id', proposal.user_id)
      .in('status', ['confirmed', 'pending', 'completed'])
      .lt('start_time', end)
      .gt('end_time', iso)
      .limit(1);

    if (clash?.length) {
      console.warn(`  ⚠  ${iso} overlaps booking ${clash[0].id} — acceptance will SKIP this date`);
    }
  }

  const sessions = { dates, duration_minutes: duration };

  const { error } = await supabaseServer
    .from('proposals')
    .update({ sessions })
    .eq('id', proposalId);

  if (error) {
    console.error('Could not write the sessions:', error.message);
    return;
  }

  console.log(`\nQuote "${proposal.title}" is now a package of ${count} × ${duration}min — ${service?.service_name ?? 'service'}`);
  for (const [i, iso] of dates.entries()) {
    console.log(`  ${i + 1}.  ${iso}   (${businessDateKey(new Date(iso), zone)} ${atHour} ${zone})`);
  }

  console.log(`\nPaid how: ${JSON.stringify(proposal.payment_shape)}`);
  console.log(
    '  { "kind": "single" }  → the meetings are created PENDING and the payment confirms them (scenario 1)\n' +
    '  milestones            → created CONFIRMED, billed per stage (scenario 2)'
  );

  if (!contact?.email) {
    console.warn('\nThis contact has no email address, so there is no client link to open.');
    return;
  }

  const token = generateProposalToken(proposalId, contact.email);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  console.log('\nOpen this as the client and press Accept:');
  console.log(`  ${appUrl}/proposal/${token}`);
  console.log('\nThen:  npm run package:smoke -- --proposal=' + proposalId + ' --verify');
}

async function main() {
  if (flag('latest')) {
    const id = await latestPackageId();
    return id ? verify(id) : undefined;
  }

  const proposalId = arg('proposal');

  if (flag('list') || !proposalId) return list();
  if (flag('verify')) return verify(proposalId);
  return makePackage(proposalId);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
