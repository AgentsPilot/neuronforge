/**
 * Head-to-head: which model should plan the Business OS chat?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every contender is given the SAME system prompt, the SAME catalog, the SAME
 * tool schema and the SAME questions, through the SAME provider factory the
 * product uses — so a win here transfers to production as a config change
 * rather than a rewrite.
 *
 * Scored on the three things that actually matter, in order:
 *
 *   1. Does it emit a valid tool call at all? A model that answers in prose has
 *      failed completely — the plan is not parseable and the turn is dead.
 *   2. Does the plan pass `validatePlan`? That is the same gate production
 *      applies before anything executes.
 *   3. Is it the RIGHT plan? Checked against `cases.ts`, whose expectations
 *      encode bugs we have actually shipped.
 *
 * Cost and latency are reported but deliberately secondary: at these volumes
 * the spread between the cheapest and dearest option is cents per thousand
 * questions, while a wrong plan emails a client's phone number.
 *
 * Usage: npx tsx scripts/planner-bench/run.ts [--runs 3] [--only case-id]
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { renderCatalogForPrompt, renderUserVocabulary, guessRelevantEntities } from '@/lib/business-os/bizql/planner/catalogPrompt';
import { PLANNER_SYSTEM_PROMPT, buildPlanTool } from '@/lib/business-os/bizql/planner/planTool';
import { validatePlan, normalizePlan } from '@/lib/business-os/bizql/planner/validatePlan';
import { ProviderFactory, type ProviderName } from '@/lib/ai/providerFactory';
import { supabaseServer } from '@/lib/supabaseServer';
import { CASES, type PlanCase } from './cases';

/** Who is competing. Model ids are the ones the product would actually set. */
const CONTENDERS: Array<{ label: string; provider: ProviderName; model: string }> = [
  { label: 'gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini' },
];

const USER_ID = process.env.BENCH_USER_ID || '08456106-aa50-4810-b12c-7ca84102da31';

interface Outcome {
  contender: string;
  caseId: string;
  toolCall: boolean;
  valid: boolean;
  correct: boolean;
  why: string;
  ms: number;
  inTokens: number;
  outTokens: number;
  costUsd: number;
}

/** The same system message the Planner builds, for one case. */
async function buildMessages(testCase: PlanCase) {
  const guessed = guessRelevantEntities(testCase.message);
  const entities = guessed.length > 0 ? guessed : undefined;

  const catalogText = renderCatalogForPrompt({ entities, includeActions: true });
  const vocabulary = await renderUserVocabulary(USER_ID, supabaseServer, entities).catch(() => '');

  const system =
    `${PLANNER_SYSTEM_PROMPT}\n\nCATALOG\n${catalogText}` +
    (vocabulary ? `\n\nTHIS USER'S CONFIGURED VALUES\n${vocabulary}` : '');

  return {
    tool: buildPlanTool(entities),
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: `Answer in language: ${testCase.language}\n\nRequest: ${testCase.message}` },
    ],
  };
}

/** Pull the plan out of whichever shape the provider returned. */
function extractPlan(response: unknown): Record<string, unknown> | null {
  const choice = (response as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> })
    ?.choices?.[0];
  const args = choice?.message?.tool_calls?.[0]?.function?.arguments;

  if (typeof args === 'string') {
    try { return JSON.parse(args); } catch { return null; }
  }

  // Anthropic's provider converts to the OpenAI shape; if a provider ever
  // returns Claude's native blocks, read the tool_use input directly.
  const content = (response as { content?: Array<{ type?: string; input?: unknown }> })?.content;
  const toolUse = content?.find((b) => b.type === 'tool_use');
  return (toolUse?.input as Record<string, unknown>) ?? null;
}


/**
 * The planner's own coercion, mirrored.
 *
 * Kept deliberately small and local rather than exported from the Planner: the
 * point is that the benchmark and the product agree, and a copy that drifts is
 * worse than no copy. If this ever disagrees with `coerceSteps`, the benchmark
 * is lying and this is the first place to look.
 */
