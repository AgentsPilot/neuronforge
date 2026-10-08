/**
 * Hypothesis generation: attribution, and what must never reach a log.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Standard 7 of `bos-llm-call-standards`: a test asserts the context each call
 * receives -- area, call name, the server-resolved account, the action's group
 * -- and proves with a sentinel that raw input never reaches a logger at any
 * level.
 *
 * This call has a sharper version of that second obligation than most. Its
 * reply is model-generated prose ABOUT the owner's business, and a JSON parse
 * failure quotes the text it choked on. So the sentinel here is planted in the
 * model's OUTPUT as well as the prompt: an unparseable reply must produce an
 * error line carrying a name and a length and nothing else.
 *
 * Provider mocked. No network, no database, no model call.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/*
 * Pinned to the CODE DEFAULTS, so this file asserts behaviour and not whatever
 * an operator has configured. Same approach as
 * `insight-llm-attribution.test.ts`.
 */
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return {
    ...actual,
    resolveBosLlmSettings: async (area: string, callName: string) =>
      actual.bosLlmCodeDefaults(area, callName),
  };
});

/** Every line any logger is handed, at any level. */
const logged: unknown[] = [];
const capture = (...args: unknown[]) => { logged.push(...args); };

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: capture, warn: capture, info: capture, debug: capture }),
}));

/** The profile is not what this file tests; keep it cheap and deterministic. */
jest.mock('../buildProfile', () => ({
  buildProfile: async () => ({
    counts: { scheduling_bookings: 40 },
    metrics: [
      { key: 'retention.rebooking_rate', periodType: 'monthly', values: [0, 0, 0, 100, 100] },
      { key: 'retention.no_show_rate', periodType: 'monthly', values: [0, 10, 12] },
    ],
    behaviour: [{ action: 'SCHEDULING_BOOKING_CREATED', count: 29, days: 11 }],
    catalog: 'bookings (booking/bookings)\n  status, service_id, start_time',
    windowDays: 30,
  }),
  worthAsking: () => true,
}));

/** No query ever runs: every proposal in this file is turned away before that. */
jest.mock('../../../bizql', () => ({
  runBusinessQuery: async () => ({ op: 'compute', entity: 'bookings', agg: { fn: 'count' }, value: 0 }),
}));

import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { isUuid } from '@/lib/business-os/llm/callCatalog';
import { generateHypotheses } from '../HypothesisService';

const USER = '08456106-aa50-4810-b12c-7ca84102da31';
const GROUP = 'b1e4a9c6-7f3d-4a21-9c58-2d6e0f8a1b33';

/**
 * A string that appears nowhere a logger should see.
 *
 * Planted in the model's reply, which is the risky direction: a JSON
 * `SyntaxError` carries the text it failed on, and that text is prose about
 * this owner's business.
 */
const SENTINEL = 'SENTINEL-David-Hamelech-owes-8500';

let captured: Record<string, unknown> | undefined;
let reply: string;

beforeEach(() => {
  logged.length = 0;
  captured = undefined;
  reply = '[]';

  jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue({
    chatCompletion: async (_params: unknown, context: Record<string, unknown>) => {
      captured = context;
      return { choices: [{ message: { content: reply } }] };
    },
  } as unknown as BaseAIProvider);
});

afterEach(() => { jest.restoreAllMocks(); });

