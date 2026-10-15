/**
 * Onboarding Conversation Manager
 *
 * The state machine behind the Business OS onboarding chat.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INTERVIEW HAS TWO JOBS, and keeping them apart is what the shape of this
 * file is for.
 *
 * CONFIGURE THE PLATFORM. Does this business book appointments, how does the
 * money reach it, how many things does it sell, do clients fill in a form
 * first, which channels does it want. Each of these decides a capability, each
 * is asked as a chip, and each is read DETERMINISTICALLY — a button press needs
 * no model, and a keyword search over a label that spells out its own
 * consequence is how "no card payments" was once read as "card payments".
 *
 * LEARN ENOUGH TO WRITE ABOUT IT. The story, then a short follow-up interview
 * against a declared contract (`lib/business-os/onboarding/businessBrief`),
 * then one call that composes the description the website is generated from.
 * Three LLM calls plus two per follow-up, and nothing here may invent a fact
 * the owner did not give.
 *
 * What it does NOT do, by decision: collect a catalogue. Prices, durations and
 * per-service exceptions belong to the services editor. Onboarding creates
 * named DRAFTS, invisible until the owner publishes them.
 *
 * Flow:
 *   language → name → story → deepening (×N) → how you sell
 *            → how you collect → how many → intake (if booked) → channels → plan
 *
 * Steps named in `ONBOARDING_STEPS` but absent above are retired and kept only
 * so a stored conversation standing on one is resumed rather than discarded.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getProviderFactory } from '@/lib/ai/providerFactory';
import { createLogger } from '@/lib/logger';
import {
  buildBosCallContext,
  isUuid,
  newBosGroupId,
  type BosLlmCallName,
  type BosLlmOwner,
} from '@/lib/business-os/llm/callCatalog';
import { withModelFallback } from '@/lib/business-os/llm/modelFallback';
import { resolveBosLlmSettings } from '@/lib/business-os/llm/modelSettings';
import {
  OnboardingConfigurationService,
  onboardingConfigurationService,
  ExtractedData,
  BusinessStoryExtraction,
  ClientWorkflowExtraction,
  CollectionMethod,
  PricingModel,
  ClientAcquisitionExtraction,
  ClientTrackingExtraction,
  InferredConfiguration,
  PipelineStage,
  ExtractedService,
  /* The verticals that actually select a pipeline. The extraction prompt is
     BUILT from these rather than carrying its own copy: three overlapping
     lists of business types, no two agreeing, is what this replaces. */
  PIPELINE_VERTICALS,
  PIPELINE_SUB_VERTICALS,
} from './OnboardingConfigurationService';

import {
  BRIEF_FIELDS,
  withoutDashPunctuation,
  EMPTY_BRIEF,
  MAX_FOLLOW_UPS,
  briefContract,
  briefHasAnything,
  briefSoFar,
  mergeIntoBrief,
  fieldsStillToAsk,
  type BriefField,
  type BusinessBrief,
} from '@/lib/business-os/onboarding/businessBrief';

const logger = createLogger({ service: 'OnboardingConversationManager' });

/**
 * Answers that mean "move on".
 *
 * Every follow-up is skippable and nothing here may block the build, so a word
 * of dismissal has to be read as one rather than recorded as a fact about the
 * business. Kept short and literal — anything longer is an answer.
 */
const SKIP_WORDS = new Set([
  'skip', 'no', 'none', 'nothing', 'pass', 'later', 'dunno', "don't know", 'dont know', 'n/a', '-',
  'דלג', 'לא', 'אין', 'כלום', 'אחר כך', 'לא יודע',
  'saltar', 'no', 'nada', 'ninguno', 'luego', 'no sé', 'no se',
]);

/**
 * The adjustment intents the preview prompt allows (PREVIEW_ADJUSTMENT_PROMPT).
 * The intent is whatever the model returned, so only one of these is logged at
 * info as a label; anything else is model text and goes to debug (CR-3).
 */
const KNOWN_ADJUSTMENT_INTENTS: ReadonlySet<string> = new Set([
  'add_capability',
  'remove_capability',
  'modify_services',
  'modify_pipeline',
  'change_payment_mode',
  'restart',
  'confirm',
]);

/** Info-safe fields for a model-returned intent: the label if known, else its length. */
function intentFields(intent: unknown): { intent: string } | { intentLength: number } {
  return typeof intent === 'string' && KNOWN_ADJUSTMENT_INTENTS.has(intent)
    ? { intent }
    : { intentLength: String(intent ?? '').length };
}

/**
 * Logs an extractor failure. A JSON SyntaxError's message quotes the start of
 * the model's output, which is derived owner text, so it gets only its name at
 * error and the full error at debug (D-OI8, CR-2). Any other error, e.g. from
 * the provider, keeps its full detail at error.
 */
function logExtractionFailure(error: unknown, message: string): void {
  if (error instanceof SyntaxError) {
    logger.error({ errName: error.name }, message);
    logger.debug({ err: error }, `${message}: parse error detail`);
    return;
  }
  logger.error({ err: error }, message);
}

// ============================================================
// TYPES
// ============================================================

export type Language = 'en' | 'he' | 'es';

export type OnboardingStep =
  | 'language_selection'
  | 'business_name'      // What is the business called? Asked, never inferred
  | 'business_story'
  | 'business_deepening'  // Fills the gaps the story left — see `businessBrief`
  | 'client_workflow'
  | 'service_details'  // Follow-up when user didn't provide specific service details
  | 'payment_collection'  // How does the money reach you? (decides Stripe vs bank details)
  | 'client_acquisition'  // Q4: How do clients find you? (determines website need)
  | 'client_tracking'     // Q5: How do you track clients? (determines CRM need)
  | 'preview'
  | 'preview_adjustment'
  | 'building'
  | 'complete';

export interface Service {
  id?: string;
  service_name: string;
  /**
   * What this service IS, in the owner's words.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The services created by onboarding are PLACEHOLDERS: the owner sets the
   * price and the length in the editor afterwards. So the one thing the
   * interview can usefully capture about a service is the only thing the
   * editor cannot generate — what it actually is.
   *
   * It held nothing. This type was name, duration, price, currency,
   * collection, sale_mode: configuration end to end. The build wrote
   * `description: suggestion?.description`, which exists only on a service
   * WE invented, so a service the owner described themselves arrived with no
   * description at all and the website had a catalogue of bare names.
   * ───────────────────────────────────────────────────────────────────────────
   */
  description?: string;
  /** Null for a service not booked against a time — a product or deliverable. */
  duration_minutes: number | null;
  /** Null where the fee is agreed per client. Zero only where it is free. */
  price: number | null;
  currency: string;
  /** Does booking this involve picking a time? */
  is_scheduled: boolean;
  /** How the money arrives. Null while the service is free. */
  collection: 'online' | 'invoice' | null;
  /**
   * Can a client buy this outright, or does the business quote each job?
   *
   * 'proposal' is the only way a service priced per job can exist: it has no
   * published price and no card taken at booking, because neither is knowable
   * until the work has been quoted.
   */
  sale_mode: 'direct' | 'proposal';
  /** Paying over time, where they said so. Carried through to the build. */
  payment_plan?: {
    installment_count: number;
    installment_frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  } | null;
}

/**
 * Every step a conversation can be in.
 *
 * Exported because the chat route also has to decide whether a stored
 * conversation can be resumed, and it used to keep its own copy of this list.
 * Adding a question to the flow then made every conversation in progress look
 * invalid to that copy: the user answered the new question and was thrown back
 * to the first one, in English, with everything they had said discarded.
 *
 * One list. Add a step here and both the state machine and the route learn it.
 */
export const ONBOARDING_STEPS = new Set<OnboardingStep>([
  'language_selection',
  'business_name',
  'business_story',
  'business_deepening',
  'client_workflow',
  'service_details',
  // No longer asked — each service carries its own `collection`. Kept in the
  // set so a conversation already sitting on this step still resumes: the chat
  // route validates a stored step against this list and discards the whole
  // conversation when it is missing.
  'payment_collection',
  'client_acquisition',
  // No longer asked either — CRM is not a choice. Six tables carry a NOT NULL
  // foreign key to `crm_contacts`, so a booking cannot be written without a
  // contact, and the pipeline is now seeded for every business. The answer
  // decided nothing and cost a question and an LLM call. Kept in the set for
  // the same reason as above: a conversation already standing on it resumes
  // rather than being thrown away.
  'client_tracking',
  'preview',
  'preview_adjustment',
  'building',
  'complete',
]);

export interface OnboardingState {
  currentStep: OnboardingStep;
  collectedData: {
    // From business_story extraction
    businessStory?: BusinessStoryExtraction;
    // From client_workflow extraction
    clientWorkflow?: ClientWorkflowExtraction;
    // From client_acquisition extraction (Q4: How do clients find you?)
    clientAcquisition?: ClientAcquisitionExtraction;
    // From client_tracking extraction (Q5: How do you track clients?)
    clientTracking?: ClientTrackingExtraction;
    // Merged extracted data
    extractedData?: ExtractedData;
    // Computed configuration (generated at preview step)
    configuration?: InferredConfiguration;
    // Legacy fields for backwards compatibility
    businessProfile?: {
      company_name?: string;
      vertical?: string;
      language?: Language;
    };
    pipelineStages?: PipelineStage[];
    services?: Service[];
    businessDescription?: string;
    /**
     * The business story has already been asked for a second time.
     *
     * One re-ask, never two. The first answer was too thin to describe a
     * business ("I", from a real run), and the second is taken as given
     * whatever it says: an interview that can refuse to move on is an interview
     * somebody cannot finish, and the brief questions that follow are a better
     * place to recover than a wall.
     */
    storyAlreadyReasked?: boolean;
    wantsWebsite?: boolean;
    /**
     * What we need in order to WRITE about this business — see
     * `lib/business-os/onboarding/businessBrief`.
     *
     * Separate from `businessStory`, which is the configuration read of the
     * same answers. The story decides what the platform switches on; this
     * decides what a page about them can say.
     */
    businessBrief?: BusinessBrief;
    /**
     * The follow-ups as EXCHANGES — what was asked and what came back.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The answers alone are fragments. "all" means nothing without the question
     * it answered, and read as a sentence it is noise: the first composed
     * description on a real account contained the word "all." on its own.
     *
     * Keeping the question with the answer is what lets the description be
     * written rather than concatenated — and it is the owner's words on both
     * halves, so nothing here is a paraphrase.
     * ─────────────────────────────────────────────────────────────────────────
     */
    briefExchanges?: Array<{ field: BriefField['key']; question: string; answer: string }>;
    /** How many follow-ups have been asked, capped by `MAX_FOLLOW_UPS`. */
    followUpsAsked?: number;
    /**
     * The fields already put to the owner, asked or not answered usefully.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * WITHOUT THIS THE INTERVIEW REPEATS ITSELF.
     *
     * Reported: "who usually comes to you — beginners, experienced athletes…?",
     * answered "all kind", and then "who do you usually train — are they
     * beginners, advanced athletes…?". The reader records only what the words
     * support, a vague answer supports nothing, the field stays missing, and
     * the picker chooses it again. Five questions could be spent on one.
     *
     * A question asked is a question spent. Whether it produced anything is a
     * separate matter, and not one to ask the owner about twice.
     * ─────────────────────────────────────────────────────────────────────────
     */
    askedBriefFields?: BriefField['key'][];
    /** Which field the outstanding follow-up is about. */
    pendingBriefField?: BriefField['key'];
    /**
     * The question itself, as the model phrased it.
     *
     * Held on the state because deciding and saying are separate here:
     * `updateStateFromMessage` works out what to ask and `getNextResponse` says
     * it. Anything the first learns and the second needs has to travel on the
     * state.
     */
    pendingBriefQuestion?: string;
  };
  language: Language;
  pendingQuestion?: string;
  validationErrors?: string[];
  /**
   * Groups every LLM call of ONE onboarding conversation in the usage ledger
   * (Layer 1.5 FR-4). Minted by `getInitialState`, so a restart is a new group.
   *
   * Deliberately NOT named `conversationId`: the chat route's request schema
   * accepts a client-supplied `conversationId` that it ignores, and attribution
   * must never come from the request body.
   *
   * Optional here only because a snapshot saved before Layer 1.5 has none;
   * `ensureAttributionGroupId` backfills it on resume.
   */
  attributionGroupId?: string;
}

/** A state guaranteed to carry its grouping id, so no caller needs a `!` (WC-1). */
export type AttributedOnboardingState = OnboardingState & { attributionGroupId: string };

// ============================================================
// EXTRACTION PROMPTS
// ============================================================

/**
 * Read the owner's free-text answer for the facts that SWITCH SOMETHING ON.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PROMPT USED TO BE, and why it is a quarter of the size.
 *
 * It asked one sentence for eleven facts, under the instruction "Be GENEROUS in
 * inference". Of the eleven:
 *
 *   · TWO were discarded by the code on arrival. `company_name` loses to the
 *     name the owner typed when asked outright; `description` is overwritten by
 *     their own words, because an extraction once answered a Hebrew
 *     conversation in English and that restatement became the source text for
 *     a whole website.
 *   · FOUR had no question feeding them and no consumer deciding anything.
 *     `pain_points`, `goals` and `tools` came back `[]` on every real account
 *     measured. `clients_per_week` was guessed from an adjective ("busy" = 15)
 *     or defaulted to 5, and then stated to the website copywriter as
 *     "Business Volume: Approximately 5 clients per week" — a number about a
 *     business that nobody had asked.
 *   · ONE competed with a better source. `target_audience` is now collected by
 *     a dedicated question in the brief interview.
 *   · The remaining four are below.
 *
 * "Be GENEROUS in inference" is also the exact opposite of what every other
 * prompt in this file says. `readBriefAnswer`, forty lines away: "Record ONLY
 * what the words support. Invent nothing, infer nothing, flatter nothing."
 * Same model, same conversation, opposite orders.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A FUNCTION
 *
 * The lists of verticals and sub-verticals come from the tables that CONSUME
 * them. The prompt used to carry its own copy: it offered 15 verticals against
 * 8 presets, named four that existed nowhere (`coach`, `doctor`, `dentist`,
 * `lawyer`), could never produce `realtor` which is a real canonical value, and
 * distinguished some twenty sub-verticals of which five changed anything. That
 * last gap is why it carried a hardcoded rule naming one customer type — the
 * thing CLAUDE.md's no-hardcoding rule exists to prevent.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function businessStoryPrompt(): string {
  return [
    'You are reading what a business owner just typed about their business.',
    '',
    'ONE JOB: return the few facts that decide how the platform is set up.',
    'You are NOT describing the business. A later step does that, from the',
    "owner's own words, so a description written here would compete with it.",
    '',
    'WHAT TO RETURN, and what each one decides:',
    '',
    '1. vertical. Chooses the sales pipeline this business gets. EXACTLY one of:',
    `   ${PIPELINE_VERTICALS.join(', ')}`,
    '   Pick the closest. Use "default" when none of them fits: a generic',
    '   pipeline is easily lived with, a wrong one has to be unpicked stage by',
    '   stage by someone who did not ask for it.',
    '',
    /*
     * SAY WHAT CHOOSING ONE DOES. The first version of this said only what not
     * to choose: "ONLY these change anything", "null for anything else", "reads
     * back to the owner as a decision nobody made". Three sentences, all
     * discouraging, and the old prompt's one worked example removed with them.
     *
     * Measured: a business described as "a school trainer helping high school
     * kids with their academic challenges" came back `sub_vertical: null`, with
     * `tutor` on the list and carrying its own pipeline. It took the broad
     * `teacher` stages instead of the closer ones.
     */
    '2. sub_vertical. A MORE SPECIFIC pipeline, where one fits. Exactly one of:',
    `   ${PIPELINE_SUB_VERTICALS.join(', ')}`,
    '   Take a match whenever the business plainly IS that thing: these names',
    '   mean what they say, read literally. Each carries its own pipeline stages,',
    '   closer to how that trade actually runs than the broad category above, so',
    '   a match is worth taking rather than passing over.',
    '   null ONLY when none of them fits. A word that is not on this list reaches',
    '   no consumer at all, so invent nothing: there, null is the honest answer.',
    '',
    '3. needs_booking. Do clients book a time with this business?',
    '   true or false ONLY where they say so: "clients book sessions", "I see',
    '   people by appointment", "I sell downloads, no appointments".',
    '   null when they did not say. null is a real and common answer, and the',
    '   most useful one: it means the chat asks them outright on the next turn.',
    '',
    '4. needs_website. Have they asked for a website, or said they have none?',
    '   true or false only where stated, null otherwise. They are offered the',
    '   choice later either way.',
    '',
    '5. describes_business. Is there enough here to tell what this business',
    '   DOES? true when you could say what it sells or who it serves, even',
    '   roughly. false when the message is a slip, a stray character, a test',
    '   string, or words that say nothing about any business.',
    '   This decides whether the question is asked once more, so it is the one',
    '   judgement here with a second chance attached: when it is false, nothing',
    '   you return above is used.',
    '',
    'RULES:',
    '- INFER NOTHING. If the words do not say it, the answer is null. A guess',
    '  here becomes a pipeline the owner did not choose.',
    '- Every value above is a fixed key or a boolean, and none of it is shown to',
    '  the owner. So return the keys in English exactly as listed, whatever',
    '  language they wrote in. A translated key matches no pipeline at all.',
    '- Return nothing else. No summary, no audience, no goals, no volume: the',
    '  interview that follows asks about those properly, and a second answer to',
    '  the same question is worse than no answer.',
    '',
    'Return JSON: {"vertical": string, "sub_vertical": string|null,',
    ' "needs_booking": true|false|null, "needs_website": true|false|null,',
    ' "describes_business": true|false}',
  ].join('\n');
}

