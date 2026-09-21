/**
 * Business OS LLM Layer 2 — one retry on a model the provider will not serve
 * (FR-11, DEC-9 as amended by RC-7).
 *
 * A priced model can still be unavailable to our API key. Without this, a
 * configuration change would become a Business OS outage. With it, the call
 * runs once more on the code default and the owner sees nothing.
 *
 * Three rules keep it honest:
 *
 *  - **Placement.** The caller wraps ONLY its provider call, inside its
 *    existing `runAiAction` scope. That gives one audit entry with
 *    `callCount: 2`, `failedCallCount: 1`, both models and outcome
 *    `succeeded`, and the failed attempt writes a 0-token ledger row — so
 *    nothing is counted twice (SA V-8). A retry wrapped around the service or
 *    the route would write two audit entries.
 *  - **Trigger.** Only when the resolved model differs from the code default,
 *    and only on a classified model-not-found / not-permitted error. A
 *    timeout, a rate limit or a 500 is rethrown untouched: retrying those
 *    would double the cost and hide a real failure.
 *  - **Memory.** The rejected `provider:model` is negatively cached for the
 *    settings window, so later calls go straight to the default instead of
 *    paying a failed round trip every time.
 *
 * Server-only. Never import this from a `'use client'` module.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §3.5
 * @module lib/business-os/llm/modelFallback
 */

import { createLogger } from '@/lib/logger';
import { BOS_LLM_SETTINGS_CACHE_MS, type ResolvedBosLlmSettings } from './modelSettings';

const logger = createLogger({ module: 'BosLlmModelFallback' });

/** `provider:model` → when the negative entry expires. */
const rejectedModels = new Map<string, number>();

function rejectionKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function isRejected(provider: string, model: string): boolean {
  const key = rejectionKey(provider, model);
  const expiresAt = rejectedModels.get(key);
  if (expiresAt === undefined) return false;
  if (Date.now() >= expiresAt) {
    rejectedModels.delete(key);
    return false;
  }
  return true;
}

function remember(provider: string, model: string): void {
  rejectedModels.set(rejectionKey(provider, model), Date.now() + BOS_LLM_SETTINGS_CACHE_MS);
}

/** The error fields OpenAI sets on a model-not-found / not-permitted refusal. */
interface ProviderErrorShape {
  status?: unknown;
  code?: unknown;
  param?: unknown;
}

/**
 * Is this the provider saying "I do not have that model for you"?
 *
 * Read from `status`, `code` and `param` only — NEVER the message text, which
 * changes without notice and would make the classifier silently wider or
 * narrower over time (Q-8, approved as listed).
 */
export function isModelUnavailableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, code, param } = error as ProviderErrorShape;
  const codeText = typeof code === 'string' ? code : null;

  if (status === 404 && codeText === 'model_not_found') return true;
  if (status === 403 && codeText !== null && ['model_not_found', 'unsupported_model'].includes(codeText)) return true;
  if (status === 404 && param === 'model') return true;
  return false;
}

export interface ModelFallbackResult<T> {
  result: T;
  /** The model that actually ran — what FR-13 records. */
  modelUsed: string;
}

/**
 * Run `attempt` on the resolved model, falling back to the code default once
 * if the provider rejects the model itself.
 *
 * `attempt` receives the model to use, so anything derived from the model
 * (an image price resolver, a request body) must be built INSIDE it, or
 * reassigned from `modelUsed` afterwards — otherwise a retried call would be
 * priced or reported as the model that failed (RC-W4, RC-W6).
 */
export async function withModelFallback<T>(
  settings: ResolvedBosLlmSettings,
  attempt: (model: string) => Promise<T>
): Promise<ModelFallbackResult<T>> {
  const { provider, model, defaultModel, area, callName } = settings;

  if (model !== defaultModel && isRejected(provider, model)) {
    logger.debug({ area, callName, rejectedModel: model, defaultModel }, 'Model is negatively cached; using the code default');
    return { result: await attempt(defaultModel), modelUsed: defaultModel };
  }

  try {
    return { result: await attempt(model), modelUsed: model };
  } catch (error) {
    if (model === defaultModel || !isModelUnavailableError(error)) throw error;

    remember(provider, model);
    logger.error(
      {
        area,
        callName,
        rejectedModel: model,
        defaultModel,
        errCode: (error as ProviderErrorShape).code,
        errStatus: (error as ProviderErrorShape).status,
      },
      'Provider rejected the configured model; retrying once with the code default'
    );
    return { result: await attempt(defaultModel), modelUsed: defaultModel };
  }
}

/** Drop the negative cache. Tests only. */
export function __resetModelFallbackForTests(): void {
  rejectedModels.clear();
}
