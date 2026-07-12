/**
 * Tests for the generic ParameterResolverEngine (Calibration Option A).
 *
 * Uses a MOCK resolver + MOCK applier — no plugin/DB/network. Verifies the
 * headless policy: resolved→apply(confident), ambiguous→apply(best-effort
 * candidates[0]), unresolved/none→leave, resolver-throw→non-blocking; plus the
 * input-vs-DSL ApplyTarget computation.
 */

import {
  ParameterResolverEngine,
  computeApplyTarget,
  type EngineContext,
  type FixApplier,
} from '../ParameterResolverEngine';
import { ParameterResolverRegistry } from '../parameterResolvers';
import type { ParameterResolver, PlannedFix, ResolverResult } from '../parameterResolvers/types';

// ── fixtures ────────────────────────────────────────────────────────────────

function sheetsStep(rangeValue: string) {
  return {
    step_id: 'step1',
    id: 'step1',
    type: 'action',
    plugin: 'google-sheets',
    action: 'read_range',
    name: 'Read all lead data',
    params: { range: rangeValue, spreadsheet_id: '{{input.spreadsheet_id}}' },
  };
}

function rangeIssue() {
  return {
    id: 'iss1',
    category: 'parameter_error',
    severity: 'critical',
    affectedSteps: [{ stepId: 'step1', stepName: 'Read all lead data' }],
    suggestedFix: {
      action: { parameterName: 'range', problematicValue: 'Sheet1', stepPlugin: 'google-sheets', stepAction: 'read_range' },
      confidence: 0.95,
    },
    technicalDetails: '[EXECUTION_ERROR] Unable to parse range: Sheet1',
  };
}

function context(step: any): EngineContext {
  return {
    workflowSteps: [step],
    resolvedInputs: { spreadsheet_id: '1pM8abc', sheet_range: 'Sheet1' },
    userId: 'user-1',
  };
}

/** A mock resolver whose result is configurable per test. */
function mockResolver(result: ResolverResult, opts: { applies?: boolean; onResolve?: () => void } = {}): ParameterResolver {
  return {
    plugin: 'google-sheets',
    action: 'read_range',
    parameter: 'range',
    appliesTo: () => opts.applies ?? true,
    resolve: async () => {
      opts.onResolve?.();
      return result;
    },
  };
}

/** A mock applier that records every fix it was asked to apply. */
function recordingApplier(): FixApplier & { calls: PlannedFix[] } {
  const calls: PlannedFix[] = [];
  return { calls, apply: async (fix) => { calls.push(fix); } };
}

function makeDeps(resolver?: ParameterResolver) {
  const registry = new ParameterResolverRegistry();
  if (resolver) registry.register(resolver);
  const applier = recordingApplier();
  return { registry, applier };
}

const engine = new ParameterResolverEngine();

// ── computeApplyTarget ──────────────────────────────────────────────────────

describe('computeApplyTarget', () => {
  it('targets the input field for a {{input.X}} template param', () => {
    expect(computeApplyTarget(sheetsStep('{{input.sheet_range}}'), 'range')).toEqual({ kind: 'input', field: 'sheet_range' });
  });
  it('targets the DSL step param for a literal value', () => {
    expect(computeApplyTarget(sheetsStep('Sheet1'), 'range')).toEqual({ kind: 'dsl', stepId: 'step1', paramPath: 'range' });
  });
});

// ── engine policy ───────────────────────────────────────────────────────────

