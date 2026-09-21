/**
 * Business OS LLM Layer 2 — the settings resolver (FR-5 … FR-8, FR-10).
 *
 * Resolves `{ enabled, provider, model, temperature }` for one catalogued call,
 * field by field, in the order **call override → area value → code default**.
 *
 * Three promises hold this module together:
 *
 *  1. **It never throws.** A missing row, a row that is not an object, a single
 *     bad field, or a database outage each degrade to the code default — which
 *     is today's behaviour (FR-6). A configuration fault can never fail an
 *     owner action.
 *
 *     **Seven call sites DEPEND on this promise rather than re-proving it, and
 *     they are named here so nobody weakens it by accident (SA F-9).** These
 *     sites call `resolveBosLlmSettings` OUTSIDE the `try` that owns their
 *     fallback, so a throw here would not land on a template — it would
 *     propagate to the owner:
 *
 *       lib/business-os/briefing/BriefingNarrator.ts          (daily_narration)
 *       lib/services/WebsiteAIContentService.ts  ×4           (the dormant blocks)
 *       lib/services/IntakeGenerationService.ts               (form_generation)
 *       app/api/intake/form/infer-question/route.ts           (question_inference)
 *
 *     `__tests__/modelSettings.test.ts` (T1-5) is what keeps the promise true:
 *     it drives a missing row, a non-object row, a bad field and a repository
 *     error. **If you ever add a throwing path to this module, move those seven
 *     resolves inside their `try` first.** The insights sites already resolve
 *     inside the `try` and are the shape to copy.
 *  2. **A warm call does no I/O.** All eight rows are read, validated and
 *     resolved on one refill, at most once every 60 seconds per instance
 *     (DEC-8). A failed refill — rejected, or hung past a three-second budget
 *     that covers the row read AND the price lookups behind it (D-Q2, R-1) —
 *     serves the last good settings, or the code defaults on a cold start, and
 *     is retried after 10 seconds.
 *  3. **Only fully priced models are accepted.** A model whose price is missing
 *     or zero is refused as a field, so cost tracking can never silently become
 *     $0 (DEC-7, SA addendum §F.5).
 *
 * Server-only: it reaches the repository layer. Never import it from a
 * `'use client'` module.
 *
 * @see docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §3.3, §3.4
 * @module lib/business-os/llm/modelSettings
 */

import { rejectsSamplingParameters, usesMaxCompletionTokens } from '@/lib/ai/providers/openaiProvider';
import { getPricing } from '@/lib/ai/pricing';
import { createLogger } from '@/lib/logger';
import {
  IMAGE_FALLBACK_PRICING,
  systemConfigRepository,
  type ImageGenerationConfig,
} from '@/lib/repositories/SystemConfigRepository';
import { BOS_LLM_AREAS, type BosLlmArea } from './callCatalog';
import {
  BOS_LLM_AREA_KEYS,
  BOS_LLM_AREA_LOCKS,
  bosLlmAreaKey,
  bosLlmSettingsCallNames,
  getBosLlmCallPolicy,
  IMAGE_PRICE_REQUIRED_QUALITIES,
  isImageModelName,
  MAX_MODEL_NAME_LENGTH,
  TEMPERATURE_BOUNDS,
  type BosLlmCallPolicy,
  type BosLlmProvider,
  type BosLlmSettingsCallName,
} from './modelSettingsPolicy';
import {
  BOS_LLM_ROW_TOP_LEVEL_KEYS,
  BosLlmFieldSetSchema,
  parseAreaRow,
  type BosLlmSettingField,
} from './modelSettingsSchema';

const logger = createLogger({ module: 'BosLlmModelSettings' });

/** How long one instance serves a snapshot before re-reading (DEC-8, FR-10). */
export const BOS_LLM_SETTINGS_CACHE_MS = 60_000;

/** How long it waits before retrying after a failed read (DEC-8). */
export const BOS_LLM_SETTINGS_ERROR_RETRY_MS = 10_000;

