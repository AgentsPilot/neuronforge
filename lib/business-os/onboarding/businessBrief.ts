/**
 * What we need to know about a business before we can write about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A DECLARED CONTRACT AND NOT A PROMPT PARAGRAPH
 *
 * The interview used to collect everything needed to CONFIGURE the platform —
 * does it sell on a schedule, how does the money arrive, how many services —
 * and nothing needed to WRITE about it. Measured on a real account: `goals`,
 * `tools` and `pain_points` all came back `[]`, and the description stayed the
 * one sentence the owner typed. Every prompt downstream inherits that silence,
 * and the website's audience, goals and pain-point paragraphs resolved to empty
 * strings.
 *
 * The fix is not "ask more questions". It is to say exactly what we are trying
 * to end up holding, so the model can look at what the owner has already said,
 * see what is still missing, and ask for that and nothing else. One list, read
 * three times: by the question picker, by the answer reader, and by the tests.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE SIX
 *
 * Each one is something no other part of the platform can discover. Prices,
 * hours, service names and how the money arrives are all asked elsewhere or
 * owned by an editor — asking for them here would be a second, competing
 * source of the same fact. What is left is the material a stranger would need
 * to describe this business, and the material a page needs to be worth reading.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** First person or a team. Nothing else in the interview records this. */
export type BusinessVoice = 'individual' | 'team';

export interface BusinessBrief {
  /** Who this is for, in the owner's words. */
  audience: string[];
  /** What the client actually leaves with. */
  outcome: string[];
  /** Why this business rather than the next one. */
  differentiators: string[];
  /** Training, years, licences — what stands behind the claims. */
  credentials: string[];
  /** What usually stops someone buying, which is what copy has to answer. */
  objections: string[];
  /**
   * How the work actually runs, step by step, once somebody has said yes.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The one field here that is not about PERSUADING anybody, and it was the
   * largest hole in the interview.
   *
   * Nothing in onboarding asked it. The services question asked for "name,
   * duration (in minutes), and price" — the three things the services editor
   * already owns — so the only prose the platform ever held about what a
   * business DOES was the one sentence they typed at the start. The website's
   * How-It-Works section therefore had nothing to write from and was filled by
   * `journeySteps()`, which reads the BOOKING journey and produces "book a
   * time, get a confirmation, turn up": true of every business on the platform
   * and interesting about none of them.
   *
   * It also writes the draft services. "We start with a 20-minute call, then I
   * build a plan, then we meet weekly" is both the process section and the
   * description of three placeholder services, from one answer.
   * ───────────────────────────────────────────────────────────────────────────
   */
  delivery: string[];
  /** Whether the business speaks as "I" or as "we". */
  voice: BusinessVoice | null;
}

export const EMPTY_BRIEF: BusinessBrief = {
  audience: [],
  outcome: [],
  differentiators: [],
  credentials: [],
  objections: [],
  delivery: [],
  voice: null,
};

/** One thing we are trying to learn, and how to ask for it. */
export interface BriefField {
  key: Exclude<keyof BusinessBrief, 'voice'>;
  /** Given to the model as the definition of what counts as an answer. */
  meaning: string;
  /**
   * An EXAMPLE of a question, not the question.
   *
   * The model phrases its own, in the owner's language and referring to what
   * they actually said — "who are the gymnasts you work with?" beats "who is
   * your target audience?" every time. This is here to set the register.
   */
  example: string;
  /**
   * Why a page is worse without it. Given to the model so it can judge whether
   * what the owner already wrote covers this, rather than asking regardless.
   */
  earnsItsQuestion: string;
  /**
   * This field fills a whole SECTION, not a sentence — so it may not be retired.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The picker may declare a field obvious for a trade and skip it, which is
   * right for most of them: a salon asked what the client walks away with
   * answers "a better haircut", and the page loses a sentence it would not have
   * wanted.
   *
   * Two fields are not like that. `objections` IS the FAQ and `delivery` IS the
   * How-It-Works block. Retired, those sections do not get thinner — they get
   * written from nothing, which means from the booking flow, which is identical
   * for every business on the platform.
   *
   * Measured: on a tutoring account the picker retired `delivery` on its first
   * choice and never asked it. The published How-It-Works read "Initial
   * Consultation / Customized Learning Plan / Ongoing Support" — true of any
   * tutor anywhere, and written by us.
   *
   * So the cost is compared honestly. Skipping saves one turn; being skipped
   * costs a whole section of generic copy on a real business's website. The
   * model may still decline to ask when the story already answers it, which is
   * the case this was built for.
   * ───────────────────────────────────────────────────────────────────────────
   */
  feedsASection?: boolean;
}

