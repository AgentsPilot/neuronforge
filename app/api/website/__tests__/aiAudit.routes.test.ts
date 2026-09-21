/**
 * Layer 3 (FR-12, AC-11): one AI audit entry per owner request at each website
 * and intake entry point — full site, landing page, field regeneration,
 * testimonial enhancement, intake form generation, question inference.
 *
 * Each route's service (or provider) is faked to make real tracked LLM calls
 * through BaseAIProvider.callWithTracking under the group the route minted, so
 * the real usage scope and entry builder run. The onboarding build (one entry
 * spanning intake and website) is in app/api/onboarding/build/__tests__.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
/*
 * Layer 2 (Step 2): the call sites take their model, temperature and on/off
 * switch from `resolveBosLlmSettings`. Pinned to the CODE DEFAULTS — today's
 * values — so this file keeps asserting exactly what it asserted before, with
 * no configuration read and no I/O.
 */
jest.mock('@/lib/business-os/llm/modelSettings', () => {
  const actual = jest.requireActual('@/lib/business-os/llm/modelSettings');
  return {
    ...actual,
    resolveBosLlmSettings: async (area: string, callName: string) => actual.bosLlmCodeDefaults(area, callName),
  };
});

jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockAuditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: { log: (...a: unknown[]) => mockAuditLog(...a) },
}));

const mockLogged: Array<{ level: string; fields: unknown }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['debug', 'info', 'warn', 'error']) {
      logger[level] = (first: unknown) => mockLogged.push({ level, fields: typeof first === 'object' ? JSON.parse(JSON.stringify(first)) : first });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/supabaseServer', () => {
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
        return () => builder;
      },
    }
  );
  return { supabaseServer: { from: () => builder } };
});

const mockGenerateWebsite = jest.fn();
jest.mock('@/lib/services/WebsiteGenerationService', () => ({
  WebsiteGenerationService: jest.fn().mockImplementation(() => ({
    generateWebsite: (...a: unknown[]) => mockGenerateWebsite(...a),
  })),
}));
const mockRegenerateField = jest.fn();
const mockEnhance = jest.fn();
jest.mock('@/lib/services/WebsiteAIContentService', () => ({
  WebsiteAIContentService: jest.fn().mockImplementation(() => ({
    regenerateField: (...a: unknown[]) => mockRegenerateField(...a),
    enhanceTestimonial: (...a: unknown[]) => mockEnhance(...a),
  })),
}));
jest.mock('@/lib/repositories/WebsiteBlockRepository', () => ({
  WebsiteBlockRepository: jest.fn().mockImplementation(() => ({
    findById: async () => ({ data: { id: 'b1', content: { title: 'Old' } }, error: null }),
  })),
}));
const mockGenerateIntake = jest.fn();
jest.mock('@/lib/services/IntakeGenerationService', () => ({
  intakeGenerationService: { generateIntakeForm: (...a: unknown[]) => mockGenerateIntake(...a) },
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findByUserId: async () => ({ data: { language: 'en', vertical: 'coach' } }) },
}));
const mockChatCompletion = jest.fn();
const mockComplete = jest.fn();
jest.mock('@/lib/ai/providerFactory', () => ({
  ProviderFactory: { getProvider: () => ({ chatCompletion: (...a: unknown[]) => mockChatCompletion(...a) }) },
  getProviderFactory: () => ({ complete: (...a: unknown[]) => mockComplete(...a) }),
}));

