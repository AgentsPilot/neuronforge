/**
 * A unique-visitor count that could not be made is not a count of zero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS (FU-SL-1)
 *
 * `uniqueVisitorsByLink` is deliberately never fatal: a secondary figure must
 * not cost the owner the whole list. It expressed that as `{ data: {}, error:
 * null }` — empty counts — and this route turned that into `?? 0`.
 *
 * The links come from a DIFFERENT read, which was fine. So the page rendered
 * every link, each reporting a confident, un-muted **0 unique visitors**. The
 * owner was told nobody came when the truth was that nobody counted, and those
 * two readings call for opposite responses: one says change the link, the other
 * says look again later.
 *
 * The never-fatal half is kept. What changes is that the absence travels as an
 * absence — `null`, which the page shows as "—".
 * ─────────────────────────────────────────────────────────────────────────────
 */

const getUser = jest.fn();
const listByUser = jest.fn();
const uniqueVisitorsByLink = jest.fn();
const warn = jest.fn();

jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ info: jest.fn(), warn, error: jest.fn(), debug: jest.fn() }) }),
}));
jest.mock('@/lib/repositories/SmartLinkRepository', () => ({
  smartLinkRepository: {
    listByUser: (...a: unknown[]) => listByUser(...a),
    uniqueVisitorsByLink: (...a: unknown[]) => uniqueVisitorsByLink(...a),
    getOrCreateDefaultLinks: jest.fn(),
  },
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { getUserCode: jest.fn() },
}));

import { GET } from '../route';

const request = () =>
  ({ url: 'http://localhost/api/smart-links', headers: new Headers() }) as never;

const LINKS = [
  { id: 'a', click_count: 10, conversion_count: 1 },
  { id: 'b', click_count: 4, conversion_count: 0 },
];

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ id: 'user-1' });
  listByUser.mockResolvedValue({ data: LINKS, error: null });
});

describe('GET /api/smart-links', () => {
  it('refuses an unauthenticated caller', async () => {
    getUser.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
  });

  it('reports a failed count as null, and still returns every link', async () => {
    /* THE ONE THAT MATTERS. The list is good; only the figure is missing. */
    uniqueVisitorsByLink.mockResolvedValue({ data: null, error: new Error('read failed') });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.links).toHaveLength(2);
    for (const link of body.links) expect(link.unique_visitors).toBeNull();
  });

  it('says so in the log rather than silently', async () => {
    uniqueVisitorsByLink.mockResolvedValue({ data: null, error: new Error('read failed') });

    await GET(request());

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ links: 2 }),
      expect.stringMatching(/unique-visitor/i)
    );
  });

  it('a real zero is still zero', async () => {
    /*
     * The distinction this whole change exists for: a link nobody visited
     * reads 0, and reads it plainly. Only a FAILED count reads as absent.
     */
    uniqueVisitorsByLink.mockResolvedValue({ data: { counts: { a: 7, b: 0 }, atCap: false }, error: null });

    const body = await (await GET(request())).json();

    expect(body.links[0].unique_visitors).toBe(7);
    expect(body.links[1].unique_visitors).toBe(0);
    expect(body.links[0].unique_visitors_at_least).toBe(false);
  });

  it('marks the figures as a floor when the read hit its ceiling', async () => {
    /* FU-SL-2: at the ceiling every count is a lower bound, so none may be
       shown as exact. The flag is per RESULT, not per link, because the
       ceiling is on rows scanned across all of them. */
    uniqueVisitorsByLink.mockResolvedValue({ data: { counts: { a: 900, b: 12 }, atCap: true }, error: null });

    const body = await (await GET(request())).json();

    for (const link of body.links) expect(link.unique_visitors_at_least).toBe(true);
  });

  it('still fails loudly when the LINK list itself cannot be read', async () => {
    /* The never-fatal rule covers the secondary figure, not the page's own
       subject. A list that cannot be read is a 500, as before. */
    listByUser.mockResolvedValue({ data: null, error: new Error('links unavailable') });
    uniqueVisitorsByLink.mockResolvedValue({ data: { counts: {}, atCap: false }, error: null });

    const response = await GET(request());

    expect(response.status).toBe(500);
  });
});
