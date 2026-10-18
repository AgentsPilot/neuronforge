/**
 * The repository reads of the per-model price history (AI model price review
 * slice 9; SA SC9-1, SC9-3, SC9-4). One test per method and behaviour, each
 * against an injected recording client: the exact column string (prices cast
 * to text), filters, order, limits, chunking, the never-throws rule, and that
 * no email or note text reaches a log line.
 */

const mockLogCalls: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const record = (...args: unknown[]) => {
      mockLogCalls.push(args);
    };
    const logger: Record<string, unknown> = { info: record, warn: record, error: record, debug: record };
    logger.child = (bindings: unknown) => {
      mockLogCalls.push(['child', bindings]);
      return logger;
    };
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));

import type { SupabaseClient } from '@supabase/supabase-js';

import { ADMIN_EMAIL_LOOKUP_CHUNK, ADMIN_EMAIL_LOOKUP_COLUMNS, AdminUserRepository } from '../AdminUserRepository';
import {
  IMAGE_PRICE_HISTORY_COLUMNS,
  IMAGE_PRICE_HISTORY_ROW_LIMIT,
  AiModelImagePricingRepository,
} from '../AiModelImagePricingRepository';
import { AiModelPricingRepository, PRICE_HISTORY_COLUMNS, PRICE_HISTORY_ROW_LIMIT } from '../AiModelPricingRepository';
import { AiPriceApplyRepository, BATCH_HISTORY_COLUMNS, BATCH_ID_CHUNK } from '../AiPriceApplyRepository';
import { APPLIED_LINE_HISTORY_COLUMNS, AiPriceProposalRepository, LINE_ID_CHUNK } from '../AiPriceProposalRepository';
import {
  ADMIN_PRICING_AUDIT_LIMITS,
  ADMIN_PRICING_ROW_EVENT_COLUMNS,
  ADMIN_PRICING_SYNC_RUN_COLUMNS,
  AuditTrailRepository,
} from '../AuditTrailRepository';
import { HISTORY_ROW_LIMIT } from '@/lib/ai/pricing-research/priceHistorySchema';

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: unknown };

/** Every query recorded separately; each resolves with `result(calls, index)`. */
function recordingClient(result: (calls: Call[], index: number) => Result) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'is', 'lte', 'order', 'limit', 'abortSignal']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => resolve(result(calls, index));
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const KEY = { provider: 'openai', modelName: 'gpt-4o-mini' };

beforeEach(() => {
  mockLogCalls.length = 0;
});

