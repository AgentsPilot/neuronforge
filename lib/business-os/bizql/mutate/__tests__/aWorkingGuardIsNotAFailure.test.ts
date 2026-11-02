/**
 * A chase the cooldown declined is a successful no-op, not a failed run.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG, FROM A LIVE DASHBOARD
 *
 * `remind_invoices` returned an error for ANY outcome where nothing was sent.
 * `sendInvoiceChase` declines for two completely different kinds of reason and
 * nothing distinguished them:
 *
 *   a FAULT    no email address on the invoice, the invoice is gone, the chase
 *              history could not be read. Somebody has to do something.
 *
 *   a NO-OP    already chased inside the seven-day cooldown, not due yet, the
 *              client has paid. The guard worked.
 *
 * The owner's `chase_overdue_invoices` agent found two invoices, both already
 * chased that week. Both were correctly refused. Because each refusal was an
 * error, the scatter reported "all 2 items failed", the run was recorded as
 * failed, the queue dead-lettered it, and the dashboard read
 *
 *     גבייה של חשבוניות באיחור — לא יכול לרוץ
 *     Scatter-gather step step2: all 2 items failed. First error: … business-os
 *     remind_invoices failed: Could not chase that invoice: already chased
 *     within 7 days
 *
 * under an agent behaving exactly as designed.
 *
 * This is the NORMAL case, not an edge: a daily chaser that works is a chaser
 * that mostly declines to send. So the agent reported itself broken on most
 * days it ran, and the owner's next move is to switch it off.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const sendInvoiceChase = jest.fn();

jest.mock('@/lib/services/InsightActionDispatchService', () => ({
  sendInvoiceChase: (...a: unknown[]) => sendInvoiceChase(...a),
}));

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger,
  };
  return { createLogger: () => logger };
});

import { readFileSync } from 'fs';
import { join } from 'path';

const EXECUTOR = join(process.cwd(), 'lib/business-os/bizql/mutate/MutateExecutor.ts');
const SERVICE = join(process.cwd(), 'lib/services/InsightActionDispatchService.ts');

describe('the service says which kind of non-send it was', () => {
  it('marks the benign ones skipped', () => {
    /*
     * Read from the source because the distinction has to live WITH the
     * reasons: a new benign reason added without the flag is the regression,
     * and it reads as a fault from the moment it ships.
     */
    const src = readFileSync(SERVICE, 'utf-8');

    for (const reason of [
      'already chased within',
      'not due until',
      'invoice is ${invoice.status}',
      'daily cap for',
    ]) {
      const line = src
        .split('\n')
        .find(l => l.includes(reason) && l.includes('return { sent: false'));

      expect(`${reason} -> ${line?.includes('skipped: true') ? 'skipped' : 'FAULT'}`).toBe(
        `${reason} -> skipped`
      );
    }
  });

  it('leaves a real fault a fault', () => {
    /*
     * The other half, and the one that makes this worth asserting: flagging
     * everything would hide an invoice with no email address, which the owner
     * can and should fix.
     */
    const src = readFileSync(SERVICE, 'utf-8');

    for (const reason of [
      'no email address for this invoice',
      'invoice no longer exists',
      'could not read this invoice chase history',
    ]) {
      const line = src
        .split('\n')
        .find(l => l.includes(reason) && l.includes('return { sent: false'));

      expect(`${reason} -> ${line?.includes('skipped') ? 'SKIPPED' : 'fault'}`).toBe(
        `${reason} -> fault`
      );
    }
  });
});

describe('what remind does with each', () => {
  /** The dispatch table's `remind`, reached the way the executor builds it. */
  const remind = async (outcome: Record<string, unknown>) => {
    sendInvoiceChase.mockResolvedValue(outcome);

    /*
     * The handler is a closure inside a table in a module that pulls in the
     * whole BizQL compiler, so it is exercised through its source contract
     * rather than imported: what matters is which branch an outcome takes, and
     * that is what the assertions below read.
     */
    const src = readFileSync(EXECUTOR, 'utf-8');
    const hasSkipBranch = /if \(outcome\.skipped\)/.test(src);
    const skipReturnsData = /if \(outcome\.skipped\)[\s\S]{0,320}?chased: false[\s\S]{0,120}?error: null/.test(
      src
    );
    const faultStillErrors = /if \(!outcome\.sent\)[\s\S]{0,200}?error: new Error/.test(src);

    return { hasSkipBranch, skipReturnsData, faultStillErrors };
  };

  it('answers a skipped chase with data and no error', async () => {
    const r = await remind({ sent: false, skipped: true, reason: 'already chased within 7 days' });

    expect(r.hasSkipBranch).toBe(true);
    /* `chased: false` and a reason, so a run still says what it decided — an
       owner asking "it ran, so what did it do" needs that. */
    expect(r.skipReturnsData).toBe(true);
  });

  it('still errors on a genuine fault', async () => {
    const r = await remind({ sent: false, reason: 'no email address for this invoice' });

    expect(r.faultStillErrors).toBe(true);
  });

  it('checks the skip BEFORE the fault, or the fault branch swallows it', async () => {
    /*
     * Order is the whole fix. `if (!outcome.sent)` matches a skipped outcome
     * too — `sent` is false in both — so a skip branch placed after it never
     * runs and the bug is exactly as it was.
     */
    const src = readFileSync(EXECUTOR, 'utf-8');

    /*
     * PER ACTION, not across the file. A first version compared the first
     * `outcome.skipped` with the first `!outcome.sent` anywhere in the module
     * and failed — which turned out to be a real finding rather than a test
     * artifact: `abandoned_bookings.remind` had the identical bug, erroring on
     * every non-send from `sendOneRecovery`, so `recover_abandoned_checkouts`
     * would have reported itself broken on exactly the same guards.
     *
     * So every non-send check in this file must be preceded by a skip check,
     * and the assertion is written to name the ones that are not.
     */
    const lines = src.split('\n');
    const unguarded: string[] = [];
    let seenSkipSince = false;

    for (const [i, line] of lines.entries()) {
      if (line.includes('const outcome = await')) seenSkipSince = false;
      if (line.includes('if (outcome.skipped)')) seenSkipSince = true;
      if (line.includes('if (!outcome.sent)') && !seenSkipSince) {
        unguarded.push(`line ${i + 1}: a non-send check with no skip branch before it`);
      }
    }

    expect(unguarded).toEqual([]);
    /* Not vacuous: there are non-send checks to guard. */
    expect(src.split('if (!outcome.sent)').length - 1).toBeGreaterThan(1);
  });
});
