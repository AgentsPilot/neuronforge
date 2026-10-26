/**
 * The whole onboarding conversation, end to end, with real answers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * The chat is meant to work out what a business needs in order to sell, rather
 * than asking everyone the same five setup questions. Whether it actually does
 * that cannot be seen from any one function's return value: it shows up in
 * WHICH QUESTIONS GET ASKED, and in what the plan says at the end. Testing it
 * by hand costs a signup, a chat and five minutes per change, and every
 * measurement so far has needed three or four runs to separate a real result
 * from model variance.
 *
 * So this drives the REAL manager through the REAL state machine with real
 * answers, and prints three things:
 *
 *   1. every question, in the order asked, with the answer given
 *   2. what the interview CONCLUDED, and whether each conclusion was applied,
 *      put to the owner, or dropped for want of evidence
 *   3. the plan the owner would see, and what the builder would act on
 *
 * Nothing is written to the database. The conversation stops at the plan,
 * which is the last screen before the owner presses the button.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO ANSWER THE QUESTIONS
 *
 * The interview chooses its own questions, so there is no fixed script to
 * follow. Answers are declared by WHAT IS BEING ASKED:
 *
 *   BRIEF[field]   the open questions about the business, keyed by the brief
 *                  field the interview decided to ask about
 *   CHOICES        the chip questions, where the answer is one of the options
 *                  the chat offers and must be given in its own words
 *
 * A question with no answer declared gets `FALLBACK`, which is a shrug. That
 * is deliberate: a question a real owner could not answer is exactly what this
 * script exists to find, and a shrug shows up in the output as such.
 *
 *   npx tsx scripts/onboarding-dry-run.ts
 *   npx tsx scripts/onboarding-dry-run.ts --runs=3     # model variance
 *   npx tsx scripts/onboarding-dry-run.ts --lang=he
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from 'path';

import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

/* Dynamic, after dotenv: a static import runs before it and the provider
   factory reaches supabaseServer at module load. */
const loadModules = async () => ({
  Manager: (await import('../lib/services/OnboardingConversationManager')).OnboardingConversationManager,
  inference: await import('../lib/business-os/onboarding/configurationInference'),
});

/* ─────────────────────────────── THE OWNER ──────────────────────────────── */

const BUSINESS_NAME = 'David KPMG';

const STORY =
  "I'm an ADHD coach helping kids with their day by day stragelling in school and socially";

/**
 * What this owner says to each open question, keyed by brief field.
 *
 * Written as a real person would type them: short, lower case, a typo left in.
 * A polished paragraph is not what the interview receives, and a model that
 * only works on polished paragraphs is not working.
 */
const BRIEF: Record<string, string> = {
  audience: 'kids 10 to 16, mostly boys, usually after the school calls the parents',
  outcome: 'they hand in homework on time and stop getting sent out of class',
  differentiators: 'they got my contact from a friend who I helped',
  credentials: 'I was a case manager in a school for 9 years, and I have ADHD myself',
  objections: 'the last mum was worried her son would refuse to come after one session',
  delivery: 'first session is with the parents alone, then I see the kid every week for an hour',
};

const FALLBACK = 'not sure what you mean';

/**
 * The chip answers, given in the chat's own words.
 *
 * These must match what the options actually say, because the readers are
 * deterministic word matchers rather than a model: a button press should not
 * cost a model call and should not be open to interpretation. Each is the
 * English option verbatim, so a reworded option shows up here as a fallback
 * rather than being silently misread.
 */
const CHOICES = {
  language: 'English',
  nameConfirm: "Yes, that's right",
  serviceCount: '3',
  scheduled: 'Clients book a time with me',
  collection: 'I collect the money myself: invoice, transfer or cash',
  intake: 'Yes, they fill in a form first',
  /* Multi-select: the chat sends the chosen options joined by commas. */
  acquisition: 'Build me a professional website',
} as const;

/* ──────────────────────────────── RUNNING ───────────────────────────────── */

const OWNER = {
  userId: '2f734ed5-3681-4049-880d-3de7b096bea3',
  groupId: '33333333-3333-4333-8333-333333333333',
};

interface Turn {
  step: string;
  question: string;
  answer: string;
  /** Set where the chat showed a conclusion before asking. */
  proposal?: string;
}

type Collected = {
  pendingBriefField?: string;
  pendingBriefQuestion?: string;
  askedBriefFields?: string[];
  inferredFacts?: Array<{ key: string; value: unknown; confidence: string; quote: string }>;
  businessDescription?: string;
  briefExchanges?: Array<{ answer: string }>;
  clientWorkflow?: { sells_scheduled?: boolean; services?: unknown[] };
  clientAcquisition?: { needs_website?: boolean; needs_channel_insights?: boolean };
  configuration?: Record<string, unknown>;
  servicesDraft?: unknown[];
};

