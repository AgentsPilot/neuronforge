/**
 * Keep my account, stages A to C (DL-1b / D6; workplan §5, T-2, T-9; BQ-33;
 * SA W-7, W-8, Q-13). Row FIRST, then Stripe, and only when renewal was on.
 */

import fs from 'fs';
import path from 'path';
import { runClosureKeep, type ClosureKeepDeps, type KeepClosureRow } from '../closureKeep';
import type { PlanManageResult } from '@/lib/business-os/billing/planSubscriptionManage';

const USER = '11111111-1111-4111-8111-111111111111';
const CLOSURE = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-04T10:00:00.000Z');
const ENDS = '2026-11-26T10:00:00.000Z';

const pending = (o: Partial<KeepClosureRow> = {}): KeepClosureRow => ({ id: CLOSURE, status: 'pending', renewal_was_on: true, plan_ends_at: ENDS, ...o });
const AUDIT = { action: 'reactivate' as const, outcome: 'reactivated' as const, subscriptionId: 'sub_own', endsOn: null, renewsOn: ENDS, livemode: false, mode: 'period_end' as const, reasonCode: null, origin: 'deletion_keep' as const };

function world(o: { open?: KeepClosureRow | null | 'error'; move?: 'moved' | 'not_moved' | 'error'; after?: KeepClosureRow | null; engine?: PlanManageResult | 'throws' } = {}) {
  const order: string[] = [];
  const transitions: unknown[][] = [];
  const manage = jest.fn(async () => {
    order.push('engine');
    if (o.engine === 'throws') throw new Error('boom');
    return o.engine ?? ({ ok: true, outcome: 'reactivated', renewsOn: ENDS, audit: AUDIT } as PlanManageResult);
  });
  const deps: ClosureKeepDeps = {
    closures: {
      findOpenForUser: async () => {
        order.push('open');
        if (o.open === 'error') return { data: null, error: new Error('down') };
        return { data: o.open === undefined ? pending() : o.open, error: null };
      },
      findById: async () => {
        order.push('reread');
        return { data: o.after ?? null, error: null };
      },
      transition: async (...args) => {
        order.push('transition');
        transitions.push(args);
        if (o.move === 'error') return { data: null, error: new Error('down') };
        return { data: o.move !== 'not_moved', error: null };
      },
    },
    manage,
    now: () => NOW,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
  return { deps, order, transitions, manage };
}

const keep = (w: ReturnType<typeof world>) => runClosureKeep({ subject: USER, accountId: USER }, w.deps);

describe('T-9: Keep in A/B restores renewal only if renewal_was_on (BQ-33)', () => {
  it('pending + renewal was on → row kept FIRST, then reactivate with origin deletion_keep → restored', async () => {
    const w = world();
    expect(await keep(w)).toEqual({ ok: true, closureId: CLOSURE, from: 'pending', renewal: 'restored', engineAudit: AUDIT });
    expect(w.order).toEqual(['open', 'transition', 'engine']);
    expect(w.transitions).toEqual([[CLOSURE, USER, 'pending', 'kept', { kept_at: NOW.toISOString(), kept_source: 'owner' }]]);
    expect(w.manage).toHaveBeenCalledWith({ action: 'reactivate', userId: USER, accountId: USER, origin: 'deletion_keep' });
  });

  it('the engine finds it already renewing → restored, no money audit', async () => {
    const w = world({ engine: { ok: true, outcome: 'unchanged', state: 'renewing', date: ENDS } });
    expect(await keep(w)).toMatchObject({ ok: true, renewal: 'restored', engineAudit: null });
  });

  it('pending + renewal was off → kept, no engine call → not_restored_by_choice', async () => {
    const w = world({ open: pending({ renewal_was_on: false }) });
    expect(await keep(w)).toMatchObject({ ok: true, from: 'pending', renewal: 'not_restored_by_choice' });
    expect(w.manage).not.toHaveBeenCalled();
  });

  it('grace → kept, no engine call (the plan has ended) → not_needed', async () => {
    const w = world({ open: pending({ status: 'grace' }) });
    expect(await keep(w)).toMatchObject({ ok: true, from: 'grace', renewal: 'not_needed' });
    expect(w.transitions[0]).toEqual([CLOSURE, USER, 'grace', 'kept', { kept_at: NOW.toISOString(), kept_source: 'owner' }]);
    expect(w.manage).not.toHaveBeenCalled();
  });

  it('a reactivate refusal → the account IS kept; renewal failed with the code and the end date (Q-13)', async () => {
    const w = world({ engine: { ok: false, code: 'payment_failed_contact_us' } });
    expect(await keep(w)).toEqual({ ok: true, closureId: CLOSURE, from: 'pending', renewal: 'failed', code: 'payment_failed_contact_us', planEndsOn: ENDS, engineAudit: null });
  });

  it('a lost Stripe answer → kept, renewal unknown, money audit facts kept', async () => {
    const audit = { ...AUDIT, outcome: 'unknown' as const };
    const w = world({ engine: { ok: false, code: 'stripe_error', outcomeUnknown: true, audit } });
    expect(await keep(w)).toMatchObject({ ok: true, renewal: 'unknown', engineAudit: audit });
  });

  it('the engine throws → kept, renewal unknown', async () => {
    expect(await keep(world({ engine: 'throws' }))).toMatchObject({ ok: true, renewal: 'unknown' });
  });
});

describe('T-9: what Keep refuses', () => {
  it.each<[string, KeepClosureRow | null | 'error', string]>([
    ['no open request', null, 'nothing_to_keep'],
    ['a requesting row (a live request)', pending({ status: 'requesting' }), 'request_in_progress'],
    ['a locked row (support only, DL-4)', pending({ status: 'locked' }), 'locked'],
    ['a read error', 'error', 'try_again'],
  ])('%s → %s, nothing written, no engine call', async (_label, open, error) => {
    const w = world({ open });
    expect(await keep(w)).toMatchObject({ ok: false, error });
    expect(w.transitions).toEqual([]);
    expect(w.manage).not.toHaveBeenCalled();
  });

  it('the compare-and-set lost (a second tab, the mirror, DL-3) → state_changed with the re-read status; no engine call', async () => {
    const w = world({ move: 'not_moved', after: pending({ status: 'kept' }) });
    expect(await keep(w)).toEqual({ ok: false, error: 'state_changed', closureStatus: 'kept' });
    expect(w.manage).not.toHaveBeenCalled();
  });

  it('the transition errors → try_again; no engine call', async () => {
    const w = world({ move: 'error' });
    expect(await keep(w)).toEqual({ ok: false, error: 'try_again' });
    expect(w.manage).not.toHaveBeenCalled();
  });
});

describe('T-2 source scan: Keep and the Stripe-side keep never read the request switch (XC-4)', () => {
  it.each(['closureKeep.ts', 'closureKeepDeps.ts', 'closureStripeKeep.ts', 'closureStripeKeepDeps.ts'])('%s names no isAccountSelfDeleteEnabled', (name) => {
    expect(fs.readFileSync(path.join(__dirname, '..', name), 'utf8')).not.toMatch(/isAccountSelfDeleteEnabled/);
  });

  it('the Keep route does not read it either', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'app', 'api', 'business-os', 'account', 'keep', 'route.ts'), 'utf8');
    expect(route).not.toMatch(/isAccountSelfDeleteEnabled/);
  });
});
