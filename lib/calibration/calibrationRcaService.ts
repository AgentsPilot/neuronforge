// lib/calibration/calibrationRcaService.ts
// Automated calibration-failure RCA service (FR-11–FR-16).
//
// Given a failed calibration, this reads the SAME persisted evidence the manual
// RCA reads — the calibration outcome (history + session + execution) AND the
// failed agent's workflow definition — via repositories ONLY, applies the
// `calibration-rca` 6-step method through a single provider-factory LLM call
// with a DB-config-resolved model + budget-aware timeout, and returns a
// Zod-validated structured RCA.
//
// Contract: this service NEVER throws. Every path returns a typed discriminated
// result; the caller only ever sees a value and falls back to the deterministic
// alert on any `ok: false`.

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { AgentRepository } from '@/lib/repositories/AgentRepository';
import { getAgentAiContextView } from '@/lib/agents/agentAiContextView';
import { CalibrationSessionRepository } from '@/lib/repositories/CalibrationSessionRepository';
import { ExecutionRepository } from '@/lib/repositories/ExecutionRepository';
import type { CalibrationHistoryRecord } from '@/lib/repositories/CalibrationHistoryRepository';
import { ProviderFactory, type ProviderName } from '@/lib/ai/providerFactory';
import { getCalibrationRcaConfig } from './calibrationRcaConfig';
import { buildRcaPrompt, redactInputValues, type RcaEvidence } from './calibrationRcaPrompt';
import { CalibrationAutoRcaSchema, type CalibrationAutoRca } from './calibrationRca-schema';

const logger = createLogger({ module: 'CalibrationRcaService', service: 'v6-calibration' });

export interface GenerateCalibrationRcaParams {
  agentId: string;
  userId: string;
  sessionId?: string | null;
  executionId?: string | null;
  /** The failed calibration_history row (already loaded by the route — avoids a re-read). */
  latest: CalibrationHistoryRecord;
  /** The input values the run executed with (redacted before entering the prompt). */
  inputValues: Record<string, unknown> | null;
  /** Correlation id for tail log tracing. */
  correlationId: string;
  /** Client to build repositories from (evidence reads are owner-scoped). */
  supabase: SupabaseClient;
  /**
   * Budget-aware cap on the RCA LLM call (C2). The effective deadline is
   * min(config.timeoutMs, maxBudgetMs). The route computes this from the
   * request's remaining wall-clock budget minus send/persist headroom.
   */
  maxBudgetMs?: number;
}

export type CalibrationRcaResult =
  | {
      ok: true;
      rca: CalibrationAutoRca;
      modelUsed: string;
      providerUsed: string;
      generatedAt: string;
    }
  | { ok: false; reason: 'disabled' | 'timeout' | 'llm_error' | 'invalid_output' | 'evidence_error' };

class TimeoutError extends Error {}

/** Strip a markdown code fence (```json … ```) if present, mirroring the provider. */
function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  return trimmed;
}

/**
 * Generate a structured RCA for a failed calibration run. Never throws.
 */
