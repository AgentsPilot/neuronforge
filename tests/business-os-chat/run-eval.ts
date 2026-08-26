/**
 * Business OS chat — golden-set evaluation.
 *
 *   npx tsx --import ./scripts/env-preload.ts tests/business-os-chat/run-eval.ts
 *   ... --runs=3          repeat every scenario N times (flakiness measurement)
 *   ... --user=<uuid>     evaluate against a specific account
 *   ... --filter=invoice  run only scenarios whose name contains this
 *   ... --execute         also run each plan against the database
 *   ... --json            emit a machine-readable report
 *
 * Exit code: 0 = all pass, 1 = any fail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The previous three chat versions had no way to tell whether a change broke a
 * scenario that used to work, so every new user request was answered by adding
 * another hardcoded example — 230 of them by the end. This suite replaces that
 * reflex: a new request becomes a SCENARIO, and if it fails you fix the catalog
 * or the compiler, which fixes a whole class of phrasings at once.
 *
 * Assertions are on the PLAN (the IR), not on prose, so they are deterministic
 * and cheap. `--runs` matters because planning is non-deterministic at the
 * margins: a single pass tells you almost nothing about whether a change helped.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

import { getBizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import { CATALOG_VERSION } from '@/lib/business-os/catalog';
import { supabaseServer } from '@/lib/supabaseServer';
import type { Plan } from '@/lib/business-os/bizql/planner/Planner';
import type { ComputeQuery, FindQuery, Query } from '@/lib/business-os/bizql/types';

// ============================================================================
// Scenario shape
// ============================================================================

interface FilterExpectation {
  field: string;
  op?: string;
  value?: unknown;
  /** Require a {$semantic:"…"} value with this term. */
  semantic?: string;
  /** Require a {$date:"…"} value, without pinning which anchor. */
  dateAnchor?: boolean;
}

interface Expectation {
  op?: 'find' | 'compute';
  entity?: string;
  /** Any one of these entities is acceptable, when several framings are valid. */
  anyEntity?: string[];
  agg?: string;
  mustFilter?: FilterExpectation[];
  clarification?: boolean;
  clarificationOrFailure?: boolean;
}

interface Scenario {
  name: string;
  utterance: string;
  language: 'en' | 'he' | 'es';
  why?: string;
  expect: Expectation;
}

interface Attempt {
  passed: boolean;
  problems: string[];
  promptTokens: number;
  repaired: boolean;
  durationMs: number;
  rows?: number;
}

// ============================================================================
// Assertions
// ============================================================================

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Flatten nested and/or/not predicates so order and grouping don't matter. */
function flattenPredicates(predicates: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  const walk = (list: unknown[]) => {
    for (const item of list) {
      if (!isObject(item)) continue;
      if (Array.isArray(item.and)) walk(item.and);
      else if (Array.isArray(item.or)) walk(item.or);
      else if (item.not) walk([item.not]);
      else out.push(item);
      // A relation predicate's inner filters belong to the related entity, but
      // for matching purposes we surface them too.
      if (Array.isArray(item.where)) walk(item.where);
    }
  };

  walk(predicates);
  return out;
}

function matchesFilter(actual: Record<string, unknown>, expected: FilterExpectation): boolean {
  if (actual.field !== expected.field) return false;
  if (expected.op && actual.op !== expected.op) return false;

  if (expected.semantic) {
    const candidates = Array.isArray(actual.value) ? actual.value : [actual.value];
    return candidates.some(
      (v) => isObject(v) && String(v.$semantic).toLowerCase() === expected.semantic!.toLowerCase()
    );
  }

  if (expected.dateAnchor) {
    const candidates = Array.isArray(actual.value) ? actual.value : [actual.value];
    return candidates.some((v) => isObject(v) && '$date' in v);
  }

  if (expected.value !== undefined) {
    return JSON.stringify(actual.value) === JSON.stringify(expected.value);
  }

  return true;
}

function assertPlan(plan: Plan, expect: Expectation): string[] {
  const problems: string[] = [];

  if (expect.clarification || expect.clarificationOrFailure) {
    problems.push('expected a clarifying question, but a plan was produced');
    return problems;
  }

  const steps = plan.steps ?? [];
  if (steps.length === 0) {
    problems.push('plan has no steps');
    return problems;
  }

  // Match against the step that concerns the expected entity, so a harmless
  // extra step does not fail an otherwise correct plan.
  const acceptable = expect.anyEntity ?? (expect.entity ? [expect.entity] : []);

  const step: Query =
    steps.find((s) => acceptable.includes(s.entity)) || steps[0];

  if (acceptable.length > 0 && !acceptable.includes(step.entity)) {
    problems.push(`entity: expected one of ${acceptable.join('/')}, got '${step.entity}'`);
  }

  if (expect.op && step.op !== expect.op) {
    problems.push(`op: expected '${expect.op}', got '${step.op}'`);
  }

  if (expect.agg) {
    const agg = (step as ComputeQuery).agg;
    if (!agg) problems.push(`expected an aggregate '${expect.agg}', got none`);
    else if (agg.fn !== expect.agg) {
      problems.push(`agg: expected '${expect.agg}', got '${agg.fn}'`);
    }
  }

  for (const expected of expect.mustFilter ?? []) {
    const actuals = flattenPredicates((step as FindQuery).where ?? []);
    if (!actuals.some((a) => matchesFilter(a, expected))) {
      problems.push(
        `missing filter ${JSON.stringify(expected)} — got ${JSON.stringify(actuals)}`
      );
    }
  }

  return problems;
}

