/**
 * What must be true when a service is taken away.
 *
 * These exist because of a real failure. Deleting a service checked one thing —
 * whether it had bookings — and nothing asked what else pointed at it. A
 * landing page written for that service stayed published, kept showing the
 * last-known name and price, and offered a Book button that the booking API
 * refused only after the client had filled in the entire form.
 *
 * The rule under test:
 *
 *   Anything scoped to THIS ONE service dies with it.
 *   Anything that lists ALL ACTIVE services heals itself.
 *
 * So the assertions below care about two ways this goes wrong:
 *
 *   1. Something is left pointing at a service that no longer exists.
 *   2. Something is taken down that had no need to be.
 *
 * Every collaborator is faked; this never reaches Supabase.
 */

const mockFindPageIds = jest.fn();
const mockFindLandingPages = jest.fn();
const mockUnpublishMany = jest.fn();
const mockDeleteMany = jest.fn();
const mockFindLinks = jest.fn();
const mockDeactivateMany = jest.fn();

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

jest.mock('@/lib/repositories/WebsiteBlockRepository', () => ({
  getWebsiteBlockRepository: () => ({
    findPageIdsByServiceId: (...a: unknown[]) => mockFindPageIds(...a),
  }),
}));

jest.mock('@/lib/repositories/WebsitePageRepository', () => ({
  WebsitePageRepository: class {
    findLandingPagesByIds(...a: unknown[]) { return mockFindLandingPages(...a); }
    unpublishMany(...a: unknown[]) { return mockUnpublishMany(...a); }
    deleteMany(...a: unknown[]) { return mockDeleteMany(...a); }
  },
}));

jest.mock('@/lib/repositories/SmartLinkRepository', () => ({
  smartLinkRepository: {
    findByServiceId: (...a: unknown[]) => mockFindLinks(...a),
    deactivateMany: (...a: unknown[]) => mockDeactivateMany(...a),
  },
}));

import {
  findServiceReferences,
  deleteServiceReferences,
  unpublishServiceReferences,
} from '../ServiceReferenceService';

const SERVICE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const USER = 'user-1';

const ok = <T,>(data: T) => ({ data, error: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockFindPageIds.mockResolvedValue(ok([]));
  mockFindLandingPages.mockResolvedValue(ok([]));
  mockFindLinks.mockResolvedValue(ok([]));
  mockUnpublishMany.mockResolvedValue(ok(0));
  mockDeleteMany.mockResolvedValue(ok(0));
  mockDeactivateMany.mockResolvedValue(ok(0));
});

describe('findServiceReferences', () => {
  it('reports nothing when the service stands alone', async () => {
    const refs = await findServiceReferences(SERVICE, USER);

    expect(refs.landingPages).toEqual([]);
    expect(refs.smartLinks).toEqual([]);
    expect(refs.hasBlocking).toBe(false);
  });

  it('finds the landing page built around the service', async () => {
    mockFindPageIds.mockResolvedValue(ok(['page-1']));
    mockFindLandingPages.mockResolvedValue(ok([
      { id: 'page-1', title: 'Wedding Photography', slug: 'weddings', status: 'live' },
    ]));

    const refs = await findServiceReferences(SERVICE, USER);

    expect(refs.landingPages).toEqual([
      { id: 'page-1', title: 'Wedding Photography', slug: 'weddings', status: 'live' },
    ]);
    expect(refs.hasBlocking).toBe(true);
    // Ownership is enforced when block ids are resolved to pages, because
    // website_blocks carries no user_id of its own.
    expect(mockFindLandingPages).toHaveBeenCalledWith(['page-1'], USER);
  });

  it('does not go looking for pages when no block mentions the service', async () => {
    await findServiceReferences(SERVICE, USER);
    expect(mockFindLandingPages).not.toHaveBeenCalled();
  });

  it('treats a smart link pinned to only this service as blocking', async () => {
    mockFindLinks.mockResolvedValue(ok([
      { id: 'l1', name: 'Instagram bio', code: 'abc123', metadata: { serviceIds: [SERVICE] } },
    ]));

    const refs = await findServiceReferences(SERVICE, USER);

    expect(refs.smartLinks[0].onlyThisService).toBe(true);
    expect(refs.hasBlocking).toBe(true);
  });

  // The heart of the rule: a link that also sells something else survives,
  // because it still has somewhere to send people.
  it('does not treat a smart link carrying other services as blocking', async () => {
    mockFindLinks.mockResolvedValue(ok([
      { id: 'l1', name: 'Bio link', code: 'abc123', metadata: { serviceIds: [SERVICE, OTHER] } },
    ]));

    const refs = await findServiceReferences(SERVICE, USER);

    expect(refs.smartLinks[0].onlyThisService).toBe(false);
    expect(refs.hasBlocking).toBe(false);
  });

  it('survives a link whose metadata is missing entirely', async () => {
    mockFindLinks.mockResolvedValue(ok([{ id: 'l1', name: null, code: 'abc', metadata: null }]));

    const refs = await findServiceReferences(SERVICE, USER);

    expect(refs.smartLinks[0].onlyThisService).toBe(false);
  });

  /*
   * A lookup failure must not lock an owner out of managing their own services.
   * It reports nothing found; the render-time guard is what actually protects
   * the public page.
   */
  it('reports nothing rather than throwing when a lookup fails', async () => {
    mockFindPageIds.mockResolvedValue({ data: null, error: new Error('db down') });

    const refs = await findServiceReferences(SERVICE, USER);

    expect(refs).toEqual({ landingPages: [], smartLinks: [], hasBlocking: false });
  });
});

