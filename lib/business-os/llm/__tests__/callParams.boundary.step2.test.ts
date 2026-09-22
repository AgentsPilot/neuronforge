/**
 * T2-S (Layer 2 Step 2) — what the non-chat call sites send TO THE PROVIDER.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT MORE SOURCE READING.
 *
 * T1-14's leg (A) reads each call site's own text and asserts today's model and
 * temperature are still written there. SA and QA between them found eleven
 * false negatives in it, every one of the same class: *the recorded text is
 * still there but is not what reaches the provider* — a `params` object
 * rewritten one line above the inspected slice, a `...spread` after the
 * recorded `model`, a shared builder that pins a model for twelve calls at
 * once, a second call site for the same call name. No amount of text matching
 * closes that class.
 *
 * So the guarantee moved here (SA ruling, 2026-09-21). This file spies at the
 * REAL provider boundary — `ProviderFactory.getProvider('openai').chatCompletion`,
 * which is also where `getProviderFactory().complete()` ends up — drives every
 * Step 2 call site once, and records **the whole argument list** of **every**
 * call made. Nothing between the call site and the provider is mocked away: the
 * `complete()` wrapper builds its parameters for real, so a parameter it added
 * or dropped would show up here.
 *
 * The committed snapshot was taken with the call sites UNWIRED (pre-Step-2
 * source, this file's tests unchanged) and must not move when they are wired.
 * That is the AC-2 proof: same request, same number of calls, before and after.
 *
 * Long strings (prompts, system messages) are recorded as a SHA-256 digest with
 * their length, not verbatim: a digest is still byte-exact — one character of
 * prompt drift changes it — and it keeps a 2,000-line snapshot readable. Every
 * short value (model, temperature, max_tokens, response_format, roles, and the
 * whole attribution context) is recorded literally.
 *
 * As each call site was wired, its leg-(A) entry was deleted from
 * `callParams.snapshot.test.ts`, per the same ruling.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FOUR BLIND SPOTS, CLOSED IN STEP 3
 *
 * SA and QA between them found four things the snapshot above cannot see, and
 * mutation-proved every one of them against real call sites:
 *
 *   SA F-1 / D2-4  the `getProvider` spy ignored its own argument, so a site
 *                  switched to `'anthropic'` stayed green.
 *   QA D2-1        the snapshot records resolved VALUES, never the `(area,
 *                  call)` KEY a site asked for — so `hero_content`'s site could
 *                  resolve `'faq_content'` with 123/123 suites green. Eight of
 *                  nineteen sites were mis-keyable invisibly.
 *   QA D2-2        nothing proved a site uses the resolved model at all: the
 *                  snapshot was captured UNWIRED, so "unwired" is its passing
 *                  state, and re-hardcoding a model stayed green.
 *   QA D2-3        the FR-11 / RC-W4 "build the request inside the attempt"
 *                  invariant was tested at 2 of 19 sites.
 *
 * The three `describe`s at the end of this file close all four, for all
 * nineteen sites. They deliberately do NOT touch `boundaryCalls()` or the
 * committed snapshot: that snapshot's value is that it was captured against the
 * unwired sources and has not moved since, and adding a field to it would throw
 * that evidence away.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'crypto';

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  };
  return { createLogger: () => logger };
});

// uuid@13 is ESM-only and ts-jest does not transform it; WebsiteGenerationService
// imports it.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000001' }));

// The settings rows, served from memory: the resolver must do no real I/O here.
const mockGetByKeys = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  return {
    ...actual,
    systemConfigRepository: {
      ...actual.systemConfigRepository,
      getByKeys: (...args: unknown[]) => mockGetByKeys(...args),
      getImageGenerationConfig: async () => ({ ...actual.IMAGE_GENERATION_CONFIG_DEFAULTS, pricesUsd: {} }),
      getBoolean: async (_key: string, fallback: boolean) => fallback,
      getString: async (_key: string, fallback: string) => fallback,
    },
  };
});

jest.mock('@/lib/ai/pricing', () => ({
  getPricing: async () => ({ input: 0.0025, output: 0.01 }),
  hasPricing: async () => true,
  calculateCost: async () => 0,
  calculateCostSync: () => 0,
  imagePriceResolver: () => async () => 0,
  resolveImagePrice: async () => 0,
}));

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

jest.mock('@/lib/supabaseServer', () => {
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
        return () => builder;
      },
    }
  );
  return { supabaseServer: { from: () => builder } };
});

const profile = {
  user_id: '11111111-1111-4111-8111-111111111111',
  company_name: 'Studio',
  vertical: 'fitness',
  sub_vertical: null,
  website_url: null,
  website_analysis: null,
  language: 'en',
};

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  BusinessProfileRepository: class {
    async findByUserId() {
      return { data: profile, error: null };
    }
  },
  businessProfileRepository: { findByUserId: async () => ({ data: profile, error: null }) },
}));
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  SchedulingServiceRepository: class {
    async listAll() {
      return { data: [], error: null };
    }
  },
  schedulingServiceRepository: { listAll: async () => ({ data: [], error: null }) },
}));
jest.mock('@/lib/repositories/IntakeFormRepository', () => ({
  intakeFormRepository: {
    getDraft: async () => ({ data: null, error: null }),
    saveDraft: async (_userId: string, questions: unknown[]) => ({ data: { id: 'form-1', questions }, error: null }),
  },
}));
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: async () => undefined },
  AuditTrailService: { getInstance: () => ({ log: async () => undefined }) },
}));

/**
 * Which `(area, call)` key each site asked the resolver for (QA D2-1).
 *
 * A wrapper around the REAL resolver, not a stub — every value still comes from
 * the fixture rows through the real guardrails, so the snapshot cannot move.
 * All that is added is a record of what was asked for.
 *
 * `mock`-prefixed so the hoisted factory may close over it.
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

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { bosBriefingGroupId } from '@/lib/business-os/llm/callCatalog';
import { __resetBosLlmSettingsForTests, bosLlmCodeDefaults } from '../modelSettings';
import { bosLlmAreaKey } from '../modelSettingsPolicy';
import { BOS_LLM_AREAS, type BosLlmArea } from '../callCatalog';
import { SEEDED_ROWS } from '../__fixtures__/seededRows';
import { __resetModelFallbackForTests } from '../modelFallback';

import { InsightRepository } from '@/lib/business-os/insight/repository/InsightRepository';
import type { Insight } from '@/lib/business-os/insight/repository/InsightRepository';
import type { DetectionResult } from '@/lib/business-os/insight/detectors/types';
import type { CorrelatedInsight, CorrelationSummary } from '@/lib/business-os/insight/correlation/types';
import { narrateBriefing } from '@/lib/business-os/briefing/BriefingNarrator';
import type { BriefingFacts } from '@/lib/business-os/briefing/BriefingFactsService';
import { recommendLeadReply } from '@/lib/business-os/leads/LeadReplyRecommender';
import type { LeadReplyCandidate } from '@/lib/business-os/leads/leadReplyCandidates';
import { IntakeGenerationService } from '@/lib/services/IntakeGenerationService';
import { WebsiteGenerationService } from '@/lib/services/WebsiteGenerationService';
import { WebsiteAIContentService } from '@/lib/services/WebsiteAIContentService';
import { OnboardingConversationManager } from '@/lib/services/OnboardingConversationManager';
import { POST as inferQuestionRoute } from '@/app/api/intake/form/infer-question/route';
import { POST as landingPageRoute } from '@/app/api/website/landing-pages/generate/route';
import type { BosLlmOwner } from '@/lib/business-os/llm/callCatalog';

const U1 = profile.user_id;
const G1 = '33333333-3333-4333-8333-333333333333';
const R1 = '66666666-6666-4666-8666-666666666666';
const owner: BosLlmOwner = { userId: U1, groupId: G1 };

const chatCompletion = jest.fn();

/** Which provider name each `getProvider` call asked for (SA F-1). */
const getProviderArgs: unknown[] = [];

