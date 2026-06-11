/**
 * Effort Estimator — orchestrator.
 *
 * Flow:
 *   1. Resolve persona from `userContext`.
 *   2. Resolve model from `system_settings_config.effort_estimator_model`
 *      (falls back to `gpt-4o-mini` on OpenAI — AC-7).
 *   3. Fetch the agent via `AgentRepository.findById` to (a) confirm
 *      ownership and (b) materialise the enhanced prompt when the caller
 *      did not provide one.
 *   4. Build the LLM prompt.
 *   5. Call the provider via `ProviderFactory.getProvider` wrapped in
 *      `retryWithBackoff` (3 attempts, 1s/4s/16s, 30s total budget).
 *   6. Strip markdown fences, parse JSON, validate with `LLMResponseSchema`.
 *   7. Stamp `generated_at`, `model`, `version` and validate the persisted
 *      shape with `ROIEstimateV1Schema`.
 *   8. Read-modify-write the JSONB merge into `agent_config.roi_estimate`
 *      via `AgentRepository.update`.
 *   9. Log the override at INFO with `correlationId` + truncated reasoning.
 *  10. Fire the `EFFORT_ESTIMATE_GENERATED` audit log (non-blocking).
 *
 * On retry exhaustion / fetch failure / write failure: the slot is left
 * UNTOUCHED (AC-2) — no sentinel, no null write. The slot's absence and the
 * error log carry the failure signal.
 *
 * `skipPersist` option (script-only): when true, steps 7-10 are skipped —
 * NO `AgentRepository.update` call, NO `EFFORT_ESTIMATE_GENERATED` audit
 * event. The LLM call still happens, the candidate estimate is still
 * returned, and the override-log preview is still emitted (it's useful for
 * the dry-run user reading the per-run log file). Production callers
 * (V6 save hook, the API route, the fire-and-forget dispatcher) MUST NOT
 * pass this option — it exists solely so the integration-test runner
 * (`tests/effort-estimator/scripts/run-on-agent.ts --dry-run`) can show
 * the user what the estimator WOULD have produced without mutating the row
 * or burning an audit-trail entry.
 */
import { createLogger } from '@/lib/logger';
import { AgentRepository } from '@/lib/repositories/AgentRepository';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { resolvePersona, verifyReasoningMentionsPersona } from './personaResolver';
import { resolveEffortEstimatorModel } from './modelResolver';
import { buildEffortPrompt } from './buildEffortPrompt';
import { retryWithBackoff } from './retryWithBackoff';
import {
  LLMResponseSchema,
  ROIEstimateV1Schema,
  ROI_ESTIMATE_SCHEMA_VERSION,
  type EffortEstimatorInput,
  type EffortEstimatorResult,
  type ROIEstimate,
} from './types';

const logger = createLogger({ module: 'effort-estimator', service: 'EffortEstimator' });

