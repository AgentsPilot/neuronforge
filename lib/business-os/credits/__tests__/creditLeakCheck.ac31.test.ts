/**
 * AC-31 (FR-33, SA-S9), with fakes: "The nightly leak check, run against a
 * test account with one deliberately unwrapped Business OS AI call and one
 * forced ledger-write failure, reports both as uncharged spend with the
 * account and period." Workplan §10.2.
 *
 *   (1) a Business OS call made OUTSIDE `runAiAction`: its `token_usage` row
 *       is written, and no charge is ever attempted;
 *   (2) an action run through the REAL `runAiAction` and the REAL charge
 *       recorder and writer repository, with the database refusing the charge
 *       (the service-role client's RPC returns a permission error).
 *
 * The `token_usage` rows are captured from the real provider layer's tracker
 * call, in the order it makes them. That is V-7 / Q-14: the row is written
 * before the call returns, so before the charge is attempted. The check then
 * reads those rows through fake repositories.
 */

const order: string[] = [];

// The service-role client: the charge RPC is refused, as a database would.
jest.mock('@/lib/supabaseServer', () => {
  const refused = {
    abortSignal() {
      return refused;
    },
    then(resolve: (v: unknown) => void) {
      order.push('charge_attempted');
      resolve({ data: null, error: { code: '42501', message: 'permission denied for function' } });
    },
  };
  return { supabaseServer: { rpc: () => refused } };
});

jest.mock('@/lib/services/AuditTrailService', () => ({ AuditTrail: { log: async () => undefined } }));

