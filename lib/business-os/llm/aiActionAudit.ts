// lib/business-os/llm/aiActionAudit.ts
//
// Business OS Layer 3: one audit_trail entry per AI action.
//
// `runAiAction` wraps the function that performs ONE AI action (a chat turn, one
// insight run for one business, one website generation…). It opens a usage
// scope for the action's grouping id (lib/ai/usageScope.ts), runs the action
// unchanged, then summarises the LLM calls the scope collected into a single
// audit entry and queues it with AuditTrailService.log(): never awaited, never
// flushed, the service unchanged (requirement D-4, FR-16, FR-17).
//
// NOT WIRED YET (Layer 3 steps 1-2): nothing calls `runAiAction` in production,
// so nothing is written. Each area is wired in steps 3-4, after step 0 (the
// secured audit routes) is deployed.
//
// What an entry may hold is fixed (D-2, FR-4, FR-5): ids, counts, tokens, the
// estimated cost, catalog call names, model names, the outcome and an error
// CODE. Never a prompt, anything the owner typed, anything the model returned,
// an error message, the business name, or the HTTP request (so no IP address
// and no session cookie). Severity and compliance flags come only from
// EVENT_METADATA (RC-5).

import { AuditTrail } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { AI_ACTION_ENTITY_TYPE } from '@/lib/audit/requestSchemas';
import type { AuditLogInput } from '@/lib/audit/types';
import { withUsageScope, type UsageCallRecord } from '@/lib/ai/usageScope';
import { ALL_ZERO_UUID, platformAccountId } from '@/lib/platformAccount';
import { createLogger } from '@/lib/logger';
import { BOS_LLM_AREAS, bosFeature, isPlatformAccount, isUuid, type BosLlmArea } from './callCatalog';

const logger = createLogger({ module: 'AiActionAudit' });

/** Who caused the action (D-3): the owner, a scheduled job, or an outside visitor (a lead). */
export type AiTrigger = 'user' | 'scheduled' | 'external';

/** A stable label for what the owner or job did (FR-4). The list is the workplan's §3.5. */
export type AiActionType =
  | 'chat_turn'
  | 'chat_website_operation'
  | 'insight_run'
  | 'briefing_narration'
  | 'website_full_site'
  | 'website_landing_page'
  | 'website_field_regenerate'
  | 'website_testimonial_enhance'
  | 'website_section_field_rewrite' // dormant (Layer 1 KI-1), unit-tested only
  | 'website_block_enrichment' // dormant (Layer 1 KI-3), unit-tested only
  | 'intake_form_generation'
  | 'intake_question_inference'
  | 'onboarding_build'
  | 'lead_reply_recommendation'
  | 'onboarding_turn'
  | 'image_generation';

/** Failures the action itself signals, when it degraded without throwing (FR-6, RC-6). */
export type AiFailureCode =
  | 'briefing_fallback'
  | 'content_fallback'
  | 'image_failed'
  | 'image_no_data'
  | 'image_store_failed'
  | 'chat_error';

export interface AiActionSpec {
  /** The action's declared primary area. `details.areas` (from the calls) is authoritative (WC-4). */
  area: BosLlmArea;
  actionType: AiActionType;
  /** The action's usage grouping id; every call it makes carries it as `sessionId`. */
  groupId: string;
  trigger: AiTrigger;
  /** The business account. Server-side only. May instead be set later with `setAccount`. */
  accountId?: string;
  /** The request's correlation id, where the action has one. */
  correlationId?: string;
}

export interface AiActionHandle {
  /** Set the account once it is known (e.g. a route that authenticates inside the action). */
  setAccount(accountId: string): void;
  /** Record that the action degraded without throwing (a fallback, an empty image…). */
  markFailed(code: AiFailureCode): void;
}

/** The complete, closed set of `details` keys an AI audit entry carries. */
export interface AiAuditDetails {
  schema: 1;
  area: BosLlmArea;
  areas: BosLlmArea[];
  actionType: AiActionType;
  groupId: string;
  trigger: AiTrigger;
  callCount: number;
  failedCallCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  callNames: string[];
  models: string[];
  outcome: 'succeeded' | 'failed';
  errorCode?: string;
  correlationId?: string;
}

export interface AiActionSummary {
  spec: AiActionSpec;
  accountId: string;
  actorId: string;
  calls: UsageCallRecord[];
  failure?: { code: string };
}

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** An error code safe to store: a short identifier, never free text. */
export function sanitizeErrorCode(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : undefined;
}

/** The code recorded for a thrown error: its `code`, else its class name, else UNKNOWN. Never the message. */
export function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = sanitizeErrorCode((error as { code?: unknown }).code);
    if (code) return code;
    const name = sanitizeErrorCode((error as { name?: unknown }).name);
    if (name) return name;
  }
  return 'UNKNOWN';
}

const FEATURE_TO_AREA: ReadonlyMap<string, BosLlmArea> = new Map(BOS_LLM_AREAS.map((a) => [bosFeature(a), a]));

/** The areas the calls touched, in catalog order (WC-4). */
function areasOf(calls: UsageCallRecord[]): BosLlmArea[] {
  const touched = new Set(calls.map((c) => FEATURE_TO_AREA.get(c.feature)).filter((a): a is BosLlmArea => !!a));
  return BOS_LLM_AREAS.filter((a) => touched.has(a));
}

/** In first-seen order, without repeats. */
function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * The outcome rule (FR-6, RC-6), in order: a failure the action signalled or a
 * throw; otherwise, for any call name, a failed LAST attempt. A call that failed
 * and was then repaired leaves the action succeeded (its failure still counts in
 * `failedCallCount`).
 */
