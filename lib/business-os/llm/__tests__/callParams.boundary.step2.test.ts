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

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { bosBriefingGroupId } from '@/lib/business-os/llm/callCatalog';
import { __resetBosLlmSettingsForTests } from '../modelSettings';
import { bosLlmAreaKey } from '../modelSettingsPolicy';
import { BOS_LLM_AREAS } from '../callCatalog';
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

/* ------------------------------------------------------------- normalisation */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMED_IDS: Record<string, string> = {
  [U1]: '<user>',
  [G1]: '<group>',
  [R1]: '<run>',
  [bosBriefingGroupId(U1, '2026-09-08')]: '<briefing-group>',
};

/**
 * Long strings become `sha256:<hex> (len N)`.
 *
 * Still byte-exact — a single changed character of prompt changes the digest —
 * but it keeps the record legible. Everything short stays verbatim, which is
 * every value AC-2 is actually about.
 */
function normalise(value: unknown): unknown {
  if (typeof value === 'string') {
    if (NAMED_IDS[value]) return NAMED_IDS[value];
    if (UUID.test(value)) return '<uuid>';
    if (value.length > 200) {
      return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')} (len ${value.length})`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalise(v)]));
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
  jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue({ chatCompletion } as unknown as BaseAIProvider);
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
