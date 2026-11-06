/**
 * A plan reactivated in Stripe keeps the account (DL-1b / D6; C-3, BQ-38;
 * workplan §7, T-12; PLAN PAYMENTS review points 1 and 2).
 */

import { keepClosureAfterStripeReactivation, type ClosureStripeKeepDeps } from '../closureStripeKeep';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CLOSURE = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-04T10:00:00.000Z');
const INPUT = { accountId: ACCOUNT, subscriptionId: 'sub_own', livemode: false, stripeEventId: 'evt_1' };

function world(o: { status?: string | null; read?: 'error'; move?: 'moved' | 'not_moved' | 'error' } = {}) {
  const transitions: unknown[][] = [];
  const audits: unknown[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const deps: ClosureStripeKeepDeps = {
    closures: {
      findOpenForUser: jest.fn(async () => {
        if (o.read === 'error') return { data: null, error: new Error('down') };
        const status = o.status === undefined ? 'pending' : o.status;
        return { data: status ? { id: CLOSURE, status: status as 'pending' } : null, error: null };
      }),
      transition: jest.fn(async (...args: unknown[]) => {
        transitions.push(args);
        if (o.move === 'error') return { data: null, error: new Error('down') };
        return { data: o.move !== 'not_moved', error: null };
      }),
    },
    recordKept: jest.fn(async (facts) => {
      audits.push(facts);
    }),
    now: () => NOW,
  };
  const log = { info: (c: Record<string, unknown>) => logs.push(['info', c]), warn: (c: Record<string, unknown>) => logs.push(['warn', c]), error: (c: Record<string, unknown>) => logs.push(['error', c]) };
  return { deps, transitions, audits, logs, log };
}

describe('closureStripeKeep (T-12)', () => {
  it('a pending row → kept with source stripe, by compare-and-set on pending; one KEPT audit, system actor facts', async () => {
    const w = world();
    await keepClosureAfterStripeReactivation(INPUT, w.log, w.deps);
    expect(w.deps.closures.findOpenForUser).toHaveBeenCalledWith(ACCOUNT);
    expect(w.transitions).toEqual([[CLOSURE, ACCOUNT, 'pending', 'kept', { kept_at: NOW.toISOString(), kept_source: 'stripe' }]]);
    expect(w.audits).toEqual([{ accountId: ACCOUNT, closureId: CLOSURE, subscriptionId: 'sub_own', stripeEventId: 'evt_1', livemode: false }]);
  });

  it.each([['requesting'], ['grace'], ['locked'], [null]])('a %s row (or none) → nothing written, no audit', async (status) => {
    const w = world({ status });
    await keepClosureAfterStripeReactivation(INPUT, w.log, w.deps);
    expect(w.transitions).toEqual([]);
    expect(w.audits).toEqual([]);
  });

  it('replay-safe: the compare-and-set lost (already kept) → no second audit', async () => {
    const w = world({ move: 'not_moved' });
    await keepClosureAfterStripeReactivation(INPUT, w.log, w.deps);
    expect(w.audits).toEqual([]);
  });

  it('a read or write error throws (the handler wiring logs it and never fails the event)', async () => {
    await expect(keepClosureAfterStripeReactivation(INPUT, world({ read: 'error' }).log, world({ read: 'error' }).deps)).rejects.toThrow('closure_read_failed');
    const w = world({ move: 'error' });
    await expect(keepClosureAfterStripeReactivation(INPUT, w.log, w.deps)).rejects.toThrow('closure_keep_failed');
    expect(w.audits).toEqual([]);
  });

  it('logs ids only', async () => {
    const w = world();
    await keepClosureAfterStripeReactivation(INPUT, w.log, w.deps);
    expect(w.logs.find(([, c]) => c.event === 'bos_closure_kept_by_stripe')?.[1]).toEqual({ event: 'bos_closure_kept_by_stripe', closureId: CLOSURE, ...INPUT });
  });
});
