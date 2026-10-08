/**
 * TestAccountCleanupRepository against a FAKE rpc and Storage client. No
 * database, no network (SA-12, R-5).
 *
 * The assertions SA asked for: one call of the one function with the secret
 * sent as a parameter, never logged or returned; P0001 = blocked; 42501 =
 * not authorised; no secret = no call at all; storage limited to the target's
 * folder.
 */

const mockLogged: unknown[] = [];
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(...args);
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import {
  CLEANUP_RPC,
  CleanupRpcError,
  STORAGE_REMOVE_BATCH,
  TestAccountCleanupRepository,
  guardIdsIn,
  type CleanupRpcClient,
} from '@/lib/repositories/TestAccountCleanupRepository';

const EMAIL = 'someone+test7@example.org';
const TAG = '+test';
const SECRET = 'a'.repeat(64);
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION = '0123456789abcdef';

type RpcReply = { data: unknown; error: { code?: string | null; message: string } | null };

function fakeClient(reply: (args: Record<string, unknown>) => RpcReply) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const client: CleanupRpcClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return reply(args);
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed.push({ bucket, paths });
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  };
  return { client, calls, removed };
}

const checkRows = [
  { section: 'VERDICT', status: 'BLOCKED', item: `login ${TARGET}`, found: 2, detail: 'Fix' },
  { section: 'guard', status: 'BLOCKED', item: 'G-12 no stored files under the account folder', found: 2, detail: 'Empty them' },
  { section: 'guard', status: 'ok', item: 'G-1 exactly one login has this email', found: 1, detail: '' },
  { section: 'storage', status: 'empty this folder', item: `website-images/${TARGET}/a.png`, found: null, detail: '' },
];

beforeEach(() => {
  mockLogged.length = 0;
});

describe('check', () => {
  it('calls the one function once, in check mode, with the secret as a parameter and no actor', async () => {
    const { client, calls } = fakeClient(() => ({ data: { version: VERSION, mode: 'check', rows: checkRows }, error: null }));
    const result = await new TestAccountCleanupRepository({ client, secret: () => SECRET }).check({ email: EMAIL, tag: TAG });

    expect(calls).toEqual([
      { fn: CLEANUP_RPC, args: { p_mode: 'check', p_email: EMAIL, p_tag: TAG, p_confirm: '', p_actor: null, p_secret: SECRET } },
    ]);
    expect(result.data).toMatchObject({
      version: VERSION,
      verdict: 'BLOCKED',
      targetUserId: TARGET,
      blockers: [{ guard: 'G-12' }],
      storageObjects: [{ bucket: 'website-images', path: `${TARGET}/a.png` }],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('makes no call at all when the secret is unset', async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: null }));
    const result = await new TestAccountCleanupRepository({ client, secret: () => null }).check({ email: EMAIL, tag: TAG });
    expect(calls).toEqual([]);
    expect(result.error).toBeInstanceOf(CleanupRpcError);
    expect((result.error as CleanupRpcError).kind).toBe('not_configured');
  });

  it.each([
    ['42501', 'not_authorised'],
    ['PGRST202', 'function_missing'],
    ['57014', 'failed'],
  ])('maps rpc error %s to %s', async (code, kind) => {
    const { client } = fakeClient(() => ({ data: null, error: { code, message: 'nope' } }));
    const result = await new TestAccountCleanupRepository({ client, secret: () => SECRET }).check({ email: EMAIL, tag: TAG });
    expect((result.error as CleanupRpcError).kind).toBe(kind);
  });

  it('rejects an unexpected result shape, and never logs the arguments', async () => {
    const { client } = fakeClient(() => ({ data: { rows: 'nope' }, error: null }));
    const result = await new TestAccountCleanupRepository({ client, secret: () => SECRET }).check({ email: EMAIL, tag: TAG });
    expect((result.error as CleanupRpcError).kind).toBe('failed');
    const logged = JSON.stringify(mockLogged);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(EMAIL);
  });
});

