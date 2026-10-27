/**
 * The rate sync contract (Admin Exchange Rates slice 1e; SA §13.7 SA-1e-4,
 * §13.8 SQ-49, SQ-51, SQ-52): the empty strict body, the outcome sentences,
 * the direction words, the source constants and `lastSyncFromSync`. Slice 1f
 * (SA §13.9 SQ-54, SQ-55): `labelLastSync` and the viewer as the checker.
 */

import {
  ECB_SOURCE_LABEL,
  ECB_SOURCE_NOTE,
  ECB_SOURCE_PAGE_URL,
  GAP_DIRECTION_WORDS,
  SYNC_OUTCOME_TEXT,
  SYNC_SOURCE_LABEL,
  labelLastSync,
  lastSyncFromSync,
  syncBodySchema,
  syncOutcomeText,
  type ExchangeRateSyncPayload,
  type LastRateSyncRecord,
  type RateSyncOutcome,
} from '../rateSyncRules';

describe('syncBodySchema (SQ-39: the sync takes no input)', () => {
  it('accepts an empty object', () => {
    expect(syncBodySchema.safeParse({}).success).toBe(true);
  });

  it.each([
    ['a URL', { url: 'https://example.com/rates.xml' }],
    ['a currency list', { currencies: ['ILS'] }],
    ['a rate', { rate: '3.7' }],
    ['a source', { source: 'frankfurter' }],
  ])('refuses %s', (_name, body) => {
    expect(syncBodySchema.safeParse(body).success).toBe(false);
  });

  it.each([null, [], 'x', 1])('refuses a non-object %j', (body) => {
    expect(syncBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('copy', () => {
  it('the source label is ECB', () => {
    expect(SYNC_SOURCE_LABEL).toBe('ECB');
  });

  it.each(['timeout', 'network_error', 'blocked', 'layout_changed', 'too_large'] as const)(
    '%s has its own sentence, and it says no rate was changed',
    (outcome) => {
      expect(syncOutcomeText(outcome)).toBe(SYNC_OUTCOME_TEXT[outcome]);
      expect(syncOutcomeText(outcome)).toMatch(/No rate was changed\./);
    }
  );

  it('the failure sentences are all different', () => {
    const failures = ['timeout', 'network_error', 'blocked', 'layout_changed', 'too_large'] as const;
    expect(new Set(failures.map((outcome) => SYNC_OUTCOME_TEXT[outcome])).size).toBe(failures.length);
  });

  it('every http_* outcome shares one sentence naming the status', () => {
    expect(syncOutcomeText('http_404')).toBe('The ECB answered with HTTP status 404. No rate was changed.');
    expect(syncOutcomeText('http_500')).toBe('The ECB answered with HTTP status 500. No rate was changed.');
    expect(syncOutcomeText('http_301')).toContain('301');
  });

  it('the direction words are the §5.7.5 words (BQ-2)', () => {
    expect(GAP_DIRECTION_WORDS).toEqual({
      up: 'Rate up: currency weaker, we are behind',
      down: 'Rate down: currency stronger, in our favour',
      none: 'No change',
    });
  });
});

describe('the source constants (SQ-49)', () => {
  it('have their exact values', () => {
    expect(ECB_SOURCE_LABEL).toBe('European Central Bank (euro foreign exchange reference rates)');
    expect(ECB_SOURCE_PAGE_URL).toBe(
      'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html'
    );
    expect(ECB_SOURCE_NOTE).toBe('Published by the ECB for information only.');
  });

  it('the page URL is the human page, never the XML feed', () => {
    expect(ECB_SOURCE_PAGE_URL).not.toMatch(/eurofxref|[.]xml$/);
  });
});

const ANNA = 'aaaaaaaa-1111-4111-8111-111111111111';
const VIEWER = { userId: ANNA, label: 'Anna Admin' };

describe('lastSyncFromSync (SQ-51 (5))', () => {
  const answer = (outcome: RateSyncOutcome, rateDate: string | null): ExchangeRateSyncPayload => ({
    source: 'ECB',
    outcome,
    rateDate,
    fetchedAt: '2026-10-25T09:14:03.000Z',
    suggestions: [],
  });

  it('ok → the fetch time and the feed rate date', () => {
    expect(lastSyncFromSync(answer('ok', '2026-10-23'), VIEWER)).toEqual({
      status: 'ok',
      checkedAt: '2026-10-25T09:14:03.000Z',
      rateDate: '2026-10-23',
      checkedBy: ANNA,
      checkedByLabel: 'Anna Admin',
    });
  });

  it.each(['timeout', 'network_error', 'blocked', 'layout_changed', 'too_large', 'http_500', 'http_301'] as const)(
    '%s → null (the tile stays as it was)',
    (outcome) => {
      expect(lastSyncFromSync(answer(outcome, null), VIEWER)).toBeNull();
    }
  );

  it('an ok without a rate date → null (never a half value)', () => {
    expect(lastSyncFromSync(answer('ok', null), VIEWER)).toBeNull();
  });
});

describe("lastSyncFromSync: the viewer is the checker (slice 1f, SQ-55 (a'))", () => {
  const ok: ExchangeRateSyncPayload = {
    source: 'ECB',
    outcome: 'ok',
    rateDate: '2026-10-23',
    fetchedAt: '2026-10-25T09:14:03.000Z',
    suggestions: [],
  };

  it('a viewer with a label → its id and label', () => {
    expect(lastSyncFromSync(ok, VIEWER)).toMatchObject({ checkedBy: ANNA, checkedByLabel: 'Anna Admin' });
  });

  it('a viewer whose label is null (the lookup failed) → the id, no label (the page shows the short id)', () => {
    expect(lastSyncFromSync(ok, { userId: ANNA, label: null })).toMatchObject({ checkedBy: ANNA, checkedByLabel: null });
  });

  it('no viewer → both null ("Unknown user")', () => {
    expect(lastSyncFromSync(ok, null)).toMatchObject({ checkedBy: null, checkedByLabel: null });
  });
});

describe('labelLastSync (slice 1f, SQ-54)', () => {
  const lookup = {
    status: 'ok',
    names: new Map([[ANNA, 'Anna Admin']]),
    emails: new Map([[ANNA, 'anna@example.com']]),
  } as const;
  const record: LastRateSyncRecord = {
    status: 'ok',
    checkedAt: '2026-10-25T09:14:03.000Z',
    rateDate: '2026-10-23',
    checkedBy: ANNA,
  };

  it('ok → the record with its label', () => {
    expect(labelLastSync(record, lookup)).toEqual({ ...record, checkedByLabel: 'Anna Admin' });
  });

  it('none and unavailable pass through untouched', () => {
    expect(labelLastSync({ status: 'none' }, lookup)).toEqual({ status: 'none' });
    expect(labelLastSync({ status: 'unavailable' }, { status: 'failed' })).toEqual({ status: 'unavailable' });
  });

  it('a failed lookup → the actor kept, the label null', () => {
    expect(labelLastSync(record, { status: 'failed' })).toEqual({ ...record, checkedByLabel: null });
  });

  it('a null actor → "Unknown user", even when the lookup failed', () => {
    const noActor: LastRateSyncRecord = { ...record, checkedBy: null };
    expect(labelLastSync(noActor, lookup)).toEqual({ ...noActor, checkedByLabel: 'Unknown user' });
    expect(labelLastSync(noActor, { status: 'failed' })).toEqual({ ...noActor, checkedByLabel: 'Unknown user' });
  });
});
