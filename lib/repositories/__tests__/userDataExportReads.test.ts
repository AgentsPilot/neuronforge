/**
 * The GDPR data export's repository reads (DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md
 * §4.2, SA C-4 / C-6).
 *
 * One table-driven file. Per method: the read is on the right table, scoped to
 * the caller (`.eq('user_id', id)`, or `.eq('id', id)` on profiles), and a
 * PostgREST error returns `{ data: null, error }` and is logged at `error` with
 * `{ err }`.
 *
 * DE-1 (BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md §3.6, SA Q-5): the export now
 * reads two tables. The six other export reads (agents, executions, agent
 * configurations, subscription, credit transactions, audit entries) were
 * deleted with their cases here: those sections left the export (DX-1,
 * BQ-SA-1). The profile read is `.maybeSingle()` (SA Q-4) and no longer selects
 * `plan` (SA Q-3).
 *
 * The full chain per table is NOT re-pinned here: the route's characterization
 * test (app/api/user/data-export/__tests__/route.characterization.test.ts) owns
 * that (C-6).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        mockLogged.push({
          level,
          fields: typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {},
          msg: typeof first === 'string' ? first : String(second ?? ''),
        });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { UserProfileRepository } from '@/lib/repositories/UserProfileRepository';
import { PluginConnectionRepository } from '@/lib/repositories/PluginConnectionRepository';

type Call = [string, ...unknown[]];
type Result = { data: unknown; error: unknown };

function recordingClient(result: Result) {
  const tables: string[] = [];
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'not', 'in', 'gte', 'lte', 'order', 'limit', 'range']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  for (const terminal of ['single', 'maybeSingle']) {
    builder[terminal] = () => {
      calls.push([terminal]);
      return Promise.resolve(result);
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  const client = {
    from: (table: string) => {
      tables.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, tables, calls };
}

const USER = '11111111-1111-4111-8111-111111111111';
const POSTGREST_ERROR = { message: 'column audit_trail.timestamp does not exist', code: '42703', details: null, hint: null };

interface Case {
  name: string;
  table: string;
  scope: Call;
  read: (client: SupabaseClient) => Promise<{ data: unknown; error: unknown }>;
  rows: unknown;
}

const CASES: Case[] = [
  {
    name: 'UserProfileRepository.findForUserDataExport',
    table: 'profiles',
    scope: ['eq', 'id', USER],
    read: (c) => new UserProfileRepository(c).findForUserDataExport(USER),
    rows: { id: USER, full_name: 'Ada' },
  },
  {
    name: 'PluginConnectionRepository.listForUserDataExport',
    table: 'plugin_connections',
    scope: ['eq', 'user_id', USER],
    read: (c) => new PluginConnectionRepository(c).listForUserDataExport(USER),
    rows: [{ user_id: USER, plugin_key: 'slack', created_at: null, updated_at: null, metadata: null }],
  },
];

beforeEach(() => {
  mockLogged.length = 0;
});

describe('GDPR data export repository reads', () => {
  it('covers one read per exported table', () => {
    expect(CASES.map((c) => c.table).sort()).toEqual(
      ['plugin_connections', 'profiles'].sort()
    );
  });

  it.each(CASES)('$name reads $table scoped to the caller and returns the rows', async ({ table, scope, read, rows }) => {
    const { client, tables, calls } = recordingClient({ data: rows, error: null });
    const result = await read(client);
    expect(tables).toEqual([table]);
    expect(calls).toContainEqual(scope);
    expect(result).toEqual({ data: rows, error: null });
    expect(mockLogged.filter((l) => l.level === 'error')).toEqual([]);
  });

  it.each(CASES)('$name returns { data: null, error } on a PostgREST error and logs it with { err }', async ({ read }) => {
    const { client } = recordingClient({ data: null, error: POSTGREST_ERROR });
    const result = await read(client);
    expect(result).toEqual({ data: null, error: POSTGREST_ERROR });
    const errors = mockLogged.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].fields).toMatchObject({ err: POSTGREST_ERROR, userId: USER });
  });

  it('the list reads return [] for a null data without error', async () => {
    for (const c of CASES.filter((x) => Array.isArray(x.rows))) {
      const { client } = recordingClient({ data: null, error: null });
      expect(await c.read(client)).toEqual({ data: [], error: null });
    }
  });

  it('the plugin connection read never selects credentials', async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    await new PluginConnectionRepository(client).listForUserDataExport(USER);
    // DATA_EXPORT_FOLLOWUPS_WORKPLAN.md NF-1 / SA C-1: `metadata` does not exist;
    // `profile_data` is read but the route passes only allow-listed fields.
    expect(calls).toContainEqual([
      'select',
      'user_id, plugin_key, plugin_name, username, email, scope, status, connected_at, created_at, updated_at, last_used, disconnected_at, profile_data',
    ]);
  });

  it('the profile read is maybeSingle: no row is { data: null, error: null }, not an error (DE-1, SA Q-4)', async () => {
    const { client, calls } = recordingClient({ data: null, error: null });
    expect(await new UserProfileRepository(client).findForUserDataExport(USER)).toEqual({ data: null, error: null });
    expect(calls).toContainEqual(['maybeSingle']);
    expect(calls).not.toContainEqual(['single']);
    expect(mockLogged.filter((l) => l.level === 'error')).toEqual([]);
  });

  it('the profile read does not select plan (DE-1, SA Q-3 / C-1: no plan or billing data, DX-1a)', async () => {
    const { client, calls } = recordingClient({ data: null, error: null });
    await new UserProfileRepository(client).findForUserDataExport(USER);
    const columns = String(calls.find((c) => c[0] === 'select')?.[1]).split(',').map((c) => c.trim());
    expect(columns).not.toContain('plan');
    // DE-3 decides these three explicitly (SA C-6); until then they stay.
    for (const kept of ['hourly_rate_usd', 'role', 'org_id']) expect(columns).toContain(kept);
  });

  /**
   * FU-P1 (DATA_EXPORT_FOLLOWUPS_WORKPLAN.md §4): every export read names its
   * columns, and none names a column the plan excludes. A deny-list on top of
   * the named lists: it catches a list that someone widens by hand.
   * `profile_data` is read on purpose (SA C-1); route.test.ts proves the raw
   * value never reaches the export body.
   */
  const EXCLUDED_COLUMNS = [
    // credentials and token plumbing
    'access_token', 'refresh_token', 'expires_at', 'last_refreshed_at', 'settings',
    // internal hashes and denormalised copies
    'hash', 'user_email', 'workflow_hash',
    // queue / scheduler plumbing
    'qstash_schedule_id', 'schedule_version', 'last_successful_calibration_id', 'job_id', 'queue_name',
    // internal throttles and admin policy values
    'last_low_balance_alert_at', 'grace_period_days',
    // our provider cost, user decision BQ-1 (2026-10-04)
    'total_cost_usd', 'models_used',
  ];

  it.each(CASES)('$name selects an explicit column list with no excluded column', async ({ table, read }) => {
    const { client, calls } = recordingClient({ data: [], error: null });
    await read(client);
    const selects = calls.filter((c) => c[0] === 'select');
    expect(selects).toHaveLength(1);
    const columns = String(selects[0][1]).split(',').map((c) => c.trim());
    expect(columns).not.toContain('*');
    expect(columns.length).toBeGreaterThan(1);
    for (const excluded of EXCLUDED_COLUMNS) expect(columns).not.toContain(excluded);
    // `metadata` is a real, exported column on credit_transactions only; on
    // plugin_connections it does not exist (NF-1).
    if (table === 'plugin_connections') expect(columns).not.toContain('metadata');
  });
});
