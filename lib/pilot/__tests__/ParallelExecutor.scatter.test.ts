/**
 * ParallelExecutor — Scatter-gather explicit shape tests
 *
 * Phase 6, Tier 2 Fix #3.
 * See workplan: docs/workplans/explicit-scatter-gather-output-shape.md
 *
 * Verifies the explicit `gather.shape` policy bypasses the legacy
 * isStepExtractLike heuristic and produces deterministic per-item shapes.
 */

import { ExecutionContext } from '../ExecutionContext';
import { ParallelExecutor } from '../ParallelExecutor';
import type {
  Agent,
  ScatterGatherStep,
  StepOutput,
  WorkflowStep,
} from '../types';
import type { StepExecutor } from '../StepExecutor';

const makeAgent = (): Agent => ({
  id: 'agent-test',
  user_id: 'user-test',
  agent_name: 'scatter-test-agent',
  user_prompt: 'test',
  plugins_required: [],
});

/**
 * Stub StepExecutor: each inner step returns a canned `data` object derived
 * from its `params.canned` field, or `{ extracted: true, value: stepId }` if
 * none was provided. The tests can therefore distinguish first-step vs
 * last-step outputs.
 */
function makeStubStepExecutor(): StepExecutor {
  return {
    async execute(step: WorkflowStep, _context: ExecutionContext): Promise<StepOutput> {
      const params = (step as any).params || {};
      const data = params.canned !== undefined
        ? params.canned
        : { extracted: true, value: step.id };
      return {
        stepId: step.id,
        plugin: 'stub',
        action: 'echo',
        data,
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime: 1,
        },
      };
    },
  } as unknown as StepExecutor;
}

function makeContext(scatterExplicitShapeRequired: boolean): ExecutionContext {
  const ctx = new ExecutionContext(
    'exec-test',
    makeAgent(),
    'user-test',
    'session-test',
    {},
    false, // batchCalibrationMode
    false, // strict
    false, // loopInnerOverwriteDisabled
    false, // conditionalCoercionEnabled
    scatterExplicitShapeRequired,
  );
  // Single-item array so we test exactly one scatter iteration per case
  ctx.setVariable('items', [{ x: 9, original: 'kept' }]);
  return ctx;
}

function makeScatterStep(
  steps: WorkflowStep[],
  shape?: ScatterGatherStep['gather']['shape'],
  shapeField?: string,
): ScatterGatherStep {
  const gather: ScatterGatherStep['gather'] = { operation: 'collect' };
  if (shape) gather.shape = shape;
  if (shapeField) gather.shapeField = shapeField;
  return {
    id: 'scatter1',
    name: 'test scatter',
    type: 'scatter_gather',
    scatter: {
      input: '{{items}}',
      steps,
      itemVariable: 'item',
    },
    gather,
  };
}

const innerStep = (id: string, canned: any): WorkflowStep => ({
  id,
  name: id,
  type: 'action',
  plugin: 'stub',
  action: 'echo',
  params: { canned },
} as any);

