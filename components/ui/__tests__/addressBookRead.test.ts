/**
 * `readAddressBook`: the one copy of the address-book read (C-a workplan A-1,
 * SA-CA-6). It sends today's request, parses exactly as the picker did, and
 * never rejects.
 */

import { readAddressBook } from '@/components/ui/addressBookRead';

const mockFetch = jest.fn();

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => mockFetch.mockReset());

const respond = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('readAddressBook', () => {
  it("sends today's request: the locale-encoded URL with { cache: 'no-store' } and nothing else", async () => {
    mockFetch.mockResolvedValue(respond({ success: true, data: { addresses: [] } }));
    await readAddressBook('he');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]).toEqual(['/api/business-os/addresses?locale=he', { cache: 'no-store' }]);
  });

  it('encodes the locale', async () => {
    mockFetch.mockResolvedValue(respond({ success: true, data: { addresses: [] } }));
    await readAddressBook('a&b');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/business-os/addresses?locale=a%26b');
  });

  it('returns the addresses with the locale they were read in', async () => {
    const addresses = [{ id: 'a' }];
    mockFetch.mockResolvedValue(respond({ success: true, data: { addresses } }));
    await expect(readAddressBook('en')).resolves.toEqual({ ok: true, locale: 'en', addresses });
  });

  it('a success with no address array is an empty book, as the picker parsed it', async () => {
    mockFetch.mockResolvedValue(respond({ success: true, data: {} }));
    await expect(readAddressBook('en')).resolves.toEqual({ ok: true, locale: 'en', addresses: [] });
  });

  it.each([
    ['a refusal', () => Promise.resolve(respond({ success: false }, 401)), { ok: false, status: 401 }],
    ['a 200 with success: false', () => Promise.resolve(respond({ success: false })), { ok: false, status: 200 }],
    ['a network error', () => Promise.reject(new Error('offline')), { ok: false, status: null }],
    [
      'a body that is not JSON',
      () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }),
      { ok: false, status: null },
    ],
  ])('never rejects: %s is an answer', async (_kind, reply, expected) => {
    mockFetch.mockImplementation(reply);
    await expect(readAddressBook('en')).resolves.toEqual(expected);
  });
});