function coerceLikeProduction(raw: Record<string, unknown>): Record<string, unknown> {
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  let salvaged: unknown;

  const steps = rawSteps.filter((step) => {
    const s = step as Record<string, unknown> | null;
    if (!s || typeof s !== 'object') return false;
    if (typeof s.entity !== 'string' || !s.entity) {
      if (!salvaged && s.answer && typeof s.answer === 'object') salvaged = s.answer;
      return false;
    }
    return true;
  });

  return { steps, answer: raw.answer ?? salvaged };
}

function score(plan: Record<string, unknown>, testCase: PlanCase): { correct: boolean; why: string } {
  const steps = (plan.steps ?? []) as Array<Record<string, unknown>>;
  if (steps.length === 0) return { correct: false, why: 'no steps' };

  /*
   * A correct plan with no sentence is not a correct answer.
   *
   * The renderer falls back to "<entity>: <count>" when `answer.text` is
   * missing — which is how a question about revenue came back as "תשלומים: 2".
   * The plan was right; there was simply nothing to say it with.
   */
  const answerText = (plan.answer as { text?: unknown } | undefined)?.text;
  if (typeof answerText !== 'string' || !answerText.trim()) {
    return { correct: false, why: 'no answer sentence — renders as a bare count' };
  }

  const entities = steps.map((s) => String(s.entity));
  if (!entities.some((e) => testCase.expect.entity.includes(e))) {
    return { correct: false, why: `entity ${entities.join('/')} — wanted one of ${testCase.expect.entity.join('/')}` };
  }

  if (testCase.expect.op && !steps.some((s) => testCase.expect.op!.includes(s.op as never))) {
    return { correct: false, why: `op ${steps.map((s) => s.op).join('/')} — wanted ${testCase.expect.op.join('/')}` };
  }

  if (testCase.expect.aggFn) {
    const fns = steps.map((s) => (s.agg as { fn?: string } | undefined)?.fn).filter(Boolean);
    if (!fns.includes(testCase.expect.aggFn)) {
      return { correct: false, why: `agg ${fns.join('/') || 'none'} — wanted ${testCase.expect.aggFn}` };
    }
  }

  if (testCase.expect.whereField) {
    const used = JSON.stringify(steps.map((s) => s.where ?? []));
    if (!used.includes(testCase.expect.whereField)) {
      return { correct: false, why: `did not filter on ${testCase.expect.whereField}` };
    }
  }

  if (testCase.expect.forbidSendTo) {
    for (const step of steps) {
      if (step.action !== 'send') continue;
      const to = (step.params as { to?: unknown } | undefined)?.to;
      const field = to && typeof to === 'object' && '$item' in (to as Record<string, unknown>)
        ? String((to as Record<string, unknown>).$item) : '';
      if (testCase.expect.forbidSendTo.includes(field)) {
        return { correct: false, why: `addressed a send to "${field}" — cannot receive email` };
      }
    }
  }

  return { correct: true, why: '' };
}

async function runOne(
  contender: (typeof CONTENDERS)[number],
  testCase: PlanCase
): Promise<Outcome> {
  const { tool, messages } = await buildMessages(testCase);
  const started = Date.now();

  const base: Outcome = {
    contender: contender.label, caseId: testCase.id,
    toolCall: false, valid: false, correct: false, why: '',
    ms: 0, inTokens: 0, outTokens: 0, costUsd: 0,
  };

  try {
    const provider = ProviderFactory.getProvider(contender.provider);
    const response = await provider.chatCompletion(
      {
        model: contender.model,
        messages,
        tools: [tool],
        tool_choice: 'required',
        temperature: 0,
        max_tokens: 1200,
      } as never,
      { userId: USER_ID, feature: 'planner-bench', component: contender.label, sessionId: crypto.randomUUID() } as never
    );

    base.ms = Date.now() - started;

    const usage = (response as { usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } }).usage;
    base.inTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    base.outTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;

    const raw = extractPlan(response);
    if (!raw) { base.why = 'no tool call — answered in prose'; return base; }
    base.toolCall = true;

    /*
     * Judge what PRODUCTION would judge, not the raw arguments.
     *
     * The first version of this harness validated the model's output directly
     * and reported failures the product never sees: the planner coerces first —
     * dropping stray elements, salvaging a misplaced answer — and only then
     * validates. Measuring the stricter path made the current model look worse
     * than it is, which is the opposite of what a benchmark is for.
     */
    const plan = coerceLikeProduction(raw);
    normalizePlan(plan as never);

    const problems = validatePlan(plan as never, testCase.message);
    if (problems.length > 0) { base.why = `invalid: ${problems[0]}`; return base; }
    base.valid = true;

    const verdict = score(plan, testCase);
    base.correct = verdict.correct;
    base.why = verdict.why;
    return base;
  } catch (err) {
    base.ms = Date.now() - started;
    base.why = `error: ${err instanceof Error ? err.message.slice(0, 110) : String(err)}`;
    return base;
  }
}

