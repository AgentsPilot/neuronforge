/**
 * T3-S (Layer 2 Step 3) — what the chat and image call sites send TO THE
 * PROVIDER, and which settings key each of them asked for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME OBLIGATION AS T2-S, AND ONE DELIBERATE DIFFERENCE
 *
 * Like `callParams.boundary.step2.test.ts`, this spies at the REAL provider
 * boundary — `ProviderFactory.getProvider(...).chatCompletion` for the two chat
 * calls and `ProviderFactory.getOpenAI().generateImage` for images — drives
 * each Step 3 site once with the SEEDED rows, and asserts the whole request
 * plus the number of calls made. Nothing between the call site and the provider
 * is mocked away.
 *
 * The committed snapshot was taken with the three call sites UNWIRED — the
 * pre-Step-3 source, this file's tests unchanged — and must not move when they
 * are wired. That is the AC-2 proof: same request, same number of calls, before
 * and after, compared on the same code path rather than on two descriptions of
 * it. The procedure is recorded in §7.6 D-48 so it can be repeated.
 *
 * Long strings (prompts, system messages, the catalog) are recorded as a
 * SHA-256 digest with their length, exactly as T2-S does: still byte-exact —
 * one changed character changes the digest — and it keeps the record legible.
 * Every short value (model, temperature, `frequency_penalty`, `max_tokens`,
 * roles, size, quality, and the whole attribution context) is recorded
 * literally.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE ADDS THAT T2-S DID NOT HAVE (the four blind spots)
 *
 *  1. **Which provider was asked for** (SA F-1). `getProvider` is spied, not
 *     stubbed blind: its arguments are recorded and asserted.
 *  2. **Which `(area, call)` key the site resolved** (QA D2-1). `resolveBosLlmSettings`
 *     is spied and its arguments asserted, so a site reading a neighbour's key
 *     fails here instead of passing because the two happen to resolve alike.
 *  3. **That the resolved model is actually used** (QA D2-2): each site is
 *     re-driven with its model overridden, and the boundary must carry the
 *     override.
 *  4. **That the request is built inside the retry** (QA D2-3): the override is
 *     refused with a 404 `model_not_found` and the boundary must show
 *     `[override, default]`.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §7.3
 */

const logged: Array<{ level: string; fields: Record<string, unknown>; msg: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (fields: unknown, msg?: unknown) =>
        logged.push({
          level,
          fields: (typeof fields === 'object' && fields !== null ? fields : {}) as Record<string, unknown>,
          msg: typeof fields === 'string' ? fields : msg,
        });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockGetByKeys = jest.fn();

/**
 * A price per MODEL, so the price KEY is observable from outside.
 *
 * `imagePriceResolver` closes over the model it was built with, and nothing
 * exposes it. Giving each model a different price makes the key readable: the
 * service logs `usdPerImage`, so the number in that log line says which model
 * the image was priced as. RC-W4 is exactly that question, which is why these
 * two prices must stay different from each other.
 */
const PRICE_DEFAULT_MODEL = 0.25;
const PRICE_OVERRIDE_MODEL = 0.5;
const OVERRIDE_IMAGE_MODEL = 'gpt-image-1-mini';

jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  const defaults = actual.IMAGE_GENERATION_CONFIG_DEFAULTS;

  /*
   * EVERY configured size at low, medium and high, for both models.
   *
   * Not decoration: `checkImageModel` refuses an image model unless all of
   * them are priced (RC-5), because `quality: 'auto'` is priced after the call
   * by whatever the provider reports. A partial table here would make the
   * override be REJECTED by the guardrail and silently fall back to the code
   * default — and the override tests below would be passing for the wrong
   * reason.
   */
  const pricesUsd: Record<string, number> = {};
  for (const size of Object.values(defaults.sizes) as string[]) {
    for (const quality of ['low', 'medium', 'high']) {
      pricesUsd[defaults.model + ':' + size + ':' + quality] = 0.25;
      pricesUsd['gpt-image-1-mini:' + size + ':' + quality] = 0.5;
    }
  }

  return {
    ...actual,
    systemConfigRepository: {
      ...actual.systemConfigRepository,
      getByKeys: (...args: unknown[]) => mockGetByKeys(...args),
      getImageGenerationConfig: async () => ({ ...defaults, pricesUsd }),
    },
  };
});

