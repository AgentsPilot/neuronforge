/**
 * Fetch round outcomes after slice 10 (AI model price review; SA SC10-2,
 * SC10-3, SC10-7): a write schema that never accepts Anthropic `manual_only`,
 * a read schema that still reads every round stored before slice 10, and a
 * registry that cannot drift from the fetch mode table.
 */

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import {
  ADAPTER_PROVIDERS,
  PROVIDER_FETCH_MODE,
  ProviderOutcomesSchema,
  StoredProviderOutcomesSchema,
  manualProviders,
  sourceStatus,
  type FetchRoundRow,
} from '../fetchOutcomes';
import { PRICE_PAGE_URLS, PRICE_SOURCES } from '../fetchSources';
import { PRICE_ADAPTERS } from '../priceAdapters';

forbidRealNetwork();

const AT = '2026-10-15T09:00:00.000Z';
const adapter = (outcome: string, linesStored = 0) => ({
  outcome,
  fetched_at: AT,
  duration_ms: 100,
  bytes: 10,
  lines_stored: linesStored,
  needs_manual: [],
  not_found: [],
  refused: [],
  name_notes: [],
});
const litellm = { outcome: 'ok', fetched_at: AT, duration_ms: 1, bytes: 1, agrees: 1, differs: 0, not_listed: 0, unavailable: 0 };

/** A round exactly as slice 5 stored it (production has none yet, but the read must hold). */
const OLD_ROUND = {
  openai: adapter('ok', 24),
  anthropic: { outcome: 'manual_only' },
  google: { outcome: 'manual_only' },
  kimi: { outcome: 'manual_only' },
  litellm,
};
const NEW_ROUND = { ...OLD_ROUND, anthropic: adapter('ok', 8) };
const row = (created_at: string, provider_outcomes: unknown): FetchRoundRow => ({ id: created_at, created_at, provider_outcomes });

describe('write and read schemas (SC10-2)', () => {
  it('an old round reads with the read schema, and the write schema refuses it', () => {
    expect(StoredProviderOutcomesSchema.safeParse(OLD_ROUND).success).toBe(true);
    expect(ProviderOutcomesSchema.safeParse(OLD_ROUND).success).toBe(false);
  });

  it('a new round passes both', () => {
    expect(ProviderOutcomesSchema.safeParse(NEW_ROUND).success).toBe(true);
    expect(StoredProviderOutcomesSchema.safeParse(NEW_ROUND).success).toBe(true);
  });

  it('both stay strict: no extra key, no Google adapter outcome, no page text', () => {
    for (const schema of [ProviderOutcomesSchema, StoredProviderOutcomesSchema]) {
      expect(schema.safeParse({ ...NEW_ROUND, extra: 1 }).success).toBe(false);
      expect(schema.safeParse({ ...NEW_ROUND, google: adapter('ok') }).success).toBe(false);
      expect(schema.safeParse({ ...NEW_ROUND, anthropic: { ...adapter('ok'), page: 'text' } }).success).toBe(false);
    }
  });
});

describe('Anthropic status from an old round (SC10-3)', () => {
  it('the latest round predates slice 10: "not checked yet", no counts, never a failure', () => {
    const old = row(AT, OLD_ROUND);
    expect(sourceStatus('anthropic', old, null, null)).toEqual({
      lastRun: null,
      lastOkAt: null,
      lastFailure: null,
      lastRunCounts: null,
      lastRunVerdicts: null,
    });
    // Even if an old round reached the failure slot, it is not shown as one.
    expect(sourceStatus('anthropic', old, null, old).lastFailure).toBeNull();
    // OpenAI in the same old round reads as before.
    expect(sourceStatus('openai', old, old, null)).toMatchObject({ lastRun: { outcome: 'ok', at: AT }, lastRunCounts: { linesStored: 24 } });
  });

  it('a new round: Anthropic run, counts, success and failure', () => {
    const okRound = row('2026-10-14T09:00:00.000Z', NEW_ROUND);
    const failedRound = row(AT, { ...NEW_ROUND, anthropic: adapter('blocked') });
    expect(sourceStatus('anthropic', failedRound, okRound, failedRound)).toEqual({
      lastRun: { outcome: 'blocked', at: AT },
      lastOkAt: '2026-10-14T09:00:00.000Z',
      lastFailure: { outcome: 'blocked', at: AT },
      lastRunCounts: { linesStored: 0, needsManual: 0, notFound: 0, refused: 0 },
      lastRunVerdicts: null,
    });
    expect(sourceStatus('anthropic', okRound, okRound, null).lastRunCounts).toEqual({ linesStored: 8, needsManual: 0, notFound: 0, refused: 0 });
  });

  it('an unreadable record still reads "unknown"', () => {
    expect(sourceStatus('anthropic', row(AT, { anthropic: { outcome: 'ok' } }), null, null).lastRun).toEqual({ outcome: 'unknown', at: AT });
  });
});

describe('registry, sources and mode cannot drift (SC10-7)', () => {
  type Provider = keyof typeof PROVIDER_FETCH_MODE;
  const byMode = (mode: 'adapter' | 'manual') =>
    (Object.keys(PROVIDER_FETCH_MODE) as Provider[]).filter((provider) => PROVIDER_FETCH_MODE[provider] === mode).sort();

  it('every adapter provider has a parser, a fetched source and a page URL; no manual one has', () => {
    expect(byMode('adapter')).toEqual(['anthropic', 'openai']);
    expect([...ADAPTER_PROVIDERS].sort()).toEqual(byMode('adapter'));
    expect(Object.keys(PRICE_ADAPTERS).sort()).toEqual(byMode('adapter'));
    expect(Object.keys(PRICE_PAGE_URLS).sort()).toEqual(byMode('adapter'));
    expect(Object.keys(PRICE_SOURCES).sort()).toEqual([...byMode('adapter'), 'litellm'].sort());
    for (const manual of byMode('manual')) {
      expect(Object.prototype.hasOwnProperty.call(PRICE_ADAPTERS, manual)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(PRICE_SOURCES, manual)).toBe(false);
    }
  });

  it('manual providers are Google and Kimi', () => {
    expect(manualProviders()).toEqual(['google', 'kimi']);
  });
});