function lastAttemptFailure(calls: UsageCallRecord[]): { code: string } | undefined {
  const last = new Map<string, UsageCallRecord>();
  for (const call of calls) last.set(call.component, call);
  for (const call of last.values()) {
    if (!call.success) return { code: sanitizeErrorCode(call.errorCode) ?? 'UNKNOWN' };
  }
  return undefined;
}

/** Build the audit entry. Pure: no I/O. Exactly the D-2 fields and nothing else. */
export function buildAiAuditEntry(summary: AiActionSummary): AuditLogInput {
  const { spec, calls } = summary;
  const failure = summary.failure ?? lastAttemptFailure(calls);
  const inputTokens = calls.reduce((n, c) => n + c.inputTokens, 0);
  const outputTokens = calls.reduce((n, c) => n + c.outputTokens, 0);
  const cost = calls.reduce((n, c) => n + c.costUsd, 0);

  const details: AiAuditDetails = {
    schema: 1,
    area: spec.area,
    areas: areasOf(calls),
    actionType: spec.actionType,
    groupId: spec.groupId,
    trigger: spec.trigger,
    callCount: calls.length,
    failedCallCount: calls.filter((c) => !c.success).length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    // Rounded to a micro-dollar: float sums otherwise store 0.30000000000000004.
    estimatedCostUsd: Math.round(cost * 1e6) / 1e6,
    callNames: distinct(calls.map((c) => c.component)),
    models: distinct(calls.map((c) => c.model)),
    outcome: failure ? 'failed' : 'succeeded',
    ...(failure ? { errorCode: failure.code } : {}),
    // A correlation id can arrive in a request header, so only a short identifier is kept.
    ...(SAFE_CODE.test(spec.correlationId ?? '') ? { correlationId: spec.correlationId } : {}),
  };

  // No severity, complianceFlags, resourceName, changes or request: EVENT_METADATA
  // decides the first two (RC-5), and the rest could carry content or credentials.
  return {
    action: failure ? AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED : AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED,
    entityType: AI_ACTION_ENTITY_TYPE,
    entityId: spec.groupId,
    userId: summary.accountId,
    actorId: summary.actorId,
    details,
  };
}

let platformActor: string | undefined;

/**
 * The actor for scheduled and external actions (D-3): the platform account, when
 * its id is a UUID; otherwise the all-zero id, because `actor_id` is a uuid
 * column and one bad row fails its whole batch. Resolved once per process, with
 * one warning if the configured value is not a UUID (SA WC-9).
 */
export function platformActorId(): string {
  if (platformActor === undefined) {
    const configured = platformAccountId();
    if (isUuid(configured)) {
      platformActor = configured;
    } else {
      logger.warn('SYSTEM_ADMIN_USER_ID is not a UUID; AI audit entries use the all-zero id as the platform actor');
      platformActor = ALL_ZERO_UUID;
    }
  }
  return platformActor;
}

/** For tests: forget the resolved platform actor. */
export function resetPlatformActorForTests(): void {
  platformActor = undefined;
}

/**
 * RC-3: before anything is queued, the grouping id and the account are UUIDs and
 * the account is a business, never the platform account. Returns the actor, or
 * null when the entry must not be written.
 */
export function validateIdentities(
  spec: AiActionSpec,
  accountId: string | undefined
): { accountId: string; actorId: string } | null {
  if (!isUuid(spec.groupId) || !isUuid(accountId) || isPlatformAccount(accountId)) return null;
  return { accountId, actorId: spec.trigger === 'user' ? accountId : platformActorId() };
}

/**
 * Run one AI action and queue its audit entry.
 *
 * The action's result (or error) is returned (or rethrown) exactly as if it were
 * not wrapped. Writing the entry can never fail, change or delay the action: it
 * is queued without waiting, and any fault in building it is logged and dropped.
 * An action that made no LLM call writes no entry (FR-7).
 */
export async function runAiAction<T>(spec: AiActionSpec, fn: (handle: AiActionHandle) => Promise<T>): Promise<T> {
  let accountId = spec.accountId;
  let signalled: AiFailureCode | undefined;
  const handle: AiActionHandle = {
    setAccount: (id) => {
      accountId = id;
    },
    markFailed: (code) => {
      signalled = code;
    },
  };

  const outcome = await withUsageScope(spec.groupId, () => fn(handle));

  try {
    const thrown = outcome.ok ? undefined : { error: outcome.error };
    emitAiAuditEntry(spec, accountId, outcome.usage.calls, signalled, thrown);
  } catch (err) {
    logger.error(
      { err, area: spec.area, actionType: spec.actionType, groupId: spec.groupId, accountId: accountId ?? null },
      'Building the AI audit entry failed; none written'
    );
  }

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

function emitAiAuditEntry(
  spec: AiActionSpec,
  accountId: string | undefined,
  calls: UsageCallRecord[],
  signalled: AiFailureCode | undefined,
  thrown: { error: unknown } | undefined
): void {
  const ids = { area: spec.area, actionType: spec.actionType, groupId: spec.groupId, accountId: accountId ?? null };

  if (calls.length === 0) return; // FR-7: no LLM call, no entry.

  const identities = validateIdentities(spec, accountId);
  if (!identities) {
    logger.error(ids, 'AI audit entry not written: invalid grouping id or account, or the platform account');
    return;
  }

  const failure = signalled ? { code: signalled } : thrown ? { code: errorCodeOf(thrown.error) } : undefined;
  const entry = buildAiAuditEntry({ spec, ...identities, calls, failure });

  // Never awaited (RC-4): log() awaits a 100-row insert when its entry fills the batch.
  void AuditTrail.log(entry).catch((err: unknown) => logger.error({ err, ...ids }, 'AI audit entry could not be queued'));
}
