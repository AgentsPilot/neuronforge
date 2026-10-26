/**
 * What the business needs in order to sell, concluded from what it told us.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * After the interview the chat asked everyone the same five questions — how
 * many things you sell, do clients book, how do you take money, do they fill
 * anything in, do you want a website — regardless of what the owner had just
 * spent five minutes explaining. That is a wizard wearing a chat's clothes.
 *
 * The machinery to do better was already here and barely used:
 * `extractBusinessStory` has always returned `needs_booking` and
 * `needs_website`, `needs_booking` already skips the scheduling question, and
 * `needs_website` was inferred and then thrown away while the owner was asked
 * anyway.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A QUOTE, NOT A REASON. THIS IS THE LOAD-BEARING DECISION.
 *
 * Every fact carries the owner's OWN words, verbatim. Not a sentence the model
 * composed about why it believes something — nobody can check that, and a model
 * will write a confident one for a guess.
 *
 * A quote is a substring of what the owner actually typed, so it is verifiable
 * in code: `verifyQuote` looks for it in the transcript, and a fact whose quote
 * is not there is DROPPED. That check is the whole safety argument. It is what
 * makes `confidence` mean anything at all — a model will happily label a guess
 * `stated`, but it cannot quote words that were never said.
 *
 * `routeFact` therefore refuses to return `'apply'` for any fact that did not
 * verify, whatever its confidence claims. If that is ever relaxed because "the
 * model keeps paraphrasing", the honesty of this whole mechanism goes with it,
 * and what is left is a wizard that also guesses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO FACTS WE DELIBERATELY DO NOT CONCLUDE SILENTLY
 *
 * Both were argued, in the manager, before this file existed:
 *
 *   intake   "a question rather than an inference on purpose... guessing that
 *            from prose is the one place in this file where being wrong writes
 *            something a stranger has to fill in."
 *   money    "never INFERRED: nothing in the story tells us how the money
 *            arrives, and guessing it is how the reverted bug happened."
 *
 * Both are right, and neither is overruled here. Intake is PROPOSED — the owner
 * taps once, so nothing is written without them — which answers the objection
 * on its own terms. Money is still ASKED at every confidence, because that
 * objection is about the evidence, and no amount of mechanism creates evidence
 * that is not in the words.
 *
 * Those decisions live in `CONFIG_FACTS` below as data, in one readable table,
 * rather than as conditions buried in a 3,700 line file.
 *
 * @module lib/business-os/onboarding/configurationInference
 */

/** The configuration facts the interview can settle. */
export type ConfigFactKey =
  | 'needs_website'
  | 'sells_scheduled'
  | 'needs_intake'
  | 'service_count'
  | 'collection_method';

/**
 * How well the words support the fact.
 *
 *   stated   they said it
 *   implied  they said something that can only mean it
 *   guessed  reasoning from the trade, not from their words
 */
export type FactConfidence = 'stated' | 'implied' | 'guessed';

/** What to do with a fact once it has been read and verified. */
export type FactRoute = 'apply' | 'propose' | 'ask';

export interface InferredFact {
  key: ConfigFactKey;
  value: unknown;
  confidence: FactConfidence;
  /** The owner's own words, verbatim, in their language. */
  quote: string;
}

export interface ConfigFact {
  key: ConfigFactKey;
  /** Given to the model as the definition of the fact. */
  meaning: string;
  /** Given to the model, so it can weigh the cost of being wrong. */
  whatItSwitchesOn: string;
  /**
   * Who finds out if this is wrong.
   *
   * 'a stranger' is the line that decides between applying and proposing: a
   * wrong answer the owner sees costs them a moment on a screen they are
   * already reading; a wrong answer a CLIENT sees costs the owner's reputation.
   */
  whoSeesItIfWrong: 'nobody' | 'the owner' | 'a stranger';
  routing: Record<FactConfidence, FactRoute>;
  /** Rejects a value of the wrong shape before it reaches anything. */
  validate: (value: unknown) => boolean;
  /**
   * The shape of `value`, stated to the model in the contract.
   *
   * Measured, not precautionary. Asked about a gym trainer, the model returned
   *
   *     {"key": "collection_method", "value": "a card online", ...}
   *
   * which `validate` rejected — "a card online" is prose lifted straight out
   * of this fact's own `meaning`, where the options are written as a sentence.
   * The contract described the options to a reader and never said what a VALUE
   * may be, so the model wrote the only thing it had seen.
   *
   * Harmless for that one fact, because money is asked at every confidence.
   * Not harmless as a pattern: the same mistake on `service_count` or a
   * boolean is a conclusion silently dropped, and nothing in the chat says so.
   */
  valueShape: string;
}

