/**
 * Internal feature tags → what the owner would call it, on the usage card.
 *
 * Extracted from `app/api/business-os/usage/route.ts` so it can be tested: a
 * Next.js route module may only export handlers and route config.
 *
 * The tags accumulated over time and are not user-facing language
 * (`ai_processing`, `agentkit_execution`, `prompt_enhancement`). Building an
 * automation and running one are kept apart on purpose: building is expensive
 * and happens once, running is cheap and repeats, and someone looking at a large
 * number needs to know which it was.
 *
 * Business OS areas are recorded as `business-os-<area>` (see
 * lib/business-os/llm/callCatalog.ts). The legacy values those calls wrote
 * before are kept alongside, so a window that straddles the release does not
 * split one category in two.
 *
 * Anything unmapped falls through to "other" rather than being dropped, so a
 * feature added elsewhere in the product can never quietly disappear from a
 * total the user is shown. The parts always sum to the whole.
 *
 * @module lib/business-os/usage/usageCategories
 */

import { BOS_LEGACY_FEATURES, bosFeature, type BosLlmArea } from '@/lib/business-os/llm/callCatalog';

export const OTHER_USAGE_CATEGORY = 'other';

/**
 * An area's current feature value followed by the legacy values it replaced,
 * from the catalog, so the category map and the Layer 1.1 verification checks
 * read the same lists.
 */
export function bosCategoryFeatures(area: BosLlmArea): string[] {
  return [bosFeature(area), ...BOS_LEGACY_FEATURES[area]];
}

export const USAGE_CATEGORIES: ReadonlyArray<{ key: string; features: readonly string[] }> = [
  { key: 'chat', features: [...bosCategoryFeatures('chat'), 'chat-v3'] },
  {
    key: 'automations_built',
    features: [
      'agent_creation',
      'agent_generation',
      'intent_generation',
      'prompt_analysis',
      'prompt_enhancement',
      'clarification_questions',
      'calibration',
      'effort_estimator',
    ],
  },
  {
    key: 'automations_run',
    features: ['agentkit_execution', 'ai_processing', 'pilot', 'orchestration', 'memory_system'],
  },
  { key: 'website', features: bosCategoryFeatures('website') },
  { key: 'insights', features: bosCategoryFeatures('insights') },
  // Includes `business-os`, the legacy briefing tag (component `daily-briefing`).
  { key: 'briefing', features: bosCategoryFeatures('briefing') },
  { key: 'intake', features: bosCategoryFeatures('intake') },
  { key: 'leads', features: bosCategoryFeatures('leads') },
  // Business OS onboarding conversation. NOT the legacy `onboarding` feature value,
  // which stays under `help` below (Layer 1.5 FR-6).
  { key: 'onboarding', features: bosCategoryFeatures('onboarding') },
  // AI images: zero tokens and a per-image cost, so the card's breakdown hides
  // this category (no tokens); its calls still count (Layer 1.5 FR-14).
  { key: 'images', features: bosCategoryFeatures('images') },
  { key: 'documents', features: ['document-extraction'] },
  // `onboarding` stays here: the onboarding chat and prompt-ideas flows still write it.
  { key: 'help', features: ['help_bot_v2', 'input_help_bot', 'helpbot', 'onboarding'] },
];

const FEATURE_TO_CATEGORY: ReadonlyMap<string, string> = new Map(
  USAGE_CATEGORIES.flatMap((category) =>
    category.features.map((feature) => [feature, category.key] as const)
  )
);

/** The owner-facing category key for a ledger `feature` value. */
export function usageCategoryForFeature(feature: string): string {
  return FEATURE_TO_CATEGORY.get(feature) ?? OTHER_USAGE_CATEGORY;
}

/**
 * Sum per-feature usage into categories. Tokens and calls are summed exactly;
 * credit rounding stays with the caller.
 */
export function summariseUsageByCategory(
  byFeature: ReadonlyMap<string, { tokens: number; calls: number }>
): Map<string, { tokens: number; calls: number }> {
  const byCategory = new Map<string, { tokens: number; calls: number }>();

  for (const [feature, stats] of byFeature) {
    const key = usageCategoryForFeature(feature);
    const existing = byCategory.get(key) ?? { tokens: 0, calls: 0 };

    existing.tokens += stats.tokens;
    existing.calls += stats.calls;
    byCategory.set(key, existing);
  }

  return byCategory;
}
