/**
 * Full-turn test: message → plan → compile → execute → rendered answer.
 *
 *   npx tsx scripts/bizql-e2e.ts [userId]
 *
 * Exercises exactly what the /api/business-os/chat-v4 route does, minus HTTP and
 * auth, so it can run without a dev server. Read-only.
 */

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

const CASES: Array<{ q: string; lang: 'en' | 'he' | 'es'; note?: string }> = [
  { q: 'which clients have an unpaid invoice over $100?', lang: 'en' },
  { q: 'show me contacts who never filled in an intake form', lang: 'en' },
  { q: 'מי חייב לי כסף?', lang: 'he', note: 'who owes me money' },
  { q: '¿cuánto me deben en total?', lang: 'es', note: 'how much am I owed in total' },
  { q: 'what is on my calendar this week?', lang: 'en' },
  { q: 'who are my clients?', lang: 'en', note: 'resolves via the pipeline label' },
  { q: 'update it', lang: 'en', note: 'ambiguous — should ask' },
];

async function main() {
  const { getBizQLPlanner } = await import('../lib/business-os/bizql/planner/Planner');
  const { runBusinessQuery } = await import('../lib/business-os/bizql');
  const { renderAnswer } = await import('../lib/business-os/bizql/render/AnswerRenderer');
  const { businessProfileRepository } = await import(
    '../lib/repositories/BusinessProfileRepository'
  );
  const { supabaseServer } = await import('../lib/supabaseServer');

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

  const profile = (await businessProfileRepository.findByUserId(userId)).data;
  const timezone = profile?.timezone ?? 'UTC';
  const currency = profile?.currency ?? 'USD';

  console.log(`user ${userId}  tz=${timezone}  currency=${currency}\n`);

  const planner = getBizQLPlanner();
  let ok = 0;
  let tokens = 0;

  for (const testCase of CASES) {
    console.log('─'.repeat(78));
    console.log(`Q: "${testCase.q}"${testCase.note ? `   (${testCase.note})` : ''}`);

    const started = Date.now();
    const outcome = await planner.plan({
      message: testCase.q,
      userId,
      language: testCase.lang,
      timezone,
    });
    tokens += outcome.diagnostics.promptTokens ?? 0;

    if (!outcome.ok) {
      console.log(`   ✗ ${outcome.error}\n`);
      continue;
    }

    if (outcome.clarification) {
      console.log(`A: ${outcome.clarification}   [asked instead of guessing]`);
      console.log(`   ${outcome.diagnostics.promptTokens} tok, ${Date.now() - started}ms\n`);
      ok++;
      continue;
    }

    try {
      const results = [];
      for (const step of outcome.plan!.steps) {
        results.push(await runBusinessQuery(step, { userId, timezone, consumer: 'chat' }));
      }

      const answer = renderAnswer(outcome.plan!.answer?.text, outcome.plan!.steps, results, {
        language: testCase.lang,
        currency,
        timezone,
      });

      console.log(`A: ${answer.text}`);
      for (const row of answer.rows.slice(0, 3)) {
        const summary = row.fields
          .slice(0, 4)
          .map((f) => `${f.label}=${f.value}`)
          .join('  ');
        console.log(`     • ${row.label}   ${summary}`);
      }
      if (answer.truncated) console.log('     (truncated)');
      if (answer.approximate) console.log('     (approximate)');
      console.log(
        `   ${outcome.diagnostics.promptTokens} tok, ${Date.now() - started}ms` +
          `${outcome.diagnostics.repairAttempted ? ', repaired' : ''}\n`
      );
      ok++;
    } catch (err) {
      console.log(`   ✗ execution: ${(err as Error).message.split('\n').pop()?.trim()}\n`);
    }
  }

  console.log('─'.repeat(78));
  console.log(`${ok}/${CASES.length} turns answered`);
  console.log(`average ${Math.round(tokens / CASES.length)} prompt tokens/turn`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
