/**
 * /api/admin/model-pricing/fetch-runs (AI model price review slice 5; SA RR-1,
 * SC-8..SC-14, SC-16).
 *
 *   G  the gate comes first: on 401/403 nothing is read, fetched or stored
 *   Z  strict Zod: any body key is 400 (no URL can be supplied); GET takes no query
 *   W  the 60 s refusal is 409 `too_soon` with Retry-After, and nothing is fetched
 *   S  the round goes to the RPC as `fetch`, pending only, with per-provider outcomes
 *   P  partial failure: OpenAI blocked still stores a zero-line round (200);
 *      LiteLLM down still stores the lines, marked unavailable
 *   E  23505 → 409, 42501 → 403, anything else → 500
 *   A  one AI_PRICE_FETCH_RUN entry, counts and model ids only, flushed before the response
 *   M  GET: last run, last success, last failure per source
 *
 * The real parser and cross-check run on the dated fixtures; the network is
 * forbidden and `fetchLimited` answers from them.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { NextRequest } from 'next/server';

import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => logged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const order: string[] = [];
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => {
    order.push('audit');
    return mockLogAndFlush(...args);
  },
}));

const mockLoadSnapshot = jest.fn();
const COVERAGE = ['openai:gpt-4o-mini', 'openai:gpt-4o', 'openai:gpt-4-turbo', 'anthropic:claude-x'];
let mockCoverage: string[] = COVERAGE;
jest.mock('@/lib/ai/pricing-research/comparisonModel', () => ({
  loadPricingSnapshot: () => mockLoadSnapshot(),
  tokenCoverage: () => new Set(mockCoverage),
  lineContextFor: (_snapshot: unknown, line: { model_name: string }) => ({
    context: { current: {}, fallback: {}, conservative: {}, inCoverage: true, inputOnly: false },
    snapshotFields: { current_basis: 'unpriced', model_marker: line.model_name },
  }),
}));

const mockFetchLimited = jest.fn();
jest.mock('@/lib/ai/pricing-research/fetchSources', () => {
  const actual = jest.requireActual('@/lib/ai/pricing-research/fetchSources');
  return { ...actual, fetchLimited: (...args: unknown[]) => mockFetchLimited(...args) };
});

const mockSubmitFetchRound = jest.fn();
const mockLatest = jest.fn();
const mockLatestBy = jest.fn();
jest.mock('@/lib/repositories/AiPriceProposalRepository', () => ({
  aiPriceProposalRepository: {
    submitFetchRound: (...args: unknown[]) => {
      order.push('submit');
      return mockSubmitFetchRound(...args);
    },
    latestFetchRound: () => mockLatest(),
    latestFetchRoundByOutcome: (...args: unknown[]) => mockLatestBy(...args),
  },
}));

import { AUDIT_EVENTS } from '@/lib/audit/events';
import { buildFetchRound } from '@/lib/ai/pricing-research/fetchRound';
import { PRICE_SOURCES } from '@/lib/ai/pricing-research/fetchSources';

import { GET, POST, REFUSAL_WINDOW_MS, dynamic, maxDuration, runtime } from '../route';

forbidRealNetwork();

const FIXTURES = join(process.cwd(), 'lib', 'ai', 'pricing-research', '__fixtures__');
const PAGE = readFileSync(join(FIXTURES, 'openai-pricing-2026-10-14.md'), 'utf8');
const LIST = readFileSync(join(FIXTURES, 'litellm-prices-2026-10-14.json'), 'utf8');

const ok = (text: string) => ({ outcome: 'ok', status: 200, bytes: text.length, durationMs: 50, attempts: 1, text });
const failed = (outcome: string) => ({ outcome, status: outcome === 'blocked' ? 403 : null, bytes: 0, durationMs: 50, attempts: 1 });

function answer(openai: unknown, litellm: unknown) {
  mockFetchLimited.mockImplementation(async (source: { id: string }) => (source.id === 'openai' ? openai : litellm));
}

function post(raw?: string): NextRequest {
  return new NextRequest('http://localhost/api/admin/model-pricing/fetch-runs', {
    method: 'POST',
    ...(raw === undefined ? {} : { body: raw }),
    headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-1' },
  });
}

const get = (query = '') => new NextRequest(`http://localhost/api/admin/model-pricing/fetch-runs${query}`, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  logged.length = 0;
  order.length = 0;
  mockGetUser.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
  mockIsAdmin.mockResolvedValue(true);
  mockLoadSnapshot.mockResolvedValue({ snapshot: true });
  mockCoverage = COVERAGE;
  mockLatest.mockResolvedValue({ data: null, error: null });
  mockLatestBy.mockResolvedValue({ data: null, error: null });
  answer(ok(PAGE), ok(LIST));
  mockSubmitFetchRound.mockImplementation(async (input: { lines: unknown[] }) => ({
    data: {
      roundId: 'round-1',
      lines: input.lines.map((_line, index) => ({ proposalId: 'round-1', lineId: `line-${index + 1}`, lineIndex: index + 1, supersededLineId: null })),
    },
    error: null,
  }));
  mockLogAndFlush.mockResolvedValue(undefined);
});

it('exports POST and GET, nodejs, dynamic, maxDuration 60', () => {
  expect(runtime).toBe('nodejs');
  expect(dynamic).toBe('force-dynamic');
  expect(maxDuration).toBe(60);
  expect(REFUSAL_WINDOW_MS).toBe(60_000);
  const source = readFileSync(join(process.cwd(), 'app', 'api', 'admin', 'model-pricing', 'fetch-runs', 'route.ts'), 'utf8');
  for (const handler of ['POST', 'GET']) {
    const body = source.slice(source.indexOf(`export async function ${handler}(`));
    const firstStatements = body.slice(body.indexOf('{') + 1).split(';').map((statement) => statement.trim());
    // The correlation id and child logger come first (they read only a header), then the gate.
    expect(firstStatements[2]).toMatch(/^[/][/][^]*const gate = await requireAdmin[(]requestLogger[)]$/);
  }
});

describe('G: the gate comes first', () => {
  it.each([
    ['401 signed out', () => mockGetUser.mockResolvedValue(null), 401],
    ['403 not an admin', () => mockIsAdmin.mockResolvedValue(false), 403],
  ])('%s: nothing is read, fetched or stored', async (_label, arrange, status) => {
    arrange();
    const request = post('{}');
    const text = jest.spyOn(request, 'text');
    expect((await POST(request)).status).toBe(status);
    expect(text).not.toHaveBeenCalled();
    expect(mockLatest).not.toHaveBeenCalled();
    expect(mockFetchLimited).not.toHaveBeenCalled();
    expect(mockSubmitFetchRound).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect((await GET(get())).status).toBe(status);
  });
});

describe('Z: strict input', () => {
  it.each([
    ['a url', JSON.stringify({ url: 'https://example.com/prices' })],
    ['a provider', JSON.stringify({ provider: 'openai' })],
    ['not JSON', 'nope'],
    ['an array', '[]'],
  ])('400 for %s, nothing fetched', async (_label, raw) => {
    const response = await POST(post(raw));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'This action takes no input.', code: 'invalid_input' });
    expect(mockFetchLimited).not.toHaveBeenCalled();
  });

  it('an empty body and {} are both accepted', async () => {
    expect((await POST(post())).status).toBe(200);
    expect((await POST(post('{}'))).status).toBe(200);
  });

  it('GET with a query is 400', async () => {
    expect((await GET(get('?provider=openai'))).status).toBe(400);
    expect(mockLatest).not.toHaveBeenCalled();
  });
});

describe('W: the 60 s refusal', () => {
  it('409 too_soon with Retry-After when the last round is 30 s old; nothing fetched', async () => {
    mockLatest.mockResolvedValue({
      data: { id: 'r0', created_at: new Date(Date.now() - 30_000).toISOString(), created_by: 'a', provider_outcomes: {} },
      error: null,
    });
    const response = await POST(post('{}'));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'too_soon' });
    expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(body.error).toBe(`Prices were checked less than a minute ago. Try again in ${body.retryAfterSeconds} s.`);
    expect(response.headers.get('Retry-After')).toBe(String(body.retryAfterSeconds));
    expect(mockFetchLimited).not.toHaveBeenCalled();
    expect(mockSubmitFetchRound).not.toHaveBeenCalled();
  });

  it('a round 2 s "in the future" (database clock ahead) still refuses (SA F-3)', async () => {
    mockLatest.mockResolvedValue({
      data: { id: 'r0', created_at: new Date(Date.now() + 2_000).toISOString(), created_by: 'a', provider_outcomes: {} },
      error: null,
    });
    const response = await POST(post('{}'));
    expect(response.status).toBe(409);
    expect((await response.json()).retryAfterSeconds).toBe(60);
    expect(mockFetchLimited).not.toHaveBeenCalled();
  });

  it('a round 61 s old does not refuse', async () => {
    mockLatest.mockResolvedValue({
      data: { id: 'r0', created_at: new Date(Date.now() - 61_000).toISOString(), created_by: 'a', provider_outcomes: {} },
      error: null,
    });
    expect((await POST(post('{}'))).status).toBe(200);
  });
});

describe('S: the happy path', () => {
  it('fetches the two pinned sources, stores one fetch round, audits, then answers', async () => {
    const response = await POST(post('{}'));
    expect(response.status).toBe(200);
    expect(mockFetchLimited.mock.calls.map(([source]) => source)).toEqual([PRICE_SOURCES.openai, PRICE_SOURCES.litellm]);

    expect(mockSubmitFetchRound).toHaveBeenCalledTimes(1);
    const submitted = mockSubmitFetchRound.mock.calls[0][0];
    expect(submitted.adminUserId).toBe('admin-1');
    expect(submitted.lines.map((line: { model_name: string }) => line.model_name)).toEqual(['gpt-4o', 'gpt-4o-mini']);
    const mini = submitted.lines.find((line: { model_name: string }) => line.model_name === 'gpt-4o-mini');
    expect(mini).toMatchObject({
      provider: 'openai',
      input_per_1m: '0.15',
      output_per_1m: '0.60',
      cached_input_per_1m: '0.075',
      source_url: 'https://developers.openai.com/api/docs/pricing',
      cross_check_verdict: 'agrees',
      cross_check_source: PRICE_SOURCES.litellm.url,
    });
    expect(submitted.providerOutcomes.openai).toMatchObject({ outcome: 'ok', lines_stored: 2, not_found: ['gpt-4-turbo'] });
    expect(submitted.providerOutcomes.anthropic).toEqual({ outcome: 'manual_only' });

    expect(order).toEqual(['submit', 'audit']);
    const [entry] = mockLogAndFlush.mock.calls[0];
    expect(entry).toMatchObject({
      action: AUDIT_EVENTS.AI_PRICE_FETCH_RUN,
      entityType: 'ai_pricing',
      entityId: 'round-1',
      userId: 'admin-1',
      severity: 'info',
    });
    expect(entry.details).toEqual({
      entity_kind: 'price_proposal',
      proposal_id: 'round-1',
      correlationId: 'corr-1',
      openai: { outcome: 'ok', lines_stored: 2, needs_manual_models: [], not_found_models: ['gpt-4-turbo'], refused_models: [] },
      litellm: { outcome: 'ok', agrees: 2, differs: 0, not_listed: 0, unavailable: 0 },
      manual_providers: ['anthropic', 'google', 'kimi'],
    });
    // Counts and model ids only: no page or list text reaches the audit or a log line.
    expect(JSON.stringify(entry)).not.toContain('Standard pricing data');
    expect(JSON.stringify(logged)).not.toContain('Standard pricing data');
    expect(JSON.stringify(logged)).not.toContain('litellm_provider');

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.roundId).toBe('round-1');
    expect(body.data.providerOutcomes.litellm).toMatchObject({ outcome: 'ok', agrees: 2 });
    expect(body.data.problems).toEqual([]);

    const sourceLines = logged.filter((line) => line.args[1] === 'Price source read');
    expect(sourceLines.map((line) => (line.args[0] as { provider: string }).provider)).toEqual(['openai', 'litellm']);
  });
});

describe('F-1: a coverage id that is not a model id', () => {
  it('is left out with one warning; the round is still stored (200) and the id is not in not_found', async () => {
    mockCoverage = [...COVERAGE, 'openai:GPT-4o', 'openai:ft:gpt-4o:org'];
    const response = await POST(post('{}'));
    expect(response.status).toBe(200);
    expect(mockSubmitFetchRound).toHaveBeenCalledTimes(1);
    const submitted = mockSubmitFetchRound.mock.calls[0][0];
    expect(submitted.providerOutcomes.openai.not_found).toEqual(['gpt-4-turbo']);
    expect(JSON.stringify(submitted)).not.toContain('GPT-4o');
    expect(logged.filter((line) => line.args[1] === 'Coverage ids that are not model ids were left out of the price check')).toEqual([
      { level: 'warn', args: [{ dropped: 2, models: ['GPT-4o', 'ft:gpt-4o:org'] }, 'Coverage ids that are not model ids were left out of the price check'] },
    ]);
  });

  it('no warning when every id is a model id', async () => {
    expect((await POST(post('{}'))).status).toBe(200);
    expect(logged.some((line) => line.args[1] === 'Coverage ids that are not model ids were left out of the price check')).toBe(false);
  });
});

describe('P: partial failure', () => {
  it.each([['blocked'], ['network_error'], ['timeout']])('OpenAI %s: a zero-line round is stored and the answer is 200', async (outcome) => {
    answer(failed(outcome), ok(LIST));
    const response = await POST(post('{}'));
    expect(response.status).toBe(200);
    const submitted = mockSubmitFetchRound.mock.calls[0][0];
    expect(submitted.lines).toEqual([]);
    expect(submitted.providerOutcomes.openai).toMatchObject({ outcome, lines_stored: 0 });
    expect((await response.json()).data.providerOutcomes.openai.outcome).toBe(outcome);
    expect(logged.some((line) => line.level === 'warn' && line.args[1] === 'Price source failed')).toBe(true);
  });

  it('LiteLLM down: the OpenAI lines are still stored, marked unavailable', async () => {
    answer(ok(PAGE), failed('network_error'));
    expect((await POST(post('{}'))).status).toBe(200);
    const submitted = mockSubmitFetchRound.mock.calls[0][0];
    expect(submitted.lines).toHaveLength(2);
    for (const line of submitted.lines) {
      expect(line.cross_check_verdict).toBe('unavailable');
      expect(line.flags).toContain('cross_check_unavailable');
    }
  });

  it('a rejected fetch (backstop) is a network_error, not a 500', async () => {
    mockFetchLimited.mockImplementation(async (source: { id: string }) => {
      if (source.id === 'openai') throw new Error('boom');
      return ok(LIST);
    });
    expect((await POST(post('{}'))).status).toBe(200);
    expect(mockSubmitFetchRound.mock.calls[0][0].providerOutcomes.openai.outcome).toBe('network_error');
  });

  it('a changed layout logs the failed anchor, never the page', async () => {
    answer(ok(PAGE.replace('### Standard pricing data', '### Standard')), ok(LIST));
    expect((await POST(post('{}'))).status).toBe(200);
    expect(logged).toContainEqual({ level: 'warn', args: [{ provider: 'openai', anchor: 'A1' }, 'OpenAI pricing page layout changed'] });
  });
});

describe('E: errors', () => {
  it.each([
    ['23505', 409, 'conflict'],
    ['42501', 403, 'not_admin_row'],
  ])('%s → %s', async (code, status, label) => {
    mockSubmitFetchRound.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { code }) });
    const response = await POST(post('{}'));
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(label);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('anything else → 500 with no detail outside development', async () => {
    mockSubmitFetchRound.mockResolvedValue({ data: null, error: new Error('db down') });
    const response = await POST(post('{}'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'The provider prices could not be saved.' });
  });

  it('a failed read of the last round is 500, and nothing is fetched', async () => {
    mockLatest.mockResolvedValue({ data: null, error: new Error('read failed') });
    expect((await POST(post('{}'))).status).toBe(500);
    expect(mockFetchLimited).not.toHaveBeenCalled();
  });
});

describe('M: GET status (SC-12)', () => {
  it('returns the last run, last success and last failure per source', async () => {
    const outcomesOf = (openai: 'ok' | 'blocked') =>
      buildFetchRound({
        openai: openai === 'ok' ? (ok(PAGE) as never) : (failed('blocked') as never),
        litellm: ok(LIST) as never,
        coverage: new Set(['gpt-4o-mini']),
        isInputOnly: () => false,
        contextFor: () => ({
          context: { current: {}, fallback: {}, conservative: {}, inCoverage: true, inputOnly: false },
          snapshotFields: { current_basis: 'unpriced' },
        }),
        sourceUrl: 'https://developers.openai.com/api/docs/pricing',
        crossCheckSource: PRICE_SOURCES.litellm.url,
        checkedOn: '2026-10-15',
        fetchedAt: '2026-10-15T09:00:00.000Z',
      }).providerOutcomes;
    const latest = { id: 'r2', created_at: '2026-10-15T09:00:00.000Z', created_by: 'a', provider_outcomes: outcomesOf('blocked') };
    const lastOk = { id: 'r1', created_at: '2026-10-14T09:00:00.000Z', created_by: 'a', provider_outcomes: outcomesOf('ok') };
    mockLatest.mockResolvedValue({ data: latest, error: null });
    mockLatestBy.mockImplementation(async (source: string, match: string) => ({
      data: source === 'openai' ? (match === 'ok' ? lastOk : latest) : match === 'ok' ? latest : null,
      error: null,
    }));

    const response = await GET(get());
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.lastRunAt).toBe('2026-10-15T09:00:00.000Z');
    expect(data.openai).toMatchObject({
      lastRun: { outcome: 'blocked', at: '2026-10-15T09:00:00.000Z' },
      lastOkAt: '2026-10-14T09:00:00.000Z',
      lastFailure: { outcome: 'blocked', at: '2026-10-15T09:00:00.000Z' },
    });
    expect(data.litellm).toMatchObject({ lastRun: { outcome: 'ok' }, lastFailure: null });
    expect(data.manualProviders).toEqual(['anthropic', 'google', 'kimi']);
    expect(mockLatestBy.mock.calls).toEqual([
      ['openai', 'ok'],
      ['openai', 'not_ok'],
      ['litellm', 'ok'],
      ['litellm', 'not_ok'],
    ]);
  });

  it('a failed read is 500', async () => {
    mockLatestBy.mockResolvedValue({ data: null, error: new Error('x') });
    expect((await GET(get())).status).toBe(500);
  });
});
