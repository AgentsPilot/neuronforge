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
 * So every example below asks for something the owner can answer from what they
 * ALREADY KNOW, rather than something they must work out: who they help, what
 * they are asked, what people hesitate over.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND NOT, ANY LONGER, FROM ONE REMEMBERED CLIENT.
 *
 * Every example was at one point pinned to the last client: "the last person
 * who came to you", "why did your last client say they picked you". The
 * reasoning was that people repeat what they were told accurately and describe
 * themselves in adjectives, so an opinion was always attributed to a client.
 *
 * Reviewed out, on two grounds that the reasoning did not cover:
 *
 *   · it PRESUMES A PAST CLIENT. A business that has not opened yet cannot
 *     answer any of them, and that is a whole class of account this interview
 *     exists to serve;
 *   · owners mostly do not know why they were chosen. Asked anyway they answer
 *     how they were FOUND, or they invent a quote — which then becomes website
 *     copy attributed to a customer who never said it.
 *
 * The adjective risk the attribution was defending against is real and did not
 * go away. It is now held by the prompt rather than by the question: one
 * illustration from the owner's own work, no self-characterising, and a
 * follow-up when an answer arrives as a word like "professional".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND EVERY EXAMPLE ASKS FOR THE HALF ITS OWN SERVICE CANNOT ANSWER.
 *
 * The second fault class, measured on a trade whose output is physical. Two
 * pillars were answered by reading the owner's opening sentence back:
 *
 *   audience  "what did they need?"          > the service, verbatim
 *   outcome   "what is different for someone
 *              by the time you finish?"      > an emotion about the purchase
 *
 * Both questions were answerable WITHOUT thinking about a client, because for
 * that kind of work the need IS the service and what the client HAS at the end
 * is the service. The audience answer then became the audience: a page written
 * believing this business serves a job rather than a person.
 *
 * No wording of the same half fixes it, and no per-trade rule should: every
 * pillar has a half the service name cannot answer, and that is the half these
 * examples now ask for. The TRIGGER rather than the need. What the client can
 * now DO rather than what they now have. The first step of the work rather than
 * a summary of it.
 *
 * The register is set here in trade-neutral words on purpose. Targeting the
 * trade is the model's job, question by question, and it is told to do it: one
 * personalisation, plus one illustration drawn from the owner's own work so
 * they can see what kind of answer is wanted. One, never a list — a menu is
 * answered "all kind", which is where this comment began.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const BRIEF_FIELDS: BriefField[] = [
  {
    key: 'audience',
    meaning:
      'Who the business helps, and what usually brings those people to it. ' +
      'A named situation is worth more than a demographic. ' +
      /* The anti-circular clause, and the one the model is judged against: a
         service name is not an audience, however true it is. */
      'What leads them to get in touch, never the service they bought, and never ' +
      /* Measured on a live run: "they bring me due to my recommendations" is HOW
         they arrived, not what they needed. A channel belongs to attribution,
         which the dashboard already reports from the referrer, and as an
         audience it describes nobody. Named here because the recorder is what
         can refuse it. */
      'the channel they arrived through: a referral, an ad or a search is how they ' +
      'found the business, not why they needed it. ' +
      /* §5 pillar 1, "information to capture where relevant". Listed so the
         recorder knows these belong HERE rather than nowhere: the buyer and
         the recipient are different people in a whole class of businesses, and
         who the owner WANTS more of is a positioning fact we had no home for. */
      'Where they say so: who they would like more of, and whether the person ' +
      'getting in touch is the person being served.',
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE HISTORY OF THIS ONE QUESTION, because it has now been wrong three
     * ways and the next person deserves the whole list.
     *
     * 1. TWO ASKS. "…who were they, and what did they come to you for?" was
     *    answered, by the owner of this platform, with an age range and a
     *    referral source: neither half. "If I answered wrong everyone will do
     *    the same."
     * 2. THE SERVICE AS A VALID ANSWER. Narrowed to "what did they need?", a
     *    trade with a physical output answers with the service, verbatim, and
     *    that became the `audience`.
     * 3. IT PRESUMED A PAST CLIENT. Narrowed again to "what made your LAST
     *    client get in touch?", which a business that has not opened yet
     *    cannot answer at all, and which pins a whole audience to one person.
     *
     * The wording below is the reviewed recommendation, and it fixes (3) while
     * accepting a known risk on (1): it does join two halves. They are halves
     * of ONE topic — who, and why they come — which is not the "two unrelated
     * questions" case, and the guard in the test file carries a named exception
     * for this field alone so the protection still covers the other five.
     *
     * If answers start coming back as half the question again, that is the
     * failure recurring: split it, ask "who do you help most often?" and leave
     * the trigger to the follow-up.
     * ───────────────────────────────────────────────────────────────────────
     */
    example: 'Who do you help most often, and what usually brings them to you? (e.g. a burst pipe)',
    earnsItsQuestion:
      'Nothing else in the interview reveals who this is for, and copy written for everyone speaks to no one.',
  },
  {
    key: 'outcome',
    meaning:
      /* BETTER, in any of the ways a business can make something better. The
         earlier wording said "can DO", which reads as a capability gained and
         is nonsense for a photographer, an accountant or a shop. */
      'What is better for the client when the work has gone well. ' +
      'A problem solved, time saved, a worry gone, a goal reached, or something ' +
      'simply taken care of: any of those, in their words. ' +
      'Not the thing they were handed, which is the service. ' +
      'Nothing about how long the work takes is assumed, and nothing is promised ' +
      'that the owner did not say.',
    /*
     * TWO FAULTS, FIXED IN TWO PASSES, and the second fix was mine to make.
     *
     * The original asked what was DIFFERENT by the end, which an owner hears as
     * "what did they get", so a trade with a visible result answers with the
     * deliverable. Measured: it returned an emotion about the purchase.
     *
     * The replacement, "what can your last client DO now", then imported an
     * assumption of its own: that every business leaves the client ABLE to do
     * something. True of a coach or a tutor; false of a photographer, an
     * accountant, a shop, a therapist, an event. The reviewed recommendation
     * below is the one phrasing that fits all of them, because "better" is
     * whatever better means in that trade, and it no longer presumes a past
     * client either.
     *
     * Still skippable, and still the pillar most often worth skipping where the
     * trade makes the answer obvious. Deliberately not `feedsASection`.
     */
    example: "When you've done a great job, what is better for the client? (e.g. less stress)",
    earnsItsQuestion:
      'A page that lists what a business DOES without saying what the client GETS gives a visitor no reason to act.',
  },
  {
    key: 'differentiators',
    meaning:
      'Why somebody would choose this business over the alternatives: the ' +
      'approach, the specialisation, the attention, the flexibility, the ' +
      'experience, in the owner\'s words. ' +
      /* §5 pillar 3's safety line, and it governs the recorder rather than the
         question: an owner's own view of why they are chosen is not customer
         feedback, and the two must not be merged into one claim. Where a client
         is actually quoted, that quote is the stronger material. */
      'Recorded as the owner\'s own view unless they report a client saying it. ' +
      'Nothing invented: a competitive advantage nobody claimed is not one.',
    /*
     * WHY THE ATTRIBUTION TO A CLIENT WAS DROPPED, having twice been the point.
     *
     * Both earlier wordings asked what a client SAID: "what have clients told
     * you made them pick you", then "why did your last client say they picked
     * you". The reasoning was sound and is still in this file's header: people
     * repeat what they were told accurately and describe themselves in
     * adjectives.
     *
     * It failed anyway, twice, and for a reason the reasoning missed: most
     * owners do not know. A client rarely explains their choice, so the honest
     * answer is how they were FOUND — "I was recommended by prior clients" on
     * this platform's own test account, "they got my contact from a friend who
     * I helped" on the ADHD coach. A channel, not a difference. The rest of the
     * time the owner invents a quote, which is worse: it becomes website copy
     * attributed to a customer who never said it.
     *
     * So this now asks the owner what they BELIEVE clients value, and the
     * recorder is told to keep it as their view rather than as feedback. The
     * old risk returns with it — "professional", "I really care" — and the
     * defence is no longer the question but the rest of the prompt: one
     * illustration from their own work, and the standing rule against letting
     * them characterise themselves in adjectives.
     */
    example: 'What do you think clients value most about working with you? (e.g. always reachable)',
    earnsItsQuestion:
      'Without it every page in a trade reads the same, and the copy falls back to "professional" and "personalised".',
  },
  {
    key: 'credentials',
    meaning:
      'What would help somebody who has never worked with this business trust ' +
      'it: training, qualifications, licences, years in the trade, affiliations, ' +
      'notable results, or relevant life experience. ' +
      /* §5 pillar 4, and the two halves matter equally. Plenty of trades need
         no certificate at all, and a question that implies one invites an
         invented one — which would be published as a claim about a real
         business. */
      'Not every business has formal qualifications, and an owner who has none ' +
      'or prefers not to say is a complete answer. Nothing invented: never a ' +
      'licence, a certificate or a number of years that was not stated.',
    /*
     * STILL ONE ASK, now phrased as a client's question rather than an
     * interviewer's.
     *
     * "What is your background in this?" is direct and was answered well, and
     * the review's objection stands anyway: it reads like an employment
     * interview, which is the wrong register for the one pillar an owner may
     * legitimately have nothing to put in. The wording below asks the same
     * thing from the client's side, where the answer is a reassurance rather
     * than a credential check, and it names the three kinds of thing that
     * count so "none of those" is visibly an allowed answer.
     *
     * The list is a list of NOUNS, not alternative questions: "experience,
     * training, or background" is one ask, and the guard against joining two
     * interrogatives still holds.
     */
    example: 'What should a new client know about your experience, training, or background? (e.g. fifteen years)',
    earnsItsQuestion:
      'A new business has no reviews. Credentials are the only honest proof it can show instead.',
  },
  {
    key: 'objections',
    feedsASection: true,
    meaning:
      'What makes somebody hesitate before going ahead: price, timing, trust, ' +
      'commitment, or not understanding how the work runs. ' +
      /* The question no longer requires a reported remark, so the recorder is
         told what to do with both kinds. Where a client is actually quoted the
         quote is the stronger material and should be kept as one. */
      'Kept as the owner\'s own reading unless they report a client saying it. ' +
      /* §5 pillar 5. A business with no customers yet has anticipated concerns
         and nothing else, and they are worth having: the FAQ has to exist on
         the first day. */
      'For a business not trading yet, the concerns they expect are an answer.',
    /*
     * ABOUT THE DOUBT, NOT ABOUT THE DECISION. Measured, on an ADHD coach who
     * reported these two questions as unclear and near-identical:
     *
     *   differentiators  "What have clients told you made them pick you?"
     *   objections       "What is the last thing someone asked you before
     *                     they decided to go ahead?"
     *
     * Both pointed at the same moment — just before they committed — so to an
     * owner they are one question asked twice. His answer proves it: he
     * replied "they got my contact from a friend who I helped", which is how
     * he was found, and neither a differentiator nor a doubt.
     *
     * The two `meaning`s were always distinct. The EXAMPLES were not, and the
     * model writes from the example. So this one names the WORRY rather than
     * the decision, which is what the field is for.
     *
     * Three things it has to be at once, and the first draft lost one of them:
     *
     *   about the doubt   not about why they chose, or it duplicates above
     *   something SAID    this field's `meaning` asks for a reported
     *                     utterance, and "what did they hesitate about" asks
     *                     instead for the owner's reading of a silence
     *   one client        "what do clients worry about?" returns nothing, as
     *                     recorded in the question-writing rules
     */
    /*
     * THE REPORTED REMARK WAS THE RULE HERE, AND IS NOW THE PREFERENCE.
     *
     * Every previous wording required one: "what is the last thing someone
     * asked you before they decided", then "what did the last client SAY they
     * were worried about". A guard in the test file enforced the verb, and the
     * reasoning was the same as on `differentiators`: a remark is evidence, an
     * owner's reading of a silence is a guess.
     *
     * The review's objection is that it presumes the client said it out loud,
     * and most do not. They go quiet, or they never get in touch at all, and
     * the hesitation the FAQ most needs to answer is the one nobody voiced.
     * Asking "what usually makes someone hesitate" collects that; `meaning`
     * keeps the distinction by recording a quote AS a quote when there is one.
     *
     * The cost is the one this file's header warns about: a question asked
     * about people in general invites a theory. The defence is that hesitation
     * is a thing owners field constantly and can answer from memory without a
     * named client, which is not true of why they were chosen.
     */
    example: 'What usually makes someone hesitate before working with you? (e.g. the cost)',
    earnsItsQuestion:
      'The FAQ and the reassurance in the copy exist to answer this; unasked, they answer nothing in particular.',
  },
  {
    key: 'delivery',
    feedsASection: true,
    meaning:
      'What actually happens, in order, from the moment somebody says yes: ' +
      'a consultation, a booking, a form, a payment, preparation, the work ' +
      'itself, and whatever follows it. ' +
      /* §5 pillar 6 reverses an earlier narrowing. Booking and paying were
         excluded here because the interview asks about them elsewhere and two
         answers to one question is worse than none. But WHERE they sit in the
         sequence is this pillar's business and nothing else records it: a
         deposit before the first visit and a bill at the end are different
         businesses to configure. The amounts and methods still belong to the
         money questions; the ORDER belongs here. */
      'Where each step sits in the order, payment and booking included, since ' +
      'nothing else records that. Not what anything costs. ' +
      'No sequence is assumed: paid before or after, consultation first or not, ' +
      'appointments or none at all, and a different path per service where they ' +
      'say so.',
    /*
     * THE ANCHOR IS A SCENE NOW, WHICH IS WHY IT IS LONGER THAN THE REST.
     *
     * Two failures bound this question. "What happens during a session with
     * your clients?" lost the anchor and the owner reported not knowing what to
     * answer. "What happens first after someone says yes?" kept the anchor and
     * was too abrupt to place: asked of a contractor it collected the SALES
     * process, the scoping meeting and the quote, which happen before anybody
     * has said yes to anything.
     *
     * Putting the client's sentence in their mouth fixes both. "A new client
     * just told you, I would like to work with you. What happens next?" is a
     * moment nobody can misplace, and it starts the clock after the agreement
     * rather than around it.
     *
     * This is also the pillar where one step is not enough: it writes the
     * How-It-Works section and every draft service description. The sequence is
     * what `meaning` asks for, and the prompt's follow-up rule is what gets the
     * second and third steps without turning the question into a list.
     */
    example: "A new client just told you, 'I'd like to work with you.' What happens next? (e.g. a site visit)",
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
 * It is still a ceiling and rarely the cost: the model declines to ask about
 * anything the owner's description already covers, so a story written with any
 * care spends fewer. The cap exists to stop a conversation becoming a form,
 * not to ration the questions that have already proved worth asking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THEN DELIBERATELY SMALLER AGAIN, which the paragraph above predates.
 *
 * One per field was measured on a live run at six fields, and six questions is
 * too many: all six were asked, two returned nothing usable, and the owner's
 * verdict was that the interview asks too much. So something goes unasked on
 * every run by design.
 *
 * What stops that being a section-feeding pillar is no longer arithmetic: the
 * picker is handed the number of questions left and told that the two pillars
 * feeding a whole section come first. Raising this to `BRIEF_FIELDS.length`
 * puts the six-question interview back, so it stays a literal — bounded from
 * both sides by `businessBrief.test.ts`, which is where the reasoning lives.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MAX_FOLLOW_UPS = 4;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR, NOT SIX, AND THE LAST TIME THIS WAS FOUR IT BROKE SOMETHING.
 *
 * This was `BRIEF_FIELDS.length`, one question per pillar, and the note above
 * records why it was raised to that: at four, with five pillars, the last
 * pillar in contract order was never reached — not declined, never asked —
 * and that pillar was `objections`, which writes the FAQ.
 *
 * It is four again because six was measured and six is too many. On a live run
 * all six were asked and two returned nothing usable: a pillar the trade makes
 * obvious returned "they happy with the results", and one whose question had
 * lost its anchor returned "not sure". Four questions of which four are worth
 * answering beats six of which two are filler, and the owner's verdict was the
 * plain one: there are too many.
 *
 * What stops the old failure recurring is that the picker is now TOLD its
 * budget and told to spend it on the section-feeding pillars first. Starvation
 * before was silent arithmetic; now it is a choice the model makes with the
 * number in front of it.
 *
 * If the FAQ or the How-It-Works section starts arriving empty, this is the
 * first place to look, and the fix is the budget rule in the prompt rather than
 * a bigger number here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

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
