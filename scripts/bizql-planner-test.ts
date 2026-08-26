/**
 * End-to-end planner test: natural language → plan → compile → real rows.
 *
 *   npx tsx scripts/bizql-planner-test.ts [userId]
 *
 * Every utterance below is deliberately phrased in a way that appears NOWHERE in
 * the codebase — no examples, no regexes, no prompt mappings. If these work, the
 * system generalises from the catalog rather than from memorised phrasings.
 *
 * Read-only.
 */

import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

interface Case {
  utterance: string;
  language: string;
  note?: string;
}

const CASES: Case[] = [
  // The two questions that were inexpressible in every previous version.
  { utterance: 'which clients have an open invoice over $100?', language: 'en' },
  { utterance: 'show me contacts who never filled in an intake form', language: 'en' },

  // Same questions, different languages — nothing language-specific was written.
  { utterance: 'מי חייב לי כסף?', language: 'he', note: 'who owes me money' },
  { utterance: '¿qué facturas están sin pagar?', language: 'es', note: 'unpaid invoices' },

  // Phrasings no regex in the old system covered.
  { utterance: 'anything on the calendar for the rest of this week?', language: 'en' },
  { utterance: 'how much money am I owed in total?', language: 'en' },
  { utterance: 'list my leads', language: 'en' },
  { utterance: 'show me my actual clients', language: 'en' },
  { utterance: 'כמה לקוחות יש לי?', language: 'he', note: 'how many clients do I have' },
  { utterance: 'which invoices are more than 500 shekels?', language: 'en' },

  // Should ask rather than guess.
  { utterance: 'update it', language: 'en', note: 'ambiguous — expect clarification' },
];

async function main() {
  const [{ getBizQLPlanner }, bizql, catalog] = await Promise.all([
    import('../lib/business-os/bizql/planner/Planner'),
    import('../lib/business-os/bizql'),
    import('../lib/business-os/catalog'),
  ]);
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

  console.log(`user ${userId}   catalog ${catalog.CATALOG_VERSION}\n`);

  const planner = getBizQLPlanner();
  let passed = 0;
  let totalPromptTokens = 0;

  for (const testCase of CASES) {
    console.log('═'.repeat(78));
    console.log(`"${testCase.utterance}"${testCase.note ? `   (${testCase.note})` : ''}`);
    console.log('═'.repeat(78));

    const outcome = await planner.plan({
      message: testCase.utterance,
      userId,
      language: testCase.language,
      timezone: 'Asia/Jerusalem',
    });

    totalPromptTokens += outcome.diagnostics.promptTokens ?? 0;

    if (!outcome.ok) {
      console.log(`✗ PLANNING FAILED: ${outcome.error}\n`);
      continue;
    }

    if (outcome.clarification) {
      console.log(`↺ clarification: "${outcome.clarification}"`);
      console.log(
        `   ${outcome.diagnostics.promptTokens} prompt tokens, ${outcome.diagnostics.durationMs}ms\n`
      );
      passed++;
      continue;
    }

    const plan = outcome.plan!;
    console.log(`plan: ${JSON.stringify(plan.steps)}`);
    console.log(`answer: "${plan.answer?.text ?? '(none)'}"`);
    console.log(
      `   ${outcome.diagnostics.promptTokens} prompt tokens, ` +
        `${outcome.diagnostics.durationMs}ms` +
        `${outcome.diagnostics.repairAttempted ? ', REPAIRED' : ''}`
    );

    // Execute it for real.
    try {
      for (const step of plan.steps) {
        const result = await bizql.runBusinessQuery(step, {
          userId,
          consumer: 'chat',
          timezone: 'Asia/Jerusalem',
        });

        if (result.op === 'find') {
          console.log(`   → ${result.rows.length} rows`);
          for (const row of result.rows.slice(0, 3)) {
            console.log(`      ${JSON.stringify(row).slice(0, 150)}`);
          }
        } else {
          console.log(
            `   → value=${result.value}` +
              (result.groups ? ` groups=${JSON.stringify(result.groups)}` : '')
          );
        }
      }
      passed++;
    } catch (err) {
      console.log(`   ✗ EXECUTION FAILED: ${(err as Error).message}`);
    }
    console.log();
  }

  console.log('═'.repeat(78));
  console.log(`${passed}/${CASES.length} produced a usable result`);
  console.log(
    `average prompt tokens: ${Math.round(totalPromptTokens / CASES.length)} ` +
      `(chat-v3 ≈ 2,900 · chat-v2 ≈ 20,000–30,000)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