/**
 * What to say next, given what the chat just asked.
 *
 * One function, so the whole answering policy is readable in one place and the
 * loop below stays a loop. Returns null when the conversation has reached the
 * plan and there is nothing left to answer.
 */
function answerFor(step: string, pending: string | undefined, data: Collected): string | null {
  /*
   * `pendingQuestion` FIRST, always.
   *
   * It is the finer-grained of the two: `currentStep` stays 'business_name'
   * while the pending question moves on to 'name_confirm'. Checking the step
   * first made the confirm branch unreachable, so this script answered the
   * confirmation with the name again, and again, twenty-four times.
   */
  if (pending === 'name_confirm') return CHOICES.nameConfirm;
  if (pending === 'name_again') return BUSINESS_NAME;
  if (pending === 'story_again') return STORY;

  if (step === 'business_name') return BUSINESS_NAME;
  if (step === 'business_story') return STORY;

  if (step === 'business_deepening') {
    const field = data.pendingBriefField;
    return (field && BRIEF[field]) || FALLBACK;
  }

  if (step === 'service_details') {
    if (pending === 'service_count') return CHOICES.serviceCount;
    if (pending === 'sell_collection') return CHOICES.collection;
    if (pending === 'intake') return CHOICES.intake;
    /* The scheduling question has no `pendingQuestion` of its own. */
    return CHOICES.scheduled;
  }

  if (step === 'client_acquisition') return CHOICES.acquisition;

  return null;
}

async function conversation(language: string) {
  const { Manager, inference } = await loadModules();
  const manager = new Manager();

  let state = {
    currentStep: 'business_name',
    collectedData: {},
    language,
    attributionGroupId: OWNER.groupId,
  } as never;

  const turns: Turn[] = [];
  /*
   * The name, not the language. Language is chosen on the page before the
   * manager is involved and arrives as `state.language`; the manager's first
   * step is already 'business_name'. Opening with "English" recorded the
   * business as being called English.
   */
  let reply = BUSINESS_NAME;

  /* The question currently on screen, which the next reply will answer. */
  let pendingText = 'What is your business called?';
  let pendingProposal: string | undefined;

  /*
   * Bounded above any real conversation. A bug that never advances the state
   * machine then shows as a long transcript rather than as a hung script.
   */
  for (let turn = 0; turn < 24; turn += 1) {
    const before = state as unknown as { currentStep: string; pendingQuestion?: string };
    const beforeStep = before.currentStep;

    const result = await manager.processUserMessage(OWNER, reply, state);
    state = result.updatedState as never;

    const after = state as unknown as {
      currentStep: string;
      pendingQuestion?: string;
      collectedData: Collected;
    };

    /*
     * The question the owner is now looking at. `response` is what the chat
     * said, which for a chip question includes any conclusion it put to them
     * first — the "you said X, so I take it Y" line — and that is worth
     * showing separately, because whether a conclusion was SHOWN is the
     * difference between the chat reading the interview and ignoring it.
     */
    const said = (result as { response?: string }).response || '';
    const [head, ...rest] = said.split('\n\n');
    const hasProposal = rest.length > 0;

    /*
     * The reply answers the question from the PREVIOUS turn, not the one that
     * just came back. Paired the other way round, the report read as though
     * he had answered "yes, that's right" to "tell me about the business" —
     * every answer one row below its question, which looks exactly like a
     * state machine feeding answers to the wrong questions. It was only ever
     * the report.
     */
    turns.push({ step: beforeStep, question: pendingText, proposal: pendingProposal, answer: reply });

    pendingText = hasProposal ? rest.join('\n\n') : head;
    pendingProposal = hasProposal ? head : undefined;

    if (after.currentStep === 'preview' || after.currentStep === 'building') break;

    const next = answerFor(after.currentStep, after.pendingQuestion, after.collectedData);
    if (next === null) break;

    /*
     * A harness that loops silently is worse than one that crashes: the first
     * version of this printed the same confirmation twenty-one times and the
     * repetition was the only clue. Three identical questions in a row means
     * the answer is not being understood, which is a finding either way.
     */
    const recent = turns.slice(-3);
    if (recent.length === 3 && recent.every(t => t.question === turns[turns.length - 1].question)) {
      console.log(`\n\x1b[31mSTUCK: "${turns[turns.length - 1].question}"`);
      console.log(`answered "${reply}" three times and the chat did not move on.\x1b[0m`);
      break;
    }

    reply = next;
  }

  return { turns, data: (state as unknown as { collectedData: Collected }).collectedData, inference };
}

/* ──────────────────────────────── REPORTING ─────────────────────────────── */

