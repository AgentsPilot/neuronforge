/**
 * T2-O (Layer 2 Step 2) — what each non-chat area does when it is switched off.
 *
 * The rule for this step (§3.8, FR-14): an area that is off uses the fallback
 * THAT ALREADY EXISTS for that call — the insight templates, the briefing's
 * deterministic composer, the intake starter form, the free-text question, the
 * lead-reply ladder, the landing page's default content, the per-block website
 * templates. No new owner-facing message ships here; those arrive with Step 3.
 *
 * What "off" must mean, precisely:
 *   - the provider is never called (no spend);
 *   - `runAiAction` writes NO audit entry, because no LLM call was made
 *     (Layer 3 FR-7) — an off feature is not a failed action;
 *   - the owner still gets a usable result.
 *
 * And what it must NOT mean (D-27, RC-W8b): `website.enabled: false` does not
 * switch off `full_site`, `field_regenerate` or `testimonial_enhance`. Their
 * "AI writing is unavailable" paths do not exist until Step 3, so the policy
 * locks them on and the resolver reports them on — truthfully. The change
 * script says so by name every time the website area is switched off (S1-7).
 */

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

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000001' }));

const mockGetByKeys = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  return {
    ...actual,
    systemConfigRepository: {
      ...actual.systemConfigRepository,
      getByKeys: (...args: unknown[]) => mockGetByKeys(...args),
      getImageGenerationConfig: async () => ({ ...actual.IMAGE_GENERATION_CONFIG_DEFAULTS, pricesUsd: {} }),
    },
  };
});