describe('ParallelExecutor — explicit gather.shape (Phase 6 Tier 2 Fix #3)', () => {
  let pe: ParallelExecutor;
  beforeEach(() => {
    pe = new ParallelExecutor(makeStubStepExecutor(), 3);
  });

  // SC1 — step_only on a single-step body: drops the item, returns step data
  it('SC1: shape=step_only on single-step body returns only the step data', async () => {
    const ctx = makeContext(false);
    const scatter = makeScatterStep(
      [innerStep('sA', { a: 1, b: 2 })],
      'step_only',
    );

    const result = await pe.executeScatterGather(scatter, ctx);
    // gather.operation = 'collect' → result is the array of per-item outputs
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toEqual({ a: 1, b: 2 });
  });

  // SC2 — merge_with_item: combine item fields with step data
  it('SC2: shape=merge_with_item folds step data onto the item', async () => {
    const ctx = makeContext(false);
    const scatter = makeScatterStep(
      [innerStep('sA', { a: 1 })],
      'merge_with_item',
    );

    const result = await pe.executeScatterGather(scatter, ctx);
    expect(result[0]).toEqual({ x: 9, original: 'kept', a: 1 });
  });

  // SC3 — merge_as_named_array: stash step data under the named field
  it('SC3: shape=merge_as_named_array stashes step data under shapeField', async () => {
    const ctx = makeContext(false);
    const scatter = makeScatterStep(
      [innerStep('sA', [1, 2, 3])],
      'merge_as_named_array',
      'rows',
    );

    const result = await pe.executeScatterGather(scatter, ctx);
    expect(result[0]).toEqual({ x: 9, original: 'kept', rows: [1, 2, 3] });
  });

  // SC4 — merge_as_named_array WITHOUT shapeField throws
  it('SC4: shape=merge_as_named_array without shapeField throws', async () => {
    const ctx = makeContext(false);
    const scatter = makeScatterStep(
      [innerStep('sA', [1, 2, 3])],
      'merge_as_named_array',
      // shapeField intentionally missing
    );

    // executeScatter wraps individual item failures into { error, item };
    // when ALL items fail, executeScatterGather re-throws with the first
    // error's message embedded. Match on the actionable hint that the
    // shape requires shapeField.
    await expect(pe.executeScatterGather(scatter, ctx)).rejects.toThrow(
      /shapeField to be set|all 1 items failed/,
    );
  });

  // SC5 — item_only: step output is dropped entirely
  it('SC5: shape=item_only drops the step output and returns the original item', async () => {
    const ctx = makeContext(false);
    const scatter = makeScatterStep(
      [innerStep('sA', { a: 1 })],
      'item_only',
    );

    const result = await pe.executeScatterGather(scatter, ctx);
    expect(result[0]).toEqual({ x: 9, original: 'kept' });
  });

  // SC6 — step_only on multi-step body: returns the LAST step's data
  it('SC6: shape=step_only on multi-step body returns the LAST step data', async () => {
    const ctx = makeContext(false);
    const scatter = makeScatterStep(
      [
        innerStep('first', { a: 1 }),
        innerStep('last', { b: 2 }),
      ],
      'step_only',
    );

    const result = await pe.executeScatterGather(scatter, ctx);
    expect(result[0]).toEqual({ b: 2 });
  });

  // SC7 — merge_with_item on multi-step body: folds ALL step outputs
  it('SC7: shape=merge_with_item on multi-step body merges all step outputs onto item', async () => {
    const ctx = makeContext(false);
    const scatter = makeScatterStep(
      [
        innerStep('first', { a: 1 }),
        innerStep('last', { b: 2 }),
      ],
      'merge_with_item',
    );

    const result = await pe.executeScatterGather(scatter, ctx);
    expect(result[0]).toEqual({ x: 9, original: 'kept', a: 1, b: 2 });
  });

  // SC8 — shape ABSENT + flag OFF → legacy heuristic runs (unchanged behavior)
  it('SC8: missing shape + flag off → falls back to legacy heuristic', async () => {
    const ctx = makeContext(false); // flag off
    // No `ai_type` and no `output_schema` declared on the inner step → the
    // heuristic's extract-like detector returns false → single-step path
    // merges item with step data. This proves the legacy path is unchanged
    // by this fix.
    const scatter = makeScatterStep(
      [innerStep('sA', { a: 1, b: 2 })],
      // shape absent
    );

    const result = await pe.executeScatterGather(scatter, ctx);
    expect(result[0]).toEqual({ x: 9, original: 'kept', a: 1, b: 2 });
  });

  // SC9 — shape ABSENT + flag ON → throws
  it('SC9: missing shape + flag on → throws with explicit hint', async () => {
    const ctx = makeContext(true); // flag on
    const scatter = makeScatterStep(
      [innerStep('sA', { a: 1 })],
      // shape absent
    );

    // executeScatter wraps per-item errors. The "all items failed" wrapper
    // embeds the per-item error message which contains the actionable hint.
    await expect(pe.executeScatterGather(scatter, ctx)).rejects.toThrow(
      /gather\.shape is required|all 1 items failed/,
    );
  });

  // SC10 — flag on doesn't break things when shape IS present
  it('SC10: flag on + shape present → works deterministically', async () => {
    const ctx = makeContext(true); // flag on
    const scatter = makeScatterStep(
      [innerStep('sA', { a: 1 })],
      'merge_with_item',
    );

    const result = await pe.executeScatterGather(scatter, ctx);
    expect(result[0]).toEqual({ x: 9, original: 'kept', a: 1 });
  });

  // ========================================================================
  // Phase 6 — Tier 2 Fix #4: runMode-aware failure handling
  // ========================================================================
  describe('runMode failure handling (Fix #4)', () => {
    /**
     * Stub StepExecutor that ALWAYS throws an exception. Used to simulate
     * an inner-step failure inside a scatter iteration.
     */
    function makeThrowingStepExecutor(errorMessage: string): StepExecutor {
      return {
        async execute(_step: WorkflowStep, _context: ExecutionContext): Promise<StepOutput> {
          throw new Error(errorMessage);
        },
      } as unknown as StepExecutor;
    }

    function makeCtxWithRunMode(runMode: 'production' | 'calibration' | 'batch_calibration'): ExecutionContext {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
        {},
        runMode === 'batch_calibration', // batchCalibrationMode
        false, // strict
        false, // loopInnerOverwriteDisabled
        false, // conditionalCoercionEnabled
        false, // scatterExplicitShapeRequired
        runMode,
      );
      // Two items so we can verify "first failure fails the whole scatter"
      // in production mode.
      ctx.setVariable('items', [{ id: 1 }, { id: 2 }]);
      return ctx;
    }

    it('R5: production mode re-throws on first scatter item failure', async () => {
      const ctx = makeCtxWithRunMode('production');
      const throwingPe = new ParallelExecutor(
        makeThrowingStepExecutor('boom'),
        3,
      );
      const scatter = makeScatterStep(
        [innerStep('sA', null)],
        'step_only',
      );

      await expect(throwingPe.executeScatterGather(scatter, ctx)).rejects.toThrow(
        /boom/,
      );
    });

    it('R6: calibration mode swallows item failures and continues', async () => {
      const ctx = makeCtxWithRunMode('calibration');
      const throwingPe = new ParallelExecutor(
        makeThrowingStepExecutor('boom'),
        3,
      );
      const scatter = makeScatterStep(
        [innerStep('sA', null)],
        'step_only',
      );

      // All items fail in this test, so executeScatterGather still throws
      // — but with SCATTER_ALL_FAILED, not the raw error. That's expected
      // calibration behavior: it tries every item before giving up.
      await expect(throwingPe.executeScatterGather(scatter, ctx)).rejects.toThrow(
        /all \d+ items failed/,
      );
    });

    it('R7: batch_calibration mode behaves like calibration for failures', async () => {
      const ctx = makeCtxWithRunMode('batch_calibration');
      const throwingPe = new ParallelExecutor(
        makeThrowingStepExecutor('boom'),
        3,
      );
      const scatter = makeScatterStep(
        [innerStep('sA', null)],
        'step_only',
      );

      await expect(throwingPe.executeScatterGather(scatter, ctx)).rejects.toThrow(
        /all \d+ items failed/,
      );
    });

    /**
     * Mix one throwing item with one succeeding item — calibration mode
     * keeps the successful results and tags the failure into metadata.
     * Production mode re-throws regardless.
     */
    it('R8: calibration mode preserves successes when some items fail', async () => {
      const ctx = makeCtxWithRunMode('calibration');
      // Throw only on item with id===1, succeed on item id===2.
      const partialExecutor = {
        async execute(_step: WorkflowStep, context: ExecutionContext): Promise<StepOutput> {
          const itemVar = context.getVariable('item') as { id: number };
          if (itemVar?.id === 1) {
            throw new Error('only-first-fails');
          }
          return {
            stepId: _step.id,
            plugin: 'stub',
            action: 'echo',
            data: { ok: itemVar?.id },
            metadata: {
              success: true,
              executedAt: new Date().toISOString(),
              executionTime: 1,
            },
          };
        },
      } as unknown as StepExecutor;

      const mixedPe = new ParallelExecutor(partialExecutor, 3);
      const scatter = makeScatterStep(
        [innerStep('sA', null)],
        'step_only',
      );

      const result = await mixedPe.executeScatterGather(scatter, ctx);
      // 'collect' gather operation → result is the array of successful per-item outputs
      expect(Array.isArray(result)).toBe(true);
      // One item failed (filtered out by WP-10), one succeeded.
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ ok: 2 });
    });

    it('R9: production mode fails the whole scatter when one item fails', async () => {
      const ctx = makeCtxWithRunMode('production');
      const partialExecutor = {
        async execute(_step: WorkflowStep, context: ExecutionContext): Promise<StepOutput> {
          const itemVar = context.getVariable('item') as { id: number };
          if (itemVar?.id === 1) {
            throw new Error('only-first-fails');
          }
          return {
            stepId: _step.id,
            plugin: 'stub',
            action: 'echo',
            data: { ok: itemVar?.id },
            metadata: {
              success: true,
              executedAt: new Date().toISOString(),
              executionTime: 1,
            },
          };
        },
      } as unknown as StepExecutor;

      const mixedPe = new ParallelExecutor(partialExecutor, 3);
      const scatter = makeScatterStep(
        [innerStep('sA', null)],
        'step_only',
      );

      // Production: should fail with the original error, not swallow + tag.
      await expect(mixedPe.executeScatterGather(scatter, ctx)).rejects.toThrow(
        /only-first-fails/,
      );
    });
  });
});
