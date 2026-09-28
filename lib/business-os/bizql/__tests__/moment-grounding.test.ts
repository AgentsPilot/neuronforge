/**
 * A date the user gave is not a date the model invented.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED BY THE USER.
 *
 *   "what meeting I have today?"     -> Eyal Omer, 10:00 AM - 10:15 AM, Intro
 *   "update start time to 11:00am"   -> [failed]
 *
 * Two guards fired on a request that was complete, and each on its own was
 * enough to stop it.
 *
 * ONE. The groundedness check — "a required text value must be traceable to
 * words the user actually said" — was written for prose a model composes, and a
 * resolved datetime is a string, so it got the same treatment. "11:00am" becomes
 * `2026-09-24T11:00:00.000Z`, whose tokens are 2026, 09, 24t11, 000z. None of
 * those were typed by the user, and none ever would be. So a time supplied as
 * plainly as a time can be supplied was reported MISSING.
 *
 * Worse than one bad turn: the fill loop then asks for the field, the reply is
 * parsed into another ISO string, and that one is ungrounded too. Accumulating
 * the reply into the utterance — the fix that ends this loop for text — cannot
 * help, because no way of saying a time contains the year.
 *
 * TWO. `reschedule` required `end_time` as well, so moving a 15-minute intro
 * call asked the owner when it would finish, while they were looking at a card
 * that said 10:00 to 10:15.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { executeMutate, isGroundedIn } from '../mutate/MutateExecutor';
import { CATALOG } from '@/lib/business-os/catalog';
import type { MutateQuery } from '../types';

const CTX = { userId: '11111111-1111-1111-1111-111111111111', consumer: 'test' as const };

const BOOKING = '33333333-0000-0000-0000-000000000001';

const moveTo11 = (data: Record<string, unknown>): MutateQuery =>
  ({
    id: 's1',
    op: 'mutate',
    entity: 'bookings',
    action: 'reschedule',
    target: { id: BOOKING },
    data,
  }) as unknown as MutateQuery;

describe('the shape of the problem', () => {
  it('an ISO datetime can never be grounded in how a person says the time', () => {
    // Not a near miss to be tuned — the year and the seconds are simply not in
    // any phrasing of "11am", in any language.
    expect(isGroundedIn('2026-09-24T11:00:00.000Z', 'update start time to 11:00am')).toBe(false);
    expect(isGroundedIn('2026-09-24T11:00:00.000Z', 'תעדכן את השעה ל-11:00')).toBe(false);
  });
});

describe('moving a booking', () => {
  it('accepts a resolved start time as supplied', async () => {
    // The dry run validates and describes without touching anything, so reaching
    // a preview IS the assertion: the required-field gate let it through.
    const result = await executeMutate(moveTo11({ start_time: '2026-09-24T11:00:00.000Z' }), CTX, {
      dryRun: true,
      utterance: 'update start time to 11:00am',
    });

    expect(result.preview).toBeTruthy();
  });

  it('does not ask when the appointment finishes', async () => {
    // The end follows the start. `rescheduleBooking` loads the booking before it
    // does anything, so the existing duration is already in hand — a required
    // field the system can read for itself is a question that should not be
    // asked.
    expect(CATALOG.entities.bookings?.actions?.reschedule?.requiredFields).toEqual(['start_time']);
  });

  it('still lets the length be changed when it is stated', async () => {
    const result = await executeMutate(
      moveTo11({ start_time: '2026-09-24T11:00:00.000Z', end_time: '2026-09-24T12:00:00.000Z' }),
      CTX,
      { dryRun: true, utterance: 'move it to 11 and make it an hour' }
    );

    expect(result.preview).toBeTruthy();
  });

  it('still refuses a move with no time at all', async () => {
    // The exemption is about WHERE a value came from, not about whether one is
    // needed. A blank required field is still missing.
    await expect(
      executeMutate(moveTo11({ start_time: '' }), CTX, {
        dryRun: true,
        utterance: 'reschedule that booking',
      })
    ).rejects.toMatchObject({ name: 'MissingFieldsError', fields: ['start_time'] });
  });
});

describe('the guard still does its job on text', () => {
  it('rejects a title the model composed rather than heard', async () => {
    // The bug the groundedness check was written for: "הוסף משימה למשה" produced
    // a task titled "משימה חדשה" ("new task"). Nothing here loosens that.
    await expect(
      executeMutate(
        { op: 'mutate', entity: 'tasks', action: 'create', data: { title: 'new task' } } as MutateQuery,
        CTX,
        { dryRun: true, utterance: 'add a task for Moshe' }
      )
    ).rejects.toMatchObject({ name: 'MissingFieldsError', fields: ['title'] });
  });
});
