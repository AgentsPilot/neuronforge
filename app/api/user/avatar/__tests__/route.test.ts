/**
 * POST / DELETE /api/user/avatar (settings drawer D-3, C-19, C-20, C-23).
 *
 * CLAUDE.md minimum (happy path, auth failure, invalid input), plus what this
 * route exists to hold:
 *   - the file's bytes decide its type; the claimed MIME type and the name are
 *     ignored; SVG never gets in (F-16);
 *   - 4 MB exactly is allowed, one byte more is a 413;
 *   - the form may hold `file` and nothing else, and no query string, so a
 *     request cannot name an account (C-23);
 *   - an old file is deleted only after the new URL is saved, and only if the
 *     C-20 check proves it is the session user's (other accounts, Google
 *     photos, look-alikes and traversal are never deleted);
 *   - Remove deletes a legacy root file (the F-8 regression);
 *   - no URL, path, file name or storage / database message is ever logged on
 *     a refusal or returned to the client (G-1, SA-D3-9).
 *
 * `AvatarService` and `lib/validation/avatar.ts` run for real, so the
 * ownership check is exercised end to end. Only the storage client, the
 * repository, auth, audit and the logger are mocked.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = jest.fn(() => logger);
  return { createLogger: () => logger };
});

const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...a: unknown[]) => auditLog(...a) }) },
}));

const findAvatarUrl = jest.fn();
const setAvatarUrl = jest.fn();
const clearAvatarUrl = jest.fn();
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  userProfileRepository: {
    findAvatarUrl: (...a: unknown[]) => findAvatarUrl(...a),
    setAvatarUrl: (...a: unknown[]) => setAvatarUrl(...a),
    clearAvatarUrl: (...a: unknown[]) => clearAvatarUrl(...a),
  },
}));

const storageFrom = jest.fn();
const upload = jest.fn();
const remove = jest.fn();
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    storage: {
      from: (...a: unknown[]) => {
        storageFrom(...a);
        return {
          upload: (...b: unknown[]) => upload(...b),
          remove: (...b: unknown[]) => remove(...b),
          // storage-js's own format: encodeURI over `<url>/storage/v1/object/public/<bucket>/<path>`.
          getPublicUrl: (path: string) => ({
            data: { publicUrl: encodeURI(`${BASE}/storage/v1/object/public/avatars/${path}`) },
          }),
        };
      },
    },
  },
}));

import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { AVATAR_MAX_BYTES } from '@/lib/validation/avatar';
import { POST, DELETE } from '../route';

const log = createLogger({ module: 'test' }) as unknown as Record<'info' | 'warn' | 'error' | 'debug' | 'child', jest.Mock>;

const BASE = 'https://proj.supabase.co';
const PREFIX = `${BASE}/storage/v1/object/public/avatars/`;
const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OLD_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ROUTE_URL = 'http://localhost/api/user/avatar';
const NAME_MARKER = 'MARKER-NAME';
const FIELD_MARKER = 'MARKER-FIELD';
const STORAGE_MARKER = 'MARKER-STORAGE-MESSAGE';
const DB_MARKER = 'MARKER-DB-MESSAGE';

const ORIGINAL_ENV = process.env.NODE_ENV;
const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const GIF_HEAD = [...'GIF89a'].map((c) => c.charCodeAt(0)).concat([1, 0, 1, 0, 0, 0]);
const WEBP_HEAD = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0x24, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)));
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

function imageBytes(head: number[], size = 64): Uint8Array {
  const out = new Uint8Array(size);
  out.set(head);
  return out;
}

function fileOf(bytes: Uint8Array | string, name: string, type: string): File {
  // A fresh copy: `Uint8Array<ArrayBufferLike>` is not a `BlobPart` under the current DOM lib.
  return new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name, { type });
}

function postReq(form: FormData, opts: { query?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(ROUTE_URL + (opts.query ?? ''), { method: 'POST', body: form, headers: opts.headers });
}

function formWith(file: File | string): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

function pngForm(name = `${NAME_MARKER}.png`, size = 64): FormData {
  return formWith(fileOf(imageBytes(PNG_HEAD, size), name, 'image/png'));
}

function deleteReq(query = ''): NextRequest {
  return new NextRequest(ROUTE_URL + query, { method: 'DELETE' });
}

function setEnv(value: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

/** Every argument any logger level was called with, serialised. */
function allLogged(): string {
  return JSON.stringify((['info', 'warn', 'error', 'debug'] as const).flatMap((level) => log[level].mock.calls));
}

