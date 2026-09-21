/**
 * T1-14 (Layer 2 Step 1) — the AC-2 "before" record: what every in-scope
 * Business OS call sends to the provider TODAY.
 *
 * AC-2 asks for one thing: after this layer, every call must send the same
 * `{ provider, model, temperature }` it sends now. This file records the
 * "before" side and proves it three ways:
 *
 *   A. **Evidence.** For each call, today's value is still written where the
 *      inventory says it is — read out of the call site's own source. This is
 *      what keeps the policy table honest: it cannot drift from the code
 *      without this test failing.
 *   B. **Code defaults.** With no configuration at all, the resolver returns
 *      exactly that table. So a missing, broken or unreadable row behaves like
 *      today (FR-6).
 *   C. **Seeded rows.** With the eight rows the migration writes, the resolver
 *      returns the same table again. So applying the seed changes nothing
 *      (FR-16).
 *
 * The committed snapshot is the record itself. Steps 2 and 3 move each call
 * site onto the resolver; their T2-S / T3-S assertions compare the request the
 * site really makes with this table, and the evidence check below is replaced
 * as the last literal leaves each file (Step 4's FR-15 gate then forbids them).
 */

const mockGetPricing = jest.fn();
jest.mock('@/lib/ai/pricing', () => ({
  getPricing: (...args: unknown[]) => mockGetPricing(...args),
  calculateCostSync: () => 0,
  calculateCost: async () => 0,
  hasPricing: async () => true,
}));

const mockGetByKeys = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  return {
    ...actual,
    systemConfigRepository: {
      getByKeys: (...args: unknown[]) => mockGetByKeys(...args),
      getImageGenerationConfig: async () => ({
        ...actual.IMAGE_GENERATION_CONFIG_DEFAULTS,
        pricesUsd: {},
      }),
    },
  };
});

import * as fs from 'fs';
import * as path from 'path';

import { BOS_LLM_AREAS, type BosLlmArea } from '../callCatalog';
import { __resetBosLlmSettingsForTests, resolveBosLlmSettings } from '../modelSettings';
import { bosLlmAreaKey, bosLlmSettingsCallNames } from '../modelSettingsPolicy';
import { SEEDED_ROWS } from '../__fixtures__/seededRows';
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider';
import { IMAGE_GENERATION_CONFIG_DEFAULTS } from '@/lib/repositories/SystemConfigRepository';

const ROOT = path.resolve(__dirname, '../../../..');

/** What one call sends today. `temperature: null` means it sends none. */
interface CallParams {
  provider: 'openai';
  model: string;
  temperature: number | null;
}

/**
 * Where today's value is written, so the table cannot drift from the code.
 * `near` is found in `file`; `contains` must appear within `window` lines of it.
 * `absent` must NOT appear in that window (used for "sends no temperature").
 */
interface Evidence {
  file: string;
  near: string;
  contains?: string;
  absent?: string;
  window?: number;
  /**
   * Which side of the anchor the request is built on. Most sites build the
   * request first and name the call last (`before`, the default); the
   * onboarding extractors name the call first and build the request after it
   * (`after`). It decides how the window is clamped — see `evidenceRegion`.
   */
  side?: 'before' | 'after';
  /** Must match somewhere in the block. Used for `model,` — a bare pass-through. */
  matches?: RegExp;
  /**
   * The block must assign the model EXACTLY once (D-Q1c). A second `model:`
   * later in the same object literal silently wins in JavaScript, and the
   * recorded one is still there for a `toContain` to find.
   */
  singleModel?: boolean;
}

/**
 * `model: …` or the shorthand `model,` — at the start of a line, or after the
 * `{` / `,` of an inline object literal (the image call builds its request on
 * one line). `model_name:` and `params.model` are deliberately not matched.
 */
