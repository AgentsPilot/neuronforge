/**
 * People who started a booking, never finished it, and never booked since.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT JUST `status = 'abandoned'`
 *
 * Two reasons, and both of them would inflate the figure.
 *
 * FIRST, the row is an ATTEMPT, not a person. A client who retries a card
 * journey five times before giving up leaves five rows — measured on live data
 * 2026-10-29: 6 abandoned rows belonging to 3 people. Counting rows would put
 * "6 people walked away" on a card beside figures that all count contacts, and
 * the owner would go looking for four people who do not exist.
 *
 * SECOND, an abandonment is not a loss if they came back. Of those 3 people,
 * every one had since booked — they gave up on one journey and completed
 * another, which is a recovered client rather than lost business. The honest
 * count on that account is 0, and a card reading 3 would send an owner chasing
 * people who are already customers.
 *
 * So: distinct people, minus anyone who has a booking with this business.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT DEPENDS ON THE SWEEPER BEING HONEST
 *
 * `status` is only as good as what writes it. Until 2026-10-29 `sweepAbandoned`
 * marked anything still `started` past the window as abandoned without checking
 * whether the booking had happened, so 8 of 14 rows were people who HAD
 * finished — through a path that never called `convertAttempt`. A count built
 * on that would have read 14 where the truth was 6.
 *
 * That is fixed at the source rather than worked around here: this reads
 * `status` and trusts it, because the sweeper now earns that trust. If this
 * figure ever looks too high again, suspect the sweeper first.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'abandonedContacts' });

/**
 * How many people abandoned a booking with `userId` and have never booked.
 *
 * Three reads, none of them per-person. Fails SOFT at zero: a card showing
 * nothing is a quiet state an owner can ignore, while one showing a wrong
 * number is work they will go and do.
 *
 * @param userId CLAUDE.md rule 4, on all three.
 */
export async function abandonedContactCount(
  client: SupabaseClient,
  userId: string
): Promise<number> {
  const { data: attempts, error: attemptError } = await client
    .from('abandoned_bookings')
    .select('email')
    .eq('user_id', userId)
    .eq('status', 'abandoned');

  if (attemptError) {
    logger.error({ err: attemptError, userId }, 'Could not read abandoned attempts');
    return 0;
  }

  /* One entry per person, however many times they tried. */
  const emails = new Set(
    (attempts ?? [])
      .map(row => ((row as { email: string | null }).email ?? '').trim().toLowerCase())
      .filter(Boolean)
  );

  if (emails.size === 0) return 0;

  const { data: contacts, error: contactError } = await client
    .from('crm_contacts')
    .select('id, email')
    .eq('user_id', userId)
    .in('email', [...emails]);

  if (contactError) {
    logger.error({ err: contactError, userId }, 'Could not match abandoned attempts to contacts');
    return 0;
  }

  /*
   * Somebody who never became a contact certainly never booked, so the default
   * is "has not booked" and only a real booking removes them.
   */
  const contactsByEmail = new Map<string, string[]>();
  for (const row of contacts ?? []) {
    const c = row as { id: string; email: string | null };
    const key = (c.email ?? '').trim().toLowerCase();
    if (!key) continue;
    const held = contactsByEmail.get(key);
    if (held) held.push(c.id);
    else contactsByEmail.set(key, [c.id]);
  }

  const contactIds = [...contactsByEmail.values()].flat();

  if (contactIds.length === 0) return emails.size;

  const { data: booked, error: bookingError } = await client
    .from('scheduling_bookings')
    .select('contact_id')
    .eq('user_id', userId)
    .in('contact_id', contactIds);

  if (bookingError) {
    logger.error({ err: bookingError, userId }, 'Could not check whether abandoners later booked');
    return 0;
  }

  const hasBooked = new Set(
    (booked ?? [])
      .map(row => (row as { contact_id: string | null }).contact_id)
      .filter((id): id is string => Boolean(id))
  );

  let neverBooked = 0;
  for (const email of emails) {
    const ids = contactsByEmail.get(email) ?? [];
    /* Any booking under any contact row sharing that address counts — a
       duplicate contact is a CRM artefact, not a second person. */
    if (!ids.some(id => hasBooked.has(id))) neverBooked++;
  }

  return neverBooked;
}
