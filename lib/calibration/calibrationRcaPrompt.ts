// lib/calibration/calibrationRcaPrompt.ts
// Prompt builder + input-value guardrails for the automated calibration RCA
// (FR-14, FR-24). Kept separate from the service so the redaction helpers are
// unit-testable in isolation of the LLM call (AC-15).
//
// The prompt encodes the shared `calibration-rca` 6-step method (see
// .claude/skills/calibration-rca/SKILL.md + docs/Calibration/CALIBRATION_RCA_RUNBOOK.md).
// NO plugin-specific rules, operation names, or field names are hardcoded — the
// evidence (issues + workflow definition) and plugin schemas are the source of
// truth (Platform Design Principles).

import { ROOT_CAUSE_LAYERS, REMEDIATION_PATHS } from './calibrationRca-schema';

/** Evidence bundle assembled by the RCA service and fed to the prompt builder. */
export interface RcaEvidence {
  agentId: string;
  agentName: string;
  status: string;
  iterations: number;
  autoFixesApplied: number;
  stepsCompleted: number;
  stepsFailed: number;
  stepsSkipped: number;
  /** Remaining (still-blocking) issues from calibration_history. */
  issuesRemaining: unknown[];
  /** Issues auto-fixed during the run (context for what was already tried). */
  issuesFixed?: unknown[];
  /** Plain-English notes about resolver-applied parameter values. */
  appliedFixNotes?: string[];
  /** Live session issues[] + execution_summary (may be absent if unreadable). */
  sessionIssues?: unknown[] | null;
  sessionExecutionSummary?: unknown | null;
  /** Failing execution row error message, if an executionId was present. */
  executionErrorMessage?: string | null;
  /** Workflow-definition evidence (the dump-agent.ts parity — required). */
  pilotSteps: unknown[];
  inputSchema: unknown[];
  enhancedPrompt: string | null;
  userPrompt: string | null;
  aiContext: unknown | null;
  /** The input values the run executed with — REDACTED before entering here. */
  inputValues: Record<string, unknown> | null;
}

const DEFAULT_MAX_LEN = 2000;

/**
 * Cap oversized strings and large arrays/objects to a bounded length before they
 * enter the LLM prompt (FR-24a). Recurses into objects/arrays so deep payloads
 * are bounded, not just top-level.
 */
export function truncateForPrompt(value: unknown, maxLen: number = DEFAULT_MAX_LEN): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > maxLen ? `${value.slice(0, maxLen)}…[truncated ${value.length - maxLen} chars]` : value;
  }

  if (Array.isArray(value)) {
    const MAX_ITEMS = 50;
    const capped = value.slice(0, MAX_ITEMS).map((v) => truncateForPrompt(v, maxLen));
    if (value.length > MAX_ITEMS) capped.push(`…[truncated ${value.length - MAX_ITEMS} items]`);
    return capped;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateForPrompt(v, maxLen);
    }
    return out;
  }

  return value;
}

const MASKED = '***MASKED***';

// Key names that strongly imply a secret value, regardless of the value shape.
const SECRET_KEY_RE = /(password|passwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth|credential|bearer|private[_-]?key|client[_-]?secret|refresh[_-]?token)/i;

// Value patterns that look like secrets even under an innocuous key.
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-]+/i, // bearer tokens
  /\bsk-[A-Za-z0-9]{16,}/, // OpenAI-style keys
  /\bAKIA[0-9A-Z]{12,}/, // AWS access key id
  /\bAIza[0-9A-Za-z_\-]{20,}/, // Google API key
  /\bghp_[A-Za-z0-9]{20,}/, // GitHub token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack token
  /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/, // JWT
];

/** True when a bare string value looks like a high-entropy secret token. */
function looksLikeHighEntropySecret(value: string): boolean {
  const v = value.trim();
  // Long, no whitespace, and a token-ish charset (base64/hex/url-safe).
  return v.length >= 32 && !/\s/.test(v) && /^[A-Za-z0-9+/=_\-.]+$/.test(v) && /[0-9]/.test(v) && /[A-Za-z]/.test(v);
}

/**
 * Mask values matching common secret patterns before they enter the LLM prompt
 * (FR-24b). Recurses through objects/arrays; a key whose NAME implies a secret
 * masks its whole value, and any string value matching a secret pattern is
 * masked regardless of key.
 */
export function maskSecrets(value: unknown, keyHint?: string): unknown {
  if (typeof value === 'string') {
    if (keyHint && SECRET_KEY_RE.test(keyHint)) return MASKED;
    if (looksLikeHighEntropySecret(value)) return MASKED;
    let masked = value;
    for (const re of SECRET_VALUE_PATTERNS) masked = masked.replace(re, MASKED);
    return masked;
  }

  if (Array.isArray(value)) {
    return value.map((v) => maskSecrets(v, keyHint));
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // If the key implies a secret, mask the entire sub-value.
      out[k] = SECRET_KEY_RE.test(k) ? MASKED : maskSecrets(v, k);
    }
    return out;
  }

  return value;
}