const MODEL_ASSIGNMENT = /(?:^|[{(,]\s*)model\s*[,:]/gm;

interface CallRecord {
  params: CallParams;
  evidence: Evidence[];
  /** Set when the value comes from a stored key rather than a literal (F-3). */
  storedKey?: string;
}

const PLANNER = 'lib/business-os/bizql/planner/Planner.ts';
const ANALYSIS = 'lib/business-os/bizql/analyse/AnalysisService.ts';
const INSIGHTS = 'lib/business-os/insight/repository/InsightRepository.ts';
const BRIEFING = 'lib/business-os/briefing/BriefingNarrator.ts';
const WEBSITE_GEN = 'lib/services/WebsiteGenerationService.ts';
const LANDING = 'app/api/website/landing-pages/generate/route.ts';
const WEBSITE_AI = 'lib/services/WebsiteAIContentService.ts';
const INTAKE = 'lib/services/IntakeGenerationService.ts';
const INFER = 'app/api/intake/form/infer-question/route.ts';
const LEADS = 'lib/business-os/leads/LeadReplyRecommender.ts';
const ONBOARDING = 'lib/services/OnboardingConversationManager.ts';
const IMAGES = 'lib/services/GeneratedImageService.ts';

function literalCall(
  file: string,
  callName: string,
  model: string,
  temperature: number,
  modelSource = `model: '${model}',`
): CallRecord {
  return {
    params: { provider: 'openai', model, temperature },
    evidence: [
      { file, near: `callName: '${callName}'`, contains: modelSource, window: 45, singleModel: true },
      { file, near: `callName: '${callName}'`, contains: `temperature: ${temperature},`, window: 45 },
    ],
  };
}

/**
 * The three calls whose model is READ FROM CONFIGURATION and passed as a
 * variable (D-Q1a).
 *
 * Their evidence used to anchor on the config read's fallback literal, which
 * says nothing about what the request actually carries: `model,` could become
 * `model: 'gpt-4o',` and every test stayed green. So each of them also asserts
 * that the request object passes the resolved variable, unadorned, exactly
 * once.
 */
function passesResolvedVariable(file: string, near: string, window = 45): Evidence {
  return { file, near, matches: /^\s*model,\s*$/m, window, singleModel: true };
}

/** The inventory, as code. One entry per configurable call. */
const TODAY: { [A in BosLlmArea]: Record<string, CallRecord> } = {
  chat: {
    planner: {
      params: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0 },
      storedKey: 'bizchat_planner_model',
      evidence: [
        { file: PLANNER, near: "'bizchat_planner_model'", contains: "'gpt-4o-mini'", window: 4 },
        { file: PLANNER, near: "tool_choice: 'required',", contains: 'temperature: 0,', window: 4 },
        passesResolvedVariable(PLANNER, "tool_choice: 'required',", 4),
      ],
    },
    analysis: {
      params: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0 },
      storedKey: 'bizchat_analysis_model',
      evidence: [
        { file: ANALYSIS, near: "'bizchat_analysis_model'", contains: "'gpt-4o-mini'", window: 4 },
        { file: ANALYSIS, near: "callName: 'analysis'", contains: 'temperature: 0,', window: 45 },
        passesResolvedVariable(ANALYSIS, "callName: 'analysis'"),
      ],
    },
  },
  insights: {
    insight_content: literalCall(INSIGHTS, 'insight_content', 'gpt-4o-mini', 0.3),
    correlated_insight: literalCall(INSIGHTS, 'correlated_insight', 'gpt-4o-mini', 0.4),
    health_summary: literalCall(INSIGHTS, 'health_summary', 'gpt-4o-mini', 0.5),
  },
  briefing: {
    daily_narration: literalCall(
      BRIEFING,
      'daily_narration',
      'gpt-4o-mini',
      0.3,
      'model: OPENAI_MODELS.GPT_4O_MINI,'
    ),
  },
  website: {
    full_site: literalCall(WEBSITE_GEN, 'full_site', 'gpt-4o', 0.7),
    landing_page: literalCall(LANDING, 'landing_page', 'gpt-4o', 0.7),
    field_regenerate: literalCall(WEBSITE_AI, 'field_regenerate', 'gpt-4o-mini', 0.7),
    testimonial_enhance: literalCall(WEBSITE_AI, 'testimonial_enhance', 'gpt-4o-mini', 0.5),
    hero_content: literalCall(WEBSITE_AI, 'hero_content', 'gpt-4o-mini', 0.7),
    about_content: literalCall(WEBSITE_AI, 'about_content', 'gpt-4o-mini', 0.7),
    faq_content: literalCall(WEBSITE_AI, 'faq_content', 'gpt-4o-mini', 0.7),
    features_content: literalCall(WEBSITE_AI, 'features_content', 'gpt-4o-mini', 0.7),
  },
  intake: {
    form_generation: {
      params: { provider: 'openai', model: 'gpt-4o', temperature: 0.3 },
      evidence: [
        { file: INTAKE, near: "const MODEL = 'gpt-4o';", contains: "const MODEL = 'gpt-4o';", window: 0 },
        { file: INTAKE, near: "callName: 'form_generation'", contains: 'model: MODEL,', window: 45, singleModel: true },
        { file: INTAKE, near: "callName: 'form_generation'", contains: 'temperature: 0.3,', window: 45 },
      ],
    },
    question_inference: literalCall(INFER, 'question_inference', 'gpt-4o-mini', 0.2),
  },
  leads: {
    reply_recommendation: {
      params: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2 },
      storedKey: 'lead_reply_recommender_model',
      evidence: [
        { file: LEADS, near: "getString(MODEL_KEY, 'gpt-4o-mini')", contains: "getString(MODEL_KEY, 'gpt-4o-mini')", window: 2 },
        { file: LEADS, near: "callName: 'reply_recommendation'", contains: 'temperature: 0.2,', window: 45 },
        passesResolvedVariable(LEADS, "callName: 'reply_recommendation'"),
      ],
    },
  },
  onboarding: {
    business_story_extraction: onboardingExtractor('business_story_extraction'),
    client_workflow_extraction: onboardingExtractor('client_workflow_extraction'),
    client_tracking_extraction: onboardingExtractor('client_tracking_extraction'),
    adjustment_intent_extraction: onboardingExtractor('adjustment_intent_extraction'),
  },
  images: {
    image_generation: {
      params: { provider: 'openai', model: IMAGE_GENERATION_CONFIG_DEFAULTS.model, temperature: null },
      storedKey: 'image_generation_model',
      evidence: [
        // The service already takes its model from configuration, and sends no
        // temperature — images do not have one.
        { file: IMAGES, near: 'model: config.model,', contains: 'model: config.model,', window: 0, singleModel: true },
        { file: IMAGES, near: 'model: config.model,', absent: 'temperature', window: 3 },
      ],
    },
  },
};

