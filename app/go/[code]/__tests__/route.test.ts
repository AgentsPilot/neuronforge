/**
 * GET /go/[code] — purge slice 3b, AC-27 (structural half).
 *
 * After a Purge (or Reset) the business's `smart_links` rows are gone. This
 * public redirect records a click only for a link it FOUND, so a code that
 * belonged to a purged business must reach the "unavailable" page without
 * inserting a click attributable to the purged user.
 *
 * The live half belongs to the parent workplan's post-rotation sweep (T28).
 */

import { NextRequest } from 'next/server';

const findByCode = jest.fn();
const recordClick = jest.fn();
jest.mock('@/lib/repositories/SmartLinkRepository', () => ({
  smartLinkRepository: {
    findByCode: (...a: unknown[]) => findByCode(...a),
    recordClick: (...a: unknown[]) => recordClick(...a),
  },
}));

const getUserCode = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { getUserCode: (...a: unknown[]) => getUserCode(...a) },
}));

import { GET } from '../route';

const CODE = 'abc123';

function call(code = CODE) {
  const request = new NextRequest(`http://localhost/go/${code}`);
  return GET(request, { params: Promise.resolve({ code }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  recordClick.mockResolvedValue({ data: { id: 'click-1' }, error: null });
  getUserCode.mockResolvedValue({ data: null, error: null });
});

describe('AC-27 — a purged business gets no smart-link clicks', () => {
  it('a code whose link no longer exists redirects to "not found" and records no click', async () => {
    findByCode.mockResolvedValue({ data: null, error: null });

    const res = await call();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/go/unavailable?reason=notfound');
    expect(recordClick).not.toHaveBeenCalled();
  });

  it('a lookup error is treated the same way: no click', async () => {
    findByCode.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await call();

    expect(recordClick).not.toHaveBeenCalled();
  });

  it('a malformed code never reaches the lookup or the insert', async () => {
    await call('x');

    expect(findByCode).not.toHaveBeenCalled();
    expect(recordClick).not.toHaveBeenCalled();
  });

  it('control: an existing active link records exactly one click, against that link', async () => {
    findByCode.mockResolvedValue({
      data: { id: 'link-1', user_id: 'owner-1', is_active: true, destination_url: 'https://example.com/x', destination_type: 'url' },
      error: null,
    });

    const res = await call();

    expect(res.status).toBe(302);
    expect(recordClick).toHaveBeenCalledTimes(1);
    expect(recordClick.mock.calls[0][0]).toBe('link-1');
  });
});
