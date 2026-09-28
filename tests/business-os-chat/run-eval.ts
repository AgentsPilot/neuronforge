/**
 * Business OS chat — golden-set evaluation.
 *
 *   npm run eval:chat
 *   ... --runs=3          repeat every scenario N times (flakiness measurement)
 *   ... --user=<uuid>     evaluate against a specific account
 *   ... --filter=invoice  run only scenarios whose name contains this
 *   ... --execute         also run each plan against the database
 *   ... --json            emit a machine-readable report
 *   ... --no-cache        plan every scenario afresh, for a comparable measurement
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
 *
 * TWO KINDS OF SCENARIO
 *
 * One utterance, planned directly: cheap, and right for anything that needs no
 * history. A list of `turns`, posted at the real route: the only way to test what
 * one turn means in the light of the last one, which is where every bug found in
 * the week of 2026-09-24 lived. See `Scenario.turns`.
 *
 * Conversations need the module shim, which `npm run eval:chat` supplies. Run
 * this file directly without it and they report that, rather than failing
 * obscurely.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

import { getBizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import { CATALOG, CATALOG_VERSION } from '@/lib/business-os/catalog';
import { NextRequest } from 'next/server';
import { getConversationMemory } from '@/lib/business-os/bizql/memory/ConversationMemory';
import { getConfirmationStore } from '@/lib/business-os/bizql/mutate/ConfirmationStore';
import { executeMutate, requiresConfirmation } from '@/lib/business-os/bizql/mutate/MutateExecutor';
import { resolveWrites } from '@/lib/business-os/bizql/mutate/resolveWrites';
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

/** What the user got back, as a shape rather than as prose. */
type ResponseKind = 'answer' | 'clarification' | 'choice' | 'needs' | 'confirmation' | 'error';

interface TurnExpectation extends Expectation {
  /**
   * The SHAPE of the reply, when that is the thing under test.
   *
   * A question about "which one" is not a worse answer, it is a different
   * outcome, and half the bugs in a conversation are the wrong outcome rather
   * than the wrong plan: a request answered when it should have asked, or asked
   * when everything needed was already on screen.
   */
  responds?: ResponseKind;
  /**
   * Whether the fan-out's approval card names anybody.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS IS NOT COVERED BY `responds`.
   *
   * "send a happy new year email to all my active contacts" produced the right
   * two-step plan and parked the right kind of reply, so a scenario asserting
   * only `responds: 'confirmation'` passed twice. The card said "0 recipients":
   * the planner had filtered stage by a translated word instead of the value the
   * business has configured, so it matched none of five contacts. Green suite,
   * feature that does nothing.
   *
   * 'none' is a legitimate expectation — "remind everyone who has not paid" with
   * nobody unpaid is correctly zero. What must not pass silently is a scenario
   * that meant to reach people and reached none.
   *
   * Read off the rendered card rather than a count, because that is what the
   * user sees. The digit is what every language renders identically, which is
   * the one thing a three-language preview can be matched on.
   * ───────────────────────────────────────────────────────────────────────────
   */
  fanOut?: 'some' | 'none';
}

interface Scenario {
  name: string;
  language: 'en' | 'he' | 'es';
  why?: string;
  /** A single-turn scenario: planned directly, no conversation state. */
  utterance?: string;
  expect?: Expectation;
  /**
   * A CONVERSATION, posted at the real route in order.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS EXISTS, AND WHY IT GOES THROUGH THE ROUTE
   *
   * Every bug found in the chat during the week of 2026-09-24 was cross-turn: a
   * filter inherited from a question two turns back, a figure the assistant had
   * just reported used as a row value, a clarification whose answer was planned
   * as a fresh request. None of them could be expressed here, because a scenario
   * was one utterance with no history.
   *
   * The context those bugs live in is assembled by the route — `lastPlan`,
   * `lastRows`, `lastAnswer`, `pendingQuestion`, and the rules about which of
   * them survive. Rebuilding that here would be a second implementation of the
   * subtlest code in the system, and the two would drift; the first thing to
   * drift would be whichever rule the bug was about. So the turns are POSTED at
   * the real handler and the real memory, and this file asserts on the plan the
   * route reports back.
   *
   * WRITES. A turn may plan a write, and any action needing confirmation is
   * parked rather than performed — nothing happens unless a later turn says yes,
   * which no scenario here does. A LOW-RISK write applies immediately, so
   * `runConversation` fails loudly if it sees one rather than quietly changing
   * the fixture account's data.
   * ───────────────────────────────────────────────────────────────────────────
   */
  turns?: Array<{ say: string; expect: TurnExpectation }>;
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

