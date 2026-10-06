/**
 * Why quotes are turned down.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The judgement about whether a tally is a pattern is tested on its own in
 * `patterns/__tests__/dominantReason.test.ts`. These cover what this detector
 * adds on top of it: the right rows, the right grouping, the cross-tab that
 * makes the finding actionable, and the money figure it deliberately refuses
 * to report.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { ConvDeclineReasonDetector } from '../ConvDeclineReasonDetector';

interface Fixture {
  proposals?: Record<string, unknown>[];
  proposalsError?: Error;
}

function client(fixture: Fixture) {
  const table = (rows: Record<string, unknown>[], error?: Error) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'not', 'limit']) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (r: unknown) => unknown) =>
      resolve(error ? { data: null, error } : { data: rows, error: null });
    return chain;
  };

  return {
    from: (name: string) =>
      name === 'proposals' ? table(fixture.proposals ?? [], fixture.proposalsError) : table([]),
  } as never;
}

const detectorFor = (fixture: Fixture) => {
  const detector = new ConvDeclineReasonDetector(client(fixture));
  jest
    .spyOn(detector as never as { isOnCooldown: () => Promise<boolean> }, 'isOnCooldown')
    .mockResolvedValue(false);
  return detector;
};

const declined = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  contact_id: 'c1',
  service_id: 'svc-package',
  title: 'הצעת מחיר לשיפוץ',
  total: 8500,
  currency: 'ILS',
  decline_reason: 'too_expensive',
  decided_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  sent_at: new Date(Date.now() - 12 * 86_400_000).toISOString(),
  ...over,
});

const U = '11111111-1111-4111-8111-111111111111';

describe('a reason most declines share', () => {
  it('is reported with the count it rests on', async () => {
    const result = await detectorFor({
      proposals: [
        declined({ id: 'p1' }),
        declined({ id: 'p2' }),
        declined({ id: 'p3' }),
        declined({ id: 'p4', decline_reason: 'timing' }),
      ],
    }).evaluate(U);

    expect(result).not.toBeNull();
    expect(result!.processParameters!.reason).toBe('client_cost');
    expect(result!.processParameters!.reason_count).toBe(3);
    expect(result!.processParameters!.declines_total).toBe(4);
  });

  it('folds equivalent spellings into one objection', async () => {
    /*
     * `too_expensive` and `client_cost` are the same objection recorded by two
     * different screens. Counted apart they split a real pattern in half and
     * the detector reports neither.
     */
    const result = await detectorFor({
      proposals: [
        declined({ id: 'p1', decline_reason: 'too_expensive' }),
        declined({ id: 'p2', decline_reason: 'client_cost' }),
        declined({ id: 'p3', decline_reason: 'too_expensive' }),
        declined({ id: 'p4', decline_reason: 'timing' }),
      ],
    }).evaluate(U);

    expect(result!.processParameters!.reason).toBe('client_cost');
    expect(result!.processParameters!.reason_count).toBe(3);
  });

  it('says nothing on two declines, however unanimous', async () => {
    const result = await detectorFor({
      proposals: [declined({ id: 'p1' }), declined({ id: 'p2' })],
    }).evaluate(U);

    expect(result).toBeNull();
  });

  it('says nothing when nobody picked a reason', async () => {
    // A business that never captures reasons must not be told its main
    // problem is "unknown".
    const result = await detectorFor({
      proposals: [1, 2, 3, 4].map(n => declined({ id: `p${n}`, decline_reason: null })),
    }).evaluate(U);

    expect(result).toBeNull();
  });

  it('says nothing at all when no quote was declined', async () => {
    expect(await detectorFor({ proposals: [] }).evaluate(U)).toBeNull();
  });
});

describe('where the objection concentrates', () => {
  it('names the service the reason belongs to', async () => {
    /*
     * The finding worth having. "Price is your top objection" names nothing to
     * change; "price objections are only on the package" names the thing.
     */
    const result = await detectorFor({
      proposals: [
        declined({ id: 'p1', service_id: 'svc-package', title: 'Package' }),
        declined({ id: 'p2', service_id: 'svc-package', title: 'Package' }),
        declined({ id: 'p3', service_id: 'svc-package', title: 'Package' }),
        declined({ id: 'p4', service_id: 'svc-session', decline_reason: 'timing' }),
        declined({ id: 'p5', service_id: 'svc-session', decline_reason: 'scope' }),
      ],
    }).evaluate(U);

    expect(result!.processParameters!.concentrated_in_service_id).toBe('svc-package');
    expect(result!.processParameters!.concentrated_reason).toBe('client_cost');
    expect(result!.processParameters!.concentrated_in_service).toBe('Package');
  });

  it('leaves the cross-tab empty when no one service holds enough', async () => {
    // Three declines across three services. The headline still stands.
    const result = await detectorFor({
      proposals: [
        declined({ id: 'p1', service_id: 'a' }),
        declined({ id: 'p2', service_id: 'b' }),
        declined({ id: 'p3', service_id: 'c' }),
      ],
    }).evaluate(U);

    expect(result).not.toBeNull();
    expect(result!.processParameters!.concentrated_in_service_id).toBeNull();
  });
});

describe('the figures it reports', () => {
  it('never puts declined work in the impact field', async () => {
    /*
     * A declined quote was never won, so no money left the business and none
     * is owed to it. Summing quoted totals into the dashboard's impact would
     * add up work the owner never had and call it a loss.
     */
    const result = await detectorFor({
      proposals: [declined({ id: 'p1' }), declined({ id: 'p2' }), declined({ id: 'p3' })],
    }).evaluate(U);

    expect(result!.estimatedImpactUsd).toBeUndefined();
    expect(result!.impactDirection).toBeUndefined();
    // The value still travels, where the copy can use it without it being summed.
    expect(result!.processParameters!.declined_value).toBe(25500);
    expect(result!.processParameters!.currency).toBe('ILS');
  });

  it('never sums two currencies', async () => {
    const result = await detectorFor({
      proposals: [
        declined({ id: 'p1', total: 100, currency: 'EUR' }),
        declined({ id: 'p2' }),
        declined({ id: 'p3' }),
      ],
    }).evaluate(U);

    expect(result!.processParameters!.declined_value).toBe(17000);
    expect(result!.processParameters!.currency).toBe('ILS');
    expect(result!.processParameters!.mixed_currency).toBe(true);
  });

  it('reports no percentage change, because nothing was compared', async () => {
    const result = await detectorFor({
      proposals: [declined({ id: 'p1' }), declined({ id: 'p2' }), declined({ id: 'p3' })],
    }).evaluate(U);

    expect(result!.percentChange).toBe(0);
    expect(result!.baselineValue).toBe(0);
  });

  it('carries how sure the sample lets it sound', async () => {
    const result = await detectorFor({
      proposals: [declined({ id: 'p1' }), declined({ id: 'p2' }), declined({ id: 'p3' })],
    }).evaluate(U);

    // Three is three, however unanimous.
    expect(result!.processParameters!.confidence).toBe('low');
  });
});
