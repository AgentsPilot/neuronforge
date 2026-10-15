/**
 * One "Check provider prices" round, assembled (AI model price review slice 5;
 * SA RR-1, O-5, SC-14) and the per-source status read back from it (SC-12).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

import { ProviderOutcomesSchema, sourceStatus, type FetchRoundRow } from '../fetchOutcomes';
import { buildFetchRound, type FetchRoundInput } from '../fetchRound';
import type { FetchResult } from '../fetchSources';
import type { LineFlagContext } from '../lineFlags';

forbidRealNetwork();

const PAGE = readFileSync(join(__dirname, '..', '__fixtures__', 'openai-pricing-2026-10-14.md'), 'utf8');
const LIST = readFileSync(join(__dirname, '..', '__fixtures__', 'litellm-prices-2026-10-14.json'), 'utf8');
const NOW = '2026-10-15T09:00:00.000Z';

const ok = (text: string): FetchResult => ({ outcome: 'ok', status: 200, bytes: text.length, durationMs: 120, attempts: 1, text });
const failed = (outcome: FetchResult['outcome']): FetchResult => ({ outcome, status: null, bytes: 0, durationMs: 10000, attempts: 1 });

/** Per-token "today" prices: gpt-4o-mini matches; gpt-4o today is far below the page (large move). */
const CURRENT: Record<string, LineFlagContext['current']> = {
  'gpt-4o-mini': { input: '0.00000015', output: '0.0000006' },
  'gpt-4o': { input: '0.000001', output: '0.00001' },
};

