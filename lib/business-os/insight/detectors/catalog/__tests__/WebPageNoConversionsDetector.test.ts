import { WebPageNoConversionsDetector, pageHasContact } from '../WebPageNoConversionsDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

interface Page { id: string; slug: string | null; title: string; page_type: string }
interface View { page_id: string; session_id: string | null }

function mockSupabase(pages: Page[], views: View[], contactUrls: string[]) {
  return {
    from(table: string) {
      if (table === 'website_pages') {
        const chain: Record<string, unknown> = {
          then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: pages, error: null }),
        };
        for (const m of ['select', 'eq', 'gte', 'in', 'order', 'limit']) chain[m] = () => chain;
        return chain;
      }
      if (table === 'website_page_views') {
        const chain: Record<string, unknown> = {
          then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: views, error: null }),
        };
        for (const m of ['select', 'eq', 'gte', 'in', 'order', 'limit']) chain[m] = () => chain;
        return chain;
      }
      // crm_contacts, returning the `source_metadata->>capture_page_url` alias.
      const chain: Record<string, unknown> = {
        then: (r: (v: { data: unknown; error: null }) => unknown) =>
          r({ data: contactUrls.map(capture_page_url => ({ capture_page_url })), error: null }),
      };
      for (const m of ['select', 'eq', 'gte', 'in', 'order', 'limit']) chain[m] = () => chain;
      return chain;
    },
  };
}

function views(pageId: string, n: number): View[] {
  return Array.from({ length: n }, (_, i) => ({ page_id: pageId, session_id: `${pageId}-s${i}` }));
}

function detector(client: unknown) {
  const d = new WebPageNoConversionsDetector(client as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('pageHasContact', () => {
  it('matches a home page on the site root, which carries no slug', () => {
    /*
     * The bug this exists for: a home page lives at `/c/fny614` and its slug,
     * `home`, appears nowhere in that address. Matching it like any other page
     * meant every enquiry from the home page missed, and a home page that
     * converts perfectly well was reported as converting nobody.
     */
    const home = { slug: 'home', page_type: 'homepage' };
    expect(pageHasContact(home, ['https://site.com/c/fny614'])).toBe(true);
    expect(pageHasContact(home, ['https://site.com/c/fny614/'])).toBe(true);
    expect(pageHasContact(home, ['https://site.com/c/fny614/home'])).toBe(true);
  });

  it('does not credit the home page with an enquiry from a deeper page', () => {
    const home = { slug: 'home', page_type: 'homepage' };
    expect(pageHasContact(home, ['https://site.com/c/fny614/training-package'])).toBe(false);
  });

  it('matches any other page on its slug appearing in the path', () => {
    const landing = { slug: 'adhd-2026', page_type: 'landing' };
    expect(pageHasContact(landing, ['https://site.com/c/fny614/adhd-2026'])).toBe(true);
    expect(pageHasContact(landing, ['https://site.com/c/fny614/other'])).toBe(false);
  });
});

describe('WebPageNoConversionsDetector', () => {
  it('reports a landing page sooner than an ordinary page', async () => {
    /*
     * 25 visitors. Below the general floor of 40, above the landing-page floor
     * of 20, because getting in touch is the only thing a landing page is for.
     */
    const page: Page = { id: 'p1', slug: 'adhd-2026', title: 'ADHD', page_type: 'landing' };
    const d = detector(mockSupabase([page], views('p1', 25), []));

    const result = await d.evaluate('user-1');
    expect(result).not.toBeNull();
    expect(result!.processParameters!.page_kind).toBe('landing');
  });

  it('holds a home page to a higher bar', async () => {
    /*
     * The same 25 visitors on a home page says much less: people read it, form
     * a view, and get in touch from the booking page they clicked through to,
     * which is recorded against that page instead.
     */
    const page: Page = { id: 'p1', slug: 'home', title: 'Home', page_type: 'homepage' };
    const d = detector(mockSupabase([page], views('p1', 25), []));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent about a home page whose visitors did get in touch', async () => {
    const page: Page = { id: 'p1', slug: 'home', title: 'Home', page_type: 'homepage' };
    const d = detector(mockSupabase(
      [page],
      views('p1', 200),
      ['https://site.com/c/fny614?utm_source=whatsapp&_sid=abc']
    ));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('raises the severity when a landing page is among the failing pages', async () => {
    const ordinary: Page = { id: 'p1', slug: 'about', title: 'About', page_type: 'other' };
    const landing: Page = { id: 'p2', slug: 'adhd-2026', title: 'ADHD', page_type: 'landing' };

    const without = detector(mockSupabase([ordinary], views('p1', 50), []));
    const with_ = detector(mockSupabase([landing], views('p2', 50), []));

    expect((await without.evaluate('user-1'))!.severity).toBe('low');
    expect((await with_.evaluate('user-1'))!.severity).toBe('medium');
  });

  it('calls a mixed set mixed rather than picking one', async () => {
    const d = detector(mockSupabase(
      [
        { id: 'p1', slug: 'about', title: 'About', page_type: 'other' },
        { id: 'p2', slug: 'adhd-2026', title: 'ADHD', page_type: 'landing' },
      ],
      [...views('p1', 50), ...views('p2', 50)],
      []
    ));

    const result = await d.evaluate('user-1');
    expect(result!.processParameters!.page_kind).toBe('mixed');
  });
});