/* ------------------------------------------------------------- normalisation */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMED_IDS: Record<string, string> = {
  [U1]: '<user>',
  [G1]: '<group>',
  [R1]: '<run>',
  [bosBriefingGroupId(U1, '2026-09-08')]: '<briefing-group>',
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
 * Still byte-exact — a single changed character of prompt changes the digest —
 * but it keeps the record legible. Everything short stays verbatim, which is
 * every value AC-2 is actually about.
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

/** Every argument of every provider call made since the last reset. */
function boundaryCalls(): unknown {
  return chatCompletion.mock.calls.map((call) => normalise(call));
}

/* ----------------------------------------------------------------- fixtures */

const RESPONSE_JSON = JSON.stringify({
  // insights
  title: 't',
  description: 'd',
  recommendation: 'r',
  story: 's',
  narrative: 'n',
  highlights: [],
  priorities: [],
  // leads
  index: 0,
  reason: 'because',
  // intake
  questions: [{ label: 'What date is your event?', type: 'date', required: true }],
  // website block content
  headline: 'h',
  subheadline: 'sub',
  cta_text: 'Go',
  items: [],
  features: [],
  faq: [],
  hero: { headline: 'h', subheadline: 'sub' },
  metaDescription: 'm',
  keywords: [],
  about: { paragraphs: ['p'] },
  serviceDescriptions: {},
  processSteps: [],
  testimonials: [],
  // onboarding
  vertical: 'other',
  intent: 'confirm',
  details: '',
});

const businessContext = {
  language: 'en',
  currency: 'USD',
  vertical: 'therapy',
  sub_vertical: null,
  company_size: 'solo',
};

const detection = {
  detectorId: 'cash_ar_overdue',
  detectedAt: new Date('2026-09-17T08:00:00Z'),
  category: 'cash',
  severity: 'high',
  metricKey: 'ar_overdue_amount',
  currentValue: 1200,
  baselineValue: 400,
  thresholdValue: 500,
  percentChange: 200,
  affectedEntityIds: [],
  affectedCount: 3,
  estimatedImpactUsd: 1200,
  processParameters: {},
} as unknown as DetectionResult;

const correlated = {
  id: 'c1',
  patternId: 'cash_crunch',
  patternName: 'Cash crunch',
  category: 'cash',
  severity: 'high',
  story: 'Invoices are overdue while bookings fall.',
  action: 'Follow up on overdue invoices.',
  totalImpactUsd: 1500,
  contributingInsights: [{ detectorId: 'cash_ar_overdue', detectorName: 'Overdue', summary: '3 overdue' }],
} as unknown as CorrelatedInsight;

const correlationSummary = {
  correlatedInsights: [correlated],
  standaloneInsights: [],
  patternsChecked: 5,
  patternsMatched: 1,
  totalImpactUsd: 1500,
} as unknown as CorrelationSummary;

function facts(): BriefingFacts {
  return {
    day: {
      timezone: 'Asia/Jerusalem',
      date: '2026-09-08',
      startUtc: '2026-09-07T21:00:00.000Z',
      endUtc: '2026-09-08T21:00:00.000Z',
      localHour: 9,
    },
    appointments: {
      total: 6,
      completed: 0,
      ready: 5,
      awaitingIntake: [],
      awaitingPayment: [],
      first: { name: 'Michael', timeLocal: '09:00', serviceName: 'Assessment 1' },
      cancelled: [],
    },
    money: { owed: [], totalOwed: 0, currency: 'USD', mixedCurrency: false, receivedToday: 0, receivedCount: 0 },
    isQuiet: false,
    outlook: {
      newLeads: { count: 0, people: [] },
      quotesWaiting: { count: 0, people: [] },
      quotesOut: { count: 0, people: [] },
    },
  } as BriefingFacts;
}

const candidates: LeadReplyCandidate[] = [
  { kind: 'service', id: 'svc-1', label: 'Personal training', url: 'https://example.test/s/1' },
] as unknown as LeadReplyCandidate[];

function post(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
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

/* -------------------------------------------------------------- the driving */

/** One entry per Step 2 call site: how to make it call the provider, exactly once. */
const SITES: Array<[string, () => Promise<unknown>]> = [
  [
    'insights/insight_content',
    () =>
      (new InsightRepository({} as unknown as SupabaseClient) as never as {
        generateLocalizedContent(d: unknown, u: string, c: unknown, r: string): Promise<unknown>;
      }).generateLocalizedContent(detection, U1, businessContext, R1),
  ],
  [
    'insights/correlated_insight',
    () =>
      (new InsightRepository({} as unknown as SupabaseClient) as never as {
        generateCorrelatedContent(i: unknown, u: string, c: unknown, r: string): Promise<unknown>;
      }).generateCorrelatedContent(correlated, U1, businessContext, R1),
  ],
  [
    'insights/health_summary',
    () =>
      (new InsightRepository({} as unknown as SupabaseClient) as never as {
        generateHealthNarrative(
          u: string,
          s: number,
          c: number | null,
          cs: Record<string, number>,
          summary: unknown,
          all: Insight[],
          lang: string,
          run: string
        ): Promise<unknown>;
      }).generateHealthNarrative(U1, 72, 3, { cash_flow: 60 }, correlationSummary, [] as Insight[], 'en', R1),
  ],
  ['briefing/daily_narration', () => narrateBriefing(facts(), 'en', U1)],
  [
    'website/full_site',
    () =>
      (new WebsiteGenerationService() as never as {
        callLLM(o: BosLlmOwner, p: unknown, s: unknown[], t: boolean): Promise<unknown>;
      }).callLLM(owner, profile, [], false),
  ],
  [
    'website/landing_page',
    () =>
      landingPageRoute(
        post('http://localhost/api/website/landing-pages/generate', {
          serviceId: G1,
          serviceName: 'Personal training',
        })
      ),
  ],
  [
    'website/field_regenerate',
    () =>
      new WebsiteAIContentService().regenerateField(
        { blockType: 'hero', targetLanguage: 'en', businessProfile: profile, fieldToRegenerate: 'headline' },
        owner
      ),
  ],
  ['website/testimonial_enhance', () => new WebsiteAIContentService().enhanceTestimonial('Great coach', 'en', owner)],
  [
    'website/hero_content',
    () =>
      new WebsiteAIContentService().generateBlockContent(
        { blockType: 'hero', targetLanguage: 'en', businessProfile: profile, services: [] },
        owner
      ),
  ],
  [
    'website/about_content',
    () =>
      new WebsiteAIContentService().generateBlockContent(
        { blockType: 'about', targetLanguage: 'en', businessProfile: profile, services: [] },
        owner
      ),
  ],
  [
    'website/faq_content',
    () =>
      new WebsiteAIContentService().generateBlockContent(
        { blockType: 'faq', targetLanguage: 'en', businessProfile: profile, services: [] },
        owner
      ),
  ],
  [
    'website/features_content',
    () =>
      new WebsiteAIContentService().generateBlockContent(
        { blockType: 'features', targetLanguage: 'en', businessProfile: profile, services: [] },
        owner
      ),
  ],
  [
    'intake/form_generation',
    () =>
      (new IntakeGenerationService() as never as {
        callLLM(o: BosLlmOwner, p: Record<string, unknown>, s: Record<string, unknown>[]): Promise<unknown>;
      }).callLLM(owner, profile as unknown as Record<string, unknown>, []),
  ],
  [
    'intake/question_inference',
    () => inferQuestionRoute(post('http://localhost/api/intake/form/infer-question', { text: 'ask if they have a venue' })),
  ],
  ['leads/reply_recommendation', () => recommendLeadReply(candidates, { message: 'Do you do evenings?' }, U1, G1)],
  [
    'onboarding/business_story_extraction',
    () =>
      (new OnboardingConversationManager() as never as {
        extractBusinessStory(m: string, o: BosLlmOwner): Promise<unknown>;
      }).extractBusinessStory('I train people', owner),
  ],
  [
    'onboarding/client_workflow_extraction',
    () =>
      (new OnboardingConversationManager() as never as {
        extractClientWorkflow(m: string, o: BosLlmOwner): Promise<unknown>;
      }).extractClientWorkflow('They book and pay up front', owner),
  ],
  [
    'onboarding/client_tracking_extraction',
    () =>
      (new OnboardingConversationManager() as never as {
        extractClientTracking(m: string, o: BosLlmOwner): Promise<unknown>;
      }).extractClientTracking('A spreadsheet', owner),
  ],
  [
    'onboarding/adjustment_intent_extraction',
    () =>
      (new OnboardingConversationManager() as never as {
        extractAdjustmentIntent(m: string, o: BosLlmOwner): Promise<unknown>;
      }).extractAdjustmentIntent('change the price', owner),
  ],
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  __resetBosLlmSettingsForTests();
  __resetModelFallbackForTests();
  mockGetByKeys.mockResolvedValue(seededRows());
  mockGetUser.mockResolvedValue({ id: U1 });
  chatCompletion.mockResolvedValue({
    choices: [{ message: { content: RESPONSE_JSON } }],
    content: RESPONSE_JSON,
  });
  mockResolveArgs.length = 0;
  getProviderArgs.length = 0;
  /*
   * SA F-1: the spy RECORDS the provider it was asked for. It used to ignore
   * its argument, and SA mutation-proved the consequence on `BriefingNarrator`
   * (switched to `'anthropic'`, 20/20 boundary tests green); QA reproduced it
   * on leads. `settings.provider` is resolved at every site and — until this —
   * checked by nothing.
   */
  jest.spyOn(ProviderFactory, 'getProvider').mockImplementation(((name: unknown) => {
    getProviderArgs.push(name);
    return { chatCompletion } as unknown as BaseAIProvider;
  }) as never);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('T2-S: the request each Step 2 call site puts on the wire (AC-2)', () => {
  it.each(SITES)('%s', async (_name, drive) => {
    await drive();

    // The count is half the assertion: a call that stops being made, or a
    // second site for the same call, changes it.
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(boundaryCalls()).toMatchSnapshot();
  });

  /*
   * SA F-1 and QA D2-1, for every site, in one pass over the same driving.
   *
   * Two assertions that the snapshot structurally cannot make:
   *
   *   - the provider asked for is `'openai'`, and only `'openai'`. §10.1's
   *     first column ("Provider before → after") was asserted by nothing.
   *   - the settings key resolved is the site's OWN, asked for exactly once.
   *     This is the one that matters most: eight of these nineteen sites
   *     resolve values identical to a sibling's, so a mis-keyed site is
   *     invisible everywhere else — and a per-call override landing on the
   *     wrong call, or nowhere, is the exact failure Layer 2 exists to prevent.
   */
  it.each(SITES)('%s resolves its own key, from openai', async (name, drive) => {
    await drive();

    const [area, callName] = name.split('/');
    expect(mockResolveArgs).toEqual([[area, callName]]);
    expect([...new Set(getProviderArgs)]).toEqual(['openai']);
  });

  it('every Step 2 call site is driven exactly once by this file', () => {
    expect(SITES.map(([name]) => name).sort()).toEqual([
      'briefing/daily_narration',
      'insights/correlated_insight',
      'insights/health_summary',
      'insights/insight_content',
      'intake/form_generation',
      'intake/question_inference',
      'leads/reply_recommendation',
      'onboarding/adjustment_intent_extraction',
      'onboarding/business_story_extraction',
      'onboarding/client_tracking_extraction',
      'onboarding/client_workflow_extraction',
      'website/about_content',
      'website/faq_content',
      'website/features_content',
      'website/field_regenerate',
      'website/full_site',
      'website/hero_content',
      'website/landing_page',
      'website/testimonial_enhance',
    ]);
  });
});

/* ------------------------------------------------- QA D2-2 and D2-3 */

/**
 * The settings rows with ONE call's model overridden.
 *
 * Every site's default is `gpt-4o` or `gpt-4o-mini`, so the override has to be
 * neither: a site that ignores its setting and hardcodes a model would still
 * match a default-valued expectation.
 */
const OVERRIDE_MODEL = 'gpt-4o-2026-override';

function rowsWithModelOverride(area: string, callName: string) {
  const copy = JSON.parse(JSON.stringify(SEEDED_ROWS)) as Record<string, Record<string, unknown>>;
  const row = copy[area];
  const calls = (row.calls ?? {}) as Record<string, Record<string, unknown>>;
  calls[callName] = { ...(calls[callName] ?? {}), model: OVERRIDE_MODEL };
  row.calls = calls;
  return {
    data: BOS_LLM_AREAS.map((a) => ({
      key: bosLlmAreaKey(a),
      value: copy[a],
      category: 'business_os_llm',
      updated_at: '2026-10-03T00:00:00.000Z',
    })),
    error: null,
  };
}

/** A provider refusal the FR-11 fallback is allowed to retry (and only that). */
function modelNotFound(): Error & { status: number; code: string } {
  return Object.assign(new Error('The model does not exist'), { status: 404, code: 'model_not_found' });
}

describe('D2-2: every site actually uses the model its own row resolves', () => {
  it.each(SITES)('%s sends the overridden model', async (name, drive) => {
    const [area, callName] = name.split('/');
    mockGetByKeys.mockResolvedValue(rowsWithModelOverride(area, callName));
    __resetBosLlmSettingsForTests();

    await drive();

    /*
     * Mutation-proved by QA on `hero_content` (M1: the site re-hardcoded
     * `gpt-4o-mini` inside the attempt and 123/123 suites stayed green). The
     * boundary snapshot cannot catch that by construction — it was captured on
     * the unwired sources, so "ignores the setting" IS its passing state.
     */
    expect(chatCompletion.mock.calls.map((call) => call[0].model)).toEqual([OVERRIDE_MODEL]);
  });
});

describe('D2-3: every site builds its request inside the attempt, so a retry carries the model that ran', () => {
  it.each(SITES)('%s retries on the code default', async (name, drive) => {
    const [area, callName] = name.split('/');
    mockGetByKeys.mockResolvedValue(rowsWithModelOverride(area, callName));
    __resetBosLlmSettingsForTests();

    chatCompletion.mockReset();
    chatCompletion
      .mockRejectedValueOnce(modelNotFound())
      .mockResolvedValue({
        choices: [{ message: { content: RESPONSE_JSON } }],
        content: RESPONSE_JSON,
      });

    await drive();

    /*
     * The pair is the assertion. QA mutation-proved the failure on briefing
     * (M8: pinning `settings.model` inside the attempt, so the retry re-sends
     * the model that was just refused and the whole action fails) — with the
     * suite green, because T2-R covered one site per mechanism, not per site.
     */
    const defaultModel = bosLlmCodeDefaults(area as BosLlmArea, callName).model;
    expect(chatCompletion.mock.calls.map((call) => call[0].model)).toEqual([OVERRIDE_MODEL, defaultModel]);
  });
});

/**
 * SA-2, partially: a site that its PUBLIC caller stops calling.
 *
 * Seventeen of the nineteen entries above drive a private method, so the call
 * count is counted inside the inner function: a public entry that short-cuts
 * before it — which is exactly what `generateWebsite`'s `onAiDisabled` check
 * now does — is invisible to them. Closing that in general means driving
 * nineteen public entry points, which is a bigger piece of work than this step.
 *
 * What is closed here is the case SA actually named, at the site SA named it
 * at: the full-site generator, driven from its PUBLIC entry, must still reach
 * the provider exactly once. The rest remains an instrument limit, now written
 * down rather than assumed away (see §7.6 D-47).
 */
describe('SA-2: the public entry still reaches the call site', () => {
  it('generateWebsite reaches website/full_site exactly once', async () => {
    await new WebsiteGenerationService().generateWebsite(U1, { groupId: G1 });

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(mockResolveArgs).toContainEqual(['website', 'full_site']);
  });
});
