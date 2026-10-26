/**
 * What does the configuration inference actually read off a real interview?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This exists because the inference degrades SILENTLY by design: a failed call
 * returns no facts and the interview asks every question exactly as it did
 * before. Safe, and indistinguishable from a model that concluded nothing — so
 * four very different faults look identical from the chat window:
 *
 *   the call failed            no facts
 *   the model declined         no facts
 *   the quote did not verify   demoted to a proposal
 *   the confidence was low     demoted to a proposal
 *
 * It found the last one on its first run: a gym trainer who wrote "I book a
 * time with them" came back `implied`, which settles nothing, so the chat
 * asked him whether clients book a time with him.
 *
 * Run it against the transcript of any real conversation that behaved oddly.
 * Replace STORY and EXCHANGES with what the owner actually typed, verbatim,
 * misspellings included — a model that only reads tidy prose is a model that
 * fails on real owners.
 *
 *   npx tsx scripts/check-configuration-inference.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from 'path';

import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

import type { InferredFact } from '../lib/business-os/onboarding/configurationInference';

/*
 * Imported DYNAMICALLY, after dotenv has run.
 *
 * A static import would not do: imports are hoisted and all of them execute
 * before the first statement of this file, so `dotenv.config()` above would
 * run too late. The provider factory reaches `lib/supabaseServer` at module
 * load, which throws "supabaseUrl is required" on an unset env — which is
 * exactly how this script failed the first time it was run.
 */
const loadModules = async () => ({
  inference: await import('../lib/business-os/onboarding/configurationInference'),
  factory: (await import('../lib/ai/providerFactory')).getProviderFactory,
  resolveBosLlmSettings: (await import('../lib/business-os/llm/modelSettings')).resolveBosLlmSettings,
  withModelFallback: (await import('../lib/business-os/llm/modelFallback')).withModelFallback,
});

/** The gym trainer, verbatim, from a chat run on 2026-10-23. */
const STORY = "I'm a gym trainer working with kids to improve their stemina";

const EXCHANGES = [
  {
    question: 'What is your background in training kids?',
    answer: 'Trainer for the past 20 years with kids',
  },
  {
    question:
      'What have parents or guardians told you made them choose you over other gym trainers for their kids?',
    answer: 'better with kids',
  },
  {
    question: 'What is the last thing a parent asked you before signing their child up?',
    answer: 'to make sure their are safe',
  },
  {
    question:
      'Walk me through what happens in a typical training session with the kids from start to finish.',
    answer: 'I book a time with them, they arrive to the session and payment is initiated',
  },
];

const TRANSCRIPT = [STORY, ...EXCHANGES.map(exchange => exchange.answer)].join('\n');

/* The same assembly `readConfiguration` performs. */
const USER = (() => {
  const lines = [
    'Language: en',
    'What the owner wrote about their business:',
    STORY || '(nothing)',
  ];
  EXCHANGES.forEach((exchange, index) => {
    lines.push('', `Q${index + 1}: ${exchange.question}`, `A${index + 1}: ${exchange.answer}`);
  });
  return lines.join('\n');
})();

async function main() {
  const { inference, factory, resolveBosLlmSettings, withModelFallback } = await loadModules();
  const { configFact, configurationSystemPrompt, routeFact, verifyQuote } = inference;

  /*
   * THE REAL PROMPT AND THE REAL MODEL, never a copy of either.
   *
   * This script was first written with the prompt pasted in and a model name
   * chosen here. Both were wrong the same way: it would have measured a call
   * the chat never makes. Which model this gets is itself a finding — a name
   * the resolved provider does not serve 404s, `readConfiguration` catches it,
   * and the interview silently asks everything.
   */
  const settings = await resolveBosLlmSettings('onboarding', 'configuration_inference');
  console.log('--- settings as the chat resolves them ---');
  console.log(JSON.stringify(settings, null, 2));
  console.log(`\ntranscript: ${TRANSCRIPT.length} chars, ${EXCHANGES.length} answers\n`);

  const { result: response } = await withModelFallback(settings, (model: string) => {
    console.log(`  trying model: ${model}`);
    return factory().complete({
      model,
      messages: [
        { role: 'system', content: configurationSystemPrompt() },
        { role: 'user', content: USER },
      ],
      response_format: { type: 'json_object' },
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    });
  });

  const raw = (response as { content: string }).content;
  console.log('\n--- raw ---');
  console.log(raw);

  const parsed = JSON.parse(raw)?.facts;
  if (!Array.isArray(parsed)) {
    console.log('\nNo "facts" array came back. The interview would ask every question.');
    return;
  }

  const routeOf = (row: InferredFact): string =>
    configFact(row?.key)?.validate(row?.value)
      ? routeFact(row, {
          quoteVerified: typeof row?.quote === 'string' && verifyQuote(row.quote, TRANSCRIPT),
          declined: [],
        })
      : 'ask (value rejected)';

  console.log('\n--- per fact ---');
  for (const row of parsed) {
    const definition = typeof row?.key === 'string' ? configFact(row.key) : null;
    if (!definition) {
      console.log(`  ${row?.key}: UNKNOWN KEY, dropped`);
      continue;
    }

    const quoteOk = typeof row?.quote === 'string' && verifyQuote(row.quote, TRANSCRIPT);
    console.log(
      `  ${definition.key} = ${JSON.stringify(row?.value)}\n` +
        `    confidence: ${row?.confidence}\n` +
        `    quote:      ${JSON.stringify(row?.quote)}\n` +
        `    in words:   ${quoteOk ? 'YES' : 'NO, this is what demotes it'}\n` +
        `    route:      ${routeOf(row)}`
    );
  }

  const named = (wanted: string) =>
    parsed
      .filter((row: InferredFact) => routeOf(row) === wanted)
      .map((row: InferredFact) => row.key)
      .join(', ') || 'none';

  console.log('\n--- what the owner would experience ---');
  console.log(`  question skipped outright: ${named('apply')}`);
  console.log(`  conclusion put to them:    ${named('propose')}`);
  console.log('  asked cold:                every other question');
}

main().catch(error => {
  console.error('\nFAILED:', error?.message || error);
  console.error('\nThis is the failure the chat swallows: no facts, every question asked.');
  process.exit(1);
});