export async function generateCalibrationRca(
  params: GenerateCalibrationRcaParams
): Promise<CalibrationRcaResult> {
  const { agentId, userId, sessionId, executionId, latest, correlationId, supabase, maxBudgetMs } = params;
  const runLogger = logger.child({ correlationId, agentId });

  try {
    // ---- 1. Workflow-definition evidence (REQUIRED — dump-agent parity). ----
    const agentRepo = new AgentRepository(supabase);
    const { data: agent, error: agentErr } = await agentRepo.findById(agentId, userId);
    if (agentErr || !agent) {
      runLogger.warn({ err: agentErr }, 'RCA evidence_error: workflow definition unreadable');
      return { ok: false, reason: 'evidence_error' };
    }

    // ---- 2. Calibration-outcome sub-reads (best-effort; degrade, never fail). ----
    let sessionIssues: unknown[] | null = null;
    let sessionExecutionSummary: unknown | null = null;
    if (sessionId) {
      try {
        const sessionRepo = new CalibrationSessionRepository(supabase);
        const { data: session } = await sessionRepo.findById(sessionId);
        // findById is not owner-scoped — verify ownership, drop on mismatch.
        if (session && session.user_id === userId) {
          sessionIssues = (session.issues as unknown[]) ?? null;
          sessionExecutionSummary = (session as { execution_summary?: unknown }).execution_summary ?? null;
        }
      } catch (err) {
        runLogger.debug({ err }, 'RCA: session evidence read failed (non-fatal)');
      }
    }

    let executionErrorMessage: string | null = null;
    if (executionId) {
      try {
        const execRepo = new ExecutionRepository(supabase);
        const { data: execution } = await execRepo.findById(executionId);
        // Not owner-scoped — verify ownership when the column is present.
        if (execution && (!execution.user_id || execution.user_id === userId)) {
          executionErrorMessage = execution.error_message ?? null;
        }
      } catch (err) {
        runLogger.debug({ err }, 'RCA: execution evidence read failed (non-fatal)');
      }
    }

    // ---- 3. Assemble evidence (input values redacted for the prompt — FR-24). ----
    // Read via the canonical accessor: column-first with a JSONB fallback, so RCA
    // evidence is identical for legacy "fat" rows and future "lean" rows (where the
    // reasoning/confidence/prompt fields live in columns, not ai_context).
    // See lib/agents/agentAiContextView.ts + the de-dup workplan.
    const aiContext = getAgentAiContextView(agent);

    const evidence: RcaEvidence = {
      agentId,
      agentName: agent.agent_name,
      status: latest.status ?? 'failed',
      iterations: latest.iterations ?? 0,
      autoFixesApplied: latest.auto_fixes_applied ?? 0,
      stepsCompleted: latest.steps_completed ?? 0,
      stepsFailed: latest.steps_failed ?? 0,
      stepsSkipped: latest.steps_skipped ?? 0,
      issuesRemaining: (latest.issues_remaining as unknown[]) ?? [],
      issuesFixed: (latest.issues_fixed as unknown[]) ?? [],
      sessionIssues,
      sessionExecutionSummary,
      executionErrorMessage,
      pilotSteps: (agent.pilot_steps as unknown[]) ?? [],
      inputSchema: (agent.input_schema as unknown[]) ?? [],
      // A2: the `enhanced_prompt` COLUMN is never populated at creation; source
      // the flat enhanced prompt from the canonical accessor (rendered from
      // user_prompt when not stored) so RCA evidence is no longer always-null.
      enhancedPrompt: aiContext.enhanced_prompt || agent.enhanced_prompt || null,
      userPrompt: agent.user_prompt ?? null,
      aiContext,
      inputValues: redactInputValues(params.inputValues),
    };

    const messages = buildRcaPrompt(evidence);

    // ---- 4. Resolve config + budget-aware timeout (C2). ----
    const cfg = await getCalibrationRcaConfig();
    const effectiveTimeout = Math.min(cfg.timeoutMs, maxBudgetMs ?? cfg.timeoutMs);

    // ---- 5. Single provider-factory LLM call, raced against the deadline. ----
    // The timer both LOSES the race (returning `timeout`) AND actively aborts
    // the in-flight request via an AbortController, so a stuck LLM call is truly
    // cancelled — the connection is freed and token spend stops — instead of
    // just being abandoned (Item 4 / Q4). The provider forwards this signal to
    // the underlying SDK's fetch; existing callers that pass no signal are
    // unaffected (the field is optional).
    const provider = ProviderFactory.getProvider(cfg.provider as ProviderName);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Hard-abort the in-flight request (frees the connection / stops token
        // spend), then lose the race so we fall back to the deterministic alert.
        controller.abort();
        reject(new TimeoutError('RCA generation timed out'));
      }, effectiveTimeout);
    });

    let completion: { choices?: Array<{ message?: { content?: string | null } }> };
    try {
      const llmCall = provider.chatCompletion(
        {
          model: cfg.model,
          temperature: cfg.temperature,
          max_tokens: cfg.maxTokens,
          messages,
          signal: controller.signal,
        },
        { userId: 'system', feature: 'calibration-rca', component: 'CalibrationRcaService' }
      );
      // If the timeout wins the race, the aborted call rejects with an
      // AbortError AFTER settling — swallow it so it never surfaces as an
      // unhandled rejection (the race result already drives the outcome).
      void Promise.resolve(llmCall).catch(() => {});

      completion = (await Promise.race([llmCall, timeout])) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
    } catch (err) {
      if (err instanceof TimeoutError) {
        runLogger.warn({ effectiveTimeout }, 'RCA generation timed out (request aborted) — falling back to deterministic alert');
        return { ok: false, reason: 'timeout' };
      }
      runLogger.error({ err }, 'RCA LLM call failed — falling back to deterministic alert');
      return { ok: false, reason: 'llm_error' };
    } finally {
      if (timer) clearTimeout(timer);
    }

    // ---- 6. Validate at the boundary (JSON.parse + Zod). ----
    const rawContent = completion.choices?.[0]?.message?.content;
    if (!rawContent) {
      runLogger.warn('RCA LLM returned empty content');
      return { ok: false, reason: 'invalid_output' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(rawContent));
    } catch (err) {
      runLogger.warn({ err }, 'RCA output was not valid JSON');
      return { ok: false, reason: 'invalid_output' };
    }

    const validation = CalibrationAutoRcaSchema.safeParse(parsed);
    if (!validation.success) {
      runLogger.warn({ issues: validation.error.issues }, 'RCA output failed Zod validation');
      return { ok: false, reason: 'invalid_output' };
    }

    runLogger.info({ layer: validation.data.rootCauseLayer, model: cfg.model }, 'RCA generated successfully');
    return {
      ok: true,
      rca: validation.data,
      modelUsed: cfg.model,
      providerUsed: cfg.provider,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    // Absolute backstop — the never-throw contract must hold even for
    // unexpected errors (e.g. provider construction / missing API key).
    runLogger.error({ err }, 'RCA generation failed unexpectedly — falling back to deterministic alert');
    return { ok: false, reason: 'llm_error' };
  }
}

