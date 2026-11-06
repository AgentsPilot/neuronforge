/**
 * The deletion request's orchestration (DL-1b / D6; workplan §4, T-3, T-4,
 * T-5; SA W-1 to W-5, W-7, W-13; user decision Q-1: `trialing` as `active`).
 * Fakes at every port: no database, no Stripe, no network.
 */

import fs from 'fs';
import path from 'path';
import {
  classifyBillingRow,
  isPaymentFailing,
  runClosureRequest,
  type BillingRowLike,
  type ClosureRequestDeps,
  type ClosureRequestInput,
} from '../closureRequest';
import type { AccountDeletionCheckOutcome } from '../selfServiceDeletion';
import type { PlanManageRefusalCode, PlanManageResult } from '@/lib/business-os/billing/planSubscriptionManage';

const USER = '11111111-1111-4111-8111-111111111111';
const CLOSURE = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-04T10:00:00.000Z');
const PERIOD_END_ISO = '2026-11-26T10:00:00.000Z';

const renewing = (o: Partial<BillingRowLike> = {}): BillingRowLike => ({
  stripeSubscriptionId: 'sub_own',
  subscriptionStatus: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: PERIOD_END_ISO,
  endedAt: null,
  failedAttempts: 0,
  pendingTier: null,
  openCheckoutSessionId: null,
  openCheckoutExpiresAt: null,
  ...o,
});
const freeRow = (o: Partial<BillingRowLike> = {}): BillingRowLike => renewing({ stripeSubscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null, ...o });

const CHECK_OK: AccountDeletionCheckOutcome = {
  kind: 'checked',
  canDelete: true,
  targetUserId: USER,
  blockers: [],
  notes: [],
  guards: [],
  rows: [],
  verdictBlocked: false,
  resolvedThisLogin: true,
  serverMs: 3,
};
const checkWith = (rows: Array<{ guard: string; item?: string; found?: number }>): AccountDeletionCheckOutcome => ({
  ...CHECK_OK,
  canDelete: false,
  rows,
  verdictBlocked: rows.length > 0,
  guards: rows.map((r) => r.guard),
});

const AUDIT = { action: 'cancel' as const, outcome: 'cancelled' as const, subscriptionId: 'sub_own', endsOn: PERIOD_END_ISO, renewsOn: null, livemode: false, mode: 'period_end' as const, reasonCode: 'other' as const, origin: 'deletion_request' as const };

interface Options {
  open?: { id: string; status: 'requesting' | 'pending' | 'grace' | 'locked' } | 'error';
  billing?: BillingRowLike | null | 'error';
  modeThrows?: boolean;
  prices?: boolean;
  check?: AccountDeletionCheckOutcome;
  timezone?: string | null | 'error';
  insert?: 'ok' | 'already_open' | 'error';
  transition?: 'moved' | 'not_moved' | 'error';
  remove?: 'ok' | 'error';
  engine?: PlanManageResult | 'throws';
}

