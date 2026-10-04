/**
 * Unit tests for BusinessOsCreditLotRepository (credit deduction slice 11a;
 * workplan §3.4 and §7.2, SA conditions W11a-4 and W11a-8).
 *
 * What matters here: both RPCs get exactly their typed arguments, built field
 * by field (tenant-isolation-guard Step 3); ANY unique violation from either
 * RPC is a key conflict, matched by SQLSTATE and never by message (W11a-4);
 * the RPC row is mapped strictly — exactly one row, known status, parsable
 * figures, never a 0 or a guessed status (W11a-8); a NaN amount never reaches
 * the database as JSON null (which the reversal would read as "the rest");
 * every read scopes by `user_id` with an explicit column list; and nothing is
 * ever thrown.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
const mockWarn = jest.fn();
const mockError = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: (...args: unknown[]) => mockWarn(...args),
      error: (...args: unknown[]) => mockError(...args),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  BOS_RECORD_CREDIT_LOT_RPC,
  BOS_REVERSE_CREDIT_LOT_RPC,
  BusinessOsCreditLotRepository,
  CREDIT_LOT_COLUMNS,
  CREDIT_LOT_DRAW_COLUMNS,
  CREDIT_LOT_READ_LIMITS,
  businessOsCreditLotRepository,
  type BusinessOsCreditLotInput,
  type BusinessOsCreditLotReverseInput,
} from '@/lib/repositories/BusinessOsCreditLotRepository';

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const LOT = '44444444-4444-4444-8444-444444444444';
const LOT_2 = '44444444-4444-4444-8444-444444444445';
const DRAW = '55555555-5555-4555-8555-555555555555';
const REQUEST = '66666666-6666-4666-8666-666666666666';

const GRANT: BusinessOsCreditLotInput = {
  accountId: ACCOUNT,
  source: 'admin_grant',
  creditsBase: 500,
  creditsBonus: 0,
  creditValueVersion: 1,
  expiresAt: '2026-12-31T23:59:59.000Z',
  idempotencyKey: `admin_grant:${REQUEST}`,
  sourceRef: null,
  actorKind: 'admin',
  actorAdminId: ADMIN,
  reason: 'Goodwill for the outage',
};

const EXPECTED_RECORD_ARGS = {
  p_user_id: ACCOUNT,
  p_source: 'admin_grant',
  p_credits_base: 500,
  p_credits_bonus: 0,
  p_credit_value_version: 1,
  p_expires_at: '2026-12-31T23:59:59.000Z',
  p_idempotency_key: `admin_grant:${REQUEST}`,
  p_source_ref: null,
  p_actor_kind: 'admin',
  p_actor_admin_id: ADMIN,
  p_reason: 'Goodwill for the outage',
};

const REVERSE: BusinessOsCreditLotReverseInput = {
  accountId: ACCOUNT,
  lotId: LOT,
  credits: 40,
  idempotencyKey: `admin_reversal:${REQUEST}`,
  actorAdminId: ADMIN,
  reason: 'Granted by mistake',
};

const EXPECTED_REVERSE_ARGS = {
  p_user_id: ACCOUNT,
  p_lot_id: LOT,
  p_credits: 40,
  p_idempotency_key: `admin_reversal:${REQUEST}`,
  p_actor_admin_id: ADMIN,
  p_reason: 'Granted by mistake',
};

/** A client whose `rpc()` resolves to `outcome` (or rejects with it). */
function rpcClient(outcome: { data: unknown; error: unknown } | Error) {
  const recorded: { rpc?: [string, Record<string, unknown>] } = {};
  const client = {
    rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
      recorded.rpc = [fn, args];
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    }),
    from: jest.fn(() => {
      throw new Error('a write must not use from()');
    }),
  } as unknown as SupabaseClient;
  return { client, recorded };
}

type Call = { method: string; args: unknown[] };