/** The chat clamps a count here too; the two must not drift. */
export const INFERRED_SERVICE_COUNT_MAX = 40;

const isBool = (value: unknown) => typeof value === 'boolean';

export const CONFIG_FACTS: readonly ConfigFact[] = [
  {
    key: 'needs_website',
    meaning: 'Do they want a website built, or do they already have somewhere clients find them.',
    whatItSwitchesOn: 'Whether a website is generated as a draft for them to review.',
    /* A draft nobody published, shown on the plan screen with a Change link. */
    whoSeesItIfWrong: 'nobody',
    routing: { stated: 'apply', implied: 'propose', guessed: 'ask' },
    validate: isBool,
    valueShape: 'true or false',
  },
  {
    key: 'sells_scheduled',
    meaning:
      'Does a client pick a TIME for what this business sells. True for appointments, ' +
      'sessions, classes with a start time. False for products, recorded courses, ' +
      'anything bought and used whenever the client likes.',
    whatItSwitchesOn:
      'A calendar, working hours, a timezone, and whether publishing is blocked until they are set.',
    /* Loudly: `journeyReadiness` blocks publishing and says why. */
    whoSeesItIfWrong: 'the owner',
    routing: { stated: 'apply', implied: 'propose', guessed: 'ask' },
    validate: isBool,
    valueShape: 'true or false',
  },
  {
    key: 'needs_intake',
    meaning:
      'Does a client fill something in before they are seen. A form, health details, ' +
      'a questionnaire, consent, anything they complete in advance.',
    whatItSwitchesOn: 'A form generated and put in front of the business\'s own clients.',
    whoSeesItIfWrong: 'a stranger',
    /* Never applied, at any confidence. See the file header. */
    routing: { stated: 'propose', implied: 'propose', guessed: 'ask' },
    validate: isBool,
    valueShape: 'true or false',
  },
  {
    key: 'service_count',
    meaning: 'How many distinct things this business sells, as a whole number.',
    whatItSwitchesOn: 'How many draft services are created in their catalogue.',
    /* Rows they clean up by hand, one at a time. */
    whoSeesItIfWrong: 'the owner',
    routing: { stated: 'propose', implied: 'propose', guessed: 'ask' },
    validate: value =>
      typeof value === 'number'
      && Number.isInteger(value)
      && value >= 0
      && value <= INFERRED_SERVICE_COUNT_MAX,
    valueShape: `a whole number from 0 to ${INFERRED_SERVICE_COUNT_MAX}`,
  },
  {
    key: 'collection_method',
    meaning: 'How the money actually arrives: a card online, an invoice or transfer, or nothing.',
    whatItSwitchesOn: 'A Stripe identity check, or invoice paperwork, or neither.',
    whoSeesItIfWrong: 'the owner',
    /* Always asked. A description does not say how money arrives. */
    routing: { stated: 'ask', implied: 'ask', guessed: 'ask' },
    validate: value =>
      typeof value === 'string'
      && ['card_online', 'invoice', 'in_person', 'mixed', 'none'].includes(value),
    valueShape:
      "exactly one of these strings: 'card_online', 'invoice', 'in_person', 'mixed', 'none'",
  },
] as const;

const BY_KEY = new Map(CONFIG_FACTS.map(fact => [fact.key, fact]));

/** The fact definition for a key, or null for a key we do not recognise. */
export function configFact(key: string): ConfigFact | null {
  return BY_KEY.get(key as ConfigFactKey) ?? null;
}

/**
 * The contract, rendered for the prompt.
 *
 * One source for what the model is told and what the router enforces, for the
 * same reason `briefContract` exists: a prompt and a reader that describe the
 * same fields separately drift, and nothing fails when they do.
 */
export function configurationContract(): string {
  return CONFIG_FACTS.map(fact =>
    [
      `- ${fact.key}: ${fact.meaning}`,
      /* Before `meaning` is read as a menu of values. See `valueShape`. */
      `  value must be: ${fact.valueShape}`,
      `  what it switches on: ${fact.whatItSwitchesOn}`,
      `  if this is wrong, it is seen by: ${fact.whoSeesItIfWrong}`,
    ].join('\n')
  ).join('\n');
}

