/**
 * A placeholder service still has to say what it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * The interview asked one question about services:
 *
 *     "Can you tell me more about your services?
 *      For example: service name, duration (in minutes), and price."
 *
 * Three fields, all three owned by the services editor, two of which an owner
 * cannot answer while thinking about something else. And every service created
 * by onboarding is a PLACEHOLDER: the owner sets its price and its length in
 * the editor afterwards. So the question spent a conversational turn collecting
 * what would be overwritten, and collected nothing that could not be.
 *
 * What no editor can generate is the sentence describing what the thing IS.
 * Nothing held it. `Service` was name, duration, price, currency, collection,
 * sale_mode: configuration end to end. `ExtractedService` the same. Both Zod
 * schemas on the build route the same. And the row written to the table read
 * `description: suggestion?.description`, where `suggestion` exists only on a
 * service WE invented — so a service the owner described in their own words
 * was stored with no description at all, and the website generated a catalogue
 * of bare names.
 *
 * This pins the whole chain, because every link in it fails SILENTLY: an
 * undeclared key is stripped by Zod, a field absent from an interface is
 * dropped by the conversion, and in both cases the question was asked for
 * nothing. That exact failure is recorded on `sale_mode`, which was requested
 * in two languages for months and discarded on the way through.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { BRIEF_FIELDS, EMPTY_BRIEF, MAX_FOLLOW_UPS, mergeIntoBrief } from '../businessBrief';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const manager = read('lib/services/OnboardingConversationManager.ts');
const config = read('lib/services/OnboardingConfigurationService.ts');
const build = read('app/api/onboarding/build/route.ts');
const chatPage = read('app/onboarding-chat/page.tsx');
const buildPage = read('app/onboarding-build/page.tsx');

/** These files necessarily name what they forbid. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ───────────────────────────────────────────────────────────────────────────
 * THE QUESTION ITSELF IS GONE, and so are the tests that described it.
 *
 * `service_details_prompt` and its quote and mixed variants asked "tell me
 * what you offer and how it works", and the branch that displayed them was
 * removed with the free-text service loop. The nine strings went on 2026-10-14.
 *
 * What those tests asserted was right and is now someone else's job:
 *   · "asks what the service IS"      -> `draftServices`, asserted below
 *   · "no minutes, no price"          -> `draftServices`, asserted below
 *   · "no em dash"                    -> `withoutDashPunctuation`, asserted in
 *                                        `businessBrief.test.ts`
 *
 * The sharpest lesson in this file, kept deliberately: those nine strings were
 * rewritten carefully in three languages, and the test guarding them FOUND six
 * variants I had missed. Correct work, correct test, and none of it reachable.
 * A test that passes on dead copy reads exactly like coverage.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the description survives every link in the chain', () => {
  it('the extraction is asked for it', () => {
    // The prompt was cut from 129 lines to the placeholder job; the wording
    // changed, the requirement did not.
    expect(manager).toMatch(/description: one or two sentences saying what it is and who it suits/);
    expect(manager).toMatch(/built\n  from what they actually said and in their phrasing/);
  });

  it('the extraction type declares it, or the answer is dropped', () => {
    expect(config).toMatch(/export interface ExtractedService \{[\s\S]*?description\?: string;/);
  });

  it('the draft service type carries it', () => {
    expect(manager).toMatch(/export interface Service \{[\s\S]*?description\?: string;/);
  });

  it('the conversion to the draft shape copies it', () => {
    // This shape is the one the build prefers; dropped here is dropped for good.
    expect(manager).toMatch(/description: s\.description\?\.trim\(\) \|\| undefined/);
  });

  it('both build schemas declare it, or Zod strips it', () => {
    /*
     * An undeclared key reaches the route and never reaches the table, with
     * nothing anywhere to say it had gone.
     */
    const configServices = build.slice(
      build.indexOf('services: z.array(z.object({\n    name: z.string(),')
    );
    expect(configServices).toMatch(/description: z\.string\(\)\.optional\(\)/);

    const chatServices = build.slice(
      build.indexOf('services: z.array(z.object({\n    service_name: z.string(),')
    );
    expect(chatServices).toMatch(/description: z\.string\(\)\.optional\(\)/);
  });

  it('the row prefers the owner\'s words over our invention', () => {
    // `suggestion` exists only on a service we generated ourselves.
    expect(build).toMatch(/description: seed\?\.description \?\? suggestion\?\.description/);
  });
});