function input(overrides: Partial<FetchRoundInput> = {}): FetchRoundInput {
  return {
    openai: ok(PAGE),
    litellm: ok(LIST),
    coverage: new Set(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-nano', 'gpt-4-turbo', 'text-embedding-3-small']),
    isInputOnly: (model) => model.startsWith('text-embedding-'),
    contextFor: (line) => ({
      context: {
        current: CURRENT[line.model_name] ?? {},
        fallback: {},
        conservative: {},
        inCoverage: true,
        inputOnly: line.model_name.startsWith('text-embedding-'),
      },
      snapshotFields: { current_basis: CURRENT[line.model_name] ? 'table' : 'unpriced' },
    }),
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    crossCheckSource: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    checkedOn: '2026-10-15',
    fetchedAt: NOW,
    ...overrides,
  };
}

describe('buildFetchRound', () => {
  it('happy path: pending lines with the official source, flags and the cross-check', () => {
    const round = buildFetchRound(input());
    expect(round.submitLines.map((line) => line.model_name)).toEqual(['gpt-4o', 'gpt-4o-mini', 'text-embedding-3-small']);
    const mini = round.submitLines.find((line) => line.model_name === 'gpt-4o-mini');
    expect(mini).toEqual({
      current_basis: 'table',
      kind: 'token',
      provider: 'openai',
      model_name: 'gpt-4o-mini',
      input_per_1m: '0.15',
      output_per_1m: '0.60',
      cached_input_per_1m: '0.075',
      source_url: 'https://developers.openai.com/api/docs/pricing',
      checked_on: '2026-10-15',
      flags: ['cached_input_listed'],
      cross_check_verdict: 'agrees',
      cross_check_value: 'input 0.15, cached input 0.075, output 0.6 per 1M',
      cross_check_source: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
      cross_check_fetched_at: NOW,
      cross_check_diff_pct: '0.00',
    });
    expect(round.submitLines.find((line) => line.model_name === 'gpt-4o')?.flags).toEqual(['large_move', 'cached_input_listed']);
    expect(round.problems).toEqual([]);
    expect(round.failedAnchor).toBeNull();
  });

  it('LiteLLM disagreeing on every unit never reaches a price field (MP-FR-6a; QA bug 1, mutants M07a-c)', () => {
    const list = JSON.parse(LIST) as Record<string, Record<string, unknown>>;
    list['gpt-4o-mini'] = {
      ...list['gpt-4o-mini'],
      input_cost_per_token: 1.65e-7,
      cache_read_input_token_cost: 8.25e-8,
      output_cost_per_token: 6.6e-7,
    };
    const round = buildFetchRound(input({ litellm: ok(JSON.stringify(list)) }));
    const mini = round.submitLines.find((line) => line.model_name === 'gpt-4o-mini');
    // The three prices are the page cells, exactly as written.
    expect(PAGE).toContain('| gpt-4o-mini | $0.15 | $0.075 | - | $0.60 |');
    expect(mini?.input_per_1m).toBe('0.15');
    expect(mini?.cached_input_per_1m).toBe('0.075');
    expect(mini?.output_per_1m).toBe('0.60');
    // The second list's values appear only in the cross-check fields.
    expect(mini?.cross_check_verdict).toBe('differs');
    expect(mini?.cross_check_value).toBe('input 0.165, cached input 0.0825, output 0.66 per 1M');
    expect(mini?.cross_check_diff_pct).toBe('10.00');
    expect(mini?.flags).toContain('cross_check_differs');
    const rest = Object.entries(mini ?? {}).filter(([key]) => key !== 'cross_check_value' && key !== 'cross_check_diff_pct');
    for (const leaked of ['0.165', '0.0825', '0.66']) expect(JSON.stringify(rest)).not.toContain(leaked);
  });

  it('records outcomes that pass their own strict schema, with manual providers and LiteLLM counts', () => {
    const { providerOutcomes } = buildFetchRound(input());
    expect(ProviderOutcomesSchema.safeParse(providerOutcomes).success).toBe(true);
    expect(providerOutcomes.openai).toMatchObject({ outcome: 'ok', lines_stored: 3, not_found: ['gpt-4-turbo', 'gpt-4.1-nano'] });
    expect(providerOutcomes.anthropic).toEqual({ outcome: 'manual_only' });
    expect(providerOutcomes.google).toEqual({ outcome: 'manual_only' });
    expect(providerOutcomes.kimi).toEqual({ outcome: 'manual_only' });
    expect(providerOutcomes.litellm).toMatchObject({ outcome: 'ok', agrees: 3, differs: 0, not_listed: 0, unavailable: 0 });
  });

  it('a line refused by the bounds is not stored and is listed; the others load', () => {
    const page = PAGE.replace('| gpt-4o | $2.50 |', '| gpt-4o | $2000.00 |');
    const round = buildFetchRound(input({ openai: ok(page) }));
    expect(round.submitLines.map((line) => line.model_name)).toEqual(['gpt-4o-mini', 'text-embedding-3-small']);
    expect(round.providerOutcomes.openai.refused).toEqual([{ model_name: 'gpt-4o', reason: 'refused_by_bounds' }]);
    expect(round.problems).toEqual([
      { model_name: 'gpt-4o', messages: ['The input price is above the sanity ceiling of $1000 per 1M tokens'] },
    ]);
  });

  it('OpenAI blocked: zero lines, the round still records why', () => {
    const round = buildFetchRound(input({ openai: failed('blocked') }));
    expect(round.submitLines).toEqual([]);
    expect(round.providerOutcomes.openai).toMatchObject({ outcome: 'blocked', lines_stored: 0, needs_manual: [], not_found: [] });
  });

  it('a changed layout: zero lines, `layout_changed`, and the anchor for the log', () => {
    const round = buildFetchRound(input({ openai: ok(PAGE.replace('### Standard pricing data', '### Standard')) }));
    expect(round.submitLines).toEqual([]);
    expect(round.providerOutcomes.openai.outcome).toBe('layout_changed');
    expect(round.failedAnchor).toBe('A1');
  });

  it('LiteLLM down: every line is `unavailable`, flagged, and still stored', () => {
    const round = buildFetchRound(input({ litellm: failed('timeout') }));
    expect(round.submitLines).toHaveLength(3);
    for (const line of round.submitLines) {
      expect(line.cross_check_verdict).toBe('unavailable');
      expect(line.flags).toContain('cross_check_unavailable');
    }
    expect(round.providerOutcomes.litellm).toMatchObject({ outcome: 'timeout', unavailable: 3 });
  });

  it('LiteLLM answers something that is not the list: `layout_changed`, lines unavailable', () => {
    const round = buildFetchRound(input({ litellm: ok('{"a":1}') }));
    expect(round.providerOutcomes.litellm.outcome).toBe('layout_changed');
    expect(round.submitLines.every((line) => line.cross_check_verdict === 'unavailable')).toBe(true);
  });

  it('a retiring model (LiteLLM deprecation date) carries the retiring flag', () => {
    const page = PAGE.replace('| gpt-4.1 | $2.00 | $0.50 |', '| gpt-4.1-nano | $0.10 | $0.025 |').replace('| - | $8.00 | - | - | - | - |\n| gpt-4o |', '| - | $0.40 | - | - | - | - |\n| gpt-4o |');
    const round = buildFetchRound(input({ openai: ok(page) }));
    expect(round.submitLines.find((line) => line.model_name === 'gpt-4.1-nano')?.flags).toContain('retiring');
  });

  it('lists are capped at 50 entries', () => {
    const coverage = new Set(Array.from({ length: 80 }, (_unused, index) => `missing-model-${index}`));
    const round = buildFetchRound(input({ coverage }));
    expect(round.providerOutcomes.openai.not_found).toHaveLength(50);
  });
});

describe('sourceStatus (SC-12)', () => {
  const stored = (created_at: string, openai: string, litellm: string): FetchRoundRow => {
    const { providerOutcomes } = buildFetchRound(input({ openai: openai === 'ok' ? ok(PAGE) : failed(openai as FetchResult['outcome']), litellm: litellm === 'ok' ? ok(LIST) : failed(litellm as FetchResult['outcome']) }));
    return { id: created_at, created_at, provider_outcomes: providerOutcomes };
  };

  it('the last run, the last success and the last failure, with counts', () => {
    const latest = stored('2026-10-15T09:00:00.000Z', 'blocked', 'ok');
    const lastOk = stored('2026-10-14T09:00:00.000Z', 'ok', 'ok');
    expect(sourceStatus('openai', latest, lastOk, latest)).toEqual({
      lastRun: { outcome: 'blocked', at: '2026-10-15T09:00:00.000Z' },
      lastOkAt: '2026-10-14T09:00:00.000Z',
      lastFailure: { outcome: 'blocked', at: '2026-10-15T09:00:00.000Z' },
      lastRunCounts: { linesStored: 0, needsManual: 0, notFound: 0, refused: 0 },
      lastRunVerdicts: null,
    });
    expect(sourceStatus('litellm', latest, latest, null)).toMatchObject({
      lastRun: { outcome: 'ok' },
      lastFailure: null,
      lastRunCounts: null,
      lastRunVerdicts: { agrees: 0, differs: 0, notListed: 0, unavailable: 0 },
    });
  });

  it('nothing yet; and an unreadable stored record reads "unknown"', () => {
    expect(sourceStatus('openai', null, null, null)).toEqual({ lastRun: null, lastOkAt: null, lastFailure: null, lastRunCounts: null, lastRunVerdicts: null });
    const odd: FetchRoundRow = { id: 'x', created_at: NOW, provider_outcomes: { openai: { outcome: 'ok', page: 'text' } } };
    expect(sourceStatus('openai', odd, null, null).lastRun).toEqual({ outcome: 'unknown', at: NOW });
  });
});
