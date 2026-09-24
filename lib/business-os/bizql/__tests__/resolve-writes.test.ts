/**
 * Resolving a plan's writes, and being able to stop halfway.
 *
 * `resolveWrites` is the loop that turns "David's booking" into a literal row
 * id. What makes it worth its own file is that it has to be RE-ENTERABLE: it
 * runs until the first row it cannot pin to one candidate, hands back everything
 * it has, and is called again after the user says which one they meant.
 *
 * The property these tests exist to protect is that re-entry costs nothing and
 * changes nothing. A step already pinned must not be looked up a second time —
 * not for cost, but because looking the same description up again is how a user
 * approves one row and a different one gets written.
 */

import { pinChoice, resolveWrites } from '../mutate/resolveWrites';
import type { MutateQuery } from '../types';

const USER = '11111111-1111-1111-1111-111111111111';
const CTX = { userId: USER, timezone: 'UTC', consumer: 'test' as const };

const rows: Record<string, unknown[]> = {};
const lookups: string[] = [];

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

jest.mock('../compiler', () => ({
  compileAndRunFind: jest.fn(async (_client: unknown, query: { entity: string; limit?: number }) => {
    lookups.push(query.entity);
    return {
      op: 'find',
      entity: query.entity,
      rows: (rows[query.entity] ?? []).slice(0, query.limit ?? 50),
      truncated: false,
    };
  }),
}));

const CONTACT_A = '22222222-0000-0000-0000-000000000001';
const CONTACT_B = '22222222-0000-0000-0000-000000000002';
const BOOKING_A = '33333333-0000-0000-0000-000000000001';

/** "Cancel David's booking" — a described target on bookings. */
const cancelBooking = (value: string): MutateQuery =>
  ({
    id: 's1',
    op: 'mutate',
    entity: 'bookings',
    action: 'cancel',
    target: { find: { where: [{ field: 'contact_name', op: 'eq', value }] } },
  }) as MutateQuery;

/** "Create a task for David" — a described foreign key, no target. */
const taskFor = (value: string): MutateQuery =>
  ({
    id: 's1',
    op: 'mutate',
    entity: 'tasks',
    action: 'create',
    data: {
      title: 'Call back',
      contact_id: { $find: { where: [{ field: 'first_name', op: 'eq', value }] } },
    },
  }) as unknown as MutateQuery;

beforeEach(() => {
  for (const key of Object.keys(rows)) delete rows[key];
  lookups.length = 0;
});

describe('resolving the writes in a plan', () => {
  it('pins a unique target and reports it resolved', async () => {
    rows.bookings = [{ id: BOOKING_A, contact_name: 'David Cohen' }];

    const outcome = await resolveWrites({
      steps: [cancelBooking('David Cohen')],
      ctx: CTX,
      language: 'en',
      currency: 'USD',
    });

    expect(outcome.status).toBe('resolved');
    if (outcome.status !== 'resolved') return;
    expect((outcome.writes[0].step as MutateQuery).target).toEqual({ id: BOOKING_A });
  });

  it('stops at an ambiguous target and hands back what it has', async () => {
    rows.bookings = [
      { id: BOOKING_A, contact_name: 'David Cohen' },
      { id: '33333333-0000-0000-0000-000000000002', contact_name: 'David Levy' },
    ];

    const outcome = await resolveWrites({
      steps: [cancelBooking('David')],
      ctx: CTX,
      language: 'en',
      currency: 'USD',
    });

    expect(outcome.status).toBe('choice');
    if (outcome.status !== 'choice') return;
    expect(outcome.kind).toBe('ambiguous');
    expect(outcome.entity).toBe('bookings');
    expect(outcome.slot).toEqual({ kind: 'target', stepIndex: 0 });
    expect(outcome.candidates).toHaveLength(2);
    expect(outcome.candidates.map((c) => c.id)).toEqual([
      BOOKING_A,
      '33333333-0000-0000-0000-000000000002',
    ]);
    // 1-based, because "the second one" counts the way the list is rendered.
    expect(outcome.candidates.map((c) => c.index)).toEqual([1, 2]);
  });

  it('names the REFERENCE entity, not the step entity, when the FK is ambiguous', async () => {
    // "create a task for David" with two Davids: the question is about contacts,
    // and answering it with "which task?" would be answering a different one.
    rows.contacts = [
      { id: CONTACT_A, first_name: 'David', last_name: 'Cohen' },
      { id: CONTACT_B, first_name: 'David', last_name: 'Levy' },
    ];

    const outcome = await resolveWrites({
      steps: [taskFor('David')],
      ctx: CTX,
      language: 'en',
      currency: 'USD',
    });

    expect(outcome.status).toBe('choice');
    if (outcome.status !== 'choice') return;
    expect(outcome.entity).toBe('contacts');
    expect(outcome.slot).toEqual({ kind: 'reference', stepIndex: 0, field: 'contact_id' });
  });

  it('carries seeded names through a step it does not re-resolve', async () => {
    const pinned = {
      id: 's1',
      op: 'mutate',
      entity: 'bookings',
      action: 'cancel',
      target: { id: BOOKING_A },
    } as MutateQuery;

    const outcome = await resolveWrites({
      steps: [pinned],
      ctx: CTX,
      language: 'en',
      currency: 'USD',
      names: [{ targetName: 'David Cohen — Tue 10:00' }],
    });

    expect(outcome.status).toBe('resolved');
    if (outcome.status !== 'resolved') return;

    // The name survives the gap, and NOTHING was looked up to recover it.
    // Re-querying it is how a card previewed as one person is applied to
    // another.
    expect(outcome.writes[0].targetName).toBe('David Cohen — Tue 10:00');
    expect(lookups).toEqual([]);
  });

  it('does not re-resolve a foreign key that already holds an id', async () => {
    const pinned = {
      id: 's1',
      op: 'mutate',
      entity: 'tasks',
      action: 'create',
      data: { title: 'Call back', contact_id: CONTACT_A },
    } as unknown as MutateQuery;

    const outcome = await resolveWrites({
      steps: [pinned],
      ctx: CTX,
      language: 'en',
      currency: 'USD',
      names: [{ referenceNames: { contact_id: 'David Cohen' } }],
    });

    expect(outcome.status).toBe('resolved');
    if (outcome.status !== 'resolved') return;
    expect(outcome.writes[0].referenceNames).toEqual({ contact_id: 'David Cohen' });
    expect(lookups).toEqual([]);
  });

  it('round-trips a step that carries no id of its own', async () => {
    // The slot is keyed by array index precisely because `MutateQuery.id` is
    // optional — a plan without one must still be resumable.
    const noId = {
      op: 'mutate',
      entity: 'bookings',
      action: 'cancel',
      target: { find: { where: [{ field: 'contact_name', op: 'eq', value: 'David' }] } },
    } as MutateQuery;

    rows.bookings = [
      { id: BOOKING_A, contact_name: 'David Cohen' },
      { id: '33333333-0000-0000-0000-000000000002', contact_name: 'David Levy' },
    ];

    const outcome = await resolveWrites({
      steps: [noId],
      ctx: CTX,
      language: 'en',
      currency: 'USD',
    });

    expect(outcome.status).toBe('choice');
    if (outcome.status !== 'choice') return;
    expect(outcome.slot).toEqual({ kind: 'target', stepIndex: 0 });

    const pinnedSteps = pinChoice(outcome.steps, outcome.slot, BOOKING_A);
    expect((pinnedSteps[0] as MutateQuery).target).toEqual({ id: BOOKING_A });
  });
});

