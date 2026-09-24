import 'server-only';

/**
 * What the Business OS LLM model-settings admin screen reads.
 *
 * ── The rule this module exists to keep ───────────────────────────────────
 * The STORED ROW and the RESOLVED VALUE are different things, and the
 * difference is invisible (requirement G-1). A row can be absent and every
 * call still resolve to a working value; a row can set a field the guardrails
 * REFUSE, and the call still resolves to something else. A screen that
 * rendered the stored row would be confidently wrong.
 *
 * So the payload is resolved-first: every call carries what it would actually
 * use, per-field provenance saying WHERE that came from, and every issue the
 * resolver raised, attached to the field it affected. The raw row is carried
 * too, clearly as a secondary fact.
 *
 * ── Nothing here re-implements the resolver ───────────────────────────────
 * Resolution, guardrails, locks and provenance all come from
 * `validateAreaRow`, the same function the operator script calls. This module
 * shapes; it does not decide.
 *
 * ── Serialisation ────────────────────────────────────────────────────────
 * The resolver returns `Map`s. A `Map` through `JSON.stringify` becomes `{}`
 * silently — the class of bug that ships green — so everything crossing the
 * response boundary is converted to plain objects HERE, once (RC-2a).
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §3.6
 * @module lib/business-os/llm/adminSettingsView
 */

import { BOS_LLM_AREAS, type BosLlmArea } from '@/lib/business-os/llm/callCatalog';
import {
  validateAreaRow,
  type BosLlmCallProvenance,
  type BosLlmSettingIssue,
} from '@/lib/business-os/llm/modelSettings';
import {
  BOS_LLM_AREA_LOCKS,
  bosLlmAreaKey,
  bosLlmSettingsCallNames,
  getBosLlmCallPolicy,
  isSwitchableBosLlmCall,
  TEMPERATURE_BOUNDS,
} from '@/lib/business-os/llm/modelSettingsPolicy';
import {
  buildAreaModelOptions,
  newModelOptionsContext,
  type AreaModelOptions,
} from '@/lib/business-os/llm/modelOptions';
import { adminUserRepository } from '@/lib/repositories/AdminUserRepository';
import { systemConfigRepository } from '@/lib/repositories/SystemConfigRepository';
import type { SystemSettingsConfig } from '@/lib/repositories/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BosLlmAdminSettingsView' });

/**
 * Who last changed an area, in exactly one of THREE states.
 *
 * The three are kept apart on purpose. "No row at all" and "a row nobody is
 * recorded against" are different facts, and collapsing them into one blank
 * would hide the more interesting one: because the SCREEN always records an
 * actor, a present row with no actor is de-facto a change made through the
 * break-glass command-line door.
 */
export type LastChangedBy =
  /** No stored row — there is nothing to attribute. */
  | { kind: 'no_row' }
  /** A row exists but carries no actor. Today, every seeded row is this. */
  | { kind: 'not_recorded'; at: string | null }
  /** A row with an actor we resolved to an active admin. */
  | { kind: 'admin'; at: string | null; email: string }
  /** A row with an actor that matches no bound active admin. Shown raw. */
  | { kind: 'unresolved'; at: string | null; userId: string };

export interface CallView {
  callName: string;
  resolved: {
    enabled: boolean;
    provider: string;
    model: string;
    /** `null` means: no temperature is sent. NEVER render this as 0. */
    temperature: number | null;
  };
  /** Which level each field came from — `call` | `area` | `default`. */
  provenance: BosLlmCallProvenance;
  /** Every issue the resolver raised against this call. */
  issues: BosLlmSettingIssue[];
  locks: {
    /** False when the row may not switch this call off. */
    switchable: boolean;
    /** Set when the temperature is fixed in code. */
    lockedTemperature: number | null;
    /** True when this call sends no temperature at all. */
    temperatureNotApplicable: boolean;
  };
  defaults: { provider: string; model: string; temperature: number | null };
}

export interface AreaView {
  area: BosLlmArea;
  key: string;
  /** False when the area can never be switched off (onboarding). */
  switchable: boolean;
  /** What the row configures for the area as a whole. */
  configuredEnabled: boolean;
  rowPresent: boolean;
  /** The raw stored row, secondary and labelled as such in the UI. */
  storedRow: unknown;
  updatedAt: string | null;
  lastChangedBy: LastChangedBy;
  calls: CallView[];
  /** Issues not attached to any one call (row- and area-level). */
  areaIssues: BosLlmSettingIssue[];
  /**
   * NOTE: there is deliberately NO area-level `allowedProviders` here.
   * Providers are a per-CALL property, and the authoritative list is
   * `modelOptions.allowedProvidersByCall`. Shipping a global list beside it
   * would be two answers to one question — which is exactly how the picker
   * came to offer a provider the resolver refuses.
   */
  temperatureBounds: { min: number; max: number };
  modelOptions: AreaModelOptions;
}

/**
 * Resolve `updated_by` ids to admin emails.
 *
 * ── The bug this shape exists to prevent (R-1) ───────────────────────────
 * `admin_users.user_id` is NULLABLE — null until an admin first signs in —
 * and `listActive()` filters on `is_active` alone, so it really can return an
 * active admin with no user id. Keying a map by that null and then asking
 * `map.get(row.updated_by)` for a row whose `updated_by` is also null would
 * match null to null and render EVERY unattributed row as that admin's email:
 * the exact opposite of what this feature promises.
 *
 * Two independent guards, both needed, each wrong to remove on its own:
 *   1. here — rows with a null `user_id` never enter the map;
 *   2. in `lastChangedByFor` — a null `updated_by` is answered before any
 *      lookup happens.
 */
