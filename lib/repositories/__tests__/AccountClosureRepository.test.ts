/**
 * AccountClosureRepository (account deletion lifecycle DL-1a, workplan §5.2, T-3; SA W-5).
 *
 * A recording SupabaseClient is injected through the constructor, so each test
 * pins the exact query: the tenant filter (id AND user_id) on every scoped
 * method, the compare-and-set on the old status and on the claim holder, the
 * explicit write payload, and that invalid input never reaches the database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push(args);
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  ACCOUNT_CLOSURE_COLUMNS,
  AccountClosureRepository,
  CLOSURE_CLAIM_FUNCTION,
  CLOSURE_ERROR,
} from '../AccountClosureRepository';
import { ALLOWED_TRANSITIONS, CLOSURE_STATUSES, OPEN_CLOSURE_STATUSES } from '@/lib/business-os/account-deletion/closureLifecycle';

type Call = { method: string; args: unknown[] };
type Result = { data?: unknown; error: unknown; count?: number | null };

/** A recording client. `results` are handed out one per awaited query, in order. */
function client(...results: Result[]) {
  const calls: Call[] = [];
  let next = 0;
  const take = () => results[Math.min(next++, results.length - 1)] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(take());
  const c = {
    from: (table: string) => (calls.push({ method: 'from', args: [table] }), builder),
    rpc: (name: string, params: unknown) => {
      calls.push({ method: 'rpc', args: [name, params] });
      return Promise.resolve(take());
    },
  } as unknown as SupabaseClient;
  return { c, calls };
}

const repo = (c: SupabaseClient) => new AccountClosureRepository(c);

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RUNNER = '33333333-3333-4333-8333-333333333333';
const CLOSURE = '44444444-4444-4444-8444-444444444444';
const CLOSURE2 = '55555555-5555-4555-8555-555555555555';
const T = '2026-10-25T10:00:00.000Z';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CLOSURE,
    user_id: OWNER,
    status: 'requesting',
    requested_at: T,
    statement_language: 'en',
    reason_code: 'too_expensive',
    renewal_was_on: true,
    plan_ends_at: null,
    grace_starts_at: null,
    lock_at: null,
    lock_timezone: null,
    locked_at: null,
    blocked_at: null,
    blocked_codes: [],
    kept_at: null,
    kept_source: null,
    requested_email_sent_at: null,
    grace_email_sent_at: null,
    reminder_email_sent_at: null,
    blocked_email_sent_at: null,
    closed_email_sent_at: null,
    kept_email_sent_at: null,
    closed_email_attempts: 0,
    closed_email_first_attempt_at: null,
    claimed_by: null,
    claimed_at: null,
    attempts: 0,
    next_check_at: null,
    last_error_code: null,
    created_at: T,
    updated_at: T,
    ...overrides,
  };
}

const eqs = (calls: Call[]) => calls.filter((c) => c.method === 'eq').map((c) => c.args);
const dbCalls = (calls: Call[]) => calls.filter((c) => c.method === 'from' || c.method === 'rpc');

beforeEach(() => {
  logged.length = 0;
});

describe('constants', () => {
  it('reads explicit columns, never *', () => {
    expect(ACCOUNT_CLOSURE_COLUMNS).not.toContain('*');
    for (const column of ['user_id', 'status', 'blocked_codes', 'claimed_by', 'next_check_at']) expect(ACCOUNT_CLOSURE_COLUMNS).toContain(column);
    expect(ACCOUNT_CLOSURE_COLUMNS).not.toMatch(/closed_at\b/);
  });

  it('has no closed status (SA W-6) and the free account goes requesting to grace (W-5)', () => {
    expect(CLOSURE_STATUSES).not.toContain('closed');
    expect(ALLOWED_TRANSITIONS.requesting).toEqual(['pending', 'grace']);
    expect(ALLOWED_TRANSITIONS.locked).toEqual(['kept']);
    expect(ALLOWED_TRANSITIONS.kept).toEqual([]);
    expect(Object.values(ALLOWED_TRANSITIONS).flat()).not.toContain('deleted');
  });
});

