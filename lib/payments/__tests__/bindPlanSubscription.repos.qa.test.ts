/**
 * QA (CF-5 PR 4): bindPlanSubscription's five queries, now behind repository
 * methods, run through the REAL repositories over a recording client.
 *
 * `bindPlanSubscription.test.ts` (frozen) answers every query with
 * `{ data, error }`, so it cannot tell a call site that catches from one that
 * does not. Inline, a rejected or thrown count, insert, link, contact read or
 * plan fallback read rejected `bindPlanSubscription`, and its callers turn that
 * into a 500 and a retry. That must still hold, and nothing after the failed
 * query may run. The owner scoping of every write and read is pinned too.
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * (QA Testing Report, PR 4). No database, no Stripe network.
 */

type Answer = { data?: unknown; error?: unknown; count?: number | null };
type Rule = Answer | { reject: unknown } | { throwSync: unknown };

interface DbOp {
  table: string;
  op: string;
  chain: unknown[][];
}

const mockOps: DbOp[] = [];
const mockLogs: Array<{ level: string; args: unknown[] }> = [];
const mockStripe: string[] = [];
const mockCounts: Record<string, number> = {};
let mockRules: Record<string, Rule> = {};
const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockBuilder(table: string, calls: unknown[][]): unknown {
  const resolve = () => {
    const w = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const op = w ? String(w[0]) : 'select';
    mockOps.push({ table, op, chain: calls });
    const key = `${table}:${op}`;
    mockCounts[key] = (mockCounts[key] ?? 0) + 1;
    const rule = mockRules[`${key}:${mockCounts[key]}`] ?? mockRules[key];
    if (rule && 'throwSync' in rule) throw rule.throwSync;
    if (rule && 'reject' in rule) return Promise.reject(rule.reject);
    return Promise.resolve(rule ?? { data: null, error: null });
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => {
            let p: Promise<unknown>;
            try {
              p = resolve();
            } catch (e) {
              p = Promise.reject(e);
            }
            return p.then(f, r);
          };
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => resolve();
        return (...args: unknown[]) => mockBuilder(table, [...calls, [String(prop), ...args]]);
      },
    }
  );
}

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: (t: string) => mockBuilder(t, []) },
}));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const at = (level: string) => (...args: unknown[]) => {
      mockLogs.push({ level, args });
    };
    const l: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
    l.child = () => l;
    return l;
  };
  return { createLogger: () => make() };
});

import { bindPlanSubscription, type BindPlanSubscriptionInput } from '@/lib/payments/bindPlanSubscription';

const BK = '11111111-0b0b-4000-8000-0000000000b1';
const SV = '22222222-05e5-4000-8000-0000000000e1';
const PLANS = 'payment_plan_subscriptions';
const PPI = 'payment_plan_installments';
const SB = 'scheduling_bookings';
const SS = 'scheduling_services';
const PPL = 'payment_plans';

const ok = (data: unknown): Answer => ({ data, error: null });
const dbError = (message: string): Answer => ({ data: null, error: { code: 'XX000', message, details: null, hint: null } });
const rejects = (): Rule => ({ reject: new Error('socket hang up') });
const throwsSync = (): Rule => ({ throwSync: new TypeError('sync explode') });

const stripe = () => {
  const rec = (name: string, ret: unknown) => () => {
    mockStripe.push(name);
    return Promise.resolve(ret);
  };
  return {
    subscriptions: { retrieve: rec('subscriptions.retrieve', { id: 'sub_1', schedule: null }) },
    subscriptionSchedules: {
      create: rec('schedules.create', { id: 'sched_1', phases: [{ items: [{ price: 'price_1', quantity: 1 }], start_date: 1790000000 }] }),
      retrieve: rec('schedules.retrieve', {}),
      update: rec('schedules.update', {}),
    },
  } as unknown as BindPlanSubscriptionInput['stripe'];
};

const input = (over: Partial<BindPlanSubscriptionInput> = {}): BindPlanSubscriptionInput => ({
  stripe: stripe(), connectAccountId: 'acct_owner_a', subscriptionId: 'sub_1', customerId: 'cus_1', ownerId: 'owner-a',
  bookingId: BK, serviceId: SV, planTotal: 900, planCurrency: 'usd', planCount: 3, planFrequency: 'monthly',
  ...over,
});

