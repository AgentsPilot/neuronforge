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
// CHARGE (deduction layer slice 3b-ii): after the entry is queued, the action's
// credit charge is written by `recordAiCharge` (aiChargeRecorder.ts). It is the
// ONE awaited write here, time-boxed at `BOS_AI_CHARGE_WRITE_BUDGET_MS` (plus,
// after a recorded charge, the recorder's bounded low-line check — slice 8b),
// and it never throws, so it cannot change the action's value or error. The entry and
// the charge take the SAME decision (identities and failure, SA N-7). Charges
// are recorded in every entitlements mode: a charge measures, it decides
// nothing (SA Q-4).
//
// WIRED: `runAiAction` is called at 16 sites, one per `AiActionType`. 14 run in
// production; the two dormant types (see the union) have call sites but no
// production trigger yet. What each type is (its area, who it faces, whether it
// is setup AI, whether it is charged, its diary label, whether a template
// fallback exists) is declared once, in `AI_ACTION_DECLARATIONS` below the
// union (deduction layer FR-4, slice 1). Read by the credit ledger's effective-
// fields resolver (area) and the owner's credit history (diary label).
//
// What an entry may hold is fixed (D-2, FR-4, FR-5): ids, counts, tokens, the
// estimated cost, catalog call names, model names, the outcome and an error
// CODE. Never a prompt, anything the owner typed, anything the model returned,
// an error message, the business name, or the HTTP request (so no IP address
// and no session cookie). Severity and compliance flags come only from
// EVENT_METADATA (RC-5).

import { randomUUID } from 'node:crypto';
import { AuditTrail } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { AI_ACTION_ENTITY_TYPE } from '@/lib/audit/requestSchemas';
import type { AuditLogInput } from '@/lib/audit/types';
import { withUsageScope, type UsageCallRecord } from '@/lib/ai/usageScope';
import { ALL_ZERO_UUID, platformAccountId } from '@/lib/platformAccount';
import { createLogger } from '@/lib/logger';
import { BOS_LLM_AREAS, bosFeature, isPlatformAccount, isUuid, type BosLlmArea } from './callCatalog';
// Imports only the shared pricing reader and types (SA Q-1 (b)): the rate
// derivation and SystemConfigRepository stay out of this module's graph.
import { reportUnpricedCalls } from './chargeClassification';
// Slice 3b-ii (SA Q-5): a static import. The recorder and the resolver import
// only TYPES back from this module, so there is no runtime cycle (SA C-5).
import { AI_CHARGE_SERVICE, recordAiCharge } from './aiChargeRecorder';
// Type-only, from a file with no imports: erased at compile time, adds nothing
// to this server-only module's graph.
import type { Labels } from '@/lib/business-os/entitlements/types';

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

/** Who an action's output reaches: the owner, or the owner's clients (deduction layer FR-19). */
export type AiActionAudience = 'owner' | 'client';

/**
 * What the charge, the diary and the limit need to know about one action type
 * (deduction layer FR-4). The area and the diary label are read by
 * `lib/business-os/credits/effectiveFields.ts` (the credit history, slice 7).
 *
 * Audience and template fallback travel together, so the type itself refuses
 * an owner-facing action with a fallback status, or a client-facing one without.
 * The fallback status matters only for client-facing work (FR-19): `n/a` on an
 * owner-facing type does not mean it has no degrade path.
 */
export type AiActionDeclaration = {
  /** The area the call site passes to runAiAction today. */
  area: BosLlmArea;
  /** Setup AI (onboarding, first site or form): the class, not the instance. */
  isSetup: boolean;
  /** Every action is charged its measured cost (option B). */
  isCharged: boolean;
  /**
   * Plain-language diary label; the area is shown beside it, so it says what
   * the action did. Rendered in the owner's credit history since slice 7
   * (English approved by the user, D-q); he / es pending native review before
   * release.
   */
  diaryLabels: Labels;
  /** Declared and labelled, but no production trigger yet (KI-4). */
  isDormant?: true;
} & (
  | { audience: 'owner'; templateFallback: 'n/a' }
  | { audience: 'client'; templateFallback: 'exists' | 'missing' }
);

/**
 * One entry per `AiActionType`. `satisfies Record<…>` on this literal rejects a
 * missing type and a stray key alike, and `typecheck:bos-llm` (a required check)
 * enforces it: a new action type cannot ship without its facts.
 */
