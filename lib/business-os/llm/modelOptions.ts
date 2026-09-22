import 'server-only';

/**
 * The model picker's options (admin screen FR-8).
 *
 * ── The rule this module follows ─────────────────────────────────────────
 * It does not decide which models are acceptable. It ASKS — every candidate
 * goes through `checkModelForCall`, which runs the resolver's OWN
 * `checkProvider` and `checkModel` for that call. So the picker is, by
 * construction, the set `validateAreaRow` accepts, and it cannot drift: a new
 * refusal reason added to the guardrail narrows this list on the next request
 * with no change here.
 *
 * Two mistakes were made getting here, both caught in review, and both worth
 * writing down because they are the tempting shape:
 *
 *  1. Narrowing candidates on the GLOBAL `ALLOWED_PROVIDERS_LAYER2` while the
 *     comment claimed `checkProvider` was the gate — when `checkProvider` was
 *     never called at all. The resolver gates on the call's own
 *     `policy.allowedProviders`; the two coincide today only because every
 *     call is `['openai']`.
 *  2. Asking `checkModelAcceptable`, which skips the four SHAPE rules
 *     (`model_not_a_string`, `model_empty`, `model_not_trimmed`,
 *     `model_too_long`). Candidates come from `ai_model_pricing`, which
 *     operators edit, so a `model_name` carrying a stray space would have been
 *     offered here and then refused on save.
 *
 * Both had the same shape: the picker quietly becoming WIDER than the
 * validator. One function, asked once per (candidate × call), is the only
 * arrangement that cannot drift.
 *
 * ── Why free text still exists beside it ─────────────────────────────────
 * Candidates come from `listPricedModels()`, which reads the pricing cache — a
 * ONE HOUR TTL. A model priced five minutes ago can be absent for up to an
 * hour while `validateAreaRow` would happily accept it. So the list ships with
 * its cache age, is labelled advisory, and the screen keeps a validated
 * free-text escape.
 *
 * ── Per call, not per area ───────────────────────────────────────────────
 * Acceptability is a property of the CALL: a reasoning model is refused for a
 * call that sends a sampling penalty or a locked temperature and accepted for
 * one that does not, an image call answers to an entirely different check, and
 * `allowedProviders` is per call too. One list per area would be wrong for
 * some of its calls.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §3.3
 * @module lib/business-os/llm/modelOptions
 */

import { listPricedModels, type PricedModel } from '@/lib/ai/pricing';
import type { BosLlmArea } from '@/lib/business-os/llm/callCatalog';
import {
  checkModelForCall,
  newModelCheckContext,
  type GuardrailContext,
} from '@/lib/business-os/llm/modelSettings';
import {
  bosLlmSettingsCallNames,
  getBosLlmCallPolicy,
} from '@/lib/business-os/llm/modelSettingsPolicy';

export interface ModelOption {
  provider: string;
  model: string;
}

export interface AreaModelOptions {
  /** Options per call name — acceptability is a per-call property. */
  byCall: Record<string, ModelOption[]>;
  /** Per call, the providers THAT CALL allows, read from its own policy. */
  allowedProvidersByCall: Record<string, readonly string[]>;
  /**
   * How stale the pricing snapshot behind these options is. The list is
   * ADVISORY: a newly priced model is absent for up to `cacheTtlMs`.
   */
  cacheAgeMs: number;
  cacheTtlMs: number;
}

/**
 * The per-request state the option builder shares across all eight areas: one
 * pricing snapshot and one guardrail memoisation context.
 *
 * Without it each area re-entered `listPricedModels()` and built a fresh
 * context, so the image configuration was re-read per area and no price lookup
 * was reused between them.
 */
export interface ModelOptionsContext {
  candidates: PricedModel[];
  cacheAgeMs: number;
  cacheTtlMs: number;
  guardrails: GuardrailContext;
}

export async function newModelOptionsContext(): Promise<ModelOptionsContext> {
  const { models, cacheAgeMs, cacheTtlMs } = await listPricedModels();
  return { candidates: models, cacheAgeMs, cacheTtlMs, guardrails: newModelCheckContext() };
}

/**
 * Build the option list for one area.
 *
 * Pass a shared `ModelOptionsContext` when building several areas in one
 * request; omit it and one is created for this area alone.
 */
export async function buildAreaModelOptions(
  area: BosLlmArea,
  shared?: ModelOptionsContext
): Promise<AreaModelOptions> {
  const ctx = shared ?? (await newModelOptionsContext());

  const byCall: Record<string, ModelOption[]> = {};
  const allowedProvidersByCall: Record<string, readonly string[]> = {};

  for (const callName of bosLlmSettingsCallNames(area)) {
    const policy = getBosLlmCallPolicy(area, callName);
    /* istanbul ignore next — bosLlmSettingsCallNames only yields policied calls */
    if (!policy) continue;

    allowedProvidersByCall[callName] = policy.allowedProviders;

    const accepted: ModelOption[] = [];
    for (const candidate of ctx.candidates) {
      // No pre-filter on provider: `checkModelForCall` runs the call's own
      // `checkProvider`, so the answer here IS the resolver's answer. A
      // "narrowing" step in front of it is exactly how mistake 1 happened.
      // eslint-disable-next-line no-await-in-loop -- memoised through `ctx.guardrails`
      const check = await checkModelForCall(
        area,
        callName,
        candidate.provider,
        candidate.model,
        ctx.guardrails
      );
      if (check.ok) accepted.push({ provider: candidate.provider, model: candidate.model });
    }

    // The call's own code default is always offered, even when the pricing
    // snapshot has not heard of it: the resolver accepts it unconditionally
    // (it is the value running today), so omitting it would leave an operator
    // who changed a model with no way back to where they started.
    const hasDefault = accepted.some(
      (o) => o.model === policy.default.model && o.provider === policy.default.provider
    );
    if (!hasDefault) {
      accepted.unshift({ provider: policy.default.provider, model: policy.default.model });
    }

    byCall[callName] = accepted;
  }

  return {
    byCall,
    allowedProvidersByCall,
    cacheAgeMs: ctx.cacheAgeMs,
    cacheTtlMs: ctx.cacheTtlMs,
  };
}
