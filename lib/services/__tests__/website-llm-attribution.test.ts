/**
 * Website LLM attribution (rows 15, 17a–f; row 16 is the landing-page route).
 *
 * Every call here went through the shared `complete()` helper without a
 * context, so it landed on the platform account. Each must now be recorded
 * against the owner under business-os-website with its catalog call name.
 * Rows 17c–f have no production trigger (all callers pass useAI = false), so
 * this file is their only proof. Provider, auth and repositories mocked.
 */

// uuid@13 is ESM-only and ts-jest does not transform it. WebsiteGenerationService
// imports it; the catalog deliberately does not.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000001' }));

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

const mockComplete = jest.fn();
const mockChatCompletion = jest.fn();
jest.mock('@/lib/ai/providerFactory', () => ({
  getProviderFactory: () => ({ complete: (...args: unknown[]) => mockComplete(...args) }),
  ProviderFactory: { getProvider: () => ({ chatCompletion: (...args: unknown[]) => mockChatCompletion(...args) }) },
}));

jest.mock('@/lib/supabaseServer', () => {
  // Chainable query builder resolving to an empty result.
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

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

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
jest.mock('@/lib/repositories/CRMContactRepository', () => ({ CRMContactRepository: class {} }));
jest.mock('@/lib/repositories/UserCapabilityRepository', () => ({ UserCapabilityRepository: class {} }));

import { NextRequest } from 'next/server';
import { isUuid, type BosLlmOwner } from '@/lib/business-os/llm/callCatalog';
import { WebsiteAIContentService } from '@/lib/services/WebsiteAIContentService';
import { WebsiteBlockEnrichmentService } from '@/lib/services/WebsiteBlockEnrichmentService';
import { WebsiteGenerationService } from '@/lib/services/WebsiteGenerationService';
import { POST as enhanceTestimonialRoute } from '@/app/api/website/enhance-testimonial/route';
import { POST as landingPageRoute } from '@/app/api/website/landing-pages/generate/route';
import type { SupabaseClient } from '@supabase/supabase-js';

const U1 = profile.user_id;
const G1 = '33333333-3333-4333-8333-333333333333';
const owner: BosLlmOwner = { userId: U1, groupId: G1 };

const contexts = () => mockComplete.mock.calls.map((call) => call[1]);

const expected = (component: string, sessionId: string = G1) => ({
  userId: U1,
  feature: 'business-os-website',
  component,
  sessionId,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockComplete.mockResolvedValue({ content: '{"headline":"h","subheadline":"s","cta_text":"c"}' });
  mockGetUser.mockResolvedValue({ id: U1 });
});

describe('row 15 — full site', () => {
  it('records full-site generation against the owner', async () => {
    await new WebsiteGenerationService()['callLLM'](owner, profile, [], false);

    expect(contexts()).toEqual([expected('full_site')]);
  });
});

describe('row 16 — landing page route', () => {
  it('records the landing page under landing_page for the signed-in account with a fresh UUID group', async () => {
    mockChatCompletion.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
    const make = () =>
      new NextRequest('http://localhost/api/website/landing-pages/generate', {
        method: 'POST',
        body: JSON.stringify({ serviceId: G1, serviceName: 'Personal training' }),
      });

    await landingPageRoute(make());
    await landingPageRoute(make());

    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
    const [first, second] = mockChatCompletion.mock.calls.map((call) => call[1]);
    expect(first).toMatchObject({ userId: U1, feature: 'business-os-website', component: 'landing_page' });
    expect(isUuid(first.sessionId)).toBe(true);
    expect(first.sessionId).not.toBe(second.sessionId);
  });
});

describe('rows 17a–b — field regenerate and testimonial enhance', () => {
  it('records a field regeneration under field_regenerate', async () => {
    await new WebsiteAIContentService().regenerateField(
      { blockType: 'hero', targetLanguage: 'en', businessProfile: profile, fieldToRegenerate: 'headline' },
      owner
    );

    expect(contexts()).toEqual([expected('field_regenerate')]);
  });

  it('records a testimonial enhancement under testimonial_enhance', async () => {
    await new WebsiteAIContentService().enhanceTestimonial('Great coach', 'en', owner);

    expect(contexts()).toEqual([expected('testimonial_enhance')]);
  });

  it('the testimonial route uses the signed-in account and a fresh UUID group', async () => {
    const make = () =>
      new NextRequest('http://localhost/api/website/enhance-testimonial', {
        method: 'POST',
        body: JSON.stringify({ quote: 'Great coach', language: 'en', userId: '99999999-9999-4999-8999-999999999999' }),
      });

    await enhanceTestimonialRoute(make());
    await enhanceTestimonialRoute(make());

    const [first, second] = contexts();
    expect(first.userId).toBe(U1);
    expect(isUuid(first.sessionId)).toBe(true);
    expect(first.sessionId).not.toBe(second.sessionId);
  });
});

describe('rows 17c–f — block content', () => {
  it.each([
    ['hero', 'hero_content'],
    ['about', 'about_content'],
    ['faq', 'faq_content'],
    ['features', 'features_content'],
  ])('records %s block content under %s', async (blockType, component) => {
    await new WebsiteAIContentService().generateBlockContent(
      { blockType, targetLanguage: 'en', businessProfile: profile, services: [] },
      owner
    );

    expect(contexts()).toEqual([expected(component)]);
  });

  it('makes no call and records nothing for a block type without AI', async () => {
    await new WebsiteAIContentService().generateBlockContent(
      { blockType: 'cta', targetLanguage: 'en', businessProfile: profile },
      owner
    );

    expect(mockComplete).not.toHaveBeenCalled();
  });
});

describe('grouping within a build', () => {
  const service = () => new WebsiteBlockEnrichmentService({} as unknown as SupabaseClient);
  const blocks = [
    { block_type: 'hero', content: {}, position: 0 },
    { block_type: 'about', content: {}, position: 1 },
  ];

  it('two AI blocks in one enrichBlocks call share one group; a second build differs', async () => {
    await service().enrichBlocks(U1, blocks, 'en', true);
    await service().enrichBlocks(U1, blocks, 'en', true);

    const all = contexts();
    expect(all).toHaveLength(4);
    expect(all.map((c) => c.component).sort()).toEqual(
      ['about_content', 'about_content', 'hero_content', 'hero_content']
    );
    for (const context of all) {
      expect(context.userId).toBe(U1);
      expect(isUuid(context.sessionId)).toBe(true);
    }
    expect(all[0].sessionId).toBe(all[1].sessionId);
    expect(all[2].sessionId).toBe(all[3].sessionId);
    expect(all[0].sessionId).not.toBe(all[2].sessionId);
  });

  it('uses the caller group when one is passed', async () => {
    await service().enrichBlocks(U1, blocks, 'en', true, undefined, false, G1);

    for (const context of contexts()) expect(context.sessionId).toBe(G1);
  });

  it('a lone enrichBlock with no group mints its own UUID', async () => {
    await service().enrichBlock(U1, 'faq', {}, 'en', true);

    expect(contexts()).toHaveLength(1);
    expect(contexts()[0]).toMatchObject({ userId: U1, component: 'faq_content' });
    expect(isUuid(contexts()[0].sessionId)).toBe(true);
  });

  it('makes no AI call when AI is off', async () => {
    await service().enrichBlocks(U1, [{ block_type: 'faq', content: {}, position: 0 }], 'en', false);

    expect(mockComplete).not.toHaveBeenCalled();
  });
});
