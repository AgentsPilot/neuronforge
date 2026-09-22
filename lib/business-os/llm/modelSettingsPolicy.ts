/**
 * Business OS LLM Layer 2 — the code-owned model policy (FR-3).
 *
 * THIS IS THE ONLY PLACE a model name or a temperature is written for a
 * catalogued Business OS call. Every call site takes its `{ provider, model,
 * temperature }` from `resolveBosLlmSettings` (`./modelSettings`), which falls
 * back to the defaults below whenever configuration is missing, unreadable or
 * invalid. The defaults are therefore "today's behaviour", and a configuration
 * fault can never be worse than it (FR-6).
 *
 * The map is typed against the call catalog, so a new catalogue call that has
 * neither a policy entry nor an exclusion is a `typecheck:bos-llm` error — not
 * a silently unconfigurable call (RC-1d).
 *
 * Server-only. Never import this from a `'use client'` module.
 *
 * @see docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md (FR-3, DEC-4, DEC-5, DEC-7)
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §3.1, §10
 * @module lib/business-os/llm/modelSettingsPolicy
 */

import { IMAGE_GENERATION_CONFIG_DEFAULTS } from '@/lib/repositories/SystemConfigRepository';
import { BOS_LLM_AREAS, BOS_LLM_CALLS, type BosLlmArea, type BosLlmCallName } from './callCatalog';

/**
 * The providers Layer 2 may select (DEC-4). Adding one is a code change, made
 * per call, only after a test proves the provider serves that call's features
 * (JSON mode, tools, penalties) — never a configuration change.
 */
export const ALLOWED_PROVIDERS_LAYER2 = ['openai'] as const;
export type BosLlmProvider = (typeof ALLOWED_PROVIDERS_LAYER2)[number];

/** Every call accepts 0 … 1, or no temperature at all (DEC-7, RC-2). */
export const TEMPERATURE_BOUNDS = { min: 0, max: 1 } as const;

/** A configured model name longer than this is a mistake, not a model. */
export const MAX_MODEL_NAME_LENGTH = 100;

/** `system_settings_config.category` for the eight area rows (DEC-2). */
export const BOS_LLM_SETTINGS_CATEGORY = 'business_os_llm';

/**
 * The key prefix of the eight area rows.
 *
 * DUPLICATED, DELIBERATELY, in `app/api/admin/system-config/route.ts`
 * (`RESERVED_KEY_PREFIX`), which refuses these keys until the admin-screen
 * layer exists (DEC-10). The route must not import this module: it would pull
 * the whole route into the `typecheck:bos-llm` scope for one string. The two
 * are kept in step by `__tests__/modelSettingsPolicy.test.ts`, which reads the
 * route's source and asserts the strings are equal.
 */
export const BOS_LLM_AREA_KEY_PREFIX = 'bos_llm_area_';

/** The `system_settings_config` key holding one area's settings. */
export function bosLlmAreaKey(area: BosLlmArea): string {
  return `${BOS_LLM_AREA_KEY_PREFIX}${area}`;
}

/** The eight keys, in area order. The resolver reads exactly these (RC-3: never by category). */
export const BOS_LLM_AREA_KEYS: readonly string[] = BOS_LLM_AREAS.map(bosLlmAreaKey);

/**
 * Calls that are NOT configurable through the area rows (DEC-3).
 *
 * The four chat embeddings keep the shared `helpbot_embedding_model` key:
 * changing an embedding model invalidates every stored vector (the plan cache
 * and the verified questions), so it is a data migration, not a setting. Chat's
 * area switch still stops them, because the gate runs at chat route entry.
 */
export const BOS_LLM_SETTINGS_EXCLUDED_CALLS = [
  'plan_cache_lookup_embedding',
  'plan_cache_store_embedding',
  'verified_question_embedding',
  'verified_question_store_embedding',
] as const satisfies readonly BosLlmCallName<'chat'>[];

export type BosLlmExcludedCall = (typeof BOS_LLM_SETTINGS_EXCLUDED_CALLS)[number];

/** The call names of an area that Layer 2 configures. */
export type BosLlmSettingsCallName<A extends BosLlmArea> = Exclude<BosLlmCallName<A>, BosLlmExcludedCall>;

/** How a call's temperature may be configured. */
export type BosLlmTemperaturePolicy =
  /** Any value inside TEMPERATURE_BOUNDS, or "not set". */
  | 'free'
  /** Fixed in code; a configured value is ignored with a warning (DEC-5). */
  | { locked: number }
  /** The call sends no temperature at all (images); a configured value is ignored. */
  | 'not_applicable';

