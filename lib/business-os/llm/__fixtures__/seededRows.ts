/**
 * The eight rows `supabase/migrations/20261003_seed_bos_llm_area_settings.sql`
 * writes, as data (workplan §10 "seeded rows").
 *
 * Kept beside the resolver rather than inside one test file because two tests
 * need it: T1-9 proves the migration matches it, and T1-14 proves resolving it
 * gives exactly today's parameters. The `S(...)` values of §10 (the six legacy
 * keys) are shown here at their documented default, which is what the seed
 * writes when nothing is stored.
 *
 * NOT a test file, and not production code: it lives in `__fixtures__` so Jest
 * does not collect it as a suite.
 *
 * @module lib/business-os/llm/__fixtures__/seededRows
 */

import type { BosLlmArea } from '../callCatalog';

export const SEEDED_ROWS: Record<BosLlmArea, Record<string, unknown>> = {
  chat: {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0,
    calls: {
      // The planner's temperature is locked in code and is not written here.
      planner: { model: 'gpt-4o-mini' },
      analysis: { model: 'gpt-4o-mini', enabled: true },
    },
  },
  insights: {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.3,
    calls: {
      correlated_insight: { temperature: 0.4 },
      health_summary: { temperature: 0.5 },
    },
  },
  briefing: { enabled: true, provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3 },
  website: {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    calls: {
      full_site: { model: 'gpt-4o' },
      landing_page: { model: 'gpt-4o' },
      testimonial_enhance: { temperature: 0.5 },
    },
  },
  intake: {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.3,
    calls: { question_inference: { model: 'gpt-4o-mini', temperature: 0.2 } },
  },
  leads: { enabled: true, provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2 },
  // `temperature: null` = send none. All four extractors send none today (F-7).
  onboarding: { enabled: true, provider: 'openai', model: 'gpt-4o', temperature: null },
  // No temperature key at all: image generation does not take one.
  images: { enabled: true, provider: 'openai', model: 'gpt-image-1' },
};
