/**
 * AvatarService: the C-20 ownership check and the storage calls behind
 * `POST` / `DELETE /api/user/avatar` (settings drawer D-3).
 *
 * The delete runs as the service role and is driven by `profiles.avatar_url`,
 * a value the browser can still write (F-14, F-28). So the check is the tenant
 * boundary (`tenant-isolation-guard`): only this project's public URL for the
 * `avatars` bucket, and only the two exact shapes the header documents
 * (SA-D3-8), for the SESSION user. Everything else is skipped, never deleted.
 *
 * SA-D3-3: a URL this service writes is a URL it can delete (round trip),
 * whether or not `NEXT_PUBLIC_SUPABASE_URL` carries a trailing slash, and the
 * legacy root files production holds today (LC-3, incl. the `.ico`) are
 * deletable by their owner.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) {
    logger[level] = (...args: unknown[]) => logged.push({ level, args });
  }
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import {
  AVATAR_BUCKET,
  AvatarService,
  classifyStoredAvatarUrl,
  ownedAvatarObjectPath,
  safeStorageError,
} from '../AvatarService';

const BASE = 'https://proj.supabase.co';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FILE_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PREFIX = `${BASE}/storage/v1/object/public/avatars/`;

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

/** Supabase's own public-URL format (storage-js `getPublicUrl`): encodeURI over base + path. */
function realFormatPublicUrl(base: string, path: string): string {
  return encodeURI(`${base.replace(/\/+$/, '')}/storage/v1/object/public/${AVATAR_BUCKET}/${path}`);
}

type StorageCall = { method: string; args: unknown[] };