/**
 * How long one refill may take before it counts as failed (D-Q2).
 *
 * A REJECTED read was always handled; a read that never settles was not — a
 * stalled socket, a Supabase incident that holds the connection, or a cold
 * start against a paused project left every caller awaiting the same promise
 * for ever, which breaks this module's first promise ("a configuration fault
 * can never fail an owner action") in the one way that matters most. The budget
 * turns a hang into the ordinary failure path: last good settings, or the code
 * defaults, and a retry in ten seconds.
 *
 * Three seconds is chosen to be far longer than a healthy refill (a
 * single-digit-millisecond indexed read of eight rows, plus price lookups that
 * are usually cached) and far shorter than any user-facing timeout it sits
 * inside.
 *
 * The cost while a database really is stalled: EVERY call arriving inside the
 * window waits for it, so roughly three seconds in every thirteen (3 s budget,
 * then a 10 s back-off during which callers are served the last good settings
 * with no wait at all). Not "one call a minute" — that was wrong (R-2).
 */
export const BOS_LLM_SETTINGS_READ_TIMEOUT_MS = 3_000;

/** What a call site needs to make its request. */
export interface ResolvedBosLlmSettings {
  area: BosLlmArea;
  callName: string;
  /** False only for a switchable call the configuration turned off (FR-14). */
  enabled: boolean;
  provider: BosLlmProvider;
  model: string;
  /** `undefined` means: do NOT send a temperature (FR-4). */
  temperature: number | undefined;
  /** The code default, for the FR-11 retry. */
  defaultModel: string;
}

/**
 * Why a configured value was not used.
 *
 *  - `rejected` — the value broke a guardrail; the field falls back (DEC-7).
 *  - `locked`   — the field is fixed in code; the value is ignored (DEC-5).
 *  - `unknown`  — a key or call name that is not in the catalog (FR-2).
 *  - `adjusted` — the value was accepted, then dropped by a model rule (RC-11).
 */
export type BosLlmIssueKind = 'rejected' | 'locked' | 'unknown' | 'adjusted';

export interface BosLlmSettingIssue {
  area: BosLlmArea;
  /** Absent for an area-level or whole-row issue. */
  callName?: string;
  level: 'row' | 'area' | 'call';
  field: BosLlmSettingField | 'calls' | 'row';
  kind: BosLlmIssueKind;
  reason: string;
  /**
   * Only ever a platform label (a model or provider name) or a primitive
   * setting value — never owner text (skill Standard 5).
   */
  value?: unknown;
}

/** One area's resolved settings, as cached. */
interface AreaSnapshot {
  /** Area-level switch, after the area lock (used by the chat entry gates). */
  enabled: boolean;
  calls: Map<string, ResolvedBosLlmSettings>;
  rowPresent: boolean;
  rowUpdatedAt: string | null;
}

interface SettingsSnapshot {
  areas: Map<BosLlmArea, AreaSnapshot>;
  loadedAt: number;
  /** True when the read failed and this snapshot is code defaults, not configuration. */
  fromFailedRead: boolean;
}

let snapshot: SettingsSnapshot | null = null;
let nextRefreshAt = 0;
let inFlight: Promise<SettingsSnapshot> | null = null;

// ---------------------------------------------------------------------------
// Code defaults
// ---------------------------------------------------------------------------

/** The code default for one call: today's behaviour, and the last resolution level. */
export function bosLlmCodeDefaults(area: BosLlmArea, callName: string): ResolvedBosLlmSettings {
  const policy = getBosLlmCallPolicy(area, callName);
  if (!policy) {
    // Unreachable through the typed public API; defensive so nothing throws.
    return {
      area,
      callName,
      enabled: true,
      provider: 'openai',
      model: '',
      temperature: undefined,
      defaultModel: '',
    };
  }
  return {
    area,
    callName,
    enabled: true,
    provider: policy.default.provider,
    model: policy.default.model,
    temperature: policy.default.temperature ?? undefined,
    defaultModel: policy.default.model,
  };
}

function defaultAreaSnapshot(area: BosLlmArea): AreaSnapshot {
  const calls = new Map<string, ResolvedBosLlmSettings>();
  for (const callName of bosLlmSettingsCallNames(area)) {
    calls.set(callName, bosLlmCodeDefaults(area, callName));
  }
  return { enabled: true, calls, rowPresent: false, rowUpdatedAt: null };
}

function defaultSnapshot(fromFailedRead: boolean): SettingsSnapshot {
  const areas = new Map<BosLlmArea, AreaSnapshot>();
  for (const area of BOS_LLM_AREAS) areas.set(area, defaultAreaSnapshot(area));
  return { areas, loadedAt: Date.now(), fromFailedRead };
}

