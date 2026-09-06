/**
 * Saved plans, end to end against the real database.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/bizql-saved-plan-e2e.ts
 *
 * READ-ONLY WITH RESPECT TO THE USER'S BUSINESS. It creates and deletes its own
 * saved-plan rows and nothing else: every write step is previewed with dryRun,
 * so no email is sent and no contact, invoice or task is touched.
 *
 * What it proves that unit tests cannot: that a plan survives a round trip
 * through jsonb, that re-resolving it hits the real compiler against real rows,
 * and that a stale plan is actually disabled in the database rather than just
 * throwing in memory.
 */

import { getBizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import { executeForEach } from '@/lib/business-os/bizql/mutate/ForEachExecutor';
import { getSavedPlanStore, SavedPlanStaleError } from '@/lib/business-os/bizql/saved/SavedPlanStore';
import { supabaseServer } from '@/lib/supabaseServer';
import type { ForEachQuery, Query, QueryRow } from '@/lib/business-os/bizql/types';

const UTTERANCE = 'find everyone who never filled in an intake form and send them the form';

const step = (n: string) => console.log(`\n${n}`);
const ok = (m: string) => console.log(`   ✓ ${m}`);
const bad = (m: string) => console.log(`   ✗ ${m}`);

async function main() {
  const { data } = await supabaseServer.from('crm_contacts').select('user_id').limit(1000);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = (row as { user_id: string }).user_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const userId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  console.log(`user ${userId}   (no email is sent; every write is previewed)`);

  const store = getSavedPlanStore();
  const created: string[] = [];

  try {
    // ---- 1. plan it, the way the chat would -------------------------------
    step('1. Plan the work');
    const outcome = await getBizQLPlanner().plan({
      message: UTTERANCE,
      userId,
      language: 'en',
      timezone: 'UTC',
    });

    if (!outcome.ok || !outcome.plan) {
      bad(`planning failed: ${outcome.error ?? outcome.clarification}`);
      return;
    }
    ok(`${outcome.plan.steps.length} steps`);

    // ---- 2. save --------------------------------------------------------
    step('2. Save it');
    const saved = await store.save({
      userId,
      name: `e2e intake chase ${Date.now()}`,
      utterance: UTTERANCE,
      steps: outcome.plan.steps as Query[],
      answerText: outcome.plan.answer?.text,
    });

    if (!saved) {
      bad('save returned null');
      return;
    }
    created.push(saved.id);
    ok(`saved ${saved.id}`);

    // The defining property, checked against what actually landed in jsonb.
    const serialised = JSON.stringify(saved.steps);
    const hasFrozenIds = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(serialised);
    hasFrozenIds
      ? bad('stored plan contains concrete row ids — it is a saved RESULT, not a saved plan')
      : ok('stored unresolved: no row ids in the persisted steps');

    // ---- 3. read it back --------------------------------------------------
    step('3. Read it back');
    const loaded = await store.get(userId, saved.id);
    loaded ? ok(`round-tripped, ${loaded.steps.length} steps`) : bad('could not load it back');
    if (!loaded) return;

    // ---- 4. re-validate against the live catalog --------------------------
    step('4. Re-validate against the LIVE catalog');
    const steps = await store.validateForRun(loaded);
    ok('still valid');

    // ---- 5. resolve who it applies to NOW ---------------------------------
    step('5. Resolve current targets');
    const reads = new Map<string, QueryRow[]>();
    for (const s of steps) {
      if (s.op === 'mutate' || s.op === 'for_each') continue;
      const result = await runBusinessQuery(s, { userId, consumer: 'test' });
      if (result.op === 'find') reads.set(s.id ?? '', result.rows);
    }
    for (const [id, rows] of reads) ok(`${id}: ${rows.length} row(s)`);

    // ---- 6. preview, performing nothing -----------------------------------
    step('6. Preview (dry run — nothing is sent)');
    for (const s of steps) {
      if (s.op !== 'for_each') continue;
      const fanOut = s as ForEachQuery;
      const rows = reads.get(fanOut.over) ?? [];

      const preview = await executeForEach(fanOut, rows, { userId, consumer: 'test' }, {
        planId: 'e2e-preview',
        dryRun: true,
        language: 'en',
      });

      ok(
        `would contact ${preview.attempted}: ${preview.items.map((i) => i.target ?? i.id).join(', ')}` +
          `   (applied=${preview.applied})`
      );

      if (preview.applied) bad('DRY RUN APPLIED SOMETHING — this must never happen');

      // Recipients, not rows: the executor dedupes by address.
      if (preview.attempted !== rows.length) {
        ok(`${rows.length} rows collapsed to ${preview.attempted} recipient(s) — preview shows recipients`);
      }
    }

    // ---- 7. a stale plan is disabled, not skipped -------------------------
    step('7. A plan that no longer validates is DISABLED with a reason');
    const stale = await store.save({
      userId,
      name: `e2e stale ${Date.now()}`,
      utterance: 'a plan referencing a field that does not exist',
      steps: [
        { id: 's1', op: 'find', entity: 'contacts', where: [{ field: 'no_such_field', op: 'eq', value: 1 }] },
      ] as unknown as Query[],
    });

    if (stale) {
      created.push(stale.id);
      try {
        await store.validateForRun(stale);
        bad('a stale plan validated — it would silently return zero rows forever');
      } catch (err) {
        if (!(err instanceof SavedPlanStaleError)) throw err;
        const after = await store.get(userId, stale.id);
        after?.is_active === false
          ? ok(`disabled in the database: "${after.disabled_reason?.slice(0, 80)}"`)
          : bad('threw, but the row is still active — the user would never be told');
      }
    }

    // ---- 8. listing -------------------------------------------------------
    step('8. List');
    const all = await store.list(userId);
    ok(`${all.length} saved plan(s) for this user`);
  } finally {
    console.log('\nCleaning up');
    for (const id of created) {
      const gone = await supabaseServer
        .from('business_chat_saved_plans')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      console.log(gone.error ? `   ✗ ${gone.error.message}` : `   ✓ removed ${id}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
