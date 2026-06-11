/**
 * Effort Estimator — prompt builder.
 *
 * Constructs the system + user messages for the LLM call. The prompt is
 * generic: no plugin names, no operation names, no field names hardcoded.
 * Per CLAUDE.md § "No Hardcoding in System Prompts", the only thing the
 * prompt reasons about is "how long would a human spend doing this manually".
 *
 * Persona is injected verbatim into the system prompt; the LLM is told to
 * include it in `reasoning` (AC-3). The post-hoc verifier
 * (`verifyReasoningMentionsPersona`) does a lenient role-OR-domain substring
 * scan so paraphrasing doesn't trigger spurious failures.
 */
import type { UserContext } from '@/lib/user-context';

export interface BuildPromptArgs {
  persona: string;
  userContext: UserContext;
  enhancedPrompt: string;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

/**
 * Trim and strip falsy user-context fields. The estimator is meant to work
 * with sparse data — empty/whitespace fields are omitted from the LLM input
 * rather than passed as empty strings (which would dilute signal).
 */
function nonEmptyUserContextEntries(userContext: UserContext): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(userContext)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    entries.push([key, trimmed]);
  }
  return entries;
}

export function buildEffortPrompt(args: BuildPromptArgs): BuiltPrompt {
  const { persona, userContext, enhancedPrompt } = args;
  const contextEntries = nonEmptyUserContextEntries(userContext);

  // The JSON schema description below is hand-mirrored from `LLMResponseSchema`
  // in `./types.ts`. Keep them in sync — the Zod validator is the source of
  // truth at parse time, the prompt description is what the LLM sees.
  const system = [
    `You are simulating ${persona}. You estimate how much time a human spends doing one full run of a described workflow MANUALLY (without automation).`,
    '',
    'TASK',
    '- Estimate `total_manual_time_seconds` — the manual time, in seconds, that the persona would spend on one full execution of the workflow.',
    '- Decide whether this is a bulk/aggregate workflow (one human session over many items, e.g. "scan 100 issues for criticals") or a per-item workflow (one human session per item, repeated; e.g. "respond to each incoming email"). Set `is_bulk_workflow` accordingly.',
    '- For bulk workflows: report the typical TOTAL time for one full run.',
    '- For per-item workflows: report a realistic per-item time multiplied by a typical run-size assumption. Surface the per-item time and the assumed run-size inside `reasoning`.',
    '',
    'CONSTRAINTS',
    '- Be conservative — prefer an under-estimate to an over-estimate when uncertain.',
    `- Your \`reasoning\` MUST mention the persona (\`${persona}\`) by name OR by their role/domain keywords so the audit trail can verify the persona was used.`,
    '- If user context fields are missing or sparse, say so in `reasoning` rather than inventing details.',
    '',
    'OUTPUT',
    'Respond with a single JSON object and NOTHING ELSE — no markdown, no commentary, no prose outside the JSON. Schema:',
    '{',
    '  "reasoning": string,                 // 1–4 sentences explaining persona, bulk/per-item decision, time figure, and any assumptions',
    '  "is_bulk_workflow": boolean,         // true = one human session per workflow run; false = per-item iteration',
    '  "total_manual_time_seconds": number, // non-negative; typical TOTAL manual time per full run',
    '  "confidence": string | number        // OPTIONAL; if you include it, justify it in `reasoning`',
    '}',
  ].join('\n');

  // User message: surface only the workflow and any non-empty context fields.
  const contextLines = contextEntries.length
    ? contextEntries.map(([k, v]) => `  - ${k}: ${v}`).join('\n')
    : '  (none — assume the generic SMB-owner persona)';

  const trimmedPrompt = enhancedPrompt.trim().length > 0 ? enhancedPrompt.trim() : '(no workflow description provided)';

  const user = [
    'Workflow to estimate:',
    trimmedPrompt,
    '',
    'User context (omit any field you do not need):',
    contextLines,
    '',
    'Return ONLY the JSON object described in the system prompt.',
  ].join('\n');

  return { system, user };
}