/** All four send `model: 'gpt-4o'` and NO temperature (F-7, SA V-2). */
function onboardingExtractor(callName: string): CallRecord {
  return {
    params: { provider: 'openai', model: 'gpt-4o', temperature: null },
    evidence: [
      // These four name the call first and build the request after it.
      { file: ONBOARDING, near: `callContext(owner, '${callName}')`, contains: "model: 'gpt-4o',", window: 8, side: 'after' },
      { file: ONBOARDING, near: `callContext(owner, '${callName}')`, absent: 'temperature', window: 10, side: 'after' },
    ],
  };
}

function seededRows() {
  return {
    data: BOS_LLM_AREAS.map((area) => ({
      key: bosLlmAreaKey(area),
      value: SEEDED_ROWS[area],
      category: 'business_os_llm',
      updated_at: '2026-10-03T00:00:00.000Z',
    })),
    error: null,
  };
}

/** Every configurable call, as `area/call`. */
const ALL_CALLS: Array<[BosLlmArea, string]> = BOS_LLM_AREAS.flatMap((area) =>
  bosLlmSettingsCallNames(area).map((callName) => [area, callName] as [BosLlmArea, string])
);

async function resolveAll(): Promise<Record<string, CallParams>> {
  const out: Record<string, CallParams> = {};
  for (const [area, callName] of ALL_CALLS) {
    // eslint-disable-next-line no-await-in-loop
    const settings = await resolveBosLlmSettings(area as never, callName as never);
    out[`${area}/${callName}`] = {
      provider: settings.provider,
      model: settings.model,
      temperature: settings.temperature === undefined ? null : settings.temperature,
    };
  }
  return out;
}

beforeEach(() => {
  mockGetPricing.mockReset().mockResolvedValue({ input: 0.0025, output: 0.01 });
  mockGetByKeys.mockReset().mockResolvedValue({ data: [], error: null });
  __resetBosLlmSettingsForTests();
});