/** Apply both guardrails (mask first, then truncate) to input values (FR-24). */
export function redactInputValues(inputValues: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!inputValues) return inputValues;
  return truncateForPrompt(maskSecrets(inputValues)) as Record<string, unknown>;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return '"[unserializable]"';
  }
}

/**
 * Build the system + user messages for the RCA LLM call. The system prompt
 * encodes the 6-step method and the strict output contract; the user message
 * carries the (already-redacted) evidence bundle.
 */
export function buildRcaPrompt(evidence: RcaEvidence): Array<{ role: 'system' | 'user'; content: string }> {
  const layers = ROOT_CAUSE_LAYERS.map((l) => `"${l}"`).join(', ');
  const paths = REMEDIATION_PATHS.map((p) => `"${p}"`).join(', ');

  const system = `You are a root-cause analysis (RCA) engine for an AI agent automation platform.
A background CALIBRATION run for an agent landed on a non-passing status and you must produce a
defensible, hand-off-ready root cause using ONLY the persisted evidence provided. Do NOT re-run or
reproduce the agent, and do NOT invent evidence.

Apply this 6-step method exactly:
1. Gather evidence — you are given the calibration outcome (history + session issues + execution
   error) AND the failed agent's workflow definition (compiled steps, input schema, enhanced prompt).
2. Read the issues array — separate the aggregate "steps_failed" summary from the specific per-step
   issues. A "…has no input data" error is almost always CASCADE fallout, not an independent bug.
3. Find the EARLIEST failing step and trace the cascade. Only the earliest step is the real failure
   unless two genuinely-independent steps fail with different errors. Cross-reference that step
   against its definition in the compiled workflow steps.
4. Classify the root-cause LAYER — exactly one of: ${layers}.
   - input/data: the value is wrong for THIS user's data/access; the workflow is structurally fine.
   - V6 generation: the workflow definition itself is wrong (bad field reference, dropped constraint,
     wrong action, missing step).
   - runtime/external API: a valid request the external API rejected (403/SERVICE_DISABLED, auth,
     rate limit, 5xx). Workflow + values are correct.
   - calibration-detection: calibration misreported (claimed success on a failed run, dropped/merged
     a real issue, misleading message).
   - creation chat flow: the earliest cause traces to the upstream chat creation flow.
   When a value is wrong BECAUSE generation guessed it, prefer the generation layer.
5. Judge whether calibration itself behaved correctly (a failed run should be flagged, not reported
   as success).
6. Conclude.

Reason strictly from the evidence and general platform/plugin-schema knowledge. Do NOT hardcode
plugin-specific assumptions — reference the workflow definition and issue evidence as the source of truth.

Respond with a SINGLE JSON object and NOTHING else (no markdown fences, no prose). Schema:
{
  "symptom": string,              // what the calibration run reported
  "evidence": string,             // the key evidence you used (outcome + workflow definition)
  "earliestFailingStep": string,  // the earliest failing step + how it cascaded
  "rootCauseLayer": one of ${layers},
  "rootCause": string,            // the defensible "why", referencing the evidence
  "fixOwner": string,             // who owns the fix (e.g. v6-pipeline, calibration, plugin executor, input/data)
  "suggestedSolutions": string[], // one or more concrete solutions (non-empty)
  "remediationPath": one of ${paths}  // "hotfix" for a targeted fix, "full cycle" for a larger change
}`;

  const evidencePayload = {
    agent: { id: evidence.agentId, name: evidence.agentName },
    calibrationOutcome: {
      status: evidence.status,
      iterations: evidence.iterations,
      autoFixesApplied: evidence.autoFixesApplied,
      steps: {
        completed: evidence.stepsCompleted,
        failed: evidence.stepsFailed,
        skipped: evidence.stepsSkipped,
      },
      issuesRemaining: truncateForPrompt(evidence.issuesRemaining),
      issuesFixed: truncateForPrompt(evidence.issuesFixed ?? []),
      appliedFixNotes: evidence.appliedFixNotes ?? [],
      sessionIssues: truncateForPrompt(evidence.sessionIssues ?? null),
      sessionExecutionSummary: truncateForPrompt(evidence.sessionExecutionSummary ?? null),
      executionErrorMessage: evidence.executionErrorMessage ?? null,
    },
    workflowDefinition: {
      pilotSteps: truncateForPrompt(evidence.pilotSteps),
      inputSchema: truncateForPrompt(evidence.inputSchema),
      enhancedPrompt: truncateForPrompt(evidence.enhancedPrompt),
      userPrompt: truncateForPrompt(evidence.userPrompt),
      aiContext: truncateForPrompt(evidence.aiContext),
    },
    // Already redacted by the service via redactInputValues before reaching here;
    // re-applied defensively so a caller that forgets can't leak secrets.
    inputValues: redactInputValues(evidence.inputValues),
  };

  const user = `Here is the persisted evidence for the failed calibration. Produce the RCA JSON.

EVIDENCE:
${safeJson(evidencePayload)}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