describe('listHistoryExact (both live repositories)', () => {
  it('the row cap is the same everywhere (repositories and the response schema)', () => {
    expect(PRICE_HISTORY_ROW_LIMIT).toBe(200);
    expect(IMAGE_PRICE_HISTORY_ROW_LIMIT).toBe(PRICE_HISTORY_ROW_LIMIT);
    expect(HISTORY_ROW_LIMIT).toBe(PRICE_HISTORY_ROW_LIMIT);
  });

  it('token: one model, every state, exact text, the listActive order, one more than the cap', async () => {
    const rows = [{ id: 'r1' }];
    const { client, queries } = recordingClient(() => ({ data: rows, error: null }));
    const result = await new AiModelPricingRepository(client).listHistoryExact(KEY);
    expect(result).toEqual({ data: { rows, truncated: false }, error: null });
    expect(PRICE_HISTORY_COLUMNS).toBe(
      'id, provider, model_name, input_cost_per_token::text, output_cost_per_token::text, cached_input_cost_per_token::text, effective_date, retired_date, created_at, proposal_id, proposal_line_id'
    );
    expect(queries[0]).toEqual([
      { method: 'from', args: ['ai_model_pricing'] },
      { method: 'select', args: [PRICE_HISTORY_COLUMNS] },
      { method: 'eq', args: ['provider', 'openai'] },
      { method: 'eq', args: ['model_name', 'gpt-4o-mini'] },
      { method: 'order', args: ['effective_date', { ascending: false }] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'limit', args: [201] },
    ]);
    // No retired filter: the history is every kept row.
    expect(queries[0].some((c) => c.method === 'is')).toBe(false);
  });

  it('image: the same, with size, quality and cost_per_image as text', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await new AiModelImagePricingRepository(client).listHistoryExact(KEY);
    expect(IMAGE_PRICE_HISTORY_COLUMNS).toBe(
      'id, provider, model_name, size, quality, cost_per_image::text, effective_date, retired_date, created_at, proposal_id, proposal_line_id'
    );
    expect(queries[0][0]).toEqual({ method: 'from', args: ['ai_model_image_pricing'] });
    expect(queries[0]).toContainEqual({ method: 'limit', args: [201] });
  });

  it('over the cap: the newest 200 and truncated', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ id: `r${i}` }));
    const { client } = recordingClient(() => ({ data: rows, error: null }));
    const result = await new AiModelPricingRepository(client).listHistoryExact(KEY);
    expect(result.data?.rows).toHaveLength(200);
    expect(result.data?.rows[0]).toEqual({ id: 'r0' });
    expect(result.data?.truncated).toBe(true);
  });

  it.each([
    ['token', () => AiModelPricingRepository],
    ['image', () => AiModelImagePricingRepository],
  ])('%s: an empty key is refused before any query; a query error is returned, never thrown', async (_label, cls) => {
    const Repo = cls();
    const { client, queries } = recordingClient(() => ({ data: null, error: { message: 'boom' } }));
    const refused = await new Repo(client).listHistoryExact({ provider: '', modelName: 'x' });
    expect(refused.data).toBeNull();
    expect(queries).toHaveLength(0);
    const failed = await new Repo(client).listHistoryExact(KEY);
    expect(failed).toEqual({ data: null, error: { message: 'boom' } });
  });
});

describe('AiPriceProposalRepository.findAppliedLinesByIds', () => {
  it('reads by id with the history columns (source_kind embedded), de-duplicated, in chunks of 50', async () => {
    const ids = Array.from({ length: LINE_ID_CHUNK + 1 }, (_, i) => uuid(i));
    const { client, queries } = recordingClient((_calls, index) => ({ data: [{ id: `l${index}` }], error: null }));
    const result = await new AiPriceProposalRepository(client).findAppliedLinesByIds([...ids, ids[0]]);
    expect(result).toEqual({ data: [{ id: 'l0' }, { id: 'l1' }], error: null });
    expect(APPLIED_LINE_HISTORY_COLUMNS).toContain('decided_by, decided_at, decision_reason, override_reason');
    expect(APPLIED_LINE_HISTORY_COLUMNS.endsWith('ai_price_proposals(source_kind)')).toBe(true);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toEqual([
      { method: 'from', args: ['ai_price_proposal_lines'] },
      { method: 'select', args: [APPLIED_LINE_HISTORY_COLUMNS] },
      { method: 'in', args: ['id', ids.slice(0, LINE_ID_CHUNK)] },
    ]);
    expect(queries[1]).toContainEqual({ method: 'in', args: ['id', ids.slice(LINE_ID_CHUNK)] });
  });

  it('an empty list issues no query; a non-UUID is refused before any query; an error is returned', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: { message: 'boom', code: '42501' } }));
    const repo = new AiPriceProposalRepository(client);
    expect(await repo.findAppliedLinesByIds([])).toEqual({ data: [], error: null });
    expect((await repo.findAppliedLinesByIds(['x%),id.neq.(y'])).data).toBeNull();
    expect(queries).toHaveLength(0);
    const failed = await repo.findAppliedLinesByIds([uuid(1)]);
    expect(failed.data).toBeNull();
    expect(failed.error).toMatchObject({ message: 'boom', code: '42501' });
  });
});