describe('asking one slot at a time', () => {
  it('reports the reference first, then the target on the next pass', async () => {
    /*
     * "Move David's booking" where both halves are ambiguous. Two questions, in
     * a fixed order — references before targets — because the order must not
     * depend on which pass you happen to be on.
     */
    const step = {
      id: 's1',
      op: 'mutate',
      entity: 'bookings',
      action: 'reschedule',
      data: {
        contact_id: { $find: { where: [{ field: 'first_name', op: 'eq', value: 'David' }] } },
      },
      target: { find: { where: [{ field: 'contact_name', op: 'eq', value: 'David' }] } },
    } as unknown as MutateQuery;

    rows.contacts = [
      { id: CONTACT_A, first_name: 'David', last_name: 'Cohen' },
      { id: CONTACT_B, first_name: 'David', last_name: 'Levy' },
    ];
    rows.bookings = [
      { id: BOOKING_A, contact_name: 'David Cohen' },
      { id: '33333333-0000-0000-0000-000000000002', contact_name: 'David Levy' },
    ];

    const first = await resolveWrites({
      steps: [step],
      ctx: CTX,
      language: 'en',
      currency: 'USD',
    });

    expect(first.status).toBe('choice');
    if (first.status !== 'choice') return;
    expect(first.slot).toEqual({ kind: 'reference', stepIndex: 0, field: 'contact_id' });

    const second = await resolveWrites({
      steps: pinChoice(first.steps, first.slot, CONTACT_A),
      ctx: CTX,
      language: 'en',
      currency: 'USD',
      names: first.names,
    });

    expect(second.status).toBe('choice');
    if (second.status !== 'choice') return;
    expect(second.slot).toEqual({ kind: 'target', stepIndex: 0 });
    expect(second.entity).toBe('bookings');
  });
});

describe('pinChoice', () => {
  it('writes the id into the target and leaves everything else alone', () => {
    const steps = [cancelBooking('David'), cancelBooking('Sarah')];
    const pinned = pinChoice(steps, { kind: 'target', stepIndex: 1 }, BOOKING_A);

    expect((pinned[1] as MutateQuery).target).toEqual({ id: BOOKING_A });
    // Untouched, and still the same object — a pick answers ONE question.
    expect(pinned[0]).toBe(steps[0]);
  });

  it('writes the id into the named field for a reference slot', () => {
    const steps = [taskFor('David')];
    const pinned = pinChoice(
      steps,
      { kind: 'reference', stepIndex: 0, field: 'contact_id' },
      CONTACT_B
    );

    const data = (pinned[0] as MutateQuery).data as Record<string, unknown>;
    expect(data.contact_id).toBe(CONTACT_B);
    // The values the user actually supplied survive the pin.
    expect(data.title).toBe('Call back');
  });
});
