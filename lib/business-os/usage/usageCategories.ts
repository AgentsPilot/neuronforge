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

import { bosFeature } from '@/lib/business-os/llm/callCatalog';

export const OTHER_USAGE_CATEGORY = 'other';

export const USAGE_CATEGORIES: ReadonlyArray<{ key: string; features: readonly string[] }> = [
  { key: 'chat', features: [bosFeature('chat'), 'chat-v3'] },
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
  { key: 'website', features: [bosFeature('website'), 'landing-page-generation'] },
  {
    key: 'insights',
    features: [
      bosFeature('insights'),
      'health-summary-generation',
      'insight-generation',
      'correlated-insight-generation',
    ],
  },
  // `business-os` is the legacy briefing tag (component `daily-briefing`).
  { key: 'briefing', features: [bosFeature('briefing'), 'business-os'] },
  { key: 'intake', features: [bosFeature('intake')] },
  { key: 'leads', features: [bosFeature('leads'), 'lead-reply'] },
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