/**
 * Durable status of an RCA ATTEMPT recorded on the calibration_history row
 * (Item 3 / Q3). Persisted for EVERY attempt made under the flag — success and
 * every failure/skip reason alike — so a stuck/timed-out/skipped RCA leaves a
 * queryable marker on the agent's row, not just a log line.
 */
export type CalibrationRcaAttemptStatus =
  | 'success'
  | 'timeout'
  | 'llm_error'
  | 'invalid_output'
  | 'evidence_error'
  | 'skipped_budget';

/** The outcome of an RCA attempt, as seen by the route tail. */
export type RcaAttemptOutcome =
  | { kind: 'skipped_budget' }
  | { kind: 'result'; result: CalibrationRcaResult };

/**
 * Build the `calibration_history.metadata` patch that records an RCA ATTEMPT
 * (Item 3 / Q3). Returns:
 *   - `null` when the flag is OFF — the caller MUST write NOTHING from this
 *     feature (AC-9 / FR-19): no `auto_rca_status`, no metadata write at all.
 *     (The flag-independent `correlation_id` write is handled separately.)
 *   - otherwise a patch carrying `auto_rca_status` + `auto_rca_attempted_at`,
 *     plus the full RCA payload (`auto_rca`, generated-at, model, provider) on
 *     success (FR-17). Composes with C1's no-clobber `mergeMetadata`.
 *
 * Pure + flag-aware so the "written on success/timeout/skip, NOT when flag off"
 * behaviour is unit-testable without invoking the route tail.
 */
export function buildRcaAttemptMetadata(
  flagEnabled: boolean,
  outcome: RcaAttemptOutcome,
  attemptedAt: string = new Date().toISOString()
): Record<string, unknown> | null {
  // AC-9 / FR-19: flag off → this feature writes nothing.
  if (!flagEnabled) return null;

  if (outcome.kind === 'skipped_budget') {
    return { auto_rca_status: 'skipped_budget', auto_rca_attempted_at: attemptedAt };
  }

  const result = outcome.result;
  if (result.ok) {
    return {
      auto_rca_status: 'success',
      auto_rca_attempted_at: attemptedAt,
      auto_rca: result.rca,
      auto_rca_generated_at: result.generatedAt,
      auto_rca_model: result.modelUsed,
      auto_rca_provider: result.providerUsed,
    };
  }

  // Every non-success reason ('timeout' | 'llm_error' | 'invalid_output' |
  // 'evidence_error') is recorded verbatim as the attempt status.
  return { auto_rca_status: result.reason, auto_rca_attempted_at: attemptedAt };
}
