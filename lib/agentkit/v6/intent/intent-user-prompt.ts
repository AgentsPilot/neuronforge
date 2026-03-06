// lib/agentkit/v6/intent/intent-user-prompt.ts
// User prompt for Intent Contract Generator (Phase 1)

export type EnhancedPrompt = {
  plan_title: string;
  plan_description: string;
  sections: {
    data: string[];
    actions: string[];
    output: string[];
    delivery: string[];
    processing_steps: string[];
  };
  specifics: {
    services_involved: string[];
    user_inputs_required: string[];
    resolved_user_inputs: Array<{
      key: string;
      value: string;
    }>;
  };
};

export function buildIntentUserPrompt(args: { enhancedPrompt: EnhancedPrompt }): string {
  const { enhancedPrompt } = args;

  return `
──────────────────────────────────────────────────────────────────────────────
ENHANCED_PROMPT
──────────────────────────────────────────────────────────────────────────────

PLAN TITLE:
${enhancedPrompt.plan_title}

PLAN DESCRIPTION:
${enhancedPrompt.plan_description}

DATA SOURCES & INPUTS:
${enhancedPrompt.sections.data.map((item) => `  ${item}`).join('\n')}

ACTIONS & LOGIC:
${enhancedPrompt.sections.actions.map((item) => `  ${item}`).join('\n')}

OUTPUT REQUIREMENTS:
${enhancedPrompt.sections.output.map((item) => `  ${item}`).join('\n')}

DELIVERY:
${enhancedPrompt.sections.delivery.map((item) => `  ${item}`).join('\n')}

PROCESSING STEPS (suggested sequence):
${enhancedPrompt.sections.processing_steps.map((item) => `  ${item}`).join('\n')}

SERVICES INVOLVED:
${enhancedPrompt.specifics.services_involved.map((s) => `  - ${s}`).join('\n')}

USER INPUTS (required, not yet resolved):
${
    enhancedPrompt.specifics.user_inputs_required.length > 0
      ? enhancedPrompt.specifics.user_inputs_required.map((q) => `  - ${q}`).join('\n')
      : '  (none)'
  }

USER INPUTS (resolved):
${enhancedPrompt.specifics.resolved_user_inputs.map((ui) => `  - ${ui.key}: ${ui.value}`).join('\n')}

──────────────────────────────────────────────────────────────────────────────
YOUR TASK
──────────────────────────────────────────────────────────────────────────────

Using ONLY the CORE_VOCABULARY and PLUGIN_VOCABULARY provided above in the system prompt:
1) Generate the IntentContractV1 JSON that faithfully captures the workflow described in the ENHANCED_PROMPT.
2) Follow all handshake rules: every step must declare inputs and outputs explicitly.
3) Use only semantic_op values from PLUGIN_VOCABULARY for fetch/deliver steps.
4) Use ref grammar for all data flow: { "ref": "$.steps.<id>.outputs.<key>" } or { "ref": "$.loop.<id>.item.<field>" }
5) If any required user inputs are not resolved, emit questions[] in the output.
6) Return ONLY the JSON, no markdown, no comments.
`.trim();
}