describe('remove', () => {
  const input = { email: EMAIL, tag: TAG, confirmEmail: EMAIL };

  it('calls delete mode with the admin as actor and parses the report', async () => {
    const { client, calls } = fakeClient(() => ({
      data: {
        version: VERSION,
        mode: 'delete',
        rows: [
          { line: 'crm_contacts', rows_removed: 3, result: null },
          { line: 'TOTAL', rows_removed: 3, result: 'CLEAN', tables_removed: 1, removed_login: TARGET, removed_at: '2026-10-07T10:00:00+00:00', same_run: true },
        ],
      },
      error: null,
    }));
    const result = await new TestAccountCleanupRepository({ client, secret: () => SECRET }).remove(input, ADMIN_ID);
    expect(calls[0].args).toEqual({ p_mode: 'delete', p_email: EMAIL, p_tag: TAG, p_confirm: EMAIL, p_actor: ADMIN_ID, p_secret: SECRET });
    expect(result.data).toEqual({
      kind: 'removed',
      version: VERSION,
      report: {
        tables: [{ table: 'crm_contacts', rowsRemoved: 3 }],
        total: { result: 'CLEAN', rowsRemoved: 3, tablesRemoved: 1, removedLogin: TARGET, removedAt: '2026-10-07T10:00:00+00:00', sameRun: true },
      },
    });
  });

  it('a guard that raised (P0001) is BLOCKED with its guard ids', async () => {
    const { client } = fakeClient(() => ({
      data: null,
      error: { code: 'P0001', message: 'BLOCKED, nothing was removed: G-12 no stored files, G-5 nothing ever ran in Stripe live mode' },
    }));
    const result = await new TestAccountCleanupRepository({ client, secret: () => SECRET }).remove(input, ADMIN_ID);
    expect(result.data).toEqual({ kind: 'blocked', guards: ['G-12', 'G-5'], reason: expect.stringContaining('BLOCKED') });
  });

  it('42501 on delete is an error of kind not_authorised, not a block', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: '42501', message: 'not authorised' } }));
    const result = await new TestAccountCleanupRepository({ client, secret: () => SECRET }).remove(input, ADMIN_ID);
    expect(result.data).toBeNull();
    expect((result.error as CleanupRpcError).kind).toBe('not_authorised');
  });
});

describe('emptyStorage', () => {
  it('removes exactly the given paths, by bucket, in batches of at most 1000', async () => {
    const { client, removed } = fakeClient(() => ({ data: null, error: null }));
    const repo = new TestAccountCleanupRepository({ client, secret: () => SECRET });
    const many = Array.from({ length: STORAGE_REMOVE_BATCH + 5 }, (_v, i) => ({ bucket: 'website-images', path: `${TARGET}/${i}.png` }));
    const result = await repo.emptyStorage(TARGET, [...many, { bucket: 'contact-documents', path: `${TARGET}/doc.pdf` }]);
    expect(result.data).toEqual({ removed: STORAGE_REMOVE_BATCH + 6, failed: 0 });
    expect(removed.map((r) => [r.bucket, r.paths.length])).toEqual([
      ['website-images', STORAGE_REMOVE_BATCH],
      ['website-images', 5],
      ['contact-documents', 1],
    ]);
  });

  it('refuses everything when one path is outside the account folder or a descriptor bucket', async () => {
    const { client, removed } = fakeClient(() => ({ data: null, error: null }));
    const repo = new TestAccountCleanupRepository({ client, secret: () => SECRET });
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect((await repo.emptyStorage(TARGET, [{ bucket: 'website-images', path: `${other}/a.png` }])).error).not.toBeNull();
    expect((await repo.emptyStorage(TARGET, [{ bucket: 'avatars', path: `${TARGET}/a.png` }])).error).not.toBeNull();
    expect(removed).toEqual([]);
  });
});

describe('guardIdsIn', () => {
  it('lists each guard id once, in order', () => {
    expect(guardIdsIn('BLOCKED: G-12 a, G-4 b, G-12 c')).toEqual(['G-12', 'G-4']);
  });
});
