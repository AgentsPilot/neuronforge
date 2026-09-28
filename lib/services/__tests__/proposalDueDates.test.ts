/**
 * When each stage of an accepted quote falls due.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The bug this guards: the cadence stepped a flat `{monthly: 30, quarterly: 91}`
 * days from the first due date. Weeks and fortnights really are 7 and 14 days, so
 * those were right — a month is not 30 days and a quarter is not 91. A
 * twelve-month plan accepted on the 15th billed its last stage on the 10th, and
 * every month in between had slipped further.
 *
 * `dueDatesFor` is the arithmetic the regular-service plan already uses, written
 * to match what Stripe does. Sharing it means a quote billed in instalments and a
 * service billed in instalments produce the same dates, which is what an owner
 * comparing the two expects.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { dueDateFor } from '../ProposalAcceptanceService';
import type { PaymentShape } from '@/lib/repositories/ProposalRepository';

const monthly = (count = 12): PaymentShape =>
  ({ kind: 'installments', count, frequency: 'monthly' }) as PaymentShape;

const weekly = (count = 4): PaymentShape =>
  ({ kind: 'installments', count, frequency: 'weekly' }) as PaymentShape;

const milestones: PaymentShape =
  ({ kind: 'milestones', stages: [{ label: 'Deposit', percent: 50 }, { label: 'End', percent: 50 }] }) as PaymentShape;

describe('dueDateFor', () => {
  describe('the anchor', () => {
    it('is the first due date itself for stage 1', () => {
      // Which is the acceptance day plus the agreed terms, decided by the caller.
      expect(dueDateFor(monthly(), 0, '2026-09-15')).toBe('2026-09-15');
    });

    it('never moves a milestone, whatever its index', () => {
      // A phase has no date at all. Only stage 1 is ever asked for, and it is the
      // anchor; anything else would be inventing a schedule nobody agreed to.
      expect(dueDateFor(milestones, 0, '2026-09-15')).toBe('2026-09-15');
      expect(dueDateFor(milestones, 2, '2026-09-15')).toBe('2026-09-15');
    });

    it('never moves a single payment', () => {
      expect(dueDateFor({ kind: 'single' } as PaymentShape, 1, '2026-09-15')).toBe('2026-09-15');
    });
  });

  describe('calendar months, not thirty days', () => {
    it('keeps the day of the month across a year', () => {
      // The whole point. On the old 30-day step this landed on 2027-09-10.
      expect(dueDateFor(monthly(), 12, '2026-09-15')).toBe('2027-09-15');
    });

    it('holds the day steady every month in between', () => {
      const days = Array.from({ length: 12 }, (_, i) =>
        dueDateFor(monthly(), i + 1, '2026-01-15').slice(8)
      );
      expect(new Set(days)).toEqual(new Set(['15']));
    });

    it('clamps into a short month rather than overflowing', () => {
      // 31 January + 1 month is 28 February, not 3 March — the rule `dueDatesFor`
      // documents, because it is what Stripe does.
      expect(dueDateFor(monthly(), 1, '2026-01-31')).toBe('2026-02-28');
    });

    it('finds the 29th in a leap February', () => {
      expect(dueDateFor(monthly(), 1, '2028-01-31')).toBe('2028-02-29');
    });

    it('returns to the anchor day after a clamped month', () => {
      // Clamping February must not drag March back with it.
      expect(dueDateFor(monthly(), 2, '2026-01-31')).toBe('2026-03-31');
    });

    it('crosses a year boundary', () => {
      expect(dueDateFor(monthly(), 3, '2026-11-20')).toBe('2027-02-20');
    });
  });

  describe('quarters', () => {
    it('steps three calendar months, not ninety-one days', () => {
      expect(dueDateFor({ kind: 'installments', count: 4, frequency: 'quarterly' } as PaymentShape, 1, '2026-09-15'))
        .toBe('2026-12-15');
    });
  });

  describe('weeks are still exactly weeks', () => {
    it('steps seven days', () => {
      expect(dueDateFor(weekly(), 1, '2026-09-15')).toBe('2026-09-22');
      expect(dueDateFor(weekly(), 3, '2026-09-15')).toBe('2026-10-06');
    });

    it('steps a fortnight', () => {
      expect(dueDateFor({ kind: 'installments', count: 4, frequency: 'biweekly' } as PaymentShape, 2, '2026-09-15'))
        .toBe('2026-10-13');
    });
  });

  it('never lands on the day before, west of UTC', () => {
    // Parsed at noon UTC precisely so a date-only string cannot roll backwards.
    expect(dueDateFor(monthly(), 1, '2026-09-01')).toBe('2026-10-01');
  });
});
