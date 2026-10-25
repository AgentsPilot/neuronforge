import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * Every state an attempt can be in has something that writes it, and something
 * that reads it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CAUGHT
 *
 * `abandoned_bookings` has three states. Two were wired:
 *
 *   started    ← `openAttempt`, from `website/booking/create`        ✅
 *   converted  ← `convertAttempt`, from `materialiseAttempt`          ✅
 *   abandoned  ← `sweepAbandoned`, from NOTHING AT ALL                ❌
 *
 * So no row ever left `started`. The partial index over
 * `status = 'abandoned' AND recovery_email_sent_at IS NULL` — added in 20261071
 * and described as "exactly the condition the sender uses" — could never match
 * a row, and there was no sender either. Comments in `finalize` and the booking
 * widget referred to "the sweeper" as though it ran.
 *
 * A dead state is invisible: nothing fails, nothing errors, the table just
 * quietly fills with rows in one state for ever.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('an attempt reaches an ending', () => {
  const root = join(__dirname, '..', '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf-8');

  /** Callers of a given export, anywhere in the product. */
  const callersOf = (name: string): string[] => {
    const raw = execSync(
      `grep -rln "${name}" --include='*.ts' --include='*.tsx' app lib components || true`,
      { cwd: root, encoding: 'utf-8' }
    );
    return raw
      .split('\n')
      .filter(Boolean)
      .filter(f => !f.includes('__tests__'))
      /* Its own definition is not a caller. */
      .filter(f => f !== 'lib/scheduling/abandonedBookings.ts');
  };

  it('every one of the three writers is reachable', () => {
    for (const fn of ['openAttempt', 'convertAttempt', 'sweepAbandoned']) {
      expect({ fn, callers: callersOf(fn) }).toEqual({
        fn,
        callers: expect.arrayContaining([expect.any(String)]),
      });
    }
  });

  it('and the sweep is actually scheduled, not merely importable', () => {
    /*
     * A cron route nobody registered is the same dead state wearing a hat.
     * Checked against `vercel.json`, which is what Vercel reads.
     */
    const cron = read('app/api/cron/abandoned-bookings/route.ts');
    expect(cron).toContain('await sweepAbandoned()');

    const vercel = JSON.parse(read('vercel.json')) as { crons?: Array<{ path: string }> };
    const paths = (vercel.crons ?? []).map(c => c.path);
    expect(paths).toContain('/api/cron/abandoned-bookings');
  });

  it('and something reads the state the sweep writes', () => {
    /* `abandoned` existed only to be counted by a sender that did not exist. */
    const recovery = read('lib/scheduling/abandonedRecovery.ts');
    expect(recovery).toContain(".eq('status', 'abandoned')");
    expect(recovery).toContain(".is('recovery_email_sent_at', null)");
  });

  it('and a client is written to at most once', () => {
    /*
     * Stamped before the send, and stamped even when there is no address.
     * A transport failure that left it null would have every later run try
     * again: being mailed every half hour is a worse failure than silence.
     */
    const recovery = read('lib/scheduling/abandonedRecovery.ts');
    const loop = recovery.slice(recovery.indexOf('for (const attempt of attempts)'));
    const stampAt = loop.indexOf('await stamp(attempt.id');
    const bailAt = loop.indexOf('if (!attempt.email) continue;');
    expect(stampAt).toBeGreaterThan(-1);
    expect(bailAt).toBeGreaterThan(stampAt);
  });
});
