import { ConvQuoteAcceptanceDropDetector } from '../ConvQuoteAcceptanceDropDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

interface Row { id: string; status: string; total: number; currency: string; decided_at: string }

/**
 * The detector fetches once and splits the rows itself, so the client only has
 * to honour the single `gte` on the outer bound.
 */
function mockSupabase(rows: Row[]) {
  return {
    from() {
      let gte: string | null = null;
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: rows.filter(r => !gte || r.decided_at >= gte), error: null }),
      };
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'lt']) chain[m] = () => chain;
      chain.gte = (_c: string, v: string) => { gte = v; return chain; };
      return chain;
    },
  };
}

function quotes(prefix: string, n: number, status: string, days: number, total = 1000): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`, status, total, currency: 'GBP', decided_at: ago(days),
  }));
}

function detector(client: unknown) {
  const d = new ConvQuoteAcceptanceDropDetector(client as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('ConvQuoteAcceptanceDropDetector', () => {
  it('reports a real fall in the share accepted', async () => {
    // Earlier quarter: 8 of 10 accepted (80%). Recent: 2 of 10 (20%).
    const d = detector(mockSupabase([
      ...quotes('old-yes', 8, 'accepted', 150),
      ...quotes('old-no', 2, 'declined', 150),
      ...quotes('new-yes', 2, 'accepted', 30),
      ...quotes('new-no', 8, 'declined', 30),
    ]));

    const result = await d.evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.processParameters!.rate_baseline).toBe(80);
    expect(result!.processParameters!.rate_recent).toBe(20);
    expect(result!.processParameters!.drop_points).toBe(60);
    // Impact is what the 8 declined quotes were worth, measured — never the
    // rate difference modelled onto some projected volume.
    expect(result!.estimatedImpactUsd).toBe(8000);
  });

  it('counts an expired quote as a no', async () => {
    /*
     * A quote that ran out is a decision nobody said out loud. Excluding it
     * would let a business whose quotes all quietly lapse report a perfect
     * acceptance rate.
     */
    const d = detector(mockSupabase([
      ...quotes('old-yes', 8, 'accepted', 150),
      ...quotes('old-no', 2, 'declined', 150),
      ...quotes('new-yes', 2, 'accepted', 30),
      ...quotes('new-exp', 8, 'expired', 30),
    ]));

    const result = await d.evaluate('user-1');
    expect(result!.processParameters!.rate_recent).toBe(20);
  });

  it('ignores quotes still waiting for an answer', async () => {
    /*
     * `sent` and `viewed` are in play. Counting them as failures would make
     * every busy month look like a collapse, because the newest quotes have
     * had the least time to come back.
     */
    const d = detector(mockSupabase([
      ...quotes('old-yes', 8, 'accepted', 150),
      ...quotes('old-no', 2, 'declined', 150),
      ...quotes('new-yes', 4, 'accepted', 30),
      ...quotes('new-open', 20, 'sent', 30),
      ...quotes('new-seen', 20, 'viewed', 30),
    ]));

    // 4 of 4 answered = 100%, which is a rise, so nothing is reported.
    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('ignores quotes the owner withdrew or replaced', async () => {
    // A superseded quote is usually a re-quote of the same job. Counting it
    // against the business would penalise negotiating.
    const d = detector(mockSupabase([
      ...quotes('old-yes', 8, 'accepted', 150),
      ...quotes('old-no', 2, 'declined', 150),
      ...quotes('new-yes', 3, 'accepted', 30),
      ...quotes('new-sup', 10, 'superseded', 30),
      ...quotes('new-wd', 10, 'withdrawn', 30),
    ]));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent when the earlier quarter has too few answers', async () => {
    // Three decisions is not a rate: one client changing their mind moves it
    // by a third.
    const d = detector(mockSupabase([
      ...quotes('old-yes', 3, 'accepted', 150),
      ...quotes('new-no', 5, 'declined', 30),
    ]));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent when the recent quarter has no answers at all', async () => {
    // No answers is a fall in VOLUME, which is a different finding and not
    // this one's to report.
    const d = detector(mockSupabase([
      ...quotes('old-yes', 8, 'accepted', 150),
      ...quotes('old-no', 2, 'declined', 150),
    ]));

    expect(await d.evaluate('user-1')).toBeNull();
  });

  it('stays silent for a wobble rather than a fall', async () => {
    // 80% to 70%: ten points, inside normal variation for a small business.
    const d = detector(mockSupabase([
      ...quotes('old-yes', 8, 'accepted', 150),
      ...quotes('old-no', 2, 'declined', 150),
      ...quotes('new-yes', 7, 'accepted', 30),
      ...quotes('new-no', 3, 'declined', 30),
    ]));

    expect(await d.evaluate('user-1')).toBeNull();
  });
});
