/**
 * MK5B-FU-1 (SA-WP-M5F M5F-6): the trial ids the first-payment read is asked
 * about. The property that matters: `trialsToPaid` given ONLY the first
 * payments of the asked ids says exactly what it says given EVERY account's
 * first payment. So asking the subset can never change MK-9's figures.
 */

import * as fs from 'fs';
import * as path from 'path';

import { trialAccountsToAsk } from '../firstPaymentAsk';
import { trialsToPaid } from '../payingBreakdown';

const afterAllChecks: Array<() => void> = [];
const W = { start: new Date('2026-11-01T00:00:00.000Z'), end: new Date('2026-11-10T00:00:00.000Z') };

describe('trialAccountsToAsk', () => {
  it('the window edges: start is in, end is out; null and unreadable ends are out; duplicates once', () => {
    expect(
      trialAccountsToAsk(
        [
          { accountId: 'a', endsAt: '2026-11-01T00:00:00.000Z' },
          { accountId: 'b', endsAt: '2026-11-10T00:00:00.000Z' },
          { accountId: 'c', endsAt: '2026-10-31T23:59:59.999Z' },
          { accountId: 'd', endsAt: '2026-11-09T23:59:59.999Z' },
          { accountId: 'e', endsAt: null },
          { accountId: 'f', endsAt: 'never' },
          { accountId: 'a', endsAt: '2026-11-02T00:00:00.000Z' },
          { accountId: 'g', endsAt: '2026-11-05T01:00:00+02:00' },
        ],
        W
      )
    ).toEqual(['a', 'd', 'g']);
  });

  it('a trial ending later today (after now, still in the window) is asked: a superset never misses one', () => {
    expect(trialAccountsToAsk([{ accountId: 'x', endsAt: '2026-11-09T20:00:00.000Z' }], W)).toEqual(['x']);
  });

  it('PROPERTY (200 seeded runs): trialsToPaid over the asked ids only equals trialsToPaid over everyone', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const day = 24 * 60 * 60 * 1000;
    // Planted control: asking NOTHING must change the answer in some runs, or the property proves nothing.
    let controlDiffers = 0;
    afterAllChecks.push(() => expect(controlDiffers).toBeGreaterThan(20));
    for (let run = 0; run < 200; run += 1) {
      const base = Date.UTC(2026, 0, 1) + Math.floor(rand() * 300) * day;
      const window = { start: new Date(base), end: new Date(base + Math.ceil(rand() * 40) * day) };
      const now = new Date(base + Math.floor(rand() * 60 - 10) * day + Math.floor(rand() * day));
      const count = Math.floor(rand() * 40);
      const trials = Array.from({ length: count }, (_, i) => ({
        accountId: `acct-${i}`,
        endsAt: rand() < 0.1 ? null : new Date(base + Math.floor((rand() * 80 - 20) * day)).toISOString(),
      }));
      const everyone = trials
        .filter(() => rand() < 0.7)
        .map((t) => ({ accountId: t.accountId, paidAt: new Date(base + Math.floor((rand() * 120 - 40) * day)).toISOString() }));
      const asked = new Set(trialAccountsToAsk(trials, window));
      const subset = everyone.filter((p) => asked.has(p.accountId));
      const args = { trials, capped: rand() < 0.2, window, now, minimumTrials: 1 + Math.floor(rand() * 5) };
      const full = trialsToPaid({ ...args, firstPayments: everyone });
      expect(trialsToPaid({ ...args, firstPayments: subset })).toEqual(full);
      if (JSON.stringify(trialsToPaid({ ...args, firstPayments: [] })) !== JSON.stringify(full)) controlDiffers += 1;
    }
    for (const check of afterAllChecks.splice(0)) check();
  });

  it('source: pure (no import at all), names no mode and no table', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'firstPaymentAsk.ts'), 'utf8');
    expect(code).not.toMatch(/^import /m);
    expect(code).not.toMatch(/livemode|business_os_|Date\.now|new Date\(\)/);
  });
});
