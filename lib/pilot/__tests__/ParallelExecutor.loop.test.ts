/**
 * ParallelExecutor — Loop inner-step namespacing tests
 *
 * Phase 6, Tier 2 Fix #1.
 * See workplan: docs/workplans/loop-inner-step-output-namespacing.md
 *
 * Verifies that when `loopInnerOverwriteDisabled` is enabled on
 * ExecutionContext, the inner-step output is NOT written to the parent's
 * stepOutputs map under its bare step id (which would silently resolve
 * to only the last iteration). The per-iteration namespace is always
 * written. UI completion tracking is preserved via markStepCompletion.
 */

import { ExecutionContext } from '../ExecutionContext';
import { ParallelExecutor } from '../ParallelExecutor';
import { VariableResolutionError, type Agent, type LoopStep, type StepOutput, type WorkflowStep } from '../types';
import type { StepExecutor } from '../StepExecutor';

const makeAgent = (): Agent => ({
  id: 'agent-test',
  user_id: 'user-test',
  agent_name: 'loop-test-agent',
  user_prompt: 'test',
  plugins_required: [],
});

/**
 * Minimal stub of StepExecutor that returns a canned output computed from
 * the current iteration's loop variable. The output's `data` includes the
 * iteration index so we can verify which iteration's data downstream refs
 * resolve to.
 */
function makeStubStepExecutor(): StepExecutor {
  return {
    async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepOutput> {
      const loopVar = context.getVariable('loop') as { index: number } | undefined;
      const iteration = loopVar?.index ?? -1;
      return {
        stepId: step.id,
        plugin: 'stub',
        action: 'echo',
        data: { iteration, value: `iter-${iteration}` },
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime: 1,
        },
      };
    },
  } as unknown as StepExecutor;
}

function makeContext(loopInnerOverwriteDisabled: boolean): ExecutionContext {
  const ctx = new ExecutionContext(
    'exec-test',
    makeAgent(),
    'user-test',
    'session-test',
    {},
    false, // batchCalibrationMode
    false, // strict
    loopInnerOverwriteDisabled,
  );
  // Seed the array we iterate over.
  ctx.setVariable('items', ['a', 'b', 'c']);
  return ctx;
}

function makeLoopStep(): LoopStep {
  return {
    id: 'loop1',
    name: 'test loop',
    type: 'loop',
    iterateOver: '{{items}}',
    maxIterations: 100,
    parallel: false,
    loopSteps: [
      {
        id: 'step5',
        name: 'inner step',
        type: 'action',
        plugin: 'stub',
        action: 'echo',
        params: {},
      } as any,
    ],
  };
}

describe('ParallelExecutor — loop inner-step namespacing', () => {
  // LP1 — legacy behavior preserved when flag is OFF
  it('LP1: with flag OFF, {{step5.data}} after the loop resolves to the LAST iteration', async () => {
    const ctx = makeContext(false);
    const pe = new ParallelExecutor(makeStubStepExecutor(), 3);

    const results = await pe.executeLoop(makeLoopStep(), ctx);
    expect(results.length).toBe(3);

    // Legacy: stepOutputs['step5'] === last iteration's output
    const step5 = ctx.getStepOutput('step5');
    expect(step5).toBeDefined();
    expect((step5!.data as any).iteration).toBe(2); // index of last iteration
  });

  // LP2 — with flag ON, the bare inner-step id is NOT in stepOutputs
  it('LP2: with flag ON, {{step5.data}} throws because step5 is not in stepOutputs', async () => {
    const ctx = makeContext(true);
    const pe = new ParallelExecutor(makeStubStepExecutor(), 3);

    await pe.executeLoop(makeLoopStep(), ctx);

    expect(ctx.hasStepExecuted('step5')).toBe(false);

    // Resolving {{step5.data}} after the loop must surface the broken ref as a
    // VariableResolutionError instead of silently returning the last
    // iteration's data.
    expect(() => ctx.resolveVariable('{{step5.data}}')).toThrow(VariableResolutionError);
  });

  // LP3 — per-iteration namespace is the canonical way to access a specific iteration
  it('LP3: with flag ON, {{step5_iteration<N>.data}} resolves to that iteration', async () => {
    const ctx = makeContext(true);
    const pe = new ParallelExecutor(makeStubStepExecutor(), 3);

    await pe.executeLoop(makeLoopStep(), ctx);

    const iter0 = ctx.resolveVariable('{{step5_iteration0.data}}') as any;
    const iter1 = ctx.resolveVariable('{{step5_iteration1.data}}') as any;
    const iter2 = ctx.resolveVariable('{{step5_iteration2.data}}') as any;

    expect(iter0.iteration).toBe(0);
    expect(iter1.iteration).toBe(1);
    expect(iter2.iteration).toBe(2);
  });

  // LP4 — UI completion tracking preserved
  it('LP4: with flag ON, completedSteps still contains step5 exactly once (UI tracking preserved)', async () => {
    const ctx = makeContext(true);
    const pe = new ParallelExecutor(makeStubStepExecutor(), 3);

    await pe.executeLoop(makeLoopStep(), ctx);

    const step5Count = ctx.completedSteps.filter(id => id === 'step5').length;
    expect(step5Count).toBe(1);
  });

  // LP5 — the loop step's own id (returned via executeLoop's caller in
  // WorkflowPilot) is NOT affected by this fix. The function returns the
  // aggregated array; WorkflowPilot writes that to stepOutputs[loopId].data.
  // We verify the returned array here (the WorkflowPilot write happens
  // outside this function).
  it('LP5: executeLoop returns the aggregated array regardless of flag', async () => {
    const ctxOn = makeContext(true);
    const ctxOff = makeContext(false);
    const pe = new ParallelExecutor(makeStubStepExecutor(), 3);

    const resultsOn = await pe.executeLoop(makeLoopStep(), ctxOn);
    const resultsOff = await pe.executeLoop(makeLoopStep(), ctxOff);

    expect(resultsOn.length).toBe(3);
    expect(resultsOff.length).toBe(3);
    // Each iteration's per-step result is recorded; shape matches whatever
    // executeLoopIteration's mergedResult heuristic emits — we only assert
    // that the array length and iteration metadata are present.
    expect(resultsOn).toEqual(resultsOff);
  });
});
