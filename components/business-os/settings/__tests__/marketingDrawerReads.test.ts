/**
 * `marketingDrawerReads` (C-a workplan A-1; SA-CA-1, SA-CA-6). The consent GET
 * is exactly today's request, a failure says how it failed, nothing rejects,
 * and the starter puts both reads in flight at once.
 */

import { readConsentSettings, startMarketingDrawerReads } from '@/components/business-os/settings/marketingDrawerReads';

const mockFetch = jest.fn();

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => mockFetch.mockReset());

const respond = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('readConsentSettings', () => {
  it("sends today's request: the locale-encoded URL and no init at all (no cache option)", async () => {
    mockFetch.mockResolvedValue(respond({ success: true }));
    await readConsentSettings('he');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]).toEqual(['/api/business-os/consent-settings?locale=he']);
  });

  it('returns the body unjudged, with the status', async () => {
    const body = { success: false, anything: 1 };
    mockFetch.mockResolvedValue(respond(body));
    await expect(readConsentSettings('en')).resolves.toEqual({ ok: true, status: 200, body });
  });

  it('a non-OK status is a refusal with that status', async () => {
    mockFetch.mockResolvedValue(respond({ success: false }, 500));
    await expect(readConsentSettings('en')).resolves.toEqual({ ok: false, kind: 'refused', status: 500 });
  });

  it('a network error is a throw that carries err; it never rejects', async () => {
    const err = new Error('offline');
    mockFetch.mockRejectedValue(err);
    await expect(readConsentSettings('en')).resolves.toEqual({ ok: false, kind: 'threw', err });
  });

  it('a body that is not JSON is a throw that carries err', async () => {
    const err = new SyntaxError('bad');
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw err; } });
    await expect(readConsentSettings('en')).resolves.toEqual({ ok: false, kind: 'threw', err });
  });
});

describe('startMarketingDrawerReads', () => {
  it('starts both reads synchronously, in the given language, before anything is awaited', () => {
    mockFetch.mockReturnValue(new Promise(() => undefined));
    const reads = startMarketingDrawerReads('es');
    expect(reads.locale).toBe('es');
    expect(mockFetch.mock.calls.map(([url]) => url).sort()).toEqual([
      '/api/business-os/addresses?locale=es',
      '/api/business-os/consent-settings?locale=es',
    ]);
  });

  it('neither promise rejects when both requests fail', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const reads = startMarketingDrawerReads('en');
    await expect(reads.consent).resolves.toMatchObject({ ok: false, kind: 'threw' });
    await expect(reads.book).resolves.toEqual({ ok: false, status: null });
  });
});
