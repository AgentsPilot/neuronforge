// app/v2/agents/new/buildCreationModels.ts
// Pure builder for `agent_config.creation_metadata.models` (Part B provenance).
//
// Records which LLM produced each generation step: the enhanced prompt (Phase 3,
// the creation thread's provider/model) and the agent itself (the V6 IntentContract
// pipeline's resolved provider/model). No column equivalent — this legitimately
// lives in JSONB. See docs/workplans/AGENT_CONFIG_DEDUP_AND_MODEL_PROVENANCE_WORKPLAN.md.

import type { CreationModels, GenerationModelRef } from '@/components/agent-creation/types/generate-agent-v2'

/** Normalize a maybe-partial {provider, model} into a ref, or null when neither
 *  is known (so an absent step reads as `null`, not `{provider:null,model:null}`). */
function toRef(src: { provider?: string | null; model?: string | null } | null | undefined): GenerationModelRef | null {
  if (!src) return null
  const provider = src.provider ?? null
  const model = src.model ?? null
  if (!provider && !model) return null
  return { provider, model }
}

export function buildCreationModels(args: {
  enhancedPrompt?: { provider?: string | null; model?: string | null } | null
  agentGeneration?: { provider?: string | null; model?: string | null } | null
}): CreationModels {
  return {
    enhanced_prompt: toRef(args.enhancedPrompt),
    agent_generation: toRef(args.agentGeneration),
  }
}