// ---------------------------------------------------------------------------
// Guardrails (DEC-7, RC-2, RC-5, RC-11, SA addendum §F.5)
// ---------------------------------------------------------------------------

/**
 * Shared per-refill state: the price lookups are memoised per distinct
 * `provider:model`, because `lib/ai/pricing.ts` reloads the whole pricing table
 * on every call while its own cache is empty (RC-W7c). The image configuration
 * is read at most once, and only if an image model differs from the default.
 */
export interface GuardrailContext {
  price: Map<string, Promise<{ input: number; output: number } | null>>;
  imageConfig: Promise<ImageGenerationConfig> | null;
}

function newGuardrailContext(): GuardrailContext {
  return { price: new Map(), imageConfig: null };
}

function priceFor(
  ctx: GuardrailContext,
  provider: string,
  model: string
): Promise<{ input: number; output: number } | null> {
  const key = `${provider}:${model}`;
  let pending = ctx.price.get(key);
  if (!pending) {
    pending = getPricing(provider, model).catch((error) => {
      logger.warn({ err: error, provider, model }, 'Price lookup failed; treating the model as unpriced');
      return null;
    });
    ctx.price.set(key, pending);
  }
  return pending;
}

function imageConfigFor(ctx: GuardrailContext): Promise<ImageGenerationConfig> {
  if (!ctx.imageConfig) ctx.imageConfig = systemConfigRepository.getImageGenerationConfig();
  return ctx.imageConfig;
}

export type FieldCheck = { ok: true } | { ok: false; reason: string };

const OK: FieldCheck = { ok: true };

/**
 * Is this token model usable for this call?
 *
 * The `> 0` price rule is LOCAL TO LAYER 2 (SA addendum §F.5–F.6). It must not
 * be pushed into `hasPricing`, `calculateCost` or `calculateCostSync`:
 * embedding models are legitimately priced input-only (`output: 0`,
 * `lib/ai/pricing.ts` `text-embedding-*`), and embeddings are excluded from
 * these settings anyway (DEC-3). `hasPricing` alone is not enough — it returns
 * true for a 0/0 row, which is exactly the "free AI" hole DEC-7 exists to close.
 */
async function checkTokenModel(
  ctx: GuardrailContext,
  provider: string,
  model: string,
  policy: BosLlmCallPolicy
): Promise<FieldCheck> {
  // An image model on a token call (D-Q5). The price check cannot catch this:
  // it only asks whether the model is priced, and a priced image model passes.
  if (isImageModelName(model)) return { ok: false, reason: 'image_model_on_token_call' };

  // A reasoning model rejects sampling parameters with a 400 that is NOT a
  // model-not-found error, so the FR-11 retry would not catch it (RC-11).
  const sendsLockedTemperature = typeof policy.temperature === 'object';
  if (rejectsSamplingParameters(model) && (policy.sendsSamplingPenalty || sendsLockedTemperature)) {
    return { ok: false, reason: 'model_rejects_sampling_parameters' };
  }
  // A reasoning family outside the `max_completion_tokens` list (today `o1*`)
  // would be sent `max_tokens` and fail on every call (RC-W5).
  if (rejectsSamplingParameters(model) && !usesMaxCompletionTokens(model)) {
    return { ok: false, reason: 'reasoning_model_sent_max_tokens' };
  }

  const price = await priceFor(ctx, provider, model);
  if (!price) return { ok: false, reason: 'unpriced_model' };
  if (!(price.input > 0) || !(price.output > 0)) return { ok: false, reason: 'zero_price' };
  return OK;
}

/**
 * An image model is accepted only if EVERY configured size is priced at low,
 * medium and high (RC-5, SA V-7): `quality: 'auto'` is priced after the call by
 * the quality the provider reports, so one missing combination records $0.
 */
async function checkImageModel(ctx: GuardrailContext, model: string): Promise<FieldCheck> {
  const config = await imageConfigFor(ctx);
  const sizes = Array.from(new Set(Object.values(config.sizes)));
  for (const size of sizes) {
    for (const quality of IMAGE_PRICE_REQUIRED_QUALITIES) {
      const key = `${model}:${size}:${quality}`;
      const configured = config.pricesUsd[key];
      if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) continue;
      const fallback = IMAGE_FALLBACK_PRICING[key];
      if (typeof fallback === 'number' && fallback > 0) continue;
      return { ok: false, reason: 'image_price_missing' };
    }
  }
  return OK;
}