jest.mock('@/lib/ai/pricing', () => ({
  getPricing: async () => ({ input: 0.0025, output: 0.01 }),
  hasPricing: async () => true,
  calculateCost: async () => 0,
  calculateCostSync: () => 0,
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

const mockAuditLog = jest.fn(async () => undefined);
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...args: unknown[]) => mockAuditLog(...(args as [])) },
  AuditTrailService: { getInstance: () => ({ log: (...args: unknown[]) => mockAuditLog(...(args as [])) }) },
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { BOS_LLM_AREAS, type BosLlmArea } from '../callCatalog';
import { __resetBosLlmSettingsForTests, resolveBosLlmSettings } from '../modelSettings';
import { BOS_LLM_CALL_POLICY, bosLlmAreaKey } from '../modelSettingsPolicy';
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
import { POST as inferQuestionRoute } from '@/app/api/intake/form/infer-question/route';
import { POST as landingPageRoute } from '@/app/api/website/landing-pages/generate/route';
import type { BosLlmOwner } from '@/lib/business-os/llm/callCatalog';

const U1 = profile.user_id;
const G1 = '33333333-3333-4333-8333-333333333333';
const R1 = '66666666-6666-4666-8666-666666666666';
const owner: BosLlmOwner = { userId: U1, groupId: G1 };

const chatCompletion = jest.fn();

/** The seeded rows, with the named areas switched off at area level. */
function rowsWithOff(...off: BosLlmArea[]) {
  return {
    data: BOS_LLM_AREAS.map((area) => ({
      key: bosLlmAreaKey(area),
      value: off.includes(area) ? { ...SEEDED_ROWS[area], enabled: false } : SEEDED_ROWS[area],
      category: 'business_os_llm',
      updated_at: '2026-10-03T00:00:00.000Z',
    })),
    error: null,
  };
}

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

function insights() {
  return new InsightRepository({} as unknown as SupabaseClient) as never as {
    generateLocalizedContent(d: unknown, u: string, c: unknown, r: string): Promise<Record<string, string>>;
    generateCorrelatedContent(i: unknown, u: string, c: unknown, r: string): Promise<Record<string, string>>;
    generateHealthNarrative(
      u: string,
      s: number,
      c: number | null,
      cs: Record<string, number>,
      summary: unknown,
      all: Insight[],
      lang: string,
      run: string
    ): Promise<Record<string, unknown>>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  __resetBosLlmSettingsForTests();
  __resetModelFallbackForTests();
  mockGetUser.mockResolvedValue({ id: U1 });
  chatCompletion.mockResolvedValue({ choices: [{ message: { content: '{}' } }], content: '{}' });
  jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue({ chatCompletion } as unknown as BaseAIProvider);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('T2-O: insights off → the translated templates', () => {
  beforeEach(() => mockGetByKeys.mockResolvedValue(rowsWithOff('insights')));

  it('insight content falls back to the template and calls no provider', async () => {
    const result = await insights().generateLocalizedContent(detection, U1, businessContext, R1);

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(typeof result.title).toBe('string');
    expect(result.title.length).toBeGreaterThan(0);
    expect(typeof result.recommendation).toBe('string');
  });

  it('correlated insight falls back to the template and calls no provider', async () => {
    const result = await insights().generateCorrelatedContent(correlated, U1, businessContext, R1);

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(typeof result.story).toBe('string');
    expect(result.story.length).toBeGreaterThan(0);
  });

  it('health summary falls back to the template and calls no provider', async () => {
    const result = await insights().generateHealthNarrative(
      U1,
      72,
      3,
      { cash_flow: 60 },
      correlationSummary,
      [] as Insight[],
      'en',
      R1
    );

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(typeof result.narrative).toBe('string');
    expect(String(result.narrative).length).toBeGreaterThan(0);
  });

  it('leaves the other areas on', async () => {
    const briefing = await resolveBosLlmSettings('briefing', 'daily_narration');
    expect(briefing.enabled).toBe(true);
  });
});

describe('T2-O: briefing off → the deterministic composer', () => {
  beforeEach(() => mockGetByKeys.mockResolvedValue(rowsWithOff('briefing')));

  it('returns composed prose, marked as a fallback, with no provider call', async () => {
    const result = await narrateBriefing(facts(), 'en', U1);

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(result.source).toBe('fallback');
    expect(result.narrative.length).toBeGreaterThan(0);
  });
});

describe('T2-O: intake off → the starter form and the free-text question', () => {
  beforeEach(() => mockGetByKeys.mockResolvedValue(rowsWithOff('intake')));

  it('form generation returns the three starter questions with no provider call', async () => {
    const result = await new IntakeGenerationService().generateIntakeForm(U1, { groupId: G1 });

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.contentSource).toBe('fallback');
    expect(result.questionCount).toBe(3);
  });

  it('question inference returns the note as a free-text question, and writes no audit entry', async () => {
    const response = await inferQuestionRoute(
      post('http://localhost/api/intake/form/infer-question', { text: 'ask if they have a venue' })
    );
    const body = await response.json();

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ label: 'ask if they have a venue', type: 'long_text', required: false });
    // Layer 3 FR-7: no LLM call, no entry. An off feature is not a failed action.
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});

describe('T2-O: leads off → the deterministic ladder', () => {
  beforeEach(() => mockGetByKeys.mockResolvedValue(rowsWithOff('leads')));

  it('answers from the ladder with the existing `disabled` reason', async () => {
    const result = await recommendLeadReply(candidates, { message: 'Do you do evenings?' }, U1, G1);

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(result).toMatchObject({ source: 'fallback', fallbackReason: 'disabled' });
  });
});

describe('T2-O: website off', () => {
  beforeEach(() => mockGetByKeys.mockResolvedValue(rowsWithOff('website')));

  it('the landing page route returns the default content and writes no audit entry', async () => {
    const response = await landingPageRoute(
      post('http://localhost/api/website/landing-pages/generate', { serviceId: G1, serviceName: 'Personal training' })
    );
    const body = await response.json();

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.content).toBeTruthy();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it.each([
    ['hero', 'headline'],
    ['about', 'title'],
    ['faq', 'title'],
    ['features', 'title'],
  ])('the %s block falls back to its template with no provider call', async (blockType, key) => {
    const content = await new WebsiteAIContentService().generateBlockContent(
      { blockType, targetLanguage: 'en', businessProfile: profile, services: [] },
      owner
    );

    expect(chatCompletion).not.toHaveBeenCalled();
    expect(content[key]).toBeTruthy();
  });

  /*
   * D-27 / RC-W8b: these three have no "AI writing is unavailable" path until
   * Step 3, so the area switch must NOT reach them. If this test ever fails
   * because the resolver started reporting them off, Step 2 would be shipping a
   * half-built off path.
   */
  it.each(['full_site', 'field_regenerate', 'testimonial_enhance'] as const)(
    '%s stays ON even with the website area off (locked until Step 3)',
    async (callName) => {
      const settings = await resolveBosLlmSettings('website', callName);
      expect(settings.enabled).toBe(true);
    }
  );

  it('the three locked calls still reach the provider with the website area off', async () => {
    await new WebsiteAIContentService().regenerateField(
      { blockType: 'hero', targetLanguage: 'en', businessProfile: profile, fieldToRegenerate: 'headline' },
      owner
    );
    await new WebsiteAIContentService().enhanceTestimonial('Great coach', 'en', owner);

    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('the switchable website calls DO go off', async () => {
    for (const callName of ['landing_page', 'hero_content', 'about_content', 'faq_content', 'features_content'] as const) {
      // eslint-disable-next-line no-await-in-loop
      const settings = await resolveBosLlmSettings('website', callName);
      expect({ callName, enabled: settings.enabled }).toEqual({ callName, enabled: false });
    }
  });
});

/**
 * `full_site` off, with the Step 2 lock lifted in the row itself (a call-level
 * `enabled: false` is still ignored while the policy says the call is locked,
 * so this drives the branch through the service's own flag instead).
 *
 * Both callers are exercised: the onboarding build asks for starter copy, and
 * a 'fail' caller (Step 3's shape) gets `ai_unavailable` with nothing written.
 */
describe('T2-O: website full_site — the onAiDisabled branches', () => {
  const callLLM = () =>
    new WebsiteGenerationService() as never as {
      callLLM(
        o: BosLlmOwner,
        p: unknown,
        s: unknown[],
        t: boolean
      ): Promise<{ source: string; reason?: string; disabled?: true }>;
    };

  /** Lift the Step 2 lock for the duration of one test, then put it back. */
  async function withFullSiteSwitchable(run: () => Promise<void>): Promise<void> {
    const entry = BOS_LLM_CALL_POLICY.website.full_site as { switchable: boolean };
    const original = entry.switchable;
    entry.switchable = true;
    mockGetByKeys.mockResolvedValue(rowsWithOff('website'));
    __resetBosLlmSettingsForTests();
    try {
      await run();
    } finally {
      entry.switchable = original;
      __resetBosLlmSettingsForTests();
    }
  }

  it('the Step 2 policy really does lock it (so the lift above is meaningful)', () => {
    expect(BOS_LLM_CALL_POLICY.website.full_site.switchable).toBe(false);
  });

  it('with the lock lifted, callLLM reports `disabled` and returns the starter copy', async () => {
    await withFullSiteSwitchable(async () => {
      const generated = await callLLM().callLLM(owner, profile, [], false);

      expect(chatCompletion).not.toHaveBeenCalled();
      expect(generated).toMatchObject({ source: 'fallback', reason: 'disabled', disabled: true });
    });
  });

  it("onAiDisabled: 'fallback' finishes the build with starter copy", async () => {
    await withFullSiteSwitchable(async () => {
      const result = await new WebsiteGenerationService().generateWebsite(U1, {
        groupId: G1,
        onAiDisabled: 'fallback',
      });

      expect(chatCompletion).not.toHaveBeenCalled();
      // The build continues past generation; whatever the mocked page
      // repositories answer, it never refuses for `ai_unavailable`.
      expect(result.code).toBeUndefined();
    });
  });

  it("onAiDisabled: 'fail' refuses with ai_unavailable and writes nothing", async () => {
    await withFullSiteSwitchable(async () => {
      const result = await new WebsiteGenerationService().generateWebsite(U1, {
        groupId: G1,
        onAiDisabled: 'fail',
      });

      expect(chatCompletion).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: false, code: 'ai_unavailable' });
    });
  });
});
