/**
 * ParameterResolverEngine (Calibration Option A — generic, plugin-agnostic).
 *
 * Turns a batch of detected `parameter_error` calibration issues into applied
 * fixes, by asking a registered resolver to look up the correct value from the
 * live data source. Headless-flow policy (SA 2026-07-01):
 *   • resolved            → auto-apply + confident disclosure
 *   • ambiguous           → auto-apply candidates[0] (best-effort) + guess disclosure
 *   • unresolved / none   → leave the issue as-is (report-only)
 * There is NO interactive picker in the primary (background) flow — every
 * decision is disclosed in the summary email instead (see the workplan).
 *
 * This file contains ZERO plugin-specific logic. All app-specifics live in the
 * resolvers under ./parameterResolvers. The actual persistence + in-memory
 * mutation is delegated to an injected `FixApplier` (the route supplies the real
 * one — repository write + mergedInputValues mutation; tests supply a mock), so
 * the engine stays pure and testable.
 *
 * Design + decisions: docs/workplans/CALIBRATION_DATASOURCE_RESOLVER_WORKPLAN.md.
 */

import { createLogger } from '@/lib/logger';
import type { ParameterResolverRegistry } from './parameterResolvers';
import type {
  ApplyTarget,
  EngineOutcome,
  ParameterResolver,
  PlannedFix,
  ResolverContext,
  ResolverResult,
} from './parameterResolvers/types';

const logger = createLogger({ module: 'ParameterResolverEngine', service: 'shadow-agent' });

/** Run-scoped context the engine needs to plan + apply fixes. */
export interface EngineContext {
  /** The workflow steps (agent.pilot_steps / workflow_steps). */
  workflowSteps: any[];
  /** Resolved input values for the run. */
  resolvedInputs: Record<string, any>;
  /** User id — for the resolver's connected-account auth. */
  userId: string;
}

/**
 * Applies a planned fix: mutates in-memory state for same-run re-validation AND
 * persists it (input → AgentConfigurationRepository.saveInputValues; DSL → the
 * pilot_steps write). Injected by the caller so the engine has no I/O of its own.
 */
export interface FixApplier {
  apply(fix: PlannedFix, ctx: EngineContext): Promise<void>;
}

export interface EngineDeps {
  registry: ParameterResolverRegistry;
  applier: FixApplier;
}

/** Confidence at/above which a `resolved` value is treated as confident (SA § 6 Q4 — matches P3). */
export const RESOLVER_CONFIDENT_THRESHOLD = 0.9;

const INPUT_REF = /^\{\{\s*input\.([A-Za-z0-9_]+)\s*\}\}$/;

/**
 * Compute where a corrected value must be written for a given step + parameter:
 * a `{{input.X}}` template targets the input field; anything else targets the
 * step param literal.
 */
export function computeApplyTarget(step: any, parameter: string): ApplyTarget {
  const raw = step?.params?.[parameter];
  if (typeof raw === 'string') {
    const m = raw.match(INPUT_REF);
    if (m) return { kind: 'input', field: m[1] };
  }
  return { kind: 'dsl', stepId: step?.step_id || step?.id, paramPath: parameter };
}

export class ParameterResolverEngine {
  /**
   * Plan + apply resolver fixes for the given parameter-error issues.
   * Never throws — a failing resolver/apply is logged and left as report-only
   * (the ShadowAgent must never break the main calibration flow).
   */
  async run(issues: any[], ctx: EngineContext, deps: EngineDeps): Promise<EngineOutcome> {
    const outcome: EngineOutcome = { applied: [], reportOnly: [], appliedFixNotes: [] };
    if (!Array.isArray(issues) || issues.length === 0) return outcome;

    for (const issue of issues) {
      try {
        const planned = await this.planIssue(issue, ctx, deps.registry);
        if (!planned) continue; // no resolver / not applicable → leave the issue as today

        if (planned.kind === 'report') {
          outcome.reportOnly.push({ issueId: issue?.id, stepId: planned.stepId, reason: planned.reason });
          continue;
        }

        await deps.applier.apply(planned.fix, ctx);
        outcome.applied.push(planned.fix);
        outcome.appliedFixNotes.push(planned.fix.disclosure);
        logger.info(
          {
            issueId: issue?.id,
            stepId: planned.fix.stepId,
            parameter: planned.fix.parameter,
            target: planned.fix.target,
            value: planned.fix.value,
            kind: planned.fix.kind,
            confidence: planned.fix.confidence,
          },
          '[ParameterResolver] Applied resolved parameter fix',
        );
      } catch (err) {
        // Non-blocking: a resolver or apply failure must never abort calibration.
        logger.error({ err, issueId: issue?.id }, '[ParameterResolver] Resolver/apply failed (non-blocking)');
        outcome.reportOnly.push({ issueId: issue?.id, reason: 'resolver_error' });
      }
    }

    return outcome;
  }