/**
 * The system prompt the inference is read with.
 *
 * Lives here, beside `CONFIG_FACTS` and `routeFact`, for the reason the
 * contract does: the prompt, the router and the validator describe one thing,
 * and a copy of the prompt kept anywhere else drifts from them silently. The
 * diagnostic script in `scripts/check-configuration-inference.ts` imports THIS
 * — it was first written with its own pasted copy, which is how a prompt and
 * the behaviour it is supposed to measure come apart.
 */
export function configurationSystemPrompt(): string {
  return [

  'You are reading a finished interview with a business owner, to work out what',
  'their account needs in order to sell what they sell.',
  '',
  'THE FACTS:',
  configurationContract(),
  '',
  'RULES:',
  '- Return a fact ONLY where their words support it. OMIT the key otherwise.',
  '  An omitted key means "ask them", which is a real and common answer and often',
  '  the most useful one. A full list is not the goal.',
  '- "quote" is their own words, VERBATIM, in the language they wrote in. Copy it',
  '  character for character from the text below. Never translate it, never tidy',
  '  it, never join two places into one quote. A quote you cannot copy exactly is',
  '  a fact you do not have: omit it.',
  /*
   * MEASURED. The gym trainer who wrote "I book a time with them, they
   * arrive to the session and payment is initiated" came back as
   *
   *     sells_scheduled: true, confidence: "implied"
   *
   * and `implied` does not settle anything, so the chat asked him "do
   * clients book a time with you?" one question later. He had just said so.
   *
   * The three words were defined and never demonstrated, and the model
   * read `stated` as needing the FACT'S OWN phrasing — as though he had to
   * say "clients book appointments" rather than describe himself doing it.
   * On that reading almost nothing is ever stated, `apply` never fires, and
   * every question gets asked exactly as it did before this existed.
   *
   * Describing the practice IS stating it. `implied` is for a real step of
   * reasoning past what they described, and the examples below are what
   * make that line hold.
   */
  '- "confidence" is about the WORDS, not about how sure you feel.',
  '    stated   their words describe it. This is the COMMON case, not a rare one.',
  '             "I book a time with them" STATES that clients pick a time: an owner',
  '             describing themselves doing the thing has stated the thing. Do not',
  '             hold out for the wording used in the fact above.',
  '    implied  one real step beyond what they described. "I run small group classes"',
  '             implies a start time without describing one.',
  '    guessed  you are reasoning from the trade rather than from their words',
  '- NEVER return collection_method unless the quote is about money ARRIVING: a',
  '  card, an invoice, a transfer, cash. What something costs is not how it is paid.',
  '- Keys and values in English exactly as listed, whatever language they wrote in.',
  '  None of this is shown to the owner.',
  '',
  'Return JSON: {"facts": [{"key": "...", "value": ..., "confidence": "...", "quote": "..."}]}',
    ].join('\n');
}

/**
 * Is this quote really the owner's words?
 *
 * Compared on letters and digits alone. Case, punctuation, quote marks and
 * runs of whitespace differ between what somebody typed and what a model copies
 * back, and none of those differences make a quote invented. Anything beyond
 * that — a reworded phrase, a translation, a sentence stitched from two places
 * — is not a quote, and the fact resting on it is dropped.
 */
export function verifyQuote(quote: string, transcript: string): boolean {
  const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  const needle = bare(quote);
  /* Too short to be evidence of anything. "I" appears in every transcript. */
  if (needle.length < 8) return false;

  return bare(transcript).includes(needle);
}

/**
 * What to do with one fact.
 *
 * `quoteVerified` is a separate argument rather than something this reads off
 * the fact, so that a caller cannot forget to check it: the signature does not
 * let you route a fact without having decided.
 */
export function routeFact(
  fact: InferredFact,
  options: { quoteVerified: boolean; declined: readonly ConfigFactKey[] }
): FactRoute {
  const definition = configFact(fact.key);

  /* A key we do not know, or a value of the wrong shape. */
  if (!definition || !definition.validate(fact.value)) return 'ask';

  /* Already put to them and turned down. Asking again is not a new question. */
  if (options.declined.includes(fact.key)) return 'ask';

  /*
   * NO QUOTE, NO CONCLUSION.
   *
   * A fact whose words are not in the transcript may still be put to the owner
   * — a proposal they can see and refuse is honest even when the reasoning is
   * thin — but it may never be applied over their head. See the file header:
   * this line is what makes `confidence` worth reading.
   */
  const route = definition.routing[fact.confidence] ?? 'ask';
  if (!options.quoteVerified && route === 'apply') return 'propose';

  return route;
}
