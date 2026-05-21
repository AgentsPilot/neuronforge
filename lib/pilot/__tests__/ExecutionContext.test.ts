/**
 * ExecutionContext — Strict Variable Resolution Tests
 *
 * Phase 6, Tier 1 Fix #2.
 * See workplan: docs/workplans/strict-variable-resolution.md
 *
 * Verifies that strict mode disables the four forgiving resolution paths:
 *   1. Auto-`.data` navigation on step outputs
 *   2. Fuzzy snake↔camel↔Pascal↔lowercase key matching
 *   3. Silent `undefined` on missing keys
 *   4. Inline `{{...}}` substitution error swallowing
 *
 * Lenient mode (default) is unchanged — verified by paired "lenient" cases.
 */

import { ExecutionContext } from '../ExecutionContext';
import { VariableResolutionError, type StepOutput } from '../types';
import type { Agent } from '../types';

// Minimal Agent stub — ExecutionContext only reads .id from it during construction
const makeAgent = (): Agent => ({
  id: 'agent-test',
  user_id: 'user-test',
  agent_name: 'test-agent',
  user_prompt: 'test',
  plugins_required: [],
});

// Helper: build a context with a single step output already stored.
function makeContextWithStep(opts: {
  strict: boolean;
  stepId: string;
  data: any;
  inputValues?: Record<string, any>;
}): ExecutionContext {
  const ctx = new ExecutionContext(
    'exec-test',
    makeAgent(),
    'user-test',
    'session-test',
    opts.inputValues ?? {},
    false,        // batchCalibrationMode
    opts.strict,  // strict
  );

  const stepOutput: StepOutput = {
    stepId: opts.stepId,
    plugin: 'gmail',
    action: 'search_emails',
    data: opts.data,
    metadata: {
      success: true,
      executedAt: new Date().toISOString(),
      executionTime: 10,
    },
  };
  ctx.setStepOutput(opts.stepId, stepOutput);
  return ctx;
}

