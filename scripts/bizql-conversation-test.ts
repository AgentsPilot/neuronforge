/**
 * Multi-turn conversation test — replays the exchange that exposed the gap.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/bizql-conversation-test.ts
 *
 * Read-only. Mirrors what the route does per turn: load context, plan, execute
 * reads, remember what was asked and shown.
 *
 * The failing transcript this reproduces:
 *
 *   "מצא איש קשר"        -> "which contact are you looking for?"
 *   "אופיר"               -> "what do you want to know about אופיר?"
 *   "הצג אותו"            -> "what do you mean by 'show him'?"
 *   "פתח את איש הקשר"     -> returned ALL contacts
 *
 * Every turn was planned in isolation, so the clarification loop never closed.
 */

import { getBizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import { renderAnswer } from '@/lib/business-os/bizql/render/AnswerRenderer';
import {
  getConversationMemory,
  type ConversationContext,
} from '@/lib/business-os/bizql/memory/ConversationMemory';
import { supabaseServer } from '@/lib/supabaseServer';

const CONVERSATIONS: Array<{ name: string; turns: string[]; lang: 'he' | 'en' }> = [
  {
    name: 'the reported Hebrew exchange',
    lang: 'he',
    turns: ['מצא איש קשר', 'אופיר', 'הצג אותו'],
  },
  {
    name: 'pronoun after a list',
    lang: 'en',
    turns: ['show me my unpaid invoices', 'who owns the first one?'],
  },
];

async function main() {
  const { data } = await supabaseServer.from('crm_contacts').select('user_id').limit(1000);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = (row as { user_id: string }).user_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const userId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const memory = getConversationMemory();
  const planner = getBizQLPlanner();

  for (const convo of CONVERSATIONS) {
    console.log('\n' + '='.repeat(76));
    console.log(convo.name);
    console.log('='.repeat(76));

    // Each conversation starts clean, as a new session would.
    await memory.clear(userId);

    for (const utterance of convo.turns) {
      const context = await memory.load(userId);
      console.log(`\n> ${utterance}`);

      const outcome = await planner.plan({
        message: utterance,
        userId,
        language: convo.lang,
        timezone: 'UTC',
        context,
      });

      const roll = (summary: string, extra: Partial<ConversationContext> = {}) =>
        memory.save(userId, {
          ...context,
          ...extra,
          turns: [...context.turns, { utterance, summary, at: new Date().toISOString() }],
        });

      if (!outcome.ok) {
        console.log(`  ✗ ${outcome.error?.split('\n').pop()?.trim()}`);
        continue;
      }

      if (outcome.clarification) {
        console.log(`  ? ${outcome.clarification}`);
        await roll(`asked: ${outcome.clarification}`, { pendingQuestion: outcome.clarification });
        continue;
      }

      const plan = outcome.plan!;
      console.log(`  plan: ${JSON.stringify(plan.steps).slice(0, 200)}`);

      try {
        const results = [];
        for (const step of plan.steps) {
          if (step.op === 'mutate' || step.op === 'for_each') continue;
          results.push(await runBusinessQuery(step, { userId, consumer: 'test' }));
        }

        const answer = renderAnswer(plan.answer?.text, plan.steps, results, {
          language: convo.lang,
        });

        console.log(`  → ${answer.text}`);
        for (const row of answer.rows.slice(0, 4)) console.log(`      • ${row.label}`);
        if (answer.rows.length > 4) console.log(`      … ${answer.rows.length - 4} more`);

        const primary = results.find((r) => r.op === 'find');
        await roll(plan.steps.map((s) => `${s.op} ${s.entity}`).join(', '), {
          pendingQuestion: undefined,
          lastRows:
            primary?.op === 'find' && answer.rows.length > 0
              ? {
                  entity: primary.entity,
                  items: answer.rows.map((r) => ({ id: r.id, label: r.label })),
                  at: new Date().toISOString(),
                }
              : context.lastRows,
        });
      } catch (err) {
        console.log(`  ✗ execution: ${(err as Error).message.split('\n').pop()?.trim()}`);
      }
    }
  }

  await memory.clear(userId);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
