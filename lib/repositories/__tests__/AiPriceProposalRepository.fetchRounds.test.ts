/**
 * AiPriceProposalRepository, slice 5 methods (AI model price review; SA SC-8,
 * SC-12): `submitFetchRound` and the three newest-round reads. Every case runs
 * against an injected Supabase double.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));

import type { SupabaseClient } from '@supabase/supabase-js';

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import { AiPriceProposalRepository } from '../AiPriceProposalRepository';
import type { AiPriceSubmitLine } from '../types';

forbidRealNetwork();

type Result = { data: unknown; error: unknown };

function makeClient(results: Result[]) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const queries: Array<{ table: string; calls: Array<{ method: string; args: unknown[] }> }> = [];
  const client = {
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return Promise.resolve(results.shift() ?? { data: null, error: null });
    },
    from(table: string) {
      const query = { table, calls: [] as Array<{ method: string; args: unknown[] }> };
      queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'or', 'order', 'limit', 'insert', 'update', 'delete']) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls, queries };
}

const LINE: AiPriceSubmitLine = {
  kind: 'token',
  provider: 'openai',
  model_name: 'example-model',
  input_per_1m: '0.15',
  output_per_1m: '0.60',
  current_basis: 'unpriced',
  source_url: 'https://developers.openai.com/api/docs/pricing',
  checked_on: '2026-10-15',
  flags: [],
  cross_check_verdict: 'agrees',
  cross_check_value: 'input 0.15, output 0.6 per 1M',
  cross_check_source: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  cross_check_fetched_at: '2026-10-15T09:00:00.000Z',
  cross_check_diff_pct: '0.00',
};
const OUTCOMES = { openai: { outcome: 'ok' } };

describe('submitFetchRound', () => {
  it('calls the submit RPC once as a fetch round, lines and cross-check as given', async () => {
    const { client, rpcCalls } = makeClient([
      { data: [{ out_proposal_id: 'r1', out_line_id: 'l1', out_line_index: 1, out_superseded_line_id: 'old' }], error: null },
    ]);
    const { data, error } = await new AiPriceProposalRepository(client).submitFetchRound({
      adminUserId: 'admin-1',
      providerOutcomes: OUTCOMES,
      lines: [LINE],
    });
    expect(error).toBeNull();
    expect(data).toEqual({ roundId: 'r1', lines: [{ proposalId: 'r1', lineId: 'l1', lineIndex: 1, supersededLineId: 'old' }] });
    expect(rpcCalls).toEqual([
      {
        fn: 'ai_price_submit_pending',
        args: { p_admin_user_id: 'admin-1', p_source_kind: 'fetch', p_provider_outcomes: OUTCOMES, p_lines: [LINE] },
      },
    ]);
  });

  it('a zero-line round: one row with the round id and no line, dropped from the lines (SC-8)', async () => {
    const { client } = makeClient([
      { data: [{ out_proposal_id: 'r2', out_line_id: null, out_line_index: null, out_superseded_line_id: null }], error: null },
    ]);
    const { data } = await new AiPriceProposalRepository(client).submitFetchRound({ adminUserId: 'admin-1', providerOutcomes: OUTCOMES, lines: [] });
    expect(data).toEqual({ roundId: 'r2', lines: [] });
  });

  it('keeps the Postgres code on an error, and never throws', async () => {
    const { client } = makeClient([{ data: null, error: { message: 'not admin', code: '42501' } }]);
    const failed = await new AiPriceProposalRepository(client).submitFetchRound({ adminUserId: 'x', providerOutcomes: OUTCOMES, lines: [] });
    expect(failed.data).toBeNull();
    expect((failed.error as { code?: string }).code).toBe('42501');

    const empty = makeClient([{ data: [], error: null }]);
    const none = await new AiPriceProposalRepository(empty.client).submitFetchRound({ adminUserId: 'x', providerOutcomes: OUTCOMES, lines: [] });
    expect(none.data).toBeNull();
    expect(none.error?.message).toBe('The submit function returned no round');
  });
});

describe('submitPending (manual) is unchanged by a null line row', () => {
  it('drops a row without a line', async () => {
    const { client } = makeClient([
      { data: [{ out_proposal_id: 'p', out_line_id: null, out_line_index: null, out_superseded_line_id: null }], error: null },
    ]);
    const { data } = await new AiPriceProposalRepository(client).submitPending({
      adminUserId: 'a',
      sourceKind: 'manual',
      providerOutcomes: null,
      lines: [LINE],
    });
    expect(data).toEqual([]);
  });
});

describe('newest fetch round reads (SC-12)', () => {
  const ROW = { id: 'r1', created_at: '2026-10-15T09:00:00Z', created_by: 'admin-1', provider_outcomes: OUTCOMES };

  it('latestFetchRound: fetch rounds only, newest first, one row', async () => {
    const { client, queries } = makeClient([{ data: [ROW], error: null }]);
    const { data } = await new AiPriceProposalRepository(client).latestFetchRound();
    expect(data).toEqual(ROW);
    expect(queries[0].table).toBe('ai_price_proposals');
    expect(queries[0].calls).toEqual([
      { method: 'select', args: ['id, created_at, created_by, provider_outcomes'] },
      { method: 'eq', args: ['source_kind', 'fetch'] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'limit', args: [1] },
    ]);
  });

  it.each([
    ['openai', 'ok', 'eq', 'provider_outcomes->openai->>outcome'],
    ['openai', 'not_ok', 'neq', 'provider_outcomes->openai->>outcome'],
    ['litellm', 'ok', 'eq', 'provider_outcomes->litellm->>outcome'],
    ['litellm', 'not_ok', 'neq', 'provider_outcomes->litellm->>outcome'],
  ] as const)('latestFetchRoundByOutcome(%s, %s) filters with .%s on the JSON path, never .or()', async (source, match, method, path) => {
    const { client, queries } = makeClient([{ data: [], error: null }]);
    const { data, error } = await new AiPriceProposalRepository(client).latestFetchRoundByOutcome(source, match);
    expect(error).toBeNull();
    expect(data).toBeNull();
    expect(queries[0].calls).toContainEqual({ method, args: [path, 'ok'] });
    expect(queries[0].calls.map((call) => call.method)).not.toContain('or');
  });

  it('returns the error instead of throwing', async () => {
    const { client } = makeClient([{ data: null, error: { message: 'x', code: '42P01' } }]);
    const result = await new AiPriceProposalRepository(client).latestFetchRound();
    expect(result.data).toBeNull();
    expect((result.error as { code?: string }).code).toBe('42P01');
  });
});
