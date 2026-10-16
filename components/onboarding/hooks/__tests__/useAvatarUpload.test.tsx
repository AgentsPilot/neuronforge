/**
 * @jest-environment jsdom
 *
 * useAvatarUpload (settings drawer D-3, C-21): same public shape, now through
 * `POST` / `DELETE /api/user/avatar`. The pre-check spares a request for a
 * file the server would refuse; the server's own text is never shown (the hook
 * owns its sentences, chosen by the route's `code`); no file name or URL is
 * ever logged (L-1).
 */

import { renderHook, act } from '@testing-library/react';

const useAuth = jest.fn();
jest.mock('@/components/UserProvider', () => ({ useAuth: () => useAuth() }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) {
    logger[level] = (...args: unknown[]) => logged.push({ level, args });
  }
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { useAvatarUpload } from '../useAvatarUpload';
import { AVATAR_MAX_BYTES } from '@/lib/validation/avatar';

const NAME_MARKER = 'MARKER-FILENAME';
const SERVER_MARKER = 'MARKER-SERVER-TEXT';
const URL = 'https://proj.supabase.co/storage/v1/object/public/avatars/u/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png';

const fetchMock = jest.fn();

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function textResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token R in JSON');
    },
  };
}

function fileOf(size: number, type: string, name = `${NAME_MARKER}.png`): File {
  // Sized without allocating: only `size`, `type` and `name` are read before the request.
  const file = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  logged.length = 0;
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  useAuth.mockReturnValue({ user: { id: 'u' } });
});

