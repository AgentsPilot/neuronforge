import { resolvePublishedWebsiteSubdomain, resolvePlatformWebsiteUrl } from '../platformSite';

/**
 * The table, as a list this test controls. Only published rows come back,
 * because that is the filter the real query applies.
 */
let pages: Array<{ subdomain: string | null; page_type: string; status: string }> = [];
let shouldThrow = false;

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: () => {
      const rows = () =>
        pages.filter(
          p => p.status === 'published' && p.subdomain !== null && p.page_type === 'homepage'
        );
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.not = chain;
      builder.limit = chain;
      builder.maybeSingle = () => {
        if (shouldThrow) return Promise.reject(new Error('database is having a day'));
        return Promise.resolve({ data: rows()[0] ?? null, error: null });
      };
      return builder;
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

beforeEach(() => {
  pages = [];
  shouldThrow = false;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test';
});

describe('resolvePublishedWebsiteSubdomain', () => {
  it('is null when the business has published nothing of ours', () => {
    return expect(resolvePublishedWebsiteSubdomain('u1')).resolves.toBeNull();
  });

  it('ignores a draft, whose subdomain serves nothing', async () => {
    // The exact state of a real account: a landing page written and not
    // published. Linking to `ips` would send a client to an empty address.
    pages = [{ subdomain: 'ips', page_type: 'homepage', status: 'draft' }];
    await expect(resolvePublishedWebsiteSubdomain('u1')).resolves.toBeNull();
  });

  it('does not treat a published landing page as the business website', async () => {
    // One campaign, written for one offer, unpublished when it ends. Calling it
    // "our website" in an email footer misrepresents the business and breaks
    // the link the day the campaign closes.
    pages = [{ subdomain: 'ips', page_type: 'landing', status: 'published' }];
    await expect(resolvePublishedWebsiteSubdomain('u1')).resolves.toBeNull();
  });

  it('takes the homepage, ignoring any landing pages beside it', async () => {
    pages = [
      { subdomain: 'campaign', page_type: 'landing', status: 'published' },
      { subdomain: 'main', page_type: 'homepage', status: 'published' },
    ];
    await expect(resolvePublishedWebsiteSubdomain('u1')).resolves.toBe('main');
  });

  it('returns null rather than throwing when the read fails', async () => {
    shouldThrow = true;
    // Branding must never be able to stop an email going out.
    await expect(resolvePublishedWebsiteSubdomain('u1')).resolves.toBeNull();
  });
});

describe('resolvePlatformWebsiteUrl', () => {
  it('is null while nothing is published, so a caller can fall back', () => {
    return expect(resolvePlatformWebsiteUrl('u1')).resolves.toBeNull();
  });

  it('builds the absolute address once a page is live', async () => {
    pages = [{ subdomain: 'main', page_type: 'homepage', status: 'published' }];
    await expect(resolvePlatformWebsiteUrl('u1')).resolves.toBe('https://app.test/site/main');
  });

  /**
   * The behaviour this whole change exists for: a business that starts with its
   * own site and later publishes one with us should not have to do anything for
   * its emails to follow.
   */
  it('switches the moment a page is published, with nothing cached', async () => {
    await expect(resolvePlatformWebsiteUrl('u1')).resolves.toBeNull();

    pages = [{ subdomain: 'main', page_type: 'homepage', status: 'published' }];
    await expect(resolvePlatformWebsiteUrl('u1')).resolves.toBe('https://app.test/site/main');

    // And back again if they unpublish it.
    pages = [{ subdomain: 'main', page_type: 'homepage', status: 'draft' }];
    await expect(resolvePlatformWebsiteUrl('u1')).resolves.toBeNull();
  });
});
