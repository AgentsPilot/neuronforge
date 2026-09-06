/**
 * Fan-out planning test — the original scenario, end to end, DRY RUN ONLY.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/bizql-fanout-test.ts [userId]
 *
 * SAFE: every fan-out runs with dryRun, so no email is sent and nothing is
 * written. The point is to see whether the planner produces a correct
 * find → for_each plan, and whether the preview names the right people.
 */

import { getBizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import { executeForEach } from '@/lib/business-os/bizql/mutate/ForEachExecutor';
import { supabaseServer } from '@/lib/supabaseServer';
import type { ForEachQuery, FindQuery } from '@/lib/business-os/bizql/types';

const CASES: Array<{ q: string; lang: 'en' | 'he'; note: string }> = [
  {
    q: 'find everyone who never filled in an intake form and send them the form',
    lang: 'en',
    note: 'THE original scenario',
  },
  {
    q: 'מצא את כל אנשי הקשר שלא מילאו טופס קליטה ושלח להם אותו',
    lang: 'he',
    note: 'same, in Hebrew',
  },
  {
    q: 'email everyone who owes me money a payment reminder',
    lang: 'en',
    note: 'different filter, same shape',
  },
  {
    q: 'delete every contact who has no bookings',
    lang: 'en',
    note: 'must be REFUSED — delete is never bulk',
  },
];

async function main() {
  let userId = process.argv[2];
  if (!userId) {
    const { data } = await supabaseServer.from('crm_contacts').select('user_id').limit(1000);
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const id = (row as { user_id: string }).user_id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    userId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  console.log(`user ${userId}   (DRY RUN — nothing is sent)\n`);
  const planner = getBizQLPlanner();

  for (const testCase of CASES) {
    console.log('─'.repeat(76));
    console.log(`Q: "${testCase.q}"`);
    console.log(`   (${testCase.note})`);

    const outcome = await planner.plan({
      message: testCase.q,
      userId,
      language: testCase.lang,
      timezone: 'UTC',
    });

    if (!outcome.ok) {
      console.log(`   → REFUSED: ${outcome.error?.split('\n').pop()?.trim()}\n`);
      continue;
    }
    if (outcome.clarification) {
      console.log(`   → ASKED: "${outcome.clarification}"\n`);
      continue;
    }

    const steps = outcome.plan!.steps;
    console.log(`   plan: ${JSON.stringify(steps)}`);

    const fanOut = steps.find((s): s is ForEachQuery => s.op === 'for_each');
    if (!fanOut) {
      console.log('   → no fan-out proposed\n');
      continue;
    }

    const source = steps.find((s) => s.id === fanOut.over);
    if (!source || source.op !== 'find') {
      console.log(`   → INVALID: 'over' does not reference a find step\n`);
      continue;
    }

    try {
      const rows = await runBusinessQuery(source as FindQuery, { userId, consumer: 'test' });
      if (rows.op !== 'find') continue;

      const preview = await executeForEach(fanOut, rows.rows, { userId, consumer: 'test' }, {
        planId: 'dry-run',
        dryRun: true,
        language: testCase.lang,
      });

      console.log(`   → would contact ${preview.attempted}: ${preview.items
        .map((i) => i.target ?? i.id)
        .join(', ')}`);
      console.log(`   → applied=${preview.applied} (cap ${preview.cappedAt})`);
    } catch (err) {
      console.log(`   → BLOCKED: ${(err as Error).message.split('\n').pop()?.trim()}`);
    }
    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