async function checkModel(
  ctx: GuardrailContext,
  provider: BosLlmProvider,
  model: unknown,
  policy: BosLlmCallPolicy
): Promise<FieldCheck> {
  if (typeof model !== 'string') return { ok: false, reason: 'model_not_a_string' };
  const trimmed = model.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'model_empty' };
  if (trimmed !== model) return { ok: false, reason: 'model_not_trimmed' };
  if (model.length > MAX_MODEL_NAME_LENGTH) return { ok: false, reason: 'model_too_long' };

  // RC-W7b: the code default is the last level and is never checked at runtime,
  // so a configured value equal to it costs no price query either.
  if (model === policy.default.model && provider === policy.default.provider) return OK;

  return policy.kind === 'image'
    ? checkImageModel(ctx, model)
    : checkTokenModel(ctx, provider, model, policy);
}

/**
 * Would this model be accepted for this call, ignoring the "equal to the code
 * default" shortcut?
 *
 * Exported for one purpose: T1-3 proves that every code default would itself
 * pass the guardrails. That is what makes "the default is never checked at
 * runtime" (RC-W7b) safe rather than convenient.
 */
export async function checkModelAcceptable(
  area: BosLlmArea,
  callName: string,
  provider: BosLlmProvider,
  model: string
): Promise<FieldCheck> {
  const policy = getBosLlmCallPolicy(area, callName);
  if (!policy) return { ok: false, reason: 'unknown_call_name' };
  const ctx = newGuardrailContext();
  return policy.kind === 'image'
    ? checkImageModel(ctx, model)
    : checkTokenModel(ctx, provider, model, policy);
}

function checkProvider(provider: unknown, policy: BosLlmCallPolicy): FieldCheck {
  if (typeof provider !== 'string') return { ok: false, reason: 'provider_not_a_string' };
  return (policy.allowedProviders as readonly string[]).includes(provider)
    ? OK
    : { ok: false, reason: 'provider_not_allowed' };
}

function checkTemperature(temperature: unknown): FieldCheck {
  if (temperature === null) return OK; // "send none" (DEC-2)
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
    return { ok: false, reason: 'temperature_not_a_number' };
  }
  return temperature >= TEMPERATURE_BOUNDS.min && temperature <= TEMPERATURE_BOUNDS.max
    ? OK
    : { ok: false, reason: 'temperature_out_of_range' };
}

// ---------------------------------------------------------------------------
// Resolution (FR-5, FR-8)
// ---------------------------------------------------------------------------

/** One level's raw values, already narrowed to "an object with the right containers". */
interface LevelValues {
  level: 'call' | 'area';
  values: Record<string, unknown>;
}

const ABSENT = Symbol('absent');

function readField(level: LevelValues | null, field: BosLlmSettingField): unknown | typeof ABSENT {
  if (!level) return ABSENT;
  return Object.prototype.hasOwnProperty.call(level.values, field) ? level.values[field] : ABSENT;
}

export interface AreaEvaluation {
  /** Area-level switch after the area lock — what the chat entry gates read. */
  enabled: boolean;
  calls: Map<string, ResolvedBosLlmSettings>;
  issues: BosLlmSettingIssue[];
}

/**
 * Validate and resolve one area row into every call's settings.
 *
 * Pure with respect to the cache: the resolver uses it on refill, and the
 * change script uses it to refuse a row the resolver would not honour (RC-9).
 */
