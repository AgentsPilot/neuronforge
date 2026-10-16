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
 *
 * DE-2 (BUSINESS_OS_DATA_EXPORT_DE2_WORKPLAN.md §2.4, T-10 / T-11, SA C-6): the
 * column lists moved onto the purge descriptors (`export.columns`). Each read
 * selects exactly `exportColumnsOf(table).join(', ')`, the literal pins below
 * and in the characterization test stay byte for byte, and a descriptor that
 * cannot be exported fails the read closed (`{ data: null, error }`).
 *
 * DE-4 (user 2026-10-15): connected apps left the export, so
 * `PluginConnectionRepository.listForUserDataExport` lost its only caller and
 * was deleted, with its cases here (the credentials-select pin, the list-read
 * case). One read is left: the profile. A guard below proves the method stays
 * gone. The DE-0b browser-access guard for `plugin_connections`
 * (lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts) is
 * unaffected.
 *
 * DE-3 (BUSINESS_OS_DATA_EXPORT_DE3_WORKPLAN.md §3.1, X-12): the three
 * profile columns DE-1 left open are decided. `role` stays; `org_id` and
 * `hourly_rate_usd` left the select. The literal pin is re-pinned
 * deliberately (15 columns, was 17).
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
import * as classification from '@/lib/business-os/data-export/classification';
import { ExportClassificationError, exportColumnsOf } from '@/lib/business-os/data-export/classification';

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
];

beforeEach(() => {
  mockLogged.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GDPR data export repository reads', () => {
  it('covers one read per exported table', () => {
    // DE-4 (user 2026-10-15): profiles only, was plugin_connections + profiles.
    expect(CASES.map((c) => c.table).sort()).toEqual(['profiles']);
  });

  it('PluginConnectionRepository has no data-export read any more (DE-4, user 2026-10-15)', () => {
    expect('listForUserDataExport' in PluginConnectionRepository.prototype).toBe(false);
    expect(Object.getOwnPropertyNames(PluginConnectionRepository.prototype).filter((m) => /export/i.test(m))).toEqual([]);
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
    // DE-3 decided the three DE-1 left open (SA C-6): role in; org_id and hourly_rate_usd out.
    expect(columns).toContain('role');
    for (const out of ['hourly_rate_usd', 'org_id']) expect(columns).not.toContain(out);
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

  it.each(CASES)('$name selects an explicit column list with no excluded column', async ({ read }) => {
    const { client, calls } = recordingClient({ data: [], error: null });
    await read(client);
    const selects = calls.filter((c) => c[0] === 'select');
    expect(selects).toHaveLength(1);
    const columns = String(selects[0][1]).split(',').map((c) => c.trim());
    expect(columns).not.toContain('*');
    expect(columns.length).toBeGreaterThan(1);
    for (const excluded of EXCLUDED_COLUMNS) expect(columns).not.toContain(excluded);
  });
  /** The select string a recorded read issued, or undefined. */
  const selectOf = (calls: Call[]) => calls.find((c) => c[0] === 'select')?.[1];

  it.each(CASES)('$name selects exactly the descriptor export columns (DE-2, T-11)', async ({ table, read }) => {
    const { client, calls } = recordingClient({ data: [], error: null });
    await read(client);
    expect(selectOf(calls)).toBe(exportColumnsOf(table).join(', '));
  });

  // DE-4 (user 2026-10-15): on profiles, was plugin_connections (now excluded).
  it('the equality check can fail: a select with one extra column does not match (negative control)', () => {
    const recorded = `${exportColumnsOf('profiles').join(', ')}, access_token`;
    expect(recorded).not.toBe(exportColumnsOf('profiles').join(', '));
  });

  // DE-3 (deliberate re-pin): the DE-1 list minus hourly_rate_usd and org_id.
  it('the profile columns are byte-identical to the DE-3 list (SA C-6 literal pin)', async () => {
    const { client, calls } = recordingClient({ data: null, error: null });
    await new UserProfileRepository(client).findForUserDataExport(USER);
    expect(selectOf(calls)).toBe(
      'id, full_name, avatar_url, company, job_title, timezone, language, created_at, updated_at, ' +
        'role, domain, onboarding, onboarding_goal, onboarding_mode, onboarding_data'
    );
  });

  it.each(CASES)('$name fails closed when the descriptor cannot be exported: { data: null, error }, no query (DE-2, T-10)', async ({ table, read }) => {
    const refusal = new ExportClassificationError('denied_column', table, 'planted');
    jest.spyOn(classification, 'exportColumnsOf').mockImplementation(() => {
      throw refusal;
    });
    const { client, tables } = recordingClient({ data: [], error: null });
    const result = await read(client);
    expect(result).toEqual({ data: null, error: refusal });
    expect(tables).toEqual([]);
    const errors = mockLogged.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].fields).toMatchObject({ err: refusal, userId: USER });
  });
});