describe('the call context', () => {
  it('carries the area, the call name and the business being analysed', async () => {
    await generateHypotheses({} as never, USER, GROUP);

    expect(captured).toMatchObject({
      userId: USER,
      feature: 'business-os-insights',
      component: 'hypothesis',
    });
  });

  it('uses the group the caller minted, not one of its own', async () => {
    /*
     * One group per business per run (Standard 3). A fresh id minted here would
     * split one action into several, which is the bug F-13 fixed for the
     * insight cron: a `token_usage.session_id` that spanned tenants.
     */
    await generateHypotheses({} as never, USER, GROUP);

    expect(captured?.sessionId).toBe(GROUP);
    expect(isUuid(String(captured?.sessionId))).toBe(true);
  });

  it('makes no call at all when the area is switched off', async () => {
    jest.resetModules();
    jest.doMock('@/lib/business-os/llm/modelSettings', () => ({
      resolveBosLlmSettings: async () => ({ enabled: false, provider: 'openai', model: 'x' }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { generateHypotheses: gated } = require('../HypothesisService');
    const run = await gated({} as never, USER, GROUP);

    expect(run.skipped).toBe('disabled');
    expect(captured).toBeUndefined();
  });
});

describe('the sentinel never reaches a logger', () => {
  const noSentinel = () => {
    const blob = JSON.stringify(logged, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v));
    expect(blob).not.toContain(SENTINEL);
  };

  it('on a reply that is not JSON at all', async () => {
    /*
     * THE ONE THAT MATTERS. `JSON.parse` throws a SyntaxError quoting the text
     * it failed on, so logging the error object logs the model's prose about
     * this business. Standard 5: `errName` and a length at error, the error
     * itself at debug only -- and debug is off in production.
     */
    reply = `Here is what I noticed: ${SENTINEL}`;

    const run = await generateHypotheses({} as never, USER, GROUP);

    expect(run.findings).toEqual([]);
    noSentinel();
  });

  it('on a reply whose claim is rejected for carrying a figure', async () => {
    reply = JSON.stringify([
      {
        claim: `${SENTINEL} is 40% worse`,
        query: { op: 'compute', entity: 'bookings', group_by: 'status', agg: { fn: 'count' } },
        confirm_when: { kind: 'group_differs', min_rows_per_group: 5, min_ratio: 2 },
      },
    ]);

    await generateHypotheses({} as never, USER, GROUP);

    /*
     * The rejected claim is RETURNED to the caller -- a review screen has to
     * show what was turned away -- but it must not be logged. The run summary
     * logs reasons, never claims.
     */
    noSentinel();
  });

  it('on a reply that parses but proposes nothing usable', async () => {
    reply = JSON.stringify([{ claim: SENTINEL }]);

    const run = await generateHypotheses({} as never, USER, GROUP);

    expect(run.skipped).toBe('no_proposals');
    noSentinel();
  });
});

describe('what the run reports back', () => {
  it('returns rejections with a reason, which is the early value', async () => {
    reply = JSON.stringify([
      {
        claim: 'Mondays are 40% worse',
        query: { op: 'compute', entity: 'bookings', group_by: 'status', agg: { fn: 'count' } },
        confirm_when: { kind: 'group_differs', min_rows_per_group: 5, min_ratio: 2 },
      },
    ]);

    const run = await generateHypotheses({} as never, USER, GROUP);

    expect(run.findings).toEqual([]);
    expect(run.rejected).toEqual([
      { claim: 'Mondays are 40% worse', reason: 'claim_contains_figure' },
    ]);
  });

  it('keeps a proposal that groups by a relation instead of a column', async () => {
    /*
     * `over` is the other grouping mechanism, and the only way to compare named
     * records. Requiring `group_by` dropped every one of these silently, which
     * two live runs reported as "no usable proposals" while the model was doing
     * exactly what the prompt asked.
     */
    reply = JSON.stringify([
      {
        claim: 'One service is booked far more than the others',
        query: { op: 'compute', entity: 'services', over: 'bookings', agg: { fn: 'count' } },
        confirm_when: { kind: 'group_differs', min_rows_per_group: 5, min_ratio: 2 },
      },
    ]);

    const run = await generateHypotheses({} as never, USER, GROUP);

    // It reached the verifier rather than being dropped at the parser.
    expect(run.skipped).toBeUndefined();
    expect(run.proposed).toBe(1);
  });

  it('drops a proposal with neither group_by nor over', async () => {
    // A question with no groups cannot be settled, so it never reaches a query.
    reply = JSON.stringify([
      {
        claim: 'Something is wrong overall',
        query: { op: 'compute', entity: 'bookings', agg: { fn: 'count' } },
        confirm_when: { kind: 'group_differs', min_rows_per_group: 5, min_ratio: 2 },
      },
    ]);

    const run = await generateHypotheses({} as never, USER, GROUP);

    expect(run.skipped).toBe('no_proposals');
  });

  it('drops a confirm_when kind outside the closed set', async () => {
    reply = JSON.stringify([
      {
        claim: 'Something looks significant',
        query: { op: 'compute', entity: 'bookings', group_by: 'status', agg: { fn: 'count' } },
        confirm_when: { kind: 'vibes', min_rows_per_group: 5 },
      },
    ]);

    const run = await generateHypotheses({} as never, USER, GROUP);

    expect(run.skipped).toBe('no_proposals');
  });

  it('reports the model that actually ran', async () => {
    const run = await generateHypotheses({} as never, USER, GROUP);

    // FR-13: the model that ran, not the one asked for.
    expect(run.modelUsed).toBe('gpt-4o-mini');
  });
});