jest.mock('@/lib/ai/pricing', () => ({
  getPricing: async () => ({ input: 0.0025, output: 0.01 }),
  hasPricing: async () => true,
  calculateCost: async () => 0,
  calculateCostSync: () => 0,
}));

/** Everything the planner, the plan cache and the verified questions read. */
const mockDbResult: { data: unknown[]; error: null; count: number } = { data: [], error: null, count: 0 };
jest.mock('@/lib/supabaseServer', () => {
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(mockDbResult);
        return () => builder;
      },
    }
  );
  return {
    supabaseServer: {
      from: () => builder,
      rpc: () => builder,
      // The image service uploads the PNG and reads its public URL before it
      // returns. Without this, `supabaseServer.storage` is undefined, the
      // service's own catch turns the throw into `{ ok: false, reason:
      // 'failed' }`, and a wiring test fails for a reason that has nothing to
      // do with wiring.
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
        }),
      },
    },
  };
});

/**
 * The legacy config reader, serving every key its documented default.
 *
 * Nothing in the WIRED code reads this any more — that is the point of Step 3.
 * It is here for the CAPTURE: the unwired sources read
 * `bizchat_planner_model`, `bizchat_analysis_model` and
 * `bizchat_analysis_enabled` through `SystemConfigService`, and P-2 recorded
 * that none of the six legacy keys was ever stored in production, so the seed
 * wrote the code defaults throughout. Serving the fallback here is therefore
 * the same value the seeded rows resolve to, which is exactly what makes the
 * before/after comparison meaningful rather than a comparison of two
 * differently-configured runs.
 */
jest.mock('@/lib/services/SystemConfigService', () => ({
  SystemConfigService: {
    getString: async (_s: unknown, _key: string, fallback: string) => fallback,
    getBoolean: async (_s: unknown, _key: string, fallback: boolean) => fallback,
    getNumber: async (_s: unknown, _key: string, fallback: number) => fallback,
  },
}));

jest.mock('@/lib/business-os/bizql/planner/catalogPrompt', () => ({
  ...jest.requireActual('@/lib/business-os/bizql/planner/catalogPrompt'),
  renderUserVocabulary: jest.fn(async () => ''),
}));

const mockMedia = {
  findBySourceRef: jest.fn(async () => null),
  countGeneratedSince: jest.fn(async () => 0),
  record: jest.fn(async () => ({ id: 'm1' })),
};
jest.mock('@/lib/repositories/UserMediaRepository', () => ({ userMediaRepository: mockMedia }));

/**
 * Which `(area, call)` key each site asked the resolver for (QA D2-1).
 *
 * A wrapper around the REAL resolver, not a stub: the values still come from
 * the fixture rows through the real guardrails, and all that is added is a
 * record of what was asked. That is the whole of the fourth blind spot — two
 * calls whose resolved values coincide are indistinguishable at the boundary,
 * so a site reading its neighbour's key passes every other assertion.
 *
 * `mock`-prefixed so the factory may close over it (Jest hoists these).
 */