describe('ExecutionContext — strict variable resolution', () => {
  describe('explicit .data path (S1)', () => {
    it('S1: resolves {{step1.data.email}} in strict mode when the field exists', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        data: { email: 'x@y.com', subject: 'hi' },
      });

      expect(ctx.resolveVariable('{{step1.data.email}}')).toBe('x@y.com');
    });
  });

  describe('auto-.data navigation (S2, S3)', () => {
    it('S2: strict mode throws when reference omits .data segment', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        data: { email: 'x@y.com' },
      });

      // The user wrote {{step1.email}} but the actual data lives at step1.data.email.
      // Strict mode must throw rather than silently auto-navigate.
      expect(() => ctx.resolveVariable('{{step1.email}}')).toThrow(VariableResolutionError);
    });

    it('S3: lenient mode auto-navigates into .data (existing behavior preserved)', () => {
      const ctx = makeContextWithStep({
        strict: false,
        stepId: 'step1',
        data: { email: 'x@y.com' },
      });

      expect(ctx.resolveVariable('{{step1.email}}')).toBe('x@y.com');
    });
  });

  describe('fuzzy key matching (S4, S5)', () => {
    it('S4: strict mode throws on case-mismatch references', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        data: { email: 'x@y.com' },
      });

      // Data has lowercase 'email'; ref uses 'EMAIL'.
      // Lenient mode would fuzzy-resolve; strict mode must throw.
      expect(() => ctx.resolveVariable('{{step1.data.EMAIL}}')).toThrow(VariableResolutionError);
    });

    it('S5: lenient mode fuzzy-matches across case conventions (existing behavior preserved)', () => {
      const ctx = makeContextWithStep({
        strict: false,
        stepId: 'step1',
        data: { email: 'x@y.com' },
      });

      expect(ctx.resolveVariable('{{step1.data.EMAIL}}')).toBe('x@y.com');
    });

    it('S5b: lenient mode also resolves snake↔camel mismatches', () => {
      const ctx = makeContextWithStep({
        strict: false,
        stepId: 'step1',
        data: { attachmentId: 'abc-123' },
      });

      // Schema-style snake_case ref resolves to runtime camelCase key.
      expect(ctx.resolveVariable('{{step1.data.attachment_id}}')).toBe('abc-123');
    });
  });

  describe('missing keys (S6, S7)', () => {
    it('S6: strict mode preserves explicit undefined values on declared keys', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        // 'subject' key is declared but its value is undefined
        data: { email: 'x@y.com', subject: undefined },
      });

      // 'subject in data' === true, so this is a legitimate undefined; should not throw.
      expect(ctx.resolveVariable('{{step1.data.subject}}')).toBeUndefined();
    });

    it('S7: strict mode throws with an "Available keys" hint when the key is absent', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        data: { email: 'x@y.com', subject: 'hi' },
      });

      try {
        ctx.resolveVariable('{{step1.data.nope}}');
        fail('Expected VariableResolutionError to be thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(VariableResolutionError);
        expect(err.message).toContain('nope');
        expect(err.message).toContain('Available keys');
        expect(err.message).toContain('email');
        expect(err.message).toContain('subject');
      }
    });
  });

  describe('inline template substitution (S8, S9)', () => {
    it('S8: strict mode throws when an inline {{...}} fails to resolve', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        data: { email: 'x@y.com' },
      });

      expect(() =>
        ctx.resolveAllVariables('Hello {{step1.data.nope}}'),
      ).toThrow(VariableResolutionError);
    });

    it('S9: lenient mode stringifies undefined silently when a key is missing', () => {
      const ctx = makeContextWithStep({
        strict: false,
        stepId: 'step1',
        data: { email: 'x@y.com' },
      });

      // In lenient mode, missing keys resolve to `undefined` (no throw),
      // and `String(undefined)` is what ends up in the rendered template.
      // This is exactly the silent-failure behavior strict mode eliminates.
      const out = ctx.resolveAllVariables('Hello {{step1.data.nope}}');
      expect(out).toBe('Hello undefined');
    });

    it('S9b: lenient mode preserves the {{...}} token only on actual resolution errors', () => {
      const ctx = makeContextWithStep({
        strict: false,
        stepId: 'step1',
        data: { items: { not_an_array: true } },
      });

      // Indexing into a non-array throws (regardless of strict mode);
      // the inline catch then keeps the original token in the rendered output.
      const out = ctx.resolveAllVariables('Item: {{step1.data.items[0]}}');
      expect(out).toContain('{{step1.data.items[0]}}');
    });
  });

  describe('input refs (S10)', () => {
    it('S10: strict mode throws for {{input.foo}} when foo was not supplied', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        data: {},
        inputValues: { bar: 1 }, // 'foo' deliberately absent
      });

      expect(() => ctx.resolveVariable('{{input.foo}}')).toThrow(VariableResolutionError);
    });

    it('S10b: lenient mode silently returns undefined for {{input.foo}}', () => {
      const ctx = makeContextWithStep({
        strict: false,
        stepId: 'step1',
        data: {},
        inputValues: { bar: 1 },
      });

      expect(ctx.resolveVariable('{{input.foo}}')).toBeUndefined();
    });
  });

  describe('clone preserves strict flag (S11)', () => {
    it('S11: cloned context inherits strict=true', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        data: { email: 'x@y.com' },
      });

      const cloned = ctx.clone();
      expect(cloned.isStrict()).toBe(true);

      // Strict behavior also persists in the clone
      expect(() => cloned.resolveVariable('{{step1.data.nope}}')).toThrow(VariableResolutionError);
    });

    it('S11b: cloned context inherits strict=false', () => {
      const ctx = makeContextWithStep({
        strict: false,
        stepId: 'step1',
        data: { email: 'x@y.com' },
      });

      const cloned = ctx.clone();
      expect(cloned.isStrict()).toBe(false);
    });
  });

  describe('null values (S12)', () => {
    it('S12: strict mode returns null (not throws) for explicit null values', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        data: { email: null },
      });

      expect(ctx.resolveVariable('{{step1.data.email}}')).toBeNull();
    });

    it('S12b: strict mode returns null when traversing through an explicit null', () => {
      const ctx = makeContextWithStep({
        strict: true,
        stepId: 'step1',
        data: { nested: null },
      });

      // Traversing into a null-valued key returns null (legitimate API value)
      // — does not throw, per Design D4.
      expect(ctx.resolveVariable('{{step1.data.nested}}')).toBeNull();
    });
  });

  describe('backward-compat default', () => {
    it('defaults to lenient (strict=false) when constructor arg is omitted', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
        {},
        false, // batchCalibrationMode
        // strict omitted
      );

      expect(ctx.isStrict()).toBe(false);
    });
  });

  // ==========================================================================
  // ExecutionScope — Phase 6 Tier 1 Fix #3
  // ==========================================================================
  describe('ExecutionScope (per-execution resource bundle)', () => {
    it('Sc1: fresh context has an empty scope with all-null defaults', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
      );

      expect(ctx.scope).toBeDefined();
      expect(ctx.scope.debugRunId).toBeNull();
      expect(ctx.scope.executionSummaryCollector).toBeNull();
      expect(ctx.scope.shadowAgent).toBeNull();
      expect(ctx.scope.executionProtection).toBeNull();
      expect(ctx.scope.checkpointManager).toBeNull();
      expect(ctx.scope.resumeOrchestrator).toBeNull();
      // Phase 6 — Post-audit cleanup (G2, G4)
      expect(ctx.scope.memoryLoadFailed).toBeNull();
      expect(ctx.scope.scatterPartialFailures).toEqual([]);
    });

    // Post-audit cleanup G4
    it('Sc6: scope.memoryLoadFailed defaults to null and can be set explicitly', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
      );
      expect(ctx.scope.memoryLoadFailed).toBeNull();

      ctx.scope.memoryLoadFailed = { reason: 'timeout', message: 'Memory loading timeout (10000ms)' };
      expect(ctx.scope.memoryLoadFailed.reason).toBe('timeout');
      expect(ctx.scope.memoryLoadFailed.message).toContain('timeout');
    });

    // Post-audit cleanup G2
    it('Sc7: scope.scatterPartialFailures starts empty and survives push', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
      );
      expect(ctx.scope.scatterPartialFailures).toHaveLength(0);

      ctx.scope.scatterPartialFailures.push({
        stepId: 'scatter1',
        totalItems: 5,
        successCount: 4,
        errorCount: 1,
        errors: [{ error: 'boom', item: 2 }],
      });

      expect(ctx.scope.scatterPartialFailures).toHaveLength(1);
      expect(ctx.scope.scatterPartialFailures[0].stepId).toBe('scatter1');
      // Critical property: a plain array of plain objects survives JSON serialization
      // (unlike the legacy _scatter_metadata attached as a non-numeric property on a result array)
      const roundTripped = JSON.parse(JSON.stringify(ctx.scope.scatterPartialFailures));
      expect(roundTripped).toEqual(ctx.scope.scatterPartialFailures);
    });

    it('Sc2: stepEmitter starts undefined (not null)', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
      );

      expect(ctx.scope.stepEmitter).toBeUndefined();
    });

    it('Sc3: clone() shares the scope by reference (shallow copy)', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
      );

      ctx.scope.debugRunId = 'debug-123';

      const cloned = ctx.clone();
      expect(cloned.scope).toBe(ctx.scope); // identity equal, not just structurally equal
    });

    it('Sc4: parent mutations after clone are visible on the child', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
      );
      const cloned = ctx.clone();

      // Mutate on parent AFTER clone
      ctx.scope.debugRunId = 'after-clone';

      expect(cloned.scope.debugRunId).toBe('after-clone');
    });

    // The point of this fix: two distinct contexts have isolated scopes.
    // This is the regression test for the concurrent-execute corruption risk.
    it('Sc5: two distinct ExecutionContext instances do not share scope', () => {
      const ctxA = new ExecutionContext(
        'exec-a',
        makeAgent(),
        'user-a',
        'session-a',
      );
      const ctxB = new ExecutionContext(
        'exec-b',
        makeAgent(),
        'user-b',
        'session-b',
      );

      ctxA.scope.debugRunId = 'debug-A';
      ctxB.scope.debugRunId = 'debug-B';

      expect(ctxA.scope.debugRunId).toBe('debug-A');
      expect(ctxB.scope.debugRunId).toBe('debug-B');
      // Sanity: scope objects are distinct references
      expect(ctxA.scope).not.toBe(ctxB.scope);
    });
  });

  // ==========================================================================
  // Loop inner-step overwrite policy — Phase 6 Tier 2 Fix #1
  // ==========================================================================
  describe('loop inner-step overwrite policy', () => {
    function makeBasicContext(loopInnerOverwriteDisabled: boolean = false): ExecutionContext {
      return new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
        {},
        false, // batchCalibrationMode
        false, // strict
        loopInnerOverwriteDisabled,
      );
    }

    it('L1: markStepCompletion(stepId, true) adds to completedSteps', () => {
      const ctx = makeBasicContext();
      ctx.markStepCompletion('step5', true);

      expect(ctx.completedSteps).toContain('step5');
    });

    it('L2: markStepCompletion(stepId, false) adds to failedSteps', () => {
      const ctx = makeBasicContext();
      ctx.markStepCompletion('step5', false);

      expect(ctx.failedSteps).toContain('step5');
      expect(ctx.completedSteps).not.toContain('step5');
    });

    it('L3: markStepCompletion does NOT add to stepOutputs', () => {
      const ctx = makeBasicContext();
      ctx.markStepCompletion('step5', true);

      // The whole point of this method: track completion without polluting
      // stepOutputs (so {{step5.data}} still throws / surfaces the bug).
      expect(ctx.hasStepExecuted('step5')).toBe(false);
      expect(ctx.getStepOutput('step5')).toBeUndefined();
    });

    it('L3b: markStepCompletion is idempotent on repeated success calls', () => {
      const ctx = makeBasicContext();
      ctx.markStepCompletion('step5', true);
      ctx.markStepCompletion('step5', true);
      ctx.markStepCompletion('step5', true);

      // No duplicates
      expect(ctx.completedSteps.filter(id => id === 'step5').length).toBe(1);
    });

    it('L3c: markStepCompletion toggles failed → completed correctly', () => {
      const ctx = makeBasicContext();
      ctx.markStepCompletion('step5', false);
      expect(ctx.failedSteps).toContain('step5');
      expect(ctx.completedSteps).not.toContain('step5');

      // A later success mark should remove from failed and add to completed.
      ctx.markStepCompletion('step5', true);
      expect(ctx.completedSteps).toContain('step5');
      expect(ctx.failedSteps).not.toContain('step5');
    });

    it('L4: isLoopInnerOverwriteDisabled defaults to false', () => {
      const ctx = makeBasicContext();
      expect(ctx.isLoopInnerOverwriteDisabled()).toBe(false);
    });

    it('L5: constructor arg sets the loop overwrite flag', () => {
      const ctx = makeBasicContext(true);
      expect(ctx.isLoopInnerOverwriteDisabled()).toBe(true);
    });

    it('L6: clone() preserves the loop overwrite flag', () => {
      const ctx = makeBasicContext(true);
      const cloned = ctx.clone();
      expect(cloned.isLoopInnerOverwriteDisabled()).toBe(true);

      const ctx2 = makeBasicContext(false);
      const cloned2 = ctx2.clone();
      expect(cloned2.isLoopInnerOverwriteDisabled()).toBe(false);
    });
  });

  // ==========================================================================
  // Scatter explicit shape required flag — Phase 6 Tier 2 Fix #3
  // ==========================================================================
  describe('scatter explicit shape required flag', () => {
    function makeCtx(scatterRequired: boolean): ExecutionContext {
      return new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
        {},
        false, // batchCalibrationMode
        false, // strict
        false, // loopInnerOverwriteDisabled
        false, // conditionalCoercionEnabled
        scatterRequired,
      );
    }

    it('S1: defaults to false when constructor arg is omitted', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
      );
      expect(ctx.isScatterExplicitShapeRequired()).toBe(false);
    });

    it('S2: constructor arg sets the flag', () => {
      const ctx = makeCtx(true);
      expect(ctx.isScatterExplicitShapeRequired()).toBe(true);
    });

    it('S3: clone() preserves the scatter shape flag', () => {
      const ctxTrue = makeCtx(true);
      expect(ctxTrue.clone().isScatterExplicitShapeRequired()).toBe(true);

      const ctxFalse = makeCtx(false);
      expect(ctxFalse.clone().isScatterExplicitShapeRequired()).toBe(false);
    });
  });

  // ==========================================================================
  // runMode field — Phase 6 Tier 2 Fix #4
  // ==========================================================================
  describe('runMode', () => {
    it('R1: defaults to "production" when constructor arg is omitted', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
      );
      expect(ctx.runMode).toBe('production');
    });

    it('R2: constructor arg sets runMode to "calibration"', () => {
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
        false, // scatterExplicitShapeRequired
        'calibration',
      );
      expect(ctx.runMode).toBe('calibration');
    });

    it('R3: constructor arg sets runMode to "batch_calibration"', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
        {},
        false,
        false,
        false,
        false,
        false,
        'batch_calibration',
      );
      expect(ctx.runMode).toBe('batch_calibration');
    });

    it('R4: clone() preserves runMode', () => {
      const ctx = new ExecutionContext(
        'exec-test',
        makeAgent(),
        'user-test',
        'session-test',
        {},
        false,
        false,
        false,
        false,
        false,
        'calibration',
      );
      expect(ctx.clone().runMode).toBe('calibration');
    });
  });
});