export async function evaluateAreaRow(
  area: BosLlmArea,
  rowValue: unknown,
  ctx: GuardrailContext = newGuardrailContext()
): Promise<AreaEvaluation> {
  const issues: BosLlmSettingIssue[] = [];
  const calls = new Map<string, ResolvedBosLlmSettings>();
  const areaLockedOff = !BOS_LLM_AREA_LOCKS[area].switchable;

  const row = rowValue === undefined || rowValue === null ? null : parseAreaRow(rowValue);
  if (rowValue !== undefined && rowValue !== null && !row) {
    issues.push({ area, level: 'row', field: 'row', kind: 'rejected', reason: 'row_not_an_object' });
  }

  let areaLevel: LevelValues | null = null;
  const callLevels = new Map<string, LevelValues>();

  if (row) {
    for (const key of Object.keys(row)) {
      if (!BOS_LLM_ROW_TOP_LEVEL_KEYS.includes(key)) {
        issues.push({ area, level: 'area', field: 'row', kind: 'unknown', reason: 'unknown_field', value: key });
      }
    }
    areaLevel = { level: 'area', values: row as Record<string, unknown> };

    const knownCalls = new Set(bosLlmSettingsCallNames(area));
    for (const [callName, entry] of Object.entries(row.calls ?? {})) {
      if (!knownCalls.has(callName)) {
        issues.push({
          area,
          callName,
          level: 'call',
          field: 'calls',
          kind: 'unknown',
          reason: 'unknown_call_name',
          value: callName,
        });
        continue;
      }
      const parsed = BosLlmFieldSetSchema.safeParse(entry);
      if (!parsed.success || entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        issues.push({
          area,
          callName,
          level: 'call',
          field: 'calls',
          kind: 'rejected',
          reason: 'call_entry_not_an_object',
        });
        continue;
      }
      for (const key of Object.keys(parsed.data)) {
        if (!BOS_LLM_ROW_TOP_LEVEL_KEYS.includes(key) || key === 'calls') {
          issues.push({
            area,
            callName,
            level: 'call',
            field: 'row',
            kind: 'unknown',
            reason: 'unknown_field',
            value: key,
          });
        }
      }
      callLevels.set(callName, { level: 'call', values: parsed.data as Record<string, unknown> });
    }
  }

  // --- the area switch (what `isBosLlmAreaEnabled` reports) -----------------
  let areaEnabled = true;
  const rawAreaEnabled = readField(areaLevel, 'enabled');
  if (rawAreaEnabled !== ABSENT) {
    if (areaLockedOff) {
      // Only a value that would CHANGE something is reported. `enabled: true`
      // on an area that is always on is what the seed writes; treating it as a
      // thwarted intent would warn on every refill and make the change script
      // refuse the row the seed itself writes.
      if (rawAreaEnabled !== true) {
        issues.push({
          area,
          level: 'area',
          field: 'enabled',
          kind: 'locked',
          reason: 'area_not_switchable',
          value: rawAreaEnabled,
        });
      }
    } else if (typeof rawAreaEnabled !== 'boolean') {
      issues.push({
        area,
        level: 'area',
        field: 'enabled',
        kind: 'rejected',
        reason: 'enabled_not_a_boolean',
        value: rawAreaEnabled,
      });
    } else {
      areaEnabled = rawAreaEnabled;
    }
  }

  for (const callName of bosLlmSettingsCallNames(area)) {
    const policy = getBosLlmCallPolicy(area, callName);
    /* istanbul ignore next — bosLlmSettingsCallNames only yields policied calls */
    if (!policy) continue;

    const levels: Array<LevelValues | null> = [callLevels.get(callName) ?? null, areaLevel];
    const defaults = bosLlmCodeDefaults(area, callName);
    const push = (
      level: 'call' | 'area',
      field: BosLlmSettingField,
      kind: BosLlmIssueKind,
      reason: string,
      value: unknown
    ) => issues.push({ area, callName, level, field, kind, reason, value });

    // --- provider ----------------------------------------------------------
    let provider: BosLlmProvider = defaults.provider;
    for (const level of levels) {
      const raw = readField(level, 'provider');
      if (raw === ABSENT) continue;
      const check = checkProvider(raw, policy);
      if (!check.ok) {
        push(level!.level, 'provider', 'rejected', check.reason, raw);
        continue;
      }
      provider = raw as BosLlmProvider;
      break;
    }

    // --- model -------------------------------------------------------------
    let model = defaults.model;
    for (const level of levels) {
      const raw = readField(level, 'model');
      if (raw === ABSENT) continue;
      // eslint-disable-next-line no-await-in-loop -- at most two levels, memoised
      const check = await checkModel(ctx, provider, raw, policy);
      if (!check.ok) {
        push(level!.level, 'model', 'rejected', check.reason, raw);
        continue;
      }
      model = raw as string;
      break;
    }

    // S1-8: provider and model must not decohere. If the model ended up at the
    // code default — because none was configured, or because every configured
    // one was refused — the default's provider goes with it. Unreachable while
    // every call allows only OpenAI, but `{ provider: 'anthropic', model: <an
    // OpenAI default> }` is exactly the trap waiting for the first call that
    // legitimately allows a second provider.
    if (model === defaults.model) provider = defaults.provider;

    // --- temperature -------------------------------------------------------
    let temperature: number | undefined = defaults.temperature;
    const temperaturePolicy = policy.temperature;
    // Only a CALL-level value is reported when the temperature is locked. An
    // area-level temperature is legitimately meant for the area's other calls
    // — the seeded chat row sets 0 for `analysis`, and the planner, whose 0 is
    // locked, must not turn that into a warning on every refill or make the
    // change script refuse the row the seed itself writes.
    if (typeof temperaturePolicy === 'object') {
      temperature = temperaturePolicy.locked;
      const rawCall = readField(levels[0], 'temperature');
      if (rawCall !== ABSENT && rawCall !== temperaturePolicy.locked) {
        push('call', 'temperature', 'locked', 'temperature_locked', rawCall);
      }
      // S1-9: an AREA-level value that differs from the lock is half an intent
      // that did not land, so it must be visible somewhere — but as
      // `adjusted`, which does not block the change script: the row is
      // legitimate for the area's other calls, and the seed's `0 === 0` stays
      // silent.
      const rawArea = readField(levels[1], 'temperature');
      if (rawArea !== ABSENT && rawArea !== temperaturePolicy.locked) {
        push('area', 'temperature', 'adjusted', 'temperature_locked', rawArea);
      }
    } else if (temperaturePolicy === 'not_applicable') {
      temperature = undefined;
      for (const level of levels) {
        const raw = readField(level, 'temperature');
        if (raw !== ABSENT) push(level!.level, 'temperature', 'locked', 'temperature_not_applicable', raw);
      }
    } else {
      for (const level of levels) {
        const raw = readField(level, 'temperature');
        if (raw === ABSENT) continue;
        const check = checkTemperature(raw);
        if (!check.ok) {
          push(level!.level, 'temperature', 'rejected', check.reason, raw);
          continue;
        }
        temperature = raw === null ? undefined : (raw as number);
        break;
      }
    }

    // --- enabled -----------------------------------------------------------
    // A locked call always resolves `enabled: true` (§3.1): its off path is
    // either impossible (onboarding) or not shipped yet (the Step 3 website
    // calls), and the chat area's switch is enforced at route entry by
    // `isBosLlmAreaEnabled`, not through the planner's own flag.
    let enabled = true;
    const callLocked = !policy.switchable;
    if (callLocked || areaLockedOff) {
      const rawCall = readField(levels[0], 'enabled');
      if (rawCall !== ABSENT && rawCall !== true) {
        push(
          'call',
          'enabled',
          'locked',
          areaLockedOff ? 'area_not_switchable' : 'call_not_switchable',
          rawCall
        );
      }
    } else {
      enabled = areaEnabled;
      const rawCall = readField(levels[0], 'enabled');
      if (rawCall !== ABSENT) {
        if (typeof rawCall !== 'boolean') {
          push('call', 'enabled', 'rejected', 'enabled_not_a_boolean', rawCall);
        } else {
          enabled = rawCall;
        }
      }
    }

    // --- after resolution: reasoning models take no temperature (RC-11) -----
    if (temperature !== undefined && rejectsSamplingParameters(model)) {
      // `level: 'call'` because this is decided per call, after resolution, and
      // the log line already carries the call name (S1-10). It is not a claim
      // about which level the value came from.
      push('call', 'temperature', 'adjusted', 'model_rejects_sampling_parameters', temperature);
      temperature = undefined;
    }

    calls.set(callName, {
      area,
      callName,
      enabled,
      provider,
      model,
      temperature,
      defaultModel: defaults.defaultModel,
    });
  }

  return { enabled: areaLockedOff ? true : areaEnabled, calls, issues };
}

