/**
 * A service has to be booked enough times before it can be called behind.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS.
 *
 * The detector compared RAW BOOKING VOLUME between services with `bookings > 0`
 * as its only floor, and flagged anything under 20% of the busiest one. So a
 * service booked once was judged against one booked forty times, and reported
 * to the owner as underperforming. One booking is not a sample — the same class
 * of error as the 275% refund rate, which came from a ratio taken on numbers
 * too small to carry it.
 *
 * Two more faults travelled with it, both pinned here:
 *
 *   - services with ZERO bookings were folded into the underperformer list, so
 *     a service created yesterday was reported as failing;
 *   - the money was invented. `(average bookings - this service's) x price`
 *     presumes she wants every service to sell equally.
 *
 * `minSamples: 10` gated only the TOTAL booking count, which is why none of it
 * was caught.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { OpsServicePerformanceDetector } from '../OpsServicePerformanceDetector';
import { MIN_PER_SEGMENT } from '../../../patterns/segmentRate';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

interface Row {
  [k: string]: unknown;
}

function mockSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'limit', 'neq']) {
        chain[m] = () => chain;
      }
      return chain;
    },
  };
}

/** A service the owner offers. Durations keep the revenue-per-hour block fed. */
function service(id: string, price = 100): Row {
  return { id, service_name: `Service ${id}`, price: String(price), duration_minutes: 60 };
}

/** `n` completed bookings against `serviceId`. */
function bookings(serviceId: string, n: number, amount = 100): Row[] {
  return Array.from({ length: n }, () => ({
    service_id: serviceId,
    payment_amount: String(amount),
    status: 'completed',
  }));
}

function detector(tables: Record<string, Row[]>) {
  const d = new OpsServicePerformanceDetector(mockSupabase(tables) as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('the per-service floor', () => {
  it('never names a service booked too few times to judge', async () => {
    /*
     * THE BUG. 'rare' has one booking against 'main' with forty: under the old
     * `bookings > 0` filter it was flagged as 97% behind. There is nothing to
     * conclude from one booking, so the honest answer is no card at all.
     */
    const result = await detector({
      scheduling_services: [service('main'), service('rare')],
      scheduling_bookings: [...bookings('main', 40), ...bookings('rare', 1)],
    }).evaluate('user-1');

    expect(result).toBeNull();
  });

  it('still reports a service that is behind AND booked enough to say so', async () => {
    // 'side' clears the floor and sits far under 20% of 'main'. A real finding.
    const result = await detector({
      scheduling_services: [service('main'), service('side')],
      scheduling_bookings: [...bookings('main', 60), ...bookings('side', MIN_PER_SEGMENT)],
    }).evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result?.affectedEntityIds).toEqual(['side']);
  });

  it('leaves a service nobody has booked out of the list entirely', async () => {
    /*
     * A service created yesterday is not underperforming, it is new. "Nobody
     * has booked this" is a different card and is not written here.
     */
    const result = await detector({
      scheduling_services: [service('main'), service('side'), service('brand-new')],
      scheduling_bookings: [...bookings('main', 60), ...bookings('side', MIN_PER_SEGMENT)],
    }).evaluate('user-1');

    expect(result?.affectedEntityIds).not.toContain('brand-new');
    expect(result?.processParameters?.services_never_booked).toBe(1);
  });

  it('reports what it left out, so the owner can reconcile the count', async () => {
    // Six services, one named. Without these she cannot tell whether the other
    // four passed or were never examined.
    const result = await detector({
      scheduling_services: [
        service('main'),
        service('side'),
        service('rare-a'),
        service('rare-b'),
        service('new-a'),
        service('new-b'),
      ],
      scheduling_bookings: [
        ...bookings('main', 60),
        ...bookings('side', MIN_PER_SEGMENT),
        ...bookings('rare-a', 1),
        ...bookings('rare-b', 2),
      ],
    }).evaluate('user-1');

    expect(result?.processParameters?.services_too_few_to_judge).toBe(2);
    expect(result?.processParameters?.services_never_booked).toBe(2);
  });
});

describe('the money that was invented', () => {
  it('reports no monetary impact at all', async () => {
    /*
     * The figure was `(average bookings - this service's) x price`, shown to
     * the owner in her own currency and read as a measurement. A premium
     * service offered rarely on purpose is not losing the difference.
     */
    const result = await detector({
      scheduling_services: [service('main'), service('side', 400)],
      scheduling_bookings: [...bookings('main', 60), ...bookings('side', MIN_PER_SEGMENT, 400)],
    }).evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result?.estimatedImpactUsd).toBeUndefined();
    expect(result?.impactDirection).toBe('opportunity');
    expect(result?.processParameters).not.toHaveProperty('potential_revenue');
  });
});
