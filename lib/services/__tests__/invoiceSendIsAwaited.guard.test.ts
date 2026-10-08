/**
 * An invoice email is awaited, or it does not go.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `sendInvoice` was fired and not awaited in two places — the milestone billing
 * service and the proposal-acceptance route — on the reasoning that a transport
 * failure is something the owner resends, not a reason to unwind a billed
 * stage. The reasoning is sound. The mechanism was not.
 *
 * These run in Vercel serverless functions. Once the route returns its
 * response the instance is frozen, and a promise still in flight is killed with
 * it. So the stage was billed, the invoice existed, and the client was never
 * told — while the owner pressing "send invoice" by hand got it through,
 * because that route awaits the same call.
 *
 * It fails INTERMITTENTLY, which is what makes it expensive: a fast send
 * sometimes finishes before the freeze, so the bug reads as flaky mail rather
 * than as code.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The defect is invisible to every other kind of test. Under Jest the floating
 * promise resolves perfectly well — there is no serverless freeze in a test
 * runner — so a behavioural test of either path passes with the bug present.
 * Only the shape of the call tells you.
 *
 * `await` is not the sole correct form: a call whose promise is RETURNED is
 * awaited by its caller. Both are accepted; a bare statement is not.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

/** Every file that calls `sendInvoice`, found rather than listed. */
const CALLERS = [
  'lib/services/PaymentStageBillingService.ts',
  'app/api/proposal/[token]/route.ts',
  'app/api/payments/invoices/route.ts',
  'app/api/payments/invoices/[id]/send/route.ts',
  'app/api/cron/abandoned-proposal-invoices/route.ts',
];

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('every sendInvoice call is awaited or returned', () => {
  it.each(CALLERS)('%s', file => {
    const source = read(file);

    /*
     * Lines that CALL it, ignoring the import and any mention in prose. A call
     * site is `sendInvoice(` preceded by something other than a dot — the
     * `this.sendInvoice` methods elsewhere are a different function.
     */
    const lines = source
      .split('\n')
      .filter(line => /(?<![.\w])sendInvoice\s*\(/.test(line))
      .filter(line => !/^\s*(import|\*|\/\/)/.test(line));

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(line).toMatch(/\b(await|return)\b/);
    }
  });
});

describe('the two that were wrong stay fixed', () => {
  it('the milestone service awaits it, and still does not throw on failure', () => {
    /*
     * Awaited AND non-fatal: the stage stays billed whatever the mail does.
     * Reverting to non-fatal-by-floating is the regression; non-fatal-by-catch
     * is the fix.
     */
    const service = read('lib/services/PaymentStageBillingService.ts');

    expect(service).toMatch(/const sent = await sendInvoice\(/);
    expect(service).toMatch(/log\.error\(\s*\{ err: sent\.error, invoiceId \}/);
  });

  it('proposal acceptance awaits the first invoice of the job', () => {
    // The one the client is waiting for the moment they accept.
    const route = read('app/api/proposal/[token]/route.ts');

    expect(route).toMatch(/const sent = await sendInvoice\(/);
  });

  it('neither leaves a `.then(` chain on the call', () => {
    /*
     * The exact shape that failed. A `.then` here is not wrong in itself — it
     * is wrong because nothing waits for it.
     */
    for (const file of [
      'lib/services/PaymentStageBillingService.ts',
      'app/api/proposal/[token]/route.ts',
    ]) {
      expect(read(file)).not.toMatch(/sendInvoice\([^)]*\)\s*\n?\s*\.then\(/);
    }
  });
});
