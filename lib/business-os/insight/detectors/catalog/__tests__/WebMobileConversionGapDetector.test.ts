import { WebMobileConversionGapDetector } from '../WebMobileConversionGapDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

interface View { session_id: string | null; device_type: string }

/**
 * Views come back as rows; contact counts come back as a head-count per device,
 * so the mock has to honour the `source_metadata->>device_type` filter.
 */
function mockSupabase(views: View[], contacts: { mobile: number; desktop: number }) {
  return {
    from(table: string) {
      if (table === 'website_page_views') {
        const chain: Record<string, unknown> = {
          then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
            resolve({ data: views, error: null }),
        };
        for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'limit']) chain[m] = () => chain;
        return chain;
      }

      // crm_contacts, counted per device.
      let device = '';
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { count: number; error: null }) => unknown) =>
          resolve({ count: device === 'mobile' ? contacts.mobile : contacts.desktop, error: null }),
      };
      for (const m of ['select', 'gte', 'lt', 'in', 'order', 'limit']) chain[m] = () => chain;
      chain.eq = (col: string, val: string) => {
        if (col.includes('device_type')) device = val;
        return chain;
      };
      return chain;
    },
  };
}

/** n unique sessions on one device. */
function views(device: string, n: number, prefix = device): View[] {
  return Array.from({ length: n }, (_, i) => ({ session_id: `${prefix}-${i}`, device_type: device }));
}

function detector(client: unknown) {
  const d = new WebMobileConversionGapDetector(client as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('WebMobileConversionGapDetector', () => {
  it('reports a real gap between phone and desktop', async () => {
    // 100 phone visitors → 2 enquiries (2%). 100 desktop → 20 (20%).
    const d = detector(mockSupabase(
      [...views('mobile', 100), ...views('desktop', 100)],
      { mobile: 2, desktop: 20 }
    ));

    const result = await d.evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.processParameters!.mobile_rate).toBe(2);
    expect(result!.processParameters!.desktop_rate).toBe(20);
    expect(result!.processParameters!.gap_points).toBe(18);
    // Measured arithmetic, not a projection: 18% of 100 phone visitors.
    expect(result!.processParameters!.missed_contacts).toBe(18);
  });

  it('counts visitors, not page views', async () => {
    /*
     * One person reading four pages is one visitor. Counting rows would make
     * whichever device browses more deeply look like it converts less, which is
     * precisely backwards.
     */
    const repeated: View[] = [];
    for (let i = 0; i < 50; i++) {
      // 50 people, four pages each.
      for (let p = 0; p < 4; p++) repeated.push({ session_id: `m-${i}`, device_type: 'mobile' });
    }
    const d = detector(mockSupabase(
      [...repeated, ...views('desktop', 50)],
      { mobile: 1, desktop: 15 }
    ));

    const result = await d.evaluate('user-1');
    expect(result!.processParameters!.mobile_visitors).toBe(50);
  });

  it('ignores views with no session rather than counting each as a visitor', async () => {
    /*
     * `session_id` was null on every row recorded before the tracker was fixed.
     * Treating those as unique people would invent one visitor per page view
     * and make any rate computed from them meaningless.
     */
    const nulls: View[] = Array.from({ length: 200 }, () => ({ session_id: null, device_type: 'mobile' }));
    const d = detector(mockSupabase(
      [...nulls, ...views('mobile', 30), ...views('desktop', 30)],
      { mobile: 0, desktop: 9 }
    ));

    const result = await d.evaluate('user-1');
    expect(result!.processParameters!.mobile_visitors).toBe(30);
  });

  it('stays silent when either side is too small to be a rate', async () => {
    // 3 phone visitors converting nobody is three people, not a finding.
    const d = detector(mockSupabase(
      [...views('mobile', 3), ...views('desktop', 100)],
      { mobile: 0, desktop: 20 }
    ));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent when desktop is too small to be a yardstick', async () => {
    const d = detector(mockSupabase(
      [...views('mobile', 100), ...views('desktop', 5)],
      { mobile: 2, desktop: 3 }
    ));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent for a narrow difference', async () => {
    // 12% vs 20%: eight points, inside ordinary variation.
    const d = detector(mockSupabase(
      [...views('mobile', 100), ...views('desktop', 100)],
      { mobile: 12, desktop: 20 }
    ));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent when mobile does better', async () => {
    const d = detector(mockSupabase(
      [...views('mobile', 100), ...views('desktop', 100)],
      { mobile: 30, desktop: 10 }
    ));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('does not count tablets as either side', async () => {
    // Tablets are their own device. Folding them into mobile is exactly what
    // the classifier bug used to do, and it polluted the arm being measured.
    const d = detector(mockSupabase(
      [...views('mobile', 30), ...views('desktop', 30), ...views('tablet', 500)],
      { mobile: 0, desktop: 9 }
    ));

    const result = await d.evaluate('user-1');
    expect(result!.processParameters!.mobile_visitors).toBe(30);
    expect(result!.processParameters!.desktop_visitors).toBe(30);
  });
});