function world(o: Options = {}) {
  const calls: string[] = [];
  const inserts: unknown[] = [];
  const transitions: unknown[][] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const log = (level: string) => (context: Record<string, unknown>) => {
    logs.push([level, context]);
  };
  const manage = jest.fn(async () => {
    calls.push('engine');
    if (o.engine === 'throws') throw new Error('boom');
    return o.engine ?? ({ ok: true, outcome: 'cancelled', endsOn: PERIOD_END_ISO, audit: AUDIT } as PlanManageResult);
  });
  const deps: ClosureRequestDeps = {
    closures: {
      findOpenForUser: async () => {
        calls.push('closure:open');
        if (o.open === 'error') return { data: null, error: new Error('down') };
        return { data: o.open ?? null, error: null };
      },
      insertRequesting: async (input) => {
        calls.push('closure:insert');
        inserts.push(input);
        if (o.insert === 'already_open') return { data: null, error: Object.assign(new Error('x'), { code: 'already_open' }) };
        if (o.insert === 'error') return { data: null, error: new Error('down') };
        return { data: { id: CLOSURE, status: 'requesting' }, error: null };
      },
      transition: async (...args) => {
        calls.push(`closure:${args[2]}>${args[3]}`);
        transitions.push(args);
        if (o.transition === 'error') return { data: null, error: new Error('down') };
        return { data: o.transition !== 'not_moved', error: null };
      },
      deleteRequesting: async () => {
        calls.push('closure:delete');
        return o.remove === 'error' ? { data: null, error: new Error('down') } : { data: true, error: null };
      },
    },
    billingRow: async () => {
      calls.push('billing');
      if (o.billing === 'error') return { data: null, error: new Error('down') };
      return { data: o.billing === undefined ? renewing() : o.billing, error: null };
    },
    livemode: () => {
      if (o.modeThrows) throw new Error('stripe_key_mode_unknown');
      return false;
    },
    pricesEnabled: jest.fn(() => o.prices ?? true),
    runCheck: jest.fn(async () => {
      calls.push('check');
      return o.check ?? CHECK_OK;
    }),
    readTimezone: async () => {
      calls.push('timezone');
      if (o.timezone === 'error') return { data: null, error: new Error('down') };
      return { data: o.timezone === undefined ? 'Asia/Jerusalem' : o.timezone, error: null };
    },
    manage,
    now: () => NOW,
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
  };
  return { deps, calls, inserts, transitions, logs, manage };
}

const INPUT: ClosureRequestInput = { subject: USER, email: 'owner@example.com', accountId: USER, statementLanguage: 'he', reasonCode: 'business_closing' };
const go = (w: ReturnType<typeof world>) => runClosureRequest(INPUT, w.deps);

describe('T-3: a paid account → the engine, then pending (XC-2)', () => {
  it('renewing: requesting with renewal_was_on true, the engine with origin deletion_request and the reason, then pending', async () => {
    const w = world();
    expect(await go(w)).toEqual({ ok: true, status: 'pending', closureId: CLOSURE, planEndsOn: PERIOD_END_ISO, renewalWasOn: true, engineAudit: AUDIT });
    expect(w.calls).toEqual(['closure:open', 'billing', 'check', 'closure:insert', 'engine', 'closure:requesting>pending']);
    expect(w.inserts).toEqual([{ userId: USER, statementLanguage: 'he', reasonCode: 'business_closing', renewalWasOn: true, planEndsAt: PERIOD_END_ISO }]);
    expect(w.manage).toHaveBeenCalledWith({ action: 'cancel', userId: USER, accountId: USER, origin: 'deletion_request', reasonCode: 'business_closing' });
    // W-2: no next_check_at; W-3: renewal_was_on and plan_ends_at from the engine's answer.
    expect(w.transitions).toEqual([[CLOSURE, USER, 'requesting', 'pending', { renewal_was_on: true, plan_ends_at: PERIOD_END_ISO }]]);
  });

  it('cancelling earlier (BQ-33): the engine answers unchanged → pending with renewal_was_on false and its date', async () => {
    const date = '2026-11-20T00:00:00.000Z';
    const w = world({ billing: renewing({ cancelAtPeriodEnd: true }), engine: { ok: true, outcome: 'unchanged', state: 'cancelling', date } });
    expect(await go(w)).toMatchObject({ ok: true, status: 'pending', renewalWasOn: false, planEndsOn: date, engineAudit: null });
    expect(w.inserts[0]).toMatchObject({ renewalWasOn: false });
    expect(w.transitions[0][4]).toEqual({ renewal_was_on: false, plan_ends_at: date });
  });

  it('D-3: our row said renewing but Stripe was already set to end → corrected to false at pending', async () => {
    const w = world({ engine: { ok: true, outcome: 'unchanged', state: 'cancelling', date: PERIOD_END_ISO } });
    await go(w);
    expect(w.inserts[0]).toMatchObject({ renewalWasOn: true });
    expect(w.transitions[0][4]).toEqual({ renewal_was_on: false, plan_ends_at: PERIOD_END_ISO });
  });

  it('D-3: our row said cancelling but Stripe was renewing → corrected to true', async () => {
    const w = world({ billing: renewing({ cancelAtPeriodEnd: true }) });
    await go(w);
    expect(w.inserts[0]).toMatchObject({ renewalWasOn: false });
    expect(w.transitions[0][4]).toEqual({ renewal_was_on: true, plan_ends_at: PERIOD_END_ISO });
  });

  it('trialing is accepted like active (user decision Q-1)', async () => {
    const w = world({ billing: renewing({ subscriptionStatus: 'trialing' }) });
    expect(await go(w)).toMatchObject({ ok: true, status: 'pending' });
  });
});

