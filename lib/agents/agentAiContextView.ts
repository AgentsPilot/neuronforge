// lib/agents/agentAiContextView.ts
//
// Canonical read path for an agent's "AI context" — the reasoning/confidence/
// prompt/intent-contract data historically stored (and duplicated) under
// `agents.agent_config.ai_context`.
//
// The dedicated top-level columns (`ai_reasoning`, `ai_confidence`,
// `created_from_prompt`, `generated_plan`, `user_prompt`) are the source of
// truth. `agent_config.ai_context` retains only what has no column
// (`intent_contract`, `data_schema`). This accessor reconstructs the full
// logical view column-first with a JSONB fallback, so a legacy "fat" row and a
// future "lean" row return identical data.
//
// See docs/workplans/AGENT_CONFIG_DEDUP_AND_MODEL_PROVENANCE_WORKPLAN.md (§3 A1).
//
// PURE: operates on an already-fetched row — it does not touch the database.

import type { Agent } from '@/lib/repositories/types'

export interface AgentAiContextView {
  reasoning: string
  confidence: number
  /** Raw prompt the user first typed (canonical column: `created_from_prompt`). */
  original_prompt: string
  /** Flat-string rendering of the enhanced prompt. Legacy rows stored this
   *  verbatim under `ai_context.enhanced_prompt`; lean rows render it on read
   *  from the structured `user_prompt`. Empty when the agent has no enhanced
   *  prompt (raw-prompt fallback path). */
  enhanced_prompt: string
  /** Structured enhanced prompt (`{plan_title, plan_description, sections,
   *  specifics}`). Canonical home: the `user_prompt` column. Null when
   *  `user_prompt` is a raw (non-JSON) prompt. */
  enhanced_prompt_data: Record<string, unknown> | null
  generated_plan: string
  /** WP-55 — no column; JSONB is the only home. */
  intent_contract: unknown | null
  /** WP-55 — no column; JSONB is the only home. */
  data_schema: unknown | null
}

/**
 * The row shape this accessor reads. It documents the columns a caller MUST
 * include in its Supabase `.select()` — the canonical sources of truth.
 *
 * CAVEAT (SA F1): these fields are declared optional on `Agent`, so `Pick`
 * preserves optionality and does NOT hard-fail a caller that forgot to select a
 * column (`Required<Pick<…>>` would, but it also rejects legitimate callers
 * holding a full `Agent`, so it is not used). The real safeguard against a
 * forgotten column on a lean row is therefore the reader-migration checklist
 * (workplan §6) plus the lean-vs-fat parity test — NOT the type. Treat this
 * type as the required-columns contract, documented, not compiler-enforced.
 */
export type AgentAiContextRow = Pick<
  Agent,
  'ai_reasoning' | 'ai_confidence' | 'created_from_prompt' | 'generated_plan' | 'user_prompt' | 'agent_config'
>

/** Guarded parse of `user_prompt` → structured enhanced-prompt object.
 *  Returns null for a raw (non-JSON) prompt or any malformed value. */
export function parseEnhancedPromptData(
  userPrompt: string | null | undefined
): Record<string, unknown> | null {
  if (!userPrompt || typeof userPrompt !== 'string') return null
  const trimmed = userPrompt.trim()
  if (!trimmed.startsWith('{')) return null // fast-reject raw prompts without throwing
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Best-effort flat rendering of a structured enhanced prompt, used when no
 *  pre-rendered string is stored (lean rows). Order: title → description →
 *  section bodies. */
export function renderEnhancedPrompt(structured: Record<string, unknown> | null): string {
  if (!structured) return ''
  const parts: string[] = []
  if (typeof structured.plan_title === 'string') parts.push(structured.plan_title)
  if (typeof structured.plan_description === 'string') parts.push(structured.plan_description)
  const sections = structured.sections
  if (sections && typeof sections === 'object') {
    for (const value of Object.values(sections as Record<string, unknown>)) {
      if (typeof value === 'string') parts.push(value)
      else if (value != null) parts.push(JSON.stringify(value))
    }
  }
  return parts.filter(Boolean).join('\n\n')
}

/**
 * Reconstruct the logical `ai_context` view for an agent, column-first with a
 * JSONB fallback. Identical output for legacy fat rows and future lean rows.
 */
export function getAgentAiContextView(agent: AgentAiContextRow): AgentAiContextView {
  const ac = ((agent.agent_config as { ai_context?: unknown } | null)?.ai_context ?? {}) as Record<
    string,
    unknown
  >
  const cm = (agent.agent_config as { creation_metadata?: { enhanced_prompt_data?: unknown } } | null)
    ?.creation_metadata

  const structured =
    parseEnhancedPromptData(agent.user_prompt) ??
    ((cm?.enhanced_prompt_data as Record<string, unknown> | undefined) ?? null)

  return {
    reasoning: agent.ai_reasoning ?? (ac.reasoning as string) ?? '',
    confidence: agent.ai_confidence ?? (ac.confidence as number) ?? 0,
    original_prompt: agent.created_from_prompt ?? (ac.original_prompt as string) ?? '',
    generated_plan:
      (typeof agent.generated_plan === 'string' ? agent.generated_plan : undefined) ??
      (ac.generated_plan as string) ??
      '',
    enhanced_prompt: (ac.enhanced_prompt as string) || renderEnhancedPrompt(structured),
    enhanced_prompt_data: structured,
    intent_contract: ac.intent_contract ?? null, // JSONB-only
    data_schema: ac.data_schema ?? null, // JSONB-only
  }
}
