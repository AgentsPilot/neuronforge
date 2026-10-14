/**
 * AiPriceProposalRepository (AI model price review slice 3). Every case runs
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

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { AiPriceProposalRepository } from '../AiPriceProposalRepository';
import type { AiPriceSubmitInput } from '../types';

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
      for (const method of ['select', 'eq', 'order', 'insert', 'update', 'delete']) {
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

const INPUT: AiPriceSubmitInput = {
  adminUserId: 'admin-1',
  sourceKind: 'manual',
  providerOutcomes: null,
  lines: [
    {
      kind: 'token',
      provider: 'openai',
      model_name: 'example-model',
      input_per_1m: '0.075',
      output_per_1m: '0.3',
      current_basis: 'unpriced',
      source_url: 'https://developers.openai.com/api/docs/pricing',
      checked_on: '2026-10-14',
      flags: ['new_model'],
    },
  ],
};

describe('submitPending', () => {
  it('calls ai_price_submit_pending once with the lines as given: prices stay strings', async () => {
    const { client, rpcCalls } = makeClient([
      { data: [{ out_proposal_id: 'p1', out_line_id: 'l1', out_line_index: 1, out_superseded_line_id: null }], error: null },
    ]);
    const { data, error } = await new AiPriceProposalRepository(client).submitPending(INPUT);

    expect(error).toBeNull();
    expect(data).toEqual([{ proposalId: 'p1', lineId: 'l1', lineIndex: 1, supersededLineId: null }]);
    expect(rpcCalls).toEqual([
      {
        fn: 'ai_price_submit_pending',
        args: { p_admin_user_id: 'admin-1', p_source_kind: 'manual', p_provider_outcomes: null, p_lines: INPUT.lines },
      },
    ]);
    const sent = JSON.stringify(rpcCalls[0].args);
    expect(sent).toContain('"input_per_1m":"0.075"');
    expect(typeof (INPUT.lines[0].input_per_1m as unknown)).toBe('string');
  });

  it('keeps the Postgres code on the returned error (23505 and 42501 are mapped by the route)', async () => {
    const { client } = makeClient([{ data: null, error: { message: 'duplicate key', code: '23505' } }]);
    const { data, error } = await new AiPriceProposalRepository(client).submitPending(INPUT);
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe('23505');
  });

  it('returns [] for an empty result and never throws on a thrown client', async () => {
    const empty = makeClient([{ data: null, error: null }]);
    expect((await new AiPriceProposalRepository(empty.client).submitPending(INPUT)).data).toEqual([]);

    const throwing = { rpc: () => { throw new Error('network'); } } as unknown as SupabaseClient;
    const result = await new AiPriceProposalRepository(throwing).submitPending(INPUT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('network');
  });
});

describe('listPendingLines', () => {
  it('reads pending lines only, newest first, with the stored strings', async () => {
    const { client, queries } = makeClient([{ data: [{ id: 'l1' }], error: null }]);
    const { data, error } = await new AiPriceProposalRepository(client).listPendingLines();

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'l1' }]);
    expect(queries[0].table).toBe('ai_price_proposal_lines');
    expect(queries[0].calls.find((c) => c.method === 'select')?.args[0]).toContain('input_per_1m, output_per_1m');
    expect(queries[0].calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([['state', 'pending']]);
    expect(queries[0].calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([['created_at', { ascending: false }]]);
  });

  it('returns [] for none and the error instead of throwing', async () => {
    const { client } = makeClient([{ data: null, error: null }, { data: null, error: { message: 'x', code: '42P01' } }]);
    const repo = new AiPriceProposalRepository(client);
    expect((await repo.listPendingLines()).data).toEqual([]);
    const failed = await repo.listPendingLines();
    expect(failed.data).toBeNull();
    expect((failed.error as { code?: string }).code).toBe('42P01');
  });
});

describe('no write path besides the RPC (SA C-2: state moves only in the database)', () => {
  it('the repository source has no update, delete, insert or upsert call', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'repositories', 'AiPriceProposalRepository.ts'), 'utf8');
    expect(source).not.toMatch(/[.](update|delete|insert|upsert)[(]/);
  });
});