describe('findOpenForUser', () => {
  it('filters by user_id and the open statuses', async () => {
    const { c, calls } = client({ data: row(), error: null });
    const result = await repo(c).findOpenForUser(OWNER);
    expect(result.data?.id).toBe(CLOSURE);
    expect(calls[0]).toEqual({ method: 'from', args: ['business_os_account_closures'] });
    expect(eqs(calls)).toEqual([['user_id', OWNER]]);
    expect(calls.find((call) => call.method === 'in')?.args).toEqual(['status', [...OPEN_CLOSURE_STATUSES]]);
    expect(calls.some((call) => call.method === 'maybeSingle')).toBe(true);
  });

  it('null when there is none', async () => {
    const { c } = client({ data: null, error: null });
    expect(await repo(c).findOpenForUser(OWNER)).toEqual({ data: null, error: null });
  });

  it('a database error comes back as an error with its code only', async () => {
    const { c } = client({ data: null, error: { code: 'XX000', message: 'boom', details: 'secret detail' } });
    const result = await repo(c).findOpenForUser(OWNER);
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('XX000');
    expect(JSON.stringify(logged)).not.toContain('secret detail');
  });

  it('an invalid id makes no database call', async () => {
    const { c, calls } = client({ data: null, error: null });
    expect((await repo(c).findOpenForUser('not-a-uuid')).error).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

describe('findLatestForUser and findById', () => {
  it('latest: user_id filter, newest first, one row', async () => {
    const { c, calls } = client({ data: [row({ status: 'kept', kept_at: T, kept_source: 'admin' })], error: null });
    const result = await repo(c).findLatestForUser(OWNER);
    expect(result.data?.status).toBe('kept');
    expect(eqs(calls)).toEqual([['user_id', OWNER]]);
    expect(calls.find((call) => call.method === 'order')?.args).toEqual(['created_at', { ascending: false }]);
    expect(calls.find((call) => call.method === 'limit')?.args).toEqual([1]);
  });

  it('latest: error path', async () => {
    const { c } = client({ data: null, error: { code: '57014', message: 'timeout' } });
    expect((await repo(c).findLatestForUser(OWNER)).error).toBeTruthy();
  });

  it('by id: filters id AND user_id, so a foreign id matches nothing', async () => {
    const { c, calls } = client({ data: null, error: null });
    expect(await repo(c).findById(CLOSURE, OTHER)).toEqual({ data: null, error: null });
    expect(eqs(calls)).toEqual([
      ['id', CLOSURE],
      ['user_id', OTHER],
    ]);
  });

  it('by id: error path and invalid input', async () => {
    const { c } = client({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect((await repo(c).findById(CLOSURE, OWNER)).error).toBeTruthy();
    const empty = client();
    expect((await repo(empty.c).findById('x', OWNER)).error).toBeTruthy();
    expect(empty.calls).toEqual([]);
  });
});

describe('insertRequesting', () => {
  const input = { userId: OWNER, statementLanguage: 'he' as const, reasonCode: 'not_using_it', renewalWasOn: false, planEndsAt: null };

  it('writes the explicit field list and returns the parsed row', async () => {
    const { c, calls } = client({ data: row({ statement_language: 'he', reason_code: 'not_using_it', renewal_was_on: false }), error: null });
    const result = await repo(c).insertRequesting(input);
    expect(result.error).toBeNull();
    expect(result.data?.status).toBe('requesting');
    expect(calls.find((call) => call.method === 'insert')?.args).toEqual([
      { user_id: OWNER, statement_language: 'he', reason_code: 'not_using_it', renewal_was_on: false, plan_ends_at: null },
    ]);
  });

  it('drops an injected id, status, user_id or timestamp', async () => {
    const { c, calls } = client({ data: row(), error: null });
    const injected = { ...input, id: CLOSURE2, status: 'locked', user_id: OTHER, requested_at: '2000-01-01T00:00:00Z' } as unknown as typeof input;
    await repo(c).insertRequesting(injected);
    const payload = calls.find((call) => call.method === 'insert')?.args[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['plan_ends_at', 'reason_code', 'renewal_was_on', 'statement_language', 'user_id']);
    expect(payload.user_id).toBe(OWNER);
  });

  it('a second open request (23505 on the open index) is already_open', async () => {
    const { c } = client({ data: null, error: { code: '23505', message: 'duplicate key value' } });
    const result = await repo(c).insertRequesting(input);
    expect((result.error as Error & { code?: string }).code).toBe(CLOSURE_ERROR.ALREADY_OPEN);
  });

  it('other errors pass through with their code', async () => {
    const { c } = client({ data: null, error: { code: '23514', message: 'check violation' } });
    expect(((await repo(c).insertRequesting(input)).error as Error & { code?: string }).code).toBe('23514');
  });

  it.each([
    ['a free-text reason', { reasonCode: 'I hate it' }],
    ['an unknown language', { statementLanguage: 'fr' }],
    ['a bad user id', { userId: 'abc' }],
  ])('%s makes no database call', async (_name, change) => {
    const { c, calls } = client({ data: row(), error: null });
    const result = await repo(c).insertRequesting({ ...input, ...change } as unknown as typeof input);
    expect((result.error as Error & { code?: string }).code).toBe(CLOSURE_ERROR.INVALID);
    expect(calls).toEqual([]);
  });
});

describe('transition', () => {
  it('compare-and-set on id, user_id and the old status, counting rows (no select after update)', async () => {
    const { c, calls } = client({ error: null, count: 1 });
    const result = await repo(c).transition(CLOSURE, OWNER, 'pending', 'grace', { grace_starts_at: T, lock_at: T, lock_timezone: 'Asia/Jerusalem' });
    expect(result).toEqual({ data: true, error: null });
    const update = calls.find((call) => call.method === 'update');
    const payload = update?.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ status: 'grace', grace_starts_at: T, lock_at: T, lock_timezone: 'Asia/Jerusalem' });
    expect(typeof payload.updated_at).toBe('string');
    expect(update?.args[1]).toEqual({ count: 'exact' });
    expect(calls.some((call) => call.method === 'select')).toBe(false);
    expect(eqs(calls)).toEqual([
      ['id', CLOSURE],
      ['user_id', OWNER],
      ['status', 'pending'],
    ]);
  });

  it('false when the row was no longer in the old status', async () => {
    const { c } = client({ error: null, count: 0 });
    expect(await repo(c).transition(CLOSURE, OWNER, 'grace', 'kept', { kept_at: T, kept_source: 'owner' })).toEqual({ data: false, error: null });
  });

  it.each([
    ['locked', 'grace'],
    ['kept', 'pending'],
    ['grace', 'requesting'],
    ['pending', 'locked'],
  ] as const)('%s to %s is refused with no database call', async (from, to) => {
    const { c, calls } = client({ error: null, count: 1 });
    const result = await repo(c).transition(CLOSURE, OWNER, from, to);
    expect((result.error as Error & { code?: string }).code).toBe(CLOSURE_ERROR.TRANSITION);
    expect(calls).toEqual([]);
  });

  it('a column outside the transition allow-list is refused with no database call', async () => {
    const { c, calls } = client({ error: null, count: 1 });
    const result = await repo(c).transition(CLOSURE, OWNER, 'grace', 'locked', { kept_at: T } as never);
    expect((result.error as Error & { code?: string }).code).toBe(CLOSURE_ERROR.INVALID);
    const injected = await repo(c).transition(CLOSURE, OWNER, 'grace', 'locked', { user_id: OTHER } as never);
    expect((injected.error as Error & { code?: string }).code).toBe(CLOSURE_ERROR.INVALID);
    expect(calls).toEqual([]);
  });

  it('a wrong value shape is refused with no database call', async () => {
    const { c, calls } = client({ error: null, count: 1 });
    expect((await repo(c).transition(CLOSURE, OWNER, 'pending', 'kept', { kept_at: T, kept_source: 'nobody' } as never)).error).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('error path', async () => {
    const { c } = client({ error: { code: '23514', message: 'check violation' }, count: null });
    const result = await repo(c).transition(CLOSURE, OWNER, 'grace', 'locked', { locked_at: T });
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('23514');
  });
});

describe('deleteRequesting', () => {
  it('only a requesting row of this account, counted', async () => {
    const { c, calls } = client({ error: null, count: 1 });
    expect(await repo(c).deleteRequesting(CLOSURE, OWNER)).toEqual({ data: true, error: null });
    expect(calls.find((call) => call.method === 'delete')?.args).toEqual([{ count: 'exact' }]);
    expect(eqs(calls)).toEqual([
      ['id', CLOSURE],
      ['user_id', OWNER],
      ['status', 'requesting'],
    ]);
  });

  it('false when nothing matched, error on a database error, nothing on invalid input', async () => {
    expect((await repo(client({ error: null, count: 0 }).c).deleteRequesting(CLOSURE, OWNER)).data).toBe(false);
    expect((await repo(client({ error: { code: 'XX000', message: 'x' }, count: null }).c).deleteRequesting(CLOSURE, OWNER)).error).toBeTruthy();
    const empty = client();
    expect((await repo(empty.c).deleteRequesting(CLOSURE, 'nope')).error).toBeTruthy();
    expect(empty.calls).toEqual([]);
  });
});

describe('claimDue (unscoped by design)', () => {
  it('calls the claim function with the runner and batch only (the lease is a SQL literal) and parses each row', async () => {
    const { c, calls } = client({ data: [row({ claimed_by: RUNNER, claimed_at: T, attempts: 1 })], error: null });
    const result = await repo(c).claimDue(RUNNER, 25);
    expect(result.data?.map((r) => r.id)).toEqual([CLOSURE]);
    expect(calls).toEqual([{ method: 'rpc', args: [CLOSURE_CLAIM_FUNCTION, { p_runner: RUNNER, p_batch: 25 }] }]);
  });

  it('a malformed row is an error, not a silent partial batch', async () => {
    const { c } = client({ data: [row({ status: 'closed' })], error: null });
    const result = await repo(c).claimDue(RUNNER, 5);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('two runs racing get disjoint batches (the SKIP LOCKED contract, modelled)', async () => {
    const first = client({ data: [row({ id: CLOSURE, claimed_by: RUNNER, claimed_at: T })], error: null });
    const second = client({ data: [row({ id: CLOSURE2, claimed_by: OTHER, claimed_at: T })], error: null });
    const a = (await repo(first.c).claimDue(RUNNER, 10)).data ?? [];
    const b = (await repo(second.c).claimDue(OTHER, 10)).data ?? [];
    const overlap = a.map((r) => r.id).filter((id) => b.some((other) => other.id === id));
    expect(overlap).toEqual([]);
  });

  it('error path, and invalid runner or batch makes no call', async () => {
    expect((await repo(client({ data: null, error: { code: '42501', message: 'denied' } }).c).claimDue(RUNNER, 1)).error).toBeTruthy();
    const empty = client();
    expect((await repo(empty.c).claimDue('x', 1)).error).toBeTruthy();
    expect((await repo(empty.c).claimDue(RUNNER, 0)).error).toBeTruthy();
    expect((await repo(empty.c).claimDue(RUNNER, 101)).error).toBeTruthy();
    expect(empty.calls).toEqual([]);
  });
});

describe('updateClaimed (unscoped by design)', () => {
  it('compare-and-set on the claim holder and the status the row had, and releases the claim', async () => {
    const { c, calls } = client({ error: null, count: 1 });
    const result = await repo(c).updateClaimed(CLOSURE, RUNNER, { from: 'pending', patch: { next_check_at: T } });
    expect(result).toEqual({ data: true, error: null });
    const payload = calls.find((call) => call.method === 'update')?.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ next_check_at: T, claimed_by: null, claimed_at: null });
    expect(payload).not.toHaveProperty('status');
    expect(eqs(calls)).toEqual([
      ['id', CLOSURE],
      ['claimed_by', RUNNER],
      ['status', 'pending'],
    ]);
  });

  it('a status change is checked against the map and writes the transition columns', async () => {
    const { c, calls } = client({ error: null, count: 1 });
    await repo(c).updateClaimed(CLOSURE, RUNNER, { from: 'grace', to: 'locked', patch: { locked_at: T } });
    expect(calls.find((call) => call.method === 'update')?.args[0]).toMatchObject({ status: 'locked', locked_at: T });
  });

  it('a disallowed status change or column makes no database call', async () => {
    const { c, calls } = client({ error: null, count: 1 });
    expect(((await repo(c).updateClaimed(CLOSURE, RUNNER, { from: 'locked', to: 'grace' })).error as Error & { code?: string }).code).toBe(
      CLOSURE_ERROR.TRANSITION
    );
    expect((await repo(c).updateClaimed(CLOSURE, RUNNER, { from: 'pending', patch: { locked_at: T } })).error).toBeTruthy();
    expect((await repo(c).updateClaimed(CLOSURE, RUNNER, { from: 'nonsense' as never })).error).toBeTruthy();
    expect(dbCalls(calls)).toEqual([]);
  });

  it('false when the claim was lost, error on a database error', async () => {
    expect((await repo(client({ error: null, count: 0 }).c).updateClaimed(CLOSURE, RUNNER, { from: 'grace' })).data).toBe(false);
    expect((await repo(client({ error: { code: 'XX000', message: 'x' }, count: null }).c).updateClaimed(CLOSURE, RUNNER, { from: 'grace' })).error).toBeTruthy();
  });
});

describe('logs', () => {
  it('never carry the reason code or the language', async () => {
    const { c } = client({ data: row({ reason_code: 'very_private_reason' }), error: null });
    await repo(c).insertRequesting({ userId: OWNER, statementLanguage: 'en', reasonCode: 'very_private_reason', renewalWasOn: true, planEndsAt: T });
    expect(JSON.stringify(logged)).not.toContain('very_private_reason');
  });
});