describe('T-3: a free account → grace at once, with its lock date (D-4, W-11)', () => {
  it('no row: requesting → grace, lock date in the stored zone, no engine call, no next_check_at', async () => {
    const w = world({ billing: null });
    expect(await go(w)).toEqual({ ok: true, status: 'grace', closureId: CLOSURE, graceStartsAt: NOW.toISOString(), lockAt: '2026-11-17T22:00:00.000Z', lockTimezone: 'Asia/Jerusalem' });
    expect(w.calls).toEqual(['closure:open', 'billing', 'check', 'timezone', 'closure:insert', 'closure:requesting>grace']);
    expect(w.inserts[0]).toMatchObject({ renewalWasOn: false, planEndsAt: null });
    expect(w.transitions[0][4]).toEqual({ grace_starts_at: NOW.toISOString(), lock_at: '2026-11-17T22:00:00.000Z', lock_timezone: 'Asia/Jerusalem' });
    expect(w.manage).not.toHaveBeenCalled();
  });

  it('a NULL timezone → UTC', async () => {
    const w = world({ billing: null, timezone: null });
    expect(await go(w)).toMatchObject({ ok: true, status: 'grace', lockAt: '2026-11-18T00:00:00.000Z', lockTimezone: 'UTC' });
  });

  it.each([
    ['no subscription id', freeRow()],
    ['ended', renewing({ endedAt: '2026-10-01T00:00:00.000Z', subscriptionStatus: 'canceled' })],
  ])('W-5: free (%s) with the prices switch OFF → grace; the switch is never read', async (_label, billing) => {
    const w = world({ billing, prices: false });
    expect(await go(w)).toMatchObject({ ok: true, status: 'grace' });
    expect(w.deps.pricesEnabled).not.toHaveBeenCalled();
  });

  it('timezone unreadable → try_again, nothing written (the lock date is promised)', async () => {
    const w = world({ billing: null, timezone: 'error' });
    expect(await go(w)).toMatchObject({ ok: false, error: 'try_again', reason: 'timezone_unreadable' });
    expect(w.inserts).toEqual([]);
  });

  it.each(['error', 'not_moved'] as const)('the grace transition %s → the request row is withdrawn, try_again', async (transition) => {
    const w = world({ billing: null, transition });
    expect(await go(w)).toMatchObject({ ok: false, error: 'try_again', reason: 'grace_transition_failed' });
    expect(w.calls).toContain('closure:delete');
  });
});

