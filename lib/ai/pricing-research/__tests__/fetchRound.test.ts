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
const ANTHROPIC_PAGE = readFileSync(join(__dirname, '..', '__fixtures__', 'anthropic-pricing-2026-10-18.md'), 'utf8');
const NOW = '2026-10-15T09:00:00.000Z';

const ok = (text: string): FetchResult => ({ outcome: 'ok', status: 200, bytes: text.length, durationMs: 120, attempts: 1, text });
const failed = (outcome: FetchResult['outcome']): FetchResult => ({ outcome, status: null, bytes: 0, durationMs: 10000, attempts: 1 });

/** Per-token "today" prices: gpt-4o-mini matches; gpt-4o today is far below the page (large move). */
const CURRENT: Record<string, LineFlagContext['current']> = {
  'gpt-4o-mini': { input: '0.00000015', output: '0.0000006' },
  'gpt-4o': { input: '0.000001', output: '0.00001' },
};

/**
 * Slice 10: the round input is per provider. This helper keeps the slice 5
 * override names (`openai`, `coverage` = OpenAI's), so the slice 5 cases below
 * are unedited; Anthropic defaults to the 2026-10-18 page with an EMPTY
 * coverage, so it adds no line and no cross-check verdict to them.
 */
interface RoundOverrides {
  openai?: FetchResult;
  anthropic?: FetchResult;
  litellm?: FetchResult;
  coverage?: ReadonlySet<string>;
  anthropicCoverage?: ReadonlySet<string>;
}