/**
 * In the order they usually matter. The model may reorder, and will skip
 * anything the story already answers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY ONE OF THESE ASKS FOR A MEMORY AND NOT AN OPINION
 *
 * The first version of this list asked the owner to generalise about
 * themselves, and one of them handed them a menu. Measured, from a real
 * interview:
 *
 *   "Who usually comes to you for gymnastic training, are they beginners,
 *    experienced athletes, or those looking to try something new?"
 *   > all kind
 *
 * "all kind" is the correct answer to a menu. Offer three categories and the
 * honest reply is "all of them", which is true and tells a copywriter nothing.
 * The model wrote that menu because the example here WAS a menu: these strings
 * set the register it imitates, so a fault in one propagates to every question
 * every owner is asked.
 *
 * Three of the five had the same shape in different clothes:
 *
 *   · "What do you do differently from the other trainers nearby?" asks for
 *     the OUTPUT instead of the input. Owners answer "personal attention",
 *     "I really care", "quality service", which is precisely the copy this
 *     whole step exists to stop a page being written in.
 *   · "What do people usually worry about before they book?" asks them to
 *     theorise about other people's minds. They guess, and badly. They can
 *     recall perfectly: the last thing somebody actually asked them.
 *   · "after working with you for a few months" presupposes an ongoing
 *     relationship. To a photographer, a plumber, a solicitor drawing one
 *     will, the question is nonsense and gets a nonsense answer.
 *
 * So every example below asks for something the owner can REMEMBER: a client
 * they had, a sentence somebody said, a question somebody asked. Where an
 * opinion is unavoidable, it is attributed to the client ("what have clients
 * told you made them pick you") rather than to the owner, because people
 * repeat what they were told accurately and describe themselves in adjectives.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const BRIEF_FIELDS: BriefField[] = [
  {
    key: 'audience',
    meaning:
      'Who buys this, as a specific recent client rather than a category. ' +
      'A named situation is worth more than a demographic.',
    example: 'Think of someone you worked with recently: who were they, and what did they come to you for?',
    earnsItsQuestion:
      'Nothing else in the interview reveals who this is for, and copy written for everyone speaks to no one.',
  },
  {
    key: 'outcome',
    meaning:
      'What the client has, can do, or feels at the end that they could not before. ' +
      'Nothing about how long the work takes is assumed.',
    example: 'What is different for someone by the time you have finished with them?',
    earnsItsQuestion:
      'A page that lists what a business DOES without saying what the client GETS gives a visitor no reason to act.',
  },
  {
    key: 'differentiators',
    meaning:
      'Why this business got chosen over another, in the words the clients themselves used.',
    example: 'What have clients told you made them pick you?',
    earnsItsQuestion:
      'Without it every page in a trade reads the same, and the copy falls back to "professional" and "personalised".',
  },
  {
    key: 'credentials',
    meaning: 'Training, qualifications, years in the trade, notable clients or results.',
    example: 'How did you come to do this, and what is your background with it?',
    earnsItsQuestion:
      'A new business has no reviews. Credentials are the only honest proof it can show instead.',
  },
  {
    key: 'objections',
    feedsASection: true,
    meaning:
      'The doubt that has to be answered before somebody will book, as something they actually said.',
    example: 'What is the last thing someone asked you before they decided to go ahead?',
    earnsItsQuestion:
      'The FAQ and the reassurance in the copy exist to answer this; unasked, they answer nothing in particular.',
  },
  {
    key: 'delivery',
    feedsASection: true,
    meaning:
      'What actually happens, in order, from the moment somebody says yes. ' +
      'The steps of the work itself, not the steps of paying for it.',
    example: 'Walk me through what happens after someone decides to work with you: what comes first?',
    earnsItsQuestion:
      'Unasked, the How-It-Works section is written from the booking flow and says "pick a time, ' +
      'get a confirmation, turn up" for every business alike. It is also the only description the ' +
      'draft services will ever have.',
  },
];

/**
 * How many questions this is allowed to cost.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE PER FIELD, and the reason it is not fewer is worth recording.
 *
 * This was four. Five fields and a budget of four meant the LAST field in the
 * order below was never reached — not declined, never asked: the loop exits on
 * the count before the model is consulted again. Measured against a real
 * account, that field was always `objections`.
 *
 * Which is the one that feeds a whole SECTION rather than a sentence. The FAQ
 * is generated from a generic instruction — cover booking, pricing, what to
 * expect — and produces questions about parking. Told what actually stops
 * people buying, it answers those instead.
 *
 * Five is still a ceiling and rarely the cost: the model declines to ask about
 * anything the owner's description already covers, so a story written with any
 * care spends fewer. The cap exists to stop a conversation becoming a form,
 * not to ration the questions that have already proved worth asking.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MAX_FOLLOW_UPS = BRIEF_FIELDS.length;

/** The fields with nothing in them yet. */
export function missingFields(brief: BusinessBrief): BriefField[] {
  return BRIEF_FIELDS.filter(field => brief[field.key].length === 0);
}