/** Records every from() query; each resolves with `respond(calls, index)`. */
function recordingClient(respond: (calls: Call[], index: number) => { data: unknown; error: unknown }) {
  const queries: Call[][] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      const index = queries.length;
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'order', 'range', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.maybeSingle = () => {
        calls.push({ method: 'maybeSingle', args: [] });
        return Promise.resolve(respond(calls, index));
      };
      builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        try {
          resolve(respond(calls, index));
        } catch (err) {
          reject(err);
        }
      };
      return builder;
    },
    rpc: () => {
      throw new Error('a read must not call rpc');
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const argsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

const lotRaw = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  user_id: ACCOUNT,
  source: 'admin_grant',
  credits_granted: '100.500000',
  credits_base: '100.500000',
  credits_bonus: '0.000000',
  credit_value_version: 1,
  expires_at: null,
  idempotency_key: `admin_grant:${id}`,
  source_ref: null,
  actor_kind: 'admin',
  actor_admin_id: ADMIN,
  reason: 'Goodwill',
  created_at: '2026-10-01T10:00:00.123456+00:00',
  ...overrides,
});

const drawRaw = (id: string, lotId: string, credits: unknown = '40.000000') => ({
  id,
  lot_id: lotId,
  user_id: ACCOUNT,
  kind: 'reversal',
  credits,
  reason: 'Taken back',
  actor_admin_id: ADMIN,
  idempotency_key: `admin_reversal:${id}`,
  created_at: '2026-10-02T10:00:00+00:00',
});

beforeEach(() => {
  mockWarn.mockReset();
  mockError.mockReset();
});

