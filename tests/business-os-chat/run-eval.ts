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
import { executeMutate, requiresConfirmation } from '@/lib/business-os/bizql/mutate/MutateExecutor';
import {
  hasDescribedReferences,
  needsTargetResolution,
  resolveDescribedReferences,
  resolveMutateTarget,
  withResolvedTarget,
} from '@/lib/business-os/bizql/mutate/resolveTarget';
import { labelForRow } from '@/lib/business-os/bizql/render/AnswerRenderer';
import { MissingFieldsError } from '@/lib/business-os/bizql/types';
import { supabaseServer } from '@/lib/supabaseServer';
import type { Plan } from '@/lib/business-os/bizql/planner/Planner';
import type { ComputeQuery, FindQuery, MutateQuery, Query } from '@/lib/business-os/bizql/types';

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
  /** Match a relation predicate rather than a field one. */
  relation?: string;
  quantifier?: 'any' | 'none';
}

/**
 * What a WRITE should do — asserted on the execution outcome, not the plan.
 *
 * Every bug a human found in this chat lived below the plan: a title the planner
 * invented, a create that never asked for confirmation, a date written as an
 * object, an approval card naming a uuid. A correct-looking plan produced every
 * one of them, so plan-shape assertions could not have caught any of them.
 *
 * Nothing here ever writes. Mutations run with dryRun, which is also what the
 * route does to build its preview — so this exercises the real path.
 */
/** One concrete thing that can happen when a write is attempted. */
type WriteOutcome = 'asks_for' | 'confirms' | 'chooses' | 'refuses';

interface WriteExpectation {
  /**
   * asks_for — the write cannot proceed until the user supplies `fields`.
   * confirms — it is ready, and must be approved before anything happens.
   * chooses  — a named row matched none or several, so the user must pick.
   * refuses  — the write is rejected outright (bulk delete, unknown action).
   */
  /**
   * A list when several outcomes are correct. Pinning the worse one makes the
   * suite punish an improvement: "הוסף שירות חדש" is RIGHT to ask and acceptable
   * to confirm with the name shown — what is unacceptable is writing silently.
   */
  outcome: WriteOutcome | WriteOutcome[];
  /** asks_for: the catalog field keys the user must still supply. */
  fields?: string[];
  entity?: string;
  action?: string;
  /** confirms: must this be approved before it happens? */
  confirmRequired?: boolean;
  /** confirms: substrings that MUST appear on the approval card. */
  cardContains?: string[];
  /** confirms: substrings that must NOT appear (raw uuids, [object Object]). */
  cardExcludes?: string[];
}

interface Expectation {
  write?: WriteExpectation;
  op?: 'find' | 'compute';
  entity?: string;
  /** Any one of these entities is acceptable, when several framings are valid. */
  anyEntity?: string[];
  agg?: string;
  /**
   * The field a `compute` must group by.
   *
   * Without this a "revenue by service" scenario passes on a plain unsegmented
   * sum — the eval green, the answer a single number where the user asked for a
   * breakdown. A relation name ('service') requires grouping by a related
   * label rather than a raw id; 'sent_at:month' requires a time bucket.
   *
   * A list means any of them is correct. "how much did I invoice each month"
   * is answered equally well from when the invoice was sent or when it was
   * raised, and a suite that insists on one of two right answers teaches
   * people to ignore it.
   */
  groupBy?: string | string[];
  mustFilter?: FilterExpectation[];
  /**
   * Filters that must NOT appear.
   *
   * `mustFilter` alone cannot catch a plan that is right about everything it was
   * asked about and wrong about something extra. "מי חייב לי כסף?" carried the
   * required unpaid filter — so this suite passed it — and ALSO a bare
   * {relation:contact, quantifier:none}, which emptied the result. The user saw
   * "nobody owes you anything" while the eval reported green.
   */
  mustNotFilter?: FilterExpectation[];
  clarification?: boolean;
  clarificationOrFailure?: boolean;
  /**
   * The plan must RUN and report that a filter named something non-existent.
   *
   * Asserted after execution, not at plan time, because the planner has not seen
   * the data and cannot know that "Gregory Fenwick" is nobody. Demanding a
   * refusal from it would teach it to refuse real names too. Whether a name
   * matched is a fact only the database has, so this scenario forces execution
   * even when the suite is run without --execute.
   */
  unmatched?: boolean;
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
  if (expected.relation !== undefined) {
    if (actual.relation !== expected.relation) return false;
    if (expected.quantifier && actual.quantifier !== expected.quantifier) return false;
    return true;
  }

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

