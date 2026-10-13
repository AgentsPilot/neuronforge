/**
 * The website conversion rate counts the right people on both sides of the slash.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `acq_low_conversion` divided leads by visitors and got both halves wrong, in
 * opposite directions at once:
 *
 *   numerator    `source = 'website_form'` only, so a visitor who BOOKED off
 *                the page counted as one who did nothing. Three production
 *                routes write `website_booking` against one that writes
 *                `website_form`.
 *
 *   denominator  one arbitrary subdomain (`.limit(1).single()` with no order
 *                by), including the owner's own visits, keyed on `ip_hash`
 *                alone.
 *
 * Because the errors pushed opposite ways the rate had no consistent sign, so
 * the 2% benchmark was not merely miscalibrated: there was no threshold that
 * could have been right. A site converting well through bookings reported
 * `critical` with a money figure attached, once a week, forever.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS TESTED HERE
 *
 * The visitor count, behaviourally, because it is the half with real rules in
 * it — owner views, identity, scope. The numerator and the zero-missed guard
 * are pinned in `websiteConversionSources.guard`, where a source filter and an
 * early return are properties of the source rather than of a return value.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { BaseDetector } from '@/lib/business-os/insight/detectors/catalog/BaseDetector';
import type { DetectorDefinition, DetectionResult } from '@/lib/business-os/insight/detectors/types';

type ViewRow = {
  session_id?: string | null;
  ip_hash?: string | null;
  is_owner_view?: boolean | null;
};

/** Records the filters applied, so scope can be asserted and not assumed. */
interface Applied {
  table: string;
  eq: Record<string, unknown>;
  limit: number | null;
}

function fakeSupabase(views: ViewRow[], applied: Applied[]) {
  return {
    from(table: string) {
      const record: Applied = { table, eq: {}, limit: null };
      applied.push(record);

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          record.eq[column] = value;
          return builder;
        },
        gte: () => builder,
        // The terminal call in the chain under test resolves the rows.
        limit: (n: number) => {
          record.limit = n;
          return Promise.resolve({ data: views, error: null });
        },
      };
      return builder;
    },
  };
}

/** `resolveUniqueVisitors` is protected; a subclass is how a test reaches it. */
class Probe extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'probe',
    name: 'probe',
    category: 'acquisition',
    description: 'test harness',
    watchedMetrics: [],
    documentsEventTypes: [],
    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'below',
    minSamples: 0,
    severityFn: () => 'low',
    eligibleForAutomation: false,
    cooldownHours: 0,
  } as unknown as DetectorDefinition;

  async evaluate(): Promise<DetectionResult | null> {
    return null;
  }

  count(userId: string) {
    return this.resolveUniqueVisitors(userId);
  }
}

const countWith = async (views: ViewRow[]) => {
  const applied: Applied[] = [];
  const probe = new Probe(fakeSupabase(views, applied) as never);
  return { visitors: await probe.count('user-1'), applied };
};

describe('the owner is not one of their own visitors', () => {
  it('excludes owner views', async () => {
    /*
     * The biggest source of fake traffic on a young account is the person who
     * just published the site looking at it. `BaseDetector` had already been
     * fixed once for reporting "one owner reloading their own site twenty
     * times as twenty visitors"; this detector kept its own query and kept the
     * bug.
     */
    const { visitors } = await countWith([
      { session_id: 'owner', is_owner_view: true },
      { session_id: 'owner', is_owner_view: true },
      { session_id: 'real-1', is_owner_view: false },
    ]);

    expect(visitors).toBe(1);
  });

  it('keeps a visit whose owner flag was never set', async () => {
    /*
     * The column is nullable, and `.eq('is_owner_view', false)` drops NULL rows
     * in Postgres — so the obvious filter discards real visits recorded before
     * the flag existed. The check is `=== true` for exactly that reason.
     */
    const { visitors } = await countWith([
      { session_id: 'a', is_owner_view: null },
      { session_id: 'b' },
    ]);

    expect(visitors).toBe(2);
  });
});

describe('a visitor is a person, not a page view', () => {
  it('counts one person behind many views', async () => {
    const { visitors } = await countWith([
      { session_id: 's1' },
      { session_id: 's1' },
      { session_id: 's1' },
    ]);

    expect(visitors).toBe(1);
  });

  it('prefers the session over the IP, so an office is not one person', async () => {
    /*
     * Everyone behind one NAT shares an `ip_hash`. Keyed on that alone, a
     * practice whose whole staff opened the site is one visitor, and so is a
     * street of people on the same mobile gateway.
     */
    const { visitors } = await countWith([
      { session_id: 's1', ip_hash: 'office' },
      { session_id: 's2', ip_hash: 'office' },
      { session_id: 's3', ip_hash: 'office' },
    ]);

    expect(visitors).toBe(3);
  });

  it('counts identity-less rows one by one rather than collapsing them', async () => {
    /*
     * A Set collapses every null to a single entry, so all the anonymous rows
     * became one visitor. Two unidentified visits are more likely two people
     * than one.
     */
    const { visitors } = await countWith([
      { session_id: null, ip_hash: null },
      { session_id: null, ip_hash: null },
    ]);

    expect(visitors).toBe(2);
  });

  it('falls back to the IP when there is no session', async () => {
    const { visitors } = await countWith([
      { ip_hash: 'ip-1' },
      { ip_hash: 'ip-1' },
      { ip_hash: 'ip-2' },
    ]);

    expect(visitors).toBe(2);
  });
});

describe('scope and bounds', () => {
  it('scopes by account, not by subdomain', async () => {
    /*
     * An account can own several subdomains, so one of them is not the site.
     * The previous query filtered on subdomain alone, which also scoped the
     * read by a name a different account could later hold.
     */
    const { applied } = await countWith([{ session_id: 's1' }]);
    const read = applied.find(a => a.table === 'website_page_views');

    expect(read?.eq.user_id).toBe('user-1');
    expect(read?.eq.subdomain).toBeUndefined();
  });

  it('bounds the read explicitly', async () => {
    /*
     * PostgREST caps an unbounded select and says nothing, which would stop
     * the count at the cap on exactly the busy sites where it matters.
     */
    const { applied } = await countWith([{ session_id: 's1' }]);

    expect(applied.find(a => a.table === 'website_page_views')?.limit).toBeGreaterThan(1000);
  });
});

describe('no traffic and no answer are different', () => {
  it('reports zero for a site nobody visited', async () => {
    const { visitors } = await countWith([]);

    expect(visitors).toBe(0);
  });

  it('reports null when the read fails, so nothing divides by a guess', async () => {
    const broken = {
      from() {
        throw new Error('network');
      },
    };
    const probe = new Probe(broken as never);

    expect(await probe.count('user-1')).toBeNull();
  });
});