/** A first bind where every link is owned and the plan row comes from the service fallback. */
const FIRST: Record<string, Rule> = {
  [`${SB}:select:1`]: ok({ id: BK }),
  [`${SS}:select:1`]: ok({ id: SV }),
  [`${SB}:select:2`]: ok({ contact_id: 'contact-9' }),
  [`${PPL}:select:1`]: ok({ id: 'pp-oldest' }),
  [`${PLANS}:insert`]: ok({ id: 'plan-new' }),
  [`${PLANS}:update`]: ok({ id: 'plan-new' }),
};
/** A plan recorded on an earlier delivery, with `count` projected periods. */
const EXISTING = (count: number | null): Record<string, Rule> => ({
  ...FIRST,
  [`${PLANS}:select:1`]: ok({ id: 'plan-ex', stripe_schedule_id: 'sched_ex' }),
  [`${PPI}:select:1`]: { data: null, error: null, count },
});

function reset(rules: Record<string, Rule>) {
  mockOps.length = 0;
  mockLogs.length = 0;
  mockStripe.length = 0;
  for (const k of Object.keys(mockCounts)) delete mockCounts[k];
  mockRules = rules;
}
const opKeys = () => mockOps.map((o) => `${o.table}:${o.op}`);
const only = (table: string, op: string) => mockOps.filter((o) => o.table === table && o.op === op);
const filters = (o: DbOp) => o.chain.filter((c) => !['select', 'update', 'insert'].includes(String(c[0])));
const messages = () => mockLogs.map((l) => l.args.find((a) => typeof a === 'string'));

describe('QA CF-5 PR 4: a rejected or thrown query in bind rejects bind, and nothing after it runs', () => {
  // [site, rules that reach it, rule key, expected op key of the last query]
  const SITES: Array<[string, Record<string, Rule>, string]> = [
    ['countProjectedPeriods (redelivery check)', EXISTING(0), `${PPI}:select:1`],
    ['findContactIdForOwner', FIRST, `${SB}:select:2`],
    ['findOldestActivePlanIdForService', FIRST, `${PPL}:select:1`],
    ['insertProjectedPeriods', FIRST, `${PPI}:insert`],
    ['linkPaymentPlan', FIRST, `${SB}:update`],
    ['insertProjectedPeriods (repair)', EXISTING(0), `${PPI}:insert`],
  ];
  const cases = SITES.flatMap(([site, rules, key]) => [
    [`${site}: rejects`, { ...rules, [key]: rejects() }, key, 'socket hang up'] as const,
    [`${site}: throws synchronously`, { ...rules, [key]: throwsSync() }, key, 'sync explode'] as const,
  ]);

  it.each(cases)('%s', async (_site, rules, key, message) => {
    reset(rules);
    await expect(bindPlanSubscription(input())).rejects.toThrow(message);
    expect(opKeys().at(-1)).toBe(key.split(':').slice(0, 2).join(':'));
    // Nothing logged about the failure here: the caller's catch owns that.
    expect(mockLogs.filter((l) => l.level === 'error')).toEqual([]);
  });

  it('a rejected redelivery count stops before Stripe is touched', async () => {
    reset({ ...EXISTING(0), [`${PPI}:select:1`]: rejects() });
    await expect(bindPlanSubscription(input())).rejects.toThrow('socket hang up');
    expect(mockStripe).toEqual([]);
  });
});

