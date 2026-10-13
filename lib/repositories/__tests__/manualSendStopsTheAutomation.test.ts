/**
 * An owner who chases by hand is not chased again by the platform.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DUPLICATE
 *
 * `chase_intake` and the owner's own Send button call the same function with
 * the same arguments. Nothing connected them:
 *
 *   · the sweep's dedup reads `lead_responses`, and the manual path wrote
 *     nothing there
 *   · the gap only clears when the client RETURNS the form — chasing does not
 *     clear it
 *
 * So the owner chased on Tuesday morning, the sweep came due that night, found
 * the form still outstanding, and the client got the same reminder twice from
 * one business. It is the shape the registry already records for invoices:
 * "neither path aware of the other, because they dedupe in different tables."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THE FIX SOUND RATHER THAN CAREFUL
 *
 * The row is written against `lead_responses_one_per_thing`, a real
 * UNIQUE (kind, contact_id, entity_id) in the database. The sweep's enqueue
 * becomes a no-op whether or not anybody remembers to call `hasRowFor` first,
 * so the guarantee is the constraint and not the caller.
 *
 * And it is written ALREADY CLOSED. An enqueue-then-mark would leave the row
 * `pending` for a moment, and a drain in that moment would send the very email
 * this exists to prevent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

import { LeadResponseRepository } from '../LeadResponseRepository';

const BOOKING = 'b1111111-1111-4111-8111-111111111111';
const CONTACT = 'c1111111-1111-4111-8111-111111111111';

/** Captures what reached the table, and what options it was written with. */
function client(error: Error | null = null) {
  const upsert = jest.fn().mockResolvedValue({ error });
  return {
    spy: upsert,
    db: { from: () => ({ upsert }) } as never,
  };
}

const repoWith = (c: ReturnType<typeof client>) => new LeadResponseRepository(c.db);

describe('what it writes', () => {
  it('records the send against the booking, not just the contact', async () => {
    const c = client();

    await repoWith(c).recordManualSend({
      userId: 'u1',
      contactId: CONTACT,
      kind: 'intake_chase',
      entityId: BOOKING,
    });

    const [row] = c.spy.mock.calls[0];
    expect(row).toMatchObject({
      kind: 'intake_chase',
      contact_id: CONTACT,
      entity_id: BOOKING,
      user_id: 'u1',
    });
  });

  /*
   * The whole point. `enqueue` writes `pending`, and a drain between that and a
   * `markSent` would claim the row and send the email this prevents.
   */
  it('writes it already closed, so no drain can ever claim it', async () => {
    const c = client();

    await repoWith(c).recordManualSend({ userId: 'u1', contactId: CONTACT, kind: 'intake_chase', entityId: BOOKING });

    const [row] = c.spy.mock.calls[0];
    expect(row.status).toBe('sent');
    expect(row.sent_at).toBeTruthy();
  });

  /*
   * Matching the constraint column for column is what makes the sweep's
   * enqueue a no-op. A different conflict target would insert a second row and
   * the automation would send anyway.
   */
  it('targets the same unique key the sweep upserts against', async () => {
    const c = client();

    await repoWith(c).recordManualSend({ userId: 'u1', contactId: CONTACT, kind: 'intake_chase', entityId: BOOKING });

    const [, options] = c.spy.mock.calls[0];
    expect(options).toMatchObject({
      onConflict: 'kind,contact_id,entity_id',
      ignoreDuplicates: true,
    });
  });

  /* The contact stands in where a kind is one-per-person, as `enqueue` does. */
  it('falls back to the contact when there is no entity', async () => {
    const c = client();

    await repoWith(c).recordManualSend({ userId: 'u1', contactId: CONTACT, kind: 'invite' });

    expect(c.spy.mock.calls[0][0].entity_id).toBe(CONTACT);
  });
});

describe('when it cannot be written', () => {
  /*
   * The email has already gone by the time this runs. Throwing would report a
   * send that happened as a failure, and the cost of swallowing it is one
   * duplicate reminder — strictly the better of the two.
   */
  it('does not throw, because the send already happened', async () => {
    const c = client(new Error('connection reset'));

    await expect(
      repoWith(c).recordManualSend({ userId: 'u1', contactId: CONTACT, kind: 'intake_chase', entityId: BOOKING })
    ).resolves.toBeUndefined();
  });
});

describe('the manual route calls it', () => {
  /*
   * Source-level, because the route is a Next handler over four repositories
   * and the thing worth pinning is the ORDER: after a confirmed send, never
   * before. A failed chase must not suppress the automation that would have
   * covered for it.
   */
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', '..', 'app', 'api', 'scheduling', 'bookings', '[id]', 'intake', 'route.ts'),
    'utf8'
  );

  it('records the send', () => {
    expect(source).toContain("kind: 'intake_chase'");
    expect(source).toContain('recordManualSend');
  });

  it('does it only after the send succeeded', () => {
    const failure = source.indexOf('if (!emailResult.sent)');
    const record = source.indexOf('recordManualSend');

    expect(failure).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(failure);
  });

  /*
   * Awaited, not fired and forgotten: the sweep runs every five minutes and a
   * race with it is precisely what is being prevented.
   */
  it('waits for it rather than letting the response outrun the write', () => {
    expect(source).toMatch(/await leadResponseRepository\.recordManualSend/);
  });
});