async function buildAdminEmailById(): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  const { data, error } = await adminUserRepository.listActive();
  if (error || !data) {
    // Not fatal: an id that resolves to nothing renders raw and labelled,
    // which is honest. Failing the whole page over a label would be worse.
    logger.warn({ err: error }, 'Could not list active admins; actor ids will render unresolved');
    return byId;
  }
  for (const admin of data) {
    // GUARD 1 (R-1).
    if (!admin.user_id) continue;
    byId.set(admin.user_id, admin.email);
  }
  return byId;
}

export function lastChangedByFor(
  row: SystemSettingsConfig | undefined,
  adminEmailById: Map<string, string>
): LastChangedBy {
  if (!row) return { kind: 'no_row' };

  // `updated_at` is TYPED `string` — but that type is HAND-WRITTEN, not
  // generated from the schema, and this table has no CREATE TABLE in the repo
  // (it was made in the dashboard), so nothing here establishes that the column
  // is non-null. The renderer therefore does not rely on the declaration (QA
  // DEF-6): it is narrowed at this boundary, because `new Date(null)` is the
  // epoch and would print 1970 — a wrong answer that looks like a right one.
  // Every seeded row carries a timestamp today, so this is defensive; it is
  // pinned by a test rather than by an unverified claim about production.
  const at: string | null = row.updated_at ?? null;
  const userId = row.updated_by ?? null;

  // GUARD 2 (R-1): answered BEFORE any lookup, so a null can never be used as
  // a key. Note this is a distinct state, not a fallback — see `LastChangedBy`.
  if (!userId) return { kind: 'not_recorded', at };

  const email = adminEmailById.get(userId);
  if (email) return { kind: 'admin', at, email };

  // Never "unknown" and never blank: both read as "nobody", and somebody did
  // make this change.
  return { kind: 'unresolved', at, userId };
}

/** The resolver's `Map`s, flattened into something that survives JSON. */
function toCallViews(
  area: BosLlmArea,
  validation: Awaited<ReturnType<typeof validateAreaRow>>
): CallView[] {
  const views: CallView[] = [];

  for (const callName of bosLlmSettingsCallNames(area)) {
    const resolved = validation.resolved.get(callName);
    const provenance = validation.provenance.get(callName);
    const policy = getBosLlmCallPolicy(area, callName);
    /* istanbul ignore next — every policied call is resolved */
    if (!resolved || !provenance || !policy) continue;

    const temperaturePolicy = policy.temperature;

    views.push({
      callName,
      resolved: {
        enabled: resolved.enabled,
        provider: resolved.provider,
        model: resolved.model,
        // `undefined` disappears from JSON; `null` is the wire form of
        // "not set", and the UI must render it as such rather than as 0.
        temperature: resolved.temperature ?? null,
      },
      provenance,
      issues: validation.rejected
        .concat(validation.adjusted)
        .filter((issue) => issue.callName === callName),
      locks: {
        switchable: isSwitchableBosLlmCall(area, callName),
        lockedTemperature: typeof temperaturePolicy === 'object' ? temperaturePolicy.locked : null,
        temperatureNotApplicable: temperaturePolicy === 'not_applicable',
      },
      defaults: {
        provider: policy.default.provider,
        model: policy.default.model,
        temperature: policy.default.temperature,
      },
    });
  }

  return views;
}

/**
 * Build the whole screen in one read.
 *
 * Two queries: the eight rows, and the active admins for the FR-14 labels.
 * The `updated_by` and `updated_at` the labels need are already ON those rows,
 * so attribution costs no extra query.
 */
export async function buildAdminSettingsView(): Promise<{
  areas: AreaView[];
  generatedAt: string;
}> {
  const keys = BOS_LLM_AREAS.map(bosLlmAreaKey);

  const [rowsResult, adminEmailById] = await Promise.all([
    systemConfigRepository.getByKeys(keys),
    buildAdminEmailById(),
  ]);

  if (rowsResult.error) throw rowsResult.error;

  const rowByKey = new Map<string, SystemSettingsConfig>();
  for (const row of rowsResult.data ?? []) rowByKey.set(row.key, row);

  // ONE pricing snapshot and ONE guardrail context for the whole request. Per
  // area they were re-read, so the image configuration was fetched eight times
  // and no price lookup was shared between areas.
  const optionsContext = await newModelOptionsContext();

  const areas = await Promise.all(
    BOS_LLM_AREAS.map(async (area): Promise<AreaView> => {
      const key = bosLlmAreaKey(area);
      const row = rowByKey.get(key);

      // The SAME function the operator script calls, so the screen cannot
      // resolve — or refuse — differently from the other door.
      const validation = await validateAreaRow(area, row?.value);
      const modelOptions = await buildAreaModelOptions(area, optionsContext);

      return {
        area,
        key,
        switchable: BOS_LLM_AREA_LOCKS[area].switchable,
        configuredEnabled: validation.enabled,
        rowPresent: row !== undefined,
        storedRow: row?.value ?? null,
        updatedAt: row?.updated_at ?? null,
        lastChangedBy: lastChangedByFor(row, adminEmailById),
        calls: toCallViews(area, validation),
        areaIssues: validation.rejected
          .concat(validation.adjusted)
          .filter((issue) => issue.callName === undefined),
        temperatureBounds: TEMPERATURE_BOUNDS,
        modelOptions,
      };
    })
  );

  return { areas, generatedAt: new Date().toISOString() };
}
