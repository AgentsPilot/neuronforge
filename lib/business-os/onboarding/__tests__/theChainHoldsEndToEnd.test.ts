/**
 * The interview's answers survive every hop to the website.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A FUNCTIONAL TEST AND NOT ANOTHER FILE-READING GUARD
 *
 * Every defect in this chain has been a DROPPED FIELD, and every one of them
 * was invisible: a key not declared on a type, a key not declared in a Zod
 * schema, a key the extractor asked for and its own return block omitted. The
 * guards elsewhere pin the lines that carry each hop; this runs the hops.
 *
 * Measured failures this covers, each of which shipped:
 *   · `business_brief` reaching the route and never the table (Zod strips an
 *     undeclared key silently)
 *   · `needs_intake` requested by a prompt, declared on a type, and omitted by
 *     the return block, so no account ever got an intake form
 *   · service descriptions threaded the whole way and never populated
 *   · `sells_scheduled` carried through `computeConfiguration` and read by
 *     nothing, so the scheduling capability never switched on
 *
 * The shape fed in is what `finalizeConfiguration` assembles at the preview
 * step, taken from a real account's stored snapshot.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/*
 * `uuid` ships ESM only and Jest cannot parse it, which is why the other
 * website tests read the source file instead of importing the service. The
 * established mock in this repo is the one line below (see
 * `callParams.boundary.step2.test.ts`), and it is all that stands between a
 * file-reading guard and a test that runs the real code.
 */
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000001' }));

import { onboardingConfigurationService, type ExtractedData } from '@/lib/services/OnboardingConfigurationService';

/** What the interview holds by the time it reaches `preview`. */
const answers: ExtractedData = {
  company_name: 'David KPMG',
  vertical: 'teacher',
  description: 'I am a school trainer helping high school kids with their academic challenges.',
  sells_scheduled: true,
  collection_method: 'invoice',
  service_count: 3,
  needs_intake: true,
  business_brief: {
    audience: ['kids in high school mainly'],
    outcome: ['getting better in school assignments'],
    differentiators: ['many years of experience'],
    credentials: ['many years of experience'],
    objections: ['that I make sure the kids show progress'],
    delivery: ['a first session to find the gaps, then weekly sessions on the current homework'],
    voice: 'individual',
  },
  services: [
    {
      name: 'School Assignment Tutoring',
      description: 'One-to-one help with the assignments a student is behind on.',
      is_scheduled: true,
      collection: 'invoice',
    },
  ],
} as ExtractedData;

const configuration = onboardingConfigurationService.computeConfiguration(answers, 'en');

describe('computeConfiguration keeps what the build and the website need', () => {
  it('carries the brief, with every field', () => {
    /*
     * The website's audience, differentiators, credentials, FAQ and
     * How-It-Works are all written from this. Dropped here, every one of them
     * falls back to generic copy and nothing says why.
     */
    expect(configuration.business_brief).toEqual(answers.business_brief);
  });

  it('carries the count, which is what creates the service rows', () => {
    // The build's whole draft branch is `service_count > 0`.
    expect(configuration.service_count).toBe(3);
  });

  it('carries the services WITH their descriptions', () => {
    const [service] = configuration.services;
    expect(service.name).toBe('School Assignment Tutoring');
    expect(service.description).toBe('One-to-one help with the assignments a student is behind on.');
  });

  it('carries the intake answer, which is the only thing that generates a form', () => {
    // Set for nobody until 2026-10-14: asked for, declared, and dropped.
    expect(configuration.needs_intake).toBe(true);
  });

  it('switches scheduling on from a service that is booked against a time', () => {
    /*
     * `addCapability('scheduling')` is the ONLY source of that capability and
     * read `services.length`, which is empty on the count flow — so it never
     * fired, while `sells_scheduled` was carried here and read by nothing.
     */
    expect(configuration.capabilities).toContain('scheduling');
  });

  it('asks for no card processor when the money arrives by invoice', () => {
    /*
     * The expensive direction: a business that invoices should never be sent
     * through a Stripe identity check. Decided per service now, and the
     * placeholder rows carry the answer the owner gave.
     */
    expect(configuration.needs_stripe_connect).toBe(false);
  });

  it('picks a real pipeline preset rather than falling through to default', () => {
    /*
     * `teacher` has its own preset, and `normalizeVertical` used to rewrite it
     * to `tutor` — which is not a preset key — before the lookup, so two of the
     * nine hand-written pipelines were unreachable.
     */
    expect(configuration.pipeline_stages.length).toBeGreaterThan(0);
    expect(configuration.vertical).toBe('teacher');
  });
});

