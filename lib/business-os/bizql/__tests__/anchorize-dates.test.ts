/**
 * Putting the anchor back behind a date the model worked out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS BEING PROTECTED
 *
 * "How many bookings did I have this month" is answered by gpt-4o-mini with the
 * right query and a hand-computed date range. The digit rule rejects that — the
 * request names no number, so the date was invented — and two repair rounds do
 * not move the model. Measured over the generated corpus that was **18 of 40
 * failures**, the largest single class, and it took the `period` shape to 46%.
 *
 * The dates the model writes ARE anchors on today's clock, so this substitutes
 * them instead of arguing with the model about it. The tests below are mostly
 * about the LIMITS of that substitution, because a rewrite that fires when it
 * should not would silently change what a query means.
 *
 * The clock is frozen throughout: an anchor test that reads the wall clock is a
 * test that fails at midnight, on the 1st, or on a Sunday.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { anchorizeInventedDates } from '../dates';

/** A Tuesday, mid-month — so no two anchors collide by accident. */
const TUESDAY = new Date('2026-09-08T10:00:00Z');

const whereOn = (value: unknown) => ({
  steps: [{ id: 's1', op: 'compute', entity: 'bookings', where: [{ field: 'start_time', op: 'gte', value }] }],
});

const dateIn = (plan: ReturnType<typeof whereOn>) =>
  (plan.steps[0].where[0].value as { $date: string }).$date;

describe('with the clock on Tuesday 8 September 2026', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(TUESDAY));
  afterAll(() => jest.useRealTimers());

  it("turns this month's first day into start_of_month", () => {
    const plan = whereOn({ $date: '2026-09-01' });

    expect(anchorizeInventedDates(plan, 'how many bookings this month', 'UTC')).toBe(1);
    expect(dateIn(plan)).toBe('start_of_month');
  });

  it("turns today's date into today, not start_of_week", () => {
    // Both would resolve to the same rows this turn. `today` is what the model
    // meant, and it is the one that stays right when the plan is re-run.
    const plan = whereOn({ $date: '2026-09-08' });

    anchorizeInventedDates(plan, 'bookings from today', 'UTC');
    expect(dateIn(plan)).toBe('today');
  });

  it('turns the exclusive upper bound into tomorrow', () => {
    const plan = whereOn({ $date: '2026-09-09' });

    anchorizeInventedDates(plan, 'how many bookings this month', 'UTC');
    expect(dateIn(plan)).toBe('tomorrow');
  });

  it('reaches a day inside the coming week by its weekday name', () => {
    const plan = whereOn({ $date: '2026-09-11' }); // the coming Friday

    anchorizeInventedDates(plan, 'bookings until friday', 'UTC');
    expect(dateIn(plan)).toBe('friday');
  });

  it('rewrites every date in the plan and says how many', () => {
    const plan = {
      steps: [
        {
          id: 's1',
          op: 'compute',
          entity: 'bookings',
          where: [
            { field: 'start_time', op: 'gte', value: { $date: '2026-09-01' } },
            { field: 'start_time', op: 'lt', value: { $date: '2026-09-09' } },
          ],
        },
      ],
    };

    expect(anchorizeInventedDates(plan, 'how many bookings this month', 'UTC')).toBe(2);
    expect(JSON.stringify(plan)).toContain('start_of_month');
    expect(JSON.stringify(plan)).toContain('tomorrow');
  });

  describe('what it refuses to touch', () => {
    it('leaves a date alone when the request names a number', () => {
      /*
       * The whole safety argument. "on 30 October" was READ, not invented, and
       * rewriting it would turn a specific day into a moving one. Same trigger
       * as the digit rule, so the two can never disagree about which dates are
       * suspicious.
       */
      const plan = whereOn({ $date: '2026-09-01' });

      expect(anchorizeInventedDates(plan, 'bookings since 1 September', 'UTC')).toBe(0);
      expect(dateIn(plan)).toBe('2026-09-01');
    });

    it('leaves a date no anchor matches', () => {
      // Better a validation error the user can retry than a substitution that
      // means something else.
      const plan = whereOn({ $date: '2026-11-19' });

      expect(anchorizeInventedDates(plan, 'bookings in november', 'UTC')).toBe(0);
      expect(dateIn(plan)).toBe('2026-11-19');
    });

    it('leaves a date that already carries an offset', () => {
      // An offset means the model was already thinking relatively; rewriting
      // the base of its arithmetic is a guess too far.
      const plan = whereOn({ $date: '2026-09-01', offset: { days: 7 } });

      expect(anchorizeInventedDates(plan, 'bookings this month', 'UTC')).toBe(0);
      expect(dateIn(plan)).toBe('2026-09-01');
    });

    it('does nothing without a user message', () => {
      // A stored plan being re-validated, or a fixture. Nothing to be
      // suspicious of, and nothing to compare against.
      const plan = whereOn({ $date: '2026-09-01' });

      expect(anchorizeInventedDates(plan, undefined, 'UTC')).toBe(0);
    });
  });

  it('rewrites a date written into a mutate, not only a filter', () => {
    // A named day arrives as a written value as often as a filter value.
    const plan = {
      steps: [
        { id: 's1', op: 'mutate', entity: 'tasks', action: 'create', data: { due_date: { $date: '2026-09-09' } } },
      ],
    };

    expect(anchorizeInventedDates(plan, 'add a task for tomorrow', 'UTC')).toBe(1);
    expect(JSON.stringify(plan)).toContain('tomorrow');
  });
});

describe('on the first of the month', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-01T10:00:00Z')));
  afterAll(() => jest.useRealTimers());

  it('still prefers today over start_of_month', () => {
    /*
     * The day the two anchors collide. They return identical rows now and
     * diverge on the next run of a cached plan, so the order in
     * ANCHOR_PREFERENCE is what decides it — and the narrower claim is the
     * safer one.
     */
    const plan = whereOn({ $date: '2026-09-01' });

    anchorizeInventedDates(plan, 'bookings from today', 'UTC');
    expect(dateIn(plan)).toBe('today');
  });
});

describe('in a timezone ahead of UTC', () => {
  /*
   * 21:00 UTC on 8 September is already the 9th in Jerusalem. An anchorizer
   * that resolved anchors in UTC would decide "2026-09-09" is tomorrow for a
   * business whose today it already is — one day of error, silently, for
   * everyone east of Greenwich. Same class of bug as WEEKDAY_INDEX guards.
   */
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-08T21:00:00Z')));
  afterAll(() => jest.useRealTimers());

  it('resolves anchors in the business timezone', () => {
    const plan = whereOn({ $date: '2026-09-09' });

    anchorizeInventedDates(plan, 'bookings today', 'Asia/Jerusalem');
    expect(dateIn(plan)).toBe('today');
  });

  it('and the same instant is still tomorrow in UTC', () => {
    const plan = whereOn({ $date: '2026-09-09' });

    anchorizeInventedDates(plan, 'bookings today', 'UTC');
    expect(dateIn(plan)).toBe('tomorrow');
  });
});