const mockResolveArgs: Array<[string, string]> = [];
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return {
    ...actual,
    resolveBosLlmSettings: async (area: string, callName: string) => {
      mockResolveArgs.push([area, callName]);
      return actual.resolveBosLlmSettings(area, callName);
    },
  };
});

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { BizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { analyse } from '@/lib/business-os/bizql/analyse/AnalysisService';
import { PlanCache, resetPlanCache } from '@/lib/business-os/bizql/cache/PlanCache';
import { resetVerifiedQuestions } from '@/lib/business-os/bizql/planner/VerifiedQuestions';
import { generateImage } from '@/lib/services/GeneratedImageService';
import { IMAGE_GENERATION_CONFIG_DEFAULTS } from '@/lib/repositories/SystemConfigRepository';
import type { QueryResult } from '@/lib/business-os/bizql/types';

import { __resetBosLlmSettingsForTests } from '../modelSettings';
import { bosLlmAreaKey } from '../modelSettingsPolicy';
import { BOS_LLM_AREAS } from '../callCatalog';
import { SEEDED_ROWS } from '../__fixtures__/seededRows';
import { __resetModelFallbackForTests } from '../modelFallback';

const U1 = '11111111-1111-4111-8111-111111111111';
const T1 = '44444444-4444-4444-8444-444444444444';
const G1 = '33333333-3333-4333-8333-333333333333';

const chatCompletion = jest.fn();
const generateImageSpy = jest.fn();

/** Which provider name each `getProvider` call asked for (SA F-1). */
const getProviderArgs: unknown[] = [];

/** The fixture rows, optionally with one area's row edited. */
function seededRows(edit?: (rows: Record<string, Record<string, unknown>>) => void) {
  const copy = JSON.parse(JSON.stringify(SEEDED_ROWS)) as Record<string, Record<string, unknown>>;
  edit?.(copy);
  return {
    data: BOS_LLM_AREAS.map((area) => ({
      key: bosLlmAreaKey(area),
      value: copy[area],
      category: 'business_os_llm',
      updated_at: '2026-10-03T00:00:00.000Z',
    })),
    error: null,
  };
}

/* ------------------------------------------------------------- normalisation */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMED_IDS: Record<string, string> = {
  [U1]: '<user>',
  [T1]: '<turn>',
  [G1]: '<group>',
};

/**
 * Any ISO-8601 calendar date, with or without a time, anywhere in a string.
 *
 * Prompts that carry "today" (the planner writes `Today is 2026-09-21.`) would
 * otherwise bake the recording day into the snapshot and be red every day after
 * it - permanently, since the value is re-derived per UTC day. Replacing the
 * date keeps the record date-independent while leaving every other byte asserted.
 */
const ISO_DATETIME = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;

/** `2026-09-21` -> `<date>`; `2026-09-21T08:00:00.000Z` -> `<timestamp>`. */
function undateString(value: string): string {
  return value.replace(ISO_DATETIME, (match) => (match.length > 10 ? '<timestamp>' : '<date>'));
}

/**
 * Fields the date rule must never touch (SA review, dated snapshots).
 *
 * Model ids carry dates: `gpt-4o-2024-08-06` is a real, settable value, and an
 * operator can put it in an area row through `npm run bos:llm-settings`. Undating
 * it would record `gpt-4o-<date>`, hollowing out the one assertion these suites
 * exist to make - which model went on the wire - and the dateless-snapshot guard
 * would not notice, because the snapshot would then contain no date to find.
 */
const DATE_EXEMPT_KEYS = new Set(['model', 'provider']);

/**
 * Long strings become `sha256:<hex> (len N)`.
 *
 * Byte-exact — a single changed character of prompt changes the digest — but it
 * keeps the record readable. The planner's system prompt alone is several
 * thousand characters of catalog.
 */
function normalise(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (NAMED_IDS[value]) return NAMED_IDS[value];
    if (UUID.test(value)) return '<uuid>';
    // Before the digest, not after: a date inside a long prompt moves the hash
    // just as surely as one in a short message, and is far harder to diagnose.
    // Exempt keys keep their date - see DATE_EXEMPT_KEYS.
    const dateless = DATE_EXEMPT_KEYS.has(key ?? '') ? value : undateString(value);
    if (dateless.length > 200) {
      return `sha256:${createHash('sha256').update(dateless, 'utf8').digest('hex')} (len ${dateless.length})`;
    }
    return dateless;
  }
  // The key travels into arrays too: `model: [...]` would otherwise lose the exemption.
  if (Array.isArray(value)) return value.map((item) => normalise(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalise(v, k)]));
  }
  return value;
}

/**
 * Every argument of every provider call made since the last reset.
 *
 * The WHOLE argument list, not a chosen subset: a parameter a wrapper adds or
 * drops between the call site and the provider shows up here, which is the
 * whole reason the guarantee lives at this boundary rather than in source text.
 */