/** Truncate a string for log lines so multi-thousand-char reasoning doesn't blow up log volume (SA observation #5). */
function truncate(value: string, max = 500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}… [truncated ${value.length - max} chars]`;
}

/**
 * Strip markdown fences that some providers (notably Anthropic, which has no
 * native JSON-mode) prepend around JSON output. We deliberately keep this
 * surgical — beyond fence-stripping we let Zod surface anything weirder so
 * the retry budget kicks in.
 */
function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

/**
 * Pull the assistant message content out of the provider's chat-completion
 * response. Both `OpenAIProvider.chatCompletion` and
 * `AnthropicProvider.chatCompletion` (which converts Claude → OpenAI format)
 * return an OpenAI-shaped completion, so this single accessor works for both.
 */
function extractAssistantContent(completion: unknown): string {
  if (!completion || typeof completion !== 'object') return '';
  const choices = (completion as { choices?: Array<{ message?: { content?: string } }> }).choices;
  if (!choices || choices.length === 0) return '';
  return choices[0]?.message?.content ?? '';
}

export class EffortEstimator {
  private readonly repository: AgentRepository;

  constructor(repository?: AgentRepository) {
    this.repository = repository ?? new AgentRepository();
  }

  /**
   * Generate a fresh effort estimate and write it to `agent_config.roi_estimate`.
   *
   * Always overwrites an existing value when invoked (per requirement §
   * Override Behavior). The override is logged at INFO and the new value is
   * mirrored in the `EFFORT_ESTIMATE_GENERATED` audit trail.
   *
   * @param options.skipPersist When true, the LLM call still happens and the
   *   candidate estimate is still returned, but `AgentRepository.update` and
   *   the `EFFORT_ESTIMATE_GENERATED` audit fire are both skipped. Reserved
   *   for the integration-test runner — do NOT pass this from production
   *   call sites.
   */
  async estimate(
    input: EffortEstimatorInput,
    options?: { skipPersist?: boolean }
  ): Promise<EffortEstimatorResult> {
    const callStart = Date.now();
    const requestLogger = logger.child({
      correlationId: input.correlationId,
      agentId: input.agentId,
      userId: input.userId,
      reason: input.reason,
    });

    requestLogger.debug('Effort estimator invoked');

    // 1. Persona
    const persona = resolvePersona(input.userContext);

    // 2. Model
    const { provider, model } = await resolveEffortEstimatorModel();

    // 3. Fetch the agent — gives us ownership confirmation AND the prompt
    //    fallback (SA observation #4 / Phase-1 #4: no empty-string sentinel).
    const { data: agent, error: fetchError } = await this.repository.findById(input.agentId, input.userId);
    if (fetchError || !agent) {
      requestLogger.error({ err: fetchError }, 'EffortEstimator: agent fetch failed — slot left untouched');
      return {
        success: false,
        errorMessage: fetchError?.message ?? 'agent not found',
        attempts: 0,
        totalDurationMs: Date.now() - callStart,
      };
    }

    const enhancedPrompt =
      (input.enhancedPrompt && input.enhancedPrompt.trim().length > 0
        ? input.enhancedPrompt
        : (agent.enhanced_prompt as string | null | undefined)) ?? agent.user_prompt ?? '';

    const currentConfig = (agent.agent_config as Record<string, unknown> | null | undefined) ?? {};
    const previousEstimate = (currentConfig.roi_estimate as ROIEstimate | undefined) ?? null;

    // 4. Build prompt
    const { system, user } = buildEffortPrompt({
      persona,
      userContext: input.userContext,
      enhancedPrompt,
    });

    // 5. Call LLM with retry
    const aiProvider = ProviderFactory.getProvider(provider);

    const retry = await retryWithBackoff(
      async () => {
        const completion = await aiProvider.chatCompletion(
          {
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature: 0.2,
            // OpenAI supports response_format; Anthropic ignores it — both
            // providers return the OpenAI-shaped completion, so callers don't
            // need to branch here.
            ...(aiProvider.supportsResponseFormat ? { response_format: { type: 'json_object' } } : {}),
          },
          {
            userId: input.userId,
            feature: 'effort_estimator',
            component: 'EffortEstimator',
            activity_type: 'effort_estimation',
            activity_name: 'estimate_workflow_savings',
            agent_id: input.agentId,
          }
        );

        const raw = extractAssistantContent(completion);
        if (!raw) throw new Error('Empty LLM response');

        const cleaned = stripMarkdownFences(raw);
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch (jsonErr) {
          requestLogger.debug(
            { rawResponse: truncate(cleaned, 500), err: jsonErr },
            'Effort estimator JSON parse failed — will retry'
          );
          throw jsonErr;
        }

        const validation = LLMResponseSchema.safeParse(parsed);
        if (!validation.success) {
          requestLogger.debug(
            { issues: validation.error.issues, rawResponse: truncate(cleaned, 500) },
            'Effort estimator Zod validation failed — will retry'
          );
          throw new Error(`LLM response did not match schema: ${validation.error.issues[0]?.message ?? 'unknown'}`);
        }

        return validation.data;
      },
      {
        onAttempt: (attempt, lastError) => {
          requestLogger.debug({ attempt: attempt + 1, lastError: lastError ? String(lastError) : null }, 'Effort estimator attempt');
        },
      }
    );

    if (!retry.ok || !retry.value) {
      // AC-2: leave the slot untouched. No sentinel write, no audit call.
      requestLogger.error(
        {
          err: retry.error,
          attempts: retry.attempts,
          totalDurationMs: retry.totalDurationMs,
        },
        'Effort estimator exhausted retries — slot left untouched'
      );
      return {
        success: false,
        previousEstimate,
        errorMessage: retry.error instanceof Error ? retry.error.message : String(retry.error ?? 'unknown'),
        attempts: retry.attempts,
        totalDurationMs: Date.now() - callStart,
      };
    }

    // 6. Assemble + validate the persisted shape.
    const llm = retry.value;
    const candidate: ROIEstimate = {
      reasoning: llm.reasoning,
      is_bulk_workflow: llm.is_bulk_workflow,
      total_manual_time_seconds: llm.total_manual_time_seconds,
      ...(llm.confidence !== undefined ? { confidence: llm.confidence } : {}),
      generated_at: new Date().toISOString(),
      model,
      version: ROI_ESTIMATE_SCHEMA_VERSION,
    };

    const persistedValidation = ROIEstimateV1Schema.safeParse(candidate);
    if (!persistedValidation.success) {
      // Defensive — should be impossible given the LLM validator passed.
      requestLogger.error(
        { issues: persistedValidation.error.issues },
        'Effort estimator failed to assemble persisted shape — slot left untouched'
      );
      return {
        success: false,
        previousEstimate,
        errorMessage: 'Internal: persisted shape failed validation',
        attempts: retry.attempts,
        totalDurationMs: Date.now() - callStart,
      };
    }

    const newEstimate = persistedValidation.data;

    // AC-3 drift detector — log at WARN if the LLM forgot to reference the persona.
    if (!verifyReasoningMentionsPersona(newEstimate.reasoning, input.userContext)) {
      requestLogger.warn(
        { persona, reasoning: truncate(newEstimate.reasoning, 500) },
        'Effort estimator: reasoning does not mention persona role/domain — possible prompt drift'
      );
    }

    // 7a. Skip-persist branch (integration-test runner --dry-run).
    //
    // The LLM call has already happened — the operator wants to SEE the
    // candidate estimate. We emit the override-log preview at INFO (same
    // shape as the production write log below) so the per-run JSON-Lines log
    // file shows exactly what production would have recorded, then return
    // success WITHOUT calling `repository.update` and WITHOUT firing the
    // `EFFORT_ESTIMATE_GENERATED` audit event. The `agent_config.roi_estimate`
    // slot is left untouched, byte-identical to the pre-call state.
    if (options?.skipPersist) {
      requestLogger.info(
        {
          agent_id: input.agentId,
          reason: input.reason,
          previous_present: previousEstimate !== null,
          previous_total_manual_time_seconds: previousEstimate?.total_manual_time_seconds ?? null,
          previous_is_bulk_workflow: previousEstimate?.is_bulk_workflow ?? null,
          new_total_manual_time_seconds: newEstimate.total_manual_time_seconds,
          new_is_bulk_workflow: newEstimate.is_bulk_workflow,
          new_reasoning: truncate(newEstimate.reasoning, 500),
          model: newEstimate.model,
          persona,
          attempts: retry.attempts,
          duration_ms: retry.totalDurationMs,
          skipPersist: true,
        },
        'Effort estimator: skipPersist=true — LLM call succeeded; DB write + audit skipped'
      );

      return {
        success: true,
        estimate: newEstimate,
        previousEstimate,
        attempts: retry.attempts,
        totalDurationMs: Date.now() - callStart,
      };
    }

    // 7. Read-modify-write merge into agent_config.
    //
    // KNOWN v1 LIMITATION: this read-modify-write is NOT atomic against a
    // concurrent updater. See Open Follow-Up #8 in
    // docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md (AgentRepository.
    // mergeAgentConfig RPC for atomic JSONB merge). The create-then-quick-edit
    // race (estimator dispatch #1 in flight when dispatch #2 from PUT regen
    // reads the same `agent_config` snapshot and writes its own) is accepted
    // for v1 — the INFO override log below makes stale writes observable.
    const newConfig = { ...currentConfig, roi_estimate: newEstimate };
    const { error: writeError } = await this.repository.update(input.agentId, input.userId, {
      agent_config: newConfig,
    });

    if (writeError) {
      requestLogger.error({ err: writeError }, 'Effort estimator: AgentRepository.update failed — slot left untouched');
      return {
        success: false,
        previousEstimate,
        errorMessage: writeError.message,
        attempts: retry.attempts,
        totalDurationMs: Date.now() - callStart,
      };
    }

    // 8. Override log — truncate reasoning (SA observation #5).
    requestLogger.info(
      {
        agent_id: input.agentId,
        reason: input.reason,
        previous_present: previousEstimate !== null,
        previous_total_manual_time_seconds: previousEstimate?.total_manual_time_seconds ?? null,
        previous_is_bulk_workflow: previousEstimate?.is_bulk_workflow ?? null,
        new_total_manual_time_seconds: newEstimate.total_manual_time_seconds,
        new_is_bulk_workflow: newEstimate.is_bulk_workflow,
        new_reasoning: truncate(newEstimate.reasoning, 500),
        model: newEstimate.model,
        persona,
        attempts: retry.attempts,
        duration_ms: retry.totalDurationMs,
      },
      'Effort estimator wrote agent_config.roi_estimate'
    );

    // 9. Audit — non-blocking. Full reasoning preserved here (audit table is
    // not log-aggregated and has its own retention policy).
    auditLog({
      action: AUDIT_EVENTS.EFFORT_ESTIMATE_GENERATED,
      entityType: 'agent',
      entityId: input.agentId,
      userId: input.userId,
      resourceName: agent.agent_name ?? null,
      changes: {
        before: { roi_estimate: previousEstimate },
        after: { roi_estimate: newEstimate },
      },
      details: {
        reason: input.reason,
        model: newEstimate.model,
        persona,
        is_bulk_workflow: newEstimate.is_bulk_workflow,
        total_manual_time_seconds: newEstimate.total_manual_time_seconds,
        attempts: retry.attempts,
        duration_ms: retry.totalDurationMs,
        correlationId: input.correlationId,
      },
      severity: 'info',
    }).catch((err) =>
      requestLogger.error({ err }, 'EFFORT_ESTIMATE_GENERATED audit failed (non-blocking)')
    );

    return {
      success: true,
      estimate: newEstimate,
      previousEstimate,
      attempts: retry.attempts,
      totalDurationMs: Date.now() - callStart,
    };
  }
}

/**
 * Convenience function — most callers want a singleton-style call rather
 * than juggling the class.
 *
 * `options.skipPersist` is forwarded to `estimate(...)`. See the class
 * method's JSDoc for the contract. Production callers MUST omit it.
 */
export async function estimateEffort(
  input: EffortEstimatorInput,
  options?: { skipPersist?: boolean }
): Promise<EffortEstimatorResult> {
  return new EffortEstimator().estimate(input, options);
}