(async () => {
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
  const cases = only ? CASES.filter((c) => c.id === only) : CASES;

  /*
   * Repeat every case.
   *
   * A single run measures luck. The first draft of this harness ran each case
   * once and gpt-4o-mini passed "who owes me money"; the next run, at
   * temperature 0, it failed the same case by writing a semantic term as a raw
   * value. Planning is not deterministic even at temperature 0, so what matters
   * is the PASS RATE — a model that is right four times in five is a different
   * proposition from one that is right every time, and one sample cannot tell
   * them apart.
   */
  const runsFlag = process.argv.indexOf('--runs');
  const runs = runsFlag >= 0 ? Number(process.argv[runsFlag + 1]) || 3 : 3;

  const results: Outcome[] = [];

  for (const contender of CONTENDERS) {
    for (const testCase of cases) {
      const attempts: Outcome[] = [];
      for (let i = 0; i < runs; i++) {
        attempts.push(await runOne(contender, testCase));
      }
      results.push(...attempts);

      const passed = attempts.filter((a) => a.correct).length;
      const mark = passed === runs ? '✓' : passed === 0 ? '✗' : '~';
      const avgMs = Math.round(attempts.reduce((a, r) => a + r.ms, 0) / runs);
      const firstWhy = attempts.find((a) => !a.correct)?.why ?? '';
      process.stdout.write(
        `RESULT ${mark} ${contender.label.padEnd(22)} ${testCase.id.padEnd(20)} ` +
        `${passed}/${runs} ${String(avgMs).padStart(6)}ms ` +
        (firstWhy ? `— ${firstWhy.slice(0, 96)}` : '') + '\n'
      );
    }
  }

  process.stdout.write('\nRESULT ══ SUMMARY ══\n');
  for (const contender of CONTENDERS) {
    const mine = results.filter((r) => r.contender === contender.label);
    const correct = mine.filter((r) => r.correct).length;
    const valid = mine.filter((r) => r.valid).length;
    const toolCalls = mine.filter((r) => r.toolCall).length;
    const avgMs = Math.round(mine.reduce((a, r) => a + r.ms, 0) / Math.max(1, mine.length));
    const avgIn = Math.round(mine.reduce((a, r) => a + r.inTokens, 0) / Math.max(1, mine.length));
    const cost = mine.reduce((a, r) => a + r.costUsd, 0);
    process.stdout.write(
      `RESULT ${contender.label.padEnd(22)} correct ${String(correct).padStart(2)}/${mine.length}  ` +
      `valid ${String(valid).padStart(2)}  toolcall ${String(toolCalls).padStart(2)}  ` +
      `avg ${String(avgMs).padStart(5)}ms  avg ${avgIn} in-tok\n`
    );
  }

  const failures = results.filter((r) => !r.correct);
  if (failures.length) {
    process.stdout.write('\nRESULT ══ WHY THEY FAILED ══\n');
    for (const f of failures) {
      const c = CASES.find((x) => x.id === f.caseId)!;
      process.stdout.write(`RESULT   ${f.contender} / ${f.caseId}: ${f.why}\n`);
      process.stdout.write(`RESULT       matters: ${c.because.slice(0, 120)}\n`);
    }
  }
})();
