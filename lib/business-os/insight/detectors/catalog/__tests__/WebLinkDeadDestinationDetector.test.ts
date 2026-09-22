import { WebLinkDeadDestinationDetector, deadReason } from '../WebLinkDeadDestinationDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

interface Link {
  id: string;
  code: string;
  name: string;
  destination_url: string | null;
  destination_type: string;
  click_count: number;
  is_active: boolean;
}

function mockSupabase(links: Link[]) {
  return {
    from() {
      let activeOnly = false;
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: activeOnly ? links.filter(l => l.is_active) : links, error: null }),
      };
      for (const m of ['select', 'gte', 'in', 'order', 'limit']) chain[m] = () => chain;
      chain.eq = (col: string, val: unknown) => {
        if (col === 'is_active' && val === true) activeOnly = true;
        return chain;
      };
      return chain;
    },
  };
}

function link(id: string, url: string | null, overrides: Partial<Link> = {}): Link {
  return {
    id,
    code: id,
    name: `Link ${id}`,
    destination_url: url,
    destination_type: 'booking',
    click_count: 0,
    is_active: true,
    ...overrides,
  };
}

function detector(client: unknown) {
  const d = new WebLinkDeadDestinationDetector(client as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('deadReason', () => {
  it.each([
    ['http://localhost:3000/c/fny614/contact', 'loopback'],
    ['http://127.0.0.1:3000/book', 'loopback'],
    ['https://example.invalid/book/1789601273026', 'placeholder'],
    ['https://example.com/book', 'placeholder'],
    ['http://mac-mini.local/book', 'placeholder'],
    ['http://192.168.1.14:3000/book', 'private_network'],
    ['http://10.0.0.5/book', 'private_network'],
    ['http://172.20.1.1/book', 'private_network'],
    ['', 'missing'],
    [null, 'missing'],
    ['not a url at all', 'malformed'],
  ])('calls %s unreachable (%s)', (url, reason) => {
    expect(deadReason(url as string | null)).toBe(reason);
  });

  it.each([
    'https://agentspilot.com/c/fny614/contact',
    'https://calendly.com/someone/30min',
    'https://wa.me/972500000000',
    'https://172.15.0.1/book',        // outside the RFC 1918 block
    'https://172.32.0.1/book',        // also outside it
    '/c/fny614/contact',              // relative: resolved against the platform
    'mailto:owner@example.org',       // opens a mail client, not a browser
  ])('leaves %s alone', url => {
    expect(deadReason(url)).toBeNull();
  });

  it('does not judge a host merely for being unfamiliar', () => {
    /*
     * The failure mode worth guarding: an owner pointing a link at their own
     * domain, their Instagram, or a booking tool the platform has never heard
     * of is doing something completely normal, and telling them it is broken
     * would be wrong far more often than right.
     */
    expect(deadReason('https://some-shop-nobody-here-knows.co.il/order')).toBeNull();
  });
});

describe('WebLinkDeadDestinationDetector', () => {
  it('reports a link pointing at localhost', async () => {
    const d = detector(mockSupabase([link('a', 'http://localhost:3000/c/fny614/contact', { click_count: 2 })]));

    const result = await d.evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.affectedCount).toBe(1);
    expect(result!.processParameters!.lost_clicks).toBe(2);
    expect((result!.processParameters!.links as Array<{ reason: string }>)[0].reason).toBe('loopback');
  });

  it('fires on a single link rather than waiting for a pattern', async () => {
    // One late invoice is not a cash-flow problem. One broken link is a broken
    // link, and holding it back until there were two would be absurd.
    const d = detector(mockSupabase([link('a', 'https://example.invalid/book/1789601273026')]));

    expect(await d.evaluate('user-1')).not.toBeNull();
  });

  it('is more severe once people have actually clicked it', async () => {
    const unclicked = detector(mockSupabase([link('a', 'http://localhost:3000/book')]));
    const clicked = detector(mockSupabase([link('a', 'http://localhost:3000/book', { click_count: 9 })]));

    expect((await unclicked.evaluate('user-1'))!.severity).toBe('low');
    expect((await clicked.evaluate('user-1'))!.severity).toBe('high');
  });

  it('ignores links the owner has switched off', async () => {
    const d = detector(mockSupabase([link('a', 'http://localhost:3000/book', { is_active: false })]));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent when every destination is reachable', async () => {
    const d = detector(mockSupabase([
      link('a', 'https://agentspilot.com/c/fny614/contact', { click_count: 40 }),
      link('b', '/c/fny614/book'),
    ]));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('puts the most-clicked broken link first', async () => {
    const d = detector(mockSupabase([
      link('a', 'http://localhost:3000/book', { click_count: 1 }),
      link('b', 'https://example.invalid/book', { click_count: 12 }),
    ]));

    const result = await d.evaluate('user-1');
    expect(result!.affectedEntityIds).toEqual(['b', 'a']);
    expect(result!.processParameters!.lost_clicks).toBe(13);
  });
});
