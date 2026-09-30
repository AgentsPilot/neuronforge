/**
 * The credit leak check (credit deduction slice 4b, workplan §5, §10.2):
 * every case of the §5.2 table, the tolerance edge (S-2), the midnight example
 * (B-1), the shared insight run id (V-10), a reused onboarding group, the
 * period (S-4), known paths (S-3), the account walk (S-1), the deadline, a
 * failed read, a ceiling, and the logs.
 *
 * Pure fakes: no database, no logger module.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import {
  classifyLeakGroups,
  creditPeriodStartAt,
  isKnownUnchargedPath,
  leakTolerance,
  LEAK_BLIND_SPOTS,
  LEAK_CHECK_LIMITS,
  previousUtcDay,
  runCreditLeakCheck,
  type CreditLeakCheckDeps,
  type CreditLeakCheckInput,
} from '../creditLeakCheck';
import type { LedgerCallRow } from '@/lib/repositories/TokenUsageRepository';
import type { CreditLedgerRow } from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import type { Logger } from '@/lib/logger';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const G1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const G2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const G3 = 'aaaaaaaa-0000-4000-8000-000000000003';

const S = Date.parse('2026-09-28T00:00:00.000Z');
const E = Date.parse('2026-09-29T00:00:00.000Z');
const WINDOW = { startMs: S, endMs: E };
const PLAN_PERIOD = '2026-09-23T19:55:01.28632+00:00';

let seq = 0;
function usage(
  session: string | null,
  at: string,
  cost: number | string | null,
  extra: Partial<LedgerCallRow> = {}
): LedgerCallRow {
  seq += 1;
  return {
    id: `u-${seq}`,
    created_at: at,
    feature: 'business-os-chat',
    component: 'planner',
    session_id: session,
    input_tokens: 100,
    output_tokens: 20,
    cost_usd: cost,
    success: true,
    error_code: null,
    ...extra,
  };
}

function charge(group: string | null, at: string, cost: number | string, extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  seq += 1;
  const n = String(seq).padStart(12, '0');
  return {
    id: `c-${seq}`,
    kind: 'charge',
    action_id: `cccccccc-0000-4000-8000-${n}`,
    adjusts_action_id: null,
    reason_code: null,
    user_id: A,
    period_start: PLAN_PERIOD,
    group_id: group,
    credits: String(Number(cost) * 1000),
    cost_usd: cost,
    credit_value_version: 0,
    is_fallback_priced: false,
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: at,
    ...extra,
  };
}

const periodOf = (atMs: number) => creditPeriodStartAt('2026-08-23T19:55:01.286Z', atMs);

function classify(usageRows: LedgerCallRow[], ledgerRows: CreditLedgerRow[], accountId = A) {
  return classifyLeakGroups({ accountId, usageRows, ledgerRows, window: WINDOW, periodOf });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the tolerance (SA S-2)', () => {
  it('is one micro-dollar per call plus 1e-9', () => {
    expect(leakTolerance(0)).toBe(1e-9);
    expect(leakTolerance(3)).toBeCloseTo(3e-6 + 1e-9, 15);
  });

  it('exactly T is matched; T + 1e-9 is under-charged', () => {
    const t = leakTolerance(1);
    const atT = classify([usage(G1, '2026-09-28T10:00:00Z', t)], [charge(G1, '2026-09-28T10:00:01Z', 0)]);
    expect(atT.cases.get(G1)).toBe('matched');

    const past = classify([usage(G1, '2026-09-28T10:00:00Z', t + 1e-9)], [charge(G1, '2026-09-28T10:00:01Z', 0)]);
    expect(past.cases.get(G1)).toBe('undercharged');
  });

  it('holds whether token_usage rounded or truncated the micro-dollars (per-call slack)', () => {
    // Three calls whose true cost was 0.0000019 each: rounded they read 0.000002,
    // truncated 0.000001. The charge keeps 10 decimals: 0.0000057.
    const rows = (each: number) => [1, 2, 3].map((i) => usage(G1, `2026-09-28T10:00:0${i}Z`, each));
    expect(classify(rows(0.000002), [charge(G1, '2026-09-28T10:00:05Z', 0.0000057)]).cases.get(G1)).toBe('matched');
    expect(classify(rows(0.000001), [charge(G1, '2026-09-28T10:00:05Z', 0.0000057)]).cases.get(G1)).toBe('matched');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('§5.2 — every case, one test each', () => {
  it('matched: a charge equal to the usage', () => {
    const r = classify(
      [usage(G1, '2026-09-28T10:00:00Z', '0.001000'), usage(G1, '2026-09-28T10:00:01Z', '0.002000')],
      [charge(G1, '2026-09-28T10:00:02Z', '0.0030000000')]
    );
    expect(r.cases.get(G1)).toBe('matched');
    expect(r.counts).toMatchObject({ groupsExamined: 1, matched: 1, uncharged: 0, undercharged: 0 });
  });

  it('uncharged: usage and no charge at all is a leak, with its USD', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.0009)], []);
    expect(r.cases.get(G1)).toBe('uncharged');
    expect(r.counts.uncharged).toBe(1);
    expect(r.usd.uncharged).toBeCloseTo(0.0009, 12);
    expect(r.examples.uncharged[0]).toMatchObject({ groupId: G1, calls: 1, chargedUsd: 0 });
  });

  it('uncharged by PRESENCE: an embedding-only group recorded at $0 is still found (V-6)', () => {
    const r = classify(
      [usage(G1, '2026-09-28T10:00:00Z', '0.000000', { component: 'plan_cache_lookup_embedding', input_tokens: 8, output_tokens: 0 })],
      []
    );
    expect(r.cases.get(G1)).toBe('uncharged');
    expect(r.usd.uncharged).toBe(0);
  });

  it('no-spend: zero tokens and zero cost, no charge (the plan-cache marker) is informational', () => {
    const r = classify(
      [usage(G1, '2026-09-28T10:00:00Z', 0, { component: 'BizQLPlanCache', input_tokens: 0, output_tokens: 0 })],
      []
    );
    expect(r.cases.get(G1)).toBe('no_spend');
    expect(r.counts).toMatchObject({ noSpend: 1, uncharged: 0 });
  });

  it('ungrouped: a NULL session_id call with spend is counted separately (S-3); without spend it is not', () => {
    const r = classify(
      [
        usage(null, '2026-09-28T10:00:00Z', 0.0004),
        usage(null, '2026-09-28T11:00:00Z', 0, { input_tokens: 0, output_tokens: 0 }),
        // Outside the window: not this night's.
        usage(null, '2026-09-27T23:30:00Z', 0.0004),
      ],
      []
    );
    expect(r.counts.ungroupedCalls).toBe(1);
    expect(r.counts.groupsExamined).toBe(0);
    expect(r.usd.ungrouped).toBeCloseTo(0.0004, 12);
    expect(r.leakPeriodStarts).toEqual([periodOf(Date.parse('2026-09-28T10:00:00Z'))]);
  });

  it('under-charged: a charge below the usage by more than T', () => {
    const r = classify(
      [usage(G1, '2026-09-28T10:00:00Z', 0.002), usage(G1, '2026-09-28T10:00:01Z', 0.003)],
      [charge(G1, '2026-09-28T10:00:02Z', 0.002)]
    );
    expect(r.cases.get(G1)).toBe('undercharged');
    expect(r.usd.undercharged).toBeCloseTo(0.003, 12);
  });

  it('pending reconciliation, over: a fallback-priced charge above the usage is NOT a leak (SQ-13 (3))', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.001)], [charge(G1, '2026-09-28T10:00:02Z', 0.004, { is_fallback_priced: true })]);
    expect(r.cases.get(G1)).toBe('pending_reconciliation');
    expect(r.counts).toMatchObject({ pendingReconciliation: 1, pendingUndercharged: 0, undercharged: 0 });
    expect(r.examples.pendingReconciliation[0].direction).toBe('over');
  });

  it('pending reconciliation, under (N-8, BQ-4): shown with its direction, never hidden as matched', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.009)], [charge(G1, '2026-09-28T10:00:02Z', 0.004, { is_fallback_priced: true })]);
    expect(r.cases.get(G1)).toBe('pending_reconciliation');
    expect(r.counts).toMatchObject({ pendingReconciliation: 1, pendingUndercharged: 1, matched: 0, undercharged: 0 });
    expect(r.examples.pendingReconciliation[0].direction).toBe('under');
  });

  it('a fallback-priced charge within T of the usage is simply matched', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.001)], [charge(G1, '2026-09-28T10:00:02Z', 0.001, { is_fallback_priced: true })]);
    expect(r.cases.get(G1)).toBe('matched');
  });

  it('charged above recorded usage, nothing fallback-priced: informational', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.001)], [charge(G1, '2026-09-28T10:00:02Z', 0.003)]);
    expect(r.cases.get(G1)).toBe('charged_above_usage');
    expect(r.counts).toMatchObject({ chargedAboveUsage: 1, uncharged: 0, undercharged: 0 });
  });

  it('known uncharged path (S-3, KI-6): own bucket with feature and component, never a leak or "ungrouped"', () => {
    expect(isKnownUnchargedPath('business-os-chat', 'IntentParser')).toBe(true);
    // Only under its own area, and only for entries exempt from missing_group_id.
    expect(isKnownUnchargedPath('business-os-insights', 'IntentParser')).toBe(false);
    expect(isKnownUnchargedPath('business-os-chat', 'BizQLPlanCache')).toBe(false);

    const r = classify(
      [
        usage(null, '2026-09-28T10:00:00Z', 0.0007, { component: 'IntentParser' }),
        usage(null, '2026-09-28T10:05:00Z', 0.0003, { component: 'IntentParser' }),
        usage(null, '2026-09-27T22:00:00Z', 0.0003, { component: 'IntentParser' }), // slack: not this window's
      ],
      []
    );
    expect(r.counts).toMatchObject({ knownPathCalls: 2, ungroupedCalls: 0, uncharged: 0 });
    expect(r.knownPaths).toEqual([{ feature: 'business-os-chat', component: 'IntentParser', calls: 2, usageUsd: 0.001 }]);
    expect(r.usd.totalUncharged).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B-1: a group is examined on ANY activity in the window; slack only matches', () => {
  // Chat group G: turn A at 23:40 on D−1, charged; turn B at 00:20 on D.
  const turnA = () => usage(G1, '2026-09-27T23:40:00.000Z', 0.002);
  const chargeA = () => charge(G1, '2026-09-27T23:40:05.000Z', 0.002);
  const turnB = () => usage(G1, '2026-09-28T00:20:00.000Z', 0.001);
  const chargeB = () => charge(G1, '2026-09-28T00:20:04.000Z', 0.001);

  it('turn B lost its charge → day D reports G as under-charged by B', () => {
    const r = classify([turnA(), turnB()], [chargeA()]);
    expect(r.cases.get(G1)).toBe('undercharged');
    expect(r.usd.undercharged).toBeCloseTo(0.001, 12);
    expect(r.examples.undercharged[0]).toMatchObject({ groupId: G1, calls: 2, firstCallAt: '2026-09-27T23:40:00.000Z' });
  });

  it('turn B charged too → matched, not reported', () => {
    const r = classify([turnA(), turnB()], [chargeA(), chargeB()]);
    expect(r.cases.get(G1)).toBe('matched');
    expect(r.counts.undercharged).toBe(0);
  });

  it('the night before (D−1) sees the same discrepancy through its upper slack: reported on two nights, as stated', () => {
    const r = classifyLeakGroups({
      accountId: A,
      usageRows: [turnA(), turnB()],
      ledgerRows: [chargeA()],
      window: { startMs: S - 86_400_000, endMs: S },
      periodOf,
    });
    expect(r.cases.get(G1)).toBe('undercharged');
    expect(LEAK_BLIND_SPOTS).toContain('edge_of_window');
  });

  it('a group whose only activity is in the slack is not examined', () => {
    const r = classify([turnA()], []);
    expect(r.counts.groupsExamined).toBe(0);
    expect(r.cases.has(G1)).toBe(false);
  });

  it('the window is [S, E): a row at exactly S is in, a row at exactly E is the next night’s (N-3)', () => {
    const atS = classify([usage(G1, '2026-09-28T00:00:00.000Z', 0.001)], []);
    expect(atS.cases.get(G1)).toBe('uncharged');
    const atE = classify([usage(G2, '2026-09-29T00:00:00.000Z', 0.001)], []);
    expect(atE.cases.has(G2)).toBe(false);
  });

  it('a group examined only because its CHARGE is in the window is matched against slack usage', () => {
    // Calls at 23:59:30 on D−1, charge at 00:00:10 on D.
    const r = classify([usage(G1, '2026-09-27T23:59:30.000Z', 0.001)], [charge(G1, '2026-09-28T00:00:10.000Z', 0.001)]);
    expect(r.cases.get(G1)).toBe('matched');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('reused groups and corrections', () => {
  it('three onboarding turns under one group id, two charges → under-charged by the third turn', () => {
    const onboarding = { feature: 'business-os-onboarding', component: 'business_story_extraction' };
    const r = classify(
      [
        usage(G1, '2026-09-28T09:00:00Z', 0.004, onboarding),
        usage(G1, '2026-09-28T09:10:00Z', 0.005, onboarding),
        usage(G1, '2026-09-28T09:20:00Z', 0.006, onboarding),
      ],
      [
        charge(G1, '2026-09-28T09:00:03Z', 0.004, { action_type: 'onboarding_turn' }),
        charge(G1, '2026-09-28T09:10:03Z', 0.005, { action_type: 'onboarding_turn' }),
      ]
    );
    expect(r.cases.get(G1)).toBe('undercharged');
    expect(r.usd.undercharged).toBeCloseTo(0.006, 12);
  });

  it('an adjustment inherits its charge’s service and group (N-10) and nets against it', () => {
    const original = charge(G1, '2026-09-28T10:00:02Z', 0.01, { is_fallback_priced: true });
    const adjustment = charge(null, '2026-09-28T12:00:00Z', -0.006, {
      kind: 'adjustment',
      action_id: null,
      adjusts_action_id: original.action_id,
      reason_code: 'fallback_price_reconciled',
      service: null,
      action_type: null,
      triggered_by: null,
      outcome: null,
      is_fallback_priced: false,
    });
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.004)], [original, adjustment]);
    expect(r.cases.get(G1)).toBe('matched');
  });

  it('an adjustment whose charge was not read is unresolved: counted, never compared', () => {
    const orphan = charge(G1, '2026-09-28T12:00:00Z', -0.5, {
      kind: 'adjustment',
      action_id: null,
      adjusts_action_id: 'cccccccc-0000-4000-8000-999999999999',
      service: null,
    });
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.001)], [charge(G1, '2026-09-28T10:00:02Z', 0.001), orphan]);
    expect(r.counts.unresolvedCorrections).toBe(1);
    expect(r.cases.get(G1)).toBe('matched');
  });

  it('a row of another effective service is not compared with token_usage (BD-13)', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.001)], [charge(G1, '2026-09-28T10:00:02Z', 0.5, { service: 'sms_fixture' })]);
    expect(r.cases.get(G1)).toBe('uncharged');
  });

  it('a ledger row of another account is never matched (defence in depth: the read is account-scoped)', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.001)], [charge(G1, '2026-09-28T10:00:02Z', 0.001, { user_id: B })]);
    expect(r.cases.get(G1)).toBe('uncharged');
  });

  it('an unreadable amount is counted, never silent', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 'garbage')], [charge(G1, '2026-09-28T10:00:02Z', 'also-garbage')]);
    expect(r.counts.unreadableAmounts).toBe(2);
  });

  it('keeps at most EXAMPLES_PER_CASE examples per case but counts every group', () => {
    const rows = Array.from({ length: 25 }, (_v, i) =>
      usage(`bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-09-28T10:00:00Z', 0.001)
    );
    const r = classify(rows, []);
    expect(r.counts.uncharged).toBe(25);
    expect(r.examples.uncharged).toHaveLength(LEAK_CHECK_LIMITS.EXAMPLES_PER_CASE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the period (S-4): the RPC’s own rule', () => {
  it('a charged group takes its charge’s stored period_start, verbatim', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.003)], [charge(G1, '2026-09-28T10:00:02Z', 0.001)]);
    expect(r.examples.undercharged[0].periodStart).toBe(PLAN_PERIOD);
    expect(r.leakPeriodStart).toBe(PLAN_PERIOD);
  });

  it('an uncharged group takes the plan anchor’s period at its first in-window call', () => {
    const r = classify([usage(G1, '2026-09-28T10:00:00Z', 0.003)], []);
    expect(r.examples.uncharged[0].periodStart).toBe('2026-09-23T19:55:01.286Z');
  });

  it.each([
    ['anchor day inside this month', '2026-08-23T19:55:01.286Z', '2026-09-28T10:00:00Z', '2026-09-23T19:55:01.286Z'],
    ['before this month’s anchor day → last month’s', '2026-08-23T19:55:01.286Z', '2026-09-20T10:00:00Z', '2026-08-23T19:55:01.286Z'],
    ['same day, before the anchor time → last month’s', '2026-08-23T19:55:01.286Z', '2026-09-23T19:55:01.000Z', '2026-08-23T19:55:01.286Z'],
    ['anchor on the 31st, clamped into February', '2026-01-31T08:00:00.000Z', '2026-02-28T09:00:00.000Z', '2026-02-28T08:00:00.000Z'],
    ['anchor on the 31st, the day before the clamp point', '2026-01-31T08:00:00.000Z', '2026-02-28T07:00:00.000Z', '2026-01-31T08:00:00.000Z'],
    ['across a year', '2025-12-15T00:00:00.000Z', '2026-01-10T00:00:00.000Z', '2025-12-15T00:00:00.000Z'],
  ])('%s', (_name, anchor, at, expected) => {
    expect(creditPeriodStartAt(anchor, Date.parse(at))).toBe(expected);
  });

  it('no plan row → the UTC calendar month (the RPC’s calendar_month branch)', () => {
    expect(creditPeriodStartAt(null, Date.parse('2026-09-28T23:59:59Z'))).toBe('2026-09-01T00:00:00.000Z');
  });

  it('an unreadable anchor gives no period rather than a wrong one', () => {
    expect(creditPeriodStartAt('not-a-date', Date.parse('2026-09-28T10:00:00Z'))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The runner
// ─────────────────────────────────────────────────────────────────────────────

interface FakeLogger {
  logger: Logger;
  lines: Array<{ level: string; fields: Record<string, unknown>; msg: string }>;
}
function fakeLogger(): FakeLogger {
  const lines: FakeLogger['lines'] = [];
  const at = (level: string) => (fields: Record<string, unknown>, msg: string) => lines.push({ level, fields, msg });
  const logger = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') } as unknown as Logger;
  return { logger, lines };
}

interface FakeData {
  plans?: Array<{ user_id: string; period_anchor: string | null }>;
  totals?: Array<{ user_id: string }>;
  usage?: Record<string, LedgerCallRow[]>;
  ledger?: Record<string, CreditLedgerRow[]>;
}

function fakeDeps(data: FakeData, overrides: Partial<CreditLeakCheckDeps> = {}) {
  const calls = {
    usage: [] as Array<{ userId: string; start: string; end: string }>,
    ledger: [] as Array<{ userId: string; from: string; to: string }>,
    platform: [] as Array<{ ids: readonly string[]; kind: string }>,
    totals: [] as Array<{ from: string; to: string }>,
    plans: 0,
    findAnchor: [] as string[],
  };
  let clock = Date.parse('2026-09-29T04:45:00.000Z');
  const deps: CreditLeakCheckDeps = {
    async pagePlanAnchors() {
      calls.plans += 1;
      return { data: data.plans ?? [], error: null };
    },
    async findPlanAnchor(accountId) {
      calls.findAnchor.push(accountId);
      const plan = (data.plans ?? []).find((p) => p.user_id === accountId);
      return { data: { found: !!plan, periodAnchor: plan?.period_anchor ?? null }, error: null };
    },
    async listTotalsForPeriodsInRange(range) {
      calls.totals.push({ from: range.from.toISOString(), to: range.to.toISOString() });
      const rows = (data.totals ?? []).map((t) => ({ user_id: t.user_id, period_start: PLAN_PERIOD })) as never;
      return { data: { rows, reachedCeiling: false }, error: null };
    },
    async listLedgerRowsForAccount(userId, range) {
      calls.ledger.push({ userId, from: range.from.toISOString(), to: range.to.toISOString() });
      return { data: { rows: data.ledger?.[userId] ?? [], reachedCeiling: false }, error: null };
    },
    async listUsageCallsForAccount(userId, window) {
      calls.usage.push({ userId, start: window.start.toISOString(), end: window.end.toISOString() });
      return { data: { rows: data.usage?.[userId] ?? [], reachedCeiling: false }, error: null };
    },
    async countPlatformCalls(ids, _window, match) {
      calls.platform.push({ ids, kind: match.kind });
      return { data: match.kind === 'label' ? 2 : 7, error: null };
    },
    now: () => new Date(clock),
    ...overrides,
  };
  return { deps, calls, advance: (ms: number) => (clock += ms) };
}

const NIGHTLY: CreditLeakCheckInput = {
  window: { start: new Date(S), end: new Date(E) },
  accountId: null,
  deadlineAt: Date.parse('2026-09-29T04:45:45.000Z'),
  trigger: 'nightly',
};

describe('runCreditLeakCheck — the walk (S-1) and the reads', () => {
  it('walks plan accounts ∪ charged accounts without a plan, never the platform account, in id order', async () => {
    const { deps, calls } = fakeDeps({
      plans: [{ user_id: B, period_anchor: '2026-08-23T19:55:01.286Z' }, { user_id: PLATFORM, period_anchor: null }],
      totals: [{ user_id: C }, { user_id: B }],
    });
    const result = await runCreditLeakCheck(NIGHTLY, deps, fakeLogger().logger);
    expect(calls.usage.map((c) => c.userId)).toEqual([B, C]);
    expect(result.accountsChecked).toBe(2);
    expect(result.listing).toEqual({ planAccounts: 2, chargedWithoutPlan: 1, plans: 'ok', totals: 'ok' });
    // Totals overlapping the window: a period starts at most 31 days earlier.
    expect(calls.totals).toEqual([{ from: '2026-08-28T00:00:00.000Z', to: '2026-09-29T00:00:00.000Z' }]);
  });

  it('reads usage from S − 1 h − 300 s to E + 1 h − 1 ms (inclusive, N-3), charges from S − 1 h to E + 1 h + 300 s (B-1)', async () => {
    const { deps, calls } = fakeDeps({ plans: [{ user_id: A, period_anchor: null }] });
    await runCreditLeakCheck(NIGHTLY, deps, fakeLogger().logger);
    expect(calls.usage).toEqual([{ userId: A, start: '2026-09-27T22:55:00.000Z', end: '2026-09-29T00:59:59.999Z' }]);
    expect(calls.ledger).toEqual([{ userId: A, from: '2026-09-27T23:00:00.000Z', to: '2026-09-29T01:05:00.000Z' }]);
  });

  it('one account: reads only that account and its plan anchor, never a listing or the platform count', async () => {
    const { deps, calls } = fakeDeps({ plans: [{ user_id: A, period_anchor: null }] });
    const result = await runCreditLeakCheck({ ...NIGHTLY, accountId: A, trigger: 'on_demand' }, deps, fakeLogger().logger);
    expect(calls.plans).toBe(0);
    expect(calls.totals).toEqual([]);
    expect(calls.platform).toEqual([]);
    expect(calls.findAnchor).toEqual([A]);
    expect(calls.usage.map((c) => c.userId)).toEqual([A]);
    expect(result.platform.businessOsCalls).toBeNull();
  });

  it('counts platform-account Business OS calls AND the helper label (Q-9), counts only', async () => {
    const { deps, calls } = fakeDeps({});
    const result = await runCreditLeakCheck(NIGHTLY, deps, fakeLogger().logger);
    expect(calls.platform.map((c) => c.kind).sort()).toEqual(['label', 'row_filter']);
    expect(calls.platform[0].ids).toContain(PLATFORM);
    expect(result.platform).toMatchObject({ businessOsCalls: 7, helperLabelCalls: 2 });
  });

  it('shared insight run id (V-10): the same group on two accounts, one charged → only the other is flagged', async () => {
    const { deps } = fakeDeps({
      plans: [
        { user_id: A, period_anchor: null },
        { user_id: B, period_anchor: null },
      ],
      usage: {
        [A]: [usage(G3, '2026-09-28T03:30:10Z', 0.002, { feature: 'business-os-insights', component: 'insight_content' })],
        [B]: [usage(G3, '2026-09-28T03:31:10Z', 0.002, { feature: 'business-os-insights', component: 'insight_content' })],
      },
      ledger: { [A]: [charge(G3, '2026-09-28T03:30:12Z', 0.002, { action_type: 'insight_run', triggered_by: 'scheduled' })] },
    });
    const result = await runCreditLeakCheck(NIGHTLY, deps, fakeLogger().logger);
    expect(result.accounts.map((a) => [a.accountId, a.status])).toEqual([[B, 'leak']]);
    expect(result.totals).toMatchObject({ unchargedGroups: 1, matchedGroups: 1 });
    expect(result.accounts[0].periodStart).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('runCreditLeakCheck — never "clean" when it could not look', () => {
  it('one account’s token_usage read fails → "could not check", the others are still checked', async () => {
    const { deps } = fakeDeps(
      { plans: [{ user_id: A, period_anchor: null }, { user_id: B, period_anchor: null }], usage: { [B]: [usage(G1, '2026-09-28T10:00:00Z', 0.001)] } },
      {
        async listUsageCallsForAccount(userId) {
          if (userId === A) return { data: null, error: new Error('db down') };
          return { data: { rows: [usage(G1, '2026-09-28T10:00:00Z', 0.001)], reachedCeiling: false }, error: null };
        },
      }
    );
    const { logger, lines } = fakeLogger();
    const result = await runCreditLeakCheck(NIGHTLY, deps, logger);
    expect(result.accounts.find((a) => a.accountId === A)).toMatchObject({ status: 'could_not_check', reasons: ['usage_read_failed'] });
    expect(result.accounts.find((a) => a.accountId === B)?.status).toBe('leak');
    expect(result.accountsNotChecked).toBe(1);
    expect(lines.filter((l) => l.fields.event === 'bos_credit_leak_account_not_checked')).toHaveLength(1);
  });

  it('a read that throws is caught the same way (the runner never throws)', async () => {
    const { deps } = fakeDeps(
      { plans: [{ user_id: A, period_anchor: null }] },
      {
        async listLedgerRowsForAccount() {
          throw new Error('exploded');
        },
      }
    );
    const result = await runCreditLeakCheck(NIGHTLY, deps, fakeLogger().logger);
    expect(result.accounts[0]).toMatchObject({ status: 'could_not_check', reasons: ['ledger_read_failed'] });
  });

  it('a ceiling → "incomplete", never a leak and never clean, and no error log', async () => {
    const { deps } = fakeDeps(
      { plans: [{ user_id: A, period_anchor: null }] },
      {
        async listUsageCallsForAccount() {
          return { data: { rows: [usage(G1, '2026-09-28T10:00:00Z', 0.001)], reachedCeiling: true }, error: null };
        },
      }
    );
    const { logger, lines } = fakeLogger();
    const result = await runCreditLeakCheck(NIGHTLY, deps, logger);
    expect(result.accounts[0]).toMatchObject({ status: 'incomplete', reasons: ['usage_ceiling'] });
    expect(result.accountsWithLeak).toBe(0);
    expect(result.accountsIncomplete).toBe(1);
    expect(lines.some((l) => l.level === 'error')).toBe(false);
  });

  it('the deadline stops STARTING accounts and reports accountsRemaining', async () => {
    const plans = [A, B, C].map((user_id) => ({ user_id, period_anchor: null }));
    const fake = fakeDeps({ plans });
    const deps: CreditLeakCheckDeps = {
      ...fake.deps,
      async listUsageCallsForAccount(...args) {
        fake.advance(30_000); // each account takes 30 s
        return fake.deps.listUsageCallsForAccount(...args);
      },
    };
    const result = await runCreditLeakCheck(NIGHTLY, deps, fakeLogger().logger);
    expect(result.accountsChecked).toBe(2);
    expect(result.accountsRemaining).toBe(1);
    expect(result.deadlineReached).toBe(true);
  });

  it('a failed plan listing is reported (listingFailed) and the charged accounts are still walked', async () => {
    const { deps, calls } = fakeDeps(
      { totals: [{ user_id: C }] },
      {
        async pagePlanAnchors() {
          return { data: null, error: new Error('plans down') };
        },
      }
    );
    const result = await runCreditLeakCheck(NIGHTLY, deps, fakeLogger().logger);
    expect(result.listingFailed).toBe(true);
    expect(result.listing.plans).toBe('failed');
    expect(calls.usage.map((c) => c.userId)).toEqual([C]);
  });

  it('pages the plan rows by the last id', async () => {
    const page1 = Array.from({ length: LEAK_CHECK_LIMITS.PLAN_PAGE_SIZE }, (_v, i) => ({
      user_id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
      period_anchor: null,
    }));
    const afters: Array<string | null> = [];
    const fake = fakeDeps({});
    const deps: CreditLeakCheckDeps = {
      ...fake.deps,
      async pagePlanAnchors(after) {
        afters.push(after);
        return { data: after === null ? page1 : [{ user_id: A, period_anchor: null }], error: null };
      },
      now: () => new Date(Date.parse('2026-09-29T04:45:00.000Z')),
    };
    const result = await runCreditLeakCheck({ ...NIGHTLY, deadlineAt: Number.MAX_SAFE_INTEGER }, deps, fakeLogger().logger);
    expect(afters).toEqual([null, page1[page1.length - 1].user_id]);
    expect(result.accountsChecked).toBe(LEAK_CHECK_LIMITS.PLAN_PAGE_SIZE + 1);
  });
});

describe('runCreditLeakCheck — the logs (S-3, S-4, BQ-2)', () => {
  it('one error per leaking account, with account, period, window, group ids and one USD figure; no owner text', async () => {
    const { deps } = fakeDeps({
      plans: [{ user_id: A, period_anchor: '2026-08-23T19:55:01.286Z' }],
      usage: { [A]: [usage(G1, '2026-09-28T10:00:00Z', 0.0009), usage(null, '2026-09-28T11:00:00Z', 0.0001)] },
    });
    const { logger, lines } = fakeLogger();
    const result = await runCreditLeakCheck(NIGHTLY, deps, logger);
    const errors = lines.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].fields).toEqual({
      event: 'bos_credit_leak_found',
      trigger: 'nightly',
      accountId: A,
      periodStart: '2026-09-23T19:55:01.286Z',
      periodStarts: ['2026-09-23T19:55:01.286Z'],
      windowStart: '2026-09-28T00:00:00.000Z',
      windowEnd: '2026-09-29T00:00:00.000Z',
      unchargedGroups: 1,
      ungroupedCalls: 1,
      underchargedGroups: 0,
      unchargedCostUsd: 0.001,
      groupIds: [G1],
    });
    expect(result.accounts[0]).toMatchObject({ accountId: A, status: 'leak', periodStart: '2026-09-23T19:55:01.286Z' });
    expect(result.totals.unchargedUsd).toBe(0.001);
  });

  it('a known path is ONE warn per run, across accounts — never an error (S-3)', async () => {
    const intent = (at: string) => usage(null, at, 0.0002, { component: 'IntentParser' });
    const { deps } = fakeDeps({
      plans: [{ user_id: A, period_anchor: null }, { user_id: B, period_anchor: null }],
      usage: { [A]: [intent('2026-09-28T10:00:00Z')], [B]: [intent('2026-09-28T11:00:00Z'), intent('2026-09-28T12:00:00Z')] },
    });
    const { logger, lines } = fakeLogger();
    const result = await runCreditLeakCheck(NIGHTLY, deps, logger);
    expect(lines.some((l) => l.level === 'error')).toBe(false);
    const warns = lines.filter((l) => l.fields.event === 'bos_credit_leak_known_path');
    expect(warns).toHaveLength(1);
    expect(warns[0].level).toBe('warn');
    expect(warns[0].fields.paths).toEqual([{ feature: 'business-os-chat', component: 'IntentParser', calls: 3, accounts: 2 }]);
    expect(result.accountsWithLeak).toBe(0);
    // Shown on the admin page: both accounts carry the finding.
    expect(result.accounts.map((a) => a.status)).toEqual(['clean', 'clean']);
    expect(result.totals.knownPathCalls).toBe(3);
  });

  it('one info summary, counts only', async () => {
    const { deps } = fakeDeps({});
    const { logger, lines } = fakeLogger();
    await runCreditLeakCheck(NIGHTLY, deps, logger);
    const info = lines.filter((l) => l.level === 'info');
    expect(info).toHaveLength(1);
    expect(info[0].fields).toMatchObject({ event: 'bos_credit_leak_check_completed', accountsChecked: 0, accountsWithLeak: 0 });
  });
});

describe('runCreditLeakCheck — the window', () => {
  it('pulls an end later than now − 6 min back, so an action still running is not reported (endClamped)', async () => {
    const { deps } = fakeDeps({
      plans: [{ user_id: A, period_anchor: null }],
      // Calls written 2 minutes ago; the charge will come at the end of the action.
      usage: { [A]: [usage(G1, '2026-09-29T04:43:00.000Z', 0.001)] },
    });
    const result = await runCreditLeakCheck(
      { ...NIGHTLY, window: { start: new Date(E), end: new Date(E + 86_400_000) }, trigger: 'on_demand' },
      deps,
      fakeLogger().logger
    );
    expect(result.endClamped).toBe(true);
    expect(result.window.end).toBe('2026-09-29T04:39:00.000Z');
    expect(result.accountsWithLeak).toBe(0);
  });

  it('CR4b-S1: the usage read never reaches past now − 6 min, so a reused group with an action still running is not reported', async () => {
    // Now is 04:45 on 09-29; on demand, `to` = today → the end is pulled back to 04:39.
    // Reused chat group G1: turn one at 04:00, charged; turn two started at 04:43
    // (now − 2 min), its calls are in token_usage, its charge is not written yet.
    const rows = [usage(G1, '2026-09-29T04:00:00.000Z', 0.002), usage(G1, '2026-09-29T04:43:00.000Z', 0.001)];
    const { deps, calls } = fakeDeps(
      {
        plans: [{ user_id: A, period_anchor: null }],
        ledger: { [A]: [charge(G1, '2026-09-29T04:00:05.000Z', 0.002)] },
      },
      {
        // This fake honours the read window (inclusive end, as `listCallsInWindow`).
        async listUsageCallsForAccount(userId, window) {
          calls.usage.push({ userId, start: window.start.toISOString(), end: window.end.toISOString() });
          const inRead = rows.filter((r) => {
            const t = Date.parse(r.created_at);
            return t >= window.start.getTime() && t <= window.end.getTime();
          });
          return { data: { rows: inRead, reachedCeiling: false }, error: null };
        },
      }
    );
    const log = fakeLogger();
    const result = await runCreditLeakCheck(
      { ...NIGHTLY, window: { start: new Date(E), end: new Date(E + 86_400_000) }, trigger: 'on_demand' },
      deps,
      log.logger
    );
    expect(result.window.end).toBe('2026-09-29T04:39:00.000Z');
    expect(calls.usage[0].end).toBe('2026-09-29T04:39:00.000Z');
    expect(result.accountsWithLeak).toBe(0);
    expect(result.totals.underchargedGroups).toBe(0);
    expect(log.lines.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  it('the nightly window is the previous whole UTC day', () => {
    expect(previousUtcDay(new Date('2026-09-29T04:45:00.000Z'))).toEqual({
      start: new Date('2026-09-28T00:00:00.000Z'),
      end: new Date('2026-09-29T00:00:00.000Z'),
    });
  });

  it('every result states the blind spots', async () => {
    const result = await runCreditLeakCheck(NIGHTLY, fakeDeps({}).deps, fakeLogger().logger);
    expect(result.blindSpots).toEqual([...LEAK_BLIND_SPOTS]);
    expect(result.blindSpots).toContain('no_plan_no_charge_account');
  });
});

describe('read-only, by construction', () => {
  it('the check module and its wiring name no write verb and no writer repository', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- source read
    const fs = require('fs') as typeof import('fs');
    for (const file of ['lib/business-os/credits/creditLeakCheck.ts', 'lib/business-os/credits/creditLeakCheckDeps.ts']) {
      const code = fs.readFileSync(file, 'utf8');
      expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
      // The ledger's writer (named only by its suffix: its own guard scans tests for the full name).
      expect(code).not.toMatch(/ChargeRepository/);
      expect(code).not.toMatch(/AuditTrail/);
      expect(code).not.toMatch(/console\./);
    }
  });
});
