/**
 * AdminTokenUsageAnalyticsRepository (admin reorganisation slice 2a, SA C-3),
 * plus the exported feature-filter builder it shares with TokenUsageRepository.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockChildBindings: Array<Record<string, unknown>> = [];
const mockInfo = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: mockInfo, warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = (bindings: Record<string, unknown>) => {
      mockChildBindings.push(bindings);
      return logger;
    };
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  AdminTokenUsageAnalyticsRepository,
  ADMIN_ANALYTICS_COLUMNS,
  ADMIN_HEALTH_READ_LIMITS,
} from '../AdminTokenUsageAnalyticsRepository';
import { buildFeatureFilterOrExpression } from '../TokenUsageRepository';

/** Records every builder call; resolves with the configured result. */
function recordingClient(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'gte', 'lte', 'eq', 'is', 'not', 'or']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const CTX = { correlationId: 'corr-1', adminId: '11111111-1111-4111-8111-111111111111' };
const WINDOW = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-08T00:00:00.000Z' };
const BOS_FILTER = {
  featurePrefix: 'business-os',
  features: ['insight-generation', 'lead-reply'],
};

describe('buildFeatureFilterOrExpression', () => {
  it('builds prefix OR listed values', () => {
    expect(buildFeatureFilterOrExpression(BOS_FILTER)).toBe(
      'feature.like.business-os*,feature.in.("insight-generation","lead-reply")'
    );
  });

  it('builds the prefix alone when no values are listed', () => {
    expect(buildFeatureFilterOrExpression({ featurePrefix: 'business-os', features: [] })).toBe(
      'feature.like.business-os*'
    );
  });

  it.each([
    [{ featurePrefix: 'a,b', features: [] }],
    [{ featurePrefix: 'business-os', features: ['x"),id.neq.(y'] }],
    [{ featurePrefix: 'Business OS', features: [] }],
  ])('refuses anything that could inject filter syntax: %j', (filter) => {
    expect(() => buildFeatureFilterOrExpression(filter)).toThrow();
  });
});