function report(
  turns: Turn[],
  data: Collected,
  inference: Awaited<ReturnType<typeof loadModules>>['inference']
) {
  console.log('\n═══ 1. THE CONVERSATION ═══\n');

  turns.forEach((turn, index) => {
    if (turn.proposal) console.log(`  ${' '.repeat(3)}\x1b[2m↳ ${turn.proposal}\x1b[0m`);
    console.log(`  ${index + 1}. ${turn.question}`);
    console.log(`     \x1b[2m> ${turn.answer}\x1b[0m`);
    if (turn.answer === FALLBACK) console.log('     \x1b[31m^ UNANSWERABLE: no answer was declared for this\x1b[0m');
    console.log('');
  });

  console.log('═══ 2. WHAT IT CONCLUDED FROM WHAT HE SAID ═══\n');

  const transcript = [
    data.businessDescription || '',
    ...(data.briefExchanges || []).map(exchange => exchange.answer),
  ].join('\n');

  const facts = data.inferredFacts || [];
  if (!facts.length) {
    console.log('  nothing. Every question was asked cold.\n');
  }

  for (const fact of facts) {
    const definition = inference.configFact(fact.key);
    const verified = inference.verifyQuote(fact.quote, transcript);
    const route = definition?.validate(fact.value)
      ? inference.routeFact(fact as never, { quoteVerified: verified, declined: [] })
      : 'dropped (value rejected)';

    const meaning =
      route === 'apply'
        ? 'SETTLED, the question was never asked'
        : route === 'propose'
          ? 'PUT TO HIM, with his words quoted'
          : 'asked outright';

    console.log(`  ${fact.key} = ${JSON.stringify(fact.value)}  [${fact.confidence}]`);
    console.log(`    his words: "${fact.quote}"`);
    console.log(`    in transcript: ${verified ? 'yes' : 'NO, so it was demoted'}`);
    console.log(`    ${meaning}\n`);
  }

  const skipped = (data.askedBriefFields || []).filter(
    key => !turns.some(turn => turn.question && BRIEF[key] === turn.answer)
  );
  console.log(`  brief fields retired without asking: ${skipped.join(', ') || 'none'}\n`);

  console.log('═══ 3. THE PLAN HE WOULD SEE ═══\n');

  const config = (data.configuration || {}) as {
    capabilities?: string[];
    payment_mode?: string;
    online_presence_mode?: string;
    vertical?: string;
    pipeline_stages?: unknown[];
  };

  console.log(`  trade:        ${config.vertical ?? '(none)'}`);
  console.log(`  capabilities: ${config.capabilities?.join(', ') ?? '(none)'}`);
  console.log(`  money:        ${config.payment_mode ?? '(none)'}`);
  console.log(`  presence:     ${config.online_presence_mode ?? '(none)'}`);
  console.log(`  pipeline:     ${config.pipeline_stages?.length ?? 0} stages`);

  const services = (data.clientWorkflow?.services || []) as Array<{
    name?: string;
    is_scheduled?: boolean;
    collection?: string;
  }>;
  console.log(`\n  services drafted: ${services.length}`);
  services.forEach(service => {
    console.log(
      `    - ${service.name ?? '(unnamed)'}` +
        `  scheduled: ${service.is_scheduled ?? '(unset)'}` +
        `  collection: ${service.collection ?? '(unset)'}`
    );
  });

  console.log(`\n  website:  ${data.clientAcquisition?.needs_website ?? '(unset)'}`);
  console.log(`  channels: ${data.clientAcquisition?.needs_channel_insights ?? '(unset)'}`);

  /*
   * The owner cards are what the build page shows as "only you can do this":
   * hours, a processor, invoice details. Derived the same way the page derives
   * them, from the answers rather than from prices the chat never collects.
   */
  const scheduled = services.length
    ? services.some(service => service.is_scheduled !== false)
    : data.clientWorkflow?.sells_scheduled !== false;
  const online = services.some(service => service.collection === 'online');
  const invoiced = services.some(service => service.collection && service.collection !== 'online');

  console.log('\n  what only he can finish:');
  console.log(`    set working hours:   ${scheduled ? 'YES' : 'no'}`);
  console.log(`    connect a processor: ${online ? 'YES' : 'no'}`);
  console.log(`    invoice details:     ${invoiced ? 'YES' : 'no'}`);
}

async function main() {
  const runs = Number(process.argv.find(arg => arg.startsWith('--runs='))?.split('=')[1] || 1);
  const language = process.argv.find(arg => arg.startsWith('--lang='))?.split('=')[1] || 'en';

  console.log(`\nbusiness: ${BUSINESS_NAME}`);
  console.log(`said:     ${JSON.stringify(STORY)}`);
  console.log(`language: ${language}${runs > 1 ? `   runs: ${runs}` : ''}`);

  for (let run = 1; run <= runs; run += 1) {
    if (runs > 1) console.log(`\n\n████ RUN ${run} OF ${runs} ████`);
    const { turns, data, inference } = await conversation(language);
    report(turns, data, inference);
  }
}

main().catch(error => {
  console.error('\nFAILED:', error?.message || error);
  process.exit(1);
});
