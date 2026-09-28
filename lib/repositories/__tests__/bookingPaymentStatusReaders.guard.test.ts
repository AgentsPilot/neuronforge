/**
 * `scheduling_bookings.payment_status` is only meaningful for a LIVE booking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS, AND WHY IT IS A TEST RATHER THAN A FIX
 *
 * Cancelling a booking deliberately does not rewrite `payment_status`, and it
 * cannot sensibly be made to. The column holds `pending | paid | refunded` and
 * there is no member meaning "nothing is owed any more":
 *
 *   · `paid` on a cancelled booking is TRUE — the business is still holding the
 *     money, and that is exactly what the refund paths read to let it back out.
 *   · `refunded` is TRUE.
 *   · `pending` is the only stale one, and adding a fourth value to fix it is
 *     the thing `syncBookingPaymentState` explicitly warns against: every
 *     reader compares against those three, so a fourth silently drops rows out
 *     of all of them.
 *
 * So the column is not wrong; it is CONDITIONAL. Every reader today already
 * honours that by filtering on `status` first — the briefing, the unpaid-booking
 * detector, the reuse lookup in the public booking route, the gaps. Nothing is
 * broken, and the risk is that the NEXT reader does not know the rule.
 *
 * This test is that rule, written down where it fails loudly: any query that
 * asks about `payment_status` on `scheduling_bookings` must also say which
 * bookings it means.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOTS = ['lib', 'app', 'components'];
const SKIP = new Set(['node_modules', '.next', '__tests__', 'dist', '.claude']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The lines of one `.from('scheduling_bookings')` query, as written. */
function bookingQueries(source: string): string[] {
  const blocks: string[] = [];
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    if (!line.includes("from('scheduling_bookings')")) return;
    /*
     * A generous window. A query chain is written one call per line and is
     * rarely more than a dozen; reading too far can only make this test more
     * forgiving, never less accurate about a missing filter.
     */
    blocks.push(lines.slice(i, i + 20).join('\n'));
  });

  return blocks;
}

const CONSTRAINS_STATUS =
  /\.(eq|in|neq|not)\(\s*'status'|\.eq\('id',|\.eq\(\s*`status`/;

describe('scheduling_bookings.payment_status readers', () => {
  it('never asks about payment_status without saying which bookings', () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, 'utf8');
        if (!source.includes('payment_status')) continue;

        for (const block of bookingQueries(source)) {
          const asksAboutPayment = /\.(eq|in|neq)\(\s*'payment_status'/.test(block);
          if (!asksAboutPayment) continue;
          if (CONSTRAINS_STATUS.test(block)) continue;
          offenders.push(`${file}: a payment_status filter with no status filter beside it`);
        }
      }
    }

    /*
     * If this fails, the fix is almost never to change `payment_status` — it is
     * to say which bookings the new query means. A cancelled booking can carry
     * any of the three values and none of them describes a cancellation.
     */
    expect(offenders).toEqual([]);
  });
});
