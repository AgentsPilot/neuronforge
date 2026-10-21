/**
 * AiPriceApplyRepository (AI model price review slice 8) and the two slice 8
 * methods of AiPriceProposalRepository (`findLinesForDecision`, `dismissLines`).
 * Every case runs against an injected Supabase double; no method throws.
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

import { AiPriceApplyRepository } from '../AiPriceApplyRepository';
import { AiPriceProposalRepository } from '../AiPriceProposalRepository';

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
      for (const method of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update', 'delete']) {
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

const APPLY_ROW = {
  out_batch_id: 'batch-1',
  out_line_id: 'line-1',
  out_live_table: 'ai_model_image_pricing',
  out_new_row_id: 'row-new',
  out_retired_row_ids: ['row-old'],
  out_applied_at: '2026-10-17T10:15:00Z',
};

describe('applyLines', () => {
  it('calls ai_price_apply_lines once with an allow-listed payload and maps the rows', async () => {
    const { client, rpcCalls } = makeClient([{ data: [APPLY_ROW], error: null }]);
    const lines = [{ line_id: 'line-1', reason: 'Provider price change', extra: 'dropped' } as unknown as { line_id: string; reason: string }];
    const { data, error } = await new AiPriceApplyRepository(client).applyLines({
      adminUserId: 'admin-1',
      lines,
      margin: { needed: false, items: [] },
    });
    expect(error).toBeNull();
    expect(data).toEqual([
      { batchId: 'batch-1', lineId: 'line-1', liveKind: 'image', newRowId: 'row-new', retiredRowIds: ['row-old'], appliedAt: '2026-10-17T10:15:00Z' },
    ]);
    expect(rpcCalls).toEqual([
      {
        fn: 'ai_price_apply_lines',
        args: { p_admin_user_id: 'admin-1', p_lines: [{ line_id: 'line-1', reason: 'Provider price change' }], p_margin: { needed: false, items: [] } },
      },
    ]);
  });

  it('sends an override reason only when there is one', async () => {
    const { client, rpcCalls } = makeClient([{ data: [{ ...APPLY_ROW, out_live_table: 'ai_model_pricing' }], error: null }]);
    const { data } = await new AiPriceApplyRepository(client).applyLines({
      adminUserId: 'admin-1',
      lines: [{ line_id: 'line-1', reason: 'r1 r1', override_reason: 'checked' }],
      margin: { needed: true, items: [{ model: 'x' }] },
    });
    expect(data?.[0].liveKind).toBe('token');
    expect((rpcCalls[0].args as { p_lines: unknown }).p_lines).toEqual([{ line_id: 'line-1', reason: 'r1 r1', override_reason: 'checked' }]);
  });

  it('keeps the SQLSTATE and DETAIL on the error; a short result is returned, never called a failure (QA edge case)', async () => {
    const { client } = makeClient([
      { data: null, error: { message: 'stale', code: 'P8002', details: '11111111-1111-4111-8111-111111111111' } },
      { data: [], error: null },
    ]);
    const repo = new AiPriceApplyRepository(client);
    const input = { adminUserId: 'admin-1', lines: [{ line_id: 'line-1', reason: 'reason' }], margin: { needed: false, items: [] } };
    const refused = await repo.applyLines(input);
    expect(refused.data).toBeNull();
    expect(refused.error).toMatchObject({ code: 'P8002', details: '11111111-1111-4111-8111-111111111111' });
    const short = await repo.applyLines(input);
    expect(short.error).toBeNull();
    expect(short.data).toEqual([]);
  });

  it('never throws on a thrown client', async () => {
    const throwing = { rpc: () => { throw new Error('network'); } } as unknown as SupabaseClient;
    const result = await new AiPriceApplyRepository(throwing).applyLines({ adminUserId: 'a', lines: [], margin: { needed: false, items: [] } });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('network');
  });
});

describe('listOpenMarginReviews', () => {
  it('reads needed and open reviews, newest first, capped', async () => {
    const { client, queries } = makeClient([{ data: [{ id: 'batch-1' }], error: null }]);
    const { data } = await new AiPriceApplyRepository(client).listOpenMarginReviews();
    expect(data).toEqual([{ id: 'batch-1' }]);
    expect(queries[0].table).toBe('ai_price_apply_batches');
    expect(queries[0].calls.filter((call) => call.method === 'eq').map((call) => call.args)).toEqual([
      ['margin_review_needed', true],
      ['margin_review_done', false],
    ]);
    expect(queries[0].calls.find((call) => call.method === 'order')?.args).toEqual(['applied_at', { ascending: false }]);
    expect(queries[0].calls.find((call) => call.method === 'limit')?.args).toEqual([21]);
  });

  it('returns the error instead of throwing', async () => {
    const { client } = makeClient([{ data: null, error: { message: 'x', code: '42P01' } }]);
    const result = await new AiPriceApplyRepository(client).listOpenMarginReviews();
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ code: '42P01' });
  });
});

describe('markMarginReviewDone', () => {
  it('calls the review function with the admin id, batch and note', async () => {
    const { client, rpcCalls } = makeClient([{ data: [{ out_batch_id: 'batch-1', out_done_at: '2026-10-17T11:00:00Z' }], error: null }]);
    const { data } = await new AiPriceApplyRepository(client).markMarginReviewDone({ adminUserId: 'admin-1', batchId: 'batch-1', note: 'Margins fine' });
    expect(data).toEqual({ batchId: 'batch-1', doneAt: '2026-10-17T11:00:00Z' });
    expect(rpcCalls).toEqual([{ fn: 'ai_price_apply_batch_review_done', args: { p_admin_user_id: 'admin-1', p_batch_id: 'batch-1', p_note: 'Margins fine' } }]);
  });

  it('keeps P8005 and its DETAIL', async () => {
    const { client } = makeClient([{ data: null, error: { message: 'done', code: 'P8005', details: 'already_done' } }]);
    const result = await new AiPriceApplyRepository(client).markMarginReviewDone({ adminUserId: 'a', batchId: 'b', note: 'note' });
    expect(result.error).toMatchObject({ code: 'P8005', details: 'already_done' });
  });
});

describe('AiPriceProposalRepository slice 8 methods', () => {
  it('findLinesForDecision reads by id with every snapshot number as exact text (RC-6)', async () => {
    const { client, queries } = makeClient([{ data: [{ id: 'line-1' }], error: null }]);
    const { data } = await new AiPriceProposalRepository(client).findLinesForDecision(['line-1', 'line-2']);
    expect(data).toEqual([{ id: 'line-1' }]);
    expect(queries[0].table).toBe('ai_price_proposal_lines');
    const columns = String(queries[0].calls.find((call) => call.method === 'select')?.args[0]);
    for (const column of ['current_input_cost_per_token', 'current_output_cost_per_token', 'current_cached_input_cost_per_token', 'current_cost_per_image']) {
      expect(columns).toContain(`${column}::text`);
    }
    expect(columns).toContain('state');
    expect(queries[0].calls.find((call) => call.method === 'in')?.args).toEqual(['id', ['line-1', 'line-2']]);
  });

  it('dismissLines calls ai_price_dismiss_lines and keeps the SQLSTATE', async () => {
    const { client, rpcCalls } = makeClient([
      { data: [{ out_line_id: 'line-1', out_decided_at: '2026-10-17T10:00:00Z' }], error: null },
      { data: null, error: { message: 'busy', code: '55P03' } },
    ]);
    const repo = new AiPriceProposalRepository(client);
    const { data } = await repo.dismissLines({ adminUserId: 'admin-1', lineIds: ['line-1'], reason: 'Not a list price' });
    expect(data).toEqual([{ lineId: 'line-1', decidedAt: '2026-10-17T10:00:00Z' }]);
    expect(rpcCalls[0]).toEqual({ fn: 'ai_price_dismiss_lines', args: { p_admin_user_id: 'admin-1', p_line_ids: ['line-1'], p_reason: 'Not a list price' } });
    const busy = await repo.dismissLines({ adminUserId: 'admin-1', lineIds: ['line-1'], reason: 'Not a list price' });
    expect(busy.error).toMatchObject({ code: '55P03' });
  });
});

describe('no write besides the database functions', () => {
  it('the apply repository has no insert, update, delete or upsert call and names no live table', () => {
    // Code only: the header comment names the live tables on purpose, to say this file never touches them.
    const source = readFileSync(join(process.cwd(), 'lib', 'repositories', 'AiPriceApplyRepository.ts'), 'utf8').replace(/^[ ]*[/][/].*$/gm, '');
    expect(source).not.toMatch(/[.](update|delete|insert|upsert)[(]/);
    expect(source).not.toMatch(/['"`]ai_model_(image_)?pricing['"`]/);
  });
});