// ---------------------------------------------------------------------------
// A. The table is what the call sites actually contain today
// ---------------------------------------------------------------------------

/**
 * A source file with its line endings normalised.
 *
 * The working tree can be checked out with CRLF, and these assertions compare
 * multi-line snippets of real source.
 */
function readNormalised(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').split(/\r?\n/).join('\n');
}

/**
 * Lines that begin one call's block: where a site names the call it is making.
 * They are what BOUNDS each evidence window (S1-2).
 */
const CALL_BOUNDARY = /callName: '|callContext\(owner, '/;

/**
 * The lines an evidence item may be satisfied by.
 *
 * A plain window is not sound: SA showed four calls whose evidence was
 * satisfied by a SIBLING call's identical literal forty lines away
 * (`WebsiteAIContentService` builds six near-identical requests in one file).
 * So the window is clamped to the anchor's own call block:
 *
 *   - anchor ON a boundary (`callName: 'x'`): the block is everything after the
 *     PREVIOUS boundary up to and including this one — every site builds its
 *     request before naming the call, so a sibling's literal now sits on the
 *     other side of a boundary and is out of reach.
 *   - anchor elsewhere (a config key, a module constant, `model: config.model`):
 *     that string is unique in its file, so the surrounding pair of boundaries
 *     is bound enough.
 */
function evidenceRegion(lines: string[], anchor: number, item: Evidence): string {
  const boundaries = lines.reduce<number[]>(
    (acc, line, index) => (CALL_BOUNDARY.test(line) ? [...acc, index] : acc),
    []
  );
  const previous = boundaries.filter((index) => index < anchor).pop() ?? -1;
  const next = boundaries.find((index) => index > anchor) ?? lines.length;
  const window = item.window ?? 20;

  if (item.side === 'after') {
    // The call is named first and the request built after it: the block runs
    // from the anchor to the next boundary, never into it.
    return lines.slice(anchor, Math.min(anchor + window, next - 1) + 1).join('\n');
  }

  const start = Math.max(0, anchor - window, previous + 1);
  const end = boundaries.includes(anchor)
    ? anchor
    : Math.min(anchor + window, next - 1);

  return lines.slice(start, end + 1).join('\n');
}

