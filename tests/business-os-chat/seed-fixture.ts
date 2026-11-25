/**
 * The data the golden set names, on the account it is evaluated against.
 *
 *   npx tsx --import ./scripts/env-preload.ts tests/business-os-chat/seed-fixture.ts
 *   ... --user=<uuid>     seed a different account
 *   ... --check           report what is missing and write nothing
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Seven scenarios were failing for a reason that had nothing to do with the
 * chat: they named contacts the evaluated account does not have. Sorting the
 * suite's 26 failures showed three unrelated causes mixed together — real
 * defects, expectations that had gone stale, and this. A suite that reports all
 * three as one number is not a signal.
 *
 * WHY HEBREW NAMES SPECIFICALLY
 *
 * The account holds "Moshe David" and "Yael Omer" in Latin script. A Hebrew
 * request naming "משה" deliberately does NOT match them: cross-script matching
 * would mean deciding that "Moshe" and "משה" are the same person, which is a
 * guess at identity the whole resolver refuses to make. That refusal is correct
 * and tested elsewhere.
 *
 * So a Hebrew WRITE scenario needs a Hebrew-named contact, and this is an
 * Israeli product — dropping Hebrew write coverage to avoid seeding would be
 * giving up the coverage that matters most.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No bookings. The account already has real ones, and a scenario that needed
 * "a meeting today" was rewritten to ask about the week instead, which the
 * existing data answers. Inventing appointments in a real diary to satisfy a
 * test is the wrong trade.
 *
 * Rows are inserted DIRECTLY, never through a service. `createBooking` and its
 * relatives email the client and touch the calendar, which is exactly right for
 * a real booking and exactly wrong for a fixture.
 *
 * Idempotent: it matches on name and skips what is already there, so running it
 * twice does not produce duplicates.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabaseServer } from '@/lib/supabaseServer';

/** Marked so a human reading the CRM knows why these exist. */
const NOTE = 'Golden-set fixture (tests/business-os-chat). Safe to delete; the suite reseeds it.';

const CONTACTS = [
  {
    first_name: 'אופיר',
    last_name: 'עמר',
    email: 'fixture.ofir@example.invalid',
    phone: '0501111111',
    stage: 'customer',
    why: 'add-task-with-contact-he, add-task-date-and-priority-he, create-invoice-for-contact-he',
  },
  {
    first_name: 'יעל',
    last_name: 'עומר',
    email: 'fixture.yael@example.invalid',
    phone: '0502222222',
    stage: 'lead',
    why: 'update-contact-phone-he',
  },
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * TWO PEOPLE WITH ONE FIRST NAME, which is the whole point of them.
   *
   * The booking scenarios ask the agent to "book Tal". There are two, and the
   * only acceptable answer is to ask which — booking the wrong one emails a
   * stranger about an appointment they never made. A suite with one Tal in it
   * cannot tell a careful planner from a lucky one.
   *
   * Deliberately unalike in the ways the owner would use to tell them apart:
   * one is a customer with a history, the other a lead who has never booked.
   * ───────────────────────────────────────────────────────────────────────────
   */
  {
    first_name: 'Tal',
    last_name: 'Omer',
    email: 'fixture.tal.omer@example.invalid',
    phone: '0503333333',
    stage: 'customer',
    why: 'book-ambiguous-client, book-happy-path',
  },
  {
    first_name: 'Tal',
    last_name: 'Benton',
    email: 'fixture.tal.benton@example.invalid',
    phone: '0504444444',
    stage: 'lead',
    why: 'book-ambiguous-client',
  },
];

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE SERVICES A BOOKING REQUEST CAN MEAN.
 *
 * `is_scheduled` is the declared flag the rest of the platform reads as
 * `is_scheduled !== false` (clientJourney, intakeReach, businessShape,
 * journeyReadiness). It says whether this thing occupies an hour at all.
 *
 *   · one plainly scheduled, so "book Tal for a deep tissue" has an answer
 *   · two whose names both match "consult", so the agent must ask which —
 *     they differ in the two things that matter, duration and price
 *   · one that is not scheduled at all: a course. It still carries money, an
 *     intake form and a client journey; it simply has no hour, and the agent
 *     must not go looking for one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const SERVICES = [
  {
    service_name: 'Deep tissue massage',
    duration_minutes: 60,
    price: 300,
    is_scheduled: true,
    why: 'book-happy-path, book-ambiguous-client',
  },
  {
    service_name: 'Consult',
    duration_minutes: 30,
    price: 150,
    is_scheduled: true,
    why: 'book-ambiguous-service',
  },
  {
    service_name: 'Consult (extended)',
    duration_minutes: 90,
    price: 400,
    is_scheduled: true,
    why: 'book-ambiguous-service',
  },
  {
    service_name: 'Eight-week course',
    duration_minutes: null,
    price: 1200,
    is_scheduled: false,
    why: 'book-unscheduled-service',
  },
];

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}

