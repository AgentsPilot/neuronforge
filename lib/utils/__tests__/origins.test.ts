/**
 * The addresses this system hands out.
 *
 * These assert the property that matters and that no test previously covered:
 * the preview, the copy-link button and the published link all come from ONE
 * function, so they cannot disagree. Five hardcoded domains coexisted for
 * months because each was computed at its own call site.
 */

describe('origins', () => {
  const ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ENV };
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_MARKETING_URL;
    delete process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST;
  });

  afterAll(() => {
    process.env = ENV;
  });

  const load = () => require('../origins');

  describe('with no public-site host — localhost and Vercel', () => {
    it('serves a business from the platform origin under a path', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://neuronforge-kohl.vercel.app';
      const { publicSiteUrl } = load();

      expect(publicSiteUrl('joesgym', '/book')).toBe(
        'https://neuronforge-kohl.vercel.app/site/joesgym/book'
      );
    });

    it('offers no suffix to display, because there is no subdomain to suffix', () => {
      const { publicSiteSuffix } = load();
      expect(publicSiteSuffix()).toBe('');
    });
  });

  describe('with a public-site host — production', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST = 'agentspilot.ai';
    });

    it('gives a business its own subdomain', () => {
      const { publicSiteUrl } = load();
      expect(publicSiteUrl('joesgym', '/book')).toBe('https://joesgym.agentspilot.ai/book');
    });

    it('addresses the business at the apex root with no path', () => {
      const { publicSiteUrl } = load();
      expect(publicSiteUrl('joesgym')).toBe('https://joesgym.agentspilot.ai');
    });

    it('displays the host without a scheme', () => {
      const { publicSiteDisplayHost, publicSiteSuffix } = load();
      expect(publicSiteDisplayHost('joesgym')).toBe('joesgym.agentspilot.ai');
      expect(publicSiteSuffix()).toBe('.agentspilot.ai');
    });
  });

  /*
   * The local-wildcard host is the ONLY way the production subdomain shape can
   * be exercised before production: `*.vercel.app` will not take a wildcard, so
   * without this the middleware rewrite ships having never run once.
   */
  it('uses http for lvh.me, which has no certificate and never will', () => {
    process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST = 'lvh.me:3000';
    const { publicSiteUrl } = load();

    expect(publicSiteUrl('joesgym', '/book')).toBe('http://joesgym.lvh.me:3000/book');
  });

  it('serves both address shapes from the same internal route', () => {
    const { publicSitePath } = load();

    // What middleware rewrites a subdomain request to, and what the path form
    // is served as directly. One route, so the two cannot drift apart.
    expect(publicSitePath('joesgym', '/book')).toBe('/site/joesgym/book');
  });

  it('never doubles a slash, whichever way a path is passed', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/';
    const { publicSiteUrl, platformUrl } = load();

    expect(platformUrl('/go/abc')).toBe('https://app.example.com/go/abc');
    expect(publicSiteUrl('joesgym', 'book')).toBe('https://app.example.com/site/joesgym/book');
  });

  it('strips a scheme from a configured public-site host', () => {
    process.env.NEXT_PUBLIC_PUBLIC_SITE_HOST = 'https://agentspilot.ai';
    const { publicSiteDisplayHost } = load();

    expect(publicSiteDisplayHost('joesgym')).toBe('joesgym.agentspilot.ai');
  });
});