export interface BosLlmCallPolicy {
  /** Today's values. `temperature: null` means the call sends none (FR-4). */
  default: { provider: BosLlmProvider; model: string; temperature: number | null };
  /** Whether a row may switch this call off (DEC-5). A locked call always resolves `enabled: true`. */
  switchable: boolean;
  /** DEC-4. `['openai']` for every call in Layer 2. */
  allowedProviders: readonly BosLlmProvider[];
  temperature: BosLlmTemperaturePolicy;
  /**
   * The call sends `frequency_penalty` (or another sampling parameter) that a
   * reasoning model rejects with a 400. Such a model is refused as a field
   * rather than silently breaking the call (RC-11; the 400 is not a
   * model-not-found error, so the DEC-9 retry would not catch it).
   */
  sendsSamplingPenalty: boolean;
  /** Which price guardrail applies: per-token, or per-image (RC-5). */
  kind: 'token' | 'image';
}

/** Areas that can never be switched off, at any level (DEC-5, user BQ-1). */
export const BOS_LLM_AREA_LOCKS: Record<BosLlmArea, { switchable: boolean }> = {
  chat: { switchable: true },
  insights: { switchable: true },
  briefing: { switchable: true },
  website: { switchable: true },
  intake: { switchable: true },
  leads: { switchable: true },
  // Onboarding is how a business gets set up. With it off, the adjustment
  // extractor would read every change request as "confirm" — a silent wrong
  // outcome. Confirmed by the user (BQ-1).
  onboarding: { switchable: false },
  images: { switchable: true },
};

export type BosLlmCallPolicyMap = {
  [A in BosLlmArea]: { [C in BosLlmSettingsCallName<A>]: BosLlmCallPolicy };
};

const OPENAI_ONLY = ALLOWED_PROVIDERS_LAYER2;

/** A token call on OpenAI that sends a temperature and no sampling penalty. */
function tokenCall(
  model: string,
  temperature: number | null,
  options: { switchable: boolean; temperature?: BosLlmTemperaturePolicy; sendsSamplingPenalty?: boolean }
): BosLlmCallPolicy {
  return {
    default: { provider: 'openai', model, temperature },
    switchable: options.switchable,
    allowedProviders: OPENAI_ONLY,
    temperature: options.temperature ?? 'free',
    sendsSamplingPenalty: options.sendsSamplingPenalty ?? false,
    kind: 'token',
  };
}

/**
 * Every configurable Business OS call, with the values it uses today (§10).
 *
 * Each entry's evidence, as read on 2026-09-19 and re-verified by SA:
 *   chat/planner                   Planner.ts:118-124 (stored key), :451-474 temperature 0
 *   chat/analysis                  AnalysisService.ts:90-96 (stored keys), temperature 0
 *   insights/*                     InsightRepository.ts:727 / :1742 / :2130 (0.3 / 0.4 / 0.5)
 *   briefing/daily_narration       BriefingNarrator.ts:114 (OPENAI_MODELS.GPT_4O_MINI, 0.3)
 *   website/full_site              WebsiteGenerationService.ts:560 (gpt-4o, 0.7)
 *   website/landing_page           app/api/website/landing-pages/generate/route.ts:116,:127
 *   website/field_regenerate       WebsiteAIContentService.ts:316 (0.7)
 *   website/testimonial_enhance    WebsiteAIContentService.ts:361 (0.5)
 *   website/*_content (dormant)    WebsiteAIContentService.ts:401,:450,:588,:650 (0.7)
 *   intake/form_generation         IntakeGenerationService.ts:57 (gpt-4o, 0.3)
 *   intake/question_inference      infer-question/route.ts:135 (gpt-4o-mini, 0.2)
 *   leads/reply_recommendation     LeadReplyRecommender.ts:41-42,:95-98 (stored keys, 0.2)
 *   onboarding/*                   OnboardingConversationManager.ts:1065,:1111,:1219,:1536 (no temperature)
 *   images/image_generation        GeneratedImageService via IMAGE_GENERATION_CONFIG_DEFAULTS.model
 */