  // An `unmatched` scenario EXPECTS a plan — the check happens after it runs.
  if ((expect.clarification || expect.clarificationOrFailure) && !expect.unmatched) {
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

  if (expect.groupBy) {
    const accepted = Array.isArray(expect.groupBy) ? expect.groupBy : [expect.groupBy];
    const actual = (step as ComputeQuery).group_by;
    if (!actual) {
      problems.push(
        `expected group_by ${accepted.map(g => `'${g}'`).join(' or ')}, got none (unsegmented aggregate)`
      );
    } else if (!accepted.includes(actual)) {
      problems.push(
        `group_by: expected ${accepted.map(g => `'${g}'`).join(' or ')}, got '${actual}'`
      );
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

  for (const forbidden of expect.mustNotFilter ?? []) {
    const actuals = flattenPredicates((step as FindQuery).where ?? []);
    if (actuals.some((a) => matchesFilter(a, forbidden))) {
      problems.push(
        `forbidden filter ${JSON.stringify(forbidden)} present — got ${JSON.stringify(actuals)}`
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

/**
 * Run a write the way the route does — resolve, preview, never apply — and report
 * what the user would actually experience.
 *
 * SAFETY: every mutation runs with dryRun. Nothing is written, and the one path
 * that touches the database is the read used to resolve a named row.
 */
async function runWrite(
  plan: Plan,
  scenario: Scenario,
  userId: string
): Promise<{ outcome: WriteOutcome; detail: string; card?: string; step?: MutateQuery }> {
  const ctx = { userId, timezone: 'UTC', consumer: 'test' as const };

  const writes = plan.steps.filter((s): s is MutateQuery => s.op === 'mutate');
  if (writes.length === 0) {
    return { outcome: 'refuses', detail: 'plan contained no write step' };
  }

  for (const step of writes) {
    let current = step;
    let referenceNames: Record<string, string> | undefined;
    let targetName: string | undefined;

    if (hasDescribedReferences(current)) {
      const refs = await resolveDescribedReferences(current, ctx, scenario.language);
      if (refs.status !== 'resolved') {
        return { outcome: 'chooses', detail: `${refs.status} ${refs.entity} for ${refs.field}` };
      }
      current = { ...current, data: refs.data as MutateQuery['data'] };
      referenceNames = refs.labels;
    }

    if (needsTargetResolution(current)) {
      const target = await resolveMutateTarget(current, ctx);
      if (target.status !== 'resolved') {
        return { outcome: 'chooses', detail: `${target.status} ${current.entity}` };
      }
      targetName = labelForRow(current.entity, target.row, { language: scenario.language });
      current = withResolvedTarget(current, target.id);
    }

    const result = await executeMutate(current, ctx, {
      dryRun: true,
      language: scenario.language,
      utterance: scenario.utterance,
      targetName,
      referenceNames,
    });

    return {
      outcome: 'confirms',
      detail: `${current.entity}.${current.action}`,
      card: result.preview,
      step: current,
    };
  }

  return { outcome: 'refuses', detail: 'no write reached execution' };
}

/** Is `outcome` one of the outcomes this scenario accepts? */
function wantsOutcome(want: WriteExpectation | undefined, outcome: string): boolean {
  if (!want) return false;
  return Array.isArray(want.outcome) ? want.outcome.includes(outcome as never) : want.outcome === outcome;
}

function assertWrite(
  got: Awaited<ReturnType<typeof runWrite>>,
  want: WriteExpectation
): string[] {
  const problems: string[] = [];

  const acceptable: WriteOutcome[] = Array.isArray(want.outcome)
    ? want.outcome
    : [want.outcome];

  if (!acceptable.includes(got.outcome)) {
    problems.push(
      `outcome: expected ${acceptable.map((o) => `'${o}'`).join(' or ')}, ` +
        `got '${got.outcome}' (${got.detail})`
    );
    return problems;
  }

  // Card assertions only mean anything when it actually got as far as a card.
  if (got.outcome !== 'confirms') return problems;

  if (want.entity && got.step && got.step.entity !== want.entity) {
    problems.push(`entity: expected '${want.entity}', got '${got.step.entity}'`);
  }
  if (want.action && got.step && got.step.action !== want.action) {
    problems.push(`action: expected '${want.action}', got '${got.step.action}'`);
  }

  if (want.confirmRequired && got.step && !requiresConfirmation(got.step)) {
    problems.push(`'${got.step.entity}.${got.step.action}' would apply WITHOUT confirmation`);
  }

  for (const needle of want.cardContains ?? []) {
    if (!got.card?.includes(needle)) {
      problems.push(`approval card is missing '${needle}' — got: ${got.card}`);
    }
  }
  for (const needle of want.cardExcludes ?? []) {
    if (got.card?.includes(needle)) {
      problems.push(`approval card contains '${needle}' — got: ${got.card}`);
    }
  }

  return problems;
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

  const want = scenario.expect.write;

  // A refusal is the correct outcome for an out-of-scope request — and for a
  // write the plan layer already rejects, such as a bulk delete.
  if (!outcome.ok) {
    if (wantsOutcome(want, 'refuses')) return { passed: true, problems: [], ...base };
    return scenario.expect.clarificationOrFailure
      ? { passed: true, problems: [], ...base }
      : { passed: false, problems: [`planning failed: ${outcome.error}`], ...base };
  }

  if (outcome.clarification) {
    // The planner asking for the missing detail satisfies `asks_for` just as
    // well as the executor demanding it. Both reach the user as a question, and
    // pinning which layer produced it would make the suite brittle for no gain.
    if (wantsOutcome(want, 'asks_for')) return { passed: true, problems: [], ...base };

    const wanted = scenario.expect.clarification || scenario.expect.clarificationOrFailure;
    return wanted
      ? { passed: true, problems: [], ...base }
      : { passed: false, problems: ['asked for clarification instead of planning'], ...base };
  }

  // --- writes: assert what the USER would experience ------------------------
  if (want) {
    try {
      const got = await runWrite(outcome.plan!, scenario, userId);
      const problems = assertWrite(got, want);
      return { passed: problems.length === 0, problems, ...base };
    } catch (err) {
      const acceptable: WriteOutcome[] = Array.isArray(want.outcome)
        ? want.outcome
        : [want.outcome];

      if (err instanceof MissingFieldsError) {
        if (!acceptable.includes('asks_for')) {
          return {
            passed: false,
            problems: [
              `outcome: expected ${acceptable.map((o) => `'${o}'`).join(' or ')}, ` +
                `got 'asks_for' (${err.fields.join(', ')})`,
            ],
            ...base,
          };
        }
        const missing = (want.fields ?? []).filter((f) => !err.fields.includes(f));
        return missing.length === 0
          ? { passed: true, problems: [], ...base }
          : {
              passed: false,
              problems: [`should have asked for ${missing.join(', ')}; asked for ${err.fields.join(', ')}`],
              ...base,
            };
      }

      if (acceptable.includes('refuses')) return { passed: true, problems: [], ...base };

      return {
        passed: false,
        problems: [`write failed: ${(err as Error).message.split('\n').pop()?.trim()}`],
        ...base,
      };
    }
  }

  const problems = assertPlan(outcome.plan!, scenario.expect);
  if (problems.length > 0) return { passed: false, problems, ...base };

  if (scenario.expect.unmatched) {
    // Run it and require the "no such thing" signal. A number here — even 0 —
    // is the failure this scenario exists to catch.
    const seen: string[] = [];
    for (const step of outcome.plan!.steps) {
      if (step.op === 'mutate' || step.op === 'for_each') continue;
      try {
        const result = await runBusinessQuery(step, { userId, consumer: 'test' });
        for (const u of (result as { unmatched?: Array<{ value: string }> }).unmatched ?? []) {
          seen.push(u.value);
        }
      } catch {
        // A step that will not compile is a failure of this scenario, not a
        // reason to abort the whole suite — which is what an uncaught throw here
        // did, losing every result after it.
      }
    }

    return seen.length > 0
      ? { passed: true, problems: [], ...base }
      : {
          passed: false,
          problems: [
            'ran without reporting an unmatched filter — a wrong number would reach the user',
          ],
          ...base,
        };
  }

  if (!execute) return { passed: true, problems: [], ...base };

  // Executing proves the plan compiles and is accepted by the database, which
  // plan-level assertions alone cannot show.
  try {
    let rows = 0;
    for (const step of outcome.plan!.steps) {
      // Writes have their own executor and their own assertions above. Handing
      // one to the query compiler throws by design.
      if (step.op === 'mutate' || step.op === 'for_each') continue;
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