async function main() {
  const check = process.argv.includes('--check');
  const userId = arg('user') ?? 'b509258d-0f79-43df-9ac0-0942086b0b58';

  const { data: existing, error } = await supabaseServer
    .from('crm_contacts')
    .select('first_name, last_name')
    .eq('user_id', userId);

  if (error) {
    console.error('could not read contacts:', error.message);
    process.exit(1);
  }

  const have = new Set(
    (existing ?? []).map((c) => `${(c as { first_name: string }).first_name} ${(c as { last_name: string }).last_name}`)
  );

  let written = 0;

  for (const contact of CONTACTS) {
    const name = `${contact.first_name} ${contact.last_name}`;

    if (have.has(name)) {
      console.log(`  ok      ${name}`);
      continue;
    }

    if (check) {
      console.log(`  MISSING ${name}   (needed by ${contact.why})`);
      continue;
    }

    const { error: insertError } = await supabaseServer.from('crm_contacts').insert({
      user_id: userId,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      phone: contact.phone,
      stage: contact.stage,
      source: 'fixture',
      notes: `${NOTE} Needed by: ${contact.why}`,
    });

    if (insertError) {
      console.error(`  FAILED  ${name}: ${insertError.message}`);
      process.exit(1);
    }

    console.log(`  seeded  ${name}   (${contact.why})`);
    written += 1;
  }

  /* ── the services those bookings are for ────────────────────────────── */

  const { data: haveServices, error: serviceError } = await supabaseServer
    .from('scheduling_services')
    .select('service_name')
    .eq('user_id', userId);

  if (serviceError) {
    console.error('could not read services:', serviceError.message);
    process.exit(1);
  }

  const named = new Set((haveServices ?? []).map((s) => (s as { service_name: string }).service_name));
  let services = 0;

  for (const service of SERVICES) {
    if (named.has(service.service_name)) {
      console.log(`  ok      ${service.service_name}`);
      continue;
    }

    if (check) {
      console.log(`  MISSING ${service.service_name}   (needed by ${service.why})`);
      continue;
    }

    const { error: insertError } = await supabaseServer.from('scheduling_services').insert({
      user_id: userId,
      service_name: service.service_name,
      duration_minutes: service.duration_minutes,
      price: service.price,
      /* The account's own currency is not this fixture's business; the
         scenarios assert on names and durations, never on a figure. */
      currency: 'ILS',
      is_scheduled: service.is_scheduled,
      status: 'active',
      is_active: true,
      source: 'fixture',
      description: `${NOTE} Needed by: ${service.why}`,
    });

    if (insertError) {
      console.error(`  FAILED  ${service.service_name}: ${insertError.message}`);
      process.exit(1);
    }

    console.log(`  seeded  ${service.service_name}   (${service.why})`);
    services += 1;
  }

  console.log(
    check
      ? '\ncheck only, nothing written'
      : `\n${written} contact(s) and ${services} service(s) seeded on ${userId}`
  );
}

void main();