describe('AiPriceApplyRepository.findBatchesByIds', () => {
  it('reads batches by id without margin items, in chunks of 50', async () => {
    const ids = Array.from({ length: BATCH_ID_CHUNK + 1 }, (_, i) => uuid(i));
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    await new AiPriceApplyRepository(client).findBatchesByIds(ids);
    expect(BATCH_HISTORY_COLUMNS).not.toContain('margin_items');
    expect(queries).toHaveLength(2);
    expect(queries[0]).toEqual([
      { method: 'from', args: ['ai_price_apply_batches'] },
      { method: 'select', args: [BATCH_HISTORY_COLUMNS] },
      { method: 'in', args: ['id', ids.slice(0, BATCH_ID_CHUNK)] },
    ]);
  });

  it('empty is no query; an error is returned and no margin note is logged', async () => {
    const { client, queries } = recordingClient(() => ({ data: [{ id: uuid(1), margin_review_note: 'secret note' }], error: null }));
    const repo = new AiPriceApplyRepository(client);
    expect(await repo.findBatchesByIds([])).toEqual({ data: [], error: null });
    expect(queries).toHaveLength(0);
    await repo.findBatchesByIds([uuid(1)]);
    expect(JSON.stringify(mockLogCalls)).not.toContain('secret note');
    const failing = recordingClient(() => ({ data: null, error: { message: 'boom' } }));
    expect((await new AiPriceApplyRepository(failing.client).findBatchesByIds([uuid(1)])).data).toBeNull();
  });
});

describe('AdminUserRepository.findEmailsByUserIds (SA SC9-1)', () => {
  it('selects exactly user_id and email, with NO is_active filter, de-duplicated, in chunks of 50', async () => {
    const ids = Array.from({ length: ADMIN_EMAIL_LOOKUP_CHUNK + 1 }, (_, i) => uuid(i));
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new AdminUserRepository(client).findEmailsByUserIds([...ids, ids[1]]);
    expect(result).toEqual({ data: [], error: null });
    expect(ADMIN_EMAIL_LOOKUP_COLUMNS).toBe('user_id, email');
    expect(queries).toHaveLength(2);
    expect(queries[0]).toEqual([
      { method: 'from', args: ['admin_users'] },
      { method: 'select', args: ['user_id, email'] },
      { method: 'in', args: ['user_id', ids.slice(0, ADMIN_EMAIL_LOOKUP_CHUNK)] },
    ]);
    // Deactivated admins are included by decision (BQ-9a): no is_active filter anywhere.
    expect(queries.flat().some((c) => c.args[0] === 'is_active')).toBe(false);
  });

  it('returns deactivated rows too and never logs an email', async () => {
    const rows = [
      { user_id: uuid(1), email: 'active@example.com' },
      { user_id: uuid(2), email: 'deactivated@example.com' },
    ];
    const { client } = recordingClient(() => ({ data: rows, error: null }));
    const result = await new AdminUserRepository(client).findEmailsByUserIds([uuid(1), uuid(2)]);
    expect(result.data).toEqual(rows);
    const logged = JSON.stringify(mockLogCalls);
    expect(logged).not.toContain('active@example.com');
    expect(logged).not.toContain('deactivated@example.com');
  });

  it('an empty list issues no query; an error is returned, never thrown', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: { message: 'boom' } }));
    const repo = new AdminUserRepository(client);
    expect(await repo.findEmailsByUserIds([])).toEqual({ data: [], error: null });
    expect(queries).toHaveLength(0);
    const failed = await repo.findEmailsByUserIds([uuid(1)]);
    expect(failed.data).toBeNull();
    expect(failed.error).toEqual({ message: 'boom' });
  });
});

