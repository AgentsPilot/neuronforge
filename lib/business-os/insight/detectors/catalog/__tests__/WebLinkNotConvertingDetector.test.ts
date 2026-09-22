import { WebLinkNotConvertingDetector } from '../WebLinkNotConvertingDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

interface Link { id: string; code: string; name: string; destination_type: string; is_active: boolean }
interface Click { smart_link_id: string; converted: boolean }

/**
 * The mock honours `is_active`, because an inactive link is a link the owner
 * already retired and reporting it would be advice about the past.
 */
function mockSupabase(links: Link[], clicks: Click[], capture?: { from?: string }) {
  return {
    from(table: string) {
      if (table === 'smart_links') {
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
      }

      // smart_link_clicks, scoped to the ids the caller passed.
      let ids: string[] = links.map(l => l.id);
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: clicks.filter(c => ids.includes(c.smart_link_id)), error: null }),
      };
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain;
      chain.in = (_col: string, val: string[]) => { ids = val; return chain; };
      chain.gte = (col: string, val: string) => {
        if (capture && col === 'clicked_at') capture.from = val;
        return chain;
      };
      return chain;
    },
  };
}

function link(id: string, overrides: Partial<Link> = {}): Link {
  return { id, code: id, name: `Link ${id}`, destination_type: 'booking', is_active: true, ...overrides };
}

function clicks(id: string, n: number, converted = 0): Click[] {
  return Array.from({ length: n }, (_, i) => ({ smart_link_id: id, converted: i < converted }));
}

function detector(client: unknown) {
  const d = new WebLinkNotConvertingDetector(client as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('WebLinkNotConvertingDetector', () => {
  it('reports a link with real clicks and no conversions', async () => {
    const d = detector(mockSupabase([link('a')], clicks('a', 40)));

    const result = await d.evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.affectedCount).toBe(1);
    expect(result!.processParameters!.wasted_clicks).toBe(40);
    expect(result!.affectedEntityIds).toEqual(['a']);
  });

  it('stays silent for a link that converted even once', async () => {
    /*
     * One booking is proof the path works end to end. Whether one in forty is
     * good is a judgement about the offer; this detector only claims the
     * unambiguous case, which is none.
     */
    const d = detector(mockSupabase([link('a')], clicks('a', 40, 1)));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent below the click floor', async () => {
    // Four clicks and no booking is four people, not a broken booking page.
    const d = detector(mockSupabase([link('a')], clicks('a', 4)));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('ignores links the owner has switched off', async () => {
    const d = detector(mockSupabase(
      [link('a', { is_active: false }), link('b')],
      [...clicks('a', 200), ...clicks('b', 20)]
    ));

    const result = await d.evaluate('user-1');
    expect(result!.affectedEntityIds).toEqual(['b']);
    expect(result!.processParameters!.wasted_clicks).toBe(20);
  });

  it('never reads clicks from before attribution worked', async () => {
    /*
     * The guard that matters most. `converted` was false on every row until the
     * booking flow started sending a session id, so a window reaching back
     * beyond that date would report every link on every existing account as
     * converting nobody. The floor is a correctness boundary, not a preference.
     */
    const capture: { from?: string } = {};
    const d = detector(mockSupabase([link('a')], clicks('a', 40), capture));

    await d.evaluate('user-1');

    expect(capture.from).toBeDefined();
    expect(new Date(capture.from!).getTime()).toBeGreaterThanOrEqual(
      new Date('2026-09-17T00:00:00.000Z').getTime()
    );
  });

  it('adds up the clicks across several failing links, worst first', async () => {
    const d = detector(mockSupabase(
      [link('a'), link('b'), link('c')],
      [...clicks('a', 15), ...clicks('b', 60), ...clicks('c', 20)]
    ));

    const result = await d.evaluate('user-1');
    expect(result!.affectedCount).toBe(3);
    expect(result!.affectedEntityIds).toEqual(['b', 'c', 'a']);
    expect(result!.processParameters!.wasted_clicks).toBe(95);
  });

  it('reports no percentage change, having no baseline to compare against', async () => {
    // A hardcoded 100 here reaches the owner as "a 100% change", which is the
    // fabricated statistic this module has already had to remove sixteen times.
    const d = detector(mockSupabase([link('a')], clicks('a', 40)));

    const result = await d.evaluate('user-1');
    expect(result!.percentChange).toBe(0);
  });

  it('says nothing when there are no links at all', async () => {
    const d = detector(mockSupabase([], []));

    expect(await d.evaluate('user-1')).toBeNull();
  });
});
