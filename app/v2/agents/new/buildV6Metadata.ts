// app/v2/agents/new/buildV6Metadata.ts
// Pure builder for `agent_config.creation_metadata.v6_metadata` (A2 Option A).
//
// V6 pipeline creation telemetry, sourced from the V6 response `metadata` at save
// time (no new DB call). Replaces the duplicated `enhanced_prompt_data` payload
// (the enhanced prompt itself lives canonically in the `user_prompt` column).
//
// SA rulings (2026-07-14):
//  - `phase_times_ms` is a VERBATIM passthrough — never hardcode/normalize the
//    pipeline's phase-name keys.
//  - Fields that duplicate a column are NOT included (`generated_at` →
//    `ai_generated_at` column; `plugins_used` → `plugins_required` column).
//  - Null/absent sub-fields (e.g. `grounding_confidence` on pipeline A) are
//    OMITTED, not stored as null.
// See docs/requirements/AGENT_CONFIG_CREATION_TELEMETRY_REQUIREMENT.md.

import type { V6CreationMetadata } from '@/components/agent-creation/types/generate-agent-v2'

export interface V6ResponseMetadataLike {
  architecture?: string
  total_time_ms?: number
  phase_times_ms?: Record<string, number>
  steps_generated?: number
  grounding_confidence?: number | null
  formalization_confidence?: number | null
}

/**
 * Build the V6 creation-telemetry object, or null when no metadata is available
 * (e.g. a non-V6 path). Omits null/undefined confidence sub-fields.
 */
export function buildV6Metadata(metadata: V6ResponseMetadataLike | null | undefined): V6CreationMetadata | null {
  if (!metadata) return null
  const out: V6CreationMetadata = {
    architecture: metadata.architecture ?? '',
    total_time_ms: metadata.total_time_ms ?? 0,
    phase_times_ms: metadata.phase_times_ms ?? {},
    steps_generated: metadata.steps_generated ?? 0,
  }
  if (metadata.grounding_confidence != null) out.grounding_confidence = metadata.grounding_confidence
  if (metadata.formalization_confidence != null) out.formalization_confidence = metadata.formalization_confidence
  return out
}