/**
 * Read a free-text answer about what the business offers, for PLACEHOLDER rows.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PROMPT USED TO BE: 129 lines, of which about 40 were worked price
 * examples in two languages.
 *
 * It extracted price, currency, instalment plans, buffer minutes, sale mode,
 * per-service collection, pricing model, payment timing and booking method. All
 * of that was written for the services FORM, where the owner filled in a
 * fifteen-column grid before anything existed. That form is gone, and it is
 * where owners stopped.
 *
 * The chat does not collect pricing. It asks how they sell, how the money
 * reaches them and roughly how many things they sell, then creates that many
 * DRAFT rows and leaves every number to the services editor, which has a field
 * for each and is the only place one can be checked.
 *
 * Two of the fields it extracted were also answered by a chip on the very next
 * turn and overwritten — `sells_scheduled` by `readScheduledAnswer` and
 * `collection_method` by `readCollectionMethod`, both read deterministically
 * because a label that spells out its own consequence defeats a keyword search.
 * Two sources for one fact, with the model's version losing.
 *
 * And `needs_intake` was asked for here, declared on the type, and dropped by
 * this extractor's own return block, so no account ever got an intake form
 * from onboarding. It is now its own question with its own reader.
 *
 * What is left is the only thing no editor can generate: what the service IS.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const CLIENT_WORKFLOW_SYSTEM_PROMPT = `You are reading what a business owner says they offer.

ONE JOB: name the things they sell, so each becomes a draft row they can finish.

For each service, return:
- name: what a client would see on a booking page. Two to four words, in the
  owner's own language. No price, no duration, no marketing adjective.
- description: one or two sentences saying what it is and who it suits, built
  from what they actually said and in their phrasing. Omit it only if they said
  nothing beyond a name.

Also return:
- needs_more_details: true only when they named nothing a service could be
  created from. A missing price is NOT a gap: these are placeholders, and the
  owner sets prices and durations in the services editor. Asking again for a
  number they have already declined to give turns the interview into a form.

RULES:
- INFER NOTHING they did not say. This text is the source a website is written
  from, and a service they do not offer is worse than one less row.
- Never return a price, a duration, a qualification or a result. Not in a name
  and not in a description: those are facts we do not have.
- No dashes between clauses. Use a comma, a colon or a full stop.
- Write everything in the language the owner wrote in.

Return ONLY valid JSON:
{
  "services": [{ "name": string, "description": string }],
  "needs_more_details": boolean
}`;

/*
 * CLIENT_ACQUISITION_SYSTEM_PROMPT was here, and was removed on 2026-10-14.
 *
 * It asked a model to read a free-text answer about where clients come from
 * and recommend whether the business needs a website. The question it belonged
 * to became a multi-select: the owner ticks "build me a website" or "connect
 * Facebook, Instagram or Google", and `extractClientAcquisition` reads the
 * ticks deterministically. A chosen option is not a thing to interpret.
 *
 * The prompt survived that change by 38 lines and was referenced by exactly
 * one line of the codebase: its own declaration. No call site, no test, no
 * catalogue entry. Noted here rather than silently dropped, because a reader
 * wondering where the website recommendation is made should land on the
 * multi-select reader and not go looking for a model.
 */
const CLIENT_TRACKING_SYSTEM_PROMPT = `You are analyzing how a business owner currently tracks their clients and their progress.
This helps determine if they need a CRM system.

IMPORTANT: The question asks "How do you track clients?" - if they say "I don't track" or "nothing" or "לא עוקב" (Hebrew for "I don't track"),
this means they currently have NO tracking system and NEED CRM help. "I don't track" = needs_crm: TRUE.
The ONLY case where needs_crm is false is when they ALREADY HAVE a CRM system they're happy with.

From their response, extract:
1. current_method - How they currently track clients. ONE of: spreadsheet, paper, memory, existing_crm, notes_app, nothing
2. current_tools - Array of specific tools mentioned: excel, google_sheets, notion, paper, notebook, trello, etc.
3. tracks_progress - boolean: Do they track client progress/journey/stages?
4. has_existing_crm - boolean: Do they already have a dedicated CRM system they use?
5. volume_hint - Any indication of how many clients they have (number or null)

Based on all the above, determine:
6. needs_crm - boolean recommendation:
   - TRUE if: current_method is "nothing", OR using spreadsheet/paper/memory, OR mentions wanting better tracking, OR says "I don't track"
   - FALSE ONLY if: they already have a CRM system they're happy with (has_existing_crm: true)
7. needs_pipeline - boolean: Do they need pipeline stages (tracking where clients are in their journey)?
   - TRUE if: they have ongoing client relationships, or mention follow-ups, stages, or need to track where clients are
   - TRUE if: current_method is "nothing" (they have no system at all, pipeline will help organize)
   - FALSE if: simple one-time transactions with no ongoing relationships

Examples:
- "I use Excel to keep track" = spreadsheet, needs_crm: true
- "Everything is in my head" = memory, needs_crm: true, needs_pipeline: true (they're losing track)
- "I have a CRM I like" = existing_crm, has_existing_crm: true, needs_crm: false
- "I write notes after each session in a notebook" = paper, needs_crm: true
- "I just remember my regulars" = memory, small volume, needs_crm: true (memory is not reliable)
- "I don't track" / "לא עוקב" / "nothing" = nothing, needs_crm: true, needs_pipeline: true (they need help organizing)
- "No system" / "אין לי מערכת" = nothing, needs_crm: true, needs_pipeline: true

Return ONLY valid JSON:
{
  "current_method": "spreadsheet" | "paper" | "memory" | "existing_crm" | "notes_app" | "nothing",
  "current_tools": string[],
  "tracks_progress": boolean,
  "has_existing_crm": boolean,
  "volume_hint": number | null,
  "needs_crm": boolean,
  "needs_pipeline": boolean
}`;

const PREVIEW_ADJUSTMENT_PROMPT = `The user is viewing a preview of their Business OS configuration and wants to make changes.
Analyze their request and determine what they want to modify.

Possible adjustments:
- add_capability: They want to add a feature (e.g., "I also want a website")
- remove_capability: They want to remove a feature (e.g., "I don't need payments")
- modify_services: They want to change services (e.g., "Add another service")
- modify_pipeline: They want to change CRM stages
- change_payment_mode: They want different payment setup
- restart: They want to start over
- confirm: They're now happy with the setup

Return JSON:
{
  "intent": "add_capability" | "remove_capability" | "modify_services" | "modify_pipeline" | "change_payment_mode" | "restart" | "confirm",
  "details": string // what specifically they want to change
}`;

// ============================================================
// CURRENCY BY LANGUAGE
// ============================================================

const CURRENCY_BY_LANGUAGE: Record<Language, string> = {
  en: 'USD',
  he: 'ILS',
  es: 'EUR',
};

// ============================================================
// ONBOARDING CONVERSATION MANAGER
// ============================================================




/**
 * The most services onboarding will create from a count.
 *
 * Same ceiling as the chat route's request schema puts on a submitted services
 * array (`StructuredServiceSchema`, `.max(40)`), so the two limits cannot drift
 * apart and leave one path accepting what the other rejects.
 */
/**
 * Words and phrases that mean "no charge", in each onboarding language.
 *
 * Matched as WHOLE words via `containsWholeWord`: `includes` finds "free" in
 * "freelance". Read by `readCollectionMethod`, for an owner who types "I don't
 * charge for any of it" instead of tapping the chip. None of the other keywords
 * there appears in that sentence, so without this it reached the `invoice`
 * fallback and a free business was asked for bank details.
 *
 * (It was shared with the price parser, which has been removed. This is now its
 * only reader, which is why the comment no longer points at one.)
 */
const FREE_PRICE_WORDS = [
  'free', 'no charge', 'free of charge',
  'חינם', 'בחינם', 'ללא תשלום', 'בלי תשלום', 'ללא עלות',
  'gratis', 'gratuito', 'gratuita', 'sin costo', 'sin cargo',
];

/**
 * Words that reverse whatever else is in the sentence.
 *
 * Read by `isConfirmation` only, and only to say NO. A reply carrying one of
 * these is never treated as agreement, however many approving words sit beside
 * it: "no vale así" and "not ok" are rejections written with the vocabulary of
 * acceptance.
 */
const NEGATORS = [
  'no', 'not', "don't", 'dont', 'nope', 'wrong', 'change', 'instead',
  'לא', 'אל', 'לשנות', 'במקום',
  'nada', 'tampoco', 'cambiar', 'cambia',
];

export const SERVICE_COUNT_MAX = 40;

