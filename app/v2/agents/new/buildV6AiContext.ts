// app/v2/agents/new/buildV6AiContext.ts
// Pure builder for the V6 agent's `agent_config.ai_context`.
//
// Extracted from the V6 save path in page.tsx so the WP-55 IntentContract /
// data_schema persistence has a single, unit-testable source of truth. Prior to
// this extraction the save path built `ai_context` twice (once in
// mapV6ResponseToAgent, once inline at the save site) and the inline build —
// which omitted intent_contract/data_schema — clobbered the other, silently
// dropping WP-55's artifacts on every V6 agent. See
// docs/investigations/AGENT_RCA_CONCLUSION_gmail-expense-attachment-flatten.md
// (§ "Addendum — Why intent_contract / data_schema are null").

import type { CreateAgentAIContext } from '@/components/agent-creation/types/generate-agent-v2'

export interface BuildV6AiContextArgs {
  reasoning: string
  confidence: number
  originalPrompt: string
  enhancedPrompt: string
  generatedPlan?: string
  /**
   * WP-55: Phase-1 raw IntentContract LLM output (Pipeline A). Persisted so
   * post-hoc diagnosis of this agent's emission is a SQL lookup instead of a
   * non-deterministic re-run. `undefined`/absent (e.g. Pipeline B) coalesces
   * to `null`.
   */
  intentContract?: unknown | null
  /** WP-55: Phase-2 data_schema (slot schemas + semantic types). Same null semantics. */
  dataSchema?: unknown | null
}

/**
 * Assemble the `ai_context` persisted on `agents.agent_config`. Always emits the
 * five required narrative fields plus the two WP-55 diagnosis artifacts
 * (coalesced to `null` when absent).
 */
export function buildV6AiContext(args: BuildV6AiContextArgs): CreateAgentAIContext {
  return {
    reasoning: args.reasoning || '',
    confidence: args.confidence || 0,
    original_prompt: args.originalPrompt || '',
    enhanced_prompt: args.enhancedPrompt || '',
    generated_plan: args.generatedPlan || '',
    intent_contract: args.intentContract ?? null,
    data_schema: args.dataSchema ?? null,
  }
}
