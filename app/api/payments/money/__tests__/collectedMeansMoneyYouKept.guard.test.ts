/**
 * A filter must answer the question its chip asks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS, AND WHY IT IS A SOURCE GUARD
 *
 * Two of these filters asked `item.status` — the value rolled up from an
 * order's ENTRIES — about questions the status cannot answer.
 *
 *   Collected  tested `['paid','partially_refunded','refunded'].includes(status)`.
 *              `refunded` is in that list, so an order paid and then returned
 *              IN FULL was listed under Collected, where the one thing it is
 *              not is collected. Measured 2026-11-08 against the live account:
 *              72 fully-refunded orders, every one of them listed there, among
 *              119 that genuinely had money retained.
 *
 *              The status cannot separate them. One value covers both a full
 *              return (nothing kept) and a row that merely HAS a refund on it;
 *              only the arithmetic tells them apart. `itemFlow().collected` is
 *              already net of refunds — the same figure the summary strip and
 *              every row bar use — so it is the exact question: did any of this
 *              money stay? A PARTIAL refund still has some and belongs here; a
 *              full one has none and belongs under Refunded.
 *
 *   Cancelled  tested `status === 'cancelled'`. A job called off AFTER its
 *              payment settled has its money in `refunded`, never in
 *              `cancelled`, so the booking was missing from this list entirely
 *              — while its own row printed "Cancelled". The page contradicted
 *              itself, and `bookingCancelled`, read from the booking rather
 *              than from its money, is the only thing that knows.
 *
 * A source guard for the reason `summaryTotals.guard` gives beside it: the
 * route's filtering is inline, the component renders whatever it is handed, and
 * the mutation that reintroduces either bug is a few characters that leave
 * every behavioural test green.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const route = fs.readFileSync(
  path.join(process.cwd(), 'app/api/payments/money/route.ts'),
  'utf8'
);

/** The `matchesFilter` body, whitespace and all. */
const matcher = route.slice(
  route.indexOf('function matchesFilter'),
  route.indexOf('\n}', route.indexOf('function matchesFilter')) + 2
);

describe('the money filters answer the question their chip asks', () => {
  it('has the matcher to read', () => {
    expect(matcher.length).toBeGreaterThan(0);
  });

  describe('Collected', () => {
    /** Everything between `case 'paid':` and the next `case`. */
    const paid = matcher.slice(
      matcher.indexOf("case 'paid':"),
      matcher.indexOf('case ', matcher.indexOf("case 'paid':") + 10)
    );

    it('asks what money was kept, not what the status is called', () => {
      expect(paid).toContain('itemFlow(item).collected > 0');
    });

    it('never decides it from the rolled-up status', () => {
      /*
       * The exact shape of the bug: `refunded` sitting in a list of statuses
       * that count as collected.
       */
      expect(paid).not.toMatch(/item\.status/);
      expect(paid).not.toMatch(/'refunded'/);
    });
  });

  describe('Cancelled', () => {
    const cancelled = matcher.slice(matcher.indexOf("case 'cancelled':"));

    it('includes a job called off after its money had settled', () => {
      /* Read from the booking, because the money says `refunded` there. */
      expect(cancelled).toContain('item.bookingCancelled');
    });

    it('still includes an order whose money itself was cancelled', () => {
      /* The original rule is kept, not replaced: a voided invoice rolls up to
         `cancelled` and has no booking-level cancellation behind it. */
      expect(cancelled).toContain("item.status === 'cancelled'");
    });
  });

  it('reads the collected figure from the one place that computes it', () => {
    /*
     * `itemFlow` is what the summary strip and every row bar already use. A
     * filter that recomputed "collected" here would be free to disagree with
     * the figure the reader just clicked, which is the fault
     * `moneyStatusTone`'s header describes in its own words: "the strip is also
     * the filter … which defeats the one thing a coloured filter is for."
     */
    expect(route).toMatch(/import \{[\s\S]*?\bitemFlow\b[\s\S]*?\} from '@\/lib\/payments\/moneyItems'/);
  });
});