describe('ParameterResolverEngine.run', () => {
  it('resolved → auto-applies (confident) with the resolver reason as disclosure', async () => {
    const deps = makeDeps(mockResolver({ status: 'resolved', value: 'Leads', confidence: 0.95, reason: 'Set the sheet range to "Leads" (the spreadsheet\'s only tab).' }));
    const out = await engine.run([rangeIssue()], context(sheetsStep('{{input.sheet_range}}')), deps);

    expect(out.applied).toHaveLength(1);
    expect(deps.applier.calls).toHaveLength(1);
    const fix = out.applied[0];
    expect(fix.value).toBe('Leads');
    expect(fix.kind).toBe('confident');
    expect(fix.target).toEqual({ kind: 'input', field: 'sheet_range' });
    expect(fix.disclosure).toContain('Leads');
    expect(out.appliedFixNotes).toEqual([fix.disclosure]);
    expect(out.reportOnly).toHaveLength(0);
  });

  it('ambiguous → best-effort applies candidates[0] and discloses it as a guess', async () => {
    const deps = makeDeps(
      mockResolver({
        status: 'ambiguous',
        candidates: [{ value: 'Leads', label: 'Leads' }, { value: 'Q1', label: 'Q1' }],
        confidence: 0.6,
        reason: "We couldn't tell which tab you meant.",
      }),
    );
    const out = await engine.run([rangeIssue()], context(sheetsStep('{{input.sheet_range}}')), deps);

    expect(out.applied).toHaveLength(1);
    const fix = out.applied[0];
    expect(fix.value).toBe('Leads'); // first candidate
    expect(fix.kind).toBe('best_effort');
    expect(fix.disclosure.toLowerCase()).toContain('best guess');
    expect(fix.disclosure).toContain("change it in the agent's settings");
  });

  it('unresolved → reports only, applies nothing', async () => {
    const deps = makeDeps(mockResolver({ status: 'unresolved', reason: 'spreadsheet_id missing' }));
    const out = await engine.run([rangeIssue()], context(sheetsStep('{{input.sheet_range}}')), deps);

    expect(out.applied).toHaveLength(0);
    expect(deps.applier.calls).toHaveLength(0);
    expect(out.reportOnly).toHaveLength(1);
    expect(out.reportOnly[0].reason).toBe('spreadsheet_id missing');
  });

  it('no registered resolver → leaves the issue untouched (skip)', async () => {
    const deps = makeDeps(); // empty registry
    const out = await engine.run([rangeIssue()], context(sheetsStep('{{input.sheet_range}}')), deps);
    expect(out.applied).toHaveLength(0);
    expect(out.reportOnly).toHaveLength(0);
    expect(deps.applier.calls).toHaveLength(0);
  });

  it('resolver that throws is non-blocking → reported, does not throw', async () => {
    const throwing: ParameterResolver = {
      plugin: 'google-sheets', action: 'read_range', parameter: 'range',
      appliesTo: () => true,
      resolve: async () => { throw new Error('boom'); },
    };
    const deps = makeDeps(throwing);
    const out = await engine.run([rangeIssue()], context(sheetsStep('{{input.sheet_range}}')), deps);
    expect(out.applied).toHaveLength(0);
    expect(out.reportOnly[0].reason).toBe('resolver_error');
  });

  it('applies to a DSL-literal param via the dsl target', async () => {
    const deps = makeDeps(mockResolver({ status: 'resolved', value: 'Leads', confidence: 0.95, reason: 'Set the range to "Leads".' }));
    const out = await engine.run([rangeIssue()], context(sheetsStep('Sheet1')), deps);
    expect(out.applied[0].target).toEqual({ kind: 'dsl', stepId: 'step1', paramPath: 'range' });
  });

  it('ignores non-parameter_error issues and malformed issues', async () => {
    const deps = makeDeps(mockResolver({ status: 'resolved', value: 'x', confidence: 1, reason: 'r' }));
    const notParamError = { ...rangeIssue(), category: 'execution_error' };
    const noStep = { ...rangeIssue(), affectedSteps: [] };
    const out = await engine.run([notParamError, noStep], context(sheetsStep('{{input.sheet_range}}')), deps);
    expect(out.applied).toHaveLength(0);
    expect(deps.applier.calls).toHaveLength(0);
  });

  it('skips when appliesTo() returns false', async () => {
    const deps = makeDeps(mockResolver({ status: 'resolved', value: 'x', confidence: 1, reason: 'r' }, { applies: false }));
    const out = await engine.run([rangeIssue()], context(sheetsStep('{{input.sheet_range}}')), deps);
    expect(out.applied).toHaveLength(0);
  });

  it('handles empty / non-array input', async () => {
    const deps = makeDeps();
    expect((await engine.run([], context(sheetsStep('Sheet1')), deps)).applied).toHaveLength(0);
    expect((await engine.run(null as any, context(sheetsStep('Sheet1')), deps)).applied).toHaveLength(0);
  });
});
