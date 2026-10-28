/**
 * The sessions of one package, and whether the column that records WHO marked
 * them actually exists on this database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `auto_complete_meetings` writes `outcome_by: 'system'` onto
 * `scheduling_bookings` and nothing else — so a package SESSION, which lives
 * on `scheduling_meetings`, can never currently carry it. The owner's
 * correction controls are wired for that state but dormant, and the only way
 * to exercise them is to put a real session into it by hand.
 *
 * This prints the candidates so the target is chosen from data rather than
 * guessed, and it checks `outcome_by` is really there: migration 20261078 adds
 * it, and an unrun migration would make the write fail rather than do nothing
 * visible.
 *
 * READ ONLY: it writes nothing.
 *
 *   npx tsx scripts/inspect-package-sessions.ts --email=someone@example.com
 *   npx tsx scripts/inspect-package-sessions.ts --email=... --contact="שלמה"
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from 'path';

import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const load = async () => ({
  supabase: (await import('../lib/supabaseServer')).supabaseServer,
});

const arg = (name: string) => {
  const hit = process.argv.find(value => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

async function main() {
  const { supabase } = await load();
  const email = arg('email');
  const contactLike = arg('contact');

  if (!email) {
    console.error('Pass --email=owner@example.com');
    process.exit(1);
  }

  /* The owner. `auth.users` is the only place the email lives. */
  const { data: users, error: userError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (userError) throw userError;
  const owner = users.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (!owner) {
    console.error(`No user with that email. Found ${users.users.length} users.`);
    process.exit(1);
  }
  console.log(`owner: ${owner.email}  ${owner.id}\n`);

  /*
   * Does the column exist? PostgREST rejects the WHOLE select for one unknown
   * column, so naming it is the test — a clean read proves it is there.
   */
  const probe = await supabase
    .from('scheduling_meetings')
    .select('id, outcome_by, outcome_at, meeting_status')
    .limit(1);
  if (probe.error) {
    console.error(`scheduling_meetings.outcome_by is NOT readable: ${probe.error.message}`);
    console.error('Migration 20261078 is probably unrun. Stopping.');
    process.exit(1);
  }
  console.log('scheduling_meetings.outcome_by: present\n');

  /* The container bookings, which is what a package is. */
  let bookingQuery = supabase
    .from('scheduling_bookings')
    /* The name lives on the SERVICE and the person on the CONTACT — a booking
       carries only the ids, so both are joined rather than guessed at. */
    .select(
      'id, service_id, contact_id, status, meeting_status, outcome_by, start_time, created_at, ' +
        'service:scheduling_services(service_name), contact:crm_contacts(first_name, last_name)'
    )
    .eq('user_id', owner.id)
    .order('created_at', { ascending: false })
    .limit(60);

  /* Filtered in memory: the name is on the joined contact, not a column here. */

  const { data: bookings, error: bookingError } = await bookingQuery;
  if (bookingError) throw bookingError;

  if (!bookings?.length) {
    console.log('No bookings matched.');
    return;
  }

  const { data: meetings, error: meetingError } = await supabase
    .from('scheduling_meetings')
    .select(
      'id, booking_id, session_number, occurrence_number, start_time, end_time, meeting_status, outcome_by, outcome_at'
    )
    .in(
      'booking_id',
      bookings.map(b => b.id)
    )
    .order('start_time', { ascending: true });
  if (meetingError) throw meetingError;

  const byBooking = new Map<string, typeof meetings>();
  for (const m of meetings ?? []) {
    const list = byBooking.get(m.booking_id as string) ?? [];
    list.push(m);
    byBooking.set(m.booking_id as string, list);
  }

  const now = Date.now();

  const nameOf = (b: Record<string, any>) => {
    const c = Array.isArray(b.contact) ? b.contact[0] : b.contact;
    return [c?.first_name, c?.last_name].filter(Boolean).join(' ') || '?';
  };
  const serviceOf = (b: Record<string, any>) => {
    const s = Array.isArray(b.service) ? b.service[0] : b.service;
    return s?.service_name ?? '(no service)';
  };

  for (const booking of bookings) {
    if (contactLike && !nameOf(booking).includes(contactLike)) continue;
    const sessions = byBooking.get(booking.id) ?? [];
    /* Only packages are interesting here: one container, N sessions. */
    if (sessions.length === 0) continue;

    console.log(`── ${serviceOf(booking)} — ${nameOf(booking)}`);
    console.log(
      `   booking ${booking.id}  status=${booking.status}  meeting_status=${booking.meeting_status ?? 'null'}  outcome_by=${booking.outcome_by ?? 'null'}`
    );
    for (const s of sessions) {
      const start = s.start_time ? new Date(String(s.start_time)) : null;
      const past = start ? start.getTime() <= now : false;
      console.log(
        `   · #${s.session_number ?? '?'}  ${start ? start.toISOString().slice(0, 16) : 'no time'}` +
          `  ${past ? 'PAST ' : 'ahead'}  status=${s.meeting_status ?? 'null'}` +
          `  by=${s.outcome_by ?? 'null'}  ${s.id}`
      );
    }
    console.log('');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