describe('A: every recorded value is still written at its call site', () => {
  it.each(ALL_CALLS)('%s/%s', (area, callName) => {
    const record = TODAY[area][callName];
    expect(record).toBeDefined();

    for (const item of record.evidence) {
      const lines = fs.readFileSync(path.join(ROOT, item.file), 'utf8').split(/\r?\n/);
      const anchor = lines.findIndex((line) => line.includes(item.near));
      expect({ file: item.file, near: item.near, found: anchor >= 0 }).toEqual({
        file: item.file,
        near: item.near,
        found: true,
      });

      // D-Q1c: `findIndex` takes the first match, so a SECOND call site for the
      // same call name would be invisible. Every anchor must be unique in its
      // file; if a call ever legitimately gains a second site, list both here
      // rather than letting one of them go unchecked.
      const occurrences = lines.filter((line) => line.includes(item.near)).length;
      expect({ file: item.file, near: item.near, occurrences }).toEqual({
        file: item.file,
        near: item.near,
        occurrences: 1,
      });

      const text = evidenceRegion(lines, anchor, item);
      if (item.contains) expect(text).toContain(item.contains);
      if (item.absent) expect(text).not.toContain(item.absent);
      if (item.matches) expect(text).toMatch(item.matches);
      if (item.singleModel) {
        // A duplicate key later in the same object literal wins in JavaScript
        // and leaves the recorded one in place for a `toContain` to find.
        expect({ call: `${area}/${callName}`, assignments: text.match(MODEL_ASSIGNMENT) ?? [] }).toEqual({
          call: `${area}/${callName}`,
          assignments: [expect.any(String)],
        });
      }
    }
  });

  /**
   * D-Q1b: twenty of the twenty-two calls reach the provider through one of two
   * shared builders, which no per-call window can see — forcing a model in
   * `complete()` changes twelve calls at once and leaves every call site's own
   * file untouched. Both builders must forward what they are given and invent
   * nothing.
   */
  describe('the shared request builders forward what they are given', () => {
    it('complete() passes the caller\'s model through and synthesises no temperature', () => {
      const source = readNormalised('lib/ai/providerFactory.ts');
      const start = source.indexOf('// Build chat completion params');
      expect(start).toBeGreaterThan(-1);
      const end = source.indexOf('const result = await provider.chatCompletion(', start);
      expect(end).toBeGreaterThan(start);
      const builder = source.slice(start, end);

      expect(builder).toContain('model: params.model,');
      expect(builder).toContain('messages: params.messages,');
      // A temperature is forwarded only when the caller set one — which is what
      // lets the four onboarding extractors send none at all (F-7).
      expect(builder).toContain('if (params.temperature !== undefined) {');
      expect(builder).toContain('chatParams.temperature = params.temperature;');
      // No default, no literal: `params.temperature ?? 0.9` or `temperature: 0.7`
      // would give twelve calls a value they never sent.
      expect(builder).not.toMatch(/temperature\s*[:=][^;\n]*\?\?/);
      expect(builder).not.toMatch(/temperature\s*[:=]\s*[0-9]/);
      // And nothing may pin the model.
      expect(builder).not.toMatch(/model\s*:\s*['"`]/);
    });

    it('chatCompletion() spreads the caller\'s params and pins nothing', () => {
      // Normalised: the working tree may be checked out with CRLF endings.
      const source = readNormalised('lib/ai/providers/openaiProvider.ts');
      const start = source.indexOf('async chatCompletion(');
      expect(start).toBeGreaterThan(-1);
      const trackingCall = source.indexOf('return this.callWithTracking(', start);
      expect(trackingCall).toBeGreaterThan(start);
      const method = source.slice(start, trackingCall + 400);

      expect(method).toContain('const nonStreamParams = { ...params, stream: false as const };');
      // The model that is sent and the model that is tracked are the caller's.
      expect(method).toContain("'openai',\n      params.model,");
      expect(method).not.toMatch(/model\s*:\s*['"`]/);
      // The only parameter it rewrites is the max-tokens NAME, for the models
      // that require it; it never adds a sampling parameter.
      expect(method).not.toMatch(/temperature/);
    });
  });

  it('resolves the briefing constant to the model the table records', () => {
    expect(OPENAI_MODELS.GPT_4O_MINI).toBe(TODAY.briefing.daily_narration.params.model);
  });

  it('names a stored key for exactly the calls the inventory says read one (F-3)', () => {
    const withStoredKey = ALL_CALLS.filter(([area, call]) => TODAY[area][call].storedKey).map(
      ([area, call]) => `${area}/${call}`
    );
    expect(withStoredKey.sort()).toEqual([
      'chat/analysis',
      'chat/planner',
      'images/image_generation',
      'leads/reply_recommendation',
    ]);
  });
});

// ---------------------------------------------------------------------------
// B + C. The resolver reproduces the table, with and without the seed
// ---------------------------------------------------------------------------

describe('B: with no configuration, the resolver returns today (FR-6)', () => {
  it('matches the recorded table, call by call', async () => {
    const resolved = await resolveAll();
    for (const [area, callName] of ALL_CALLS) {
      expect({ call: `${area}/${callName}`, params: resolved[`${area}/${callName}`] }).toEqual({
        call: `${area}/${callName}`,
        params: TODAY[area][callName].params,
      });
    }
  });
});

describe('C: with the seeded rows, the resolver returns the same (FR-16, AC-2)', () => {
  it('matches the recorded table, call by call', async () => {
    mockGetByKeys.mockResolvedValue(seededRows());
    const resolved = await resolveAll();
    for (const [area, callName] of ALL_CALLS) {
      expect({ call: `${area}/${callName}`, params: resolved[`${area}/${callName}`] }).toEqual({
        call: `${area}/${callName}`,
        params: TODAY[area][callName].params,
      });
    }
  });

  it('is the committed AC-2 "before" snapshot', async () => {
    mockGetByKeys.mockResolvedValue(seededRows());
    expect(await resolveAll()).toMatchSnapshot();
  });
});
