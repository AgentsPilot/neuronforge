/**
 * Tests for CalibrationFixApplier (Calibration Option A).
 * Mock persist functions — no DB. Verifies in-memory mutation + persist calls
 * for both input and dsl targets, incl. nested param paths.
 */

import { CalibrationFixApplier, setByPath, type CalibrationApplierDeps } from '../parameterResolvers/CalibrationFixApplier';
import type { PlannedFix } from '../parameterResolvers/types';
import type { EngineContext } from '../ParameterResolverEngine';

const ctx: EngineContext = { workflowSteps: [], resolvedInputs: {}, userId: 'u1' };

function makeDeps(overrides: Partial<CalibrationApplierDeps> = {}) {
  const inputCalls: Record<string, any>[] = [];
  const stepCalls: any[][] = [];
  const deps: CalibrationApplierDeps = {
    mergedInputValues: { sheet_range: 'Sheet1', spreadsheet_id: '1pM8' },
    pilotSteps: [{ step_id: 'step1', id: 'step1', plugin: 'google-sheets', action: 'read_range', params: { range: 'Sheet1' } }],
    persistInputValues: async (iv) => { inputCalls.push({ ...iv }); },
    persistPilotSteps: async (s) => { stepCalls.push(JSON.parse(JSON.stringify(s))); },
    ...overrides,
  };
  return { deps, inputCalls, stepCalls };
}

function inputFix(): PlannedFix {
  return {
    stepId: 'step1', plugin: 'google-sheets', action: 'read_range', parameter: 'range',
    target: { kind: 'input', field: 'sheet_range' },
    value: 'Leads', confidence: 0.95, kind: 'confident', disclosure: 'd', reason: 'r',
  };
}
function dslFix(paramPath = 'range'): PlannedFix {
  return {
    stepId: 'step1', plugin: 'google-sheets', action: 'read_range', parameter: 'range',
    target: { kind: 'dsl', stepId: 'step1', paramPath },
    value: 'Leads', confidence: 0.95, kind: 'confident', disclosure: 'd', reason: 'r',
  };
}

describe('CalibrationFixApplier', () => {
  it('input target: mutates mergedInputValues in place AND persists', async () => {
    const { deps, inputCalls, stepCalls } = makeDeps();
    await new CalibrationFixApplier(deps).apply(inputFix(), ctx);

    expect(deps.mergedInputValues.sheet_range).toBe('Leads'); // in-memory → re-validated
    expect(inputCalls).toHaveLength(1);
    expect(inputCalls[0].sheet_range).toBe('Leads');
    expect(stepCalls).toHaveLength(0); // no DSL persist
  });

  it('dsl target: rewrites the step param in place AND persists steps', async () => {
    const { deps, inputCalls, stepCalls } = makeDeps();
    await new CalibrationFixApplier(deps).apply(dslFix(), ctx);

    expect(deps.pilotSteps[0].params.range).toBe('Leads');
    expect(stepCalls).toHaveLength(1);
    expect(stepCalls[0][0].params.range).toBe('Leads');
    expect(inputCalls).toHaveLength(0); // no input persist
  });

  it('dsl target: supports a nested param path', async () => {
    const { deps } = makeDeps({
      pilotSteps: [{ step_id: 'step1', id: 'step1', params: { content: { range: 'Sheet1' } } }],
    });
    await new CalibrationFixApplier(deps).apply(dslFix('content.range'), ctx);
    expect(deps.pilotSteps[0].params.content.range).toBe('Leads');
  });

  it('dsl target: no-op (no throw) when the step is missing', async () => {
    const { deps, stepCalls } = makeDeps({ pilotSteps: [] });
    await expect(new CalibrationFixApplier(deps).apply(dslFix(), ctx)).resolves.toBeUndefined();
    expect(stepCalls).toHaveLength(0);
  });

  it('finds a step nested inside a scatter-gather', async () => {
    const { deps } = makeDeps({
      pilotSteps: [{ step_id: 'step3', type: 'scatter_gather', scatter: { steps: [{ step_id: 'step4', params: { document_id: 'x' } }] } }],
    });
    const fix = { ...dslFix('document_id'), stepId: 'step4', target: { kind: 'dsl' as const, stepId: 'step4', paramPath: 'document_id' } };
    await new CalibrationFixApplier(deps).apply(fix, ctx);
    expect(deps.pilotSteps[0].scatter.steps[0].params.document_id).toBe('Leads');
  });
});

describe('setByPath', () => {
  it('sets a top-level key', () => {
    const o: any = {}; setByPath(o, 'range', 'x'); expect(o.range).toBe('x');
  });
  it('creates intermediate objects for a dotted path', () => {
    const o: any = {}; setByPath(o, 'a.b.c', 1); expect(o.a.b.c).toBe(1);
  });
});