// ---------------------------------------------------------------------------
// Cache (DEC-8, FR-10)
// ---------------------------------------------------------------------------

function logIssues(issues: readonly BosLlmSettingIssue[]): void {
  for (const issue of issues) {
    const fields = {
      area: issue.area,
      callName: issue.callName,
      level: issue.level,
      field: issue.field,
      reason: issue.reason,
      // Platform labels only (a model or provider name, a boolean, a number).
      value: issue.value,
    };
    if (issue.kind === 'rejected') {
      logger.error(fields, 'Business OS LLM setting ignored: the value failed a guardrail');
    } else {
      logger.warn(fields, 'Business OS LLM setting ignored');
    }
  }
}

/** Info-level change log (DEC-10.2): labels only, never prompt or owner text. */
function logChanges(previous: SettingsSnapshot | null, next: SettingsSnapshot): void {
  if (!previous || previous.fromFailedRead) return; // a cold start logs nothing
  for (const area of BOS_LLM_AREAS) {
    const before = previous.areas.get(area);
    const after = next.areas.get(area);
    if (!before || !after) continue;

    const changes: Array<{ callName?: string; field: string; from: unknown; to: unknown }> = [];
    if (before.enabled !== after.enabled) {
      changes.push({ field: 'enabled', from: before.enabled, to: after.enabled });
    }
    for (const [callName, settings] of after.calls) {
      const old = before.calls.get(callName);
      if (!old) continue;
      for (const field of ['enabled', 'provider', 'model', 'temperature'] as const) {
        if (old[field] !== settings[field]) {
          changes.push({ callName, field, from: old[field], to: settings[field] });
        }
      }
    }
    if (changes.length > 0) {
      logger.info(
        { area, changes, rowUpdatedAt: after.rowUpdatedAt },
        'Business OS LLM settings changed'
      );
    }
  }
}

