/**
 * F-27: `POST /api/website/upload` decides the bucket, the path and the type
 * itself, and tells the client nothing from storage.
 *
 * Workplan: docs/workplans/WEBSITE_UPLOAD_BUCKET_SCOPE_F27_WORKPLAN.md
 * (Tests T-1..T-21, SA-F27-1, SA-F27-3, SA-F27-4).
 *
 * SA-F27-1: probe bucket names appear only as inline test arguments, so the
 * D-3 bucket-name guard never sees a constant or a `.from()` call naming one.
 */

import { NextRequest } from 'next/server';

const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const PUBLIC_BASE = 'https://storage.example/public/';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
};
mockLogger.child.mockImplementation(() => mockLogger);
jest.mock('@/lib/logger', () => ({ createLogger: () => mockLogger }));

const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { storage: { from: (bucket: string) => mockFrom(bucket) } },
}));

const mockRecord = jest.fn();
jest.mock('@/lib/repositories/UserMediaRepository', () => ({
  userMediaRepository: { record: (input: unknown) => mockRecord(input) },
}));

import * as routeModule from '@/app/api/website/upload/route';
import { POST } from '@/app/api/website/upload/route';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

function imageFile(head: number[], size: number, name: string, type: string): File {
  const bytes = new Uint8Array(size);
  bytes.set(head.slice(0, size));
  return new File([bytes], name, { type });
}

const png = (name = 'holiday photo.png', size = 64) => imageFile(PNG_HEAD, size, name, 'image/png');

function formWith(fields: Array<[string, string | Blob]>): FormData {
  const form = new FormData();
  for (const [key, value] of fields) form.append(key, value);
  return form;
}

function postForm(form: FormData, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/website/upload', { method: 'POST', body: form, headers });
}

async function body(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function uploadedPath(): string {
  expect(mockUpload).toHaveBeenCalledTimes(1);
  return mockUpload.mock.calls[0][0] as string;
}

function expectNothingWritten() {
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockRecord).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLogger.child.mockImplementation(() => mockLogger);
  mockGetUser.mockResolvedValue({ id: SESSION });
  mockUpload.mockImplementation(async (path: string) => ({ data: { path }, error: null }));
  mockGetPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `${PUBLIC_BASE}${path}` } }));
  mockFrom.mockImplementation(() => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }));
  mockRecord.mockResolvedValue({ id: 'media-1' });
});

