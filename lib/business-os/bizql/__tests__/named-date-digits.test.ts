/**
 * Telling a day the user NUMBERED from a day they NAMED, without a word list.
 *
 * "ביום רביעי" had no expressible form until weekday anchors existed, so the
 * planner worked a date out itself and got it wrong — told it was Monday 7
 * September it filtered on the 14th, a Monday; another run picked the 7th,
 * which is yesterday and not a Wednesday either. English used the anchor
 * reliably; Hebrew reached for YYYY-MM-DD every time.
 *
 * Catching that needs to know the message named a weekday, and the obvious way
 * to know is a per-language weekday table — the first hardcoded word list in a
 * system built to avoid them, with a new one owed to every language added.
 *
 * The digit is the signal instead. A numbered day carries one; a named day
 * never does, in any language. `validateAnswer` already compares digits against
 * the user's own message for the same reason.
 */

import { validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';

const filteringOn = (date: string): Plan =>
  ({
    steps: [
      {
        id: 's1',
        op: 'compute',
        entity: 'bookings',
        agg: { fn: 'count' },
        where: [{ field: 'start_time', op: 'gte', value: { $date: date } }],
      },
    ],
    answer: { text: 'You have {s1.count}.' },
  }) as Plan;

const complaint = (plan: Plan, message: string) =>
  validatePlan(plan, message).find((p) => p.includes('absolute YYYY-MM-DD'));

describe('a day the user named, with no number', () => {
  it.each([
    ['כמה פגישות יש לי ביום רביעי?', 'Hebrew'],
    ['how many meetings do I have on Wednesday?', 'English'],
    ['¿cuántas reuniones tengo el miércoles?', 'Spanish'],
  ])('rejects an absolute date for %p (%s)', (message) => {
    expect(complaint(filteringOn('2026-09-14'), message)).toBeDefined();
  });

  it('names the anchor, so the repair round can act on it', () => {
    // "No" is unactionable; the fix has to be in the message.
    expect(complaint(filteringOn('2026-09-14'), 'meetings on Wednesday')).toContain('wednesday');
  });

  it('rejects it in a written value too, not only in a filter', () => {
    // "change the due date to Wednesday" is the same mistake wearing a
    // different hat — and it would silently set the wrong day.
    const write = {
      steps: [
        {
          id: 's1',
          op: 'mutate',
          entity: 'tasks',
          action: 'update',
          target: { id: 'x' },
          data: { due_date: { $date: '2026-09-14' } },
        },
      ],
    } as unknown as Plan;

    expect(complaint(write, 'שנה תאריך יעד ליום רביעי')).toBeDefined();
  });
});

describe('a day the user numbered', () => {
  it.each([
    ['change the due date to 30 October', 'English'],
    ['שנה תאריך יעד ל 30 באוקטובר', 'Hebrew'],
    ['bookings on 3 March', 'a filter'],
  ])('allows an absolute date for %p (%s)', (message) => {
    expect(complaint(filteringOn('2026-10-30'), message)).toBeUndefined();
  });
});

describe('what the rule deliberately leaves alone', () => {
  it('says nothing about anchors — they are the encouraged form', () => {
    const anchored = {
      steps: [
        {
          id: 's1',
          op: 'compute',
          entity: 'bookings',
          agg: { fn: 'count' },
          where: [{ field: 'start_time', op: 'gte', value: { $date: 'wednesday' } }],
        },
      ],
      answer: { text: 'You have {s1.count}.' },
    } as unknown as Plan;

    expect(complaint(anchored, 'כמה פגישות יש לי ביום רביעי?')).toBeUndefined();
  });

  it('fails permissive when an unrelated digit is present', () => {
    /*
     * "for בדיקה 1" carries a digit the date could not have come from, so the
     * absolute date survives. A missed catch, not a false rejection — the
     * direction to fail in, since the alternative is refusing a legitimate plan.
     */
    expect(complaint(filteringOn('2026-09-14'), 'meetings on Wednesday for בדיקה 1')).toBeUndefined();
  });

  it('says nothing when there is no message to compare against', () => {
    // A stored plan being re-validated, or the eval harness: nothing to be
    // suspicious of, and rejecting it would break saved-plan re-runs.
    expect(
      validatePlan(filteringOn('2026-09-14')).find((p) => p.includes('absolute YYYY-MM-DD'))
    ).toBeUndefined();
  });
});