describe('refusals from our own data: nothing written, no check, no Stripe (§4.3)', () => {
  it.each<[string, Options, string, string]>([
    ['an open request already', { open: { id: CLOSURE, status: 'grace' } }, 'already_requested', 'already_requested'],
    ['the closure read fails', { open: 'error' }, 'try_again', 'closure_read_failed'],
    ['the key mode is unknown', { modeThrows: true }, 'not_available', 'stripe_key_mode_unknown'],
    ['the billing row is unreadable', { billing: 'error' }, 'try_again', 'billing_row_unreadable'],
    ['failing (past_due)', { billing: renewing({ subscriptionStatus: 'past_due' }) }, 'blocked', 'payment_failed'],
    ['failing (failed attempts on active)', { billing: renewing({ failedAttempts: 1 }) }, 'blocked', 'payment_failed'],
    ['a change pending', { billing: renewing({ pendingTier: 'tier_two' }) }, 'plan_change_pending', 'change_pending'],
    ['a free account with an unexpired open checkout', { billing: freeRow({ openCheckoutSessionId: 'cs_1', openCheckoutExpiresAt: '2026-11-04T10:30:00.000Z' }) }, 'plan_change_pending', 'open_checkout'],
    ['an ended plan with an unexpired open checkout', { billing: renewing({ endedAt: '2026-10-01T00:00:00.000Z', openCheckoutSessionId: 'cs_1', openCheckoutExpiresAt: null }) }, 'plan_change_pending', 'open_checkout'],
    ['period over, webhook lagging', { billing: renewing({ cancelAtPeriodEnd: true, currentPeriodEnd: '2026-11-01T00:00:00.000Z' }) }, 'plan_state_changed', 'period_over'],
    ['incomplete', { billing: renewing({ subscriptionStatus: 'incomplete' }) }, 'plan_state_changed', 'not_active'],
    ['a subscription with the prices switch off', { prices: false }, 'not_available', 'prices_switch_off'],
  ])('%s → %s', async (_label, options, error, reason) => {
    const w = world(options);
    const out = await go(w);
    expect(out).toMatchObject({ ok: false, error, reason });
    expect(w.inserts).toEqual([]);
    expect(w.manage).not.toHaveBeenCalled();
    expect(w.calls).not.toContain('check');
  });

  it('already_requested carries the open row status and is not audited', async () => {
    expect(await go(world({ open: { id: CLOSURE, status: 'pending' } }))).toMatchObject({ closureStatus: 'pending', auditRefusal: false });
  });

  it('payment_failed is shown with its own blocker code (BQ-11)', async () => {
    expect(await go(world({ billing: renewing({ subscriptionStatus: 'unpaid' }) }))).toMatchObject({ blockers: [{ code: 'payment_failed' }] });
  });
});

describe('T-7 at the route level: blockers at A (XC-5, W-4)', () => {
  it('G-6 and G-12 only → the request goes on', async () => {
    const w = world({ check: checkWith([{ guard: 'G-6', found: 1 }, { guard: 'G-12', found: 3 }]) });
    expect(await go(w)).toMatchObject({ ok: true, status: 'pending' });
  });

  it('G-8 and G-9 → blocked with where to fix them, guard ids only, nothing written', async () => {
    const w = world({ check: checkWith([{ guard: 'G-8', found: 1 }, { guard: 'G-9', item: 'money in flight: payment(s) still pending', found: 2 }, { guard: 'G-17' }]) });
    expect(await go(w)).toMatchObject({
      ok: false,
      error: 'blocked',
      blockers: [{ code: 'stripe_connected' }, { code: 'client_payments_pending', count: 2 }],
      guards: ['G-8', 'G-9'],
    });
    expect(w.inserts).toEqual([]);
  });

  it('the check resolved another login → blocked as contact_support', async () => {
    const w = world({ check: { ...CHECK_OK, resolvedThisLogin: false } });
    expect(await go(w)).toMatchObject({ ok: false, error: 'blocked', blockers: [{ code: 'contact_support' }] });
  });

  it('check unavailable → not_available; check failed → try_again', async () => {
    expect(await go(world({ check: { kind: 'unavailable', reason: 'function_out_of_date', error: null } }))).toMatchObject({ ok: false, error: 'not_available' });
    expect(await go(world({ check: { kind: 'failed', error: new Error('x') } }))).toMatchObject({ ok: false, error: 'try_again', reason: 'check_failed' });
  });
});

