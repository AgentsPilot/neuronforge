/**
 * Business OS LLM call catalog and attribution builder.
 *
 * Every Business OS LLM call records its spend in `token_usage` with:
 *   - the account it ran for          → `user_id`
 *   - its area (`business-os-<area>`) → `feature`
 *   - its stable call name            → `component`
 *   - a UUID grouping id              → `session_id`
 *
 * This module is the one place those names exist. Call sites pass typed
 * literals the compiler checks against the catalog, so a misspelled or
 * misplaced call name fails to build instead of quietly creating a new bucket
 * in the ledger.
 *
 * Call names are STABLE identifiers: Layer 2 uses them as model-configuration
 * keys. Never rename one without a migration plan.
 *
 * Lives under lib/business-os/, not lib/ai/, so the shared provider layer stays
 * product-agnostic.
 *
 * @see docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md (FR-26)
 * @module lib/business-os/llm/callCatalog
 */

// Node's built-in crypto, not the `uuid` package: uuid@13 is ESM-only and does
// not load under ts-jest, and a stubbed v5 would make the briefing-group test
// meaningless.
import { createHash, randomUUID } from 'crypto';
import type { CallContext } from '@/lib/ai/providers/baseProvider';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BosLlmCallCatalog' });

export const BOS_LLM_AREAS = ['chat', 'insights', 'briefing', 'website', 'intake', 'leads'] as const;
export type BosLlmArea = (typeof BOS_LLM_AREAS)[number];

/** Stable identifiers: Layer 2 config keys. Never rename without a migration plan. */
export const BOS_LLM_CALLS = {
  chat: [
    'planner',
    'analysis',
    'plan_cache_lookup_embedding',
    'plan_cache_store_embedding',
    'verified_question_embedding', // VerifiedQuestions.similar(): match (lookup)
    'verified_question_store_embedding', // VerifiedQuestions.remember(): store
  ],
  insights: ['insight_content', 'correlated_insight', 'health_summary'],
  briefing: ['daily_narration'],
  website: [
    'full_site',
    'landing_page',
    'field_regenerate',
    'testimonial_enhance',
    'hero_content',
    'about_content',
    'faq_content',
    'features_content',
  ],
  intake: ['form_generation', 'question_inference'],
  leads: ['reply_recommendation'],
} as const satisfies Record<BosLlmArea, readonly string[]>;

export type BosLlmCallName<A extends BosLlmArea> = (typeof BOS_LLM_CALLS)[A][number];

/** The ledger `feature` value for an area. The one place the `business-os-` prefix is written. */
export type BosLlmFeature<A extends BosLlmArea = BosLlmArea> = `business-os-${A}`;

export function bosFeature<A extends BosLlmArea>(area: A): BosLlmFeature<A> {
  return `business-os-${area}`;
}

/**
 * The chat feature value. Chat telemetry (daily budget, usage report, cache-hit
 * row) filters and writes by it, so it must never drift from what the builder
 * records.
 */
export const BOS_CHAT_FEATURE = bosFeature('chat');

/**
 * Chat keeps its existing optional turn id (scripts call the planner without
 * one); every other area must supply a grouping id.
 */
type GroupIdFor<A extends BosLlmArea> = A extends 'chat' ? string | undefined : string;

/** Distributive over areas, so `callName` is narrowed to its own area. */
export type BosLlmAttribution = {
  [A in BosLlmArea]: {
    /** Required by type, so a missing account is a compile error. */
    userId: string;
    area: A;
    callName: BosLlmCallName<A>;
    /** A required key even for chat, where the value may be undefined. */
    groupId: GroupIdFor<A>;
    /** Only for the invalid-account log; never written to the ledger. */
    correlationId?: string;
  };
}[BosLlmArea];

/** What a service needs from its caller. The service supplies area and call name itself. */
export interface BosLlmOwner {
  userId: string;
  groupId: string;
}

/**
 * Extra context fields a caller may add (repair marking, embedding category…).
 * The four attribution keys are excluded, so they cannot be overridden.
 */
export type BosCallContextExtras = Omit<
  Partial<CallContext>,
  'userId' | 'feature' | 'component' | 'sessionId'
>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL_ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * A value the tracker would accept but that FR-1 forbids: the system user or
 * the all-zero placeholder. Read at call time so a late-loading env applies.
 */
function isPlatformAccount(userId: string): boolean {
  if (userId === ALL_ZERO_UUID) return true;
  const systemUserId = process.env.SYSTEM_ADMIN_USER_ID;
  return !!systemUserId && userId === systemUserId;
}

/**
 * Build the provider CallContext for a Business OS LLM call.
 *
 * Never throws and never blocks the call. An invalid account is logged at
 * error level and passed through unchanged: the tracker's existing fallback
 * records the row on the system user, so spend is never dropped.
 */
export function buildBosCallContext(
  attribution: BosLlmAttribution,
  extras: BosCallContextExtras = {}
): CallContext {
  const { userId, area, callName, groupId, correlationId } = attribution;

  if (!isUuid(userId) || isPlatformAccount(userId)) {
    logger.error(
      { area, callName, correlationId, groupId },
      'Business OS LLM call has no valid business account; usage will land on the system user'
    );
  }

  if (groupId !== undefined && !isUuid(groupId)) {
    logger.warn(
      { area, callName, correlationId, groupId },
      'Business OS LLM call grouping id is not a UUID; the ledger will record no group'
    );
  }

  // Attribution keys last, so no extra can clobber them at runtime either.
  return {
    ...extras,
    userId,
    feature: bosFeature(area),
    component: callName,
    sessionId: groupId,
  };
}

/** The attribution shape `EmbeddingService.generateEmbedding` accepts. */
export interface BosEmbeddingAttribution {
  userId: string;
  feature: string;
  turnId?: string;
  callName: string;
}

/**
 * Adapt a built context for EmbeddingService, which assembles its own context
 * (category, activity fields). Takes the builder's output so validation runs once.
 */
export function toEmbeddingAttribution(context: CallContext): BosEmbeddingAttribution {
  return {
    userId: context.userId,
    feature: context.feature,
    turnId: context.sessionId,
    callName: context.component,
  };
}

/*
 * NEVER CHANGE the namespace or the name format `${userId}:${briefingDate}`.
 * Both are part of every persisted briefing session_id; changing either splits
 * a day's briefing group across a release.
 */
export const BOS_BRIEFING_GROUP_NAMESPACE = '7614864a-f10e-4140-9c6e-9f3f50dc99b0';

/**
 * UUID v5 (RFC 9562 §5.5): SHA-1 of namespace bytes + name bytes, with the
 * version and variant bits set.
 */
export function uuidV5(name: string, namespace: string): string {
  if (!isUuid(namespace)) throw new Error('uuidV5: namespace must be a UUID');

  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(namespaceBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest();

  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Grouping id for one business's briefing on one business-local day.
 * Deterministic, so re-narrations the same day share the group.
 */
export function bosBriefingGroupId(userId: string, briefingDate: string): string {
  return uuidV5(`${userId}:${briefingDate}`, BOS_BRIEFING_GROUP_NAMESPACE);
}

/**
 * A fresh grouping id for one owner action or enquiry.
 * The caller that mints it logs it, so it can be linked to the request.
 */
export function newBosGroupId(): string {
  return randomUUID();
}
