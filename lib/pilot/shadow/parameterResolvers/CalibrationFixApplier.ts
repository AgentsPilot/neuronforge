/**
 * CalibrationFixApplier — the real FixApplier used by the batch calibration route
 * (Calibration Option A). Applies a PlannedFix produced by ParameterResolverEngine:
 *
 *   • input target → mutate the in-memory mergedInputValues (so the loop's next
 *     pilot.execute re-validates with the fix) AND persist via the repository.
 *   • dsl target   → mutate agent.pilot_steps in place AND persist the steps.
 *
 * Persistence is injected (`persistInputValues` / `persistPilotSteps`) so this
 * stays unit-testable with no DB, and the route wires the repository calls
 * (AgentConfigurationRepository.saveInputValues for inputs — SA § 6 Q3
 * repository-pattern; AgentRepository.update for pilot_steps).
 */

import { createLogger } from '@/lib/logger';
import type { EngineContext, FixApplier } from '../ParameterResolverEngine';
import type { PlannedFix } from './types';

const logger = createLogger({ module: 'CalibrationFixApplier', service: 'shadow-agent' });

export interface CalibrationApplierDeps {
  /** The mutable input map the calibration loop passes to pilot.execute — mutated in place. */
  mergedInputValues: Record<string, any>;
  /** The agent's pilot_steps — mutated in place for dsl-target fixes. */
  pilotSteps: any[];
  /** Persist the (now-corrected) input values. Route: configRepo.saveInputValues(agentId, userId, iv). */
  persistInputValues: (inputValues: Record<string, any>) => Promise<void>;
  /** Persist the (now-corrected) steps. Route: agentRepo.update(agentId, { pilot_steps }, userId). */
  persistPilotSteps: (steps: any[]) => Promise<void>;
}

export class CalibrationFixApplier implements FixApplier {
  constructor(private readonly deps: CalibrationApplierDeps) {}

  async apply(fix: PlannedFix, _ctx: EngineContext): Promise<void> {
    if (fix.target.kind === 'input') {
      const field = fix.target.field;
      this.deps.mergedInputValues[field] = fix.value; // in-memory → re-validated next iteration
      await this.deps.persistInputValues(this.deps.mergedInputValues);
      logger.info({ field, value: fix.value, kind: fix.kind }, '[FixApplier] Applied input-target fix (+persisted)');
      return;
    }

    // dsl target: write the corrected value into the step's params at paramPath.
    const step = findStep(this.deps.pilotSteps, fix.target.stepId);
    if (!step) {
      logger.warn({ stepId: fix.target.stepId }, '[FixApplier] dsl target step not found — skipping apply');
      return;
    }
    step.params = step.params || {};
    setByPath(step.params, fix.target.paramPath, fix.value);
    await this.deps.persistPilotSteps(this.deps.pilotSteps);
    logger.info(
      { stepId: fix.target.stepId, paramPath: fix.target.paramPath, value: fix.value, kind: fix.kind },
      '[FixApplier] Applied dsl-target fix (+persisted)',
    );
  }
}

/** Set a possibly-dotted path (e.g. "range" or "content.range") on an object, creating intermediate objects. */
export function setByPath(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return;
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key];
  }
  node[parts[parts.length - 1]] = value;
}

/** Find a step by id, including inside scatter-gather sub-steps. */
function findStep(steps: any[], stepId: string): any | undefined {
  for (const s of steps || []) {
    if ((s?.step_id || s?.id) === stepId) return s;
    if (s?.type === 'scatter_gather' && Array.isArray(s?.scatter?.steps)) {
      const found = findStep(s.scatter.steps, stepId);
      if (found) return found;
    }
  }
  return undefined;
}