import { POST as fullSitePOST } from '../generate-from-profile/route';
import { POST as landingPOST } from '../landing-pages/generate/route';
import { POST as regeneratePOST } from '../blocks/[blockId]/regenerate/route';
import { POST as testimonialPOST } from '../enhance-testimonial/route';
import { POST as intakePOST } from '../../intake/form/generate/route';
import { POST as inferPOST } from '../../intake/form/infer-question/route';
import { BaseAIProvider, type CallContext } from '@/lib/ai/providers/baseProvider';
import type { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { buildBosCallContext, isUuid, type BosLlmOwner } from '@/lib/business-os/llm/callCatalog';

const USER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const OWNER_TEXT = 'OWNER-TEXT-MARKER-w5 our calm studio';
const MODEL_TEXT = 'MODEL-OUTPUT-MARKER-w6';

class FakeProvider extends BaseAIProvider {
  readonly defaultModel = 'm';
  readonly defaultMaxTokens = 1;
  readonly supportsResponseFormat = false;
  getMaxOutputTokens(): number {
    return 1;
  }
  async chatCompletion(): Promise<unknown> {
    throw new Error('unused');
  }
}
const provider = new FakeProvider({ trackAICall: async () => undefined } as unknown as AIAnalyticsService);

/** One real tracked call under a context the code under test built. */
function trackedCall(context: CallContext, fail = false) {
  return provider.callWithTracking(
    context,
    'openai',
    'gpt-4o',
    'chat/completions',
    async () => {
      if (fail) throw Object.assign(new Error(`upstream: ${OWNER_TEXT}`), { code: 'server_error' });
      return {};
    },
    () => ({ inputTokens: 120, outputTokens: 40, cost: 0.0015 })
  );
}

function ownerCall(owner: BosLlmOwner, area: 'website' | 'intake', callName: string, fail = false) {
  return trackedCall(buildBosCallContext({ userId: owner.userId, area, callName, groupId: owner.groupId } as Parameters<typeof buildBosCallContext>[0]), fail);
}

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

function onlyEntry() {
  expect(mockAuditLog).toHaveBeenCalledTimes(1);
  const entry = mockAuditLog.mock.calls[0][0];
  expect(isUuid(entry.entityId)).toBe(true);
  expect(entry).toMatchObject({ entityType: 'ai_action', userId: USER.id, actorId: USER.id });
  for (const marker of ['OWNER-TEXT-MARKER-w5', 'MODEL-OUTPUT-MARKER-w6']) {
    expect(JSON.stringify(entry)).not.toContain(marker);
  }
  return entry;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLogged.length = 0;
  mockGetUser.mockResolvedValue(USER);
  mockAuditLog.mockResolvedValue(undefined);
});

describe('full-site generation', () => {
  it('one entry, website / website_full_site, grouped by the route\'s group', async () => {
    mockGenerateWebsite.mockImplementation(async (userId: string, opts: { groupId: string }) => {
      await ownerCall({ userId, groupId: opts.groupId }, 'website', 'full_site');
      return { success: true, homepageId: 'h1', blocksCreated: 6 };
    });
    const res = await fullSitePOST(post('http://localhost/api/website/generate-from-profile', { userId: USER.id }));
    expect(res.status).toBe(200);
    const entry = onlyEntry();
    expect(entry).toMatchObject({
      action: 'BUSINESS_AI_ACTION_COMPLETED',
      entityId: mockGenerateWebsite.mock.calls[0][1].groupId,
      details: expect.objectContaining({ area: 'website', actionType: 'website_full_site', callCount: 1, callNames: ['full_site'] }),
    });
  });

  it('fallback content is FAILED with content_fallback; the response is unchanged', async () => {
    mockGenerateWebsite.mockImplementation(async (userId: string, opts: { groupId: string }) => {
      await ownerCall({ userId, groupId: opts.groupId }, 'website', 'full_site');
      return { success: true, homepageId: 'h1', blocksCreated: 6, warning: 'content_fallback: model timed out' };
    });
    const res = await fullSitePOST(post('http://localhost/api/website/generate-from-profile', { userId: USER.id }));
    expect(res.status).toBe(200);
    const entry = onlyEntry();
    expect(entry).toMatchObject({ action: 'BUSINESS_AI_ACTION_FAILED', details: expect.objectContaining({ errorCode: 'content_fallback' }) });
    expect(JSON.stringify(entry)).not.toContain('timed out'); // the warning text is not recorded
  });

  it('a generation that fails after its call is FAILED with generation_failed; the route still answers 500', async () => {
    mockGenerateWebsite.mockImplementation(async (userId: string, opts: { groupId: string }) => {
      await ownerCall({ userId, groupId: opts.groupId }, 'website', 'full_site', true).catch(() => undefined);
      return { success: false, error: 'No sections could be saved' };
    });
    const res = await fullSitePOST(post('http://localhost/api/website/generate-from-profile', { userId: USER.id }));
    expect(res.status).toBe(500);
    expect(onlyEntry()).toMatchObject({ action: 'BUSINESS_AI_ACTION_FAILED', details: expect.objectContaining({ errorCode: 'generation_failed' }) });
  });
});