describe('recordLot', () => {
  it('calls the record RPC with exactly the eleven typed arguments', async () => {
    const { client, recorded } = rpcClient({ data: [{ out_recorded: true, out_lot_id: LOT }], error: null });
    const result = await new BusinessOsCreditLotRepository(client).recordLot(GRANT);
    expect(result).toEqual({ data: { outcome: 'recorded', lotId: LOT }, error: null });
    expect(recorded.rpc?.[0]).toBe('business_os_record_credit_lot');
    expect(BOS_RECORD_CREDIT_LOT_RPC).toBe('business_os_record_credit_lot');
    expect(recorded.rpc?.[1]).toEqual(EXPECTED_RECORD_ARGS);
    expect(Object.keys(recorded.rpc?.[1] ?? {}).sort()).toEqual(Object.keys(EXPECTED_RECORD_ARGS).sort());
  });

  it('builds the arguments field by field: extra properties never reach the RPC', async () => {
    const { client, recorded } = rpcClient({ data: [{ out_recorded: true, out_lot_id: LOT }], error: null });
    const polluted = { ...GRANT, user_id: 'ATTACKER', p_user_id: 'ATTACKER', credits_granted: 999999, id: 'injected' };
    await new BusinessOsCreditLotRepository(client).recordLot(polluted);
    expect(recorded.rpc?.[1]).toEqual(EXPECTED_RECORD_ARGS);
    expect(JSON.stringify(recorded.rpc?.[1])).not.toContain('ATTACKER');
    expect(JSON.stringify(recorded.rpc?.[1])).not.toContain('999999');
  });

  it('maps recorded false to replayed, with the existing lot id', async () => {
    const { client } = rpcClient({ data: [{ out_recorded: false, out_lot_id: LOT }], error: null });
    const result = await new BusinessOsCreditLotRepository(client).recordLot(GRANT);
    expect(result).toEqual({ data: { outcome: 'replayed', lotId: LOT }, error: null });
  });

  it.each([
    ['the function conflict message', { code: '23505', message: 'idempotency key reused for a different lot' }],
    ['a native unique violation (W11a-4)', { code: '23505', message: 'duplicate key value violates unique constraint "business_os_credit_lots_idempotency_key_key"' }],
  ])('maps %s to idempotency_key_conflict, by SQLSTATE', async (_name, pgError) => {
    const { client } = rpcClient({ data: null, error: pgError });
    const result = await new BusinessOsCreditLotRepository(client).recordLot(GRANT);
    expect(result).toEqual({ data: { outcome: 'idempotency_key_conflict' }, error: null });
    const [context] = mockWarn.mock.calls[0];
    expect(context).toMatchObject({ sqlstate: '23505', accountId: ACCOUNT });
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('Goodwill');
  });

  it('returns any other database error as error, logged at warn with ids and SQLSTATE but never the reason', async () => {
    const pgError = { code: '23514', message: 'new row violates check constraint' };
    const { client } = rpcClient({ data: null, error: pgError });
    const result = await new BusinessOsCreditLotRepository(client).recordLot(GRANT);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(mockError).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][0]).toMatchObject({ method: 'recordLot', sqlstate: '23514', accountId: ACCOUNT });
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('Goodwill');
  });

  it('never logs or returns the database error details, which hold the failing row (SA CR11a-1)', async () => {
    const pgError = {
      code: '23514',
      message: 'new row violates check constraint',
      details: 'Failing row contains (Goodwill after outage, admin_grant:secret-key-123)',
      hint: 'row hint',
    };
    const { client } = rpcClient({ data: null, error: pgError });
    const result = await new BusinessOsCreditLotRepository(client).recordLot(GRANT);
    const logged = JSON.stringify(mockWarn.mock.calls);
    expect(logged).not.toContain('Failing row');
    expect(logged).not.toContain('secret-key-123');
    expect(logged).not.toContain('row hint');
    expect(mockWarn.mock.calls[0][0]).toMatchObject({ errorMessage: 'new row violates check constraint' });
    expect(mockWarn.mock.calls[0][0]).not.toHaveProperty('err');
    expect(result.error?.message).toBe('new row violates check constraint');
    expect(JSON.stringify(result.error, Object.getOwnPropertyNames(result.error as Error))).not.toContain('Failing row');
  });

  it('never throws: a rejected request is returned as error', async () => {
    const { client } = rpcClient(new Error('network down'));
    const result = await new BusinessOsCreditLotRepository(client).recordLot(GRANT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('network down');
  });

  it('never throws when rpc() throws synchronously', async () => {
    const client = { rpc: jest.fn(() => { throw new Error('boom'); }) } as unknown as SupabaseClient;
    const result = await new BusinessOsCreditLotRepository(client).recordLot(GRANT);
    expect(result.error?.message).toBe('boom');
  });

  it.each([
    ['no row', []],
    ['two rows', [{ out_recorded: true, out_lot_id: LOT }, { out_recorded: true, out_lot_id: LOT_2 }]],
    ['a bare object instead of an array', { out_recorded: true, out_lot_id: LOT }],
    ['null', null],
    ['recorded not a boolean', [{ out_recorded: 'true', out_lot_id: LOT }]],
    ['lot id not a uuid', [{ out_recorded: true, out_lot_id: 'lot-1' }]],
    ['lot id missing', [{ out_recorded: true }]],
  ])('treats an unexpected RPC result (%s) as an error (W11a-8)', async (_name, data) => {
    const { client } = rpcClient({ data, error: null });
    const result = await new BusinessOsCreditLotRepository(client).recordLot(GRANT);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it.each([
    ['NaN base', { creditsBase: Number.NaN }],
    ['Infinity bonus', { creditsBonus: Number.POSITIVE_INFINITY }],
    ['a non-uuid account', { accountId: 'not-an-id' }],
  ])('refuses %s before calling the database', async (_name, change) => {
    const { client } = rpcClient({ data: [{ out_recorded: true, out_lot_id: LOT }], error: null });
    const result = await new BusinessOsCreditLotRepository(client).recordLot({ ...GRANT, ...change });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('reverseLot', () => {
  const recordedRow = {
    out_status: 'recorded',
    out_draw_id: DRAW,
    out_credits: '40.000000',
    out_remaining_before: '100.500000',
    out_remaining_after: '60.500000',
  };

  it('calls the reverse RPC with exactly the six typed arguments, field by field', async () => {
    const { client, recorded } = rpcClient({ data: [recordedRow], error: null });
    const polluted = { ...REVERSE, user_id: 'ATTACKER', p_user_id: 'ATTACKER', kind: 'consumption' };
    const result = await new BusinessOsCreditLotRepository(client).reverseLot(polluted);
    expect(recorded.rpc?.[0]).toBe('business_os_reverse_credit_lot');
    expect(BOS_REVERSE_CREDIT_LOT_RPC).toBe('business_os_reverse_credit_lot');
    expect(recorded.rpc?.[1]).toEqual(EXPECTED_REVERSE_ARGS);
    expect(JSON.stringify(recorded.rpc?.[1])).not.toMatch(/ATTACKER|consumption/);
    expect(result).toEqual({
      data: { status: 'recorded', drawId: DRAW, credits: 40, remainingBefore: 100.5, remainingAfter: 60.5 },
      error: null,
    });
  });

  it("'rest' sends p_credits null (the function takes all that is left)", async () => {
    const { client, recorded } = rpcClient({ data: [recordedRow], error: null });
    await new BusinessOsCreditLotRepository(client).reverseLot({ ...REVERSE, credits: 'rest' });
    expect(recorded.rpc?.[1]).toEqual({ ...EXPECTED_REVERSE_ARGS, p_credits: null });
    expect(Object.prototype.hasOwnProperty.call(recorded.rpc?.[1], 'p_credits')).toBe(true);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['negative', -5],
  ])('refuses a %s amount before calling the database: it would otherwise reach the function as null, "the rest"', async (_name, credits) => {
    const { client } = rpcClient({ data: [recordedRow], error: null });
    const result = await new BusinessOsCreditLotRepository(client).reverseLot({ ...REVERSE, credits });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('maps already_recorded with its figures (JSON numbers accepted as well as strings)', async () => {
    const { client } = rpcClient({
      data: [{ out_status: 'already_recorded', out_draw_id: DRAW, out_credits: 40, out_remaining_before: 60.5, out_remaining_after: 60.5 }],
      error: null,
    });
    const result = await new BusinessOsCreditLotRepository(client).reverseLot(REVERSE);
    expect(result.data).toEqual({ status: 'already_recorded', drawId: DRAW, credits: 40, remainingBefore: 60.5, remainingAfter: 60.5 });
  });

  it.each(['lot_not_found', 'lot_expired', 'nothing_left', 'exceeds_remaining'])(
    'maps %s with null figures, never 0',
    async (status) => {
      const { client } = rpcClient({
        data: [{ out_status: status, out_draw_id: null, out_credits: null, out_remaining_before: null, out_remaining_after: null }],
        error: null,
      });
      const result = await new BusinessOsCreditLotRepository(client).reverseLot(REVERSE);
      expect(result).toEqual({
        data: { status, drawId: null, credits: null, remainingBefore: null, remainingAfter: null },
        error: null,
      });
    }
  );

  it.each([
    ['the function conflict message', { code: '23505', message: 'idempotency key reused for a different lot' }],
    ['a native unique violation (W11a-4)', { code: '23505', message: 'duplicate key value violates unique constraint "business_os_credit_lot_draws_idempotency_key_key"' }],
  ])('maps %s to idempotency_key_conflict, by SQLSTATE', async (_name, pgError) => {
    const { client } = rpcClient({ data: null, error: pgError });
    const result = await new BusinessOsCreditLotRepository(client).reverseLot(REVERSE);
    expect(result).toEqual({
      data: { status: 'idempotency_key_conflict', drawId: null, credits: null, remainingBefore: null, remainingAfter: null },
      error: null,
    });
  });

  it.each([
    ['22023 invalid amount', { code: '22023', message: 'needs a positive number of credits' }],
    ['42501 permission', { code: '42501', message: 'permission denied for function business_os_reverse_credit_lot' }],
  ])('returns %s as error, never as a status', async (_name, pgError) => {
    const { client } = rpcClient({ data: null, error: pgError });
    const result = await new BusinessOsCreditLotRepository(client).reverseLot(REVERSE);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(mockWarn.mock.calls[0][0]).toMatchObject({ method: 'reverseLot', sqlstate: pgError.code, lotId: LOT });
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('Granted by mistake');
  });

  it.each([
    ['an unknown status', [{ ...recordedRow, out_status: 'partially_recorded' }]],
    ['an unparsable figure', [{ ...recordedRow, out_remaining_after: 'about sixty' }]],
    ['a null figure on recorded', [{ ...recordedRow, out_credits: null }]],
    ['a missing draw id on recorded', [{ ...recordedRow, out_draw_id: null }]],
    ['two rows', [recordedRow, recordedRow]],
    ['no row', []],
  ])('treats %s as an error, never a guess or a 0 (W11a-8)', async (_name, data) => {
    const { client } = rpcClient({ data, error: null });
    const result = await new BusinessOsCreditLotRepository(client).reverseLot(REVERSE);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('never throws: a rejected request is returned as error', async () => {
    const { client } = rpcClient(new Error('aborted'));
    const result = await new BusinessOsCreditLotRepository(client).reverseLot(REVERSE);
    expect(result.error?.message).toBe('aborted');
  });
});

describe('listLotsWithDraws', () => {
  it('reads lots then draws, each scoped by user_id with an explicit column list, and attaches each draw to its lot', async () => {
    const { client, queries } = recordingClient((_calls, index) =>
      index === 0
        ? { data: [lotRaw(LOT), lotRaw(LOT_2, { source: 'boost_purchase', actor_kind: 'stripe_webhook', actor_admin_id: null, reason: null, source_ref: REQUEST, credits_bonus: '10.000000', credits_base: '90.500000' })], error: null }
        : { data: [drawRaw(DRAW, LOT), drawRaw('55555555-5555-4555-8555-555555555556', LOT, 20.5)], error: null }
    );
    const result = await new BusinessOsCreditLotRepository(client).listLotsWithDraws(ACCOUNT);

    expect(result.error).toBeNull();
    expect(queries).toHaveLength(2);
    expect(argsOf(queries[0], 'from')).toEqual([['business_os_credit_lots']]);
    expect(argsOf(queries[0], 'select')).toEqual([[CREDIT_LOT_COLUMNS]]);
    expect(argsOf(queries[0], 'eq')).toEqual([['user_id', ACCOUNT]]);
    expect(argsOf(queries[0], 'order')).toEqual([['created_at', { ascending: true }]]);
    expect(argsOf(queries[0], 'range')).toEqual([[0, CREDIT_LOT_READ_LIMITS.ROWS_CEILING - 1]]);
    expect(argsOf(queries[1], 'from')).toEqual([['business_os_credit_lot_draws']]);
    expect(argsOf(queries[1], 'select')).toEqual([[CREDIT_LOT_DRAW_COLUMNS]]);
    expect(argsOf(queries[1], 'eq')).toEqual([['user_id', ACCOUNT]]);
    expect(argsOf(queries[1], 'in')).toEqual([['lot_id', [LOT, LOT_2]]]);

    const [first, second] = result.data ?? [];
    expect(first).toMatchObject({ id: LOT, accountId: ACCOUNT, source: 'admin_grant', creditsGranted: 100.5, creditsBonus: 0, expiresAt: null });
    expect(first.draws.map((draw) => draw.credits)).toEqual([40, 20.5]);
    expect(first.draws[0]).toMatchObject({ id: DRAW, lotId: LOT, kind: 'reversal', idempotencyKey: `admin_reversal:${DRAW}` });
    expect(second).toMatchObject({ id: LOT_2, source: 'boost_purchase', actorKind: 'stripe_webhook', sourceRef: REQUEST, creditsBonus: 10 });
    expect(second.draws).toEqual([]);
  });

  it('an account with no lot answers [] without a second read', async () => {
    const { client, queries } = recordingClient(() => ({ data: [], error: null }));
    const result = await new BusinessOsCreditLotRepository(client).listLotsWithDraws(ACCOUNT);
    expect(result).toEqual({ data: [], error: null });
    expect(queries).toHaveLength(1);
  });

  it('the column lists name every column explicitly and never *', () => {
    expect(CREDIT_LOT_COLUMNS).not.toContain('*');
    expect(CREDIT_LOT_DRAW_COLUMNS).not.toContain('*');
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20261017_business_os_credit_lots.sql'), 'utf8').replace(/\r\n/g, '\n');
    const columnsOf = (table: string) => {
      const start = migration.indexOf(`CREATE TABLE public.${table} (`);
      return migration
        .slice(start, migration.indexOf('\n);\n', start))
        .split('\n')
        .slice(1)
        .map((line) => line.trim())
        .filter((line) => /^[a-z_]+ /.test(line) && !line.startsWith('CONSTRAINT'))
        .map((line) => line.split(' ')[0]);
    };
    expect(CREDIT_LOT_COLUMNS.split(', ')).toEqual(columnsOf('business_os_credit_lots'));
    expect(CREDIT_LOT_DRAW_COLUMNS.split(', ')).toEqual(columnsOf('business_os_credit_lot_draws'));
  });

  it('an unparsable figure makes the whole read an error, never a 0', async () => {
    const { client } = recordingClient((_calls, index) =>
      index === 0 ? { data: [lotRaw(LOT)], error: null } : { data: [drawRaw(DRAW, LOT, 'forty')], error: null }
    );
    const result = await new BusinessOsCreditLotRepository(client).listLotsWithDraws(ACCOUNT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('unreadable_figure');
  });

  it('reaching the row ceiling is an error, never a partial list', async () => {
    const many = Array.from({ length: CREDIT_LOT_READ_LIMITS.ROWS_CEILING }, (_v, i) =>
      lotRaw(`44444444-4444-4444-8444-${String(i).padStart(12, '0')}`)
    );
    const { client } = recordingClient(() => ({ data: many, error: null }));
    const result = await new BusinessOsCreditLotRepository(client).listLotsWithDraws(ACCOUNT);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('too_many_lots');
  });

  it('chunks the lot ids of the draws read', async () => {
    const lots = Array.from({ length: CREDIT_LOT_READ_LIMITS.MAX_IDS_PER_REQUEST + 1 }, (_v, i) =>
      lotRaw(`44444444-4444-4444-8444-${String(i).padStart(12, '0')}`)
    );
    const { client, queries } = recordingClient((_calls, index) => (index === 0 ? { data: lots, error: null } : { data: [], error: null }));
    const result = await new BusinessOsCreditLotRepository(client).listLotsWithDraws(ACCOUNT);
    expect(result.error).toBeNull();
    expect(queries).toHaveLength(3);
    expect((argsOf(queries[1], 'in')[0][1] as string[]).length).toBe(CREDIT_LOT_READ_LIMITS.MAX_IDS_PER_REQUEST);
    expect((argsOf(queries[2], 'in')[0][1] as string[]).length).toBe(1);
  });

  it('refuses a non-uuid account before querying, and returns a read error as error', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: { code: '42501', message: 'denied' } }));
    const repository = new BusinessOsCreditLotRepository(client);
    expect((await repository.listLotsWithDraws('nope')).error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
    const failed = await repository.listLotsWithDraws(ACCOUNT);
    expect(failed.data).toBeNull();
    expect(failed.error).toBeInstanceOf(Error);
  });
});

describe('findLotForAccount', () => {
  it('scopes by id AND user_id and maps the lot (without draws)', async () => {
    const { client, queries } = recordingClient(() => ({ data: lotRaw(LOT), error: null }));
    const result = await new BusinessOsCreditLotRepository(client).findLotForAccount(LOT, ACCOUNT);
    expect(argsOf(queries[0], 'eq')).toEqual([
      ['id', LOT],
      ['user_id', ACCOUNT],
    ]);
    expect(argsOf(queries[0], 'select')).toEqual([[CREDIT_LOT_COLUMNS]]);
    expect(argsOf(queries[0], 'maybeSingle')).toHaveLength(1);
    expect(result.data).toMatchObject({ id: LOT, creditsGranted: 100.5 });
    expect(result.data).not.toHaveProperty('draws');
  });

  it('a missing or foreign lot is data: null (the same answer)', async () => {
    const { client } = recordingClient(() => ({ data: null, error: null }));
    expect(await new BusinessOsCreditLotRepository(client).findLotForAccount(LOT, ACCOUNT)).toEqual({ data: null, error: null });
  });

  it('refuses non-uuid ids before querying', async () => {
    const { client, queries } = recordingClient(() => ({ data: null, error: null }));
    expect((await new BusinessOsCreditLotRepository(client).findLotForAccount('lot', ACCOUNT)).error).toBeInstanceOf(Error);
    expect((await new BusinessOsCreditLotRepository(client).findLotForAccount(LOT, 'acct')).error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(0);
  });
});

describe('source guards', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'repositories', 'BusinessOsCreditLotRepository.ts'), 'utf8');
  const code = source.replace(/\/\/.*$/gm, '');

  it('writes only through the two RPCs: no .insert(, .update(, .delete( or .upsert(', () => {
    expect(code).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(code.match(/\.rpc\(/g)).toHaveLength(2);
  });

  it('defaults to the service-role client, and the singleton uses it', () => {
    expect(source).toContain("import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';");
    expect(source).toContain('this.supabase = supabaseClient || defaultSupabase;');
    expect((businessOsCreditLotRepository as unknown as { supabase: unknown }).supabase).toEqual({ marker: 'service-role-default' });
  });

  it('the RPC names equal the migration function names', () => {
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20261017_business_os_credit_lots.sql'), 'utf8');
    const created = [...migration.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([BOS_RECORD_CREDIT_LOT_RPC, BOS_REVERSE_CREDIT_LOT_RPC].sort());
  });

  it('never selects *', () => {
    expect(code).not.toMatch(/select\(\s*['"]\*['"]/);
  });
});
