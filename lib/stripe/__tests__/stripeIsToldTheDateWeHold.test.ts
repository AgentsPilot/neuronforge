/**
 * The deadline Stripe shows the client is the one our invoice carries.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A COSMETIC DIFFERENCE
 *
 * Stripe is told a NUMBER OF DAYS, not a date, and the Stripe page is the copy
 * the client actually pays against. So the arithmetic that produces that number
 * decides what the client is asked to do, and any disagreement with our own
 * record is two different deadlines for one invoice — ours driving the overdue
 * chase, theirs driving the client.
 *
 * Two defects lived in one line:
 *
 *     days_until_due: Math.max(1, Math.ceil((dueDate - Date.now()) / 86400000))
 *
 *   · the raw millisecond division depended on the TIME OF DAY the invoice was
 *     raised. A due date two days out came to 2 at 21:00 and 3 at 06:00, so the
 *     same invoice raised in the morning fell due a day later at Stripe.
 *
 *   · the floor of 1 meant an invoice due TODAY was reported as due TOMORROW —
 *     the common case, not an edge: due-on-receipt, and anything billed when it
 *     is booked.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

import { wholeDaysUntil } from '@/lib/stripe/StripeInvoiceService';

const at = (iso: string) => new Date(iso);

describe('the day count ignores the clock', () => {
  it.each([
    ['06:00', '2026-11-06T06:00:00Z'],
    ['13:30', '2026-11-06T13:30:00Z'],
    ['21:00', '2026-11-06T21:00:00Z'],
    ['23:59', '2026-11-06T23:59:59Z'],
  ])('a due date two days out is 2 whether raised at %s', (_label, now) => {
    /*
     * THE BUG, AS ONE ASSERTION. Under the old millisecond division this
     * returned 2 or 3 depending purely on the hour.
     */
    expect(wholeDaysUntil(at('2026-11-08T12:00:00Z'), at(now))).toBe(2);
  });

  it('counts date boundaries, not elapsed time', () => {
    /* 23:59 to 00:01 is two minutes and one calendar day. */
    expect(wholeDaysUntil(at('2026-11-07T00:01:00Z'), at('2026-11-06T23:59:00Z'))).toBe(1);
  });
});

describe('today is today', () => {
  it('is 0 for a due date on the day it is raised', () => {
    expect(wholeDaysUntil(at('2026-11-06T12:00:00Z'), at('2026-11-06T09:00:00Z'))).toBe(0);
  });

  it('is negative for a date already past, so the clamp can see it', () => {
    expect(wholeDaysUntil(at('2026-11-01T12:00:00Z'), at('2026-11-06T09:00:00Z'))).toBe(-5);
  });
});

describe('what reaches Stripe', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'lib/stripe/StripeInvoiceService.ts'),
    'utf8'
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('floors at 0, never at 1', () => {
    /*
     * The whole point. `Math.max(1, …)` pushed every same-day invoice to
     * tomorrow on the document the client pays against.
     */
    expect(code).toContain('days_until_due: Math.max(0, wholeDaysUntil(dueDate))');
    expect(code).not.toMatch(/days_until_due:\s*Math\.max\(1/);
  });

  it('does the arithmetic through the shared counter, not inline', () => {
    /* An inline recalculation is how the two drifted apart the first time. */
    expect(code).not.toMatch(/days_until_due:[^\n]*86400000/);
    expect(code).not.toMatch(/days_until_due:[^\n]*1000 \* 60 \* 60 \* 24/);
  });

  it('still sends the days, not a due_date timestamp', () => {
    /*
     * Deliberate, and the reason is in the source: Stripe REFUSES a `due_date`
     * in the past, so expressing "due today" that way risks failing the invoice
     * outright rather than dating it wrongly. If someone switches to a
     * timestamp, that trade-off needs re-reading first.
     */
    expect(code).not.toMatch(/due_date:\s*Math\.floor/);
  });
});