function boundaryCalls(spy: jest.Mock): unknown {
  return spy.mock.calls.map((call) => normalise(call));
}

const VALID_PLAN_ARGS = JSON.stringify({
  steps: [{ id: 's1', op: 'find', entity: 'contacts' }],
  answer: { text: 'You have {s1.count} contacts.', primary_step: 's1' },
});

function toolCall(args: string) {
  return {
    choices: [{ message: { tool_calls: [{ function: { name: 'emit_plan', arguments: args } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

/**
 * What the real provider does with the price resolver it is handed: it calls it
 * with the quality the API reported, BEFORE returning. Reproduced here, because
 * that call is what records the price — skip it and `pricing.last()` stays null
 * and the service's log line carries no price to read.
 */
async function imageSucceeds(_request: unknown, _context: unknown, priceFor?: unknown) {
  (priceFor as ((quality: string) => unknown) | undefined)?.('high');
  return { created: 1, data: [{ b64_json: Buffer.from('png').toString('base64') }] };
}

/** What the service logged as the per-image price of the image it just made. */
function lastLoggedPrice(): unknown {
  const line = [...logged].reverse().find((entry) => 'usdPerImage' in entry.fields);
  return line?.fields.usdPerImage;
}

/** A provider refusal the FR-11 fallback is allowed to retry (and only that). */
function modelNotFound(): Error & { status: number; code: string } {
  return Object.assign(new Error('The model does not exist'), { status: 404, code: 'model_not_found' });
}

/**
 * A real `compute` result, `agg` included.
 *
 * `buildAnalysisPayload` describes each step as "<fn> of <entity>.<field>", so
 * a result without `agg` throws inside `analyse`'s own try — which returns null
 * and makes no provider call at all. The first run of this suite failed exactly
 * that way, and it would have looked like the analysis site was not wired.
 */
const analysisResults: QueryResult[] = [
  {
    id: 's1',
    op: 'compute',
    entity: 'transactions',
    agg: { fn: 'sum', field: 'net_amount' },
    value: 523,
    approximate: false,
  } as unknown as QueryResult,
];

/** The three Step 3 sites, each driven once. */
const drivePlanner = () =>
  new BizQLPlanner().plan({ message: 'show my contacts', userId: U1, turnId: T1, language: 'en' });

const driveAnalysis = () =>
  analyse({
    question: 'how much revenue did I make',
    language: 'en',
    currency: 'USD',
    userId: U1,
    steps: [{ id: 's1' }],
    results: analysisResults,
    turnId: T1,
  });

const driveImages = () => generateImage({ userId: U1, groupId: G1 }, 'a calm studio', 'wide', 'hero');

/*
 * The planner puts a literal `Today is YYYY-MM-DD` in its USER message
 * (`Planner.ts`, so it can resolve "the 30th of October" to the right year),
 * and this suite snapshots that message verbatim. Read from the real clock it
 * matched only on the day it was recorded and failed every day after — which
 * is what it had been doing since 2026-09-21.
 *
 * Re-recording would not have fixed it; it would have moved the failure to
 * tomorrow. So the clock is pinned instead, and pinned to the date already in
 * the snapshot so the expected value is unchanged.
 *
 * `doNotFake` leaves the timer functions real. Only `Date` is faked here —
 * taking over setTimeout as well would stall the async paths these call sites
 * run through, and the suite would hang rather than fail.
 */
const FROZEN_NOW = new Date('2026-09-21T12:00:00.000Z');

beforeEach(() => {
  jest.useFakeTimers({
    now: FROZEN_NOW,
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });

  logged.length = 0;
  jest.clearAllMocks();
  jest.restoreAllMocks();
  __resetBosLlmSettingsForTests();
  __resetModelFallbackForTests();
  resetPlanCache();
  resetVerifiedQuestions();
  mockDbResult.data = [];
  mockDbResult.count = 0;
  mockGetByKeys.mockResolvedValue(seededRows());
  process.env.OPENAI_API_KEY = 'test-key';

  chatCompletion.mockResolvedValue(toolCall(VALID_PLAN_ARGS));
  generateImageSpy.mockImplementation(imageSucceeds);

  getProviderArgs.length = 0;
  mockResolveArgs.length = 0;

  /*
   * SA F-1: the spy RECORDS its argument instead of ignoring it. T2-S's
   * `mockReturnValue` did not, so a site switched to another provider stayed
   * green — SA mutation-proved it on briefing, QA reproduced it on leads.
   */
  jest.spyOn(ProviderFactory, 'getProvider').mockImplementation(((name: unknown) => {
    getProviderArgs.push(name);
    return { chatCompletion } as unknown as BaseAIProvider;
  }) as never);
  jest.spyOn(ProviderFactory, 'isProviderAvailable').mockReturnValue(true);
  jest.spyOn(ProviderFactory, 'getOpenAI').mockReturnValue({
    generateImage: (...args: unknown[]) => generateImageSpy(...args),
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ AC-2 */

describe('T3-S: the request each Step 3 call site puts on the wire (AC-2)', () => {
  /*
   * The planner's request, as §10.1 records it and as `Planner.ts` sent it
   * before Layer 2: gpt-4o-mini from `bizchat_planner_model` (seeded into the
   * chat row), temperature 0, the plan tool, `tool_choice: 'required'`,
   * frequency_penalty 0.3 and the 1,500-token cap.
   */
  it('chat/planner', async () => {
    const outcome = await drivePlanner();

    expect(outcome.ok).toBe(true);
    // The count is half the assertion: a call that stops being made, or a
    // second site for the same call, changes it.
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(boundaryCalls(chatCompletion)).toMatchSnapshot();
  });

  it('chat/analysis', async () => {
    chatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Revenue is {s1.value}.' } }],
    });

    await driveAnalysis();

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(boundaryCalls(chatCompletion)).toMatchSnapshot();
  });

  it('images/image_generation', async () => {
    await expect(driveImages()).resolves.toMatchObject({ ok: true });

    expect(generateImageSpy).toHaveBeenCalledTimes(1);
    // The third argument is the price resolver — a closure, so it records as
    // an empty object. What it was keyed on is proved by the RC-W4 case below.
    expect(boundaryCalls(generateImageSpy)).toMatchSnapshot();
  });
});

/**
 * SA F-1 and QA D2-1 — the two things the snapshot structurally cannot record.
 *
 * Kept OUT of the snapshot deliberately: the snapshot has to be capturable
 * against the unwired sources, and unwired sources call no resolver at all.
 * These assertions are about the wiring, so they belong beside it, not in it.
 */
describe('T3-S: each site asks for its own settings key, from openai', () => {
  /*
   * The SET of providers asked for, not the list: a turn legitimately asks the
   * factory more than once — the plan cache's lookup embedding is a separate,
   * DEC-3-excluded call on the same provider. The set is what catches the
   * mutation that matters (a site switched to another provider puts a second
   * name in it); the list would only have caught how many times anyone asked.
   */
  it('chat/planner', async () => {
    await drivePlanner();
    expect([...new Set(getProviderArgs)]).toEqual(['openai']);
    expect(mockResolveArgs).toEqual([['chat', 'planner']]);
  });

  it('chat/analysis', async () => {
    chatCompletion.mockResolvedValue({ choices: [{ message: { content: 'Revenue is {s1.value}.' } }] });
    await driveAnalysis();
    expect([...new Set(getProviderArgs)]).toEqual(['openai']);
    expect(mockResolveArgs).toEqual([['chat', 'analysis']]);
  });

  it('images/image_generation', async () => {
    await driveImages();
    expect(mockResolveArgs).toEqual([['images', 'image_generation']]);
  });
});

/* --------------------------------------------- D2-2: the model is USED */

describe('T3-S: each site uses the model its own row resolves (QA D2-2)', () => {
  it('chat/planner sends an overridden model', async () => {
    mockGetByKeys.mockResolvedValue(
      seededRows((rows) => {
        (rows.chat.calls as Record<string, Record<string, unknown>>).planner.model = 'gpt-4o';
      })
    );

    await drivePlanner();

    expect(chatCompletion.mock.calls[0][0].model).toBe('gpt-4o');
  });

  it('chat/analysis sends an overridden model, and the planner\'s override does not leak into it', async () => {
    chatCompletion.mockResolvedValue({ choices: [{ message: { content: 'Revenue is {s1.value}.' } }] });
    mockGetByKeys.mockResolvedValue(
      seededRows((rows) => {
        const calls = rows.chat.calls as Record<string, Record<string, unknown>>;
        calls.analysis.model = 'gpt-4o';
        calls.planner.model = 'gpt-4o-mini';
      })
    );

    await driveAnalysis();

    expect(chatCompletion.mock.calls[0][0].model).toBe('gpt-4o');
  });

  it('images/image_generation sends an overridden model', async () => {
    mockGetByKeys.mockResolvedValue(
      seededRows((rows) => {
        rows.images.model = OVERRIDE_IMAGE_MODEL;
      })
    );

    await driveImages();

    expect(generateImageSpy.mock.calls[0][0].model).toBe(OVERRIDE_IMAGE_MODEL);
  });
});

/* ------------------------- D2-3 / RC-W6 / RC-W4: built inside the retry */

describe('T3-S: a refused model is retried on the code default, with the request rebuilt', () => {
  it('chat/planner retries on the default, and the REPAIR call uses the model that ran (RC-W6)', async () => {
    mockGetByKeys.mockResolvedValue(
      seededRows((rows) => {
        (rows.chat.calls as Record<string, Record<string, unknown>>).planner.model = 'gpt-4o';
      })
    );

    chatCompletion
      // 1. the configured model is refused
      .mockRejectedValueOnce(modelNotFound())
      // 2. the fallback attempt runs on the code default, and returns
      //    unparseable arguments, which buys a repair
      .mockResolvedValueOnce(toolCall('{not json'))
      // 3. the repair
      .mockResolvedValueOnce(toolCall(VALID_PLAN_ARGS));

    const outcome = await drivePlanner();

    expect(outcome.ok).toBe(true);
    expect(chatCompletion).toHaveBeenCalledTimes(3);

    const models = chatCompletion.mock.calls.map((call) => call[0].model);
    // The refused model is never sent again — including by the repair, which is
    // the whole of RC-W6: without reassigning the loop's model, attempt 3 would
    // re-send `gpt-4o` and fail for the same reason.
    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini', 'gpt-4o-mini']);

    // FR-13: diagnostics report the model that RAN, not the one that was refused.
    expect(outcome.diagnostics.model).toBe('gpt-4o-mini');
    expect(outcome.diagnostics.repairAttempted).toBe(true);
  });

  it('chat/analysis retries on the default', async () => {
    mockGetByKeys.mockResolvedValue(
      seededRows((rows) => {
        (rows.chat.calls as Record<string, Record<string, unknown>>).analysis.model = 'gpt-4o';
      })
    );

    chatCompletion
      .mockRejectedValueOnce(modelNotFound())
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Revenue is {s1.value}.' } }] });

    const sentence = await driveAnalysis();

    expect(sentence).toBe('Revenue is {s1.value}.');
    expect(chatCompletion.mock.calls.map((call) => call[0].model)).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  /**
   * RC-W4, the half that costs money.
   *
   * The price resolver is built INSIDE the attempt, from the same `model` the
   * request carries. If it were built outside, the retried image would be
   * priced as the model that was refused — or, because the price table is keyed
   * by model name, at $0, and the spend would vanish from the ledger.
   */
  it('images price the model that RAN, both with an override and after a retry', async () => {
    mockGetByKeys.mockResolvedValue(
      seededRows((rows) => {
        rows.images.model = OVERRIDE_IMAGE_MODEL;
      })
    );

    // First: no retry. The request model and the price key agree.
    await driveImages();
    expect(generateImageSpy.mock.calls[0][0].model).toBe(OVERRIDE_IMAGE_MODEL);
    expect(lastLoggedPrice()).toBe(PRICE_OVERRIDE_MODEL);

    // Then: the override is refused, and the default runs.
    logged.length = 0;
    generateImageSpy.mockReset();
    __resetModelFallbackForTests();
    __resetBosLlmSettingsForTests();
    generateImageSpy.mockRejectedValueOnce(modelNotFound()).mockImplementationOnce(imageSucceeds);

    await driveImages();

    const models = generateImageSpy.mock.calls.map((call) => call[0].model);
    expect(models).toEqual([OVERRIDE_IMAGE_MODEL, IMAGE_GENERATION_CONFIG_DEFAULTS.model]);
    /*
     * And the price follows the model that RAN. This is the assertion RC-W4
     * exists for: with the resolver built OUTSIDE the attempt it would still be
     * keyed on the overridden model here, and a default-model image would be
     * billed at the other model's rate — or, with no row for the stale key, at
     * $0, and the spend would disappear from the ledger.
     */
    expect(lastLoggedPrice()).toBe(PRICE_DEFAULT_MODEL);
  });
});

/* ------------------------------------------------ D3-1: FR-13 reporting sites */

/**
 * FR-13 at EVERY path that reports a model, not just the one QA happened to
 * drive (QA D3-1).
 *
 * `Planner.ts` names the model in nine places: the two `diagnostics(...)`
 * returns, five `fail(...)` returns, the plan-cache `store({ model })`, and the
 * catch. Only the repair case was pinned, so a sentinel model at any of the
 * other eight left 891/891 green — including `:605`, which is the whole of SA
 * finding 5 from this round, and `:709`, the cache write this step's own scope
 * names.
 *
 * Every case below runs the same shape: the row configures a model the provider
 * REFUSES, the FR-11 fallback runs the call on the code default, and whatever
 * that path reports must be the default — the model that ran — and never the
 * configured one. A sentinel anywhere fails here.
 */
describe('D3-1: every path that reports a model reports the one that RAN (FR-13)', () => {
  const CONFIGURED = 'gpt-4o';
  const DEFAULT = 'gpt-4o-mini';

  /** The planner's row, with a model the provider will refuse. */
  function refusedModelRows() {
    return seededRows((rows) => {
      (rows.chat.calls as Record<string, Record<string, unknown>>).planner.model = CONFIGURED;
    });
  }

  /**
   * First call: the configured model is refused, so the fallback runs on the
   * code default. Every later call is already on the default.
   */
  function refuseThen(...responses: unknown[]) {
    chatCompletion.mockReset();
    chatCompletion.mockRejectedValueOnce(modelNotFound());
    for (const response of responses) chatCompletion.mockResolvedValueOnce(response);
    // Anything beyond what a case enumerates repeats the last answer.
    if (responses.length > 0) chatCompletion.mockResolvedValue(responses[responses.length - 1]);
  }

  beforeEach(() => {
    mockGetByKeys.mockResolvedValue(refusedModelRows());
    __resetBosLlmSettingsForTests();
    __resetModelFallbackForTests();
  });

  it(':620 — a clarification reports the model that ran', async () => {
    refuseThen(toolCall(JSON.stringify({ clarification: 'Which client did you mean?' })));

    const outcome = await drivePlanner();

    expect(outcome.ok).toBe(true);
    expect(outcome.clarification).toBe('Which client did you mean?');
    expect(outcome.diagnostics.model).toBe(DEFAULT);
  });

  it(':709 — the plan cache stores the model that ran', async () => {
    const store = jest.spyOn(PlanCache.prototype, 'store').mockResolvedValue(undefined);
    refuseThen(toolCall(VALID_PLAN_ARGS));

    const outcome = await drivePlanner();

    expect(outcome.ok).toBe(true);
    expect(store).toHaveBeenCalledTimes(1);
    // A cache entry keyed to a model that never ran would be replayed as if it
    // had been produced by one — this is the write that makes the plan cache
    // comparable across models at all.
    expect(store.mock.calls[0][0]).toMatchObject({ model: DEFAULT });
    expect(outcome.diagnostics.model).toBe(DEFAULT);
  });

  it(':558 — "the planner did not return a plan" reports the model that ran', async () => {
    refuseThen({ choices: [{ message: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const outcome = await drivePlanner();

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('The planner did not return a plan.');
    expect(outcome.diagnostics.model).toBe(DEFAULT);
  });

  it(':592 — "malformed arguments twice" reports the model that ran', async () => {
    refuseThen(toolCall('{not json'), toolCall('{still not json'));

    const outcome = await drivePlanner();

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('The planner returned malformed arguments twice.');
    expect(outcome.diagnostics.model).toBe(DEFAULT);
  });

  /**
   * `:605`, the catch — SA finding 5's entire fix, which until now was defended
   * by nothing.
   *
   * The configured model is refused, the fallback runs on the default, and THAT
   * attempt throws something the retry is not allowed to swallow (a 500). The
   * loop's `model` has not been updated yet at that point, so without
   * `lastModelOnWire` the failure would name `gpt-4o` — a model that never ran —
   * which is precisely what FR-13 exists to prevent, and a failure is when
   * somebody actually reads the diagnostics.
   */
  it(':605 — a throw from the FALLBACK attempt reports the model that ran, not the refused one', async () => {
    chatCompletion.mockReset();
    chatCompletion
      .mockRejectedValueOnce(modelNotFound())
      .mockRejectedValueOnce(Object.assign(new Error('upstream exploded'), { status: 500 }));

    const outcome = await drivePlanner();

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('upstream exploded');
    expect(outcome.diagnostics.model).toBe(DEFAULT);
    expect(outcome.diagnostics.model).not.toBe(CONFIGURED);
  });

  it(':781 — a plan accepted with soft problems reports the model that ran', async () => {
    // One read and no sentence: "answer.text is required." is SOFT, so after
    // the repairs are spent the plan ships rather than failing the turn.
    const noSentence = JSON.stringify({ steps: [{ id: 's1', op: 'find', entity: 'contacts' }] });
    refuseThen(toolCall(noSentence));

    const outcome = await drivePlanner();

    expect(outcome.ok).toBe(true);
    expect(outcome.diagnostics.repairAttempted).toBe(true);
    expect(outcome.diagnostics.model).toBe(DEFAULT);
  });

  it(':792 — "plan failed validation" reports the model that ran', async () => {
    const unknownEntity = JSON.stringify({
      steps: [{ id: 's1', op: 'find', entity: 'not_a_real_entity' }],
      answer: { text: 'You have {s1.count}.', primary_step: 's1' },
    });
    refuseThen(toolCall(unknownEntity));

    const outcome = await drivePlanner();

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/^Plan failed validation:/);
    expect(outcome.diagnostics.model).toBe(DEFAULT);
  });

  /**
   * `:802` — "Planner exhausted attempts" — is DEFENSIVE AND UNREACHABLE, and
   * this test says so rather than pretending to drive it.
   *
   * Every branch inside the loop either returns or, on the last iteration,
   * falls through to `:792`: the malformed-JSON path only `continue`s on
   * `attempt === 0`, and the validation path only on `attempt < 2`. So no input
   * reaches the statement after the loop, and a behavioural test for it cannot
   * exist — a sentinel there is invisible to every case above, which is worth
   * knowing rather than glossing.
   *
   * What IS checked is the thing that would make it wrong: it must read the
   * same `model` variable as its neighbours, not a literal or a stale one.
   */
  it(':802 — unreachable, so its model reference is checked by reading', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../bizql/planner/Planner.ts'),
      'utf8'
    );
    const tail = source.slice(source.indexOf("return this.fail('Planner exhausted attempts.'"));
    expect(tail).not.toBe('');
    // The bare `model,` shorthand — not `model: '…'` and not `settings.model`.
    expect(tail.slice(0, 200)).toMatch(/^\s*return this\.fail\('Planner exhausted attempts\.', \{\s*\r?\n\s*model,/);
  });
});
