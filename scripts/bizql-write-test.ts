/**
 * Write-path test: does the planner emit safe writes, and does confirmation gate them?
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/bizql-write-test.ts [userId]
 *
 * SAFE TO RUN: every write is dry-run only. Nothing is created, changed or
 * deleted. The point is to inspect what the planner PROPOSES and confirm the
 * guards fire, not to mutate a real business.
 */

import { getBizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { executeMutate, requiresConfirmation } from '@/lib/business-os/bizql/mutate/MutateExecutor';
import { supabaseServer } from '@/lib/supabaseServer';
import type { MutateQuery } from '@/lib/business-os/bizql/types';

const CASES: Array<{ q: string; lang: 'en' | 'he'; expect: string }> = [
  { q: 'add a contact called Dana Levi', lang: 'en', expect: 'create, no confirm needed' },
  { q: 'הוסף איש קשר בשם דנה לוי', lang: 'he', expect: 'same, in Hebrew' },
  { q: 'delete all my contacts', lang: 'en', expect: 'must NOT produce a blanket delete' },
  { q: 'change my contact Ofir\'s phone to 050-1234567', lang: 'en', expect: 'needs an id first' },
  { q: 'cancel my booking tomorrow', lang: 'en', expect: 'needs an id; must confirm' },
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

  console.log(`user ${userId}   (DRY RUN — nothing will be written)\n`);
  const planner = getBizQLPlanner();

  for (const testCase of CASES) {
    console.log('─'.repeat(74));
    console.log(`Q: "${testCase.q}"`);
    console.log(`   expecting: ${testCase.expect}`);

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
    const writes = steps.filter((s): s is MutateQuery => s.op === 'mutate');

    console.log(`   plan: ${JSON.stringify(steps)}`);

    if (writes.length === 0) {
      console.log('   → read-only plan (no write proposed)\n');
      continue;
    }

    for (const write of writes) {
      const gated = requiresConfirmation(write);
      try {
        const result = await executeMutate(
          write,
          { userId, consumer: 'test' },
          { dryRun: true, language: testCase.lang }
        );
        console.log(
          `   → would ${result.preview}  [${gated ? 'CONFIRM REQUIRED' : 'direct'}]  applied=${result.applied}`
        );
      } catch (err) {
        console.log(`   → BLOCKED: ${(err as Error).message.split('\n').pop()?.trim()}`);
      }
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
