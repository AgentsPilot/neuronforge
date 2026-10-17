/**
 * DE-8b T-8 (workplan §3.1, §12; SA C-3, C-10): the export bucket repository.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessOsDataExportStorageRepository } from '../BusinessOsDataExportStorageRepository';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, __logger: logger };
});
const mockLogger = (jest.requireMock('@/lib/logger') as { __logger: Record<string, jest.Mock> }).__logger;

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const J = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const J2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function fake(listing: Record<string, Array<Record<string, unknown>>> = {}) {
  const bucketCalls: string[] = [];
  const api = {
    upload: jest.fn(async () => ({ data: { path: 'x' }, error: null as unknown })),
    createSignedUrl: jest.fn(async () => ({ data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/p?token=SECRET&download=n' }, error: null as unknown })),
    remove: jest.fn(async () => ({ data: [], error: null as unknown })),
    list: jest.fn(async (prefix: string, opts: { limit: number; offset: number }) => ({
      data: (listing[prefix] ?? []).slice(opts.offset, opts.offset + opts.limit),
      error: null as unknown,
    })),
  };
  const client = {
    storage: {
      from: (bucket: string) => {
        bucketCalls.push(bucket);
        return api;
      },
    },
  } as unknown as SupabaseClient;
  return { api, bucketCalls, repo: new BusinessOsDataExportStorageRepository(client, () => 1_000) };
}

beforeEach(() => jest.clearAllMocks());

describe('upload', () => {
  it('writes {user}/{job}/1.zip as application/zip, never upserting', async () => {
    const { api, repo, bucketCalls } = fake();
    const bytes = new Uint8Array([80, 75, 5, 6]);
    expect(await repo.upload(U, J, bytes)).toEqual({ data: true, error: null });
    expect(api.upload).toHaveBeenCalledWith(`${U}/${J}/1.zip`, bytes, { contentType: 'application/zip', upsert: false });
    expect(bucketCalls).toEqual(['business-data-exports']);
  });

  it('a storage error is returned, not thrown', async () => {
    const { api, repo } = fake();
    api.upload.mockResolvedValueOnce({ data: null as never, error: { message: 'Payload too large' } });
    const { data, error } = await repo.upload(U, J, new Uint8Array(1));
    expect(data).toBeNull();
    expect(error?.message).toBe('Payload too large');
  });

  it('non-uuid ids fail before any call (exportObjectPath)', async () => {
    const { api, repo } = fake();
    for (const [u, j] of [['../x', J], [U, '1.zip'], ['', '']]) {
      expect((await repo.upload(u, j, new Uint8Array(1))).error).not.toBeNull();
      expect((await repo.sign(u, j, 120, 'x.zip')).error).not.toBeNull();
      expect((await repo.remove(u, j)).error).not.toBeNull();
    }
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.createSignedUrl).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });
});

describe('sign', () => {
  it('passes the TTL and the download name, and returns the URL', async () => {
    const { api, repo } = fake();
    const { data } = await repo.sign(U, J, 120, 'סטודיו-data-export-2026-10-17-0930.zip');
    expect(data).toContain('token=SECRET');
    expect(api.createSignedUrl).toHaveBeenCalledWith(`${U}/${J}/1.zip`, 120, { download: 'סטודיו-data-export-2026-10-17-0930.zip' });
  });

  it('C-3: neither the URL nor the download name is ever logged, even on failure', async () => {
    const { api, repo } = fake();
    await repo.sign(U, J, 120, 'acme-data-export.zip');
    api.createSignedUrl.mockResolvedValueOnce({ data: null as never, error: { message: 'boom' } });
    await repo.sign(U, J, 120, 'acme-data-export.zip');
    const logged = JSON.stringify([mockLogger.info.mock.calls, mockLogger.warn.mock.calls, mockLogger.error.mock.calls]);
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('acme-data-export');
  });

  it('a TTL outside 1..600 is refused', async () => {
    const { api, repo } = fake();
    expect((await repo.sign(U, J, 0, 'x')).error).not.toBeNull();
    expect((await repo.sign(U, J, 3600, 'x')).error).not.toBeNull();
    expect(api.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe('remove', () => {
  it('removes exactly the one path, idempotently', async () => {
    const { api, repo } = fake();
    expect((await repo.remove(U, J)).error).toBeNull();
    expect((await repo.remove(U, J)).error).toBeNull();
    expect(api.remove).toHaveBeenCalledWith([`${U}/${J}/1.zip`]);
  });
});

describe('listForSweep (SA C-10)', () => {
  it('returns only {uuid}/{uuid}/1.zip and counts everything else', async () => {
    const { repo } = fake({
      '': [{ name: U, id: null }, { name: 'not-a-uuid', id: null }, { name: 'stray.zip', id: 'o1' }],
      [U]: [{ name: J, id: null }, { name: J2, id: null }, { name: 'loose.zip', id: 'o2' }, { name: 'nested', id: null }],
      [`${U}/${J}`]: [{ name: '1.zip', id: 'o3', created_at: '2026-10-17T00:00:00Z' }, { name: '2.zip', id: 'o4' }],
      [`${U}/${J2}`]: [{ name: '1.zip', id: 'o5' }],
    });
    const { data } = await repo.listForSweep({ deadlineAt: Number.MAX_SAFE_INTEGER, callsLeft: 100 });
    expect(data!.objects).toEqual([
      { userId: U, jobId: J, createdAt: '2026-10-17T00:00:00Z' },
      { userId: U, jobId: J2, createdAt: null },
    ]);
    // not-a-uuid, stray.zip, loose.zip, nested, 2.zip
    expect(data!.unexpected).toBe(5);
    expect(data!.truncated).toBe(false);
  });

  it('stops at its budget with truncated', async () => {
    const { repo } = fake({ '': [{ name: U, id: null }], [U]: [{ name: J, id: null }] });
    const { data } = await repo.listForSweep({ deadlineAt: Number.MAX_SAFE_INTEGER, callsLeft: 1 });
    expect(data!.truncated).toBe(true);
  });
});
