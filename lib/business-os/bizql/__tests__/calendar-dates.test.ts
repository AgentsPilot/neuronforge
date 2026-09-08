/**
 * Naming a day, as opposed to describing one.
 *
 * The anchors cover everything relative to now, which is most questions. They
 * cannot express a day the user simply names — and "set the due date to 30
 * October" is an ordinary thing to ask. Asked exactly that, the planner emitted
 * {"$date":"2023-10-30"}: it broke the rule saying never to hardcode a date,
 * because the alternative was being unable to answer, and it picked a year three
 * in the past because nothing had told it what today is.
 */

import { resolveDateExpr } from '../dates';
import { isIsoCalendarDate, BizQLValidationError, type DateExpr } from '../types';
import { namesACalendarDay } from '../cache/PlanCache';

describe('recognising a calendar date', () => {
  it.each(['2026-10-30', '2026-01-01', '2024-02-29'])('accepts %p', (value) => {
    expect(isIsoCalendarDate(value)).toBe(true);
  });

  it.each([
    ['2026-13-01', 'month 13'],
    ['2026-02-31', '31 February'],
    ['2023-02-29', '29 February in a non-leap year'],
    ['2026-1-1', 'unpadded'],
    ['26-10-30', 'two-digit year'],
    ['today', 'an anchor'],
    ['30 October', 'prose'],
    ['', 'empty'],
  ])('rejects %p (%s)', (value) => {
    /*
     * Strictness is the point. `new Date('2026-02-31')` rolls over into March
     * without complaining, so a lenient check would let a due date land in a
     * different month than the one the user said — wrong in a way nobody
     * notices until the day passes.
     */
    expect(isIsoCalendarDate(value)).toBe(false);
  });
});

describe('resolving a named day', () => {
  it('resolves to that day for a date column', () => {
    expect(resolveDateExpr({ $date: '2026-10-30' } as DateExpr, 'Asia/Jerusalem', 'date')).toBe(
      '2026-10-30'
    );
  });

  it('reads the day in the business timezone, not the server one', () => {
    // Midnight on the 30th in Jerusalem is still the 29th in UTC. The rendered
    // instant must be the start of the named day WHERE THE BUSINESS IS.
    const asInstant = resolveDateExpr(
      { $date: '2026-10-30' } as DateExpr,
      'Asia/Jerusalem',
      'datetime'
    );

    expect(
      resolveDateExpr({ $date: '2026-10-30' } as DateExpr, 'Asia/Jerusalem', 'date')
    ).toBe('2026-10-30');
    expect(new Date(asInstant).toISOString()).toBe(asInstant);
  });

  it('still accepts an offset, sharing the anchors arithmetic', () => {
    expect(
      resolveDateExpr({ $date: '2026-10-30', offset: { days: 2 } } as DateExpr, 'UTC', 'date')
    ).toBe('2026-11-01');
  });

  it('clamps a month offset the same way an anchor does', () => {
    // 31 Jan + 1 month is the last day of February, not 3 March.
    expect(
      resolveDateExpr({ $date: '2026-01-31', offset: { months: 1 } } as DateExpr, 'UTC', 'date')
    ).toBe('2026-02-28');
  });

  it('still rejects an invented anchor by name', () => {
    // The reason the anchor list is closed: `last_7_days` once fell through to
    // `today` and a weekly report read "0 new leads" as a quiet week.
    expect(() => resolveDateExpr({ $date: 'last_7_days' } as unknown as DateExpr, 'UTC')).toThrow(
      BizQLValidationError
    );
  });

  it('rejects a malformed date rather than rolling it over', () => {
    expect(() => resolveDateExpr({ $date: '2026-02-31' } as DateExpr, 'UTC')).toThrow(
      BizQLValidationError
    );
  });
});

describe('keeping named days out of the plan cache', () => {
  /*
   * An anchor resolves at execution and stays correct forever. A named day is a
   * literal, and the utterance it came from ("30 October") has no year in it, so
   * rehydration cannot correct it. Cached, the same plan would set a due date in
   * the past when it is served again next year.
   */
  it('spots a named day in a filter', () => {
    expect(
      namesACalendarDay({
        steps: [{ op: 'find', where: [{ field: 'due_date', value: { $date: '2026-10-30' } }] }],
      })
    ).toBe(true);
  });

  it('spots a named day in written DATA, not just a filter', () => {
    // The case that actually prompted this — a write, not a query.
    expect(
      namesACalendarDay({
        steps: [{ op: 'mutate', data: { due_date: { $date: '2026-10-30' } } }],
      })
    ).toBe(true);
  });

  it('leaves anchor-only plans cacheable', () => {
    expect(
      namesACalendarDay({
        steps: [
          { op: 'find', where: [{ field: 'due_date', value: { $date: 'today', offset: { days: 7 } } }] },
        ],
      })
    ).toBe(false);
  });

  it('is not fooled by an ordinary string that looks nothing like a date', () => {
    expect(namesACalendarDay({ steps: [{ data: { title: 'call David' } }] })).toBe(false);
  });
});
