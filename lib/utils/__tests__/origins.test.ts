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

  /**
   * A deployed build must never hand out an address only the builder can reach.
   *
   * `NEXT_PUBLIC_APP_URL` is one value per environment and a preview does not
   * have one address, so the variable copied out of `.env.local` reached Vercel
   * saying `http://localhost:3000`. Every smart link, website address and
   * landing-page link is built from `platformOrigin`, so all three handed that
   * out. `NODE_ENV` cannot catch it: Vercel builds previews with
   * `NODE_ENV=production`, so it arrives as configuration, not as a fallback.
   */
  describe('on Vercel', () => {
    const onPreview = (host = 'neuronforge-abc123-scope.vercel.app') => {
      process.env.VERCEL = '1';
      process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_VERCEL_URL = host;
    };

    beforeEach(() => {
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      delete process.env.VERCEL_URL;
      delete process.env.NEXT_PUBLIC_VERCEL_ENV;
      delete process.env.NEXT_PUBLIC_VERCEL_URL;
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      delete process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
    });

    it('refuses a localhost value configured on a preview, and uses the deployment', () => {
      onPreview();
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      const { platformOrigin } = load();

      expect(platformOrigin()).toBe('https://neuronforge-abc123-scope.vercel.app');
    });

    it('addresses a preview by ITS OWN host, not one value shared by every preview', () => {
      // The reason configuration cannot win here: each deployment differs.
      onPreview('neuronforge-second-build.vercel.app');
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.agentspilot.ai';
      const { platformOrigin } = load();

      expect(platformOrigin()).toBe('https://neuronforge-second-build.vercel.app');
    });

    it('carries that host into smart links, website addresses and landing pages alike', () => {
      onPreview();
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      const { platformUrl, publicSiteUrl } = load();

      // The three surfaces that were handing out localhost.
      expect(platformUrl('/go/abc')).toBe('https://neuronforge-abc123-scope.vercel.app/go/abc');
      expect(publicSiteUrl('joesgym')).toBe('https://neuronforge-abc123-scope.vercel.app/site/joesgym');
      expect(publicSiteUrl('joesgym', '/spring-offer')).toBe(
        'https://neuronforge-abc123-scope.vercel.app/site/joesgym/spring-offer'
      );
    });

    it('reads the server-only system variables when the public copies are absent', () => {
      // A project may expose system variables to the server but not the browser.
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'preview';
      process.env.VERCEL_URL = 'neuronforge-server-only.vercel.app';
      const { platformOrigin } = load();

      expect(platformOrigin()).toBe('https://neuronforge-server-only.vercel.app');
    });

    it('keeps the real domain in production rather than a deployment hash', () => {
      // A client should never be shown a per-deployment URL.
      process.env.VERCEL = '1';
      process.env.NEXT_PUBLIC_VERCEL_ENV = 'production';
      process.env.NEXT_PUBLIC_VERCEL_URL = 'neuronforge-xyz789.vercel.app';
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.agentspilot.ai';
      const { platformOrigin } = load();

      expect(platformOrigin()).toBe('https://app.agentspilot.ai');
    });

    it("uses the project's real production host when production is misconfigured to localhost", () => {
      // Not the `app.agentspilot.ai` constant: that apex is not served yet (see
      // the marketing-origin comment), so preferring it would swap one
      // unreachable address for another and be harder to notice than localhost.
      process.env.VERCEL = '1';
      process.env.NEXT_PUBLIC_VERCEL_ENV = 'production';
      process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL = 'neuronforge-kohl.vercel.app';
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      const { platformOrigin } = load();

      expect(platformOrigin()).toBe('https://neuronforge-kohl.vercel.app');
    });

    it('falls back to the constant only when Vercel tells us nothing else', () => {
      process.env.VERCEL = '1';
      process.env.NEXT_PUBLIC_VERCEL_ENV = 'production';
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
      const { platformOrigin } = load();

      expect(platformOrigin()).toBe('https://app.agentspilot.ai');
    });

    it('honours a real configured domain on a preview environment variable', () => {
      // Refusing localhost must not refuse a deliberately configured host.
      process.env.VERCEL = '1';
      process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
      process.env.NEXT_PUBLIC_APP_URL = 'https://staging.agentspilot.ai';
      const { platformOrigin } = load();

      // No deployment host exposed, so configuration is all there is.
      expect(platformOrigin()).toBe('https://staging.agentspilot.ai');
    });
  });

  it('still uses localhost for local development, which is not Vercel', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    const { platformOrigin } = load();

    expect(platformOrigin()).toBe('http://localhost:3000');
  });
});