  // The route's own resolver, not a copy of it. This used to be a duplicate of
  // that loop, which meant the harness could pass while the route behaved
  // differently — exactly the divergence an eval exists to catch.
  const resolution = await resolveWrites({
    steps: writes,
    ctx,
    language: scenario.language,
    currency: 'USD',
  });

  if (resolution.status === 'choice') {
    const where = resolution.slot.kind === 'reference' ? ` for ${resolution.slot.field}` : '';
    return { outcome: 'chooses', detail: `${resolution.kind} ${resolution.entity}${where}` };
  }

  for (const { step, targetName, referenceNames } of resolution.writes) {
    if (step.op !== 'mutate') continue;

    const result = await executeMutate(step, ctx, {
      dryRun: true,
      language: scenario.language,
      utterance: scenario.utterance,
      targetName,
      referenceNames,
    });

    return {
      outcome: 'confirms',
      detail: `${step.entity}.${step.action}`,
      card: result.preview,
      step,
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

async function runOnce(
  scenario: Scenario,
  userId: string,
  execute: boolean,
  skipCache = false
): Promise<Attempt> {
  const started = Date.now();
  const base0 = { promptTokens: 0, repaired: false, durationMs: 0 };

  // A scenario is one form or the other. Saying so here rather than in the JSON
  // means a malformed entry names itself instead of throwing on a missing field.
  if (scenario.utterance === undefined || scenario.expect === undefined) {
    return {
      passed: false,
      problems: ['scenario has neither `turns` nor an `utterance` + `expect` pair'],
      ...base0,
    };
  }

  const expect = scenario.expect;
  const utterance = scenario.utterance;

  const outcome = await getBizQLPlanner().plan({
    message: utterance,
    userId,
    language: scenario.language,
    timezone: 'UTC',
    skipCache,
  });

  const base = {
    promptTokens: outcome.diagnostics.promptTokens ?? 0,
    repaired: outcome.diagnostics.repairAttempted,
    durationMs: Date.now() - started,
  };

  const want = expect.write;

  // A refusal is the correct outcome for an out-of-scope request — and for a
  // write the plan layer already rejects, such as a bulk delete.
  if (!outcome.ok) {
    if (wantsOutcome(want, 'refuses')) return { passed: true, problems: [], ...base };
    return expect.clarificationOrFailure
      ? { passed: true, problems: [], ...base }
      : { passed: false, problems: [`planning failed: ${outcome.error}`], ...base };
  }

  if (outcome.clarification) {
    // The planner asking for the missing detail satisfies `asks_for` just as
    // well as the executor demanding it. Both reach the user as a question, and
    // pinning which layer produced it would make the suite brittle for no gain.
    if (wantsOutcome(want, 'asks_for')) return { passed: true, problems: [], ...base };

    const wanted = expect.clarification || expect.clarificationOrFailure;
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

  const problems = assertPlan(outcome.plan!, expect);
  if (problems.length > 0) return { passed: false, problems, ...base };

  if (expect.unmatched) {
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

// ============================================================================
// Conversations
// ============================================================================

/** The fields of a chat-v4 response this file reads. */
interface TurnResponse {
  success: boolean;
  answer?: { text: string; rows?: unknown[] };
  clarification?: string;
  choice?: { kind: string; entity: string; total: number; choiceId?: string };
  needs?: { entity: string; action: string; fields: Array<{ key: string; label: string }> };
  confirmation?: { id: string; preview: string[] };
  error?: string;
  debug?: { plan?: unknown };
}

function kindOf(payload: TurnResponse): ResponseKind {
  // Checked in the order the client branches, so the name here is the thing the
  // user actually saw rather than the first field that happens to be set.
  if (!payload.success) return 'error';
  if (payload.clarification) return 'clarification';
  if (payload.confirmation) return 'confirmation';
  if (payload.needs) return 'needs';
  if (payload.choice) return 'choice';
  return 'answer';
}

/** Did this plan CHANGE anything, as opposed to describing or parking a change? */
function plansAWrite(plan: unknown): boolean {
  const steps = ((plan as { steps?: unknown[] })?.steps ?? []) as Array<Record<string, unknown>>;

  return steps.some((step) => {
    if (step.op !== 'mutate') return step.op === 'for_each';
    const action = CATALOG.entities[String(step.entity)]?.actions?.[String(step.action)];
    return Boolean(action) && action!.risk !== 'read';
  });
}

function assertTurn(payload: TurnResponse, expect: TurnExpectation): string[] {
  const problems: string[] = [];
  const kind = kindOf(payload);

  if (expect.responds && kind !== expect.responds) {
    const detail =
      kind === 'error' ? ` (${payload.error})` : kind === 'clarification' ? ` ("${payload.clarification}")` : '';
    problems.push(`responded with '${kind}', expected '${expect.responds}'${detail}`);
  }

  if (expect.fanOut) {
    const preview = payload.confirmation?.preview ?? [];
    if (preview.length === 0) {
      problems.push(`expected a fan-out card naming '${expect.fanOut}' recipients, got no card`);
    } else {
      // "0 recipients" / "0 נמענים" / "0 destinatarios": the count leads the line
      // in all three, so the digit is the portable part.
      const empty = preview.some((line) => /(^|\s)0(\s|$)/.test(line));
      if (expect.fanOut === 'some' && empty) {
        problems.push(`the approval card names nobody: ${JSON.stringify(preview)}`);
      }
      if (expect.fanOut === 'none' && !empty) {
        problems.push(`expected nobody to match, card says: ${JSON.stringify(preview)}`);
      }
    }
  }

  // Plan-level assertions only when something was asked of the plan. A turn
  // testing only the SHAPE of the reply has nothing else to check.
  const wantsPlan =
    expect.op ||
    expect.entity ||
    expect.anyEntity ||
    expect.agg ||
    expect.groupBy ||
    expect.mustFilter ||
    expect.mustNotFilter;

  if (!wantsPlan) return problems;

  const plan = payload.debug?.plan;
  if (!plan) {
    /*
     * Name what actually happened.
     *
     * This branch first said "no plan in the response — set NODE_ENV" for every
     * case, which on the first real run blamed the environment for a turn whose
     * planning had genuinely failed three times over. A harness that misreports
     * its own findings is worse than one that finds nothing.
     */
    problems.push(
      kind === 'error'
        ? `the turn produced no plan: ${payload.error ?? 'planning failed'}`
        : kind === 'clarification'
          ? 'no plan to assert: the turn asked a question instead of planning'
          : 'no plan in the response — `debug` is only returned when NODE_ENV is development'
    );
    return problems;
  }

  /*
   * `debug.plan` is the STEPS ARRAY, not a Plan.
   *
   * The route sends `plan: plan?.steps` (route.ts), while `assertPlan` reads
   * `.steps` off a Plan. Passing one as the other made every conversation report
   * "plan has no steps" — a harness failure wearing the costume of a real
   * finding, which is the worst thing an eval can do.
   */
  const steps = Array.isArray(plan) ? plan : (plan as { steps?: unknown[] }).steps;

  return [...problems, ...assertPlan({ steps } as unknown as Plan, expect)];
}

/**
 * Post a scenario's turns at the real route, in order, and assert each one.
 *
 * Stops at the first failing turn: every turn after it is about a conversation
 * that did not happen, so its result would be noise rather than a second signal.
 */
async function runConversation(scenario: Scenario, userId: string): Promise<Attempt> {
  const started = Date.now();
  const base = { promptTokens: 0, repaired: false, durationMs: 0 };

  /*
   * Imported here rather than at the top of the file.
   *
   * The route pulls in `server-only` and `@/lib/auth`, neither of which resolves
   * outside the bundler, so a static import would break the single-turn mode for
   * everyone who runs this without the shim. See scripts/chat-probe/preload.cjs.
   */
  let POST: (request: NextRequest) => Promise<{ json: () => Promise<unknown> }>;
  try {
    ({ POST } = (await import('@/app/api/business-os/chat-v4/route')) as never);
  } catch (err) {
    return {
      passed: false,
      problems: [
        'could not load the chat route — conversations need the module shim: ' +
          'tsx --import ./scripts/env-preload.ts --require ./scripts/chat-probe/preload.cjs ' +
          `(${(err as Error).message})`,
      ],
      ...base,
      durationMs: Date.now() - started,
    };
  }

  // The stub reads this, so the route authenticates as the fixture account
  // through its real authorisation branch.
  process.env.CHAT_PROBE_USER_ID = userId;

  /*
   * The route returns `debug.plan` only in development, and the plan is what this
   * file asserts on. Set rather than required, so a scenario cannot fail for the
   * reason that an environment variable was not exported.
   *
   * `Object.assign` because `process.env.NODE_ENV` is typed read-only: assigning
   * it directly compiles under tsx, which strips types, and fails the project
   * typecheck. Worth avoiding a cast for.
   */
  if (!process.env.NODE_ENV) Object.assign(process.env, { NODE_ENV: 'development' });

  // A conversation starts from nothing, or the turn before it decides what this
  // one means — which is the whole subject of these scenarios.
  await getConversationMemory().clear(userId);
  await getConfirmationStore().clear(userId);

  const problems: string[] = [];

  for (const [index, turn] of (scenario.turns ?? []).entries()) {
    const response = await POST(
      new NextRequest('http://localhost/api/business-os/chat-v4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
        body: JSON.stringify({ message: turn.say, language: scenario.language }),
      })
    );

    const payload = (await response.json()) as TurnResponse;

    /*
     * A write that APPLIED, on an account this suite only has permission to read.
     *
     * Anything needing confirmation is parked and harmless. A low-risk action is
     * performed on the spot, so a scenario that reaches one is changing the
     * fixture's data every time the suite runs. Fail, and say which turn did it.
     */
    if (kindOf(payload) === 'answer' && plansAWrite(payload.debug?.plan)) {
      problems.push(
        `turn ${index + 1} ("${turn.say}") APPLIED a write. Scenarios must not change data — ` +
          'use a phrasing that parks for confirmation, or drop the turn.'
      );
      break;
    }

    const turnProblems = assertTurn(payload, turn.expect).map(
      (p) => `turn ${index + 1} ("${turn.say}"): ${p}`
    );

    if (turnProblems.length > 0) {
      problems.push(...turnProblems);
      break;
    }
  }

  // Nothing parked is left behind for the next scenario, or for a developer who
  // opens the chat afterwards and finds a question waiting from a test run.
  await getConfirmationStore().clear(userId);
  await getConversationMemory().clear(userId);

  return {
    passed: problems.length === 0,
    problems,
    ...base,
    durationMs: Date.now() - started,
  };
}

async function main() {
  const runs = Number(arg('runs') ?? 1);
  const execute = process.argv.includes('--execute');
  const asJson = process.argv.includes('--json');
  /*
   * Measure the PLANNER, not the cache.
   *
   * On a warm suite most scenarios are served from the plan cache and make no
   * model call, so a plain run says little about a planner change — and any
   * change to the prompt or tool schema invalidates the cache, making the next
   * run cold and incomparable with the last. Use this on both sides of a
   * before-and-after and the comparison holds.
   */
  const noCache = process.argv.includes('--no-cache');
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
      // A conversation goes through the route so it gets the real context; a
      // single utterance goes straight to the planner, which is cheaper and has
      // nothing to remember. Same report either way.
      attempts.push(
        scenario.turns?.length
          ? await runConversation(scenario, userId)
          : await runOnce(scenario, userId, execute, noCache)
      );
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

  /*
   * HOW MANY SCENARIOS NEVER REACHED THE MODEL.
   *
   * A scenario served from the plan cache reports zero prompt tokens. That is
   * correct and mirrors production, but it makes two runs incomparable when
   * anything between them invalidated the cache — a prompt edit, a tool-schema
   * edit, a catalog version bump — because the next run is cold and the one
   * before it was warm.
   *
   * It cost a wrong conclusion on 2026-09-26: a change looked like it broke four
   * scenarios when most of the difference was cache-warm against cache-cold.
   * Printed so the next person sees the shift instead of inferring from it.
   */
  const cached = report.filter((r) => r.avgTokens === 0 && r.runs > 0).length;

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
    console.log(`pass ${fullyPassing}   flaky ${flaky}   fail ${failing}   of ${report.length}` +
        (cached ? `   (${cached} served from the plan cache, so no model call)` : ''));
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
