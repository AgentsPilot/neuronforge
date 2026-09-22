/**
 * Business OS LLM Layer 2 — the shape of one area row (DEC-2, RC-3).
 *
 * Zod decides ONE thing here: "is this an object with the right shape of
 * containers". It deliberately does NOT validate the fields themselves — a
 * single bad field must fall back on its own (FR-6), and a Zod failure would
 * discard the whole row. The field rules live in the guardrails
 * (`./modelSettings`), which the resolver and the change script share.
 *
 * Field semantics:
 *   - absent            → inherit from the next level (call → area → code default)
 *   - `temperature: null` → send NO temperature (the four onboarding extractors)
 *   - unknown top-level keys and unknown `calls` names → ignored with a warning
 *
 * Server-only. Never import this from a `'use client'` module.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §3.2
 * @module lib/business-os/llm/modelSettingsSchema
 */

import { z } from 'zod';

/**
 * One level of settings: the area level, or one entry of `calls`.
 *
 * `passthrough` keeps unknown keys so the resolver can name them in its
 * warning instead of silently dropping them.
 */
export const BosLlmFieldSetSchema = z
  .object({
    enabled: z.unknown().optional(),
    provider: z.unknown().optional(),
    model: z.unknown().optional(),
    temperature: z.unknown().optional(),
  })
  .passthrough();

/**
 * The whole row.
 *
 * `calls` values are `unknown` on purpose: a single malformed call entry is
 * reported and ignored by the guardrails, and must not make Zod discard the
 * whole area row (FR-6).
 */
export const BosLlmAreaRowSchema = BosLlmFieldSetSchema.extend({
  calls: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type BosLlmFieldSet = z.infer<typeof BosLlmFieldSetSchema>;
export type BosLlmAreaRow = z.infer<typeof BosLlmAreaRowSchema>;

/** The four settable field names, in the order they are reported. */
export const BOS_LLM_SETTING_FIELDS = ['enabled', 'provider', 'model', 'temperature'] as const;
export type BosLlmSettingField = (typeof BOS_LLM_SETTING_FIELDS)[number];

/** The top-level keys a row may carry; anything else is warned about and ignored. */
export const BOS_LLM_ROW_TOP_LEVEL_KEYS: readonly string[] = [...BOS_LLM_SETTING_FIELDS, 'calls'];

/**
 * A JSONB value may arrive as the object itself or as a JSON string.
 *
 * A private copy of `SystemConfigRepository`'s helper of the same name: the
 * repository keeps its version unexported, and widening a repository's public
 * surface for one caller is not worth the coupling (§3.2).
 */
export function asRowObject(value: unknown): Record<string, unknown> | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

/** Parse a stored value into a row, or `null` when it is not an object at all (FR-6). */
export function parseAreaRow(value: unknown): BosLlmAreaRow | null {
  const object = asRowObject(value);
  if (!object) return null;
  const parsed = BosLlmAreaRowSchema.safeParse(object);
  return parsed.success ? parsed.data : null;
}
