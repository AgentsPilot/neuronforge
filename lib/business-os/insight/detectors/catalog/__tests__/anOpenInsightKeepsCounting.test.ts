/**
 * A card on the dashboard keeps counting; a card that was closed stays quiet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED 2026-11-15, on a live account.
 *
 * The advisor read "4 Refunds in 30 Days, 36.4% Rate - Critical Issue" while
 * the account had SEVEN refunds of seventeen payments. Both figures had been
 * right on 13 November, when the insight was raised, and nothing had corrected
 * them since. The same row had been shown sixty times.
 *
 * The cooldown is what froze it, and it could never have expired. It was
 * measured from `last_surfaced_at`, the column stamped every time the dashboard
 * LISTS an insight, so every page load pushed the window another week out. The
 * detector returned null before computing anything, and the branch of
 * `createInsight` that refreshes an open row's figures — and rewrites its
 * headline when a quoted number moves — was never reached.
 *
 * Looking at the card was what stopped it being corrected.
 *
 * Two rules follow, and this file is both of them:
 *
 *   · an OPEN insight is never on cooldown. The question the cooldown asks is
 *     "may I raise this again", and a finding on the owner's screen is not
 *     being raised — it is being kept true;
 *   · the window is measured from `detected_at`. How recently a finding was
 *     made is a fact about the finding, not about who has looked at it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { BaseDetector } from '../BaseDetector';
import type { DetectorDefinition, DetectionResult } from '../../types';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

/** The row `isOnCooldown` reads, or null for "this detector never fired here". */
type StoredRow = {
  status?: string | null;
  detected_at?: string | null;
  created_at?: string | null;
  /* Present so a test can prove it is NOT consulted. */
  last_surfaced_at?: string | null;
} | null;

/**
 * Supabase, reduced to the one query this method makes.
 *
 * The chain is asserted as well as answered: a future edit that reads a
 * different table, drops the user scope, or orders by the surfacing stamp again
 * fails here rather than passing on a stub that says yes to everything.
 */
function stubSupabase(row: StoredRow) {
  const calls = { from: '', eqs: [] as Array<[string, unknown]>, select: '', orderBy: '' };

  const builder = {
    select(columns: string) {
      calls.select = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.eqs.push([column, value]);
      return builder;
    },
    order(column: string) {
      calls.orderBy = column;
      return builder;
    },
    limit() {
      return builder;
    },
    async single() {
      return { data: row, error: null };
    },
  };

  return {
    client: {
      from(table: string) {
        calls.from = table;
        return builder;
      },
    } as never,
    calls,
  };
}

class CooldownDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'test_cooldown_detector',
    name: 'Test',
    category: 'cash_flow',
    description: 'Exercises the cooldown rule',
    watchedMetrics: ['cashflow.ar_total'],
    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    minSamples: 1,
    severityFn: () => 'medium',
    eligibleForAutomation: false,
    /* A week, as the refund detector carries. */
    cooldownHours: 168,
  };

  async evaluate(): Promise<DetectionResult | null> {
    return null;
  }

  /** Exposes the protected check so the rule can be exercised directly. */
  ask(): Promise<boolean> {
    return this.isOnCooldown('user-1');
  }
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
const now = () => new Date().toISOString();

function detectorFor(row: StoredRow) {
  const { client, calls } = stubSupabase(row);
  return { detector: new CooldownDetector(client), calls };
}

describe('an insight still on the dashboard', () => {
  it.each(['new', 'viewed'])('is never on cooldown (%s), so its figures can be refreshed', async (status) => {
    const { detector } = detectorFor({ status, detected_at: hoursAgo(1) });

    expect(await detector.ask()).toBe(false);
  });

  it('and the engine is not told it was silenced — it was not', async () => {
    /* `consumeCooldownSkip` is what protects an open insight from the stale
       sweep. A detector that evaluated normally must not claim it. */
    const { detector } = detectorFor({ status: 'viewed', detected_at: hoursAgo(1) });

    await detector.ask();

    expect(detector.consumeCooldownSkip()).toBe(false);
  });
});

describe('an insight that was closed', () => {
  it('holds the detector off inside the window', async () => {
    const { detector } = detectorFor({ status: 'dismissed', detected_at: hoursAgo(1) });

    expect(await detector.ask()).toBe(true);
  });

  it('and tells the engine, so the sweep leaves its row alone', async () => {
    const { detector } = detectorFor({ status: 'dismissed', detected_at: hoursAgo(1) });

    await detector.ask();

    expect(detector.consumeCooldownSkip()).toBe(true);
  });

  it('lets it speak again once the window has passed', async () => {
    const { detector } = detectorFor({ status: 'resolved', detected_at: hoursAgo(24 * 9) });

    expect(await detector.ask()).toBe(false);
  });
});

describe('the bug itself: being looked at must not postpone the next count', () => {
  it('a closed insight detected nine days ago is OUT of cooldown however recently it was shown', async () => {
    /*
     * This is the assertion that fails on the old code. `last_surfaced_at` is
     * now, so the old anchor put the window six days into the future for a
     * finding made nine days ago.
     */
    const { detector } = detectorFor({
      status: 'dismissed',
      detected_at: hoursAgo(24 * 9),
      last_surfaced_at: now(),
    });

    expect(await detector.ask()).toBe(false);
  });

  it('and the surfacing stamp is not even read', async () => {
    const { detector, calls } = detectorFor({ status: 'dismissed', detected_at: hoursAgo(1) });

    await detector.ask();

    expect(calls.select).not.toContain('last_surfaced_at');
    expect(calls.orderBy).toBe('detected_at');
  });
});

describe('what it must never do: hold a detector off on a fact it does not have', () => {
  it('no insight at all is not a cooldown', async () => {
    const { detector } = detectorFor(null);

    expect(await detector.ask()).toBe(false);
  });

  it('a closed row with no date is not a cooldown', async () => {
    const { detector } = detectorFor({ status: 'dismissed', detected_at: null, created_at: null });

    expect(await detector.ask()).toBe(false);
  });

  it('an unreadable date is not a cooldown', async () => {
    const { detector } = detectorFor({ status: 'dismissed', detected_at: 'not a date' });

    expect(await detector.ask()).toBe(false);
  });

  it('falls back to created_at for a row written before detected_at was set', async () => {
    const { detector } = detectorFor({ status: 'dismissed', detected_at: null, created_at: hoursAgo(1) });

    expect(await detector.ask()).toBe(true);
  });
});

describe('the query stays scoped', () => {
  it('reads this user and this detector, from insights', async () => {
    /* `.eq('user_id', …)` is not decoration here: detectors run under the
       service role, so an unscoped read is a cross-tenant read. */
    const { detector, calls } = detectorFor({ status: 'dismissed', detected_at: hoursAgo(1) });

    await detector.ask();

    expect(calls.from).toBe('insights');
    expect(calls.eqs).toEqual([
      ['user_id', 'user-1'],
      ['detector_id', 'test_cooldown_detector'],
    ]);
  });
});
