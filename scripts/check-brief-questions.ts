/**
 * What does the interview actually ask a real owner, and what does it skip?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The brief starts EMPTY and nothing reads the opening description into it, so
 * every field is listed to the model as missing — including whatever the owner
 * has just said. Two faults came out of that, both reported from live chats:
 *
 *   "I'm a ADHD coach helping adolescence with their day by day"
 *   > "Think of the last teenager you helped: what did they need from your
 *      ADHD coaching?"
 *
 * The audience was already answered, and naming the service inside the
 * question makes it circular: it can only be answered with what he just said.
 *
 * This drives the REAL manager through the real step, so what it prints is
 * what an owner would see. It is the counterpart to
 * `check-configuration-inference.ts`, which does the same for the facts read
 * at the END of the interview.
 *
 *   npx tsx scripts/check-brief-questions.ts
 *   npx tsx scripts/check-brief-questions.ts "I sell handmade candles online"
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from 'path';

import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

/* Dynamic, after dotenv: see check-configuration-inference.ts for why. */
const loadManager = async () =>
  (await import('../lib/services/OnboardingConversationManager')).OnboardingConversationManager;

/** A real account, so attribution and model settings resolve as they do live. */
const OWNER = {
  userId: '2f734ed5-3681-4049-880d-3de7b096bea3',
  groupId: '33333333-3333-4333-8333-333333333333',
};

/** Verbatim from a chat run on 2026-10-23, misspellings kept. */
const DEFAULT_STORY = "I'm a ADHD coach helping adolescence with their day by day";

/**
 * What the owner actually typed back, keyed by FIELD rather than by position.
 *
 * The interview chooses its own questions, so there is no fixed order to
 * script against: whichever field it asks, it gets the answer that owner gave
 * to that field. Anything it asks that is not here falls back to a shrug,
 * which is itself worth seeing — a question a real owner could not answer is
 * exactly what this script is for.
 */
const ANSWERS: Record<string, string> = {
  outcome: 'They feel the improvement in their stemina, self confidence etc',
  differentiators: 'Recommendation from their friends, expert in ADHD',
  credentials: 'many years in school as case manager for kids with ADHD',
  objections: 'Make sure they see a progress in school',
  audience: 'adolescents with ADHD, mostly 13 to 17',
  delivery: 'we meet, go over the week, set one goal for next week',
};

const words = (text: string) => text.trim().split(/\s+/).length;

/* A content word of theirs reappearing in the question: see the smell tests. */
const content = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter(word => word.length > 4)
  );

async function main() {
  const Manager = await loadManager();
  const story = process.argv[2] || DEFAULT_STORY;
  const manager = new Manager();

  console.log(`\nowner said: ${JSON.stringify(story)}\n`);

  let state = {
    currentStep: 'business_story',
    collectedData: { businessName: 'David KPMG' },
    language: 'en',
    attributionGroupId: OWNER.groupId,
    pendingQuestion: 'business_story',
  } as never;

  let reply = story;
  const asked: Array<{ field: string; question: string; answer: string }> = [];

  /*
   * Bounded well above the interview's own cap, so a bug that never ends the
   * step shows up as a long list rather than as a script that hangs.
   */
  for (let turn = 0; turn < 12; turn += 1) {
    const result = await manager.processUserMessage(OWNER, reply, state);
    state = result.updatedState as never;

    const data = (state as unknown as {
      currentStep: string;
      collectedData: { pendingBriefField?: string; pendingBriefQuestion?: string; askedBriefFields?: string[] };
    });

    if (data.currentStep !== 'business_deepening') break;

    const field = data.collectedData.pendingBriefField;
    const question = data.collectedData.pendingBriefQuestion;
    if (!field || !question) break;

    reply = ANSWERS[field] ?? 'not sure what you mean';
    asked.push({ field, question, answer: reply });
  }

  const finalData = (state as unknown as {
    collectedData: { askedBriefFields?: string[] };
  }).collectedData;

  console.log('--- every question it asked, in order ---');
  asked.forEach((row, index) => {
    const flags: string[] = [];
    if (words(row.question) > 15) flags.push(`padded (${words(row.question)} words)`);
    if (/\sand\s/i.test(row.question)) flags.push('two asks');
    const echoed = [...content(row.question)].filter(word => content(story).has(word));
    if (echoed.length) flags.push(`echoes "${echoed.join('", "')}"`);
    /*
     * The ADHD coach's complaint, as a check: a question with no anchor asks
     * for a summary, and the honest answer to one of those is a shrug.
     *
     * Only for the fields whose own EXAMPLE carries an anchor. Checked against
     * every field it reported three false positives in a row — "What is your
     * background in this?" is a fine question and anchors nothing, because
     * credentials and outcome are not moments. A smell test that cries wolf on
     * correct output is worse than no test: it trains you to skim the flags.
     */
    const ANCHORED_FIELDS = ['audience', 'objections', 'delivery'];
    if (ANCHORED_FIELDS.includes(row.field)) {
      const anchored = /\bfirst\b|\blast\b|\bthink of\b|\bwalk me through\b/i.test(row.question);
      if (!anchored) flags.push('NO ANCHOR: asks for a summary, not a moment');
    }

    console.log(`\n  ${index + 1}. [${row.field}] ${row.question}`);
    console.log(`     ${flags.length ? flags.join(' | ') : 'clean'}`);
  });

  const dead = (finalData.askedBriefFields ?? []).filter(key => !asked.some(row => row.field === key));
  console.log(`\n--- declared dead up front (never asked) ---`);
  console.log(`  ${dead.length ? dead.join(', ') : 'none'}`);
  console.log(`\n  asked ${asked.length}, skipped ${dead.length}`);
}

main().catch(error => {
  console.error('\nFAILED:', error?.message || error);
  process.exit(1);
});