export const AI_ACTION_DECLARATIONS = {
  chat_turn: {
    area: 'chat', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Answered a question', he: 'מענה לשאלה', es: 'Respuesta a una pregunta' },
  },
  chat_website_operation: {
    area: 'website', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Changed your website from chat', he: 'שינוי באתר דרך הצ׳אט', es: 'Cambio en tu sitio desde el chat' },
  },
  insight_run: {
    area: 'insights', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Checked your business for insights', he: 'בדיקת תובנות לעסק', es: 'Revisión de novedades del negocio' },
  },
  briefing_narration: {
    area: 'briefing', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Wrote your daily briefing', he: 'כתיבת התדריך היומי', es: 'Redacción del resumen diario' },
  },
  website_full_site: {
    area: 'website', audience: 'owner', templateFallback: 'n/a', isSetup: true, isCharged: true,
    diaryLabels: { en: 'Built your website', he: 'בניית האתר', es: 'Creación del sitio web' },
  },
  website_landing_page: {
    area: 'website', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Built a landing page', he: 'בניית דף נחיתה', es: 'Creación de una página de destino' },
  },
  website_field_regenerate: {
    area: 'website', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Rewrote website text', he: 'שכתוב טקסט באתר', es: 'Reescritura de texto del sitio' },
  },
  website_testimonial_enhance: {
    area: 'website', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Polished a testimonial', he: 'ליטוש המלצה', es: 'Mejora de un testimonio' },
  },
  // Dormant (KI-4, Layer 1 KI-1): labelled now so it is not unlabelled the day it is wired.
  website_section_field_rewrite: {
    area: 'website', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true, isDormant: true,
    diaryLabels: { en: 'Rewrote a website section', he: 'שכתוב מקטע באתר', es: 'Reescritura de una sección del sitio' },
  },
  // Dormant (KI-4, Layer 1 KI-3): labelled now so it is not unlabelled the day it is wired.
  website_block_enrichment: {
    area: 'website', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true, isDormant: true,
    diaryLabels: { en: 'Enriched website content', he: 'העשרת תוכן האתר', es: 'Enriquecimiento del contenido del sitio' },
  },
  intake_form_generation: {
    area: 'intake', audience: 'owner', templateFallback: 'n/a', isSetup: true, isCharged: true,
    diaryLabels: { en: 'Built an intake form', he: 'בניית טופס קליטה', es: 'Creación de un formulario de admisión' },
  },
  intake_question_inference: {
    area: 'intake', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Suggested an intake question', he: 'הצעת שאלה לטופס', es: 'Sugerencia de una pregunta para el formulario' },
  },
  // Spans website and onboarding; `website` is what the call site passes, and
  // the audit entry's `details.areas` stays authoritative (WC-4).
  onboarding_build: {
    area: 'website', audience: 'owner', templateFallback: 'n/a', isSetup: true, isCharged: true,
    diaryLabels: { en: 'Set up your business', he: 'הקמת העסק', es: 'Configuración de tu negocio' },
  },
  // The only client-facing type (SQ-12). The fallback EXISTS: the model only
  // picks which of the owner's own replies to send, and every failure (switched
  // off, empty, unusable, out of range, a throw) falls through to the
  // deterministic ladder with no model call. See
  // lib/business-os/leads/LeadReplyRecommender.ts:15-21 and
  // lib/business-os/leads/leadReplyCandidates.ts:103-138 (`pickFallbackCandidate`).
  lead_reply_recommendation: {
    area: 'leads', audience: 'client', templateFallback: 'exists', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Picked a reply to a new enquiry', he: 'בחירת מענה לפנייה חדשה', es: 'Elección de respuesta a una nueva consulta' },
  },
  onboarding_turn: {
    area: 'onboarding', audience: 'owner', templateFallback: 'n/a', isSetup: true, isCharged: true,
    diaryLabels: { en: 'Replied in your setup conversation', he: 'מענה בשיחת ההקמה', es: 'Respuesta en tu conversación de configuración' },
  },
  image_generation: {
    area: 'images', audience: 'owner', templateFallback: 'n/a', isSetup: false, isCharged: true,
    diaryLabels: { en: 'Created an image', he: 'יצירת תמונה', es: 'Creación de una imagen' },
  },
} as const satisfies Record<AiActionType, AiActionDeclaration>;

/** Failures the action itself signals, when it degraded without throwing (FR-6, RC-6). */
export type AiFailureCode =
  | 'briefing_fallback'
  | 'content_fallback'
  | 'image_failed'
  | 'image_no_data'
  | 'image_store_failed'
  | 'chat_error'
  | 'generation_failed';

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

