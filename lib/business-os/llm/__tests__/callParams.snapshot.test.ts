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
 * The committed snapshot is the record itself.
 *
 * LEG (A) IS A DRIFT ALARM, NOT A SOUNDNESS PROOF (SA ruling, 2026-09-21).
 * Eleven false negatives were found in it, all of one class: the recorded text
 * is still there but is not what reaches the provider. It gets no further
 * hardening, and each call's entry is DELETED as its site is wired, because the
 * guarantee then lives at the provider boundary instead:
 *
 *   - Step 2 (wired): `callParams.boundary.step2.test.ts` — spies at
 *     `chatCompletion` / `complete` and asserts the whole request object plus
 *     the call count for all nineteen non-chat call sites.
 *   - Step 3 (still listed below): chat planner, chat analysis and images.
 *
 * Legs (B) and (C) still cover ALL twenty-two calls: they are about the
 * resolver reproducing the table, not about reading source.
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
  /**
   * Leg (A) evidence. ABSENT once the call site is wired to the resolver: the
   * literal has left the file and the boundary test owns the guarantee.
   */
  evidence?: Evidence[];
  /** Set when the value comes from a stored key rather than a literal (F-3). */
  storedKey?: string;
}

const PLANNER = 'lib/business-os/bizql/planner/Planner.ts';
const ANALYSIS = 'lib/business-os/bizql/analyse/AnalysisService.ts';
const IMAGES = 'lib/services/GeneratedImageService.ts';

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
/** A call whose site now takes its parameters from the resolver (leg A retired). */
function wired(model: string, temperature: number | null): CallRecord {
  return { params: { provider: 'openai', model, temperature } };
}

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
  // Wired in Step 2. Their requests are proved at the provider boundary by
  // `callParams.boundary.step2.test.ts`; the literals have left their files.
  insights: {
    insight_content: wired('gpt-4o-mini', 0.3),
    correlated_insight: wired('gpt-4o-mini', 0.4),
    health_summary: wired('gpt-4o-mini', 0.5),
  },
  briefing: {
    daily_narration: wired('gpt-4o-mini', 0.3),
  },
  website: {
    full_site: wired('gpt-4o', 0.7),
    landing_page: wired('gpt-4o', 0.7),
    field_regenerate: wired('gpt-4o-mini', 0.7),
    testimonial_enhance: wired('gpt-4o-mini', 0.5),
    hero_content: wired('gpt-4o-mini', 0.7),
    about_content: wired('gpt-4o-mini', 0.7),
    faq_content: wired('gpt-4o-mini', 0.7),
    features_content: wired('gpt-4o-mini', 0.7),
  },
  intake: {
    form_generation: wired('gpt-4o', 0.3),
    question_inference: wired('gpt-4o-mini', 0.2),
  },
  leads: {
    // No longer reads `lead_reply_recommender_model`: the seed copied it into
    // the leads area row and the call resolves from there (Step 2).
    reply_recommendation: wired('gpt-4o-mini', 0.2),
  },
  onboarding: {
    business_story_extraction: wired('gpt-4o', null),
    client_workflow_extraction: wired('gpt-4o', null),
    client_tracking_extraction: wired('gpt-4o', null),
    adjustment_intent_extraction: wired('gpt-4o', null),
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

/** The calls whose site still writes its own model or temperature (Step 3). */
const UNWIRED_CALLS: Array<[BosLlmArea, string]> = ALL_CALLS.filter(
  ([area, callName]) => TODAY[area][callName].evidence !== undefined
);

describe('A: every recorded value is still written at its call site', () => {
  it('covers exactly the calls Step 2 has not wired yet', () => {
    expect(UNWIRED_CALLS.map(([area, call]) => `${area}/${call}`).sort()).toEqual([
      'chat/analysis',
      'chat/planner',
      'images/image_generation',
    ]);
  });

  it.each(UNWIRED_CALLS)('%s/%s', (area, callName) => {
    const record = TODAY[area][callName];
    expect(record).toBeDefined();

    for (const item of record.evidence ?? []) {
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

  it('names a stored key for exactly the calls the inventory says read one (F-3)', () => {
    const withStoredKey = ALL_CALLS.filter(([area, call]) => TODAY[area][call].storedKey).map(
      ([area, call]) => `${area}/${call}`
    );
    // `leads/reply_recommendation` left this list in Step 2: its two keys were
    // copied into the leads area row by the seed and the call resolves from
    // there. The remaining three are wired in Step 3.
    expect(withStoredKey.sort()).toEqual(['chat/analysis', 'chat/planner', 'images/image_generation']);
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