describe('POST /api/website/upload', () => {
  it('T-1 stores a PNG in the one bucket, under the session folder, never replacing', async () => {
    const res = await POST(postForm(formWith([['file', png()]])));
    expect(res.status).toBe(200);
    const json = await body(res);

    const path = uploadedPath();
    expect(path).toMatch(new RegExp(`^${SESSION}/${UUID_RE}\\.png$`));
    expect(json).toEqual({ success: true, url: `${PUBLIC_BASE}${path}`, path, bucket: 'website-images' });

    expect(mockFrom.mock.calls.length).toBeGreaterThan(0);
    for (const [bucket] of mockFrom.mock.calls) expect(bucket).toBe('website-images');

    const options = mockUpload.mock.calls[0][2];
    expect(options).toEqual({ contentType: 'image/png', cacheControl: '3600', upsert: false });

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SESSION, source: 'upload', storagePath: path, section: null, aspect: null })
    );
  });

  it('T-2 refuses without a session, before the body is parsed', async () => {
    mockGetUser.mockResolvedValue(null);
    const request = postForm(formWith([['file', png()]]));
    // QA TG-2 (Q-17): an anonymous caller must not make the server buffer the
    // body, so the session check has to run before any parse.
    const formDataSpy = jest.spyOn(request, 'formData');
    const cloneSpy = jest.spyOn(request, 'clone');
    const res = await POST(request);
    expect(res.status).toBe(401);
    expect(await body(res)).toEqual({ success: false, error: 'Unauthorized', code: 'unauthorized' });
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(cloneSpy).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it.each(['contact-documents', 'avatars', 'business-purge-snapshots', 'website-images ', ''])(
    'T-3 refuses bucket %p and writes nothing',
    async b => {
      const res = await POST(postForm(formWith([['file', png()], ['bucket', b]])));
      expect(res.status).toBe(400);
      expect(await body(res)).toEqual({ success: false, error: 'Invalid upload', code: 'invalid_request' });
      expectNothingWritten();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: SESSION, reason: 'bucket_not_allowed' }),
        expect.any(String)
      );
    }
  );

  it('T-4 accepts the stale bundle that still sends bucket=website-images', async () => {
    const res = await POST(postForm(formWith([['file', png()], ['bucket', 'website-images']])));
    expect(res.status).toBe(200);
    expect(uploadedPath()).toMatch(new RegExp(`^${SESSION}/${UUID_RE}\\.png$`));
    for (const [bucket] of mockFrom.mock.calls) expect(bucket).toBe('website-images');
  });

  it.each([OTHER, `${OTHER}/x`])('T-5 folder %p never reaches the path', async folder => {
    const res = await POST(postForm(formWith([['file', png()], ['folder', folder]])));
    expect(res.status).toBe(200);
    const path = uploadedPath();
    expect(path).toMatch(new RegExp(`^${SESSION}/${UUID_RE}\\.png$`));
    expect(path).not.toContain(OTHER);
    expect(path).not.toContain('/x');
  });

  // QA TG-1 (Q-2): a folder that starts with the session id and then climbs
  // out must not be trusted as "already under my own folder".
  it.each([`../${OTHER}`, `${SESSION}/../${OTHER}`, `${SESSION}/../${OTHER}/logos`])(
    'T-6 traversal folder %p stays under the session folder',
    async folder => {
      const res = await POST(postForm(formWith([['file', png()], ['folder', folder]])));
      expect(res.status).toBe(200);
      const path = uploadedPath();
      expect(path.startsWith(`${SESSION}/`)).toBe(true);
      expect(path).not.toContain('..');
      expect(path).not.toContain(OTHER);
    }
  );

  it.each(['logos', `${SESSION}/logos`, 'shared/logos'])('T-7 folder %p selects the owner logos folder', async folder => {
    const res = await POST(postForm(formWith([['file', png()], ['folder', folder]])));
    expect(res.status).toBe(200);
    expect(uploadedPath()).toMatch(new RegExp(`^${SESSION}/logos/${UUID_RE}\\.png$`));
  });

  it('T-8 refuses an SVG declared as SVG', async () => {
    const svg = new File([SVG_TEXT], 'logo.svg', { type: 'image/svg+xml' });
    const res = await POST(postForm(formWith([['file', svg]])));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({
      success: false,
      error: 'Please choose a PNG, JPEG, WebP or GIF image',
      code: 'file_type',
    });
    expectNothingWritten();
  });

  it.each([
    ['SVG', SVG_TEXT],
    ['HTML', '<!DOCTYPE html><html><script>alert(1)</script></html>'],
  ])('T-9 refuses %s bytes declared as image/png', async (_label, text) => {
    const fake = new File([text], 'x.png', { type: 'image/png' });
    const res = await POST(postForm(formWith([['file', fake]])));
    expect(res.status).toBe(400);
    expect((await body(res)).code).toBe('file_type');
    expectNothingWritten();
  });

  it('T-10 a real JPEG mislabelled as PNG with an .html name is stored as a JPEG', async () => {
    const jpeg = imageFile(JPEG_HEAD, 64, 'x.png.html', 'image/png');
    const res = await POST(postForm(formWith([['file', jpeg]])));
    expect(res.status).toBe(200);
    const path = uploadedPath();
    expect(path).toMatch(new RegExp(`^${SESSION}/${UUID_RE}\\.jpg$`));
    expect(mockUpload.mock.calls[0][2].contentType).toBe('image/jpeg');
  });

  it('T-11 exactly 4 MB is accepted', async () => {
    const res = await POST(postForm(formWith([['file', png('big.png', 4 * 1024 * 1024)]])));
    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('T-12 one byte over 4 MB is refused', async () => {
    const res = await POST(postForm(formWith([['file', png('big.png', 4 * 1024 * 1024 + 1)]])));
    expect(res.status).toBe(413);
    expect(await body(res)).toEqual({ success: false, error: 'Image must be 4 MB or smaller', code: 'file_too_large' });
    expectNothingWritten();
  });

  it('T-13 an oversize Content-Length is refused before the body is parsed', async () => {
    const request = new NextRequest('http://localhost/api/website/upload', {
      method: 'POST',
      body: 'x',
      headers: {
        'content-type': 'multipart/form-data; boundary=zzz',
        'content-length': String(4 * 1024 * 1024 + 64 * 1024 + 1),
      },
    });
    // Proves the header the route reads is really there (SA-F27-4).
    expect(request.headers.get('content-length')).toBe(String(4 * 1024 * 1024 + 64 * 1024 + 1));
    const formDataSpy = jest.spyOn(request, 'formData');

    const res = await POST(request);
    expect(res.status).toBe(413);
    expect((await body(res)).code).toBe('file_too_large');
    expect(formDataSpy).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it('T-13 a Content-Length at the limit plus allowance still parses', async () => {
    const request = new NextRequest('http://localhost/api/website/upload', {
      method: 'POST',
      body: 'x',
      headers: {
        'content-type': 'multipart/form-data; boundary=zzz',
        'content-length': String(4 * 1024 * 1024 + 64 * 1024),
      },
    });
    const formDataSpy = jest.spyOn(request, 'formData').mockRejectedValue(new Error('stub'));
    const res = await POST(request);
    expect(formDataSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(400);
  });

  it('T-13b with no Content-Length (chunked) the request proceeds to parsing', async () => {
    const request = postForm(formWith([['file', png()]]));
    expect(request.headers.has('content-length')).toBe(false);
    const formDataSpy = jest.spyOn(request, 'formData');
    const res = await POST(request);
    expect(formDataSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('T-14 a storage error is logged, never returned', async () => {
    const storageMessage = 'new row violates row-level security policy for bucket contact-documents';
    mockUpload.mockResolvedValue({ data: null, error: { message: storageMessage } });
    const res = await POST(postForm(formWith([['file', png()]])));
    expect(res.status).toBe(500);
    const json = await body(res);
    expect(json).toEqual({ success: false, error: 'Could not store the picture', code: 'upload_failed' });
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/row-level/);
    expect(text).not.toMatch(/bucket/);
    expect(text).not.toMatch(/contact-documents/);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('T-15 an unreadable form is a fixed 400', async () => {
    const request = postForm(formWith([['file', png()]]));
    jest.spyOn(request, 'formData').mockRejectedValue(new Error('Unexpected end of multipart data at byte 17'));
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ success: false, error: 'Invalid upload', code: 'invalid_request' });
    expectNothingWritten();
  });

  it('T-15 a non-multipart body is a fixed 400', async () => {
    const request = new NextRequest('http://localhost/api/website/upload', {
      method: 'POST',
      body: JSON.stringify({ file: 'x' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ success: false, error: 'Invalid upload', code: 'invalid_request' });
    expectNothingWritten();
  });

  it.each<[string, Array<[string, string | Blob]>]>([
    ['an unknown userId field', [['file', png()], ['userId', OTHER]]],
    ['an unknown path field', [['file', png()], ['path', `${OTHER}/x.png`]]],
    ['two files', [['file', png()], ['file', png('second.png')]]],
    ['a string file', [['file', 'not a file']]],
    ['an empty file', [['file', new File([], 'empty.png', { type: 'image/png' })]]],
    ['no file', [['folder', 'logos']]],
    ['a repeated folder', [['file', png()], ['folder', 'logos'], ['folder', 'logos']]],
    ['an oversize folder', [['file', png()], ['folder', 'f'.repeat(201)]]],
  ])('T-16 refuses %s', async (_label, fields) => {
    const res = await POST(postForm(formWith(fields)));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ success: false, error: 'Invalid upload', code: 'invalid_request' });
    expectNothingWritten();
  });

  it.each<[string, Array<[string, string | Blob]>]>([
    ['aspect=huge', [['file', png()], ['aspect', 'huge']]],
    ['a 41-character section', [['file', png()], ['section', 's'.repeat(41)]]],
  ])('T-17 refuses %s', async (_label, fields) => {
    const res = await POST(postForm(formWith(fields)));
    expect(res.status).toBe(400);
    expect((await body(res)).code).toBe('invalid_request');
    expectNothingWritten();
  });

  it('T-17 records a valid section and aspect', async () => {
    const res = await POST(postForm(formWith([['file', png()], ['section', ' hero '], ['aspect', 'wide']])));
    expect(res.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ section: 'hero', aspect: 'wide' }));
  });

  it('SA-F27-3 empty folder, section and aspect are absent, not refused', async () => {
    const res = await POST(
      postForm(formWith([['file', png()], ['folder', ''], ['section', ''], ['aspect', '']]))
    );
    expect(res.status).toBe(200);
    expect(uploadedPath()).toMatch(new RegExp(`^${SESSION}/${UUID_RE}\\.png$`));
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ section: null, aspect: null }));
  });

  it('DC-12 the stored description is the file name cut to 120 characters', async () => {
    const longName = `${'n'.repeat(200)}.png`;
    await POST(postForm(formWith([['file', png(longName)]])));
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ description: 'n'.repeat(120) }));
  });

  it('T-18 a library row that fails to record does not fail the upload', async () => {
    mockRecord.mockResolvedValue(null);
    const res = await POST(postForm(formWith([['file', png()]])));
    expect(res.status).toBe(200);
    expect((await body(res)).success).toBe(true);
  });

  it('T-19 the catch-all hides details outside development', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      mockGetPublicUrl.mockImplementation(() => {
        throw new Error('internal storage detail /secret/path');
      });
      const res = await POST(postForm(formWith([['file', png()]])));
      expect(res.status).toBe(500);
      const json = await body(res);
      expect(json).toEqual({ success: false, error: 'Internal server error', code: 'internal' });
      expect(JSON.stringify(json)).not.toMatch(/secret/);
    } finally {
      env.NODE_ENV = previous;
    }
  });

  it('T-20 logs never carry the file name, URL, caller bucket/folder, description or section', async () => {
    const name = 'zz-private-name-7731.png';
    const callerFolder = `zz-folder-${OTHER}/logos`;
    await POST(postForm(formWith([['file', png(name)], ['folder', callerFolder], ['section', 'zz-section-text']])));
    await POST(postForm(formWith([['file', png(name)], ['bucket', 'zz-probe-bucket-9']])));
    mockUpload.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await POST(postForm(formWith([['file', png(name)]])));

    const calls = [
      ...mockLogger.info.mock.calls,
      ...mockLogger.warn.mock.calls,
      ...mockLogger.error.mock.calls,
      ...mockLogger.child.mock.calls,
    ];
    expect(calls.length).toBeGreaterThan(0);
    const logged = calls.map(args => JSON.stringify(args)).join('\n');
    expect(logged).not.toContain('zz-private-name');
    expect(logged).not.toContain(PUBLIC_BASE);
    expect(logged).not.toContain('zz-folder');
    expect(logged).not.toContain(OTHER);
    expect(logged).not.toContain('zz-probe-bucket');
    expect(logged).not.toContain('zz-section-text');
  });

  it('T-21 there is no DELETE handler', () => {
    expect(Object.keys(routeModule)).not.toContain('DELETE');
    expect(Object.keys(routeModule).filter(k => /^[A-Z]+$/.test(k))).toEqual(['POST']);
  });
});