  /** Plan a single issue: null = skip, {kind:'report'} = leave as-is, {kind:'apply'} = apply this fix. */
  private async planIssue(
    issue: any,
    ctx: EngineContext,
    registry: ParameterResolverRegistry,
  ): Promise<{ kind: 'apply'; fix: PlannedFix } | { kind: 'report'; stepId?: string; reason: string } | null> {
    if (issue?.category !== 'parameter_error') return null;

    const stepId: string | undefined = issue?.affectedSteps?.[0]?.stepId;
    const parameter: string | undefined = issue?.suggestedFix?.action?.parameterName;
    if (!stepId || !parameter) return null;

    const step = this.findStep(ctx.workflowSteps, stepId);
    if (!step) return null;

    const plugin: string | undefined = step.plugin || issue?.suggestedFix?.action?.stepPlugin;
    const action: string | undefined = step.action || issue?.suggestedFix?.action?.stepAction;
    if (!plugin || !action) return null;

    const resolver = registry.lookup(plugin, action, parameter);
    if (!resolver) return null; // not our concern → leave the existing issue untouched

    const resolverCtx: ResolverContext = {
      currentValue: issue?.suggestedFix?.action?.problematicValue ?? step?.params?.[parameter],
      resolvedInputs: ctx.resolvedInputs,
      stepParams: step?.params ?? {},
      stepId,
      userId: ctx.userId,
      rawError: String(issue?.technicalDetails ?? issue?.message ?? ''),
    };

    if (!resolver.appliesTo(resolverCtx)) return null;

    const result: ResolverResult = await resolver.resolve(resolverCtx);
    return this.mapResult(result, { issue, step, stepId, plugin, action, parameter });
  }

  private mapResult(
    result: ResolverResult,
    meta: { issue: any; step: any; stepId: string; plugin: string; action: string; parameter: string },
  ): { kind: 'apply'; fix: PlannedFix } | { kind: 'report'; stepId?: string; reason: string } | null {
    const { issue, step, stepId, plugin, action, parameter } = meta;
    const stepName: string | undefined = step?.name || step?.description;
    const target = computeApplyTarget(step, parameter);
    const base = { issueId: issue?.id, stepId, stepName, plugin, action, parameter, target } as const;

    if (result.status === 'unresolved') {
      return { kind: 'report', stepId, reason: result.reason };
    }

    if (result.status === 'resolved') {
      return {
        kind: 'apply',
        fix: {
          ...base,
          value: result.value,
          confidence: result.confidence,
          kind: 'confident',
          reason: result.reason,
          disclosure: this.disclosure('confident', result.reason, valueLabel(result.value)),
        },
      };
    }

    // ambiguous → best-effort auto-apply candidates[0] (headless: no user picker)
    const best = result.candidates?.[0];
    if (best === undefined) return { kind: 'report', stepId, reason: 'ambiguous_no_candidates' };
    return {
      kind: 'apply',
      fix: {
        ...base,
        value: best.value,
        confidence: result.confidence,
        kind: 'best_effort',
        reason: result.reason,
        disclosure: this.disclosure('best_effort', result.reason, best.label ?? valueLabel(best.value)),
      },
    };
  }

  /** Plain-English disclosure for the summary email. App-specific wording comes from the resolver's `reason`. */
  private disclosure(kind: 'confident' | 'best_effort', reason: string, label: string): string {
    const r = (reason || '').trim();
    if (kind === 'confident') return r || `Corrected a setting to "${label}".`;
    const lead = r ? `${r} ` : '';
    return `${lead}We used "${label}" as a best guess — if that's not what you meant, change it in the agent's settings.`;
  }

  private findStep(steps: any[], stepId: string): any | undefined {
    const walk = (arr: any[]): any | undefined => {
      for (const s of arr || []) {
        if ((s?.step_id || s?.id) === stepId) return s;
        if (s?.type === 'scatter_gather' && Array.isArray(s?.scatter?.steps)) {
          const found = walk(s.scatter.steps);
          if (found) return found;
        }
      }
      return undefined;
    };
    return walk(steps);
  }
}

function valueLabel(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}