describe('unpublishServiceReferences', () => {
  const livePage = { id: 'page-1', title: 'Weddings', slug: 'w', status: 'live' };
  const draftPage = { id: 'page-2', title: 'Drafted', slug: 'd', status: 'draft' };

  it('unpublishes only the pages that are actually being served', async () => {
    mockUnpublishMany.mockResolvedValue(ok(1));

    const result = await unpublishServiceReferences(
      { landingPages: [livePage, draftPage], smartLinks: [], hasBlocking: true },
      USER
    );

    expect(mockUnpublishMany).toHaveBeenCalledWith(['page-1'], USER);
    expect(result.pagesUnpublished).toBe(1);
  });

  it('disables only the links that have nowhere left to point', async () => {
    mockDeactivateMany.mockResolvedValue(ok(1));

    await unpublishServiceReferences(
      {
        landingPages: [],
        smartLinks: [
          { id: 'dead', name: null, code: 'a', onlyThisService: true },
          { id: 'alive', name: null, code: 'b', onlyThisService: false },
        ],
        hasBlocking: true,
      },
      USER
    );

    expect(mockDeactivateMany).toHaveBeenCalledWith(['dead'], USER);
  });

  it('touches nothing when nothing pointed at the service', async () => {
    const result = await unpublishServiceReferences(
      { landingPages: [], smartLinks: [], hasBlocking: false },
      USER
    );

    expect(mockUnpublishMany).toHaveBeenCalledWith([], USER);
    expect(mockDeactivateMany).toHaveBeenCalledWith([], USER);
    expect(result).toEqual({ pagesUnpublished: 0, linksDisabled: 0 });
  });

  /*
   * This runs AFTER the service row is already gone. Throwing here would report
   * a failed deletion that in fact succeeded, and leave the owner with no idea
   * what state their pages are in.
   */
  it('reports what it managed rather than throwing when a takedown fails', async () => {
    mockUnpublishMany.mockResolvedValue({ data: null, error: new Error('db down') });
    mockDeactivateMany.mockResolvedValue(ok(1));

    const result = await unpublishServiceReferences(
      {
        landingPages: [livePage],
        smartLinks: [{ id: 'dead', name: null, code: 'a', onlyThisService: true }],
        hasBlocking: true,
      },
      USER
    );

    expect(result).toEqual({ pagesUnpublished: 0, linksDisabled: 1 });
  });
});

/**
 * Deleting a service and drafting one are different events.
 *
 * A landing page is GENERATED for a single service — headline, body, objections
 * and closing section all written about that one thing — so when the service is
 * deleted the page is not a page missing a product, it is an article about
 * something that does not exist. It goes. A service moved to draft is coming
 * back and its copy is still true, so its page is only unpublished.
 *
 * These two must never be wired to the same repository call: one of them
 * destroys an owner's work irreversibly.
 */
describe('deleteServiceReferences', () => {
  const livePage = { id: 'page-1', title: 'Weddings', slug: 'w', status: 'live' };
  const draftPage = { id: 'page-2', title: 'Drafted', slug: 'd', status: 'draft' };

  it('deletes every page, published or not', async () => {
    mockDeleteMany.mockResolvedValue(ok(2));

    const result = await deleteServiceReferences(
      { landingPages: [livePage, draftPage], smartLinks: [], hasBlocking: true },
      USER
    );

    // Unlike the unpublish path, a draft is deleted too: it is just as
    // meaningless without its service, and leaving it behind gives the owner a
    // list of pages they can never usefully republish.
    expect(mockDeleteMany).toHaveBeenCalledWith(['page-1', 'page-2'], USER);
    expect(result.pagesDeleted).toBe(2);
  });

  it('never unpublishes instead of deleting', async () => {
    await deleteServiceReferences(
      { landingPages: [livePage], smartLinks: [], hasBlocking: true },
      USER
    );

    expect(mockUnpublishMany).not.toHaveBeenCalled();
  });

  it('only switches links off — a short code may have been shared', async () => {
    mockDeactivateMany.mockResolvedValue(ok(1));

    await deleteServiceReferences(
      {
        landingPages: [],
        smartLinks: [
          { id: 'dead', name: null, code: 'a', onlyThisService: true },
          { id: 'alive', name: null, code: 'b', onlyThisService: false },
        ],
        hasBlocking: true,
      },
      USER
    );

    expect(mockDeactivateMany).toHaveBeenCalledWith(['dead'], USER);
  });

  it('touches nothing when nothing pointed at the service', async () => {
    const result = await deleteServiceReferences(
      { landingPages: [], smartLinks: [], hasBlocking: false },
      USER
    );

    expect(mockDeleteMany).toHaveBeenCalledWith([], USER);
    expect(result.pagesDeleted).toBe(0);
  });
});

describe('the drafting path stays non-destructive', () => {
  it('never deletes a page', async () => {
    await unpublishServiceReferences(
      {
        landingPages: [{ id: 'page-1', title: 'Weddings', slug: 'w', status: 'live' }],
        smartLinks: [],
        hasBlocking: true,
      },
      USER
    );

    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