// ============================================================================
// Runner
// ============================================================================

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}

async function pickUser(): Promise<string> {
  const explicit = arg('user');
  if (explicit) return explicit;

  const { data } = await supabaseServer.from('crm_contacts').select('user_id').limit(1000);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = (row as { user_id: string }).user_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) throw new Error('No accounts with contacts to evaluate against.');
  return ranked[0][0];
}

async function runOnce(scenario: Scenario, userId: string, execute: boolean): Promise<Attempt> {
  const started = Date.now();

  const outcome = await getBizQLPlanner().plan({
    message: scenario.utterance,
    userId,
    language: scenario.language,
    timezone: 'UTC',
  });

  const base = {
    promptTokens: outcome.diagnostics.promptTokens ?? 0,
    repaired: outcome.diagnostics.repairAttempted,
    durationMs: Date.now() - started,
  };

  // A refusal is the correct outcome for an out-of-scope request.
  if (!outcome.ok) {
    return scenario.expect.clarificationOrFailure
      ? { passed: true, problems: [], ...base }
      : { passed: false, problems: [`planning failed: ${outcome.error}`], ...base };
  }

  if (outcome.clarification) {
    const wanted = scenario.expect.clarification || scenario.expect.clarificationOrFailure;
    return wanted
      ? { passed: true, problems: [], ...base }
      : { passed: false, problems: ['asked for clarification instead of planning'], ...base };
  }

  const problems = assertPlan(outcome.plan!, scenario.expect);
  if (problems.length > 0) return { passed: false, problems, ...base };

  if (!execute) return { passed: true, problems: [], ...base };

  // Executing proves the plan compiles and is accepted by the database, which
  // plan-level assertions alone cannot show.
  try {
    let rows = 0;
    for (const step of outcome.plan!.steps) {
      const result = await runBusinessQuery(step, { userId, consumer: 'test' });
      if (result.op === 'find') rows += result.rows.length;
    }
    return { passed: true, problems: [], rows, ...base };
  } catch (err) {
    return {
      passed: false,
      problems: [`execution failed: ${(err as Error).message.split('\n').pop()?.trim()}`],
      ...base,
    };
  }
}

async function main() {
  const runs = Number(arg('runs') ?? 1);
  const execute = process.argv.includes('--execute');
  const asJson = process.argv.includes('--json');
  const filter = arg('filter');

  const file = path.join(process.cwd(), 'tests/business-os-chat/scenarios.json');
  const all = (JSON.parse(fs.readFileSync(file, 'utf8')).scenarios as Scenario[]) ?? [];
  const scenarios = filter ? all.filter((s) => s.name.includes(filter)) : all;

  const userId = await pickUser();

  if (!asJson) {
    console.log(`catalog ${CATALOG_VERSION}   user ${userId}`);
    console.log(`${scenarios.length} scenarios × ${runs} run(s)${execute ? ' (executing)' : ''}\n`);
  }

  const report: Array<{
    name: string;
    passes: number;
    runs: number;
    avgTokens: number;
    repairs: number;
    problems: string[];
  }> = [];

  for (const scenario of scenarios) {
    const attempts: Attempt[] = [];
    for (let i = 0; i < runs; i++) {
      attempts.push(await runOnce(scenario, userId, execute));
    }

    const passes = attempts.filter((a) => a.passed).length;
    const problems = [...new Set(attempts.flatMap((a) => a.problems))];
    const avgTokens = Math.round(
      attempts.reduce((sum, a) => sum + a.promptTokens, 0) / attempts.length
    );
    const repairs = attempts.filter((a) => a.repaired).length;

    report.push({ name: scenario.name, passes, runs, avgTokens, repairs, problems });

    if (!asJson) {
      // Flaky is called out separately from failing: they need different fixes.
      const mark = passes === runs ? '✓' : passes === 0 ? '✗' : '~';
      const rate = runs > 1 ? ` ${passes}/${runs}` : '';
      console.log(
        `${mark}${rate} ${scenario.name.padEnd(34)} ${String(avgTokens).padStart(5)} tok` +
          `${repairs ? `  ${repairs} repair(s)` : ''}`
      );
      for (const problem of problems) console.log(`      ${problem}`);
    }
  }

  const fullyPassing = report.filter((r) => r.passes === r.runs).length;
  const flaky = report.filter((r) => r.passes > 0 && r.passes < r.runs).length;
  const failing = report.filter((r) => r.passes === 0).length;
  const totalAttempts = report.reduce((s, r) => s + r.runs, 0);
  const totalPasses = report.reduce((s, r) => s + r.passes, 0);
  const avgTokens = Math.round(report.reduce((s, r) => s + r.avgTokens, 0) / (report.length || 1));

  if (asJson) {
    console.log(
      JSON.stringify(
        { catalogVersion: CATALOG_VERSION, fullyPassing, flaky, failing, avgTokens, report },
        null,
        2
      )
    );
  } else {
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`pass ${fullyPassing}   flaky ${flaky}   fail ${failing}   of ${report.length}`);
    console.log(
      `attempts ${totalPasses}/${totalAttempts} ` +
        `(${Math.round((totalPasses / totalAttempts) * 100)}%)   avg ${avgTokens} prompt tokens`
    );
    if (flaky > 0) {
      console.log(
        `\nflaky scenarios are non-deterministic, not broken — they need a schema, ` +
          `prompt or model change, not a new special case.`
      );
    }
  }

  process.exit(failing > 0 || flaky > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