const mockLogged: Array<{ level: string; fields: Record<string, unknown> }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown) => {
        mockLogged.push({ level, fields: typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {} });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { runAiAction } from '@/lib/business-os/llm/aiActionAudit';
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';
import type { LedgerCallRow } from '@/lib/repositories/TokenUsageRepository';
import { createLogger } from '@/lib/logger';
import { runCreditLeakCheck, type CreditLeakCheckDeps } from '../creditLeakCheck';

const OWNER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const UNWRAPPED_GROUP = '5a5a5a5a-0000-4000-8000-000000000001';
const FAILED_CHARGE_GROUP = '5a5a5a5a-0000-4000-8000-000000000002';
const ANCHOR = '2026-08-23T19:55:01.286Z';

/** `token_usage`, as the tracker would have written it. */
const tokenUsage: LedgerCallRow[] = [];

class TestProvider extends BaseAIProvider {
  readonly defaultModel = 'test-model';
  readonly defaultMaxTokens = 100;
  readonly supportsResponseFormat = false;
  getMaxOutputTokens(): number {
    return 100;
  }
  async chatCompletion(): Promise<unknown> {
    throw new Error('not used');
  }
}

const analytics = {
  async trackAICall(row: Record<string, unknown>) {
    order.push('token_usage_written');
    tokenUsage.push({
      id: `tu-${tokenUsage.length + 1}`,
      created_at: new Date().toISOString(),
      feature: row.feature as string,
      component: row.component as string,
      session_id: (row.session_id as string | undefined) ?? null,
      input_tokens: row.input_tokens as number,
      output_tokens: row.output_tokens as number,
      cost_usd: row.cost_usd as number,
      success: true,
      error_code: null,
    });
  },
} as unknown as AIAnalyticsService;
const provider = new TestProvider(analytics);

function businessOsCall(groupId: string) {
  const context = buildBosCallContext({ userId: OWNER, area: 'chat', callName: 'planner', groupId });
  return provider.callWithTracking(
    context,
    'openai',
    'gpt-4o-mini',
    'chat/completions',
    async () => ({ text: 'answer' }),
    () => ({ inputTokens: 120, outputTokens: 30, cost: 0.000036 })
  );
}

function depsOver(rows: LedgerCallRow[], now: Date): CreditLeakCheckDeps {
  return {
    async pagePlanAnchors() {
      return { data: [{ user_id: OWNER, period_anchor: ANCHOR }], error: null };
    },
    async findPlanAnchor() {
      return { data: { found: true, periodAnchor: ANCHOR }, error: null };
    },
    async listTotalsForPeriodsInRange() {
      return { data: { rows: [], reachedCeiling: false }, error: null };
    },
    // Nothing was ever written to the ledger: the RPC refused it.
    async listLedgerRowsForAccount() {
      return { data: { rows: [], reachedCeiling: false }, error: null };
    },
    async listUsageCallsForAccount(userId) {
      return { data: { rows: rows.filter(() => userId === OWNER), reachedCeiling: false }, error: null };
    },
    async countPlatformCalls() {
      return { data: 0, error: null };
    },
    now: () => now,
  };
}

describe('AC-31: an unwrapped call and a forced ledger-write failure are both reported', () => {
  it('reports both groups as uncharged spend, with the account and the period', async () => {
    // (1) Deliberately unwrapped: no runAiAction, so no charge is attempted.
    await businessOsCall(UNWRAPPED_GROUP);
    expect(order).toEqual(['token_usage_written']);

    // (2) Through the real runAiAction; the database refuses the charge.
    await runAiAction(
      { area: 'chat', actionType: 'chat_turn', groupId: FAILED_CHARGE_GROUP, trigger: 'user', accountId: OWNER },
      async () => businessOsCall(FAILED_CHARGE_GROUP)
    );
    // V-7 / Q-14: the usage row exists before the charge is even attempted.
    expect(order).toEqual(['token_usage_written', 'token_usage_written', 'charge_attempted']);
    expect(mockLogged.some((l) => l.level === 'error' && l.fields.event === 'bos_ai_charge_write_failed')).toBe(true);
    // The action itself was not failed by the lost charge (FR-16).

    const written = Date.parse(tokenUsage[0].created_at);
    const dayStart = Date.UTC(new Date(written).getUTCFullYear(), new Date(written).getUTCMonth(), new Date(written).getUTCDate());
    const window = { start: new Date(dayStart), end: new Date(dayStart + 86_400_000) };
    // Run "the next night", so nothing is pulled back as still settling.
    const now = new Date(dayStart + 86_400_000 + 4.75 * 3_600_000);

    mockLogged.length = 0;
    const result = await runCreditLeakCheck(
      { window, accountId: null, deadlineAt: Number.MAX_SAFE_INTEGER, trigger: 'nightly' },
      depsOver(tokenUsage, now),
      createLogger({ module: 'ac31' })
    );

    expect(result.accountsWithLeak).toBe(1);
    const finding = result.accounts[0];
    expect(finding.accountId).toBe(OWNER);
    expect(finding.status).toBe('leak');
    expect(finding.counts.uncharged).toBe(2);
    expect(finding.examples.uncharged.map((e) => e.groupId).sort()).toEqual([UNWRAPPED_GROUP, FAILED_CHARGE_GROUP].sort());
    expect(finding.usd.uncharged).toBeCloseTo(0.000072, 12);

    // The period: the plan anchor's period at the time of the calls (the RPC's rule).
    const anchorDay = 23;
    const expectedMonth = new Date(written).getUTCDate() >= anchorDay ? new Date(written).getUTCMonth() : new Date(written).getUTCMonth() - 1;
    const expectedPeriod = new Date(Date.UTC(new Date(written).getUTCFullYear(), expectedMonth, anchorDay, 19, 55, 1, 286));
    // Guard the one day each month the anchor TIME decides it.
    if (new Date(written).getUTCDate() !== anchorDay) {
      expect(finding.periodStart).toBe(expectedPeriod.toISOString());
    }
    expect(finding.periodStart).not.toBeNull();

    const leakLog = mockLogged.find((l) => l.fields.event === 'bos_credit_leak_found');
    expect(leakLog?.level).toBe('error');
    expect(leakLog?.fields).toMatchObject({ accountId: OWNER, periodStart: finding.periodStart, unchargedGroups: 2 });
    expect((leakLog?.fields.groupIds as string[]).sort()).toEqual([UNWRAPPED_GROUP, FAILED_CHARGE_GROUP].sort());
  });
});