describe('the insert', () => {
  it('already_open from the unique index → already_requested', async () => {
    const w = world({ insert: 'already_open' });
    expect(await go(w)).toMatchObject({ ok: false, error: 'already_requested', auditRefusal: false });
    expect(w.manage).not.toHaveBeenCalled();
  });

  it('an insert error → try_again, no Stripe call', async () => {
    const w = world({ insert: 'error' });
    expect(await go(w)).toMatchObject({ ok: false, error: 'try_again', reason: 'closure_insert_failed' });
    expect(w.manage).not.toHaveBeenCalled();
  });
});

describe('T-4: a definite engine refusal withdraws the request (§4.4 P-4)', () => {
  it.each<[PlanManageRefusalCode, string, Record<string, unknown>]>([
    ['payment_failed_contact_us', 'blocked', { blockers: [{ code: 'payment_failed' }] }],
    ['billing_record_mismatch', 'blocked', { blockers: [{ code: 'contact_support' }] }],
    ['custom_end_date', 'blocked', { blockers: [{ code: 'contact_support' }] }],
    ['upgrade_pending', 'plan_change_pending', {}],
    ['change_pending', 'plan_change_pending', {}],
    ['subscription_not_active', 'plan_state_changed', {}],
    ['not_subscribed', 'plan_state_changed', {}],
    ['manage_unavailable', 'not_available', {}],
    ['billing_row_unreadable', 'try_again', {}],
    ['stripe_error', 'stripe_error', {}],
  ])('%s → %s, the requesting row deleted, never pending', async (code, error, extra) => {
    const w = world({ engine: { ok: false, code } });
    expect(await go(w)).toMatchObject({ ok: false, error, reason: `plan_${code}`, closureId: CLOSURE, ...extra });
    expect(w.calls.slice(-2)).toEqual(['engine', 'closure:delete']);
    expect(w.transitions).toEqual([]);
  });

  it('a failed withdrawal is logged error + alert; the answer is unchanged', async () => {
    const w = world({ engine: { ok: false, code: 'stripe_error' }, remove: 'error' });
    expect(await go(w)).toMatchObject({ ok: false, error: 'stripe_error' });
    expect(w.logs.some(([level, ctx]) => level === 'error' && ctx.alert === true && ctx.closureId === CLOSURE)).toBe(true);
  });
});

describe('T-5 and the other engine outcomes (§4.4)', () => {
  it('P-7 outcomeUnknown → the row stays requesting: never deleted, never pending; the money audit facts kept', async () => {
    const audit = { ...AUDIT, outcome: 'unknown' as const, endsOn: null };
    const w = world({ engine: { ok: false, code: 'stripe_error', outcomeUnknown: true, audit } });
    expect(await go(w)).toMatchObject({ ok: false, error: 'stripe_error', outcomeUnknown: true, reason: 'plan_outcome_unknown', engineAudit: audit });
    expect(w.calls).not.toContain('closure:delete');
    expect(w.transitions).toEqual([]);
  });

  it('P-3 an immediate end (impossible with this origin) → stays requesting, request_failed, alerted', async () => {
    const w = world({ engine: { ok: true, outcome: 'cancelled', endsOn: NOW.toISOString(), mode: 'immediate', audit: { ...AUDIT, mode: 'immediate' } } });
    expect(await go(w)).toMatchObject({ ok: false, error: 'request_failed', reason: 'plan_ended_now' });
    expect(w.transitions).toEqual([]);
    expect(w.calls).not.toContain('closure:delete');
  });

  it('P-5 unchanged / ended → withdrawn, plan_state_changed', async () => {
    const w = world({ engine: { ok: true, outcome: 'unchanged', state: 'ended', date: NOW.toISOString() } });
    expect(await go(w)).toMatchObject({ ok: false, error: 'plan_state_changed', reason: 'plan_ended' });
    expect(w.calls).toContain('closure:delete');
    expect(w.transitions).toEqual([]);
  });

  it.each<[string, PlanManageResult]>([
    ['unchanged / renewing', { ok: true, outcome: 'unchanged', state: 'renewing', date: PERIOD_END_ISO }],
    ['reactivated', { ok: true, outcome: 'reactivated', renewsOn: PERIOD_END_ISO, audit: { ...AUDIT, action: 'reactivate', outcome: 'reactivated' } }],
  ])('P-6 %s → withdrawn, request_failed, alerted', async (_label, engine) => {
    const w = world({ engine });
    expect(await go(w)).toMatchObject({ ok: false, error: 'request_failed', reason: 'unexpected_engine_answer' });
    expect(w.calls).toContain('closure:delete');
    expect(w.transitions).toEqual([]);
  });

  it.each(['error', 'not_moved'] as const)('P-8 the pending transition %s → stays requesting, try_again with status requesting, the money audit kept, REQUESTED not audited', async (transition) => {
    const w = world({ transition });
    expect(await go(w)).toMatchObject({ ok: false, error: 'try_again', reason: 'pending_transition_failed', closureStatus: 'requesting', engineAudit: AUDIT, auditRefusal: false });
    expect(w.calls).not.toContain('closure:delete');
  });

  it('P-9 the engine throws → stays requesting, request_failed', async () => {
    const w = world({ engine: 'throws' });
    expect(await go(w)).toMatchObject({ ok: false, error: 'request_failed', reason: 'unexpected_failed' });
    expect(w.calls).not.toContain('closure:delete');
  });
});