describe('AuditTrailRepository admin pricing reads (SA SC9-4)', () => {
  const CTX = { correlationId: 'corr-1', adminId: uuid(999) };

  it('row events: the three per-row events of the given price rows, newest first, capped', async () => {
    const { client, queries } = recordingClient(() => ({ data: [{ id: 'e1', created_at: '2026-09-01T00:00:00Z' }], error: null }));
    const result = await new AuditTrailRepository(client).listAdminPricingRowEvents(CTX, [uuid(1), uuid(2)]);
    expect(result).toEqual({ data: { rows: [{ id: 'e1', created_at: '2026-09-01T00:00:00Z' }], reachedLimit: false }, error: null });
    expect(ADMIN_PRICING_ROW_EVENT_COLUMNS).toBe('id, action, actor_id, user_id, created_at, entity_id, changes, details');
    expect(queries[0]).toEqual([
      { method: 'from', args: ['audit_trail'] },
      { method: 'select', args: [ADMIN_PRICING_ROW_EVENT_COLUMNS] },
      { method: 'eq', args: ['entity_type', 'ai_pricing'] },
      { method: 'in', args: ['action', ['AI_PRICING_CREATED', 'AI_PRICING_UPDATED', 'AI_PRICING_ZERO_SET']] },
      { method: 'in', args: ['entity_id', [uuid(1), uuid(2)]] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'limit', args: [ADMIN_PRICING_AUDIT_LIMITS.MAX_ROW_EVENTS] },
    ]);
    expect(queries[0].some((c) => c.args[0] === 'user_id')).toBe(false);
  });

  it('selects no hash, no email, no ip and no user agent', () => {
    for (const columns of [ADMIN_PRICING_ROW_EVENT_COLUMNS, ADMIN_PRICING_SYNC_RUN_COLUMNS]) {
      const list = columns.split(',').map((c) => c.trim());
      for (const forbidden of ['*', 'hash', 'user_email', 'ip_address', 'user_agent']) expect(list).not.toContain(forbidden);
    }
  });

  it('row events: chunks of 50 ids, merged newest first; reaching the cap is reported', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => uuid(i));
    const full = Array.from({ length: ADMIN_PRICING_AUDIT_LIMITS.MAX_ROW_EVENTS }, (_, i) => ({ id: `a${i}`, created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}Z` }));
    const { client, queries } = recordingClient((_calls, index) =>
      index === 0 ? { data: full, error: null } : { data: [{ id: 'late', created_at: '2026-10-01T00:00:00Z' }], error: null }
    );
    const result = await new AuditTrailRepository(client).listAdminPricingRowEvents(CTX, ids);
    expect(queries).toHaveLength(2);
    expect(result.data?.reachedLimit).toBe(true);
    expect(result.data?.rows).toHaveLength(ADMIN_PRICING_AUDIT_LIMITS.MAX_ROW_EVENTS);
    expect(result.data?.rows[0].id).toBe('late');
  });

  it.each([
    ['no admin context', { correlationId: '', adminId: '' }, [uuid(1)]],
    ['no row id', CTX, []],
    ['more than 200 row ids', CTX, Array.from({ length: 201 }, (_, i) => uuid(i))],
    ['a row id that is not a UUID', CTX, [uuid(1), 'x%),id.neq.(y']],
  ])('row events refuse %s before any query', async (_label, ctx, ids) => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new AuditTrailRepository(client).listAdminPricingRowEvents(ctx, ids);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });

  it('Sync runs: the Sync entries of the system pricing entity, newest first, capped at 100, reachedLimit at the cap', async () => {
    const rows = Array.from({ length: ADMIN_PRICING_AUDIT_LIMITS.MAX_SYNC_RUNS }, (_, i) => ({ id: `s${i}` }));
    const { client, queries } = recordingClient(() => ({ data: rows, error: null }));
    const result = await new AuditTrailRepository(client).listAdminPricingSyncRuns(CTX);
    expect(result.data?.reachedLimit).toBe(true);
    expect(ADMIN_PRICING_SYNC_RUN_COLUMNS).toBe('id, actor_id, user_id, created_at, details');
    expect(queries[0]).toEqual([
      { method: 'from', args: ['audit_trail'] },
      { method: 'select', args: [ADMIN_PRICING_SYNC_RUN_COLUMNS] },
      { method: 'eq', args: ['action', 'AI_PRICING_SYNCED'] },
      { method: 'eq', args: ['entity_type', 'system'] },
      { method: 'eq', args: ['entity_id', 'ai_pricing'] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'limit', args: [100] },
    ]);
  });

  it('Sync runs refuse no context before any query; errors are returned, never thrown', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: { message: 'boom' } }));
    const repo = new AuditTrailRepository(client);
    expect((await repo.listAdminPricingSyncRuns({ correlationId: '', adminId: '' })).data).toBeNull();
    expect(queries).toHaveLength(0);
    expect((await repo.listAdminPricingSyncRuns(CTX)).data).toBeNull();
    expect((await repo.listAdminPricingRowEvents(CTX, [uuid(1)])).data).toBeNull();
  });
});