describe('QA CF-5 PR 4: returned errors keep their old handling in bind', () => {
  it('a redelivery with periods already projected does nothing more (count read head-only, by our plan row id)', async () => {
    reset(EXISTING(3));
    await expect(bindPlanSubscription(input())).resolves.toEqual({ scheduleId: 'sched_ex', planId: 'plan-ex', alreadyBound: true });
    expect(opKeys()).toEqual([`${PLANS}:select`, `${PPI}:select`]);
    expect(only(PPI, 'select')[0].chain).toEqual([['select', 'id', { count: 'exact', head: true }], ['eq', 'subscription_id', 'plan-ex']]);
  });

  it.each([
    ['count 0', 0],
    ['count null', null],
  ])('a recorded plan with %s is repaired, not frozen', async (_c, count) => {
    reset(EXISTING(count));
    await bindPlanSubscription(input());
    expect(only(PPI, 'insert')).toHaveLength(1);
    expect(mockStripe).toEqual([]);
  });

  it('a returned count error reads as 0 (repair), as inline', async () => {
    reset({ ...EXISTING(null), [`${PPI}:select:1`]: dbError('count failed') });
    await bindPlanSubscription(input());
    expect(only(PPI, 'insert')).toHaveLength(1);
  });

  it('an insert error is logged and the booking is still linked, scoped to the owner', async () => {
    reset({ ...FIRST, [`${PPI}:insert`]: dbError('insert failed') });
    await expect(bindPlanSubscription(input())).resolves.toMatchObject({ planId: 'plan-new' });
    expect(messages()).toContain('Plan recorded but periods not projected');
    const [link] = only(SB, 'update');
    expect(link.chain[0]).toEqual(['update', { payment_plan_id: 'pp-oldest', updated_at: expect.any(String) }]);
    expect(filters(link)).toEqual([['eq', 'id', BK], ['eq', 'user_id', 'owner-a']]);
  });

  it('a link error is logged and bind resolves', async () => {
    reset({ ...FIRST, [`${SB}:update`]: dbError('link failed') });
    await expect(bindPlanSubscription(input())).resolves.toMatchObject({ planId: 'plan-new', alreadyBound: false });
    expect(messages()).toContain('Plan periods written but the booking was not linked to its plan');
  });

  it('a contact read error is a warning, and the plan and periods carry no contact', async () => {
    reset({ ...FIRST, [`${SB}:select:2`]: dbError('contact read failed') });
    await bindPlanSubscription(input());
    expect(messages()).toContain('Could not resolve the contact for this plan');
    expect((only(PLANS, 'insert')[0].chain[0][1] as Record<string, unknown>).contact_id).toBeNull();
    const rows = only(PPI, 'insert')[0].chain[0][1] as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.contact_id === null)).toBe(true);
  });

  it('no active plan for the service: nothing projected, logged', async () => {
    reset({ ...FIRST, [`${PPL}:select:1`]: ok(null) });
    await bindPlanSubscription(input());
    expect(only(PPI, 'insert')).toEqual([]);
    expect(only(SB, 'update')).toEqual([]);
    expect(messages()).toContain('No payment_plans row for this sale — periods cannot be projected');
  });
});

describe('QA CF-5 PR 4: bind reads and writes only the proved owner', () => {
  it('the contact read and the plan fallback are scoped to the owner, with the fallback chain intact', async () => {
    reset(FIRST);
    await bindPlanSubscription(input());
    const contact = only(SB, 'select')[1];
    expect(contact.chain).toEqual([['select', 'contact_id'], ['eq', 'id', BK], ['eq', 'user_id', 'owner-a']]);
    const fallback = only(PPL, 'select')[0];
    expect(fallback.chain).toEqual([
      ['select', 'id'],
      ['eq', 'user_id', 'owner-a'],
      ['eq', 'service_id', SV],
      ['eq', 'is_active', true],
      ['order', 'created_at', { ascending: true }],
      ['limit', 1],
    ]);
  });

  it('every projected period carries the owner, our plan row and the vetted links, and nothing else', async () => {
    reset(FIRST);
    await bindPlanSubscription(input());
    const rows = only(PPI, 'insert')[0].chain[0][1] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    for (const [i, r] of rows.entries()) {
      expect(Object.keys(r)).toEqual([
        'user_id', 'payment_plan_id', 'subscription_id', 'booking_id', 'contact_id',
        'installment_number', 'amount', 'currency', 'due_date', 'status',
      ]);
      expect(r).toMatchObject({
        user_id: 'owner-a', payment_plan_id: 'pp-oldest', subscription_id: 'plan-new', booking_id: BK,
        contact_id: 'contact-9', installment_number: i + 1, currency: 'USD', status: 'pending',
      });
    }
  });

  it('foreign links are dropped: no contact read, no fallback by a foreign service, no booking link', async () => {
    reset({ ...FIRST, [`${SB}:select:1`]: ok(null), [`${SS}:select:1`]: ok(null) });
    await bindPlanSubscription(input());
    expect(only(SB, 'select')).toHaveLength(1); // the ownership read only
    expect(only(PPL, 'select')).toEqual([]);
    expect(only(SB, 'update')).toEqual([]);
    expect(only(PPI, 'insert')).toEqual([]);
  });
});