function input(overrides: RoundOverrides = {}): FetchRoundInput {
  return {
    providers: {
      openai: {
        result: overrides.openai ?? ok(PAGE),
        coverage: overrides.coverage ?? new Set(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-nano', 'gpt-4-turbo', 'text-embedding-3-small']),
        isInputOnly: (model) => model.startsWith('text-embedding-'),
        sourceUrl: 'https://developers.openai.com/api/docs/pricing',
      },
      anthropic: {
        result: overrides.anthropic ?? ok(ANTHROPIC_PAGE),
        coverage: overrides.anthropicCoverage ?? new Set(),
        isInputOnly: () => false,
        sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
      },
    },
    litellm: overrides.litellm ?? ok(LIST),
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
    crossCheckSource: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    checkedOn: '2026-10-15',
    fetchedAt: NOW,
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
    // Slice 10 deliberate edit (SC10-6): the failed anchor is per provider.
    expect(round.failedAnchors).toEqual([]);
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
    // Slice 10 deliberate edit (SC10-2): Anthropic is read by its adapter, never `manual_only` again.
    expect(providerOutcomes.anthropic).toMatchObject({ outcome: 'ok', lines_stored: 0, not_found: [] });
    expect(providerOutcomes.google).toEqual({ outcome: 'manual_only' });
    expect(providerOutcomes.kimi).toEqual({ outcome: 'manual_only' });
    expect(providerOutcomes.litellm).toMatchObject({ outcome: 'ok', agrees: 3, differs: 0, not_listed: 0, unavailable: 0 });
  });

  it('a line refused by the bounds is not stored and is listed; the others load', () => {
    const page = PAGE.replace('| gpt-4o | $2.50 |', '| gpt-4o | $2000.00 |');
    const round = buildFetchRound(input({ openai: ok(page) }));
    expect(round.submitLines.map((line) => line.model_name)).toEqual(['gpt-4o-mini', 'text-embedding-3-small']);
    expect(round.providerOutcomes.openai.refused).toEqual([{ model_name: 'gpt-4o', reason: 'refused_by_bounds' }]);
    // Slice 10 deliberate edit (SC10-8): each problem names its provider.
    expect(round.problems).toEqual([
      { provider: 'openai', model_name: 'gpt-4o', messages: ['The input price is above the sanity ceiling of $1000 per 1M tokens'] },
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
    // Slice 10 deliberate edit (SC10-6): the failed anchor is per provider.
    expect(round.failedAnchors).toEqual([{ provider: 'openai', anchor: 'A1' }]);
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

describe('slice 10: one round, both providers (SA O-4, SC10-6)', () => {
  const FRAGMENT = readFileSync(join(__dirname, '..', '__fixtures__', 'litellm-anthropic-entries-2026-10-18.json'), 'utf8');
  /** SA O-9: the Anthropic fragment merged into the slice 5 list; the slice 5 fixture stays byte-identical. */
  const MERGED = JSON.stringify({ ...JSON.parse(LIST), ...JSON.parse(FRAGMENT) });
  const ANTHROPIC_COVERAGE = new Set([
    'claude-3-5-haiku-20241022',
    'claude-3-haiku-20240307',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-1-20250805',
    'claude-opus-4-20250514',
    'claude-opus-4-5-20251101',
    'claude-opus-4-6',
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-6',
  ]);
  const both = (overrides: RoundOverrides = {}) =>
    buildFetchRound(input({ litellm: ok(MERGED), anthropicCoverage: ANTHROPIC_COVERAGE, ...overrides }));
  const providersOf = (round: ReturnType<typeof buildFetchRound>) => round.submitLines.map((line) => `${line.provider}:${line.model_name}`);

  it('the merged list still clears the LiteLLM key floor (SA O-9)', () => {
    expect(Object.keys(JSON.parse(MERGED)).length).toBeGreaterThanOrEqual(100);
  });

  it('both ok: one line set holding both providers, two adapter outcomes', () => {
    const round = both();
    expect(providersOf(round)).toEqual([
      'openai:gpt-4o',
      'openai:gpt-4o-mini',
      'openai:text-embedding-3-small',
      'anthropic:claude-haiku-4-5-20251001',
      'anthropic:claude-opus-4-1-20250805',
      'anthropic:claude-opus-4-20250514',
      'anthropic:claude-opus-4-5-20251101',
      'anthropic:claude-opus-4-6',
      'anthropic:claude-sonnet-4-20250514',
      'anthropic:claude-sonnet-4-5-20250929',
      'anthropic:claude-sonnet-4-6',
    ]);
    expect(round.providerOutcomes.openai).toMatchObject({ outcome: 'ok', lines_stored: 3 });
    expect(round.providerOutcomes.anthropic).toMatchObject({
      outcome: 'ok',
      lines_stored: 8,
      needs_manual: [],
      not_found: ['claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'],
      refused: [],
    });
    expect(round.providerOutcomes.anthropic.name_notes.map((note) => note.model_name)).toEqual([
      'claude-opus-4-1-20250805',
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
    ]);
    // 3 OpenAI + 5 Anthropic agree; the retired 4.0 / 4.1 ids are not in LiteLLM.
    expect(round.providerOutcomes.litellm).toMatchObject({ outcome: 'ok', agrees: 8, differs: 0, not_listed: 3, unavailable: 0 });
    expect(ProviderOutcomesSchema.safeParse(round.providerOutcomes).success).toBe(true);
    expect(round.failedAnchors).toEqual([]);
  });

  it('an Anthropic line: its own source page, no cached price, `cached_input_listed`, cross-checked on input and output only', () => {
    const line = both().submitLines.find((entry) => entry.model_name === 'claude-sonnet-4-6');
    expect(line).toMatchObject({
      provider: 'anthropic',
      kind: 'token',
      input_per_1m: '3',
      output_per_1m: '15',
      source_url: 'https://platform.claude.com/docs/en/about-claude/pricing',
      checked_on: '2026-10-15',
      cross_check_verdict: 'agrees',
      // LiteLLM's cache-read price is shown, never compared; its cache-write price is not read at all.
      cross_check_value: 'input 3, cached input 0.3, output 15 per 1M',
    });
    expect(line).not.toHaveProperty('cached_input_per_1m');
    expect(line?.flags).toContain('cached_input_listed');
    expect(JSON.stringify(line)).not.toContain('3.75');
  });

  it('LiteLLM deprecation date gives `retiring`; a page note never sets it (SA O-6)', () => {
    const round = both();
    expect(round.submitLines.find((line) => line.model_name === 'claude-sonnet-4-5-20250929')?.flags).toContain('retiring');
    const retiredOnPage = round.submitLines.find((line) => line.model_name === 'claude-opus-4-1-20250805');
    expect(retiredOnPage?.flags).not.toContain('retiring');
    expect(retiredOnPage?.cross_check_verdict).toBe('not_listed');
  });

  it('OpenAI blocked, Anthropic ok: the Anthropic lines still load', () => {
    const round = both({ openai: failed('blocked') });
    expect(round.submitLines.every((line) => line.provider === 'anthropic')).toBe(true);
    expect(round.submitLines).toHaveLength(8);
    expect(round.providerOutcomes.openai).toMatchObject({ outcome: 'blocked', lines_stored: 0 });
    expect(round.providerOutcomes.anthropic).toMatchObject({ outcome: 'ok', lines_stored: 8 });
  });

  it('Anthropic layout changed, OpenAI ok: zero Anthropic lines, its anchor for the log', () => {
    const round = both({ anthropic: ok(ANTHROPIC_PAGE.replace('## Model pricing', '## Model prices')) });
    expect(round.submitLines.every((line) => line.provider === 'openai')).toBe(true);
    expect(round.submitLines).toHaveLength(3);
    expect(round.providerOutcomes.anthropic).toMatchObject({ outcome: 'layout_changed', lines_stored: 0, not_found: [] });
    expect(round.failedAnchors).toEqual([{ provider: 'anthropic', anchor: 'B1' }]);
  });

  it('both fail: zero lines, both outcomes recorded, still a valid round', () => {
    const round = both({ openai: failed('timeout'), anthropic: failed('http_503') });
    expect(round.submitLines).toEqual([]);
    expect(round.providerOutcomes.openai.outcome).toBe('timeout');
    expect(round.providerOutcomes.anthropic.outcome).toBe('http_503');
    expect(ProviderOutcomesSchema.safeParse(round.providerOutcomes).success).toBe(true);
  });

  it('LiteLLM down: every line of both providers is `cross_check_unavailable`', () => {
    const round = both({ litellm: failed('network_error') });
    expect(round.submitLines).toHaveLength(11);
    for (const line of round.submitLines) expect(line.flags).toContain('cross_check_unavailable');
    expect(round.providerOutcomes.litellm).toMatchObject({ outcome: 'network_error', unavailable: 11 });
  });

  it('a refused Anthropic line names its provider and is listed under it', () => {
    const page = ANTHROPIC_PAGE.replace(/\r\n/g, '\n');
    const row = page.split('\n').find((line) => line.startsWith('| Claude Sonnet 4.6 ') && line.includes('$3.75')) ?? '';
    expect(row).not.toBe('');
    const round = both({ anthropic: ok(page.replace(row, row.replace('$3 / MTok ', '$2000 / MTok'))) });
    expect(round.problems).toEqual([
      { provider: 'anthropic', model_name: 'claude-sonnet-4-6', messages: ['The input price is above the sanity ceiling of $1000 per 1M tokens'] },
    ]);
    expect(round.providerOutcomes.anthropic.refused).toEqual([{ model_name: 'claude-sonnet-4-6', reason: 'refused_by_bounds' }]);
    expect(round.providerOutcomes.openai.refused).toEqual([]);
  });
});