/**
 * Run one refill under the budget (D-Q2, SA R-1).
 *
 * The budget covers the WHOLE refill, not only the row read. The refill also
 * awaits `getPricing` and `getImageGenerationConfig` — both of which reach the
 * network — and each sits behind the same shared in-flight promise, so a hang
 * in either would strand every caller exactly as a hung row read did. Bounding
 * only the first await fixes the case that was easy to see and leaves the two
 * that only appear once an operator configures a model different from the code
 * default.
 */
function withReadBudget<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Settings refill exceeded ${BOS_LLM_SETTINGS_READ_TIMEOUT_MS}ms`)),
        BOS_LLM_SETTINGS_READ_TIMEOUT_MS
      );
      // Never hold a serverless invocation open for the timer's sake.
      (timer as unknown as { unref?: () => void }).unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** What one refill produced, before anything is logged or cached. */
interface BuiltSnapshot {
  areas: Map<BosLlmArea, AreaSnapshot>;
  issues: BosLlmSettingIssue[];
  missingAreas: BosLlmArea[];
}

/**
 * Read and resolve all eight areas.
 *
 * Deliberately FREE OF SIDE EFFECTS: it touches no module state and writes no
 * log line. A build that loses the race against the budget keeps running to
 * completion in the background, and it must not then overwrite the snapshot
 * that was served in its place, nor log settings that were never used.
 */
async function buildSnapshot(): Promise<BuiltSnapshot> {
  const { data, error } = await systemConfigRepository.getByKeys([...BOS_LLM_AREA_KEYS]);
  if (error || !data) throw error ?? new Error('No data returned');

  const byKey = new Map(data.map((row) => [row.key, row]));
  const ctx = newGuardrailContext();
  const areas = new Map<BosLlmArea, AreaSnapshot>();
  const issues: BosLlmSettingIssue[] = [];
  const missingAreas: BosLlmArea[] = [];

  for (const area of BOS_LLM_AREAS) {
    const row = byKey.get(bosLlmAreaKey(area));
    if (!row) {
      missingAreas.push(area);
      areas.set(area, defaultAreaSnapshot(area));
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- eight areas, one refill
    const evaluation = await evaluateAreaRow(area, row.value, ctx);
    issues.push(...evaluation.issues);
    areas.set(area, {
      enabled: evaluation.enabled,
      calls: evaluation.calls,
      rowPresent: true,
      rowUpdatedAt: (row as { updated_at?: string }).updated_at ?? null,
    });
  }

  return { areas, issues, missingAreas };
}

async function refill(): Promise<SettingsSnapshot> {
  const previous = snapshot;
  try {
    const built = await withReadBudget(buildSnapshot());

    for (const area of built.missingAreas) {
      logger.debug({ area, key: bosLlmAreaKey(area) }, 'No Business OS LLM settings row; using code defaults');
    }
    logIssues(built.issues);

    const next: SettingsSnapshot = { areas: built.areas, loadedAt: Date.now(), fromFailedRead: false };
    logChanges(previous, next);
    snapshot = next;
    nextRefreshAt = Date.now() + BOS_LLM_SETTINGS_CACHE_MS;
    return next;
  } catch (error) {
    return onReadFailure(error);
  }
}

/** Serve the last good settings (or the code defaults) and retry sooner (FR-6). */
function onReadFailure(error: unknown): SettingsSnapshot {
  nextRefreshAt = Date.now() + BOS_LLM_SETTINGS_ERROR_RETRY_MS;
  logger.warn(
    { err: error, servingLastGood: snapshot !== null && !snapshot.fromFailedRead },
    'Could not read Business OS LLM settings; serving the last good values'
  );
  if (!snapshot) snapshot = defaultSnapshot(true);
  return snapshot;
}

async function getSnapshot(): Promise<SettingsSnapshot> {
  if (snapshot && Date.now() < nextRefreshAt) return snapshot;
  if (inFlight) return inFlight;

  const pending = refill().finally(() => {
    inFlight = null;
  });
  inFlight = pending;
  return pending;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The settings for one catalogued call.
 *
 * Typed against the catalog: a misspelled call name, or a call that belongs to
 * another area, is a `typecheck:bos-llm` error rather than a silent default
 * (RC-W7a). Embeddings are excluded by the type (DEC-3).
 *
 * Never throws, and never blocks on I/O once the cache is warm.
 */
export async function resolveBosLlmSettings<A extends BosLlmArea>(
  area: A,
  callName: BosLlmSettingsCallName<A>
): Promise<ResolvedBosLlmSettings> {
  try {
    const current = await getSnapshot();
    const resolved = current.areas.get(area)?.calls.get(callName as string);
    if (resolved) return resolved;
    return bosLlmCodeDefaults(area, callName as string);
  } catch (error) {
    // Defensive: refill() already catches everything, so this is unreachable
    // unless the cache itself breaks. Today's behaviour is the worst case.
    logger.error({ err: error, area, callName }, 'Business OS LLM settings resolution failed; using code defaults');
    return bosLlmCodeDefaults(area, callName as string);
  }
}

/**
 * The area-level switch, for the entry gates that must stop a whole area's
 * spend before any call is made (RC-W7d: chat v4, v2 and v1).
 *
 * An area that cannot be switched off (onboarding) always reports `true`.
 */
export async function isBosLlmAreaEnabled(area: BosLlmArea): Promise<boolean> {
  try {
    const current = await getSnapshot();
    return current.areas.get(area)?.enabled ?? true;
  } catch (error) {
    logger.error({ err: error, area }, 'Business OS LLM area switch unreadable; treating the area as enabled');
    return true;
  }
}

/** What the change script refuses to write (RC-9, RC-W8a). */
export interface AreaRowValidation {
  ok: boolean;
  /** Guardrail failures, locked fields and unknown names — every one blocks a write. */
  rejected: BosLlmSettingIssue[];
  /** Accepted, but changed by a model rule (RC-11). Reported, does not block. */
  adjusted: BosLlmSettingIssue[];
  /** What the resolver would return for this row. */
  resolved: Map<string, ResolvedBosLlmSettings>;
  /** The area-level switch this row produces. */
  enabled: boolean;
}

/**
 * Validate a candidate row with the resolver's OWN schema and guardrails.
 *
 * The resolver ignores a bad or locked field and carries on; the script must
 * not, or an operator's intent would silently fail to happen (RC-W8a). So
 * every issue except `adjusted` blocks the write.
 */
export async function validateAreaRow(area: BosLlmArea, rowValue: unknown): Promise<AreaRowValidation> {
  const evaluation = await evaluateAreaRow(area, rowValue, newGuardrailContext());
  const rejected = evaluation.issues.filter((issue) => issue.kind !== 'adjusted');
  const adjusted = evaluation.issues.filter((issue) => issue.kind === 'adjusted');
  return {
    ok: rejected.length === 0,
    rejected,
    adjusted,
    resolved: evaluation.calls,
    enabled: evaluation.enabled,
  };
}

/** Drop the cache. Tests only. */
export function __resetBosLlmSettingsForTests(): void {
  snapshot = null;
  nextRefreshAt = 0;
  inFlight = null;
}

/** The cache state, for tests and diagnostics. */
export function __bosLlmSettingsCacheStateForTests(): {
  loaded: boolean;
  fromFailedRead: boolean;
  nextRefreshAt: number;
} {
  return {
    loaded: snapshot !== null,
    fromFailedRead: snapshot?.fromFailedRead ?? false,
    nextRefreshAt,
  };
}
