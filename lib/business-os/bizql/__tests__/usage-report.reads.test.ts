/**
 * getChatUsage / getChatPricing — how a read is surfaced (Layer 1.5 F-1,
 * FR-24, AC-18).
 *
 * A failed read is `ok: false`, never an all-zero report; a capped read is
 * `ok: true` with `truncated` and the applied `cap`; the reads go through
 * TokenUsageRepository's two named chat methods.
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { getChatPricing, getChatUsage, type UsageReportDeps } from '../telemetry/usageReport';
import { TOKEN_USAGE_CHAT_READ_LIMITS, type LedgerChatRow } from '@/lib/repositories/TokenUsageRepository';
import { BOS_CHAT_FEATURE } from '@/lib/business-os/llm/callCatalog';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FROM = new Date('2026-09-10T00:00:00.000Z');
const TO = new Date('2026-09-17T00:00:00.000Z');

function chatRow(over: Partial<LedgerChatRow> = {}): LedgerChatRow {
  return {
    id: `r-${Math.random().toString(16).slice(2)}`,
    user_id: A,
    session_id: '33333333-3333-4333-8333-333333333333',
    activity_type: 'plan',
    activity_name: 'planner',
    model_name: 'gpt-4o',
    input_tokens: 1000,
    output_tokens: 50,
    cost_usd: '0.0030',
    latency_ms: 900,
    success: true,
    created_at: '2026-09-16T10:00:00.000Z',
    ...over,
  };
}

type Read = { data: { rows: LedgerChatRow[]; reachedCeiling: boolean } | null; error: Error | null };

function deps(read: Read) {
  const forAccount = jest.fn().mockResolvedValue(read);
  const allAccounts = jest.fn().mockResolvedValue(read);
  const d: UsageReportDeps = {
    tokenUsage: { listChatCallsForAccountInWindow: forAccount, listChatCallsAllAccountsInWindow: allAccounts },
  };
  return { d, forAccount, allAccounts };
}

describe('getChatUsage', () => {
  it('reports ok with the figures, not truncated, and the cap that applied', async () => {
    const { d } = deps({ data: { rows: [chatRow(), chatRow({ user_id: B })], reachedCeiling: false }, error: null });
    const result = await getChatUsage({ from: FROM, to: TO }, d);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report).toMatchObject({ calls: 2, turns: 1, truncated: false, cap: 10_000 });
    // numeric arriving as a string is summed as a number
    expect(result.report.totalCostUsd).toBeCloseTo(0.006);
  });

  it('reports a capped read as ok and truncated — the data is still returned', async () => {
    const { d } = deps({ data: { rows: [chatRow()], reachedCeiling: true }, error: null });
    const result = await getChatUsage({ from: FROM, to: TO }, d);
    expect(result).toMatchObject({ ok: true, report: { truncated: true, cap: TOKEN_USAGE_CHAT_READ_LIMITS.USAGE_CEILING, calls: 1 } });
  });

  it('reports a failed read as ok: false — never an all-zero report', async () => {
    const { d } = deps({ data: null, error: new Error('db down') });
    const result = await getChatUsage({ from: FROM, to: TO }, d);
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(result).not.toHaveProperty('report');
  });

  it('reads one account through the per-account method, everyone through the named all-accounts method', async () => {
    const one = deps({ data: { rows: [], reachedCeiling: false }, error: null });
    await getChatUsage({ from: FROM, to: TO, userId: A }, one.d);
    expect(one.forAccount).toHaveBeenCalledWith(A, { start: FROM, end: TO }, BOS_CHAT_FEATURE, {
      pageSize: 1000,
      ceiling: 10_000,
    });
    expect(one.allAccounts).not.toHaveBeenCalled();

    const all = deps({ data: { rows: [], reachedCeiling: false }, error: null });
    await getChatUsage({ from: FROM, to: TO }, all.d);
    expect(all.allAccounts).toHaveBeenCalledWith({ start: FROM, end: TO }, BOS_CHAT_FEATURE, { pageSize: 1000, ceiling: 10_000 });
    expect(all.forAccount).not.toHaveBeenCalled();
  });
});

describe('getChatPricing', () => {
  it('reports ok with per-user figures, truncation and its own cap', async () => {
    const { d, allAccounts } = deps({ data: { rows: [chatRow(), chatRow({ user_id: B })], reachedCeiling: true }, error: null });
    const result = await getChatPricing({ days: 7 }, d);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.users.map((u) => u.userId).sort()).toEqual([A, B]);
    expect(result.report).toMatchObject({ truncated: true, cap: 50_000 });
    expect(allAccounts.mock.calls[0][2]).toEqual({ pageSize: 1000, ceiling: 50_000 });
  });

  it('reports a failed read as ok: false', async () => {
    const { d } = deps({ data: null, error: new Error('db down') });
    await expect(getChatPricing({ days: 7 }, d)).resolves.toEqual({ ok: false, error: expect.any(String) });
  });
});

describe('the module', () => {
  it('makes no direct Supabase call', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'telemetry', 'usageReport.ts'), 'utf8');
    expect(source).not.toMatch(/supabaseServer|supabaseClient|\.from\(['"]token_usage/);
  });
});
