/**
 * What counts as a day worth writing to somebody about.
 *
 * `isQuietDay` is the only thing standing between a business and a daily email,
 * so each clause here is a decision about somebody's inbox rather than a unit
 * of logic. The one that matters most is the last: a day whose only news is
 * that two people got in touch used to be silent, which is the exact failure
 * this whole piece of work exists to fix.
 */

import { isQuietDay } from '../BriefingFactsService';
import type { BriefingFacts } from '../BriefingFactsService';

const noAppointments: BriefingFacts['appointments'] = {
  total: 0,
  cancelled: [],
} as unknown as BriefingFacts['appointments'];

const noMoney: BriefingFacts['money'] = {
  owed: [],
} as unknown as BriefingFacts['money'];

const outlook = (
  overrides: Partial<BriefingFacts['outlook']> = {}
): BriefingFacts['outlook'] => ({
  newLeads: { count: 0, people: [] },
  quotesWaiting: { count: 0, people: [] },
  quotesOut: { count: 0, people: [] },
  ...overrides,
});

describe('isQuietDay', () => {
  it('is quiet when genuinely nothing happened', () => {
    expect(isQuietDay(noAppointments, noMoney, outlook())).toBe(true);
  });

  it('is NOT quiet when somebody got in touch', () => {
    // The rule the owner asked for: two clients writing in must not be silent.
    const withLeads = outlook({
      newLeads: { count: 2, people: [{ name: 'Dana Levi' }, { name: 'Ben Cohen' }] },
    });
    expect(isQuietDay(noAppointments, noMoney, withLeads)).toBe(false);
  });

  it('is not quiet for a single enquiry either', () => {
    const oneLead = outlook({ newLeads: { count: 1, people: [{ name: 'Dana Levi' }] } });
    expect(isQuietDay(noAppointments, noMoney, oneLead)).toBe(false);
  });

  it('stays quiet for an appointment that is merely coming up', () => {
    /*
     * The rest of `outlook` is deliberately excluded. "Nothing happened today,
     * but you have someone on Wednesday" will be just as true tomorrow, and a
     * daily email that arrives on empty days gets unsubscribed — taking the
     * days that matter with it.
     */
    const withNext = outlook({
      next: { name: 'Ben Cohen', timeLocal: '09:00', dateLocal: 'Wednesday' },
    });
    expect(isQuietDay(noAppointments, noMoney, withNext)).toBe(true);
  });

  it('is not quiet when there are appointments, cancellations or money owed', () => {
    const busy = { total: 3, cancelled: [] } as unknown as BriefingFacts['appointments'];
    expect(isQuietDay(busy, noMoney, outlook())).toBe(false);

    const cancelled = {
      total: 0,
      cancelled: [{ name: 'Dana', timeLocal: '10:00' }],
    } as unknown as BriefingFacts['appointments'];
    expect(isQuietDay(cancelled, noMoney, outlook())).toBe(false);

    const owed = {
      owed: [{ name: 'Dana', amount: 200, currency: 'ILS', overdue: true }],
    } as unknown as BriefingFacts['money'];
    expect(isQuietDay(noAppointments, owed, outlook())).toBe(false);
  });

  it('is NOT quiet while somebody is waiting on a price', () => {
    // Only the owner can answer a quote request, so it stays owed until they do.
    const owed = outlook({ quotesWaiting: { count: 1, people: [{ name: 'Quote requested' }] } });
    expect(isQuietDay(noAppointments, noMoney, owed)).toBe(false);
  });
});