/**
 * What may still be PUT TO THE OWNER — missing, and not already asked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SECOND CONDITION IS THE ONE THAT MATTERS, and it was missing.
 *
 * Reported from a real interview:
 *
 *   "Who usually comes to you for gymnastic training — are they beginners,
 *    experienced athletes, or those looking to try something new?"
 *   > all kind
 *   "Who do you usually train — are they beginners, advanced athletes, or
 *    people with specific fitness goals?"
 *
 * The reader records only what the words support; "all kind" supported nothing;
 * the field stayed empty; the picker chose it again. With a cap of five, a few
 * vague answers spend the whole interview on one question — and the owner is
 * being asked something they just answered, which reads as not listening.
 *
 * A question asked is a question spent. Whether it yielded anything is a
 * separate matter, and not one to put to the owner twice.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function fieldsStillToAsk(
  brief: BusinessBrief,
  alreadyAsked: Array<BriefField['key']> = []
): BriefField[] {
  return missingFields(brief).filter(field => !alreadyAsked.includes(field.key));
}

/**
 * Is there enough here to write a page at all?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FLOOR, NOT THE STOPPING POINT — and the difference cost a measurement to
 * see.
 *
 * This began as the interview's stop condition: once audience and outcome were
 * known, stop asking. Run against a real account it ended the step after two
 * questions and never reached "I only take 8 clients at a time", "I train in
 * their own gym rather than a studio", "12 years competing, national level".
 *
 * Which is exactly the material the complaint was about. A page written from
 * audience and outcome alone is accurate and reads like every other trainer in
 * the county; the differentiators and the credentials are what make it theirs.
 * Stopping early protected the owner from two questions and cost them that.
 *
 * So the interview runs to its cap and stops early only when the model has
 * nothing left worth asking. This predicate stays, for the readers who need to
 * know whether a brief is usable AT ALL — a site generated from a brief that
 * fails this is working from nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function isEnough(brief: BusinessBrief): boolean {
  return brief.audience.length > 0 && brief.outcome.length > 0;
}

/** Everything the owner said, in their own words, ready to be composed. */
export function briefHasAnything(brief: BusinessBrief): boolean {
  return BRIEF_FIELDS.some(field => brief[field.key].length > 0) || brief.voice !== null;
}

/**
 * The contract, rendered for a prompt.
 *
 * Both the question picker and the answer reader are given this, so neither can
 * drift from the other about what a field means.
 */
export function briefContract(): string {
  return BRIEF_FIELDS.map(
    field =>
      `- ${field.key}: ${field.meaning}\n` +
      `    why it matters: ${field.earnsItsQuestion}\n` +
      `    a question of this kind: "${field.example}"`
  ).join('\n');
}

/** What is already known, rendered for a prompt. */
export function briefSoFar(brief: BusinessBrief): string {
  const lines = BRIEF_FIELDS.filter(field => brief[field.key].length > 0).map(
    field => `- ${field.key}: ${brief[field.key].join('; ')}`
  );

  if (brief.voice) lines.push(`- voice: ${brief.voice}`);

  return lines.length ? lines.join('\n') : '(nothing yet)';
}

/**
 * Merge an answer into the brief without losing what was there.
 *
 * Values are appended and de-duplicated case-insensitively: a later answer
 * elaborating on an earlier one should add to it, and the same phrase said
 * twice should appear once.
 */
export function mergeIntoBrief(brief: BusinessBrief, incoming: Partial<BusinessBrief>): BusinessBrief {
  const merged: BusinessBrief = { ...brief, voice: incoming.voice ?? brief.voice };

  for (const field of BRIEF_FIELDS) {
    const added = (incoming[field.key] ?? []).map(value => value.trim()).filter(Boolean);
    if (!added.length) continue;

    const seen = new Set(merged[field.key].map(value => value.toLowerCase()));
    merged[field.key] = [
      ...merged[field.key],
      ...added.filter(value => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    ];
  }

  return merged;
}

/**
 * Strip the dash used as punctuation, keeping the one inside a word.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS CODE AND NOT A PROMPT RULE
 *
 * Both the question put to the owner and the description composed from their
 * answers are written by a model and shown verbatim in the chat. The prompt
 * forbade the em dash, and the model moved to a spaced hyphen: the rule changed
 * the character and not the habit. Asked a second time, it would find the en
 * dash.
 *
 * A dash in these two places is also doing something slightly dishonest — it
 * joins two half-thoughts without committing to how they relate, which is why
 * it is so easy to generate and so flat to read. A comma says the same thing
 * and reads as a sentence somebody wrote.
 *
 * Only a SPACED dash is punctuation. "a 20-minute call", "e-commerce" and
 * "full-time" must survive untouched, which is the whole reason this is a
 * narrow rule rather than a character class.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function withoutDashPunctuation(text: string): string {
  return text
    /* A dash between two clauses becomes the comma it was standing in for. */
    .replace(/\s+[—–-]\s+/g, ', ')
    /* One left dangling at the end, or before the question mark it belongs to. */
    .replace(/\s+[—–-]\s*([?!.,:;]|$)/g, '$1')
    /* The comma may now sit beside punctuation that already did its job. */
    .replace(/,\s*,+/g, ',')
    .replace(/,\s*([?!.:;])/g, '$1')
    .replace(/\s+,/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