describe('uploadAvatar', () => {
  it('H-1: posts the file alone to the route and returns the URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { avatar_url: URL } }));
    const { result } = renderHook(() => useAvatarUpload());
    const file = fileOf(100, 'image/png');

    let returned: string | null = null;
    await act(async () => {
      returned = await result.current.uploadAvatar(file);
    });

    expect(returned).toBe(URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: FormData }];
    expect(url).toBe('/api/user/avatar');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect([...init.body.keys()]).toEqual(['file']);
    expect(init.body.get('file')).toBeInstanceOf(File);
    expect(result.current).toMatchObject({ uploading: false, progress: 100, error: null });
  });

  it.each([
    ['image/svg+xml'],
    ['image/heic'],
    ['text/plain'],
    [''],
  ])('H-2: %s is refused with the type sentence and no request', async (type) => {
    const { result } = renderHook(() => useAvatarUpload());
    let returned: string | null = 'x';
    await act(async () => {
      returned = await result.current.uploadAvatar(fileOf(100, type));
    });

    expect(returned).toBeNull();
    expect(result.current.error).toBe('Please choose a PNG, JPEG, WebP or GIF image');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('H-3: 4 MB + 1 byte is refused with no request; exactly 4 MB is sent', async () => {
    const { result } = renderHook(() => useAvatarUpload());
    await act(async () => {
      await result.current.uploadAvatar(fileOf(AVATAR_MAX_BYTES + 1, 'image/jpeg'));
    });
    expect(result.current.error).toBe('Image must be 4 MB or smaller');
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { avatar_url: URL } }));
    await act(async () => {
      await result.current.uploadAvatar(fileOf(AVATAR_MAX_BYTES, 'image/jpeg'));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['400 file_type', () => jsonResponse(400, { success: false, code: 'file_type', error: SERVER_MARKER }), 'Please choose a PNG, JPEG, WebP or GIF image'],
    ['413 JSON', () => jsonResponse(413, { success: false, code: 'file_too_large', error: SERVER_MARKER }), 'Image must be 4 MB or smaller'],
    ['413 not JSON (Vercel)', () => textResponse(413), 'Image must be 4 MB or smaller'],
    ['401', () => jsonResponse(401, { success: false, code: 'unauthorized', error: SERVER_MARKER }), 'Please sign in again'],
    ['400 invalid_request', () => jsonResponse(400, { success: false, code: 'invalid_request', error: SERVER_MARKER }), 'Failed to upload the picture'],
    ['500 save_failed', () => jsonResponse(500, { success: false, code: 'save_failed', error: SERVER_MARKER }), 'Failed to upload the picture'],
    ['200 without a URL', () => jsonResponse(200, { success: true, error: SERVER_MARKER }), 'Failed to upload the picture'],
  ])('H-4: %s -> the hook sentence; the server text never appears (M-25)', async (_name, response, message) => {
    fetchMock.mockResolvedValue(response());
    const { result } = renderHook(() => useAvatarUpload());
    let returned: string | null = 'x';
    await act(async () => {
      returned = await result.current.uploadAvatar(fileOf(100, 'image/png'));
    });

    expect(returned).toBeNull();
    expect(result.current).toMatchObject({ error: message, uploading: false, progress: 0 });
    expect(JSON.stringify(result.current)).not.toContain(SERVER_MARKER);
    expect(JSON.stringify(logged)).not.toContain(SERVER_MARKER);
    expect(JSON.stringify(logged)).not.toContain(NAME_MARKER);
  });

  it('H-5: a thrown fetch -> generic sentence; logger.error with { err }; no file name in any log (M-26)', async () => {
    const thrown = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(thrown);
    const { result } = renderHook(() => useAvatarUpload());
    await act(async () => {
      await result.current.uploadAvatar(fileOf(100, 'image/png'));
    });

    expect(result.current).toMatchObject({ error: 'Failed to upload the picture', uploading: false, progress: 0 });
    expect(logged).toEqual([{ level: 'error', args: [{ err: thrown }, 'Avatar upload request failed'] }]);
    expect(JSON.stringify(logged)).not.toContain(NAME_MARKER);
  });

  it('H-5: a refused response logs status and code only', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { success: false, code: 'file_type', error: SERVER_MARKER }));
    const { result } = renderHook(() => useAvatarUpload());
    await act(async () => {
      await result.current.uploadAvatar(fileOf(100, 'image/png'));
    });

    expect(logged).toEqual([{ level: 'warn', args: [{ status: 400, code: 'file_type' }, 'Avatar upload refused'] }]);
  });

  it('H-6: no user -> "User not authenticated", no request (unchanged)', async () => {
    useAuth.mockReturnValue({ user: null });
    const { result } = renderHook(() => useAvatarUpload());
    let returned: string | null = 'x';
    await act(async () => {
      returned = await result.current.uploadAvatar(fileOf(100, 'image/png'));
    });

    expect(returned).toBeNull();
    expect(result.current.error).toBe('User not authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deleteAvatar', () => {
  it('H-7: DELETE to the route; true on 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { avatar_url: null } }));
    const { result } = renderHook(() => useAvatarUpload());
    let returned = false;
    await act(async () => {
      returned = await result.current.deleteAvatar();
    });

    expect(returned).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/user/avatar', { method: 'DELETE' });
    expect(result.current).toMatchObject({ uploading: false, error: null });
  });

  it('H-7: false and the hook sentence on 500; the server text never appears', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false, code: 'save_failed', error: SERVER_MARKER }));
    const { result } = renderHook(() => useAvatarUpload());
    let returned = true;
    await act(async () => {
      returned = await result.current.deleteAvatar();
    });

    expect(returned).toBe(false);
    expect(result.current).toMatchObject({ uploading: false, error: 'Failed to remove the picture' });
    expect(JSON.stringify(result.current)).not.toContain(SERVER_MARKER);
  });

  it('H-7: a thrown fetch is false, logged with { err }', async () => {
    const thrown = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(thrown);
    const { result } = renderHook(() => useAvatarUpload());
    let returned = true;
    await act(async () => {
      returned = await result.current.deleteAvatar();
    });

    expect(returned).toBe(false);
    expect(logged).toEqual([{ level: 'error', args: [{ err: thrown }, 'Avatar removal request failed'] }]);
  });

  it('H-6: no user -> false, no request (unchanged)', async () => {
    useAuth.mockReturnValue({ user: null });
    const { result } = renderHook(() => useAvatarUpload());
    let returned = true;
    await act(async () => {
      returned = await result.current.deleteAvatar();
    });

    expect(returned).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('H-8: public shape', () => {
  it('returns exactly uploading, error, progress, uploadAvatar, deleteAvatar', () => {
    const { result } = renderHook(() => useAvatarUpload());
    expect(Object.keys(result.current).sort()).toEqual(['deleteAvatar', 'error', 'progress', 'uploadAvatar', 'uploading']);
    expect(result.current).toMatchObject({ uploading: false, error: null, progress: 0 });
    expect(typeof result.current.uploadAvatar).toBe('function');
    expect(typeof result.current.deleteAvatar).toBe('function');
  });
});