describe('the extraction stops chasing a price', () => {
  it('a missing price is not treated as a gap', () => {
    const code = strip(manager);
    expect(code).not.toMatch(/User didn't provide service names or prices/);
    expect(manager).toMatch(/A missing price is NOT a gap: these are placeholders/);
  });

  it('never invents a duration for something nobody timed', () => {
    /*
     * "Default to 60 if it's clearly a session" made every placeholder look
     * like a decided hour-long appointment. The prompt no longer asks for a
     * duration at all, which is a stronger guarantee than a rule against
     * guessing one.
     */
    const code = strip(manager);
    expect(code).not.toMatch(/Default to 60 if it's clearly a session/);
    expect(manager).toMatch(/Never return a price, a duration, a qualification or a result/);

    const prompt = manager.slice(
      manager.indexOf('const CLIENT_WORKFLOW_SYSTEM_PROMPT'),
      manager.indexOf('"needs_more_details": boolean')
    );
    expect(prompt).not.toMatch(/duration_minutes|buffer_minutes|payment_plan|sale_mode/);
  });
});

describe('how the work runs is asked at all', () => {
  it('is a field of the brief', () => {
    expect(BRIEF_FIELDS.map(field => field.key)).toContain('delivery');
    expect(Object.keys(EMPTY_BRIEF)).toContain('delivery');
  });

  it('merges and de-duplicates like every other field', () => {
    const brief = mergeIntoBrief(EMPTY_BRIEF, { delivery: ['a 20-minute call first'] });
    expect(brief.delivery).toEqual(['a 20-minute call first']);
    expect(mergeIntoBrief(brief, { delivery: ['A 20-MINUTE CALL FIRST'] }).delivery).toHaveLength(1);
  });

  it('raises the question ceiling with it, rather than starving the last field', () => {
    /*
     * The cap was once a hardcoded number below the field count, and the last
     * field in the order was never reached: not declined, never asked.
     */
    expect(MAX_FOLLOW_UPS).toBe(BRIEF_FIELDS.length);
  });

  it('asks for the steps of the WORK, not the steps of paying', () => {
    const delivery = BRIEF_FIELDS.find(field => field.key === 'delivery')!;
    expect(delivery.meaning).toMatch(/not the steps of paying/);
    expect(delivery.example).toMatch(/what comes first/i);
  });

  it('is asked by recall, like the rest of them', () => {
    const delivery = BRIEF_FIELDS.find(field => field.key === 'delivery')!;
    expect(delivery.example).not.toMatch(/\b(are they|is it)\b[^?]*,[^?]*\bor\b/i);
    expect(delivery.example).not.toMatch(/—/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * "ON REQUEST" IS NOT A BLANK, IT IS A PRICING POLICY.
 *
 * The plan card printed a price, a duration and a client journey for every
 * service. With placeholders, the price branch resolves to "On request" every
 * time, which reads to the owner as something they chose and to a visitor as
 * something the business published. The journey strip beside it was drawn from
 * a `collection` value nobody had been asked for.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the summary shows names, and says they are drafts', () => {
  /**
   * The services block of the plan deck, and only that.
   *
   * Scoped deliberately: the services EDITOR on the same page shows a price
   * field and labels an empty one "on request", which is correct there and
   * would fail a file-wide assertion. The claim here is about the summary.
   */
  const block = chatPage.slice(
    chatPage.indexOf('{plannedServiceCount > 0 && ('),
    chatPage.indexOf('The pipeline drawn as a pipeline')
  );
  const code = strip(block);

  it('found the block', () => {
    expect(block.length).toBeGreaterThan(200);
  });

  it('prints the service name', () => {
    expect(code).toMatch(/<bdi className="truncate">\{service\.service_name\}<\/bdi>/);
  });

  it('computes no price for a placeholder', () => {
    /*
     * With no price given, the old ternary resolved to "On request" for every
     * row: not a blank, a published pricing policy the owner never set.
     */
    expect(code).not.toMatch(/currencySymbol/);
    expect(code).not.toMatch(/On request|A convenir|לפי הצעת מחיר/);
  });

  it('prints no invented duration', () => {
    expect(code).not.toMatch(/duration_minutes/);
  });

  it('draws no per-service journey from settings nobody chose', () => {
    // The business-wide "how you get paid" and "how clients reach you" cards
    // already say this, from answers that were actually given.
    expect(code).not.toMatch(/ClientJourneyStrip/);
  });

  it('says what will happen to them, in all three languages', () => {
    expect(chatPage).toMatch(/We will create these as drafts/);
    expect(chatPage).toMatch(/ניצור את אלה כטיוטות/);
    expect(chatPage).toMatch(/Los crearemos como borradores/);
  });
});

describe('the build page does not claim work it has not done', () => {
  it('says the services are drafts, not that they are priced', () => {
    expect(buildPage).not.toMatch(/prices and durations set/);
    expect(buildPage).not.toMatch(/con precios y duración/);
    expect(buildPage).toMatch(/services created as drafts/);
    expect(buildPage).toMatch(/שירותים נוצרו כטיוטות/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE POINT OF COLLECTING ANY OF IT.
 *
 * A field captured and not read is the same as a field never asked for, and
 * costs a question on top. Both of these were measured as holes after the
 * capture worked: `delivery` was stripped by the build's Zod schema, and the
 * service description reached the table while the generator's service line
 * still rendered name and price alone.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('what was collected is what gets read', () => {
  const site = read('lib/services/WebsiteGenerationService.ts');

  it('the build schema declares delivery, or it never reaches the profile', () => {
    const brief = build.slice(
      build.indexOf('business_brief: z.object({'),
      build.indexOf('clients_per_week: z.number()')
    );
    expect(brief).toMatch(/delivery: z\.array\(z\.string\(\)\)\.optional\(\)/);
  });

  it('the site prompt points delivery at the section it answers', () => {
    /*
     * Not just included: named. processSteps was filled by `journeySteps()`
     * from the BOOKING flow, which says "pick a time, get a confirmation, turn
     * up" for every business on the platform.
     */
    expect(site).toMatch(/HOW THE WORK RUNS, in the owner's words/);
    expect(site).toMatch(/Write processSteps from THIS/);
  });

  it('plans a process section when the owner described the work', () => {
    // With no catalogue, refusing to plan one discards the answer entirely.
    expect(site).toMatch(/process: hasServices \|\| \(facts\?\.brief\?\.delivery\?\.length \?\? 0\) > 0/);
  });

  it('puts the owner\'s service description into the prompt, first', () => {
    /*
     * From a name alone the model writes "professional personal training
     * tailored to your needs", which is what the interview change exists to
     * stop.
     */
    expect(site).toMatch(/const own = typeof s\.description === 'string'/);
    expect(site).toMatch(/\$\{s\.service_name\}: \$\{own\}\$\{facts\}/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE COUNT IS THE ANSWER, SO THE COUNT HAS TO BE READ.
 *
 * Reported as "why is the services list not in the my plan for page". The
 * services question asks how MANY services there are, deliberately: the chat
 * used to render a fifteen-column grid to collect every field of every service
 * before anything existed, and that is where owners stopped.
 *
 * So on the ordinary path `services` is EMPTY and `service_count` holds the
 * answer. Both screens gated their services section on the catalogue alone,
 * and neither even DECLARED `service_count` on its own type, so the number was
 * an undefined read. Three services were created by a build whose plan screen
 * had not mentioned any, and whose progress line would have reported "0
 * services created as drafts" about them.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('a service nobody named is still a service being created', () => {
  it('both screens declare the count on their own type', () => {
    // An undeclared field is a silent `undefined`, which is how this shipped.
    expect(chatPage).toMatch(/service_count\?: number;/);
    expect(buildPage).toMatch(/service_count\?: number;/);
  });

  it('the plan card renders on the count, not the catalogue', () => {
    expect(chatPage).toMatch(/\{plannedServiceCount > 0 && \(/);
    expect(chatPage).not.toMatch(/\{\{plannedServiceCount > 0 && \(/);
  });

  it('takes the larger of the two, because they disagree in both directions', () => {
    /*
     * A count of three with one service named, or a catalogue of four against
     * a stale count of two. The build creates `service_count` rows and tops up
     * from the catalogue, so the larger figure is the honest promise.
     */
    expect(chatPage).toMatch(/const plannedServiceCount = Math\.max\(/);
    expect(buildPage).toMatch(/const plannedServices = Math\.max\(/);
  });

  it('the build page counts the same way its step list decides', () => {
    // These were two different readings: the step appeared on one and its
    // result line was computed from the other, printing 0.
    expect(buildPage).toMatch(/const hasServices = plannedServices > 0;/);
    expect(buildPage).toMatch(/result: `\$\{plannedServices\} \$\{/);
  });

  it('shows the unnamed ones as unnamed rather than inventing names', () => {
    /*
     * An invented name shown as though they had chosen it is worse than an
     * honest blank: they read it, accept it, and later find it on their own
     * website.
     */
    expect(chatPage).toMatch(/unnamedServiceCount/);
    expect(chatPage).toMatch(/unnamed service/);
    expect(chatPage).toMatch(/שירות ללא שם/);
    expect(chatPage).toMatch(/servicio sin nombre/);
  });

  it('tells them what they will have to do to the unnamed ones', () => {
    expect(chatPage).toMatch(/You name, price and time them later/);
  });
});

/*
 * `describe('the plan heading is one line')` was here, and was removed on
 * 2026-10-14 because it had become the opposite of true.
 *
 * It asserted `items-baseline` and a separate `h2`, which is what the heading
 * was after the first fix: label and name on one shared baseline. That solved
 * the stranded preposition and introduced a size jump — `text-xs` muted beside
 * `text-xl` bold — so the heading is now one `p` at one size with the name
 * bolded inside it.
 *
 * The assertions live with the surface they describe, in
 * `app/onboarding-chat/__tests__/theDescriptionIsOnThePlanCard.guard.test.ts`.
 * Two guards in two files describing one heading is how they end up
 * contradicting each other, which is exactly what happened here.
 */
