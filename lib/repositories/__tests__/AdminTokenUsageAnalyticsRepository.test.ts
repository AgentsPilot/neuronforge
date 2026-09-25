/**
 * AdminTokenUsageAnalyticsRepository (admin reorganisation slice 2a, SA C-3),
 * plus the exported feature-filter builder it shares with TokenUsageRepository.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  AdminTokenUsageAnalyticsRepository,
  ADMIN_ANALYTICS_COLUMNS,
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

    const result = await repo.listRowsAllAccountsInWindow(WINDOW, {
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

  it('applies no feature predicate when no feature filter is given', async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    await new AdminTokenUsageAnalyticsRepository(client).listRowsAllAccountsInWindow(WINDOW, {}, 'totals');
    expect(calls.some((c) => c.method === 'or')).toBe(false);
    expect(calls).toContainEqual({ method: 'select', args: [ADMIN_ANALYTICS_COLUMNS.totals] });
  });

  it('returns { data: null, error } on a database error and never throws', async () => {
    const { client } = recordingClient({ data: null, error: { message: 'boom' } });
    const result = await new AdminTokenUsageAnalyticsRepository(client).listRowsAllAccountsInWindow(WINDOW, {});
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('refuses a bad feature filter or a reversed window before any query', async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    const repo = new AdminTokenUsageAnalyticsRepository(client);

    const badFilter = await repo.listRowsAllAccountsInWindow(WINDOW, {
      featureFilter: { featurePrefix: 'x,y', features: [] },
    });
    expect(badFilter.data).toBeNull();

    const reversed = await repo.listRowsAllAccountsInWindow({ start: WINDOW.end, end: WINDOW.start }, {});
    expect(reversed.data).toBeNull();
    expect(calls.filter((c) => c.method === 'from')).toHaveLength(1); // only the bad-filter attempt reached from()
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