describe('logs: ids and codes only', () => {
  it('never the email', async () => {
    for (const options of [{}, { billing: null }, { engine: { ok: false, code: 'stripe_error' } as PlanManageResult }, { check: checkWith([{ guard: 'G-8' }]) }]) {
      const w = world(options);
      await go(w);
      expect(JSON.stringify(w.logs)).not.toContain('owner@example.com');
    }
  });
});

describe('helpers', () => {
  it('classifyBillingRow reads the prices switch only for a live subscription (W-5)', () => {
    const prices = jest.fn(() => true);
    expect(classifyBillingRow(null, prices, NOW)).toEqual({ path: 'free' });
    expect(prices).not.toHaveBeenCalled();
    expect(classifyBillingRow(renewing(), prices, NOW)).toMatchObject({ path: 'paid', renewalWasOn: true });
    expect(prices).toHaveBeenCalledTimes(1);
  });

  it('isPaymentFailing: a live failing row only', () => {
    expect(isPaymentFailing(renewing({ subscriptionStatus: 'past_due' }), NOW)).toBe(true);
    expect(isPaymentFailing(renewing(), NOW)).toBe(false);
    expect(isPaymentFailing(renewing({ subscriptionStatus: 'past_due', endedAt: '2026-10-01T00:00:00.000Z' }), NOW)).toBe(false);
    expect(isPaymentFailing(null, NOW)).toBe(false);
  });
});

describe('SA W-7: D6 calls the one "don\'t renew" engine, never a Stripe method', () => {
  const read = (name: string) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  const D6_FILES = ['closureRequest.ts', 'closureRequestDeps.ts', 'closureKeep.ts', 'closureKeepDeps.ts', 'closureStripeKeep.ts', 'closureStripeKeepDeps.ts'];

  it('the request and Keep wiring import managePlanSubscription from the engine', () => {
    for (const name of ['closureRequestDeps.ts', 'closureKeepDeps.ts']) {
      expect(read(name)).toMatch(/import \{ managePlanSubscription[^}]*\} from '@\/lib\/business-os\/billing\/planSubscriptionManage'/);
      expect(read(name)).toMatch(/managePlanSubscription\(input, \{ logger \}\)/);
    }
  });

  it('no D6 file names a Stripe cancel method', () => {
    for (const name of D6_FILES) expect({ name, hit: /setBusinessOsCancelAtPeriodEnd|cancelBusinessOsSubscriptionNow/.test(read(name)) }).toEqual({ name, hit: false });
  });

  it('the request passes origin as a constant, never from its input (W-8)', () => {
    expect(read('closureRequest.ts')).toMatch(/origin: 'deletion_request'/);
    expect(read('closureKeep.ts')).toMatch(/origin: 'deletion_keep'/);
  });
});