describe('the website reads the brief and the services it was given', () => {
  /*
   * `businessFacts` and `planSections` are private, and deliberately: nothing
   * outside the service should decide what a page contains. Reached here
   * because the alternative is asserting on source text, which cannot tell
   * whether a field actually arrives.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let site: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let facts: any;

  beforeAll(async () => {
    const { WebsiteGenerationService } = await import('@/lib/services/WebsiteGenerationService');
    site = new WebsiteGenerationService();
    /* The profile as the build writes it: `extracted_data` IS the configuration. */
    facts = site.businessFacts({ extracted_data: configuration }, configuration.services);
  });

  it('finds the brief where the build put it', () => {
    // `extracted_data = configuration`, so the brief rides along inside it.
    expect(facts.brief).toEqual(answers.business_brief);
  });

  it('knows the business sells something, from the answers not the catalogue', () => {
    /*
     * The original complaint. The plan took one input, the list of BOOKABLE
     * services, and onboarding's are drafts — so `services:false,
     * process:false` and the prompt never asked for descriptions or steps.
     */
    expect(facts.sellsSomething).toBe(true);
  });

  it('plans the sections the answers can actually fill', () => {
    const plan = site.planSections(configuration.services, false, facts);

    expect(plan.services).toBe(true);
    expect(plan.process).toBe(true);
    expect(plan.faq).toBe(true);
    /* Never invented under a real business's name, and the owner has none. */
    expect(plan.testimonials).toBe(false);
  });

  it('plans a process section from the delivery answer even with no catalogue', () => {
    // That answer IS a process section; refusing to plan one discards it.
    const noCatalogue = site.planSections([], false, { ...facts, sellsSomething: false });
    expect(noCatalogue.process).toBe(true);
  });

  it('answers the FAQ from the owner\'s own facts when the model returns none', () => {
    const asked = site.faqFromFacts(facts, configuration.services, 'en');

    expect(asked.length).toBeGreaterThan(0);
    /* Booking and money, both read off answers they gave. */
    expect(JSON.stringify(asked)).toMatch(/book/i);
    expect(JSON.stringify(asked)).toMatch(/invoice/i);
    /* Never a price, a result or a qualification. */
    expect(JSON.stringify(asked)).not.toMatch(/guarantee|years of experience|\$/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE PROFILE'S OWN COLUMNS, not just the blob inside it.
 *
 * Read from a real profile row after a complete build:
 *
 *     services           "[]"      while extracted_data had three
 *     collection_method  null      while extracted_data had "invoice"
 *     clients_per_week   5         and nobody was ever asked
 *
 * Each is read by something that does not look inside `extracted_data`:
 * `setupGraph` reads `profile.collection_method` as the EXPLICIT answer,
 * `WebsiteAutoBuildService` joins `profile.services` into its prompt, and the
 * website prompt used to state the volume as fact.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the build fills the columns its readers actually read', () => {
  const route = require('fs').readFileSync(
    require('path').join(process.cwd(), 'app/api/onboarding/build/route.ts'),
    'utf8'
  );

  it('writes collection_method to the column, not only into the blob', () => {
    // `setupGraph`: `const explicit = profile.collection_method`.
    expect(route).toMatch(/profileData\.collection_method = configuration\.collection_method \?\? null;/);
  });

  it('records the service NAMES that were actually created', () => {
    /*
     * After creation, not with the rest of the profile: at that point the rows
     * do not exist, and these names include any the build generated itself to
     * reach the count.
     */
    expect(route).toMatch(/\.update\(\{ services: names \}\)/);
    expect(route).toMatch(/createdServices\n\s*\.map\(created => created\.service_name\)/);
  });

  it('never fails the build over either of them', () => {
    // A thinner prompt on one path is not a reason to lose an account's setup.
    expect(route).toMatch(/'Could not record the service names on the profile'/);
  });
});

describe('nothing invents a client volume', () => {
  it('is null when nobody asked, which is always', () => {
    /*
     * `|| 5` made every business serve five clients a week. No question feeds
     * this field, the prompt no longer guesses it, and the website no longer
     * prints it.
     */
    expect(configuration.clients_per_week).toBeNull();
  });

  it('the type and the request schema both allow null', () => {
    // A required `number` is what kept the `|| 5` alive upstream.
    const config = require('fs').readFileSync(
      require('path').join(process.cwd(), 'lib/services/OnboardingConfigurationService.ts'),
      'utf8'
    );
    const route = require('fs').readFileSync(
      require('path').join(process.cwd(), 'app/api/onboarding/build/route.ts'),
      'utf8'
    );

    expect(config).toMatch(/clients_per_week: number \| null;/);
    expect(config).toMatch(/extracted\.clients_per_week \?\? null/);
    expect(route).toMatch(/clients_per_week: z\.number\(\)\.nullable\(\)/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * SUB-VERTICAL: a sparse table, and a prompt that discouraged choosing.
 *
 * Reported as "the sub vertical is empty". Two separate things, and only one of
 * them was a defect.
 *
 * THE DEFECT: the rewritten prompt said only what NOT to choose. "ONLY these
 * change anything", "null for anything else", "reads back to the owner as a
 * decision nobody made" — three sentences, all discouraging, and the old
 * prompt's one worked example removed along with them. Measured against the
 * live model afterwards, the reframed version returns `parenting_coach` for a
 * parenting coach and `workshop_leader` for a workshop business, where the
 * previous wording returned null.
 *
 * NOT A DEFECT: most businesses have no sub-vertical to find. Five exist
 * across nine verticals, all under `coach` and `teacher`, so a hair salon
 * returning null is the correct and only possible answer. Empty is the normal
 * case, not a failure.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the sub-vertical instruction says what choosing one does', () => {
  const manager = require('fs').readFileSync(
    require('path').join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
    'utf8'
  );

  it('names the consequence of a match, not just the cost of a miss', () => {
    expect(manager).toMatch(/Each carries its own pipeline stages,/);
    expect(manager).toMatch(/a match is worth taking rather than passing over/);
  });

  it('no longer leads with the discouraging framing', () => {
    /*
     * Comment-stripped: the code's own note quotes the old wording to explain
     * why it went, and a raw match finds that quotation. The same trap this
     * file's siblings strip for.
     */
    const code = manager.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/ONLY these change anything/);
    expect(code).not.toMatch(/reads back to the owner as a decision nobody made/);
  });

  it('still forbids inventing one that is not on the list', () => {
    // A word off the list reaches no consumer at all.
    expect(manager).toMatch(/null ONLY when none of them fits/);
  });

  it('names no individual trade, so the list stays the only authority', () => {
    /*
     * The old prompt carried "IMPORTANT: if the business teaches/advises
     * PARENTS about parenting or family, use sub_vertical: parenting_coach" —
     * a rule for one customer type baked into a prompt, which is what
     * CLAUDE.md's no-hardcoding rule exists to prevent. The replacement tells
     * the model to read the names literally instead.
     */
    const block = manager.slice(
      manager.indexOf("'2. sub_vertical."),
      manager.indexOf("'3. needs_booking.")
    );
    expect(block).toMatch(/these names\n    \/\/.*|read literally|mean what they say/);
    expect(block).not.toMatch(/IMPORTANT|parenting|tutor is|fitness/);
  });

  it('offers exactly the sub-verticals that have a pipeline', () => {
    // Injected from the table, so the prompt cannot offer a dead option again.
    expect(manager).toMatch(/\$\{PIPELINE_SUB_VERTICALS\.join\(', '\)\}/);
  });
});
