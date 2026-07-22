/**
 * Group A — A2 (real-execution-summary-shape coverage) + A3 (cosmetic-only pass).
 *
 * A2 regression: the live signal was fed `finalResult.output` (buildFinalOutput —
 * the final SHAPED output), not the per-step map, so a genuinely-populated
 * pre-delivery collection never reached `deriveCoverageSignal`. The fix computes
 * the signal in WorkflowPilot from `context.getAllStepOutputs()` (a
 * `Map<stepId, StepOutput{data}>`) and surfaces the DERIVED result on
 * `execution_summary.coverage`. These tests exercise that REAL map shape
 * (stepId → StepOutput.data, incl. a scalar send confirmation) — not a synthetic
 * single-array fixture — for both a populated and an all-blank send-terminating run.
 *
 * A3: a cosmetic hardcode issue carries its kind on `category` ('hardcode_detected'),
 * not `type`; the verdict mapping must fall back to `category` so a cosmetic-only,
 * genuinely-exercised run reads as `passed` — while any blocking/actionable issue
 * never does (tight allow-list).
 */

import { deriveCoverageSignal } from '../dataQuality';
import { computeVerdict } from '../CalibrationVerdict';

/**
 * Reproduce the map WorkflowPilot builds for the coverage signal:
 * `context.getAllStepOutputs()` yields Map<stepId, StepOutput> and the fix
 * unwraps `.data`. This helper mirrors that unwrap so the test uses the real shape.
 */
function stepOutputsFromContext(entries: Record<string, { data: unknown } | unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [stepId, v] of Object.entries(entries)) {
    out[stepId] = v && typeof v === 'object' && 'data' in (v as any) ? (v as any).data : v;
  }
  return out;
}

// The route's verdict issue-mapping (A3): type falls back to category.
function toVerdictIssues(raw: any[]) {
  return raw.map(i => ({
    type: i.type ?? i.category,
    severity: i.severity,
    blocking: i.blocking ?? i.details?.blocking,
    requiresUserInput: i.details?.requiresUserInput ?? i.requiresUserInput,
    autoRepairAvailable: i.details?.autoRepairAvailable ?? i.autoRepairAvailable,
  }));
}

describe('A2 — coverage on the REAL WorkflowPilot step-outputs shape', () => {
  it('POPULATED send-terminating run (delivered=0, real rows + scalar send confirmation) → exercised, can pass', () => {
    const stepOutputs = stepOutputsFromContext({
      // producing steps wrapped as StepOutput { data }
      search: { data: { emails: [{}] } },
      expense_rows: { data: [
        { amount: 'ILS 99.90', vendor: 'Wolt', date: '2026-02-25' },
        { amount: 'USD 232.96', vendor: 'Expedia', date: '2026-03-01' },
      ] },
      // scalar send confirmation — no counted item array (items_delivered stays 0)
      send_report: { data: { message_id: '19f52a6c391f3aaa', sent_at: '2026-07-11T19:28:08Z' } },
    });
    const cov = deriveCoverageSignal({ stepOutputs, itemsProcessed: 14, itemsDelivered: 0 });
    expect(cov.exercisedRealPath).toBe(true);
    expect(cov.deliveredAllBlank).toBe(false);
    expect(cov.partialBlankColumns).toHaveLength(0);
    expect(computeVerdict({ issues: [], coverage: cov }).verdict).toBe('passed');
  });

  it('ALL-BLANK send-terminating run → still fails (false-green guard preserved)', () => {
    const stepOutputs = stepOutputsFromContext({
      expense_rows: { data: Array.from({ length: 13 }, () => ({ amount: '', vendor: 'Unknown', date: '' })) },
      send_report: { data: { message_id: 'm1', sent_at: 't' } }, // send executed, but rows blank
    });
    const cov = deriveCoverageSignal({ stepOutputs, itemsProcessed: 14, itemsDelivered: 0 });
    expect(cov.deliveredAllBlank).toBe(true);
    expect(cov.exercisedRealPath).toBe(false);
    expect(computeVerdict({ issues: [], coverage: cov }).isPassing).toBe(false);
    expect(computeVerdict({ issues: [], coverage: cov }).verdict).toBe('inconclusive');
  });
});

describe('A3 — cosmetic-only run reads as passed; anything actionable never does', () => {
  const exercised = { exercisedRealPath: true, deliveredAllBlank: false, partialBlankColumns: [] as string[] };

  it('a lone hardcode suggestion (category-only, user-confirm-only) on an exercised run → passed', () => {
    const rawIssues = [{
      category: 'hardcode_detected', // no top-level `type`
      severity: 'medium',
      requiresUserInput: true,
      autoRepairAvailable: false,
    }];
    const verdict = computeVerdict({ issues: toVerdictIssues(rawIssues), coverage: exercised });
    expect(verdict.isPassing).toBe(true);
    expect(verdict.verdict).toBe('passed');
  });

  it('a blocking field-fidelity issue alongside the cosmetic one → never passed (tight allow-list)', () => {
    const rawIssues = [
      { category: 'hardcode_detected', severity: 'medium', requiresUserInput: true, autoRepairAvailable: false },
      { type: 'plugin_field_fidelity_mismatch', severity: 'critical', blocking: true },
    ];
    const verdict = computeVerdict({ issues: toVerdictIssues(rawIssues), coverage: exercised });
    expect(verdict.isPassing).toBe(false);
    expect(verdict.verdict).toBe('needs_review');
  });

  it('a non-cosmetic (partial_report_data) issue is NOT waved by the category fallback', () => {
    const rawIssues = [{ type: 'partial_report_data', severity: 'medium', blocking: false }];
    const verdict = computeVerdict({ issues: toVerdictIssues(rawIssues), coverage: exercised });
    expect(verdict.isPassing).toBe(false);
    expect(verdict.verdict).toBe('needs_review');
  });

  // QA-added (Group A): the coordinator's explicit probe — the `?? i.category`
  // fallback must admit ONLY `hardcode_detected` (+ parameterization). A non-hardcode
  // category with NO top-level type (e.g. business_logic / data_flow) must promote
  // onto the type field but STILL fail the tight WAVEABLE allow-list → not passed.
  it('QA: a category-only NON-hardcode issue (no type) is NOT waved by the fallback', () => {
    for (const category of ['business_logic', 'data_flow', 'execution_error', 'logic_error']) {
      const rawIssues = [{ category, severity: 'medium', requiresUserInput: true, autoRepairAvailable: false }];
      const verdict = computeVerdict({ issues: toVerdictIssues(rawIssues), coverage: exercised });
      expect(verdict.isPassing).toBe(false);
      expect(verdict.verdict).toBe('needs_review');
    }
  });

  it('cosmetic-only but NOT exercised (all-blank) → still not passed (A2 guard dominates A3)', () => {
    const rawIssues = [{ category: 'hardcode_detected', severity: 'medium', requiresUserInput: true, autoRepairAvailable: false }];
    const verdict = computeVerdict({
      issues: toVerdictIssues(rawIssues),
      coverage: { exercisedRealPath: true, deliveredAllBlank: true },
    });
    expect(verdict.isPassing).toBe(false);
  });
});