describe('landing-page generation', () => {
  const body = { serviceId: '11111111-1111-4111-8111-111111111111', serviceName: 'Private yoga', serviceDescription: OWNER_TEXT };

  it('one entry for the call and its parse', async () => {
    mockChatCompletion.mockImplementation(async (_params: unknown, context: CallContext) => {
      await trackedCall(context);
      return { choices: [{ message: { content: JSON.stringify({ hero: { title: MODEL_TEXT }, features: [], faq: [] }) } }] };
    });
    const res = await landingPOST(post('http://localhost/api/website/landing-pages/generate', body));
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({
      action: 'BUSINESS_AI_ACTION_COMPLETED',
      details: expect.objectContaining({ area: 'website', actionType: 'website_landing_page', callNames: ['landing_page'] }),
    });
  });

  it('unparseable output falls back to defaults: FAILED content_fallback, and the model text reaches no warn line', async () => {
    mockChatCompletion.mockImplementation(async (_params: unknown, context: CallContext) => {
      await trackedCall(context);
      return { choices: [{ message: { content: `${MODEL_TEXT} not json` } }] };
    });
    const res = await landingPOST(post('http://localhost/api/website/landing-pages/generate', body));
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({ action: 'BUSINESS_AI_ACTION_FAILED', details: expect.objectContaining({ errorCode: 'content_fallback' }) });
    const visible = mockLogged.filter((l) => l.level !== 'debug');
    expect(JSON.stringify(visible)).not.toContain('MODEL-OUTPUT-MARKER-w6');
  });
});

describe('field regeneration and testimonial enhancement', () => {
  it('regeneration: one entry, website_field_regenerate', async () => {
    mockRegenerateField.mockImplementation(async (_req: unknown, owner: BosLlmOwner) => {
      await ownerCall(owner, 'website', 'field_regenerate');
      return MODEL_TEXT;
    });
    const res = await regeneratePOST(
      post('http://localhost/api/website/blocks/b1/regenerate', { field: 'title', blockType: 'hero' }),
      { params: Promise.resolve({ blockId: 'b1' }) } as never
    );
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({ details: expect.objectContaining({ actionType: 'website_field_regenerate', callNames: ['field_regenerate'] }) });
  });

  it('testimonial: one entry, website_testimonial_enhance, and neither the quote nor the output is recorded', async () => {
    mockEnhance.mockImplementation(async (_quote: string, _lang: string, owner: BosLlmOwner) => {
      await ownerCall(owner, 'website', 'testimonial_enhance');
      return MODEL_TEXT;
    });
    const res = await testimonialPOST(post('http://localhost/api/website/enhance-testimonial', { quote: OWNER_TEXT }));
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({ details: expect.objectContaining({ actionType: 'website_testimonial_enhance' }) });
  });
});

describe('intake', () => {
  it('form generation: one entry, intake_form_generation; a fallback form is FAILED content_fallback', async () => {
    mockGenerateIntake.mockImplementation(async (userId: string, opts: { groupId: string }) => {
      await ownerCall({ userId, groupId: opts.groupId }, 'intake', 'form_generation', true).catch(() => undefined);
      return { success: true, formId: 'f1', questionCount: 3, form: {}, contentSource: 'fallback' };
    });
    const res = await intakePOST(post('http://localhost/api/intake/form/generate', {}));
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({
      action: 'BUSINESS_AI_ACTION_FAILED',
      details: expect.objectContaining({ area: 'intake', actionType: 'intake_form_generation', errorCode: 'content_fallback' }),
    });
  });

  it('question inference: one entry, intake_question_inference, and the owner\'s note is not recorded', async () => {
    mockComplete.mockImplementation(async (_params: unknown, context: CallContext) => {
      await trackedCall(context);
      return { content: JSON.stringify({ label: 'How did you hear about us?', type: 'short_text', options: [], required: false }) };
    });
    const res = await inferPOST(post('http://localhost/api/intake/form/infer-question', { text: OWNER_TEXT }));
    expect(res.status).toBe(200);
    expect(onlyEntry()).toMatchObject({
      action: 'BUSINESS_AI_ACTION_COMPLETED',
      details: expect.objectContaining({ area: 'intake', actionType: 'intake_question_inference', callNames: ['question_inference'] }),
    });
  });
});

describe('no LLM call, no entry', () => {
  it('a request refused before any call writes nothing', async () => {
    mockGetUser.mockResolvedValue(null);
    await fullSitePOST(post('http://localhost/api/website/generate-from-profile', { userId: USER.id }));
    await testimonialPOST(post('http://localhost/api/website/enhance-testimonial', { quote: 'x' }));
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