describe('listRowsAllAccountsInWindow', () => {
  it('selects the allow-list (never *), bounds the window and applies every filter with its own operator', async () => {
    const { client, calls } = recordingClient({ data: [{ cost_usd: '0.1', input_tokens: 1, output_tokens: 2 }], error: null });
    const repo = new AdminTokenUsageAnalyticsRepository(client);

    const result = await repo.listRowsAllAccountsInWindow(CTX, WINDOW, {
      provider: 'openai',
      model: 'openai/gpt-4o:2024',
      activity: 'chat',
      requestType: 'completion',
      feature: 'business-os-chat',
      component: 'IntentParser',
      endpoint: '/api/x',
      user: 'system',
      agent: 'no-agent',
      executionOnly: true,
      featureFilter: BOS_FILTER,
    });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(calls[0]).toEqual({ method: 'from', args: ['token_usage'] });
    expect(calls).toContainEqual({ method: 'select', args: [ADMIN_ANALYTICS_COLUMNS.aggregate] });
    expect(ADMIN_ANALYTICS_COLUMNS.aggregate).not.toContain('*');
    expect(calls).toContainEqual({ method: 'gte', args: ['created_at', WINDOW.start] });
    expect(calls).toContainEqual({ method: 'lte', args: ['created_at', WINDOW.end] });
    expect(calls).toContainEqual({ method: 'eq', args: ['model_name', 'openai/gpt-4o:2024'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['request_type', 'completion'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['endpoint', '/api/x'] });
    expect(calls).toContainEqual({ method: 'is', args: ['user_id', null] });
    expect(calls).toContainEqual({ method: 'is', args: ['agent_id', null] });
    expect(calls).toContainEqual({ method: 'not', args: ['execution_id', 'is', null] });
    expect(calls).toContainEqual({ method: 'or', args: [buildFeatureFilterOrExpression(BOS_FILTER)] });
  });

  it('logs each read with the request correlation id and the admin id, and no row values', async () => {
    mockChildBindings.length = 0;
    mockInfo.mockClear();
    const { client } = recordingClient({ data: [{ cost_usd: '0.1', input_tokens: 1, output_tokens: 2 }], error: null });
    await new AdminTokenUsageAnalyticsRepository(client).listRowsAllAccountsInWindow(CTX, WINDOW, {});
    expect(mockChildBindings).toContainEqual(expect.objectContaining(CTX));
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo.mock.calls[0][0]).toMatchObject({ rows: 1, possiblyTruncated: false });
  });

  it('applies no feature predicate when no feature filter is given', async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    await new AdminTokenUsageAnalyticsRepository(client).listRowsAllAccountsInWindow(CTX, WINDOW, {}, 'totals');
    expect(calls.some((c) => c.method === 'or')).toBe(false);
    expect(calls).toContainEqual({ method: 'select', args: [ADMIN_ANALYTICS_COLUMNS.totals] });
  });

  it('returns { data: null, error } on a database error and never throws', async () => {
    const { client } = recordingClient({ data: null, error: { message: 'boom' } });
    const result = await new AdminTokenUsageAnalyticsRepository(client).listRowsAllAccountsInWindow(CTX, WINDOW, {});
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('refuses to read without an admin read context (N-2: every cross-tenant read is attributed)', async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    const result = await new AdminTokenUsageAnalyticsRepository(client).listRowsAllAccountsInWindow(
      { correlationId: '', adminId: '' },
      WINDOW,
      {}
    );
    expect(result.data).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('refuses a bad feature filter or a reversed window before any query', async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    const repo = new AdminTokenUsageAnalyticsRepository(client);

    const badFilter = await repo.listRowsAllAccountsInWindow(CTX, WINDOW, {
      featureFilter: { featurePrefix: 'x,y', features: [] },
    });
    expect(badFilter.data).toBeNull();

    const reversed = await repo.listRowsAllAccountsInWindow(CTX, { start: WINDOW.end, end: WINDOW.start }, {});
    expect(reversed.data).toBeNull();
    expect(calls.filter((c) => c.method === 'from')).toHaveLength(1); // only the bad-filter attempt reached from()
  });
});

// ─── Health landing reads (slice 4, F-1, SA C-4) ─────────────────────────────

/** One builder per `from()`; each query resolves with `pageFor(rangeArgs)`. */
function pagingClient(pageFor: (from: number, to: number) => { data: unknown; error: unknown; count?: number }) {
  const queries: Array<Array<{ method: string; args: unknown[] }>> = [];
  const client = {
    from: (table: string) => {
      const calls: Array<{ method: string; args: unknown[] }> = [{ method: 'from', args: [table] }];
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'gte', 'lte', 'eq', 'is', 'not', 'or', 'order', 'range', 'abortSignal']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => {
        const range = calls.find((c) => c.method === 'range');
        resolve(pageFor((range?.args[0] as number) ?? 0, (range?.args[1] as number) ?? 0));
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const rowsBetween = (from: number, to: number, total: number) =>
  Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({
    id: `id-${from + i}`,
    created_at: '2026-09-07T00:00:00.000Z',
    cost_usd: '0.01',
  }));

describe('countAllAccountsInWindow', () => {
  it('is an exact head count over the window and the Business OS filter; no row is read', async () => {
    const { client, queries } = pagingClient(() => ({ data: null, error: null, count: 42 }));
    const result = await new AdminTokenUsageAnalyticsRepository(client).countAllAccountsInWindow(CTX, WINDOW, {
      featureFilter: BOS_FILTER,
    });
    expect(result).toEqual({ data: 42, error: null });
    const q = queries[0];
    expect(q).toContainEqual({ method: 'select', args: ['id', { count: 'exact', head: true }] });
    expect(q).toContainEqual({ method: 'gte', args: ['created_at', WINDOW.start] });
    expect(q).toContainEqual({ method: 'lte', args: ['created_at', WINDOW.end] });
    expect(q).toContainEqual({ method: 'or', args: [buildFeatureFilterOrExpression(BOS_FILTER)] });
  });

  it('attaches the deadline signal, and refuses a read with no admin context', async () => {
    const signal = new AbortController().signal;
    const { client, queries } = pagingClient(() => ({ data: null, error: null, count: 0 }));
    const repo = new AdminTokenUsageAnalyticsRepository(client);
    await repo.countAllAccountsInWindow(CTX, WINDOW, {}, { signal });
    expect(queries[0]).toContainEqual({ method: 'abortSignal', args: [signal] });

    const refused = await repo.countAllAccountsInWindow({ correlationId: '', adminId: '' }, WINDOW, {});
    expect(refused.data).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it('returns { data: null, error } on a database error', async () => {
    const { client } = pagingClient(() => ({ data: null, error: { message: 'boom' } }));
    const result = await new AdminTokenUsageAnalyticsRepository(client).countAllAccountsInWindow(CTX, WINDOW, {});
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('listCostPointsAllAccountsInWindow', () => {
  it('selects only id, created_at and cost_usd, newest first with an id tiebreak, paged', async () => {
    expect(ADMIN_ANALYTICS_COLUMNS.cost).toBe('id, created_at, cost_usd');
    const { client, queries } = pagingClient((from, to) => ({ data: rowsBetween(from, to, 1500), error: null }));
    const result = await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(
      CTX,
      WINDOW,
      { featureFilter: BOS_FILTER },
      { pageSize: 1000, ceiling: 10000 }
    );
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ completed: true, reachedCeiling: false, pages: 2 });
    expect(result.data!.rows).toHaveLength(1500);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContainEqual({ method: 'select', args: [ADMIN_ANALYTICS_COLUMNS.cost] });
    expect(queries[0]).toContainEqual({ method: 'order', args: ['created_at', { ascending: false }] });
    expect(queries[0]).toContainEqual({ method: 'order', args: ['id', { ascending: false }] });
    expect(queries[0]).toContainEqual({ method: 'range', args: [0, 999] });
    expect(queries[1]).toContainEqual({ method: 'range', args: [1000, 1999] });
  });

  it('stops at the ceiling and says so (never "completed")', async () => {
    const { client, queries } = pagingClient((from, to) => ({ data: rowsBetween(from, to, 100000), error: null }));
    const result = await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(
      CTX, WINDOW, {}, { pageSize: 1000, ceiling: 3000 }
    );
    expect(result.data).toMatchObject({ completed: false, reachedCeiling: true, pages: 3 });
    expect(result.data!.rows).toHaveLength(3000);
    expect(queries).toHaveLength(3);
  });

  it('de-duplicates a row that shifts across a page boundary', async () => {
    const { client } = pagingClient((from) =>
      from === 0
        ? { data: [{ id: 'a', created_at: 'x', cost_usd: 1 }, { id: 'b', created_at: 'x', cost_usd: 1 }], error: null }
        : { data: [{ id: 'b', created_at: 'x', cost_usd: 1 }], error: null }
    );
    const result = await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(
      CTX, WINDOW, {}, { pageSize: 2, ceiling: 10 }
    );
    expect(result.data!.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('C-4: once the deadline has passed, no further page is requested', async () => {
    const controller = new AbortController();
    const { client, queries } = pagingClient((from, to) => {
      controller.abort(); // the deadline passes while page 1 is in flight
      return { data: rowsBetween(from, to, 5000), error: null };
    });
    const result = await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(
      CTX, WINDOW, {}, { pageSize: 1000, ceiling: 10000, signal: controller.signal }
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContainEqual({ method: 'abortSignal', args: [controller.signal] });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('refuses a ceiling above the limit, or no admin context, before any query', async () => {
    const { client, queries } = pagingClient(() => ({ data: [], error: null }));
    const repo = new AdminTokenUsageAnalyticsRepository(client);
    expect(
      (await repo.listCostPointsAllAccountsInWindow(CTX, WINDOW, {}, { pageSize: 1000, ceiling: ADMIN_HEALTH_READ_LIMITS.CEILING + 1 })).data
    ).toBeNull();
    expect(
      (await repo.listCostPointsAllAccountsInWindow({ correlationId: 'c', adminId: '' }, WINDOW, {}, { pageSize: 1000, ceiling: 10 })).data
    ).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('logs counts only, never row values', async () => {
    mockInfo.mockClear();
    const { client } = pagingClient(() => ({ data: [{ id: 'a', created_at: 'x', cost_usd: '123.45' }], error: null }));
    await new AdminTokenUsageAnalyticsRepository(client).listCostPointsAllAccountsInWindow(CTX, WINDOW, {}, { pageSize: 10, ceiling: 10 });
    expect(JSON.stringify(mockInfo.mock.calls)).not.toContain('123.45');
    expect(mockInfo.mock.calls[0][0]).toMatchObject({ rows: 1, pages: 1, completed: true });
  });
});

// ─── Source guards (SA C-3) ──────────────────────────────────────────────────

const ROOT = process.cwd();
const REPO_FILE = 'lib/repositories/AdminTokenUsageAnalyticsRepository.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', '.claude', 'coverage', 'out', 'archive'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

describe('isolation: only app/api/admin/** uses the admin analytics repository', () => {
  const files = ['app', 'lib', 'components', 'hooks', 'scripts']
    .filter((d) => fs.existsSync(path.join(ROOT, d)))
    .flatMap((d) => walk(path.join(ROOT, d)));

  it('scanned a real tree', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(REPO_FILE);
  });

  it('no file outside app/api/admin/** (tests, the barrel and the file itself excepted) imports it', () => {
    const offenders = files.filter((file) => {
      if (file === REPO_FILE || file === 'lib/repositories/index.ts') return false;
      if (file.includes('/__tests__/')) return false;
      if (file.startsWith('app/api/admin/')) return false;
      // Code only (comments may name it), and the symbol names rather than the
      // path, so an import through the barrel is caught too.
      const code = fs
        .readFileSync(path.join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      return /AdminTokenUsageAnalyticsRepository|adminTokenUsageAnalyticsRepository/.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it('imports nothing from lib/business-os (RC-7: the filter arrives as data)', () => {
    const source = fs.readFileSync(path.join(ROOT, REPO_FILE), 'utf8');
    expect(source).not.toMatch(/from ['"]@\/lib\/business-os/);
  });
});