/**
 * Mark a website or intake generation result that did not fully succeed:
 * `success: false` → `generation_failed`; a `content_fallback` warning (the
 * model's content was replaced by the static phrasebook) → `content_fallback`.
 * Only the code is recorded, never the warning's text (FR-6).
 */
export function markGenerationResult(
  handle: AiActionHandle,
  result: { success: boolean; warning?: string; contentSource?: string }
): void {
  if (!result.success) handle.markFailed('generation_failed');
  else if (result.warning?.includes('content_fallback') || result.contentSource === 'fallback') {
    handle.markFailed('content_fallback');
  }
}

export interface AiActionHandle {
  /** Set the account once it is known (e.g. a route that authenticates inside the action). */
  setAccount(accountId: string): void;
  /** Record that the action degraded without throwing (a fallback, an empty image…). */
  markFailed(code: AiFailureCode): void;
}

/**
 * The complete, closed set of `details` keys an AI audit entry carries.
 *
 * `schema: 2` (deduction layer slice 3a, SA-B1) adds `actionId`: one id per
 * `runAiAction` invocation, the join key to the charge row. Entries written
 * before it stay `schema: 1` and are not backfilled; no reader parses `schema`.
 */
export interface AiAuditDetails {
  schema: 2;
  /**
   * One per invocation, minted by `runAiAction` (SA-B1). Distinct from
   * `groupId`: one grouping id can now map to several entries (two onboarding
   * turns in one conversation, a retry). `entityId` stays the grouping id.
   */
  actionId: string;
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
  /** The invocation's own id (SA-B1), minted by `runAiAction`. */
  actionId: string;
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

/**
 * The action's failure, decided once (deduction layer slice 3a): the code the
 * action signalled, else the thrown error's code, else the last-attempt rule.
 * The audit entry and (from slice 3b-ii) the charge record both take this
 * result, so they can never disagree on succeeded / failed.
 */
export function resolveActionFailure(
  calls: UsageCallRecord[],
  signalled: string | undefined,
  thrown: { error: unknown } | undefined
): { code: string } | undefined {
  if (signalled) return { code: signalled };
  if (thrown) return { code: errorCodeOf(thrown.error) };
  return lastAttemptFailure(calls);
}

/** Build the audit entry. Pure: no I/O. Exactly the D-2 fields and nothing else. */
export function buildAiAuditEntry(summary: AiActionSummary): AuditLogInput {
  const { spec, calls } = summary;
  const failure = summary.failure ?? lastAttemptFailure(calls);
  const inputTokens = calls.reduce((n, c) => n + c.inputTokens, 0);
  const outputTokens = calls.reduce((n, c) => n + c.outputTokens, 0);
  const cost = calls.reduce((n, c) => n + c.costUsd, 0);

  const details: AiAuditDetails = {
    schema: 2,
    actionId: summary.actionId,
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
    // Rounded to 10 decimal places (deduction layer slice 2, SQ-14): enough to
    // clear float noise (0.30000000000000004 stores 0.3), the same precision as
    // the charge's numeric(…,10) (SQ-8), and fine enough that a ~2e-7 USD
    // embedding is not stored as 0. Entries written before slice 2 are rounded
    // to a micro-dollar; they are not backfilled. Exact while cost * 1e10 is a
    // safe integer, i.e. below ~$900,000 per action.
    estimatedCostUsd: Math.round(cost * 1e10) / 1e10,
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
 * What `runAiAction` decides once, at the end of an action, for BOTH records:
 * the validated identities (`null` = the entry and the charge must not be
 * written) and the failure. Taking one decision is what keeps the audit entry
 * and the charge from ever disagreeing (SA N-7).
 */
interface AiActionDecision {
  identities: { accountId: string; actorId: string } | null;
  failure: { code: string } | undefined;
}

/**
 * Run one AI action, queue its audit entry and record its charge.
 *
 * The action's result (or error) is returned (or rethrown) exactly as if it were
 * not wrapped. Writing the entry can never fail, change or delay the action: it
 * is queued without waiting, and any fault in building it is logged and dropped.
 * The charge (slice 3b-ii) is awaited, but can never fail or change the action,
 * and delays it by at most `BOS_AI_CHARGE_WRITE_BUDGET_MS`, plus the low-line
 * check's bound after a recorded charge (slice 8b: ≤ 0.5 s, ≤ 2.5 s on the one
 * charge per period that crosses the low line). An action that made
 * no LLM call writes no entry and no charge, and awaits nothing (FR-7).
 */
export async function runAiAction<T>(spec: AiActionSpec, fn: (handle: AiActionHandle) => Promise<T>): Promise<T> {
  // One id per invocation (SA-B1), minted before the scope opens: a nested
  // runAiAction mints its own, and a caller's retry is a new invocation, so a
  // new id (FR-9). Not on the handle: no call site needs it.
  const actionId = randomUUID();
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
  const calls = outcome.usage.calls;

  // Decided once (slice 3b-ii, SA N-7); `undefined` if deciding itself threw.
  let decision: AiActionDecision | undefined;
  try {
    const thrown = outcome.ok ? undefined : { error: outcome.error };
    decision = decideAiAction(spec, accountId, calls, signalled, thrown);
    emitAiAuditEntry(spec, actionId, accountId, calls, decision);
  } catch (err) {
    logger.error(
      { err, area: spec.area, actionType: spec.actionType, groupId: spec.groupId, accountId: accountId ?? null },
      'Building the AI audit entry failed; none written'
    );
  }

  // Deduction layer slice 2 (AC-3): an unpriced call fails loudly, naming its
  // area and action, which only this function knows. Log-only. Its own try, and
  // AFTER the entry is queued, so a fault here can never skip the audit entry
  // or change the action's result (SA Q-1 (a), S-1).
  try {
    reportUnpricedCalls(calls, {
      area: spec.area,
      actionType: spec.actionType,
      groupId: spec.groupId,
      accountId,
    });
  } catch (err) {
    logger.error(
      { err, area: spec.area, actionType: spec.actionType, groupId: spec.groupId, accountId: accountId ?? null },
      'Checking the AI action for unpriced calls failed'
    );
  }

  // Deduction layer slice 3b-ii (FR-13, FR-15, SQ-3): the charge, LAST, after
  // the entry is queued (so the entry never waits on it) and BEFORE the rethrow
  // (so a failed action is charged what it spent, FR-8). Zero calls: nothing is
  // awaited at all (NI-4).
  if (calls.length > 0) {
    await recordAiChargeSafely(spec, actionId, accountId, calls, decision);
  }

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** The decision both records take, or `undefined` when the action made no call. */
function decideAiAction(
  spec: AiActionSpec,
  accountId: string | undefined,
  calls: UsageCallRecord[],
  signalled: AiFailureCode | undefined,
  thrown: { error: unknown } | undefined
): AiActionDecision | undefined {
  if (calls.length === 0) return undefined; // FR-7: nothing to record.
  const identities = validateIdentities(spec, accountId);
  return { identities, failure: identities ? resolveActionFailure(calls, signalled, thrown) : undefined };
}

/**
 * `recordAiCharge` never throws and never rejects. This wrapper is defence in
 * depth: even a defect in it (or in reading the declaration) is logged here and
 * can never reach the action.
 */
async function recordAiChargeSafely(
  spec: AiActionSpec,
  actionId: string,
  accountId: string | undefined,
  calls: UsageCallRecord[],
  decision: AiActionDecision | undefined
): Promise<void> {
  try {
    await recordAiCharge({
      spec,
      actionId,
      accountId,
      decision,
      isCharged: AI_ACTION_DECLARATIONS[spec.actionType].isCharged,
      calls,
    });
  } catch (err) {
    logger.error(
      {
        err,
        event: 'bos_ai_charge_write_failed',
        reason: 'exception',
        service: AI_CHARGE_SERVICE,
        area: spec.area,
        actionType: spec.actionType,
        groupId: spec.groupId,
        actionId,
        accountId: accountId ?? null,
      },
      'AI charge write failed'
    );
  }
}

function emitAiAuditEntry(
  spec: AiActionSpec,
  actionId: string,
  accountId: string | undefined,
  calls: UsageCallRecord[],
  decision: AiActionDecision | undefined
): void {
  const ids = { area: spec.area, actionType: spec.actionType, groupId: spec.groupId, accountId: accountId ?? null };

  if (!decision) return; // FR-7: no LLM call, no entry.

  const { identities, failure } = decision;
  if (!identities) {
    logger.error(ids, 'AI audit entry not written: invalid grouping id or account, or the platform account');
    return;
  }

  const entry = buildAiAuditEntry({ spec, actionId, ...identities, calls, failure });

  // Never awaited (RC-4): log() awaits a 100-row insert when its entry fills the batch.
  void AuditTrail.log(entry).catch((err: unknown) => logger.error({ err, ...ids }, 'AI audit entry could not be queued'));
}
