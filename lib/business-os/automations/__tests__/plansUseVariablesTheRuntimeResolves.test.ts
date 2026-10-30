/**
 * Every `{{token}}` in a committed plan names something the pilot can resolve.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS FOR
 *
 * All six plans used a BARE `{{stop_after_days}}` for the owner's stop rule.
 * `ExecutionContext.resolveVariable` splits a token on `.` and dispatches on
 * the ROOT: `input` / `inputs` read the values handed to `execute()`, `var`
 * reads set variables, `current` / `item` read the loop item, and anything else
 * is looked up as a step id. A bare `stop_after_days` matches none of those, so
 * it threw `VARIABLE_RESOLUTION_ERROR` on the find — the FIRST step of every
 * plan.
 *
 * Thirteen occurrences across six files, and nothing caught it:
 *
 *   • nothing had ever executed these plans — `planInputs` had no caller until
 *     the scheduler was built, so the token had never been resolved once;
 *   • the BizQL guard test checks the query grammar, not variable roots;
 *   • and a dry-run probe written for the occasion used its OWN resolver, which
 *     accepted the bare name. A permissive probe reported four recipients for a
 *     plan the real runtime could not start.
 *
 * It surfaced only on a real run against a real account. This test is the
 * cheaper version of that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT READS THE RUNTIME, NOT A LIST
 *
 * The accepted roots are parsed out of `ExecutionContext.ts` rather than typed
 * here. A list copied into a test is a list that goes stale the first time the
 * runtime gains or loses a root — and the whole failure above was two things
 * that had drifted apart while each looked correct alone.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PLANS_DIR = join(process.cwd(), 'lib/business-os/automations/agents');
const CONTEXT = join(process.cwd(), 'lib/pilot/ExecutionContext.ts');

/** The roots `ExecutionContext.resolveVariable` dispatches on, read from it. */
function rootsTheRuntimeResolves(): Set<string> {
  const src = readFileSync(CONTEXT, 'utf-8');
  const roots = new Set<string>();

  /* `if (root === 'input' || root === 'inputs')`, `root === 'var'`, etc. */
  for (const m of src.matchAll(/root === '([a-z_]+)'/g)) roots.add(m[1]);

  return roots;
}

/** Every `{{…}}` token in every committed plan, with the file it came from. */
function tokensInPlans(): { file: string; token: string; root: string }[] {
  const out: { file: string; token: string; root: string }[] = [];

  for (const file of readdirSync(PLANS_DIR).filter((f) => f.endsWith('.steps.json'))) {
    const raw = readFileSync(join(PLANS_DIR, file), 'utf-8');
    for (const m of raw.matchAll(/\{\{([^}]+)\}\}/g)) {
      const token = m[1].trim();
      out.push({ file, token, root: token.split('.')[0] });
    }
  }

  return out;
}

/** Step ids and scatter item variables a plan defines for itself. */
function namesEachPlanDefines(file: string): Set<string> {
  const plan = JSON.parse(readFileSync(join(PLANS_DIR, file), 'utf-8')) as unknown[];
  const names = new Set<string>();

  const walk = (steps: unknown[]) => {
    for (const raw of steps) {
      const step = raw as Record<string, unknown>;
      for (const key of ['step_id', 'id', 'output_variable']) {
        if (typeof step[key] === 'string') names.add(step[key] as string);
      }
      const scatter = step.scatter as Record<string, unknown> | undefined;
      if (scatter) {
        if (typeof scatter.itemVariable === 'string') names.add(scatter.itemVariable);
        if (Array.isArray(scatter.steps)) walk(scatter.steps);
      }
    }
  };

  walk(plan);
  return names;
}

describe('the runtime is readable', () => {
  it('names the roots it dispatches on', () => {
    const roots = rootsTheRuntimeResolves();
    /* A guard on the guard: an empty set would pass everything below. */
    expect(roots.size).toBeGreaterThan(2);
    expect(roots).toContain('input');
  });

  it('finds tokens to check', () => {
    expect(tokensInPlans().length).toBeGreaterThan(10);
  });
});

describe('every plan token resolves', () => {
  it('uses only a runtime root or a name the plan itself defines', () => {
    const roots = rootsTheRuntimeResolves();
    const unresolvable: string[] = [];

    for (const { file, token, root } of tokensInPlans()) {
      if (roots.has(root)) continue;
      if (namesEachPlanDefines(file).has(root)) continue;
      unresolvable.push(`${file}: {{${token}}} — nothing resolves the root "${root}"`);
    }

    expect(unresolvable).toEqual([]);
  });

  it('reaches the owner stop rule through the inputs root', () => {
    /*
     * The specific regression. `planInputs` returns `{ stop_after_days }` and
     * the runner hands it to `execute()` as `inputValues`, which the pilot
     * exposes under `input` / `inputs` — so the token must be dotted. Named
     * explicitly as well as covered by the rule above, because this is the one
     * that shipped wrong in all six plans.
     */
    const stopTokens = tokensInPlans().filter((t) => t.token.includes('stop_after_days'));

    expect(stopTokens.length).toBeGreaterThan(0);
    for (const { file, token, root } of stopTokens) {
      expect(`${file}: ${token} (root "${root}")`).toBe(
        `${file}: input.stop_after_days (root "input")`
      );
    }
  });

  it('every plan spends the stop rule at least once', () => {
    /* An agent that ignores the owner's stop rule chases for ever. */
    for (const file of readdirSync(PLANS_DIR).filter((f) => f.endsWith('.steps.json'))) {
      const raw = readFileSync(join(PLANS_DIR, file), 'utf-8');
      expect(`${file} uses the stop rule: ${raw.includes('{{input.stop_after_days}}')}`).toBe(
        `${file} uses the stop rule: true`
      );
    }
  });
});
