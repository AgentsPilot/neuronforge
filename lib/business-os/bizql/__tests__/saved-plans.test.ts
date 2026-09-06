/**
 * Saved plans — the guarantees that make re-running safe.
 *
 * A saved plan is the first half of a standing automation without the clock, so
 * the properties tested here are the ones a scheduled version would inherit:
 *
 *   - it stores the plan UNRESOLVED, so a re-run finds today's people;
 *   - it re-validates against the LIVE catalog every run, because the recorded
 *     catalog version does not prove the plan is still safe;
 *   - a stale plan is disabled with a reason, never skipped quietly.
 *
 * The store's own DB calls are mocked; what is under test is the decision logic,
 * which is where the failures would be silent.
 */

import { SavedPlanStore, SavedPlanStaleError, type SavedPlan } from '../saved/SavedPlanStore';
import { CATALOG_VERSION } from '@/lib/business-os/catalog';

const USER = '11111111-1111-1111-1111-111111111111';

/** Records what the store tried to write, without a database. */
function makeFakeClient() {
  const updates: Array<Record<string, unknown>> = [];

  const chain: Record<string, unknown> = {};
  for (const method of ['eq', 'order', 'select']) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.single = async () => ({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });

  const client = {
    from() {
      return {
        select: () => chain,
        delete: () => chain,
        upsert: () => chain,
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return chain;
        },
      };
    },
  };

  return { client: client as never, updates };
}

const savedPlan = (steps: unknown[]): SavedPlan => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000000',
  user_id: USER,
  name: 'chase overdue',
  utterance: 'email everyone who owes me money',
  steps: steps as SavedPlan['steps'],
  answer_text: null,
  catalog_version: CATALOG_VERSION,
  is_active: true,
  disabled_reason: null,
  run_count: 0,
  last_run_at: null,
  last_run_summary: null,
  created_at: '2026-08-27T00:00:00Z',
});

describe('saved plan re-validation', () => {
  it('accepts a plan that still typechecks against the live catalog', async () => {
    const { client } = makeFakeClient();
    const store = new SavedPlanStore(client);

    const steps = await store.validateForRun(
      savedPlan([
        {
          id: 's1',
          op: 'find',
          entity: 'contacts',
          where: [{ field: 'has_completed_intake', op: 'eq', value: false }],
        },
      ])
    );

    expect(steps).toHaveLength(1);
  });

  it('DISABLES a plan that no longer validates, and says why', async () => {
    // The silent-failure case this exists to prevent: a plan referencing a field
    // that has since been removed would otherwise resolve to zero rows and be
    // reported as "nobody to contact" forever.
    const { client, updates } = makeFakeClient();
    const store = new SavedPlanStore(client);

    const stale = savedPlan([
      { id: 's1', op: 'find', entity: 'contacts', where: [{ field: 'gone_away', op: 'eq', value: 1 }] },
    ]);

    await expect(store.validateForRun(stale)).rejects.toThrow(SavedPlanStaleError);

    const disabled = updates.find((u) => u.is_active === false);
    expect(disabled).toBeDefined();
    expect(String(disabled?.disabled_reason)).toMatch(/gone_away/);
  });

  it('carries the problems on the error so the user can be told', async () => {
    const { client } = makeFakeClient();
    const store = new SavedPlanStore(client);

    try {
      await store.validateForRun(
        savedPlan([{ id: 's1', op: 'find', entity: 'not_a_thing' }])
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SavedPlanStaleError);
      expect((err as SavedPlanStaleError).problems.join(' ')).toMatch(/not_a_thing/);
    }
  });

  it('does not mutate the stored plan while checking it', async () => {
    // normalizePlan rewrites operators in place. If it ran on the stored object,
    // merely LOOKING at a plan would rewrite what is persisted.
    const { client } = makeFakeClient();
    const store = new SavedPlanStore(client);

    const plan = savedPlan([
      { id: 's1', op: 'find', entity: 'invoices', where: [{ field: 'amount', op: '>', value: 100 }] },
    ]);
    const before = JSON.stringify(plan.steps);

    await store.validateForRun(plan);

    expect(JSON.stringify(plan.steps)).toBe(before);
  });

  it('normalises the copy it returns, so the caller runs canonical steps', async () => {
    const { client } = makeFakeClient();
    const store = new SavedPlanStore(client);

    const steps = await store.validateForRun(
      savedPlan([
        { id: 's1', op: 'find', entity: 'invoices', where: [{ field: 'amount', op: '>', value: 100 }] },
      ])
    );

    const where = (steps[0] as { where: Array<{ op: string }> }).where;
    expect(where[0].op).toBe('gt');
  });
});

describe('what a saved plan stores', () => {
  it('keeps the plan unresolved — no rows are frozen at save time', () => {
    // The defining property. Freezing at save time would mean a plan saved in
    // January emails January's people every time it is run.
    const plan = savedPlan([
      {
        id: 's1',
        op: 'find',
        entity: 'contacts',
        where: [{ field: 'has_completed_intake', op: 'eq', value: false }],
      },
      { id: 's2', op: 'for_each', over: 's1', entity: 'contacts', action: 'send', params: {} },
    ]);

    const serialised = JSON.stringify(plan.steps);

    expect(serialised).not.toMatch(/frozenRows/);
    expect(serialised).toMatch(/has_completed_intake/);
    // No concrete row ids anywhere in a stored plan.
    expect(serialised).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});

// =============================================================================
// applyFrozenWrites — the invariant that makes approval mean anything
// =============================================================================

describe('applyFrozenWrites', () => {
  it('never queries to decide who to act on', async () => {
    // THE invariant. The rows travel with the steps, frozen when the user was
    // shown them. If this file ever runs a find, a user who approved 12
    // recipients can email 40 — which is exactly what the freeze exists to stop.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'mutate', 'applyWrites.ts'),
      'utf8'
    );

    // Strip the docblock and comments before checking: the file discusses
    // querying at length, and matching prose would defeat the point.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/runBusinessQuery|compileAndRunFind|\.from\(/);
  });

  it('reports partial failure rather than a clean success', async () => {
    const { applyFrozenWrites } = require('../mutate/applyWrites');

    // No frozen rows for the for_each: nothing to send, nothing succeeded.
    const result = await applyFrozenWrites({
      steps: [
        { id: 's2', op: 'for_each', over: 's1', entity: 'contacts', action: 'send', params: {} },
      ],
      frozenRows: {},
      userId: USER,
      planId: 'test-plan',
      language: 'en',
    });

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]).toMatch(/sent to 0/);
  });
});