function uploadedPath(): string {
  return upload.mock.calls[0][0] as string;
}

function removedPaths(): string[] {
  return remove.mock.calls.map((c) => (c[0] as string[])[0]);
}

function nothingCalled() {
  expect(findAvatarUrl).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(setAvatarUrl).not.toHaveBeenCalled();
  expect(clearAvatarUrl).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(auditLog).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  getUser.mockResolvedValue({ id: SESSION, email: 'owner@example.com' });
  auditLog.mockResolvedValue(undefined);
  findAvatarUrl.mockResolvedValue({ data: null, error: null });
  setAvatarUrl.mockResolvedValue({ data: true, error: null });
  clearAvatarUrl.mockResolvedValue({ data: true, error: null });
  upload.mockResolvedValue({ data: { path: 'x' }, error: null });
  remove.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  setEnv(ORIGINAL_ENV);
});

afterAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
});

describe('POST /api/user/avatar: happy paths', () => {
  it('P-1: a PNG is stored at <session>/<uuid>.png, never overwriting, and its URL saved and audited', async () => {
    const res = await POST(postReq(pngForm()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(storageFrom).toHaveBeenCalledWith('avatars');
    const [path, , options] = upload.mock.calls[0] as [string, ArrayBuffer, Record<string, unknown>];
    expect(path).toMatch(new RegExp(`^${SESSION}/[0-9a-f-]{36}\\.png$`));
    expect(options).toEqual({ contentType: 'image/png', cacheControl: '3600', upsert: false });
    expect(body).toEqual({ success: true, data: { avatar_url: `${PREFIX}${path}` } });
    expect(findAvatarUrl).toHaveBeenCalledWith(SESSION);
    expect(setAvatarUrl).toHaveBeenCalledWith(SESSION, `${PREFIX}${path}`);
    expect(remove).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      action: AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED,
      entityType: 'user',
      entityId: SESSION,
      userId: SESSION,
      details: { fields: ['avatar_url'], change: 'uploaded' },
    });
    expect(JSON.stringify(auditLog.mock.calls[0][0].details)).not.toContain(path);
  });

  it('P-1: the whole file is uploaded', async () => {
    await POST(postReq(pngForm('a.png', 1000)));
    const sent = upload.mock.calls[0][1] as ArrayBuffer;
    expect(sent.byteLength).toBe(1000);
    expect(Array.from(new Uint8Array(sent).slice(0, 8))).toEqual(PNG_HEAD.slice(0, 8));
  });

  it.each([
    ['JPEG', 'image/jpeg', 'jpg', JPEG_HEAD],
    ['WebP', 'image/webp', 'webp', WEBP_HEAD],
    ['GIF', 'image/gif', 'gif', GIF_HEAD],
  ])('P-2: %s -> %s, .%s, from the bytes', async (_name, type, ext, head) => {
    const res = await POST(postReq(formWith(fileOf(imageBytes(head), 'photo', 'application/octet-stream'))));

    expect(res.status).toBe(200);
    expect(uploadedPath()).toMatch(new RegExp(`^${SESSION}/[0-9a-f-]{36}\\.${ext}$`));
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: type });
  });

  it('P-3: a real PNG named .svg and declared image/svg+xml is stored as a PNG (Q-1, M-3, M-4)', async () => {
    const res = await POST(postReq(formWith(fileOf(imageBytes(PNG_HEAD), 'photo.svg', 'image/svg+xml'))));

    expect(res.status).toBe(200);
    expect(uploadedPath()).toMatch(/\.png$/);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/png' });
  });

  it('P-3b: a real JPEG named photo.png and declared image/png is stored as .jpg, image/jpeg (M-3)', async () => {
    const res = await POST(postReq(formWith(fileOf(imageBytes(JPEG_HEAD), 'photo.png', 'image/png'))));

    expect(res.status).toBe(200);
    expect(uploadedPath()).toMatch(/\.jpg$/);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('P-7: exactly 4 MB is accepted (boundary)', async () => {
    const res = await POST(postReq(pngForm('a.png', AVATAR_MAX_BYTES)));
    expect(res.status).toBe(200);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('P-19: an account with no profiles row: uploads, saves (the repository upserts), removes nothing', async () => {
    findAvatarUrl.mockResolvedValue({ data: null, error: null });
    const res = await POST(postReq(pngForm()));

    expect(res.status).toBe(200);
    expect(setAvatarUrl).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('POST: refusals', () => {
  it('P-4: 401 signed out, before the body is read; nothing called', async () => {
    getUser.mockResolvedValue(null);
    const req = postReq(pngForm());
    const formData = jest.spyOn(req, 'formData');
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized', code: 'unauthorized' });
    expect(formData).not.toHaveBeenCalled();
    nothingCalled();
  });

  it('P-4b (E-3, Q-30): signed out WITH a query string is 401, not 400: auth runs before the query check', async () => {
    getUser.mockResolvedValue(null);
    const res = await POST(postReq(pngForm(), { query: `?userId=${OTHER}` }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized', code: 'unauthorized' });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls.some((c) => c[1] === 'Avatar request refused')).toBe(false);
    nothingCalled();
  });

  it('P-5: an SVG is refused with file_type', async () => {
    const res = await POST(postReq(formWith(fileOf(SVG_TEXT, `${NAME_MARKER}.svg`, 'image/svg+xml'))));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Please choose a PNG, JPEG, WebP or GIF image',
      code: 'file_type',
    });
    nothingCalled();
  });

  it.each([
    ['SVG bytes declared image/png', SVG_TEXT, `${NAME_MARKER}.png`, 'image/png'],
    ['HTML bytes declared image/jpeg', '<!doctype html><script>alert(1)</script>', `${NAME_MARKER}.jpg`, 'image/jpeg'],
    ['text declared image/gif', 'just some text, not a picture', `${NAME_MARKER}.gif`, 'image/gif'],
    ['RIFF without WEBP declared image/webp', 'RIFF\x24\x00\x00\x00WAVEfmt ', `${NAME_MARKER}.webp`, 'image/webp'],
  ])('P-6: spoofed MIME, %s -> 400 file_type (M-2)', async (_name, content, name, type) => {
    const res = await POST(postReq(formWith(fileOf(content, name, type))));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('file_type');
    nothingCalled();
  });

  it('P-7: one byte over 4 MB is a 413, nothing uploaded (M-5)', async () => {
    const res = await POST(postReq(pngForm('a.png', AVATAR_MAX_BYTES + 1)));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ success: false, error: 'Image must be 4 MB or smaller', code: 'file_too_large' });
    nothingCalled();
  });

  it('P-8: a Content-Length over the cap is a 413 before the body is parsed (M-6)', async () => {
    const req = postReq(pngForm(), { headers: { 'content-length': String(AVATAR_MAX_BYTES + 64 * 1024 + 1) } });
    const formData = jest.spyOn(req, 'formData');
    const res = await POST(req);

    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('file_too_large');
    expect(formData).not.toHaveBeenCalled();
    nothingCalled();
  });

  it('SA-D3-6: an unparsable Content-Length is skipped; a small valid file is a 200', async () => {
    const req = postReq(pngForm());
    req.headers.set('content-length', 'not-a-number');
    expect(req.headers.get('content-length')).toBe('not-a-number');
    const res = await POST(req);

    expect(res.status).toBe(200);
  });

  it('SA-D3-6: a header claiming 100 bytes with a 4 MB + 1 body is a 413 from the file-size check', async () => {
    const req = postReq(pngForm('a.png', AVATAR_MAX_BYTES + 1));
    req.headers.set('content-length', '100');
    expect(req.headers.get('content-length')).toBe('100');
    const formData = jest.spyOn(req, 'formData');
    const res = await POST(req);

    expect(res.status).toBe(413);
    expect(formData).toHaveBeenCalled();
    nothingCalled();
  });

  function form(entries: Array<[string, string | File]>): FormData {
    const f = new FormData();
    for (const [key, value] of entries) f.append(key, value);
    return f;
  }
  const png = () => fileOf(imageBytes(PNG_HEAD), `${NAME_MARKER}.png`, 'image/png');

  it.each([
    ['no file field', () => form([['image', png()]])],
    ['no fields at all', () => form([])],
    ['file as a string', () => form([['file', FIELD_MARKER]])],
    ['two files', () => form([['file', png()], ['file', png()]])],
    ['an empty file', () => form([['file', fileOf(new Uint8Array(0), 'a.png', 'image/png')]])],
    ['extra field userId (M-22)', () => form([['file', png()], ['userId', OTHER + FIELD_MARKER]])],
    ['extra field path (M-7)', () => form([['file', png()], ['path', `${OTHER}/${FIELD_MARKER}.png`]])],
    ['extra field bucket', () => form([['bucket', FIELD_MARKER], ['file', png()]])],
  ])('P-9: %s -> 400 invalid_request, nothing called', async (_name, build) => {
    const res = await POST(postReq(build()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid upload', code: 'invalid_request' });
    nothingCalled();
  });

  it('P-9: a JSON body -> 400 invalid_request', async () => {
    const req = new NextRequest(ROUTE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'x', userId: OTHER }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
    nothingCalled();
  });

  it('P-9: a multipart content type with a broken body -> 400 invalid_request', async () => {
    const req = new NextRequest(ROUTE_URL, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=zzz' },
      body: 'this is not multipart',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
    nothingCalled();
  });

  it.each(['?userId=' + OTHER, '?x=1', '?'])('P-9: query string %s -> 400 (Q-10), nothing called', async (query) => {
    const res = await POST(postReq(pngForm(), { query }));
    // A bare "?" is no query string at all.
    if (query === '?') {
      expect(res.status).toBe(200);
      return;
    }
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
    nothingCalled();
  });
});

describe('POST: the old file (C-19 order, C-20 ownership)', () => {
  it('P-10: replacing an own folder file removes it AFTER the new URL is saved (M-10)', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}/${OLD_UUID}.png`, error: null });
    const res = await POST(postReq(pngForm()));

    expect(res.status).toBe(200);
    expect(removedPaths()).toEqual([`${SESSION}/${OLD_UUID}.png`]);
    expect(setAvatarUrl.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    expect(upload.mock.invocationCallOrder[0]).toBeLessThan(setAvatarUrl.mock.invocationCallOrder[0]);
  });

  it('P-10: an encoded stored URL is decoded to the object it names (M-16)', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}%2F${OLD_UUID.replace(/a/g, '%61')}.png`, error: null });
    await POST(postReq(pngForm()));

    expect(removedPaths()).toEqual([`${SESSION}/${OLD_UUID}.png`]);
  });

  it('P-11: replacing an own legacy root file removes it at the root', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}-1700000000000.jpg`, error: null });
    await POST(postReq(pngForm()));

    expect(removedPaths()).toEqual([`${SESSION}-1700000000000.jpg`]);
  });

  it.each([
    ['folder', `${PREFIX}${OTHER}/${OLD_UUID}.png?MARKER-URL`],
    ['legacy', `${PREFIX}${OTHER}-1700000000000.jpg#MARKER-URL`],
  ])("P-12: another account's %s file is never removed; logged other_account without the URL", async (_k, stored) => {
    findAvatarUrl.mockResolvedValue({ data: stored, error: null });
    const res = await POST(postReq(pngForm()));

    expect(res.status).toBe(200);
    expect(remove).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith({ userId: SESSION, reason: 'other_account' }, 'Previous avatar not deleted');
    expect(allLogged()).not.toContain('MARKER-URL');
    expect(allLogged()).not.toContain(OTHER);
  });

  it('P-13: a Google photo is never removed; logged external', async () => {
    findAvatarUrl.mockResolvedValue({ data: 'https://lh3.googleusercontent.com/a/MARKER-URL=s96-c', error: null });
    const res = await POST(postReq(pngForm()));

    expect(res.status).toBe(200);
    expect(remove).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith({ userId: SESSION, reason: 'external' }, 'Previous avatar not deleted');
    expect(allLogged()).not.toContain('MARKER-URL');
  });

  it.each([
    ['encoded traversal', `${PREFIX}${SESSION}/%2E%2E%2F${OTHER}%2F${OLD_UUID}.png`],
    ['literal ../ from a legacy name', `${PREFIX}${SESSION}-1/../${OTHER}-2.png`],
    ['literal ../ from the folder', `${PREFIX}${SESSION}/../${OTHER}/${OLD_UUID}.png`],
    ['other origin, same path (M-13)', `https://evil.example.com/storage/v1/object/public/avatars/${SESSION}/${OLD_UUID}.png`],
    ['signed URL', `${BASE}/storage/v1/object/sign/avatars/${SESSION}/${OLD_UUID}.png?token=t`],
    ['transform URL', `${BASE}/storage/v1/render/image/public/avatars/${SESSION}/${OLD_UUID}.png`],
    ['look-alike bucket', `${BASE}/storage/v1/object/public/avatars-old/${SESSION}/${OLD_UUID}.png`],
    ['http instead of https', `http://proj.supabase.co/storage/v1/object/public/avatars/${SESSION}/${OLD_UUID}.png`],
    ['odd file in own folder (M-15)', `${PREFIX}${SESSION}/notes.png`],
  ])('P-14: %s -> never removed', async (_name, stored) => {
    findAvatarUrl.mockResolvedValue({ data: stored, error: null });
    const res = await POST(postReq(pngForm()));

    expect(res.status).toBe(200);
    expect(remove).not.toHaveBeenCalled();
  });

  it('P-15: a failed URL save removes the NEW file, not the old one; 500 save_failed; no audit (M-11)', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}/${OLD_UUID}.png`, error: null });
    setAvatarUrl.mockResolvedValue({ data: null, error: Object.assign(new Error(DB_MARKER), { code: '23514' }) });
    const res = await POST(postReq(pngForm()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Could not save the picture', code: 'save_failed' });
    expect(removedPaths()).toEqual([uploadedPath()]);
    expect(removedPaths()).not.toContain(`${SESSION}/${OLD_UUID}.png`);
    expect(auditLog).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(DB_MARKER);
  });

  it('P-16: a failed upload is 500 upload_failed; nothing saved or removed; storage message not returned', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}/${OLD_UUID}.png`, error: null });
    upload.mockResolvedValue({ data: null, error: Object.assign(new Error(STORAGE_MARKER), { statusCode: '500' }) });
    const res = await POST(postReq(pngForm()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Could not store the picture', code: 'upload_failed' });
    expect(setAvatarUrl).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(STORAGE_MARKER);
  });

  it.each([
    ['returns an error', () => remove.mockResolvedValue({ data: null, error: new Error('denied') })],
    ['throws', () => remove.mockRejectedValue(new Error('network'))],
  ])('P-17: an old-file remove that %s is a 200 with a warn log (M-12)', async (_name, arrange) => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}/${OLD_UUID}.png`, error: null });
    arrange();
    const res = await POST(postReq(pngForm()));

    expect(res.status).toBe(200);
    expect(log.warn).toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it('P-18: a failed URL read is 500 save_failed, before any upload', async () => {
    findAvatarUrl.mockResolvedValue({ data: null, error: Object.assign(new Error(DB_MARKER), { code: '500' }) });
    const res = await POST(postReq(pngForm()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('save_failed');
    expect(upload).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(DB_MARKER);
  });
});

describe('DELETE /api/user/avatar', () => {
  it('D-1: clears, THEN removes the own folder file; audited as removed (M-18)', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}/${OLD_UUID}.png`, error: null });
    const res = await DELETE(deleteReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { avatar_url: null } });
    expect(clearAvatarUrl).toHaveBeenCalledWith(SESSION);
    expect(removedPaths()).toEqual([`${SESSION}/${OLD_UUID}.png`]);
    expect(clearAvatarUrl.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      action: AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED,
      entityType: 'user',
      entityId: SESSION,
      userId: SESSION,
      details: { fields: ['avatar_url'], change: 'removed' },
    });
  });

  it('D-2: the F-8 regression: an own legacy root file is removed at the ROOT, never avatars/<file> (M-17)', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}-1700000000000.jpg`, error: null });
    await DELETE(deleteReq());

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([`${SESSION}-1700000000000.jpg`]);
    expect(removedPaths().some((p) => p.startsWith('avatars/'))).toBe(false);
  });

  it.each([
    ['another account folder file', `${PREFIX}${OTHER}/${OLD_UUID}.png`],
    ['another account legacy file', `${PREFIX}${OTHER}-1700000000000.jpg`],
    ['a Google photo', 'https://lh3.googleusercontent.com/a/photo=s96-c'],
  ])('D-3: %s is cleared but never removed', async (_name, stored) => {
    findAvatarUrl.mockResolvedValue({ data: stored, error: null });
    const res = await DELETE(deleteReq());

    expect(res.status).toBe(200);
    expect(clearAvatarUrl).toHaveBeenCalledWith(SESSION);
    expect(remove).not.toHaveBeenCalled();
  });

  it('D-4: nothing stored, or no profiles row: 200, nothing cleared or removed', async () => {
    findAvatarUrl.mockResolvedValue({ data: null, error: null });
    const res = await DELETE(deleteReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { avatar_url: null } });
    expect(clearAvatarUrl).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('D-5: a failed clear is 500 save_failed; nothing removed; no audit', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}/${OLD_UUID}.png`, error: null });
    clearAvatarUrl.mockResolvedValue({ data: null, error: Object.assign(new Error(DB_MARKER), { code: '500' }) });
    const res = await DELETE(deleteReq());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Could not save the picture', code: 'save_failed' });
    expect(remove).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(DB_MARKER);
  });

  it('D-5b: a failed read is 500 save_failed; nothing cleared or removed', async () => {
    findAvatarUrl.mockResolvedValue({ data: null, error: new Error(DB_MARKER) });
    const res = await DELETE(deleteReq());

    expect(res.status).toBe(500);
    expect(clearAvatarUrl).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('D-5c: a failed file remove after the clear is still a 200, logged at warn', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}/${OLD_UUID}.png`, error: null });
    remove.mockRejectedValue(new Error('network'));
    const res = await DELETE(deleteReq());

    expect(res.status).toBe(200);
    expect(log.warn).toHaveBeenCalled();
  });

  it('D-6: signed out is 401; nothing called', async () => {
    getUser.mockResolvedValue(null);
    const res = await DELETE(deleteReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized', code: 'unauthorized' });
    nothingCalled();
  });

  it('D-7: ?userId=other is 400; nothing called', async () => {
    const res = await DELETE(deleteReq(`?userId=${OTHER}`));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
    nothingCalled();
  });

  it('D-6b (E-3, Q-30): signed out WITH a query string is 401, not 400: auth runs before the query check', async () => {
    getUser.mockResolvedValue(null);
    const res = await DELETE(deleteReq(`?userId=${OTHER}`));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized', code: 'unauthorized' });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls.some((c) => c[1] === 'Avatar request refused')).toBe(false);
    nothingCalled();
  });

  it('D-8 (E-1, Q-19, C-23): the body is never read, even when one naming another account is sent', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}/${OLD_UUID}.png`, error: null });
    const req = new NextRequest(ROUTE_URL, {
      method: 'DELETE',
      body: JSON.stringify({ userId: OTHER, path: `${OTHER}/${OLD_UUID}.png` }),
      headers: { 'content-type': 'application/json' },
    });
    const readers = (['json', 'text', 'formData', 'arrayBuffer', 'blob'] as const).map((m) => jest.spyOn(req, m));
    const res = await DELETE(req);

    expect(res.status).toBe(200);
    for (const reader of readers) expect(reader).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
    expect(findAvatarUrl).toHaveBeenCalledWith(SESSION);
    expect(clearAvatarUrl).toHaveBeenCalledWith(SESSION);
    expect(removedPaths()).toEqual([`${SESSION}/${OLD_UUID}.png`]);
  });

  it('D-9 (E-2, Q-21): the removal audit carries exactly { fields, change } and no stored URL or path', async () => {
    const stored = `${PREFIX}${SESSION}/${OLD_UUID}.png`;
    findAvatarUrl.mockResolvedValue({ data: stored, error: null });
    const req = deleteReq();
    await DELETE(req);

    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0]).toHaveLength(1);
    // `request` is the route's own NextRequest (for IP / user agent); everything else is pinned exactly.
    const { request: auditedRequest, ...entry } = auditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(auditedRequest).toBe(req);
    expect(entry).toEqual({
      action: AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED,
      entityType: 'user',
      entityId: SESSION,
      userId: SESSION,
      details: { fields: ['avatar_url'], change: 'removed' },
    });
    const audited = JSON.stringify(entry);
    expect(audited).not.toContain(stored);
    expect(audited).not.toContain(OLD_UUID);
    expect(audited).not.toContain('/storage/v1/');
  });
});