function fakeStorageClient(opts: {
  base?: string;
  uploadError?: unknown;
  removeError?: unknown;
  removeThrows?: boolean;
} = {}) {
  const calls: StorageCall[] = [];
  const bucket = {
    upload: async (...args: unknown[]) => {
      calls.push({ method: 'upload', args });
      return { data: opts.uploadError ? null : { path: args[0] }, error: opts.uploadError ?? null };
    },
    remove: async (...args: unknown[]) => {
      calls.push({ method: 'remove', args });
      if (opts.removeThrows) throw new Error('network down');
      return { data: [], error: opts.removeError ?? null };
    },
    getPublicUrl: (path: string) => {
      calls.push({ method: 'getPublicUrl', args: [path] });
      return { data: { publicUrl: realFormatPublicUrl(opts.base ?? BASE, path) } };
    },
  };
  const client = {
    storage: {
      from: (name: string) => {
        calls.push({ method: 'from', args: [name] });
        return bucket;
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const removes = (calls: StorageCall[]) => calls.filter((c) => c.method === 'remove');

beforeEach(() => {
  logged.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
});

afterAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
});

describe('ownedAvatarObjectPath (C-20)', () => {
  it.each([
    ['own folder file', `${PREFIX}${USER}/${FILE_UUID}.png`, `${USER}/${FILE_UUID}.png`],
    ['own folder jpg', `${PREFIX}${USER}/${FILE_UUID}.jpg`, `${USER}/${FILE_UUID}.jpg`],
    ['own folder webp', `${PREFIX}${USER}/${FILE_UUID}.webp`, `${USER}/${FILE_UUID}.webp`],
    ['own folder gif', `${PREFIX}${USER}/${FILE_UUID}.gif`, `${USER}/${FILE_UUID}.gif`],
    ['own legacy root jpg (LC-3 shape, 13 digits)', `${PREFIX}${USER}-1752000000000.jpg`, `${USER}-1752000000000.jpg`],
    ['own legacy root ico (LC-4)', `${PREFIX}${USER}-1752000000000.ico`, `${USER}-1752000000000.ico`],
    ['own legacy root uppercase ext', `${PREFIX}${USER}-1752000000000.JPEG`, `${USER}-1752000000000.JPEG`],
    ['query string ignored (Q-11)', `${PREFIX}${USER}/${FILE_UUID}.png?t=123`, `${USER}/${FILE_UUID}.png`],
    ['fragment ignored (Q-11)', `${PREFIX}${USER}/${FILE_UUID}.png#x`, `${USER}/${FILE_UUID}.png`],
    [
      'percent-encoded stored form is decoded (M-16)',
      `${PREFIX}${USER}%2F${FILE_UUID.replace(/a/g, '%61')}.png`,
      `${USER}/${FILE_UUID}.png`,
    ],
  ])('%s -> deletable', (_name, stored, path) => {
    expect(ownedAvatarObjectPath(stored, USER, BASE)).toBe(path);
  });

  it.each([
    ['other account folder', `${PREFIX}${OTHER}/${FILE_UUID}.png`, 'other_account'],
    ['other account legacy', `${PREFIX}${OTHER}-1752000000000.jpg`, 'other_account'],
    ['own id as a prefix, then a folder (M-14)', `${PREFIX}${USER}0/${FILE_UUID}.png`, 'unrecognised_path'],
    ['own id with no separator (M-14)', `${PREFIX}${USER}x${FILE_UUID}.png`, 'unrecognised_path'],
    ['own id then digits, no dash (M-14)', `${PREFIX}${USER}01752000000000.jpg`, 'unrecognised_path'],
    ['uppercase extension in folder form', `${PREFIX}${USER}/${FILE_UUID}.PNG`, 'unrecognised_path'],
    ['svg in folder form', `${PREFIX}${USER}/${FILE_UUID}.svg`, 'unrecognised_path'],
    ['odd file in own folder', `${PREFIX}${USER}/photo.png`, 'unrecognised_path'],
    ['nested path in own folder', `${PREFIX}${USER}/x/${FILE_UUID}.png`, 'unrecognised_path'],
    ['legacy name with letters in the timestamp', `${PREFIX}${USER}-17520abc.jpg`, 'unrecognised_path'],
    ['legacy name with a slash after it', `${PREFIX}${USER}-1752000000000.jpg/x`, 'unrecognised_path'],
    ['old wrong-path form avatars/<file>', `${PREFIX}avatars/${USER}-1752000000000.jpg`, 'unrecognised_path'],
    ['website-logos object (LC-3)', `${PREFIX}website-logos/logo.svg`, 'unrecognised_path'],
    [
      'encoded traversal %2E%2E%2F (M-15)',
      `${PREFIX}${USER}/%2E%2E%2F${OTHER}%2F${FILE_UUID}.png`,
      'unrecognised_path',
    ],
    ['literal ../ out of own legacy name', `${PREFIX}${USER}-1/../${OTHER}-2.png`, 'other_account'],
    ['literal ../ out of own folder', `${PREFIX}${USER}/../${OTHER}/${FILE_UUID}.png`, 'other_account'],
    ['encoded ../ segments', `${PREFIX}${USER}/%2e%2e/${OTHER}/${FILE_UUID}.png`, 'other_account'],
    ['Google photo', 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c', 'external'],
    ['other origin, same path (M-13)', `https://evil.example.com/storage/v1/object/public/avatars/${USER}/${FILE_UUID}.png`, 'external'],
    ['http vs https', `http://proj.supabase.co/storage/v1/object/public/avatars/${USER}/${FILE_UUID}.png`, 'external'],
    ['other port', `https://proj.supabase.co:8443/storage/v1/object/public/avatars/${USER}/${FILE_UUID}.png`, 'external'],
    ['look-alike host', `https://proj.supabase.co.evil.com/storage/v1/object/public/avatars/${USER}/${FILE_UUID}.png`, 'external'],
    ['signed URL', `${BASE}/storage/v1/object/sign/avatars/${USER}/${FILE_UUID}.png?token=x`, 'external'],
    ['transform URL', `${BASE}/storage/v1/render/image/public/avatars/${USER}/${FILE_UUID}.png`, 'external'],
    ['look-alike bucket', `${BASE}/storage/v1/object/public/avatars-old/${USER}/${FILE_UUID}.png`, 'external'],
    ['another bucket', `${BASE}/storage/v1/object/public/website-images/${USER}/${FILE_UUID}.png`, 'external'],
  ])('%s -> not deleted (%s)', (_name, stored, reason) => {
    expect(ownedAvatarObjectPath(stored, USER, BASE)).toBeNull();
    expect(classifyStoredAvatarUrl(stored, USER, BASE)).toEqual({ owned: false, reason });
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('%s stored -> nothing to consider', (_name, stored) => {
    expect(ownedAvatarObjectPath(stored, USER, BASE)).toBeNull();
    expect(classifyStoredAvatarUrl(stored, USER, BASE)).toBeNull();
  });

  it.each([
    ['not a URL', 'not a url'],
    ['relative path', `/storage/v1/object/public/avatars/${USER}/${FILE_UUID}.png`],
    ['bad percent-encoding', `${PREFIX}${USER}/%E0%A4%A.png`],
  ])('%s -> not deleted', (_name, stored) => {
    expect(ownedAvatarObjectPath(stored, USER, BASE)).toBeNull();
  });

  it('M-28: a missing NEXT_PUBLIC_SUPABASE_URL fails closed (never "match anything")', () => {
    const own = `${PREFIX}${USER}/${FILE_UUID}.png`;
    expect(ownedAvatarObjectPath(own, USER, undefined)).toBeNull();
    expect(ownedAvatarObjectPath(own, USER, '')).toBeNull();
    expect(ownedAvatarObjectPath(own, USER, 'not a url')).toBeNull();
  });

  it('an empty user id fails closed', () => {
    expect(ownedAvatarObjectPath(`${PREFIX}/${FILE_UUID}.png`, '', BASE)).toBeNull();
    expect(ownedAvatarObjectPath(`${PREFIX}-1752000000000.jpg`, '', BASE)).toBeNull();
  });
});

describe('SA-D3-3: round trip from upload to delete', () => {
  it('(a) the URL upload returns passes back to exactly the uploaded path, through removeIfOwned (M-29)', async () => {
    const { client, calls } = fakeStorageClient();
    const service = new AvatarService(client);

    const uploaded = await service.upload(USER, new ArrayBuffer(8), 'image/png');
    expect(uploaded.error).toBeNull();
    const { path, publicUrl } = uploaded.data!;
    expect(publicUrl).toBe(`${PREFIX}${path}`);
    expect(ownedAvatarObjectPath(publicUrl, USER, process.env.NEXT_PUBLIC_SUPABASE_URL)).toBe(path);

    // removeIfOwned reads NEXT_PUBLIC_SUPABASE_URL itself: a different base is a skip, not a delete.
    expect(await service.removeIfOwned(USER, publicUrl)).toBe('removed');
    expect(removes(calls)).toEqual([{ method: 'remove', args: [[path]] }]);
  });

  it('(a) also with the real supabase-js getPublicUrl (no network)', () => {
    const real = createClient(BASE, 'anon-key-for-format-only', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const path = `${USER}/${FILE_UUID}.webp`;
    const publicUrl = real.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
    expect(ownedAvatarObjectPath(publicUrl, USER, BASE)).toBe(path);
  });

  it('(b) the env value with a trailing slash', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = `${BASE}/`;
    const { client, calls } = fakeStorageClient({ base: `${BASE}/` });
    const service = new AvatarService(client);

    const { path, publicUrl } = (await service.upload(USER, new ArrayBuffer(8), 'image/jpeg')).data!;
    expect(publicUrl).not.toContain('//storage');
    expect(ownedAvatarObjectPath(publicUrl, USER, `${BASE}/`)).toBe(path);
    expect(await service.removeIfOwned(USER, publicUrl)).toBe('removed');
    expect(removes(calls)).toEqual([{ method: 'remove', args: [[path]] }]);

    const real = createClient(`${BASE}/`, 'anon-key-for-format-only', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const realUrl = real.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
    expect(ownedAvatarObjectPath(realUrl, USER, `${BASE}/`)).toBe(path);
    expect(ownedAvatarObjectPath(realUrl, USER, BASE)).toBe(path);
  });

  it.each([
    ['jpg', `${USER}-1752345678901.jpg`],
    ['ico', `${USER}-1752345678901.ico`],
    ['png', `${USER}-1752345678901.png`],
  ])('(c) an LC-3-shaped legacy %s, as the old hook stored it, is deletable by its owner only', async (_ext, name) => {
    const stored = realFormatPublicUrl(BASE, name);
    expect(ownedAvatarObjectPath(stored, USER, BASE)).toBe(name);
    expect(ownedAvatarObjectPath(stored, OTHER, BASE)).toBeNull();

    const { client, calls } = fakeStorageClient();
    expect(await new AvatarService(client).removeIfOwned(USER, stored)).toBe('removed');
    expect(removes(calls)).toEqual([{ method: 'remove', args: [[name]] }]);
  });
});

describe('AvatarService.upload', () => {
  it('stores at <userId>/<uuid>.<ext from the type>, never overwrites, content type as given', async () => {
    const { client, calls } = fakeStorageClient();
    const body = new ArrayBuffer(16);
    const result = await new AvatarService(client).upload(USER, body, 'image/gif');

    expect(calls[0]).toEqual({ method: 'from', args: ['avatars'] });
    const upload = calls.find((c) => c.method === 'upload')!;
    const [path, sent, options] = upload.args as [string, ArrayBuffer, Record<string, unknown>];
    expect(path).toMatch(new RegExp(`^${USER}/[0-9a-f-]{36}\\.gif$`));
    expect(sent).toBe(body);
    expect(options).toEqual({ contentType: 'image/gif', cacheControl: '3600', upsert: false });
    expect(result).toEqual({ data: { path, publicUrl: `${PREFIX}${path}` }, error: null });
  });

  it('two uploads never share a path', async () => {
    const { client } = fakeStorageClient();
    const service = new AvatarService(client);
    const a = await service.upload(USER, new ArrayBuffer(1), 'image/png');
    const b = await service.upload(USER, new ArrayBuffer(1), 'image/png');
    expect(a.data!.path).not.toBe(b.data!.path);
  });

  it('a storage error is returned reduced, logged without the path, never thrown', async () => {
    const storageError = Object.assign(new Error('Bucket quota MARKER-STORAGE'), { statusCode: '413' });
    const { client } = fakeStorageClient({ uploadError: storageError });
    const result = await new AvatarService(client).upload(USER, new ArrayBuffer(1), 'image/png');

    expect(result).toEqual({ data: null, error: { code: '413', message: 'Bucket quota MARKER-STORAGE' } });
    const entry = logged.find((e) => e.level === 'error')!;
    expect(entry.args[0]).toEqual({ userId: USER, err: { code: '413', message: 'Bucket quota MARKER-STORAGE' } });
    expect(JSON.stringify(logged)).not.toContain(`${USER}/`);
  });
});

describe('AvatarService.removeIfOwned', () => {
  it('nothing stored: no storage call', async () => {
    const { client, calls } = fakeStorageClient();
    expect(await new AvatarService(client).removeIfOwned(USER, null)).toBe('none');
    expect(await new AvatarService(client).removeIfOwned(USER, '')).toBe('none');
    expect(calls).toEqual([]);
  });

  it.each([
    ['external', 'https://lh3.googleusercontent.com/a/photo-MARKER-URL'],
    ['other_account', `${PREFIX}${OTHER}/${FILE_UUID}.png?MARKER-URL`],
    ['unrecognised_path', `${PREFIX}${USER}/MARKER-URL.png`],
  ])('a %s URL makes no storage call and logs the classification only', async (reason, stored) => {
    const { client, calls } = fakeStorageClient();
    expect(await new AvatarService(client).removeIfOwned(USER, stored)).toBe('skipped');
    expect(calls).toEqual([]);
    expect(logged).toEqual([{ level: 'info', args: [{ userId: USER, reason }, 'Previous avatar not deleted'] }]);
    expect(JSON.stringify(logged)).not.toContain('MARKER-URL');
  });

  it('a missing NEXT_PUBLIC_SUPABASE_URL deletes nothing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { client, calls } = fakeStorageClient();
    expect(await new AvatarService(client).removeIfOwned(USER, `${PREFIX}${USER}/${FILE_UUID}.png`)).toBe('skipped');
    expect(removes(calls)).toEqual([]);
  });

  it.each([
    ['returns an error', { removeError: Object.assign(new Error('denied'), { statusCode: '403' }) }],
    ['throws', { removeThrows: true }],
  ])('a remove that %s is reported, logged at warn without the path, never thrown', async (_name, opts) => {
    const { client } = fakeStorageClient(opts);
    const stored = `${PREFIX}${USER}/${FILE_UUID}.png`;
    expect(await new AvatarService(client).removeIfOwned(USER, stored)).toBe('failed');
    const entry = logged.find((e) => e.level === 'warn')!;
    expect((entry.args[0] as Record<string, unknown>).kind).toBe('folder');
    expect(JSON.stringify(logged)).not.toContain(FILE_UUID);
  });
});

describe('AvatarService.removeOwnNew', () => {
  it('removes a path in the user folder', async () => {
    const { client, calls } = fakeStorageClient();
    expect(await new AvatarService(client).removeOwnNew(USER, `${USER}/${FILE_UUID}.png`)).toBe(true);
    expect(removes(calls)).toEqual([{ method: 'remove', args: [[`${USER}/${FILE_UUID}.png`]] }]);
  });

  it('refuses a path outside the user folder', async () => {
    const { client, calls } = fakeStorageClient();
    expect(await new AvatarService(client).removeOwnNew(USER, `${OTHER}/${FILE_UUID}.png`)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a failure is logged and reported, never thrown', async () => {
    const { client } = fakeStorageClient({ removeThrows: true });
    expect(await new AvatarService(client).removeOwnNew(USER, `${USER}/${FILE_UUID}.png`)).toBe(false);
    expect(logged.some((e) => e.level === 'error')).toBe(true);
  });
});

describe('safeStorageError', () => {
  it('keeps code and message only', () => {
    const raw = Object.assign(new Error('m'), { statusCode: '404', error: 'x', details: 'secret' });
    expect(safeStorageError(raw)).toEqual({ code: '404', message: 'm' });
    expect(safeStorageError('boom')).toEqual({ code: undefined, message: 'boom' });
  });
});