export const BOS_LLM_CALL_POLICY: BosLlmCallPolicyMap = {
  chat: {
    // The planner's 0 is deliberate: 0.3 recovered only 1 run in 4, and the
    // plan cache relies on a stable plan for the same question (F-6). It also
    // sends tools + frequency_penalty, so a reasoning model is refused.
    planner: tokenCall('gpt-4o-mini', 0, {
      switchable: false,
      temperature: { locked: 0 },
      sendsSamplingPenalty: true,
    }),
    analysis: tokenCall('gpt-4o-mini', 0, { switchable: true, sendsSamplingPenalty: true }),
  },
  insights: {
    insight_content: tokenCall('gpt-4o-mini', 0.3, { switchable: true }),
    correlated_insight: tokenCall('gpt-4o-mini', 0.4, { switchable: true }),
    health_summary: tokenCall('gpt-4o-mini', 0.5, { switchable: true }),
  },
  briefing: {
    daily_narration: tokenCall('gpt-4o-mini', 0.3, { switchable: true }),
  },
  website: {
    // Switchable since Step 3, which shipped their ★ "AI writing is
    // unavailable" paths (RC-W8b): `full_site` refuses from the website page
    // and the chat mutate path while the onboarding build still finishes on
    // starter copy, and the two editor buttons answer `ai_unavailable`. The
    // website kill switch now covers all eight website calls.
    full_site: tokenCall('gpt-4o', 0.7, { switchable: true }),
    landing_page: tokenCall('gpt-4o', 0.7, { switchable: true }),
    field_regenerate: tokenCall('gpt-4o-mini', 0.7, { switchable: true }),
    testimonial_enhance: tokenCall('gpt-4o-mini', 0.5, { switchable: true }),
    hero_content: tokenCall('gpt-4o-mini', 0.7, { switchable: true }),
    about_content: tokenCall('gpt-4o-mini', 0.7, { switchable: true }),
    faq_content: tokenCall('gpt-4o-mini', 0.7, { switchable: true }),
    features_content: tokenCall('gpt-4o-mini', 0.7, { switchable: true }),
  },
  intake: {
    form_generation: tokenCall('gpt-4o', 0.3, { switchable: true }),
    question_inference: tokenCall('gpt-4o-mini', 0.2, { switchable: true }),
  },
  leads: {
    reply_recommendation: tokenCall('gpt-4o-mini', 0.2, { switchable: true }),
  },
  onboarding: {
    // All four extractors send NO temperature today, so the provider default
    // applies (F-7 / SA V-2). Seeding a number would change behaviour.
    business_story_extraction: tokenCall('gpt-4o', null, { switchable: false }),
    client_workflow_extraction: tokenCall('gpt-4o', null, { switchable: false }),
    client_tracking_extraction: tokenCall('gpt-4o', null, { switchable: false }),
    adjustment_intent_extraction: tokenCall('gpt-4o', null, { switchable: false }),
  },
  images: {
    image_generation: {
      // Referenced, never copied (N-8): the image model's documented default
      // lives with the rest of the image configuration.
      default: { provider: 'openai', model: IMAGE_GENERATION_CONFIG_DEFAULTS.model, temperature: null },
      switchable: true,
      allowedProviders: OPENAI_ONLY,
      temperature: 'not_applicable',
      sendsSamplingPenalty: false,
      kind: 'image',
    },
  },
};

/**
 * Model families that generate IMAGES, not text.
 *
 * The price guardrails ask "is this model priced for this kind of call", which
 * a model of the *wrong kind* can answer yes to: `policy.kind` only chooses
 * which price check runs, it never says the model belongs to that kind. Today
 * an image model on a token call is refused only by the accident that
 * `gpt-image-1` is absent from the in-code price table — one operator-added
 * `ai_model_pricing` row removes that accident, and the resulting provider 400
 * is NOT a model-not-found error, so the FR-11 retry cannot recover it and the
 * area stays broken for the whole cache window (D-Q5).
 *
 * Kept deliberately small and prefix-based, like the reasoning families in
 * `openaiProvider`: it names what exists, and a family it does not know simply
 * falls through to the price check, which is today's behaviour.
 */
export const IMAGE_MODEL_PREFIXES = ['gpt-image', 'dall-e', 'imagen'] as const;

/** Does this model name belong to an image family (D-Q5)? */
export function isImageModelName(model: string): boolean {
  const name = model.toLowerCase();
  return IMAGE_MODEL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** The qualities an image model must be priced at, for every configured size (RC-5, V-7). */
export const IMAGE_PRICE_REQUIRED_QUALITIES = ['low', 'medium', 'high'] as const;

/** Is this call configured through the area rows, or excluded (DEC-3)? */
export function isExcludedFromBosLlmSettings(callName: string): callName is BosLlmExcludedCall {
  return (BOS_LLM_SETTINGS_EXCLUDED_CALLS as readonly string[]).includes(callName);
}

/** The policy for one call, or `undefined` when the name is not a configurable call of that area. */
export function getBosLlmCallPolicy(area: BosLlmArea, callName: string): BosLlmCallPolicy | undefined {
  const areaPolicy = BOS_LLM_CALL_POLICY[area] as Record<string, BosLlmCallPolicy | undefined>;
  return areaPolicy[callName];
}

/**
 * Can a row switch this call off on its own?
 *
 * False for a call whose "off" path does not exist, or must not exist: the four
 * onboarding extractors (DEC-5) and the chat planner, whose only off switch is
 * the chat area switch enforced at route entry (D-27).
 *
 * The three website calls that were false between Steps 2 and 3 are now true,
 * so **no area's switch is partial any more** — every catalogued call is
 * either switchable on its own or stopped by an entry gate when its area is.
 * `modelSettingsPolicy.test.ts` asserts exactly that, so a future call added
 * with `switchable: false` in a switchable area fails the suite instead of
 * quietly re-creating the S1-7 half-kill-switch the change script used to warn
 * about.
 */
export function isSwitchableBosLlmCall(area: BosLlmArea, callName: string): boolean {
  if (!BOS_LLM_AREA_LOCKS[area].switchable) return false;
  return getBosLlmCallPolicy(area, callName)?.switchable ?? false;
}

/** Every configurable call name of an area, in catalog order. */
export function bosLlmSettingsCallNames(area: BosLlmArea): readonly string[] {
  return (BOS_LLM_CALLS[area] as readonly string[]).filter((name) => !isExcludedFromBosLlmSettings(name));
}
