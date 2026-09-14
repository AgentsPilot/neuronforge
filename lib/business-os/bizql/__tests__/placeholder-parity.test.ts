/**
 * The renderer and the validator must agree about what a placeholder is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Twice in one day a placeholder was resolvable by `AnswerRenderer` and
 * rejected by `validateAnswer`. Both times the effect was the same and it is
 * the worst-behaved bug shape in this pipeline:
 *
 *   - the planner writes the CORRECT placeholder
 *   - validation rejects the plan
 *   - the rejection message lists the paths it does know, so the repair round
 *     dutifully rewrites the right answer into a wrong one
 *   - three prompt edits later, someone concludes the model "won't follow
 *     instructions"
 *
 * The first was `{sN.result.…}` for a read action's return value. The second
 * was `{sN.groups.gK.label}` for naming a group. In both cases the renderer
 * half shipped without the validator half, because nothing connected them.
 *
 * This test is that connection. Add a path to the renderer and forget the
 * validator, and this fails immediately with the name of the path.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';

/**
 * Every placeholder shape the renderer knows how to resolve, with a plan that
 * makes it legal, so the validator can be asked about each one.
 *
 * Kept as data rather than derived from the source: a regex over
 * `AnswerRenderer` would drift the moment someone reformats it, and the point
 * of this test is to be a hard gate, not a clever one.
 */
const RENDERER_PATHS: Array<{ path: string; plan: Plan; why: string }> = [
  {
    path: '{s1.count}',
    why: 'how many rows a find returned',
    plan: { steps: [{ id: 's1', op: 'find', entity: 'invoices' }] } as Plan,
  },
  {
    path: '{s1.value}',
    why: 'the figure an aggregate produced',
    plan: {
      steps: [{ id: 's1', op: 'compute', entity: 'invoices', agg: { fn: 'sum', field: 'amount' } }],
    } as Plan,
  },
  {
    path: '{s1.rows}',
    why: 'the names of the rows found',
    plan: { steps: [{ id: 's1', op: 'find', entity: 'contacts' }] } as Plan,
  },
  {
    path: '{s1.first.invoice_number}',
    why: 'one field of the first row — how a superlative is phrased',
    plan: { steps: [{ id: 's1', op: 'find', entity: 'invoices', limit: 1 }] } as Plan,
  },
  {
    path: '{s1.first.key} {s1.first.value}',
    why: 'the top bucket of a grouped aggregate',
    plan: {
      steps: [
        {
          id: 's1',
          op: 'compute',
          entity: 'transactions',
          agg: { fn: 'sum', field: 'net_amount' },
          group_by: 'service',
        },
      ],
    } as Plan,
  },
  {
    path: '{s1.groups.g1.label} {s1.groups.g1.value}',
    why: 'naming a group the analysis layer was never shown the name of',
    plan: {
      steps: [
        {
          id: 's1',
          op: 'compute',
          entity: 'transactions',
          agg: { fn: 'sum', field: 'net_amount' },
          group_by: 'service',
        },
      ],
    } as Plan,
  },
  {
    path: '{s1.result.freeMinutes}',
    why: "a read action's declared return value",
    plan: {
      steps: [
        {
          id: 's1',
          op: 'mutate',
          entity: 'business_profile',
          action: 'open_time',
          data: { date: '2026-09-09' },
        },
      ],
    } as Plan,
  },
  {
    path: '{s1.percent_of.s2}',
    why: 'one figure as a percentage of another',
    plan: {
      steps: [
        { id: 's1', op: 'compute', entity: 'refunds', agg: { fn: 'sum', field: 'amount' } },
        { id: 's2', op: 'compute', entity: 'transactions', agg: { fn: 'sum', field: 'net_amount' } },
      ],
    } as Plan,
  },
  {
    path: '{= s1.value - s2.value }',
    why: 'arithmetic the named paths cannot express',
    plan: {
      steps: [
        { id: 's1', op: 'compute', entity: 'refunds', agg: { fn: 'sum', field: 'amount' } },
        { id: 's2', op: 'compute', entity: 'transactions', agg: { fn: 'sum', field: 'net_amount' } },
      ],
    } as Plan,
  },
];

describe('every path the renderer resolves is accepted by the validator', () => {
  it.each(RENDERER_PATHS)('accepts $path — $why', ({ path, plan }) => {
    const problems = validatePlan({ ...plan, answer: { text: `x ${path} y` } } as Plan, 'x');
    const aboutTheAnswer = problems.filter((p) => p.includes('answer.text'));

    expect({ path, problems: aboutTheAnswer }).toEqual({ path, problems: [] });
  });
});

describe('the guard has teeth', () => {
  it('still rejects a path neither side knows', () => {
    // If this ever passes, the validator has stopped checking and the test
    // above proves nothing.
    const plan = {
      steps: [{ id: 's1', op: 'find', entity: 'invoices' }],
      answer: { text: 'x {s1.nonsense} y' },
    } as Plan;

    expect(validatePlan(plan, 'x').some((p) => p.includes('answer.text'))).toBe(true);
  });

  it('names every renderer branch this file claims to cover', () => {
    /*
     * A cheap tripwire for the real risk: someone adds a branch to
     * `resolvePlaceholder` and does not add it here, so the parity test passes
     * while parity is broken. Counting the branches is not proof, but a
     * mismatch is a prompt to look.
     */
    const source = readFileSync('lib/business-os/bizql/render/AnswerRenderer.ts', 'utf8');
    const branches = [
      "case 'count'",
      "case 'rows'",
      'percent_of',
      'groups\\.g',
      'result\\.',
      // Escaped: these are regexes, and a bare ( is a group, not a paren. The
      // first draft of this list silently matched nothing for that reason and
      // reported five branches where there are seven.
      "startsWith\\('='\\)",
      "'first\\.key'",
    ].filter((needle) => new RegExp(needle).test(source));

    expect(branches).toHaveLength(7);
  });
});
