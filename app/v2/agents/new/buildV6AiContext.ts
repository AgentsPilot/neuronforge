// app/v2/agents/new/buildV6AiContext.ts
// Pure builder for the V6 agent's `agent_config.ai_context`.
//
// A2 de-dup (SA-approved 2026-07-14): ai_context now stores ONLY the two fields
// that have no dedicated column — `intent_contract` and `data_schema` (WP-55).
// The former narrative fields (reasoning/confidence/original_prompt/
// enhanced_prompt/generated_plan) duplicated top-level columns and are dropped;
// read them via getAgentAiContextView (column-first). Legacy V4/SmartAgentBuilder
// paths still emit the fat shape — the accessor covers both.
//
// See docs/workplans/AGENT_CONFIG_DEDUP_AND_MODEL_PROVENANCE_WORKPLAN.md (§3 A2).

import type { CreateAgentAIContext } from '@/components/agent-creation/types/generate-agent-v2'

export interface BuildV6AiContextArgs {
  /**
   * WP-55: Phase-1 raw IntentContract LLM output (Pipeline A). Persisted so
   * post-hoc diagnosis of this agent's emission is a SQL lookup instead of a
   * non-deterministic re-run. `undefined`/absent coalesces to `null`.
   */
  intentContract?: unknown | null
  /** WP-55: Phase-2 data_schema (slot schemas + semantic types). Same null semantics. */
  dataSchema?: unknown | null
}

/**
 * Assemble the lean `ai_context` persisted on `agents.agent_config`: only the
 * two WP-55 diagnosis artifacts (coalesced to `null` when absent).
 */
export function buildV6AiContext(args: BuildV6AiContextArgs): CreateAgentAIContext {
  return {
    intent_contract: args.intentContract ?? null,
    data_schema: args.dataSchema ?? null,
  }
}
