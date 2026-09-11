/**
 * Sending only the instructions a question could possibly use.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SAFE TO DO AT ALL
 *
 * The system prompt and tool schema are 6,371 tokens on EVERY call, repairs
 * included — 69% of what a question costs, against ~580 tokens of catalog.
 * About a fifth of that is the vocabulary of acting: naming a target, acting on
 * many rows, calling an action, performing a write.
 *
 * When no entity offered to a turn declares an action, none of that can be
 * used. A mutate step would have no action to name and validation would reject
 * it, so the model was being shown a capability it did not have and charged for
 * it on every call.
 *
 * The decision reads the same catalog the plan is validated against — it is not
 * a guess about what the user meant. These tests hold that line: the trim fires
 * only on scopes that genuinely cannot act, and the full shape is unchanged
 * everywhere else.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  PLANNER_SYSTEM_PROMPT,
  plannerSystemPrompt,
  buildPlanTool,
} from '../planner/planTool';

const props = (scope?: string[]) => {
  const tool = buildPlanTool(scope) as unknown as {
    function: { parameters: { properties: { steps: { items: { properties: Record<string, unknown> } } } } };
  };
  return tool.function.parameters.properties.steps.items.properties;
};

const ops = (scope?: string[]) => (props(scope).op as { enum: string[] }).enum;

const WRITE_ONLY = ['action', 'target', 'data', 'over', 'params', 'max'];

describe('the instructions', () => {
  it('are unchanged when an action is reachable', () => {
    // The plan cache keys on a hash of this. Anything but byte-equality here
    // would invalidate every stored plan and change behaviour everywhere.
    expect(plannerSystemPrompt({ actions: true })).toBe(PLANNER_SYSTEM_PROMPT);
  });

  it('drop the action rules when nothing can be acted on', () => {
    const readOnly = plannerSystemPrompt({ actions: false });

    expect(readOnly).not.toContain('12. Inferring the SUBJECT');
    expect(readOnly).not.toContain('13. ACTING ON MANY ROWS');
    expect(readOnly).not.toContain('16. SOME QUESTIONS ARE ANSWERED BY AN ACTION');
    expect(readOnly).not.toContain('17. WRITES');
  });

  it('keep every rule a read question can use', () => {
    const readOnly = plannerSystemPrompt({ actions: false });

    // Spot-checked across the whole span, not just the edges: a bad split would
    // most likely take a neighbour with it.
    for (const rule of [
      '1. Call emit_plan exactly once',
      '6. For anything relative in time',
      '8. Choose the op by what is being asked',
      '10. RANKING BY MONEY EARNED',
      '11. Derived fields',
      '14. WHEN THE ANSWER IS A RELATIONSHIP',
      '15. A QUESTION ABOUT CHANGE',
      'answer.text must be ONE short sentence',
      'USE THE CONVERSATION',
    ]) {
      expect(readOnly).toContain(rule);
    }
  });

  it('save about a quarter of themselves when trimmed', () => {
    // Not a target — a tripwire. If this stops saving anything, the split has
    // silently stopped working and the cost is back.
    const saved = PLANNER_SYSTEM_PROMPT.length - plannerSystemPrompt({ actions: false }).length;

    expect(saved).toBeGreaterThan(3000);
  });
});

describe('the tool schema', () => {
  it('offers the write vocabulary for an entity that has actions', () => {
    for (const key of WRITE_ONLY) {
      expect(Object.keys(props(['tasks']))).toContain(key);
    }
    expect(ops(['tasks'])).toContain('mutate');
  });

  it('omits it entirely for a scope that cannot act', () => {
    // `page_views` declares no actions: there is no verb to name.
    for (const key of WRITE_ONLY) {
      expect(Object.keys(props(['page_views']))).not.toContain(key);
    }
  });

  it('also removes the ops that could only have been rejected', () => {
    expect(ops(['page_views'])).toEqual(['find', 'compute', 'analyse']);
  });

  it('keeps everything a read needs', () => {
    for (const key of ['id', 'op', 'entity', 'where', 'select', 'include', 'order_by', 'limit', 'agg', 'group_by']) {
      expect(Object.keys(props(['page_views']))).toContain(key);
    }
  });

  it('is unchanged when the whole catalog is offered', () => {
    // The common case, and the one that must not regress.
    for (const key of WRITE_ONLY) {
      expect(Object.keys(props())).toContain(key);
    }
    expect(ops()).toEqual(['find', 'compute', 'mutate', 'for_each', 'analyse']);
  });

  it('is materially smaller when trimmed', () => {
    const full = JSON.stringify(buildPlanTool(['tasks'])).length;
    const trimmed = JSON.stringify(buildPlanTool(['page_views'])).length;

    expect(full - trimmed).toBeGreaterThan(3000);
  });
});