describe('G-1 / SA-D3-9: nothing personal in a log or a response', () => {
  it('refusals (P-5, P-6, P-9) log { userId, code } only: no file name, claimed type or field value', async () => {
    const svg = fileOf(SVG_TEXT, `${NAME_MARKER}.svg`, 'image/svg+xml');
    const spoof = fileOf(SVG_TEXT, `${NAME_MARKER}.png`, 'image/png');
    const extra = new FormData();
    extra.append('file', fileOf(imageBytes(PNG_HEAD), `${NAME_MARKER}.png`, 'image/png'));
    extra.append('userId', FIELD_MARKER);
    const responses = [
      await POST(postReq(formWith(svg))),
      await POST(postReq(formWith(spoof))),
      await POST(postReq(extra)),
      await POST(postReq(pngForm(`${NAME_MARKER}.png`, AVATAR_MAX_BYTES + 1))),
    ];

    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 413]);
    const refusals = log.info.mock.calls.filter((c) => c[1] === 'Avatar request refused');
    expect(refusals.map((c) => c[0])).toEqual([
      { userId: SESSION, code: 'file_type' },
      { userId: SESSION, code: 'file_type' },
      { userId: SESSION, code: 'invalid_request' },
      { userId: SESSION, code: 'file_too_large' },
    ]);
    const logged = allLogged();
    expect(logged).not.toContain(NAME_MARKER);
    expect(logged).not.toContain(FIELD_MARKER);
    expect(logged).not.toContain('svg');
    for (const r of responses) {
      const text = JSON.stringify(await r.json());
      expect(text).not.toContain(NAME_MARKER);
      expect(text).not.toContain(FIELD_MARKER);
    }
  });

  it('success and failure paths log no URL, object path or file name', async () => {
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}/${OLD_UUID}.png`, error: null });
    await POST(postReq(pngForm()));
    const newPath = uploadedPath();

    remove.mockResolvedValue({ data: null, error: new Error('denied') });
    findAvatarUrl.mockResolvedValue({ data: `${PREFIX}${SESSION}-1700000000000.jpg`, error: null });
    await POST(postReq(pngForm()));
    await DELETE(deleteReq());

    upload.mockResolvedValue({ data: null, error: new Error('quota') });
    await POST(postReq(pngForm()));

    const logged = allLogged();
    expect(logged).not.toContain(NAME_MARKER);
    expect(logged).not.toContain(OLD_UUID);
    expect(logged).not.toContain(newPath);
    expect(logged).not.toContain('1700000000000');
    expect(logged).not.toContain('/storage/v1/');
    expect(log.info).toHaveBeenCalledWith(
      { userId: SESSION, change: 'uploaded', contentType: 'image/png', bytes: 64 },
      'Avatar uploaded'
    );
  });

  it('G-2: the catch-all 500 has details only in development', async () => {
    getUser.mockRejectedValue(new Error('auth exploded'));
    setEnv('production');
    const prod = await (await POST(postReq(pngForm()))).json();
    expect(prod).toEqual({ success: false, error: 'Internal server error', code: 'internal' });

    setEnv('development');
    const dev = await (await DELETE(deleteReq())).json();
    expect(dev).toMatchObject({ success: false, code: 'internal', details: 'auth exploded' });
  });
});