/** Currency words stripped before the number is read, bounded like whole words (see `containsWholeWord`). */
const PRICE_CURRENCY_WORDS =
  /(?<![\p{L}\p{N}])(?:שקלים|שקל|ש"ח|שח|nis|ils|usd|eur|dollars|dollar|euros|euro)(?![\p{L}\p{N}])/gu;

/**
 * Whether `word` appears in `text` as a whole word or phrase.
 *
 * Unicode-aware: `\b` treats Hebrew letters as non-word characters, so it
 * cannot bound a Hebrew word. A letter or digit on either side disqualifies
 * the match — "freelance" does not contain "free", "100" does not contain "0".
 */
function containsWholeWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

export class OnboardingConversationManager {
  private configService: OnboardingConfigurationService;

  constructor() {
    this.configService = onboardingConfigurationService;
  }

  /**
   * Process a user message and update the onboarding state
   */
  async processUserMessage(
    /**
     * Who this turn's LLM calls are recorded against: the signed-in owner's
     * account and this conversation's grouping id. Required, so a missing
     * account or group is a compile error (Layer 1.5 FR-3).
     */
    owner: BosLlmOwner,
    message: string,
    currentState: OnboardingState,
    /**
     * Services exactly as the form holds them, when the turn came from it.
     *
     * Taken verbatim in `service_details` instead of re-reading them out of the
     * sentence the form wrote. A model that returns three of four services
     * loses the fourth silently, and nothing downstream counts them — the
     * business simply ends up with fewer services than it typed. The same
     * reasoning `readIntakeNeed` already applies to the intake toggle.
     */
    submittedServices?: ExtractedService[]
  ): Promise<{
    response: string;
    suggestions?: string[];
    multiSelect?: boolean;  // If true, suggestions are multi-select toggle buttons
    updatedState: OnboardingState;
    showPreview?: boolean;
  }> {
    // Never the owner's raw text, at any level (OI-7): its length is enough to debug with.
    logger.debug(
      { userId: owner.userId, groupId: owner.groupId, currentStep: currentState.currentStep, messageLength: message.length },
      'Processing user message'
    );

    // Update state based on current step
    const updatedState = await this.updateStateFromMessage(owner, currentState, message, submittedServices);

    // Generate next question or response
    const { response, suggestions, showPreview, multiSelect } = await this.getNextResponse(updatedState);

    return {
      response,
      suggestions,
      multiSelect,
      updatedState,
      showPreview,
    };
  }

  /**
   * Valid step names for the enhanced onboarding flow
   */
  private readonly VALID_STEPS = ONBOARDING_STEPS;

  /**
   * Update state based on user message using deep LLM extraction
   */
  private async updateStateFromMessage(
    owner: BosLlmOwner,
    state: OnboardingState,
    message: string,
    /** The services form's own rows, when this turn came from it. */
    submittedServices?: ExtractedService[]
  ): Promise<OnboardingState> {
    // Check if we have an old/invalid step name from a previous onboarding flow
    // If so, reset to the beginning of the new flow
    if (!this.VALID_STEPS.has(state.currentStep)) {
      logger.warn(
        { oldStep: state.currentStep },
        'Detected old onboarding step, resetting to language_selection'
      );
      // A reset is a new conversation, so its calls go under the fresh group.
      const fresh = this.getInitialState(state.language || 'en');
      return this.updateStateFromMessage(
        { userId: owner.userId, groupId: fresh.attributionGroupId },
        fresh,
        message
      );
    }

    // Create a deep copy with defensive initialization
    const updatedState: OnboardingState = {
      ...state,
      collectedData: state.collectedData ? { ...state.collectedData } : {},
    };

    switch (state.currentStep) {
      case 'language_selection':
        // Detect language from response
        if (message.toLowerCase().includes('עברית') || message.toLowerCase().includes('hebrew')) {
          updatedState.language = 'he';
        } else if (message.toLowerCase().includes('español') || message.toLowerCase().includes('spanish')) {
          updatedState.language = 'es';
        } else {
          updatedState.language = 'en';
        }
        updatedState.currentStep = 'business_name';
        break;

      case 'business_name': {
        /*
         * ─────────────────────────────────────────────────────────────────────
         * READ BACK AND CONFIRMED, because this one cannot be fixed by talking.
         *
         * The name is taken exactly as typed, and deliberately so: it used to
         * be inferred from whatever they wrote about their business and fell
         * back to "your business" when they never said it, so an account could
         * be built under a name nobody chose.
         *
         * But "exactly as typed" means a slip is kept exactly too, and this
         * particular field is not one the owner sees again in passing: it goes
         * on every invoice and every email the platform sends for them. The
         * plan screen shows it, and that is the only other chance — by then it
         * is several questions away and reads as settled.
         *
         * So it is read back once. Typing a different name instead of tapping
         * is treated as a correction and confirmed in turn, which is what
         * somebody who spots their own typo will actually do.
         * ─────────────────────────────────────────────────────────────────────
         */
        const said = message.trim();

        if (state.pendingQuestion === 'name_confirm') {
          const verdict = this.readNameConfirmation(said, updatedState.language);

          if (verdict === 'yes') {
            updatedState.pendingQuestion = undefined;
            updatedState.currentStep = 'business_story';
            logger.info({ userId: owner.userId, groupId: owner.groupId }, 'Business name confirmed');
            break;
          }

          if (verdict === 'no') {
            updatedState.pendingQuestion = 'name_again';
            logger.info({ userId: owner.userId, groupId: owner.groupId }, 'Business name rejected; asking again');
            break;
          }

          /* Neither: they typed a replacement. Falls through to store it and
             read THAT back, rather than asking what they just told us. */
        }

        updatedState.collectedData.businessProfile = {
          ...updatedState.collectedData.businessProfile,
          company_name: said,
          language: updatedState.language,
        };

        // The name is the owner's raw text (it is the whole message), so only its length is logged (OI-7).
        logger.info({ userId: owner.userId, groupId: owner.groupId, nameLength: said.length }, 'Business name given');
        updatedState.pendingQuestion = 'name_confirm';
        break;
      }

      case 'business_story':
        // Deep extraction of business context
        logger.info(
          { userId: owner.userId, groupId: owner.groupId, step: 'business_story', messageLength: message.length },
          'Extracting business story from message'
        );
        const businessStory = await this.extractBusinessStory(message, owner);
        // The extraction paraphrases what the owner typed: debug only, so it
        // shows locally and never in production, which runs at info (OI-8).
        logger.debug({ businessStory }, 'Business story extracted');

        /*
         * ─────────────────────────────────────────────────────────────────────
         * A SLIP IS NOT AN ANSWER. Asked once more, then taken as given.
         *
         * Reported from a real run: the owner mistyped and sent "I", the
         * interview moved straight on, and "I" became the business
         * description — so the follow-up questions, the composed description,
         * the service names and the website were all written from it.
         *
         * The MODEL decides this, not a rule here. A character or word count
         * was tried and thrown away: it cannot tell "I" from "מאמן כושר",
         * because Hebrew says more per character, so any threshold is stricter
         * in one script than another before it ever meets a vertical. The model
         * is already reading the sentence and can simply say whether there is a
         * business in it.
         *
         * One re-ask, never two, and the second answer is accepted whatever it
         * says: an interview that can refuse to move on is one somebody cannot
         * finish, and the brief questions that follow are a better place to
         * recover than a wall.
         * ─────────────────────────────────────────────────────────────────────
         */
        if (
          businessStory.describes_business === false
          && !updatedState.collectedData.storyAlreadyReasked
        ) {
          updatedState.collectedData.storyAlreadyReasked = true;
          updatedState.pendingQuestion = 'story_again';
          logger.info(
            { userId: owner.userId, groupId: owner.groupId, messageLength: message.trim().length },
            'The story did not describe a business; asking once more'
          );
          break;
        }

        updatedState.pendingQuestion = undefined;

        // Their own words win over the model's paraphrase.
        //
        // The extraction returns a tidy summary, and it writes it in whatever
        // language it feels like — a Hebrew conversation was producing an
        // English sentence, which then became the source text for the whole
        // website. What the person typed about their own business is better
        // material than a restatement of it, and it is the thing they will
        // recognise when they come to correct it in settings.
        //
        // The summary is kept only where nothing usable was typed.
        /*
         * ALWAYS their words now, with no length threshold.
         *
         * The threshold existed to fall back to the extraction's own summary
         * for a very short answer. The extraction no longer writes one, and the
         * fallback was never worth having: a model's paraphrase of "hair salon"
         * is not better material than "hair salon", and the real description is
         * composed later by `writeDescription` from this plus every follow-up.
         */
        const ownWords = message.trim();
        businessStory.description = ownWords;

        updatedState.collectedData.businessStory = businessStory;

        // Also update legacy fields for backwards compatibility
        updatedState.collectedData.businessProfile = {
          // The typed name wins: it was asked for directly, and the extraction
          // is reading prose that may not contain it at all.
          company_name:
            updatedState.collectedData.businessProfile?.company_name
            || businessStory.company_name
            || undefined,
          vertical: businessStory.vertical,
          language: updatedState.language,
        };
        updatedState.collectedData.businessDescription = businessStory.description;

        /*
         * Straight to how they sell. `client_workflow` is no longer asked.
         *
         * It asked whether prices are set or quoted per client, which sets
         * `pricing_model` and through it each service's `sale_mode`. That is a
         * real field, but it decides no capability — `sale_mode` appears
         * nowhere in `businessShape` or `setupGraph`; it only swaps the client
         * journey's payment step for a quote request. It cost a question and a
         * whole LLM call (`extractClientWorkflow`) for something the services
         * editor can set, and it promised a conversation about prices that no
         * longer follows.
         *
         * The draft generator reads `vertical` and `sub_vertical` off the story
         * extraction above, which is its primary input anyway, so dropping the
         * step costs it nothing.
         *
         * `client_workflow` stays in `ONBOARDING_STEPS` and keeps its handler,
         * for the same reason `payment_collection` and `client_tracking` do: a
         * conversation already standing on it must resume rather than be
         * deleted and restarted in English.
         */
        /*
         * Before how they sell, what they sell it FOR.
         *
         * The interview used to go straight to `service_details`, and everything
         * after it is about configuration: scheduled or not, how the money
         * arrives, how clients find them. Nothing asked who the clients are or
         * what they get — so the profile could configure the platform and had
         * nothing to write a page from. See `businessBrief` for the contract.
         *
         * The step ends itself the moment it has enough or runs out of
         * questions, so a description that already says everything costs no
         * extra turn.
         */
        updatedState.collectedData.businessBrief = EMPTY_BRIEF;
        updatedState.collectedData.briefExchanges = [];
        updatedState.collectedData.followUpsAsked = 0;

        {
          const first = await this.pickFollowUp(
            businessStory.description || ownWords,
            EMPTY_BRIEF,
            updatedState.language,
            owner
          );

          if (first) {
            updatedState.currentStep = 'business_deepening';
            /* The field being asked, PLUS the ones this trade makes obvious.
               Retired through the same list that stops a field being asked
               twice, so `fieldsStillToAsk` excludes them without a second
               mechanism and the brief records no guess for them. */
            updatedState.collectedData.askedBriefFields = [first.field, ...first.skip];
            updatedState.collectedData.pendingBriefField = first.field;
            updatedState.collectedData.pendingBriefQuestion = first.question;
            updatedState.collectedData.followUpsAsked = 1;
            updatedState.pendingQuestion = first.field;
            logger.info({ newStep: 'business_deepening', field: first.field }, 'Asking about the business');
            break;
          }
        }

        updatedState.currentStep = 'service_details';
        updatedState.pendingQuestion = 'sell_scheduled';
        logger.info({ newStep: 'service_details', pendingQuestion: 'sell_scheduled' }, 'Asking how the business sells');
        break;

      /*
       * The follow-ups. One field per turn, at most `MAX_FOLLOW_UPS`.
       *
       * Every answer is kept verbatim in `briefExchanges` as well as being read
       * into the brief, because the owner's own words are what the final
       * description is composed from — the same rule `business_story` applies
       * to the story itself, and for the same reason.
       *
       * A skip is an answer like any other: it is recorded as nothing and the
       * step moves on. Nothing here may block the build.
       */
      case 'business_deepening': {
        const brief = updatedState.collectedData.businessBrief ?? EMPTY_BRIEF;
        const exchanges = updatedState.collectedData.briefExchanges ?? [];
        const asked = updatedState.collectedData.followUpsAsked ?? 0;
        const field = updatedState.collectedData.pendingBriefField;
        const question = updatedState.collectedData.pendingBriefQuestion ?? '';

        const said = message.trim();
        const skipped = said.length < 2 || SKIP_WORDS.has(said.toLowerCase());

        if (!skipped && field) {
          exchanges.push({ field, question, answer: said });
          updatedState.collectedData.briefExchanges = exchanges;
          updatedState.collectedData.businessBrief = mergeIntoBrief(
            brief,
            await this.readBriefAnswer(field, said, owner)
          );
        }

        const current = updatedState.collectedData.businessBrief ?? brief;

        /*
         * Stop at the cap, or when there is nothing left worth asking.
         *
         * NOT when the brief is merely usable. That was the first rule here and
         * it ended the interview after two questions on a real account, before
         * reaching "I only take 8 clients at a time" or "12 years competing,
         * national level" — the very material that stops a page reading like
         * every other business in the trade. The model already declines to ask
         * about anything the story covers, so the cap is the honest ceiling and
         * `isEnough` is left to describe the floor rather than the finish.
         */
        const alreadyAsked = updatedState.collectedData.askedBriefFields ?? [];

        const next =
          asked >= MAX_FOLLOW_UPS
            ? null
            : await this.pickFollowUp(
                updatedState.collectedData.businessDescription || '',
                current,
                updatedState.language,
                owner,
                alreadyAsked
              );

        if (next) {
          updatedState.collectedData.askedBriefFields = [...alreadyAsked, next.field, ...next.skip];
          updatedState.collectedData.pendingBriefField = next.field;
          updatedState.collectedData.pendingBriefQuestion = next.question;
          updatedState.collectedData.followUpsAsked = asked + 1;
          updatedState.pendingQuestion = next.field;
          break;
        }

        /* Their words, all of them — see `composeDescription`. */
        updatedState.collectedData.pendingBriefField = undefined;
        updatedState.collectedData.pendingBriefQuestion = undefined;
        updatedState.collectedData.businessDescription = await this.writeDescription(
          updatedState.collectedData.businessDescription || '',
          exchanges,
          updatedState.language,
          owner
        );
        if (updatedState.collectedData.businessStory) {
          updatedState.collectedData.businessStory.description =
            updatedState.collectedData.businessDescription;
        }

        logger.info(
          { asked: updatedState.collectedData.followUpsAsked, answered: exchanges.length },
          'Business brief collected'
        );

        updatedState.currentStep = 'service_details';
        updatedState.pendingQuestion = this.firstSellingQuestion(updatedState);
        break;
      }

      case 'client_workflow':
        // Extract services and workflow
        const clientWorkflow = await this.extractClientWorkflow(message, owner);

        // One of the three offered answers is not a matter of interpretation.
        const chosenModel = this.pricingModelFromChip(message);
        if (chosenModel) clientWorkflow.pricing_model = chosenModel;

        updatedState.collectedData.clientWorkflow = clientWorkflow;

        /*
         * On to how they sell, ALWAYS — whether or not the story named any
         * services.
         *
         * This used to branch: a business whose bio happened to mention its
         * services skipped the step entirely, so it was never asked whether it
         * books appointments or how it collects money. Those two answers decide
         * whether working hours and a payment processor are required at all, and
         * the business that skipped them was the one most likely to publish a
         * booking page with neither.
         *
         * Anything the story did yield is kept on `clientWorkflow.services` and
         * used first when the drafts are created — the count tops it up rather
         * than replacing it, so a name and price the owner actually typed is
         * never traded for a generated one.
         */
        updatedState.currentStep = 'service_details';
        updatedState.pendingQuestion = 'sell_scheduled';
        logger.info(
          {
            pricingModel: clientWorkflow.pricing_model,
            servicesFromStory: clientWorkflow.services?.length || 0,
          },
          'Asking how the business sells'
        );
        break;

      case 'service_details':
        /*
         * ─────────────────────────────────────────────────────────────────────
         * HOW THEY SELL — three answers, then the catalogue is created as drafts.
         *
         * Only two of these decide a capability, and that is why only two are
         * asked. `is_scheduled` turns on scheduling, availability, the timezone,
         * calendar sync and intake, and raises both blocking publish gaps.
         * `collection` turns on the payments capability, the processor step and
         * the invoice paperwork. Everything else a service carries — price,
         * duration, instalments, quoting — drives no capability and belongs in
         * the services editor, which already has a field for each.
         *
         * Checked, not assumed: `shape.plans` is read in exactly two places
         * (`moneyMoves` and `needsInvoicePaperwork`) and both return true from
         * `collectsOnline`/`invoices` first, so asking about instalments here
         * would change nothing. `hasPricedServices` is read by no predicate at
         * all.
         *
         * The branches below run BEFORE the legacy free-text loop, which is
         * left intact underneath: a conversation that was already standing in
         * `more_services` when this shipped still finishes the way it started.
         * ─────────────────────────────────────────────────────────────────────
         */
        if (state.pendingQuestion === 'sell_scheduled') {
          const scheduled = this.readScheduledAnswer(message, updatedState.language);
          updatedState.collectedData.clientWorkflow = {
            ...updatedState.collectedData.clientWorkflow,
            sells_scheduled: scheduled,
          };
          updatedState.pendingQuestion = 'sell_collection';
          logger.info({ scheduled }, 'Read whether the business books appointments');
          break;
        }

        if (state.pendingQuestion === 'sell_collection') {
          const collection = this.readCollectionMethod(message, updatedState.language);
          updatedState.collectedData.clientWorkflow = {
            ...updatedState.collectedData.clientWorkflow,
            collection_method: collection,
          };
          updatedState.pendingQuestion = 'service_count';
          logger.info({ collection }, 'Read how the business collects money');
          break;
        }

        if (state.pendingQuestion === 'service_count') {
          const count = this.readServiceCount(message);
          if (count === null) {
            // Ask again rather than guess. The figure decides how many rows are
            // written to their catalogue, and a wrong one is cleaned up by hand.
            logger.info({ messageLength: message.length }, 'No count in the reply; asking again');
            break;
          }
          updatedState.collectedData.clientWorkflow = {
            ...updatedState.collectedData.clientWorkflow,
            service_count: count,
          };
          logger.info({ count }, 'Read how many services the business sells');

          /*
           * Name them, now that we know how many.
           *
           * Anything the owner actually typed comes first and is never traded
           * for a generated one: the story sometimes names a service outright,
           * and that name is theirs. The naming call tops the list up to the
           * count, which is the same rule the build applies to `seeded`.
           */
          {
            /*
             * A client that SENT a structured services array gets those names.
             *
             * The chat route accepts `services` (max 40) and passes it
             * through, and the only branch that read it was in the free-text
             * loop removed below — so the API accepted a catalogue and
             * discarded it. Honoured here instead, where it can still decide
             * what gets created: the owner's own names first, the naming call
             * topping up to the count.
             */
            const sent = (submittedServices ?? []).filter(service => service.name?.trim());
            if (sent.length) {
              const already = new Set(
                (updatedState.collectedData.clientWorkflow?.services ?? [])
                  .map(service => service.name?.toLowerCase().trim())
              );
              updatedState.collectedData.clientWorkflow = {
                ...updatedState.collectedData.clientWorkflow,
                services: [
                  ...(updatedState.collectedData.clientWorkflow?.services ?? []),
                  ...sent.filter(service => !already.has(service.name.toLowerCase().trim())),
                ],
              };
              logger.info({ sent: sent.length }, 'Used the services the client sent');
            }

            const named = updatedState.collectedData.clientWorkflow?.services ?? [];
            const owed = count - named.length;

            if (owed > 0) {
              const drafted = await this.draftServices(
                owed,
                updatedState.collectedData.businessDescription || '',
                updatedState.collectedData.businessBrief,
                updatedState.language,
                owner
              );

              /*
               * Stamped with the two business-wide answers before they join
               * the catalogue, and this is not cosmetic.
               * ───────────────────────────────────────────────────────────────
               * `computeConfiguration` reads the catalogue to decide two
               * things, and both read a field. A row carrying a name and
               * nothing else does not just fail to inform them, it INVERTS
               * them, because an empty catalogue has a fallback and a
               * populated one does not:
               *
               *   needs_stripe_connect: `services.length > 0` switches from
               *     the business-wide `collection_method` to
               *     `services.some(collection === 'online')`. Unstamped, an
               *     owner who had just answered "the client pays online by
               *     card" would get no processor. The comment at that line
               *     records this exact bug being fixed once already.
               *
               *   addCapability('scheduling') is the ONLY source of that
               *     capability and keys off the catalogue, so these rows are
               *     what finally switch it on for a business that books, and
               *     must not switch it on for one that does not.
               *
               * A placeholder may be missing a price and a length, which the
               * owner sets. It may not be missing the answers they already
               * gave.
               */
              const sellsScheduled = updatedState.collectedData.clientWorkflow?.sells_scheduled !== false;
              const collectedBy = updatedState.collectedData.clientWorkflow?.collection_method;
              const collection: 'online' | 'invoice' | null =
                collectedBy === 'none' || !collectedBy
                  ? null
                  : collectedBy === 'card_online' || collectedBy === 'mixed'
                    ? 'online'
                    : 'invoice';

              /* Case-insensitively distinct, so a generated name cannot
                 duplicate one the owner gave. */
              const taken = new Set(named.map(service => service.name?.toLowerCase().trim()));
              updatedState.collectedData.clientWorkflow = {
                ...updatedState.collectedData.clientWorkflow,
                services: [
                  ...named,
                  ...drafted
                    .filter(service => !taken.has(service.name.toLowerCase().trim()))
                    .map(service => ({ ...service, is_scheduled: sellsScheduled, collection })),
                ],
              };
            }
          }

          /*
           * ───────────────────────────────────────────────────────────────────
           * INTAKE, asked only of a business that books appointments.
           *
           * `needs_intake` was never set for anybody. Its only writer was
           * `readIntakeNeed`, called from the part of this step that stopped
           * being reachable, and `extractClientWorkflow` DROPPED the field in
           * its own return block while the prompt asked for it and the type
           * declared it. Asked for, discarded, and nothing said so.
           *
           * It is a question rather than an inference on purpose. It creates a
           * `user_intake_settings` row and puts a form in front of the owner's
           * clients; guessing that from prose is the one place in this file
           * where being wrong writes something a stranger has to fill in.
           *
           * Only for appointment businesses, which is the rule the rest of the
           * step follows: a form "before the appointment" has no meaning where
           * there is no appointment.
           * ───────────────────────────────────────────────────────────────────
           */
          if (updatedState.collectedData.clientWorkflow?.sells_scheduled !== false) {
            updatedState.pendingQuestion = 'intake';
            break;
          }

          updatedState.pendingQuestion = undefined;
          updatedState.currentStep = this.nextStepAfterServices(updatedState);
          break;
        }

        if (state.pendingQuestion === 'intake') {
          const needsIntake = this.readIntakeAnswer(message, updatedState.language);
          updatedState.collectedData.clientWorkflow = {
            ...updatedState.collectedData.clientWorkflow,
            needs_intake: needsIntake,
          };
          updatedState.pendingQuestion = undefined;
          updatedState.currentStep = this.nextStepAfterServices(updatedState);
          logger.info({ needsIntake }, 'Read whether clients fill in a form first');
          break;
        }

        /*
         * ─────────────────────────────────────────────────────────────────────
         * THE FREE-TEXT SERVICE LOOP WAS HERE, and was removed on 2026-10-14.
         *
         * 123 lines: a `need_price` branch that chased a figure, a
         * `more_services` loop that asked "any more?" after each one, a
         * duplicate-name merge, and an LLM read of whatever was typed.
         *
         * None of it could run. The live sequence is `sell_scheduled` →
         * `sell_collection` → `service_count`, and each of those branches above
         * `break`s before reaching here; the count then moves the step on. It
         * was reachable only by a conversation stored mid-loop from a deploy
         * before the chips existed, and a count against the conversations table
         * found ZERO standing anywhere near it.
         *
         * It also belonged to a direction we no longer have: the owner sets
         * prices in the services editor, so chasing one here collected what
         * would be overwritten and made the interview a form.
         *
         * Anything that still lands in this step with an unrecognised pending
         * question moves on rather than looping, because a question nobody can
         * answer is worse than a step skipped.
         * ─────────────────────────────────────────────────────────────────────
         */
        updatedState.pendingQuestion = undefined;
        updatedState.currentStep = this.nextStepAfterServices(updatedState);
        logger.info(
          { pendingQuestion: state.pendingQuestion },
          'Unrecognised service question; moving on'
        );
        break;

      case 'payment_collection': {
        // One answer decides the whole money branch of their setup: a card
        // processor, or bank details on an invoice, or nothing at all.
        const collection = this.readCollectionMethod(message, updatedState.language);

        updatedState.collectedData.clientWorkflow = {
          ...updatedState.collectedData.clientWorkflow,
          collection_method: collection,
        };
        logger.info({ collection }, 'Collection method chosen');

        updatedState.currentStep = 'client_acquisition';
        break;
      }

      case 'client_acquisition':
        // Q4: Extract how clients find them (determines website need)
        const clientAcquisition = await this.extractClientAcquisition(message);
        updatedState.collectedData.clientAcquisition = clientAcquisition;
        logger.info({ clientAcquisition }, 'Client acquisition extracted');

        /*
         * The last question. Q5 — "how do you track clients today?" — used to
         * follow, and it decided whether the business got a CRM at all.
         *
         * It cannot decide that any more, because CRM is structural: contacts
         * are a NOT NULL foreign key on bookings, invoices, proposals, tasks
         * and activities, and the pipeline is seeded for everyone. A business
         * that answered "I already have a CRM" still got contacts — it just
         * got them with no stages to put them in.
         *
         * So it is not asked. The interview ends where the answers still
         * change something.
         */
        this.finalizeConfiguration(updatedState);
        updatedState.currentStep = 'preview';
        break;

      /*
       * Retired. Reachable only by a conversation that was already standing
       * here when the question was removed — whatever they say moves on to the
       * plan rather than being read as an answer that decides nothing.
       */
      case 'client_tracking':
        this.finalizeConfiguration(updatedState);
        updatedState.currentStep = 'preview';
        break;

      case 'preview':
        // Check for confirmation
        const isConfirm = this.isConfirmation(message, updatedState.language);

        if (isConfirm) {
          updatedState.currentStep = 'building';
        } else {
          // User wants to change something
          updatedState.currentStep = 'preview_adjustment';
        }
        break;

      case 'preview_adjustment':
        // Handle adjustment request
        // Recorded under the current group even when the intent is a restart:
        // this call belongs to the conversation that is ending.
        const adjustment = await this.extractAdjustmentIntent(message, owner);
        // The intent is a label; its details are the owner's request as the
        // model read it, so they go to debug only (OI-8).
        logger.info(intentFields(adjustment.intent), 'Adjustment intent extracted');
        logger.debug({ adjustment }, 'Adjustment intent extracted: details');

        if (adjustment.intent === 'confirm') {
          updatedState.currentStep = 'building';
        } else if (adjustment.intent === 'restart') {
          // Reset to beginning
          return this.getInitialState(updatedState.language);
        } else {
          // Apply the adjustment based on intent
          this.applyAdjustment(updatedState, adjustment);

          // Re-finalize configuration with updated data
          this.finalizeConfiguration(updatedState);

          // Go back to preview with updated configuration
          updatedState.currentStep = 'preview';
        }
        break;

      case 'building':
        updatedState.currentStep = 'complete';
        break;
    }

    return updatedState;
  }

  /**
   * Finalize configuration after collecting all required data
   */
  private finalizeConfiguration(state: OnboardingState): void {
    const clientWorkflow = state.collectedData.clientWorkflow || {};

    // Merge all extracted data including the Q4 acquisition extraction
    const extractedData: ExtractedData = {
      ...state.collectedData.businessStory,
      ...clientWorkflow,
      /*
       * The TYPED name wins — the same rule the business_story step already
       * applies, and the one place it was missing.
       *
       * The name is asked for outright and stored on `businessProfile`. What is
       * spread above is `businessStory`, whose `company_name` is whatever the
       * model could pull out of a paragraph about the business — and most
       * paragraphs do not contain it. "I'm a private trainer, I offer training
       * packages" names no business, so it came out undefined, and
       * `computeConfiguration` filled the gap with its fallback: every account
       * whose story did not happen to repeat its own name was built, invoiced
       * and emailed as "My Business".
       */
      company_name:
        state.collectedData.businessProfile?.company_name
        || state.collectedData.businessStory?.company_name,
      // Include Q4: client acquisition data (for website decision)
      clientAcquisition: state.collectedData.clientAcquisition,
      // Retired, and read only from a conversation that still carries it.
      clientTracking: state.collectedData.clientTracking,
      /* What the follow-ups established. Carried into the configuration so the
         build persists it and the pre-build summary can show it back. */
      business_brief: state.collectedData.businessBrief,
    };
    state.collectedData.extractedData = extractedData;

    // Compute configuration with translated pipeline stages
    const configuration = this.configService.computeConfiguration(extractedData, state.language);
    state.collectedData.configuration = configuration;

    // Use the translated pipeline from configuration (already computed with correct language)
    state.collectedData.pipelineStages = configuration.pipeline_stages;
    state.collectedData.wantsWebsite = configuration.online_presence_mode !== 'none';

    // Convert services to legacy format.
    //
    // This shape is the one the build prefers, so anything dropped here is
    // dropped for good. Four things used to be: a quoted price became free
    // (`|| 0`), the currency was replaced by a guess from the reading language,
    // the instalment arrangement vanished — so "6000₪ or twelve monthly
    // payments" arrived as a free service with no plan — and HOW the service is
    // sold went with them, so a job quoted per client arrived as one anybody
    // could book and pay for on the spot.
    if (clientWorkflow.services && clientWorkflow.services.length > 0) {
      const fallbackCurrency = CURRENCY_BY_LANGUAGE[state.language];
      state.collectedData.services = clientWorkflow.services.map(s => {
        const scheduled = s.is_scheduled !== false;
        const priced = s.price !== null && s.price !== undefined && s.price > 0;
        return {
          service_name: s.name,
          /* The owner's sentence about this service. Dropped here is dropped
             for good: this shape is the one the build prefers. */
          description: s.description?.trim() || undefined,
          // Kept whatever they said, booked or not: a workshop can run two
          // hours and still be sold as a product. Null only where no length
          // was ever given — coercing that to 60 minutes is what made every
          // service look like an appointment.
          duration_minutes: s.duration_minutes ?? null,
          // Null is "we agree it per client"; only an explicit 0 is free.
          price: s.price === null || s.price === undefined ? null : s.price,
          // What they wrote the price in, and the language only where they never said.
          currency: s.currency || fallbackCurrency,
          is_scheduled: scheduled,
          // Never 'online' by default: that is the one value that makes a card
          // processor mandatory, and nobody has asked for one yet.
          collection:
            s.sale_mode === 'proposal'
              ? null
              : priced
                ? (s.collection === 'online' ? 'online' : 'invoice')
                : null,
          // Quoted or bought outright. Dropping this was how a bespoke
          // programme arrived directly bookable.
          sale_mode: s.sale_mode === 'proposal' ? 'proposal' : 'direct',
          // The gap between appointments, where they asked for one. Only
          // meaningful for something booked against a time.
          buffer_minutes: scheduled ? s.buffer_minutes ?? undefined : undefined,
          payment_plan: s.payment_plan || null,
        };
      });
    }

    logger.info({
      vertical: configuration.vertical,
      servicesCount: state.collectedData.services?.length || 0,
      pipelineStages: state.collectedData.pipelineStages?.length || 0,
    }, 'Configuration finalized');
  }

  /**
   * Extract business story using LLM
   */
  /**
   * Which gap to probe next, and how to word it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The model is given the CONTRACT — every field, what counts as an answer,
   * and why a page is worse without it — plus what the owner has already said.
   * It decides. A story that already names the audience must not be asked who
   * the audience is, and that judgement needs to read the prose rather than
   * count empty arrays.
   *
   * It phrases the question itself, in the owner's language, referring to what
   * they actually wrote: "who are the gymnasts you work with?" beats "who is
   * your target audience?" every time. `BRIEF_FIELDS.example` sets the register
   * and is deliberately not the question.
   *
   * Returns null when nothing is worth asking, which ends the step early — the
   * cap is a ceiling, not a quota.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /**
   * Which selling question to open on — skipping the one we already have.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * ONLY `sell_scheduled`, and only on an EXPLICIT answer. The narrowness is
   * the point.
   *
   * Skipping here has been tried before and reverted. `client_workflow` records
   * it: a business whose bio happened to mention services skipped the whole
   * step, "so it was never asked whether it books appointments or how it
   * collects money… the business that skipped them was the one most likely to
   * publish a booking page with neither". That skip keyed off a weak signal —
   * services being named — and dropped three answers at once.
   *
   * This one keys off `needs_booking`, which the story extraction returns as
   * true, false, or NULL when it could not tell, and drops exactly one
   * question. Null means ask: an absent answer is not an answer.
   *
   * `sell_collection` and `service_count` are never skipped. Nothing in the
   * story tells us how the money arrives, and the count decides how many rows
   * are written to a real catalogue — the file says as much where it refuses to
   * guess one. Inferring either is how the reverted bug happened.
   *
   * What was taken as read still reaches the owner: the pre-build summary shows
   * the journey and the capabilities that follow from it, and "change it" at
   * that point is a supported answer.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private firstSellingQuestion(state: OnboardingState): string {
    const booking = state.collectedData.businessStory?.needs_booking;

    if (booking === true || booking === false) {
      state.collectedData.clientWorkflow = {
        ...state.collectedData.clientWorkflow,
        sells_scheduled: booking,
      };
      logger.info({ sellsScheduled: booking }, 'The story already said whether they book; not asking again');
      return 'sell_collection';
    }

    return 'sell_scheduled';
  }

  /**
   * The description the business ends up with: everything they said, joined.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * NOT a paraphrase, and this is the whole point.
   *
   * `business_story` already keeps the owner's typed words over the model's
   * summary, because the extraction once rewrote a Hebrew answer in English and
   * that restatement became the source text for an entire website. The follow-up
   * answers are their words too, so the composition is a join rather than a
   * rewrite: the original sentence, then what each answer added, in the order
   * they said it.
   *
   * Done here in code rather than by a model so there is no opportunity to
   * invent, translate or flatter. It reads a little plainly; it is true, it is
   * in their language, and it is the thing they will recognise when they come
   * to correct it in settings.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private composeDescription(story: string, answers: string[]): string {
    const parts = [story.trim(), ...answers.map(a => a.trim())].filter(Boolean);
    if (!parts.length) return story;

    /* A full stop only where the owner did not write one, so their own
       punctuation survives and nothing gains a second. */
    return parts
      .map(part => (/[.!?…׃׳"'\u05f4]$/.test(part) ? part : `${part}.`))
      .join(' ');
  }

  /**
   * The same answers, written as prose a person would read.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY A MODEL AND NOT THE JOIN ABOVE.
   *
   * Joining in code was the first attempt, chosen to make invention and
   * language drift impossible. What it produced on a real account:
   *
   *   "I'm gymnastic trainer providing training sessions. all. they get better
   *    diet and training plan and the results are amazing. private training
   *    that focus on the trainee and his goals. I was an army trainer for 10
   *    years. they do not where to start."
   *
   * Two things are wrong and neither is fixable with punctuation. "all." is an
   * answer to a question that is no longer on screen, so as a sentence it means
   * nothing. And "they do not where to start" is an OBJECTION — what clients
   * feel — sitting in a paragraph that otherwise describes the business, where
   * it reads as a statement about the trainer.
   *
   * This is the business's public description and the source text for its
   * website. It has to read.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THE MODEL MAY AND MAY NOT DO
   *
   * It joins. It does not embellish. The constraints are not politeness — the
   * reason the code version existed is that an extraction once rewrote a Hebrew
   * answer in English and that restatement became a whole website's source
   * text. So: same language, no claim absent from the answers, no adjectives
   * the owner did not use.
   *
   * A failure falls back to the join. A clumsy description is recoverable; an
   * empty one stops the build.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async writeDescription(
    story: string,
    exchanges: Array<{ field: BriefField['key']; question: string; answer: string }>,
    language: Language,
    owner: BosLlmOwner
  ): Promise<string> {
    const joined = this.composeDescription(story, exchanges.map(e => e.answer));
    if (!exchanges.length) return joined;

    const factory = getProviderFactory();
    const context = this.callContext(owner, 'business_deepening');
    const settings = await resolveBosLlmSettings('onboarding', 'business_deepening');

    const system = [
      'You are writing a business\'s description from what its owner told you.',
      '',
      'THE DESCRIPTION ANSWERS TWO THINGS: who this business is, and what it does.',
      'Everything else — who its clients are, what they get, what makes it the choice,',
      'what stands behind it, what holds people back — belongs in it only insofar as',
      'it says who they are and what they do. It is read by a person deciding whether',
      'to get in touch, and it is the source text for their website.',
      '',
      'You are given what they first wrote, then each follow-up QUESTION (Q1, Q2 …)',
      'with the answer it got (A1, A2 …). READ EACH ANSWER THROUGH ITS QUESTION:',
      '"all" against a question about who comes to them means they work with everyone;',
      'an answer to a question about what worries people is about their CLIENTS, not',
      'about the owner.',
      '',
      'Use every answer that says WHO THEY ARE or WHAT THEY DO — their clients, what',
      'those clients get, what makes them the choice, what they trained in. None of',
      'those may be dropped: an owner answered a question for it.',
      '',
      'What people WORRY about before buying is not who the business is. It is kept',
      'elsewhere and drives the questions their website answers, so leave it out here',
      'unless it genuinely describes the work — "most of my clients arrive not knowing',
      'where to start" says something about who they serve; "people think it is',
      'expensive" does not.',
      '',
      'RULES:',
      '- SAME LANGUAGE as the owner wrote in. Never translate. This is the one',
      '  mistake that cannot be undone: it becomes the source text for their website.',
      '',
      'INVENT NO FACTS. No number, qualification, year, credential, location, price or',
      'claim about results that the answers do not contain. And none of the words a',
      'business writes about itself when it has nothing to say: passionate, dedicated,',
      'premium, world-class, cutting-edge, state-of-the-art, bespoke, holistic. If the',
      'owner did not say it, it is not true yet.',
      '',
      'DO NOT INFER A QUALITY FROM A FACT. "Army trainer for 10 years" does not',
      'license "disciplined"; "private sessions" does not license "attentive". The',
      'fact is what they said and it speaks for itself; the adjective is you adding a',
      'compliment on their behalf, to be published under their name.',
      '',
      'DO NOT CLOSE WITH A SUMMARY. No final sentence promising what the approach',
      '"ensures" or what clients "can expect". That sentence is always invented — it',
      'is the one place there was nothing left to report, so something was made up.',
      '',
      'WRITE IT PROPERLY, though. Within that, this is prose and not a transcript:',
      '- Open with who they are and what they do. That is the sentence someone reads',
      '  first and decides on.',
      '- Group what belongs together rather than following the order they were asked.',
      '  Their background and their approach sit well in one sentence; the clients and',
      '  what those clients get sit well in another.',
      '- Join the sentences like a person would. Ordinary connecting words are not',
      '  invented claims.',
      '- Keep their own phrasing wherever it already reads, especially anything',
      '  specific — "army trainer for 10 years" is better than "extensive experience",',
      '  and a vague paraphrase of a concrete answer is a loss.',
      '- Turn a fragment into a sentence using the question it answered: "all" after a',
      '  question about clients becomes "I work with all kinds of clients".',
      '- Something they said people WORRY about is about their clients, not about them.',
      '- Four to seven sentences, 80 to 150 words. One paragraph, no headings, no',
      '  bullet points, no preamble, no sign-off.',
      '',
      'Return JSON: {"description": "<the description>"}',
    ].join('\n');

    try {
      const { result: response } = await withModelFallback(settings, (model) => factory.complete({
        model,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              `Language: ${language}`,
              'What they first wrote:',
              story,
              '',
                'Then each question they were asked, and what they answered:',
              '',
              /* Numbered pairs rather than a list of replies. An answer read
                 without its question is a fragment — "all" on its own is noise
                 — and the pairing is what lets a one-word reply become the
                 sentence it was meant to be. */
              ...exchanges.flatMap((e, i) => [
                `Q${i + 1} (${e.field}): ${e.question}`,
                `A${i + 1}: ${e.answer}`,
                '',
              ]),
            ].join('\n'),
          },
        ],
        response_format: { type: 'json_object' },
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      }, context));

      const written = JSON.parse(response.content)?.description;

      if (typeof written !== 'string' || written.trim().length < 20) {
        logger.warn('The written description came back unusable; keeping the joined answers');
        return joined;
      }

      /* Same reason as the question: this text is read by the owner on the
         plan card and becomes the source for the website. */
      return withoutDashPunctuation(written.trim());
    } catch (error) {
      logExtractionFailure(error, 'Writing the description failed');
      return joined;
    }
  }

  private async pickFollowUp(
    story: string,
    brief: BusinessBrief,
    language: Language,
    owner: BosLlmOwner,
    alreadyAsked: BriefField['key'][] = []
  ): Promise<{
    field: BriefField['key'];
    question: string;
    /**
     * Fields this business should never be asked about.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * WHY A SKIP LIST AND NOT JUST "DECLINE EACH TIME".
     *
     * The prompt has always allowed `{"field": null}`, and with six fields and
     * a budget of six the model never used it. Measured on a hair salon:
     *
     *     "What do kids end up with after a visit to your salon
     *      that they didn't have before?"      > better hait style
     *     "Can you describe the process of what happens when someone
     *      books a hair appointment, from start to finish?"
     *                                          > they book time and come
     *
     * Both answers are the question restated, because for a haircut the
     * outcome IS the haircut and the process IS the appointment. Those two
     * fields exist for work that is opaque to the buyer: a coach, a
     * consultant, a course, a programme. Asked of a salon they cost two turns
     * and returned nothing, and the owner reported having to invent answers.
     *
     * Declaring them dead ONCE, up front, is what makes the interview
     * different per trade. It reuses `askedBriefFields`, so a retired field is
     * excluded by the same `fieldsStillToAsk` that stops a field being asked
     * twice, and the brief simply holds nothing for it: no guess is recorded.
     * ─────────────────────────────────────────────────────────────────────────
     */
    skip: BriefField['key'][];
  } | null> {
    /* Missing AND not already put to them — see `fieldsStillToAsk`. */
    const outstanding = fieldsStillToAsk(brief, alreadyAsked);
    if (!outstanding.length) return null;

    const factory = getProviderFactory();
    const context = this.callContext(owner, 'business_deepening');
    /* Its own catalogue entry, so the ledger can say what this cost and the
       model can be read from its own row rather than borrowed from the story
       extractor's. */
    const settings = await resolveBosLlmSettings('onboarding', 'business_deepening');

    const system = [
      'You are interviewing a business owner so that someone else could write their website.',
      'You are given the fields we are trying to end up holding, what the owner has said so far,',
      'and what is still missing. Choose the ONE field most worth asking about next, and write',
      'the question.',
      '',
      'WHAT WE ARE COLLECTING:',
      briefContract(),
      '',
      'RULES:',
      '- Ask about ONE field. Choose the one whose absence would hurt the page most.',
      '- If the description already answers a field well enough to write from, do NOT ask about it.',
      '- If nothing is worth asking, return {"field": null}.',
      /*
       * The test that separates a question worth a turn from a question that
       * returns its own premise. Both failures below are measured, from one
       * hair salon interview.
       */
      '- SKIP ANY FIELD WHOSE ANSWER IS ALREADY OBVIOUS FROM THE TRADE. Before asking,',
      '  predict the answer. If your prediction is the question restated, the question is',
      '  worthless and the owner will have to invent something to fill it. A hair salon',
      '  asked what the client walks away with answers "a better haircut". A salon asked',
      '  to walk through its process answers "they book and come in". Put every such',
      '  field in "skip" and never ask it. Judge each field against THIS trade: the same',
      '  two questions are essential for a coach, a consultant, a course or a programme,',
      '  where the buyer genuinely cannot picture the work.',
      '- Three sharp questions beat six dutiful ones. The budget is a ceiling, not a',
      '  quota, and an owner inventing an answer is worse than an unanswered field: it',
      '  becomes a claim on their website that they did not make.',
      '- For "delivery", ask about the WORK, never about booking or paying. If the work',
      '  is a single visit with nothing to describe, skip it.',
      '- Write the question in the owner\'s own language, referring to what they actually said.',
      '- One sentence. No preamble, no "great!", no explaining why you are asking.',
      '- NEVER ask about prices, opening hours, service names, or how payment is taken.',
      '  Those are asked elsewhere and owned by an editor; asking here creates a second answer.',
      '',
      /*
       * HOW the question is phrased decides whether the answer is usable, and
       * each of these four is a measured failure rather than a style note. The
       * examples in the contract above demonstrate them; these state them,
       * because a model obeys a rule more reliably than it imitates a sample.
       */
      'HOW TO WRITE THE QUESTION:',
      '- Ask for something the owner can REMEMBER, not something they have to work out:',
      '  "what is the last thing a client asked you?" beats "what do clients worry about?".',
      '- NEVER offer options to choose from. "Are they beginners, athletes, or amateurs?"',
      '  was asked and answered "all kind" - which is true, and useless. Ask openly.',
      '- NEVER ask the owner to characterise themselves. "What makes you different?" returns',
      '  "professional" and "personalised", the very copy this interview exists to prevent.',
      '  Ask what a CLIENT said or did instead.',
      '- Assume nothing about the shape of the work: not "after a few months", not "each',
      '  session", not "every week". A one-off job and a year-long programme both answer this.',
      '- No dashes of any kind between clauses, em, en or hyphen. Use a comma,',
      '  a colon or a full stop. A dash joins two half-thoughts without saying',
      '  how they relate, which is why it reads flat.',
      '',
      'Return JSON: {"field": "<one of: ' + BRIEF_FIELDS.map(f => f.key).join(', ') +
        '> or null", "question": "<the question>", "skip": ["<fields whose answer this trade makes obvious>"]}',
    ].join('\n');

    try {
      const { result: response } = await withModelFallback(settings, (model) => factory.complete({
        model,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              `Language: ${language}`,
              `What the owner wrote about their business:`,
              story,
              '',
              'Already known:',
              briefSoFar(brief),
              '',
              `Still missing: ${outstanding.map(f => f.key).join(', ')}`,
            ].join('\n'),
          },
        ],
        response_format: { type: 'json_object' },
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      }, context));

      const picked = JSON.parse(response.content);
      /* Only from what was offered. A model that returns a field already asked
         would restart the loop this list exists to prevent. */
      const field = outstanding.find(f => f.key === picked.field);

      if (!field || typeof picked.question !== 'string' || !picked.question.trim()) return null;

      /* Shown verbatim in the chat, so the dash goes here rather than being
         asked for in the prompt: forbidding the em dash moved the model to a
         spaced hyphen, which changed the character and not the habit. */
      /*
       * Only names we recognise, never the field being asked right now, and
       * never one that fills a whole SECTION.
       *
       * `feedsASection` is declared on the contract itself rather than listed
       * here, so a new field states its own cost. Measured: on a tutoring
       * account the picker retired `delivery` on its first choice, and the
       * published How-It-Works was then written from the booking flow —
       * "Initial Consultation / Customized Learning Plan / Ongoing Support",
       * true of any tutor anywhere.
       */
      const declared: BriefField['key'][] = Array.isArray(picked.skip) ? picked.skip : [];
      const protectedFields = BRIEF_FIELDS.filter(f => f.feedsASection).map(f => f.key);
      const skip = declared.filter(
        (key: unknown): key is BriefField['key'] =>
          BRIEF_FIELDS.some(f => f.key === key)
          && key !== field.key
          && !protectedFields.includes(key as BriefField['key'])
      );

      const refused = declared.filter(key => protectedFields.includes(key as BriefField['key']));
      if (refused.length) {
        logger.info({ refused }, 'Declined to retire a field that fills a whole section');
      }

      if (skip.length) {
        logger.info({ field: field.key, skip }, 'Retiring brief fields this trade makes obvious');
      }

      /* Shown verbatim in the chat, so the dash goes here rather than being
         asked for in the prompt: forbidding the em dash moved the model to a
         spaced hyphen, which changed the character and not the habit. */
      return { field: field.key, question: withoutDashPunctuation(picked.question.trim()), skip };
    } catch (error) {
      logExtractionFailure(error, 'Choosing the next onboarding question failed');
      /* No question rather than a wrong one. The interview carries on and the
         brief keeps whatever it already has. */
      return null;
    }
  }

  /**
   * The placeholder services, named from what the owner already told us.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS EXISTS AT ALL
   *
   * The interview asks how MANY things the business sells and deliberately not
   * what each one is: collecting a catalogue field by field in a chat is where
   * owners stopped, and the price and the length belong to the services editor
   * either way. The build then creates that many rows.
   *
   * With only a number, those rows were called "Service 1", "Service 2",
   * "Service 3". The website generates its catalogue from them, so a business
   * whose owner had just spent six turns describing their work got a services
   * section listing three numbered blanks.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY NAMING THEM HERE IS NOT THE INVENTION THIS FILE OTHERWISE REFUSES
   *
   * Everywhere else, an invented fact becomes a published claim: the
   * testimonials guidance that produced "Sarah M." for a business with no
   * clients, the guessed country code on an exported phone number, the price
   * printed as "On request" that nobody set.
   *
   * A draft service is different in kind, and it is checked rather than
   * assumed: `createMany` writes `status: 'draft'`, `is_active: false`, and
   * every public surface resolves its catalogue through
   * `SchedulingRepository.listBookable`, which requires BOTH. So nothing here
   * can be booked, shown or paid for until the owner opens it, reads it and
   * publishes it. A placeholder is meant to be replaced; the question is only
   * whether it helps them when they get there, and "Haircut for kids" helps
   * where "Service 2" does not.
   *
   * The description is held to the usual rule regardless: it may use their
   * words and may not add facts. No price, no duration, no credential, no
   * claim about results.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async draftServices(
    count: number,
    story: string,
    brief: BusinessBrief | undefined,
    language: Language,
    owner: BosLlmOwner
  ): Promise<ExtractedService[]> {
    const factory = getProviderFactory();
    const context = this.callContext(owner, 'service_drafting');
    const settings = await resolveBosLlmSettings('onboarding', 'service_drafting');

    const system = [
      `You are naming ${count} service${count === 1 ? '' : 's'} for a business, from what its owner has told you.`,
      'These become DRAFT rows the owner opens and edits before anything is public.',
      '',
      'FOR EACH SERVICE:',
      '- "name": what a client would see on a booking page. Two to four words, no price,',
      '  no duration, no marketing adjective. In the owner\'s own language.',
      '- "description": one or two sentences saying what it is and who it suits, built from',
      '  what the owner actually said. Their phrasing where they have one.',
      '',
      'RULES:',
      '- Use what they described FIRST. If they walked you through their work, the steps of',
      '  that work are usually the services, in that order.',
      `- Return exactly ${count}. If their words support fewer, the remainder should be the`,
      '  plainest thing a business of this kind offers, named plainly. Do not pad the list',
      '  with variations of one service to reach the number.',
      '- NEVER state a price, a length, a qualification, or a result. Not in the name and',
      '  not in the description. Those are facts we do not have, and this text is the source',
      '  the website is written from.',
      '- No dashes between clauses. Use a comma, a colon or a full stop.',
      '- Write everything in the owner\'s language.',
      '',
      'Return JSON: {"services": [{"name": "...", "description": "..."}]}',
    ].join('\n');

    const context_lines = [
      `Language: ${language}`,
      'What the owner said about the business:',
      story || '(nothing)',
    ];

    if (brief?.delivery?.length) {
      /* The answer written to describe the WORK, which is the closest thing the
         interview holds to a list of services. */
      context_lines.push('', 'How the work runs, in their words:', brief.delivery.join('; '));
    }
    if (brief?.audience?.length) context_lines.push('', `Who it is for: ${brief.audience.join('; ')}`);
    if (brief?.outcome?.length) context_lines.push('', `What the client gets: ${brief.outcome.join('; ')}`);

    try {
      const { result: response } = await withModelFallback(settings, (model) => factory.complete({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: context_lines.join('\n') },
        ],
        response_format: { type: 'json_object' },
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      }, context));

      const parsed = JSON.parse(response.content)?.services;
      if (!Array.isArray(parsed)) return [];

      const drafted: ExtractedService[] = parsed
        .filter((row: unknown): row is { name: string; description?: unknown } =>
          !!row && typeof (row as { name?: unknown }).name === 'string'
          && (row as { name: string }).name.trim().length > 0
        )
        .slice(0, count)
        .map((row) => ({
          name: withoutDashPunctuation(row.name.trim()),
          description:
            typeof row.description === 'string' && row.description.trim()
              ? withoutDashPunctuation(row.description.trim())
              : undefined,
          /* Everything else is the business-wide answer or the editor's. A
             duration or a price invented here is the failure this whole change
             exists to undo. */
        }));

      logger.info({ wanted: count, drafted: drafted.length }, 'Named the draft services');
      return drafted;
    } catch (error) {
      logExtractionFailure(error, 'Naming the draft services failed');
      /* The build still creates `service_count` rows with its own names. A
         failed naming call is a worse catalogue, never a missing one. */
      return [];
    }
  }

  /**
   * Read one answer into the brief.
   *
   * Structured against the same contract the question came from, so what is
   * asked and what is stored cannot drift. Only ever records what the owner
   * said: an answer about the audience may legitimately also reveal an
   * objection, and both are kept — but nothing is inferred that the words do
   * not support, because this text becomes public copy.
   */
  private async readBriefAnswer(
    field: BriefField['key'],
    answer: string,
    owner: BosLlmOwner
  ): Promise<Partial<BusinessBrief>> {
    const factory = getProviderFactory();
    const context = this.callContext(owner, 'business_deepening');
    /* Its own catalogue entry, so the ledger can say what this cost and the
       model can be read from its own row rather than borrowed from the story
       extractor's. */
    const settings = await resolveBosLlmSettings('onboarding', 'business_deepening');

    const system = [
      'You are recording what a business owner just told you, as structured data.',
      '',
      'THE FIELDS:',
      briefContract(),
      '',
      'RULES:',
      `- The question was about "${field}". Put what they said THERE, always.`,
      '- You may ALSO record it under another field it clearly speaks to. That is an',
      '  addition, never a substitution: the owner was answering the question they',
      '  were asked, and that field is the one that will not be asked again.',
      '- Record ONLY what the words support. Invent nothing, infer nothing, flatter nothing.',
      '  This text becomes the public copy of a real business.',
      '- A GENERAL answer is still an answer. "all kinds", "anyone really", "all ages"',
      '  means the audience is general — record it as that, in their words. Returning',
      '  nothing for an answer they actually gave throws away what they said.',
      '- Keep their phrasing. Do not translate, tidy or professionalise it.',
      '- Short entries: one claim each, not sentences joined by commas.',
      '- "voice": "individual" if they speak as one person ("I train…"), "team" if as a group',
      '  ("we train…"). null if the answer does not say.',
      '- If they declined to answer, or said nothing usable, return every field empty.',
      '',
      /* `delivery` was missing from this list while being a field of the
         contract above, so an answer about how the work runs had nowhere to go
         even when the owner described it. */
      'Return JSON with any of: audience, outcome, differentiators, credentials,',
      'objections, delivery (arrays of strings), and voice.',
    ].join('\n');

    try {
      const { result: response } = await withModelFallback(settings, (model) => factory.complete({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: answer },
        ],
        response_format: { type: 'json_object' },
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      }, context));

      const read = JSON.parse(response.content);
      const list = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()) : [];

      const recorded = {
        audience: list(read.audience),
        outcome: list(read.outcome),
        differentiators: list(read.differentiators),
        credentials: list(read.credentials),
        objections: list(read.objections),
        delivery: list(read.delivery),
      };

      /*
       * ───────────────────────────────────────────────────────────────────────
       * THE FIELD THAT WAS ASKED ALWAYS GETS THE ANSWER.
       *
       * Measured on a real account, with four questions asked and two fields
       * left empty:
       *
       *   asked differentiators: "what have students or their parents told you
       *     made them choose you over another trainer?"
       *   > many years of experience        -> filed under CREDENTIALS only
       *
       *   asked objections: "what is the last thing a parent asked before
       *     deciding to work with you?"
       *   > that I make sure the kids showing progress  -> filed under OUTCOME
       *
       * Both readings are defensible — experience IS a credential — but both
       * fields then stayed empty, and `askedBriefFields` had already spent the
       * question, so neither was ever asked again. The FAQ and the
       * differentiators paragraph had nothing, from answers the owner gave.
       *
       * The prompt says to put it there and the model reclassified anyway, so
       * the guarantee is here instead of in the wording. Their own words,
       * verbatim, under the question they were answering.
       * ───────────────────────────────────────────────────────────────────────
       */
      if (!recorded[field].length) {
        recorded[field] = [answer.trim()];
        logger.info({ field }, 'The answer was filed elsewhere; recording it under the field that was asked');
      }

      return {
        ...recorded,
        voice: read.voice === 'individual' || read.voice === 'team' ? read.voice : null,
      };
    } catch (error) {
      logExtractionFailure(error, 'Reading a follow-up answer failed');
      /* The answer is still kept verbatim in `briefExchanges` and still reaches
         the final description — only the structured read is lost. */
      return {};
    }
  }

  private async extractBusinessStory(message: string, owner: BosLlmOwner): Promise<BusinessStoryExtraction> {
    const factory = getProviderFactory();
    const context = this.callContext(owner, 'business_story_extraction');
    /*
     * Onboarding cannot be switched off (DEC-5, user BQ-1), so `enabled` is
     * always true here; only the model comes from configuration (FR-12). The
     * temperature is sent ONLY if one is resolved — these four have always sent
     * none, and the area row seeds `null` to keep it that way (FR-4).
     */
    const settings = await resolveBosLlmSettings('onboarding', 'business_story_extraction');

    try {
      const { result: response } = await withModelFallback(settings, (model) => factory.complete({
        model,
        messages: [
          { role: 'system', content: businessStoryPrompt() },
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      }, context));

      const extracted = JSON.parse(response.content);
      logger.debug({ extracted }, 'Extracted business story'); // derived owner text: debug only (OI-8)

      /*
       * Four fields, each of which decides something. The seven that used to
       * be here are documented above `businessStoryPrompt`: two were discarded
       * by this class on arrival, four had no consumer, one competed with the
       * brief.
       *
       * `'default'` rather than `'other'` as the fallback: `other` is not a key
       * of `PIPELINE_PRESETS`, so it fell through to the default preset anyway,
       * by accident rather than by saying so.
       */
      return {
        vertical: extracted.vertical || 'default',
        sub_vertical: extracted.sub_vertical || undefined,
        needs_website: extracted.needs_website ?? undefined,
        needs_booking: extracted.needs_booking ?? undefined,
        /* Absent means YES. A model that forgets the field must never cost the
           owner a repeated question. */
        describes_business: extracted.describes_business !== false,
      };
    } catch (error) {
      logExtractionFailure(error, 'Business story extraction failed');
      // Return defaults
      /*
       * A failed read leaves the business on the default pipeline and leaves
       * both booleans unanswered, so the chat asks rather than assumes.
       *
       * `describes_business: true` on purpose: a provider error is not evidence
       * that the owner said nothing, and asking them to type it again because
       * our call failed is the worst possible reading of it.
       */
      return { vertical: 'default', describes_business: true };
    }
  }

  /**
   * Extract client workflow using LLM
   */
  private async extractClientWorkflow(message: string, owner: BosLlmOwner): Promise<ClientWorkflowExtraction> {
    const factory = getProviderFactory();
    const context = this.callContext(owner, 'client_workflow_extraction');
    /*
     * Onboarding cannot be switched off (DEC-5, user BQ-1), so `enabled` is
     * always true here; only the model comes from configuration (FR-12). The
     * temperature is sent ONLY if one is resolved — these four have always sent
     * none, and the area row seeds `null` to keep it that way (FR-4).
     */
    const settings = await resolveBosLlmSettings('onboarding', 'client_workflow_extraction');

    try {
      const { result: response } = await withModelFallback(settings, (model) => factory.complete({
        model,
        messages: [
          { role: 'system', content: CLIENT_WORKFLOW_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      }, context));

      const extracted = JSON.parse(response.content);
      logger.debug({ extracted }, 'Extracted client workflow'); // derived owner text: debug only (OI-8)

      /*
       * Names and descriptions. The three business-wide guesses that used to
       * be defaulted here are gone, and one of them was harmful.
       *
       * `payment_timing: 'before'` reached `computeCollectionMethod`, whose
       * first branch is `case 'before': return 'card_online'` — so a value
       * nobody had stated could demand a Stripe account. The comment on that
       * function's default branch argues the opposite at length: an invoice
       * "asks for bank details they already have, rather than sending them
       * through a Stripe identity check they may not need at all". Omitting
       * the field reaches that default instead.
       *
       * `pricing_model` and `booking_method` were read with `=== 'custom'` and
       * `!== 'manual'`, which land identically on undefined. How the money
       * arrives is asked outright now and read from a chip.
       */
      return {
        services: extracted.services || [],
        needs_more_details: extracted.needs_more_details ?? false,
      };
    } catch (error) {
      logExtractionFailure(error, 'Client workflow extraction failed');
      /* A failed read names nothing, and says so. */
      return { services: [], needs_more_details: true };
    }
  }

  /**
   * Extract client acquisition info from multi-select response (Q4: What digital tools do you need?)
   * Parses explicit text selections - no emojis
   */
  private extractClientAcquisition(message: string): ClientAcquisitionExtraction {
    const lowerMsg = message.toLowerCase();

    // Check for website selection (Professional website / אתר מקצועי / Sitio web)
    const needsWebsite =
      lowerMsg.includes('website') ||
      lowerMsg.includes('professional') ||
      lowerMsg.includes('אתר') ||
      lowerMsg.includes('מקצועי') ||
      lowerMsg.includes('sitio') ||
      lowerMsg.includes('profesional');

    // Connecting the accounts they already have.
    //
    // The platform reads from Facebook, Instagram, Google Analytics and a
    // Google listing: it syncs their numbers daily so the dashboard can say
    // where clients actually came from. It does not post, and it does not run
    // campaigns — which is what the two options this replaces implied, and
    // neither of them was a thing we do.
    const needsChannels =
      lowerMsg.includes('facebook') ||
      lowerMsg.includes('instagram') ||
      lowerMsg.includes('google') ||
      lowerMsg.includes('connect') ||
      lowerMsg.includes('פייסבוק') ||
      lowerMsg.includes('אינסטגרם') ||
      lowerMsg.includes('גוגל') ||
      lowerMsg.includes('לחבר') ||
      lowerMsg.includes('conectar');

    // Build acquisition channels array
    const channels: string[] = [];
    if (needsWebsite) channels.push('website');
    if (needsChannels) channels.push('channel_insights');

    const result: ClientAcquisitionExtraction = {
      acquisition_channels: channels,
      // Not known from this answer, and it used to be asserted as false with
      // the reasoning "if they had one, why would they need one?" — which
      // mistakes declining our website for having none. A business with its
      // own site is exactly the one that wants its Facebook and Google
      // connected and nothing else.
      has_website: null,
      wants_more_clients_online: needsWebsite || needsChannels,
      primary_channel: needsWebsite ? 'website' : needsChannels ? 'social_media' : 'referrals',
      // A chosen option wins over a stray "not now".
      //
      // These used to be ANDed with it, so a conversation that still offers the
      // old blanket chip could send "connect Google, not now" and come back
      // wanting neither — the decline silently cancelling the thing they had
      // just asked for. "Not now" only means anything when it is the only
      // answer.
      needs_website: needsWebsite,
      needs_channel_insights: needsChannels,
    };

    logger.info({ result, messageLength: message.length }, 'Extracted client acquisition from multi-select');
    return result;
  }

  /**
   * Extract client tracking info using LLM (Q5: How do you track clients?)
   */
  /*
   * UNREACHABLE as of 2026-09-17: nothing calls this — its step is retired (see
   * `case 'client_tracking'`). Attributed anyway, and covered by unit tests, so
   * it is correct if it is ever re-wired (KI-D, F-12).
   */
  private async extractClientTracking(message: string, owner: BosLlmOwner): Promise<ClientTrackingExtraction> {
    const factory = getProviderFactory();
    const context = this.callContext(owner, 'client_tracking_extraction');
    /*
     * Onboarding cannot be switched off (DEC-5, user BQ-1), so `enabled` is
     * always true here; only the model comes from configuration (FR-12). The
     * temperature is sent ONLY if one is resolved — these four have always sent
     * none, and the area row seeds `null` to keep it that way (FR-4).
     */
    const settings = await resolveBosLlmSettings('onboarding', 'client_tracking_extraction');

    try {
      const { result: response } = await withModelFallback(settings, (model) => factory.complete({
        model,
        messages: [
          { role: 'system', content: CLIENT_TRACKING_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      }, context));

      const extracted = JSON.parse(response.content);
      logger.debug({ extracted }, 'Extracted client tracking'); // derived owner text: debug only (OI-8)

      return {
        current_method: extracted.current_method || 'nothing',
        current_tools: extracted.current_tools || [],
        tracks_progress: extracted.tracks_progress ?? false,
        has_existing_crm: extracted.has_existing_crm ?? false,
        volume_hint: extracted.volume_hint ?? undefined,
        needs_crm: extracted.needs_crm ?? true,
        needs_pipeline: extracted.needs_pipeline ?? false,
      };
    } catch (error) {
      logExtractionFailure(error, 'Client tracking extraction failed');
      return {
        current_method: 'nothing',
        current_tools: [],
        tracks_progress: false,
        has_existing_crm: false,
        needs_crm: true,
        needs_pipeline: false,
      };
    }
  }

  

  

  /**
   * Extract numeric price from user's response message.
   * Handles formats like: "100", "₪100", "100 שקל", "$50", "50 dollars", etc.
   * Returns the numeric price or null if extraction fails.
   */
/**
   * Where to go once the services are settled.
   *
   * The money question is asked only when it can change the answer: there has
   * to be a price, and they must not have already said how they collect it
   * while describing their services. Asking a free workshop how it takes card
   * payments is the kind of question that makes setup feel long.
   *
   * It matters because the code used to infer this from the price alone, and
   * inferred "Stripe" — sending a business that invoices and takes a bank
   * transfer through an identity check for an account it will never open,
   * while never asking for the account number its invoices actually need.
   */
/**
   * Does this business book appointments?
   *
   * Chips first, then typed words — the same order and for the same reason as
   * `readCollectionMethod` below: the offered labels spell out their
   * consequence, so a keyword search finds "appointment" inside the answer that
   * exists to say there are none.
   *
   * Defaults to TRUE when nothing is recognised, and that direction is
   * deliberate. A scheduled service with no working hours is caught by
   * `journeyReadiness` and blocks publishing until the owner sets them, so a
   * wrong `true` is loud and fixable. A wrong `false` silently removes the
   * datetime step from the client's journey, and the owner discovers it when a
   * client books nothing at all.
   */
  private readScheduledAnswer(message: string, language: Language): boolean {
    const text = message.trim().toLowerCase();

    const CHIPS: Array<[boolean, string[]]> = [
      [false, [
        'אני מוכר בלי תורים: אין צורך בלוח זמנים',
        'vendo sin turnos: no hace falta agenda',
        'i sell without appointments: no calendar needed',
      ]],
      [true, [
        'הלקוחות קובעים איתי זמן',
        'los clientes reservan una hora conmigo',
        'clients book a time with me',
      ]],
    ];

    for (const [scheduled, labels] of CHIPS) {
      if (labels.some(label => text === label.toLowerCase())) return scheduled;
    }

    // Typed rather than tapped. An explicit denial settles it however many
    // times the word "appointment" appears in the sentence.
    const mentions = (...needles: string[]) => needles.some(needle => text.includes(needle));

    const refusesAppointments = mentions(
      'no appointment', 'without appointment', 'no booking', 'without booking',
      'no calendar', 'not scheduled', 'no times', 'בלי תורים', 'ללא תורים',
      'בלי פגישות', 'ללא פגישות', 'בלי לוח זמנים', 'sin turnos', 'sin citas', 'sin agenda',
    );
    if (refusesAppointments) return false;

    if (mentions(
      'appointment', 'book a time', 'booking', 'schedule', 'calendar', 'slot',
      'תור', 'תורים', 'פגישה', 'פגישות', 'לוח זמנים', 'turno', 'cita', 'agenda', 'reserva',
    )) {
      return true;
    }

    logger.info(
      { messageLength: text.length, language },
      'Could not read an appointments answer; defaulting to scheduled'
    );
    return true;
  }

  /**
   * How many different things the business sells.
   *
   * Returns null when the reply carries no usable number, so the caller asks
   * again rather than inventing a figure — the count decides how many rows are
   * written to the owner's catalogue, and a guess there is a guess they have to
   * clean up by hand.
   *
   * Clamped to `SERVICE_COUNT_MAX`, which is the same ceiling the chat request
   * schema puts on a submitted services array. "I have about 200" is a real
   * answer from a shop, and writing 200 draft rows would make the services
   * screen unusable; capping asks them to finish the ones that matter and add
   * the rest in the editor.
   */
  private readServiceCount(message: string): number | null {
    const text = message.trim().toLowerCase();

    // A written number, for "just one" and "I have three".
    const WORDS: Array<[number, string[]]> = [
      [1, ['one', 'a single', 'just one', 'only one', 'אחד', 'אחת', 'רק אחד', 'uno', 'una', 'solo uno']],
      [2, ['two', 'a couple', 'שתיים', 'שניים', 'dos']],
      [3, ['three', 'שלוש', 'שלושה', 'tres']],
      [4, ['four', 'ארבע', 'ארבעה', 'cuatro']],
      [5, ['five', 'חמש', 'חמישה', 'cinco']],
      [6, ['six', 'שש', 'שישה', 'seis']],
      [7, ['seven', 'שבע', 'שבעה', 'siete']],
      [8, ['eight', 'שמונה', 'ocho']],
      [9, ['nine', 'תשע', 'תשעה', 'nueve']],
      [10, ['ten', 'עשר', 'עשרה', 'diez']],
    ];

    // Digits win over words: "3 or 4" should read as 3, not match 'four'.
    const digits = text.match(/\d+/);
    if (digits) {
      const parsed = parseInt(digits[0], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        const clamped = Math.min(parsed, SERVICE_COUNT_MAX);
        logger.info({ parsed, clamped }, 'Read a service count from digits');
        return clamped;
      }
      // An explicit zero. They sell nothing yet, which is a real answer and not
      // a failure to parse — no drafts, and the services step stays outstanding.
      if (parsed === 0) {
        logger.info({ parsed: 0 }, 'Business says it sells nothing yet');
        return 0;
      }
    }

    for (const [count, labels] of WORDS) {
      if (labels.some(label => containsWholeWord(text, label) || text === label)) {
        logger.info({ count }, 'Read a service count from words');
        return count;
      }
    }

    logger.info({ messageLength: text.length }, 'No service count in the reply');
    return null;
  }

  /**
   * Which collection method an answer means.
   *
   * Matches the four offered chips first, then the phrases people type instead
   * of tapping them. Anything unrecognised is treated as an invoice rather than
   * a card: the invoice path asks for bank details they already know, while
   * guessing "card" sends them into a Stripe identity check they may not need.
   */
  private readCollectionMethod(message: string, language: Language): CollectionMethod {
    const text = message.trim().toLowerCase();

    // The offered answers are matched exactly, before any keyword is read.
    //
    // This is not an optimisation. The labels now spell out their consequence
    // — "שולח חשבונית והם מעבירים — בלי סליקה", "I invoice them ... — no card
    // payments" — and a keyword search finds "card" in a sentence that exists
    // to say there will be no card. The invoicing business would have been
    // classified as taking cards and sent to Stripe: the exact outcome all of
    // this was built to prevent.
    const CHIPS: Array<[CollectionMethod, string[]]> = [
      // Two answers, because there are two situations that differ in what has
      // to be configured: the platform takes the money, or the business does.
      // How they collect it themselves — transfer, app, cash — changes nothing
      // about setup, so it is not worth a question.
      ['card_online', [
        'הלקוח משלם אונליין בכרטיס: צריך חיבור סליקה', 'El cliente paga online con tarjeta: hace falta pasarela', 'The client pays online by card: needs a payment gateway',
      ]],
      ['invoice', [
        'אני גובה את הכסף בעצמי: חשבונית, העברה, ביט או מזומן', 'Cobro yo mismo: factura, transferencia o efectivo', 'I collect the money myself: invoice, transfer or cash',
      ]],
      /*
       * Nothing is charged at all.
       *
       * Offered as a chip because the fallback at the bottom of this method is
       * `invoice`, so a business that charges for nothing used to come out of
       * here owing invoice paperwork and carrying a payments capability it has
       * no use for. `moneyMoves` reads this as false and drops both.
       */
      ['none', [
        'אני לא גובה כסף על מה שאני מוכר', 'No cobro por nada de lo que ofrezco', 'Nothing I sell is paid for',
      ]],
    ];

    for (const [method, labels] of CHIPS) {
      if (labels.some(label => text === label.toLowerCase())) return method;
    }

    // Typed rather than tapped. Read the words, most specific first, and treat
    // an explicit "without a card" as settling the question however many times
    // the word "card" appears in the sentence.
    const mentions = (...needles: string[]) => needles.some(needle => text.includes(needle));

    const refusesCard = mentions(
      'no card', 'without card', 'not by card', 'בלי סליקה', 'ללא סליקה', 'בלי אשראי', 'ללא אשראי',
      'sin pasarela', 'sin tarjeta'
    );

    /*
     * Typed "it's free" rather than tapping the chip.
     *
     * Checked before every other keyword, because none of the words below
     * appears in "I don't charge for any of it" — so without this it reached
     * the `invoice` fallback at the bottom and a free business was told it owed
     * bank details. Whole words via `containsWholeWord`, reusing the list the
     * price reader already uses: `includes` would find "free" in "freelance".
     */
    if (FREE_PRICE_WORDS.some(word => containsWholeWord(text, word))
      || mentions("don't charge", 'do not charge', 'no charge', 'לא גובה', 'לא גובים', 'no cobro', 'no cobramos')) {
      return 'none';
    }

    if (mentions('cash', 'in person', 'מזומן', 'במקום', 'פנים מול פנים', 'efectivo', 'en persona')) {
      return 'in_person';
    }
    if (mentions('both', 'depends', 'שילוב', 'תלוי', 'שניהם', 'ambos', 'depende')) {
      return 'mixed';
    }
    if (mentions('invoice', 'transfer', 'bank', 'bit', 'חשבונית', 'העברה', 'ביט', 'בנק', 'factura', 'transferencia')) {
      return 'invoice';
    }
    if (!refusesCard && mentions('card', 'online', 'stripe', 'credit', 'אשראי', 'כרטיס', 'באתר', 'אונליין', 'tarjeta', 'en línea')) {
      return 'card_online';
    }

    // Nothing recognisable. An invoice asks for bank details they already have;
    // guessing "card" sends them through an identity check they may not need.
    return 'invoice';
  }

  /**
   * The pricing model behind one of the three answers we offered.
   *
   * The chips are fixed text, so matching them needs no model call and cannot
   * drift: "a combination of both" came back as `fixed` because the extraction
   * schema had defined `mixed` as "some free, some paid" — a different idea
   * from the one the button offers — and the user was then asked for a price
   * on every service including the ones they quote.
   *
   * Anything typed rather than tapped still goes to the extraction.
   */
  /**
   * The tracking method behind one of the four answers we offered.
   *
   * Read directly rather than through the extraction, because one of these
   * answers decides something large: "I already have a CRM" is the single case
   * where `needs_crm` is false, and getting it wrong either builds a client
   * pipeline nobody asked for or withholds one from a business tracking clients
   * on paper. A fixed label should not be left to interpretation.
   *
   * Anything typed rather than tapped still goes to the extraction.
   */
  private trackingFromChip(message: string): ClientTrackingExtraction | null {
    const text = message.trim().toLowerCase();

    const CHIPS: Array<[ClientTrackingExtraction, string[]]> = [
      [
        { current_method: 'existing_crm', current_tools: [], tracks_progress: true, has_existing_crm: true, needs_crm: false, needs_pipeline: false },
        ['כבר יש לי מערכת crm', 'ya tengo un crm', 'i already have a crm'],
      ],
      [
        { current_method: 'spreadsheet', current_tools: ['excel'], tracks_progress: false, has_existing_crm: false, needs_crm: true, needs_pipeline: true },
        ['אקסל או גוגל שיטס', 'excel o google sheets', 'excel or google sheets'],
      ],
      [
        { current_method: 'paper', current_tools: ['paper'], tracks_progress: false, has_existing_crm: false, needs_crm: true, needs_pipeline: true },
        ['נייר, מחברת או אפליקציית פתקים', 'papel, cuaderno o app de notas', 'paper, a notebook or a notes app'],
      ],
      [
        { current_method: 'memory', current_tools: [], tracks_progress: false, has_existing_crm: false, needs_crm: true, needs_pipeline: true },
        ['הכל בראש שלי', 'todo en mi cabeza', 'all in my head'],
      ],
    ];

    for (const [extraction, labels] of CHIPS) {
      if (labels.some(label => text === label.toLowerCase())) return extraction;
    }
    return null;
  }

  private pricingModelFromChip(message: string): PricingModel | null {
    const text = message.trim().toLowerCase();

    const CHIPS: Array<[PricingModel, string[]]> = [
      ['mixed', ['שילוב של שניהם', 'combinación de ambos', 'a combination of both', 'combination of both']],
      ['custom', ['מותאם אישית ללקוח', 'personalizado por cliente', 'customised per client', 'customized per client']],
      ['fixed', ['שירותים עם מחירים קבועים', 'servicios con precios fijos', 'services with fixed prices']],
    ];

    for (const [model, labels] of CHIPS) {
      if (labels.some(label => text === label.toLowerCase())) return model;
    }
    return null;
  }

  /**
   * Where the conversation goes once the services are known.
   *
   * It used to detour through `payment_collection` — "when someone books a paid
   * service, how does the money reach you?" — and that question is gone. It was
   * never one a person could answer about everything they sell at once: a
   * practice can take a card for a ₪250 session and invoice for a ₪6,000
   * programme, and a single business-wide answer got one of them wrong.
   *
   * Each service now carries its own `collection`, extracted alongside its price
   * and confirmed on the plan screen where all the services are visible
   * together. Whether a card processor is needed is then a conclusion — some
   * service is collected online — rather than something to ask a
   * non-technical user about their business in the abstract.
   *
   * `payment_collection` stays in `ONBOARDING_STEPS` and keeps its handler:
   * conversations already sitting on it must still resume, and the route
   * discards any conversation whose step is not in that set.
   */
  /**
   * Whether the services form's intake switch was on.
   *
   * Matched on the exact sentence that switch appends, in each language it can
   * append it in. Anything else is left to the extraction, which sees the free
   * text too.
   */
  /**
   * Do clients fill in a form before their appointment?
   *
   * Chips first and keywords second, the same order and for the same reason as
   * `readScheduledAnswer` and `readCollectionMethod`: the labels spell out
   * their consequence, so a keyword search finds "form" inside the answer that
   * exists to say there is no form.
   *
   * Defaults to FALSE when nothing is recognised, which is the opposite
   * direction to `readScheduledAnswer` and deliberately so. A missing intake
   * form is something the owner adds in settings when they want it; an unwanted
   * one is a questionnaire their clients are made to fill in, with questions
   * the owner never wrote. The quiet failure has to be the harmless one.
   */
  /**
   * Yes, no, or a replacement name.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * No heuristics and no thresholds: an exact chip match decides yes and no,
   * `isConfirmation` catches a typed agreement, and a reply that is nothing but
   * a word of refusal is a refusal. EVERYTHING ELSE is taken as the name they
   * meant, because the alternative is storing "no" as a business name.
   *
   * The refusal vocabulary is `NEGATORS`, which already exists for the preview
   * confirmation. One list, so "לא" means the same thing in both places.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private readNameConfirmation(message: string, language: Language): 'yes' | 'no' | 'renamed' {
    const text = message.trim().toLowerCase();

    const CHIPS: Array<['yes' | 'no', string[]]> = [
      ['yes', ["yes, that's right", 'כן, זה נכון', 'sí, es correcto']],
      ['no', ['no, let me fix it', 'לא, אני רוצה לתקן', 'no, quiero corregirlo']],
    ];

    for (const [verdict, labels] of CHIPS) {
      if (labels.some(label => label.toLowerCase() === text)) return verdict;
    }

    if (this.isConfirmation(message, language)) return 'yes';

    /* A reply that is ONLY a word of refusal. Anything longer is a name. */
    if (NEGATORS.includes(text)) return 'no';

    return 'renamed';
  }

  private readIntakeAnswer(message: string, language: Language): boolean {
    const text = message.trim().toLowerCase();

    const CHIPS: Array<[boolean, string[]]> = [
      [true, [
        'כן, הם ממלאים טופס לפני',
        'sí, rellenan un formulario antes',
        'yes, they fill in a form first',
      ]],
      [false, [
        'לא, הם פשוט קובעים תור',
        'no, solo reservan',
        'no, they just book',
      ]],
    ];

    for (const [answer, labels] of CHIPS) {
      if (labels.some(label => label.toLowerCase() === text)) return answer;
    }

    /* Typed instead of tapped. The old reader's three exact labels are kept
       below it, so a conversation resuming against an older form still reads. */
    if (this.readIntakeNeed(message)) return true;

    const yes: Record<Language, string[]> = {
      en: ['form', 'questionnaire', 'intake', 'paperwork', 'health details'],
      he: ['טופס', 'שאלון', 'שאלות', 'הצהרת בריאות'],
      es: ['formulario', 'cuestionario', 'ficha'],
    };

    const words = yes[language] || yes.en;
    const negated = NEGATORS.some(word => containsWholeWord(text, word));

    return !negated && words.some(word => text.includes(word));
  }

  private readIntakeNeed(message: string): boolean {
    const text = message.toLowerCase();
    return text.includes('לקוחות ממלאים טופס לפני הפגישה')
      || text.includes('rellenan un formulario antes de la cita')
      || text.includes('fill in a form before the appointment');
  }

  private nextStepAfterServices(_state: OnboardingState): OnboardingStep {
    return 'client_acquisition';
  }

  

  /**
   * Extract adjustment intent from user message
   */
  private async extractAdjustmentIntent(
    message: string,
    owner: BosLlmOwner
  ): Promise<{ intent: string; details: string }> {
    const factory = getProviderFactory();
    const context = this.callContext(owner, 'adjustment_intent_extraction');
    /*
     * Onboarding cannot be switched off (DEC-5, user BQ-1), so `enabled` is
     * always true here; only the model comes from configuration (FR-12). The
     * temperature is sent ONLY if one is resolved — these four have always sent
     * none, and the area row seeds `null` to keep it that way (FR-4).
     */
    const settings = await resolveBosLlmSettings('onboarding', 'adjustment_intent_extraction');

    try {
      const { result: response } = await withModelFallback(settings, (model) => factory.complete({
        model,
        messages: [
          { role: 'system', content: PREVIEW_ADJUSTMENT_PROMPT },
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      }, context));

      const extracted = JSON.parse(response.content);
      return extracted;
    } catch (error) {
      logExtractionFailure(error, 'Adjustment intent extraction failed');
      return { intent: 'confirm', details: '' };
    }
  }

  /**
   * Apply user's adjustment to the collected data
   */
  private applyAdjustment(
    state: OnboardingState,
    adjustment: { intent: string; details: string }
  ): void {
    const details = adjustment.details.toLowerCase();

    switch (adjustment.intent) {
      case 'add_capability':
        // Check what capability they want to add
        if (this.mentionsWebsite(details)) {
          // User wants to add website
          if (!state.collectedData.clientAcquisition) {
            state.collectedData.clientAcquisition = {
              acquisition_channels: [],
              has_website: false,
              wants_more_clients_online: true,
              primary_channel: 'referrals',
              needs_website: true,
            };
          } else {
            state.collectedData.clientAcquisition.needs_website = true;
            state.collectedData.clientAcquisition.wants_more_clients_online = true;
          }
          logger.info('Applied adjustment: add website');
        }

        if (this.mentionsCRM(details)) {
          // User wants to add CRM
          if (!state.collectedData.clientTracking) {
            state.collectedData.clientTracking = {
              current_method: 'nothing',
              current_tools: [],
              tracks_progress: false,
              has_existing_crm: false,
              needs_crm: true,
              needs_pipeline: true,
            };
          } else {
            state.collectedData.clientTracking.needs_crm = true;
            state.collectedData.clientTracking.needs_pipeline = true;
          }
          logger.info('Applied adjustment: add CRM');
        }

        if (this.mentionsPayments(details)) {
          // User wants to add payments
          if (state.collectedData.clientWorkflow) {
            state.collectedData.clientWorkflow.pricing_model = 'fixed';
            state.collectedData.clientWorkflow.payment_timing = 'before';
          }
          logger.info('Applied adjustment: add payments');
        }
        break;

      case 'remove_capability':
        // Check what capability they want to remove
        if (this.mentionsWebsite(details)) {
          if (state.collectedData.clientAcquisition) {
            state.collectedData.clientAcquisition.needs_website = false;
          }
          logger.info('Applied adjustment: remove website');
        }

        if (this.mentionsCRM(details)) {
          if (state.collectedData.clientTracking) {
            state.collectedData.clientTracking.needs_crm = false;
            state.collectedData.clientTracking.needs_pipeline = false;
          }
          logger.info('Applied adjustment: remove CRM');
        }

        if (this.mentionsPayments(details)) {
          if (state.collectedData.clientWorkflow) {
            state.collectedData.clientWorkflow.pricing_model = 'free';
            state.collectedData.clientWorkflow.payment_timing = 'none';
          }
          logger.info('Applied adjustment: remove payments');
        }
        break;

      case 'modify_services':
        // For now, just log - future: allow adding/editing services
        // `details` is the owner's request as the model read it: debug only (OI-8).
        logger.debug({ details }, 'Service modification requested (not yet implemented)');
        break;

      case 'modify_pipeline':
        // For now, just log - future: allow editing pipeline stages
        logger.debug({ details }, 'Pipeline modification requested (not yet implemented)');
        break;

      case 'change_payment_mode':
        // For now, just log - future: allow changing payment mode
        logger.debug({ details }, 'Payment mode change requested (not yet implemented)');
        break;

      default:
        logger.info({ ...intentFields(adjustment.intent), detailsLength: details.length }, 'Unknown adjustment intent');
        logger.debug({ intent: adjustment.intent, details }, 'Unknown adjustment intent: details');
    }
  }

  /**
   * Check if text mentions website
   */
  private mentionsWebsite(text: string): boolean {
    const websiteKeywords = [
      'website', 'site', 'web', 'online presence', 'landing page',
      'אתר', 'דף נחיתה', 'נוכחות אונליין',
      'sitio', 'web', 'página'
    ];
    return websiteKeywords.some(k => text.includes(k));
  }

  /**
   * Check if text mentions CRM
   */
  private mentionsCRM(text: string): boolean {
    const crmKeywords = [
      'crm', 'client management', 'contact', 'tracking', 'pipeline',
      'ניהול לקוחות', 'מעקב', 'קשר',
      'gestión de clientes', 'seguimiento'
    ];
    return crmKeywords.some(k => text.includes(k));
  }

  /**
   * Check if text mentions payments
   */
  private mentionsPayments(text: string): boolean {
    const paymentKeywords = [
      'payment', 'pay', 'invoice', 'billing', 'charge', 'stripe',
      'תשלום', 'חשבונית', 'גבייה',
      'pago', 'factura', 'cobro'
    ];
    return paymentKeywords.some(k => text.includes(k));
  }

  /**
   * Check if message is a confirmation
   */
  private isConfirmation(message: string, language: Language): boolean {
    const lowerMsg = message.toLowerCase();

    const confirmPatterns: Record<Language, string[]> = {
      en: ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'looks good', 'perfect', 'great', "let's go", 'start', 'confirm'],
      he: ['כן', 'יופי', 'מושלם', 'בסדר', 'אוקיי', 'נשמע טוב', 'בואו', 'מעולה', 'אישור'],
      es: ['sí', 'si', 'perfecto', 'bien', 'vale', 'ok', 'genial', 'vamos', 'confirmar'],
    };

    const patterns = confirmPatterns[language] || confirmPatterns.en;
    /*
     * WHOLE WORDS, and this was a substring match.
     * ─────────────────────────────────────────────────────────────────────────
     * The consequence of a false positive here is the worst available in the
     * flow: `preview` reads a confirmation as "build it", so the system is
     * created from a plan the owner was in the middle of objecting to.
     *
     * Measured against the lists above, with `.includes`:
     *
     *   es  "necesito cambiar el precio"  -> "si" inside "necesito"   -> BUILDS
     *   es  "no vale así"                 -> "vale"                   -> BUILDS
     *   en  "restart"                     -> "start"                  -> BUILDS
     *   en  "the pipeline is broken"      -> "ok" inside "broken"     -> BUILDS
     *
     * Three of those four are an owner asking for a change and getting their
     * account built instead. "restart" is worse still: the one word that means
     * start over was read as agreement.
     *
     * `containsWholeWord` is Unicode-aware, which `\b` is not: Hebrew letters
     * are not word characters to `\b`, so it cannot bound a Hebrew pattern.
     * Multi-word phrases ("looks good", "eso es todo") work unchanged.
     * ─────────────────────────────────────────────────────────────────────────
     */
    /*
     * A confirm word inside a negation is not a confirmation.
     *
     * "no vale así" is Spanish for "it is not right like that", and `vale`
     * ("OK") sits in the middle of it as a genuine whole word. So whole-word
     * matching alone still read a rejection as agreement.
     *
     * The asymmetry decides the direction: a false POSITIVE builds the account
     * from a plan the owner was objecting to, while a false NEGATIVE only
     * routes them to `preview_adjustment`, whose model reads the same sentence
     * and may well return `confirm` and build anyway. One is unrecoverable
     * without deleting rows; the other costs nothing. So any negator present
     * means "not a confirmation".
     */
    if (NEGATORS.some(word => containsWholeWord(lowerMsg, word))) return false;

    return patterns.some(p => containsWholeWord(lowerMsg, p));
  }

  /**
   * Get next response based on current state
   */
  private async getNextResponse(
    state: OnboardingState
  ): Promise<{
    response: string;
    suggestions?: string[];
    multiSelect?: boolean;  // If true, frontend shows toggle buttons instead of single-select
    showPreview?: boolean;
  }> {
    const language = state.language;
    const responses = this.getResponseTemplates(language);

    switch (state.currentStep) {
      /*
       * The question the picker chose, in the owner's language, verbatim.
       *
       * No suggestions: these are open questions about their own business, and
       * a row of guessed answers would answer them for them — which is how a
       * brief ends up describing the chips rather than the business.
       */
      case 'business_deepening':
        return {
          /*
           * The model's question, or a TRANSLATED fallback — never the contract's
           * example.
           *
           * `BRIEF_FIELDS[].example` is written in English and exists to set the
           * register inside the prompt. Falling back to it would put an English
           * question in front of a Hebrew owner mid-interview, which is the one
           * failure this flow is otherwise careful to avoid — `business_story`
           * keeps the owner's typed words precisely because an extraction once
           * answered a Hebrew conversation in English.
           *
           * `business_story_prompt` exists in all three languages and asks them
           * to say more about the business, which is what this step is for.
           */
          response:
            state.collectedData.pendingBriefQuestion || responses.business_story_prompt,
        };

      case 'language_selection':
        // IMPORTANT: Language selection is ALWAYS shown in English with LTR direction
        // Only after user selects their language will subsequent messages use that language
        return {
          response: 'What language would you like to use?',
          /*
           * The language's own name, with no flag.
           *
           * The argument for flags was that nothing else reads before the
           * language is chosen. But a flag names a COUNTRY, and these are
           * languages: Spanish is not Spain to most of the people who speak
           * it, and English is not the United States. "English", "עברית" and
           * "Español" each read in the script of the thing they offer, which
           * is the clearer signal anyway.
           *
           * The words still carry the detection: `language_selection` matches
           * "עברית"/"hebrew" and "español"/"spanish", so the parentheticals
           * stay as a second spelling for each.
           */
          suggestions: ['English', 'עברית (Hebrew)', 'Español (Spanish)'],
        };

      case 'business_name':
        if (state.pendingQuestion === 'name_confirm') {
          return {
            response: responses.name_confirm_prompt.replace(
              '{name}',
              state.collectedData.businessProfile?.company_name ?? ''
            ),
            suggestions: responses.name_confirm_options,
          };
        }

        if (state.pendingQuestion === 'name_again') {
          /* Not the opening line again: "let's start with the name" after they
             have already given one reads as though nothing was heard. */
          return { response: responses.business_name_again_prompt };
        }

        return {
          response: responses.business_name_prompt,
        };

      case 'business_story':
        /* Asked once more, and worded differently: repeating the same sentence
           reads as though the answer was not received at all. */
        return {
          response: state.pendingQuestion === 'story_again'
            ? responses.business_story_again_prompt
            : responses.business_story_prompt,
        };

      case 'client_workflow':
        const companyName = state.collectedData.businessStory?.company_name || responses.default_company;
        return {
          response: responses.client_workflow_prompt.replace('{company}', companyName),
          suggestions: responses.client_workflow_options,
        };

      case 'service_details':
        // How they sell — the two capability questions, then the count.
        if (state.pendingQuestion === 'sell_scheduled') {
          return {
            response: responses.sell_scheduled_prompt,
            suggestions: responses.sell_scheduled_options,
          };
        }

        if (state.pendingQuestion === 'sell_collection') {
          return {
            response: responses.payment_collection_prompt,
            suggestions: responses.payment_collection_options,
          };
        }

        if (state.pendingQuestion === 'service_count') {
          return {
            response: responses.service_count_prompt,
            suggestions: responses.service_count_options,
          };
        }

        /* Only reached for a business that books appointments — see the
           `intake` branch in `updateStateFromMessage`. */
        if (state.pendingQuestion === 'intake') {
          return {
            response: responses.intake_prompt,
            suggestions: responses.intake_options,
          };
        }

        /*
         * `need_price` and `more_services` were asked here. Both belonged to
         * the free-text loop removed from `updateStateFromMessage`, and the
         * price is now the services editor's to collect.
         *
         * Anything else in this step re-opens the selling sequence rather than
         * asking a question with no reader: a stored state is the only way to
         * arrive here, and starting from "how do you sell?" is recoverable.
         */
        return {
          response: responses.sell_scheduled_prompt,
          suggestions: responses.sell_scheduled_options,
        };

      case 'payment_collection':
        // The question that decides whether Stripe is ever mentioned to this
        // business. Single-select: they are four different setups, not a menu.
        return {
          response: responses.payment_collection_prompt,
          suggestions: responses.payment_collection_options,
        };

      case 'client_acquisition':
        // Q4: What digital tools do you need? (multi-select)
        return {
          response: responses.client_acquisition_prompt,
          suggestions: responses.client_acquisition_options,
          multiSelect: true,  // Signal to frontend that this is multi-select
        };

      case 'preview':
        // Visual preview card handles the display - just return minimal message
        // The UI shows the visual preview card with all details
        return {
          response: '', // Empty - visual card shows everything
          suggestions: responses.preview_options,
          showPreview: true,
        };

      case 'preview_adjustment':
        return {
          response: responses.adjustment_prompt,
        };

      case 'building':
        return {
          response: responses.building_message,
        };

      case 'complete':
        return {
          response: responses.complete_message,
        };

      default:
        return {
          response: responses.default_prompt,
        };
    }
  }

    /*
   * `generatePreviewMessage` and `getPreviewTemplates` were here, and were
   * removed on 2026-10-14. Together: 219 lines, no caller.
   *
   * They built the plan as a MARKDOWN MESSAGE: a heading, a pipeline drawn with
   * arrows, a list of capabilities, in three languages. The chat replaced it
   * with a React card and the preview step now returns `response: ''` with
   * `showPreview: true`, because what the owner needs at that moment is a set
   * of decisions they can still touch, not a receipt of what they said.
   *
   * Noted rather than silently dropped because it cost real confusion: asked
   * why the business brief was not appearing on the plan screen, the obvious
   * place to add it was `generatePreviewMessage`, and a block was added there
   * that nobody could ever see. The plan screen is
   * `app/onboarding-chat/page.tsx`; the post-build summary is
   * `app/onboarding-build/page.tsx`. Those two are the surfaces.
   */


  /**
   * Get response templates by language
   * Note: No emojis used - platform icons are rendered in the UI layer
   */
  private getResponseTemplates(language: Language): Record<string, any> {
    if (language === 'he') {
      return {
        business_name_prompt: 'מעולה! נתחיל מהשם. איך קוראים לעסק שלך?',
        business_story_prompt: 'תודה! ועכשיו ספרו לי על העסק. מה אתם עושים, ומה הביא אתכם לכאן היום?',
        business_story_again_prompt: 'סליחה, אני צריך קצת יותר מזה כדי לעבוד איתו. במשפט או שניים: מה אתם עושים, ובשביל מי? משהו כמו "אני מנהל מספרה לילדים" בהחלט מספיק.',
        name_confirm_prompt: 'נרשם. רק כדי לוודא, "{name}" זה בדיוק איך שתרצו שזה ייכתב? זה יופיע על כל חשבונית וכל מייל שנשלח בשמכם.',
        name_confirm_options: ['כן, זה נכון', 'לא, אני רוצה לתקן'],
        business_name_again_prompt: 'אין בעיה. איך זה צריך להיות?',
        client_workflow_prompt: 'תודה! איך אתם עובדים עם לקוחות? יש לכם שירותים עם מחירים קבועים, או שזה יותר מותאם אישית ללקוח?',
        client_workflow_options: ['שירותים עם מחירים קבועים', 'מותאם אישית ללקוח', 'שילוב של שניהם'],
        sell_scheduled_prompt: 'מעולה. איך אתם מוכרים? הלקוחות קובעים איתכם זמן, או שאתם מוכרים בלי תורים?',
        sell_scheduled_options: [
          'הלקוחות קובעים איתי זמן',
          'אני מוכר בלי תורים: אין צורך בלוח זמנים',
        ],
        // Reworded from "מזמין שירות בתשלום": the question now covers a
        // business that charges for nothing, and asking how they collect on a
        // "paid service" made the third answer read as though it did not apply.
        payment_collection_prompt: 'וכשמישהו קונה מכם, הוא משלם אונליין, או שאתה גובה את הכסף בעצמך?',
        payment_collection_options: [
          'הלקוח משלם אונליין בכרטיס: צריך חיבור סליקה',
          'אני גובה את הכסף בעצמי: חשבונית, העברה, ביט או מזומן',
          'אני לא גובה כסף על מה שאני מוכר',
        ],
        service_count_prompt: 'אחרון. כמה דברים שונים אתם מוכרים בערך? אכין אותם כטיוטות ותוכלו להשלים אותן אחר כך.',
        intake_prompt: 'הלקוחות שלכם ממלאים משהו לפני שאתם נפגשים, כמו טופס או הצהרת בריאות?',
        intake_options: ['כן, הם ממלאים טופס לפני', 'לא, הם פשוט קובעים תור'],
        service_count_options: ['1', '2', '3', '5'],
        client_acquisition_prompt: 'עכשיו, איך לקוחות ימצאו אותך ויזמינו? סמן כל מה שרלוונטי (או כלום), ואקים את מה שסימנת.',
        client_acquisition_options: [
          'שאבנה לך אתר מקצועי',
          'לחבר פייסבוק, אינסטגרם או גוגל: לראות מאיפה מגיעים הלקוחות',
        ],
        default_company: 'העסק שלך',
        preview_options: ['כן, בואו נתחיל!', 'אני רוצה לשנות משהו'],
        /*
       * The copy for the retired flows was here, and was removed on 2026-10-14:
       * `service_details_prompt` and its quote and mixed variants,
       * `need_price_prompt`, `more_services_prompt`/`_options`,
       * `client_tracking_prompt`/`_options`, `language_prompt`,
       * `preview_error`. Thirty strings across three languages, read by
       * nothing.
       *
       * They belonged to the free-text service loop and the CRM question, both
       * removed with their branches. Three of them were REWRITTEN earlier the
       * same day, carefully, in three languages, before anyone checked whether
       * the question was still asked — which is the whole argument for deleting
       * dead copy rather than leaving it to look live.
       */
      adjustment_prompt: 'מה תרצה לשנות?',
        building_message: 'מעולה! אני בונה את המערכת שלך...',
        complete_message: 'הכל מוכן! ברוך הבא ל-Business OS שלך.',
        default_prompt: 'אני כאן לעזור לך להגדיר את המערכת.',
      };
    }

    if (language === 'es') {
      return {
        business_name_prompt: '¡Genial! Empecemos por el nombre. ¿Cómo se llama tu negocio?',
        business_story_prompt: '¡Gracias! Ahora cuéntame sobre tu negocio. ¿Qué haces y qué te trajo aquí hoy?',
        business_story_again_prompt: 'Perdona, necesito un poco más para trabajar con eso. En una o dos frases: ¿qué haces y para quién? Algo como "tengo una peluquería para niños" es suficiente.',
        name_confirm_prompt: 'Anotado. Solo para confirmar, ¿"{name}" es exactamente como quieres que aparezca? Va en cada factura y cada correo que enviamos por ti.',
        name_confirm_options: ['Sí, es correcto', 'No, quiero corregirlo'],
        business_name_again_prompt: 'Sin problema. ¿Cómo debería ser?',
        client_workflow_prompt: '¡Gracias! ¿Cómo trabajas con tus clientes? ¿Tienes servicios con precios fijos, o es más personalizado por cliente?',
        client_workflow_options: ['Servicios con precios fijos', 'Personalizado por cliente', 'Combinación de ambos'],
        sell_scheduled_prompt: 'Perfecto. ¿Cómo vendes? ¿Los clientes reservan una hora contigo, o vendes sin turnos?',
        sell_scheduled_options: [
          'Los clientes reservan una hora conmigo',
          'Vendo sin turnos: no hace falta agenda',
        ],
        // Reworded from "reserva un servicio de pago": the question now covers
        // a business that charges for nothing, and framing it around a paid
        // service made the third answer read as though it did not apply.
        payment_collection_prompt: 'Y cuando alguien te compra algo, ¿paga online o lo cobras tú?',
        payment_collection_options: [
          'El cliente paga online con tarjeta: hace falta pasarela',
          'Cobro yo mismo: factura, transferencia o efectivo',
          'No cobro por nada de lo que ofrezco',
        ],
        service_count_prompt: 'La última. ¿Cuántas cosas distintas vendes más o menos? Las dejaré como borradores para que las completes luego.',
        intake_prompt: '¿Tus clientes rellenan algo antes de verte, como un formulario o una ficha de salud?',
        intake_options: ['Sí, rellenan un formulario antes', 'No, solo reservan'],
        service_count_options: ['1', '2', '3', '5'],
        client_acquisition_prompt: 'Ahora, ¿cómo van a encontrarte y reservar tus clientes? Marca lo que corresponda (o nada) y construiré lo que elijas.',
        client_acquisition_options: [
          'Que te construya un sitio web profesional',
          'Conectar Facebook, Instagram o Google: ver de dónde vienen tus clientes',
        ],
        default_company: 'tu negocio',
        preview_options: ['Sí, ¡comencemos!', 'Quiero cambiar algo'],
        adjustment_prompt: '¿Qué te gustaría cambiar?',
        building_message: '¡Excelente! Estoy construyendo tu sistema...',
        complete_message: '¡Todo listo! Bienvenido a tu Business OS.',
        default_prompt: 'Estoy aquí para ayudarte a configurar tu sistema.',
      };
    }

    // English (default)
    return {
      business_name_prompt: "Great! Let's start with the name. What is your business called?",
      business_story_prompt: "Thanks! Now tell me about the business. What do you do, and what brought you here today?",
      /*
       * Names what is missing and shows the shape of an answer, rather than
       * repeating the question. Everything downstream is written from this
       * sentence, which is worth saying out loud: it is the one place in the
       * interview where more detail genuinely pays the owner back.
       */
      business_story_again_prompt: "Sorry, I need a little more than that to work with. In a sentence or two: what do you do, and who for? Something like \"I run a hair salon for kids\" is plenty.",
      /*
       * Says WHERE the name ends up, which is the only reason to spend a turn
       * reading it back. "Is this correct?" invites a reflexive yes; "it goes
       * on every invoice and email you send" makes somebody actually look.
       */
      name_confirm_prompt: 'Got it. Just to be sure, is "{name}" exactly how you want it written? It goes on every invoice and email we send for you.',
      name_confirm_options: ["Yes, that's right", 'No, let me fix it'],
      business_name_again_prompt: 'No problem. What should it be?',
      client_workflow_prompt: "Thanks! How do you typically work with clients? Do you have set services and prices, or is it more custom per client?",
      client_workflow_options: ['Fixed services and prices', 'Custom per client', 'A mix of both'],
      sell_scheduled_prompt: "Great. Now, how do you sell? Do clients book a time with you, or do you sell without appointments?",
      sell_scheduled_options: [
        'Clients book a time with me',
        'I sell without appointments: no calendar needed',
      ],
      // Reworded from "books a paid service": the question now covers a
      // business that charges for nothing, and framing it around a paid
      // service made the third answer read as though it did not apply.
      payment_collection_prompt: "And when someone buys from you, do they pay online, or do you collect the money yourself?",
      payment_collection_options: [
        'The client pays online by card: needs a payment gateway',
        'I collect the money myself: invoice, transfer or cash',
        'Nothing I sell is paid for',
      ],
      service_count_prompt: "Last one. Roughly how many different things do you sell? I'll set them up as drafts for you to finish.",
      /*
       * Phrased as what the CLIENT does, not as a feature name.
       * "Do you need an intake form?" asks the owner to know what we mean by
       * one. "Do clients fill in a form before you see them?" is a fact about
       * their own week, which is the register the rest of this interview uses.
       */
      intake_prompt: "Do your clients fill in anything before you see them, like a form or health details?",
      intake_options: ['Yes, they fill in a form first', 'No, they just book'],
      service_count_options: ['1', '2', '3', '5'],
      client_acquisition_prompt: "Now, how will clients find you and book? Tick whatever applies (or nothing), and I will build what you choose.",
      client_acquisition_options: [
        'Build me a professional website',
        'Connect Facebook, Instagram or Google: see where clients come from',
      ],
      default_company: 'your business',
      preview_options: ["Yes, let's get started!", 'I want to change something'],
      adjustment_prompt: "What would you like to change?",
      building_message: "Excellent! I'm building your system...",
      complete_message: 'All done! Welcome to your Business OS.',
      default_prompt: "I'm here to help you set up your system.",
    };
  }

  /**
   * Get initial state for a new conversation
   */
  getInitialState(language: Language = 'en'): AttributedOnboardingState {
    return {
      currentStep: 'language_selection',
      collectedData: {},
      language,
      attributionGroupId: newBosGroupId(),
    };
  }

  /**
   * Give a state restored from a snapshot saved before Layer 1.5 its grouping
   * id, so a resumed conversation never records a call without one (FR-4c).
   * Idempotent: a state that already has a valid group keeps it. A stored value
   * that is not a UUID is replaced, because the ledger would drop it and
   * silently ungroup the whole conversation (SA CR-3). Pure — the caller must
   * use the RETURNED state.
   */
  ensureAttributionGroupId(state: OnboardingState): AttributedOnboardingState {
    if (isUuid(state.attributionGroupId)) {
      return { ...state, attributionGroupId: state.attributionGroupId };
    }
    const attributionGroupId = newBosGroupId();
    logger.info({ attributionGroupId }, 'Backfilled the grouping id of a resumed onboarding conversation');
    return { ...state, attributionGroupId };
  }

  /**
   * The ledger context for one onboarding LLM call: the owner's account, the
   * `onboarding` area, a catalog call name and this conversation's group.
   */
  private callContext(owner: BosLlmOwner, callName: BosLlmCallName<'onboarding'>) {
    return buildBosCallContext({
      userId: owner.userId,
      area: 'onboarding',
      callName,
      groupId: owner.groupId,
    });
  }

  /**
   * Validate collected data before building
   */
  validateState(state: OnboardingState): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!state.collectedData.configuration) {
      errors.push('Configuration not computed');
      return { valid: false, errors };
    }

    const config = state.collectedData.configuration;

    if (!config.company_name) {
      errors.push('Company name is required');
    }

    if (!config.vertical) {
      errors.push('Business vertical is required');
    }

    if (config.capabilities.length === 0) {
      errors.push('At least one capability is required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
