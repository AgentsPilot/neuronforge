/**
 * The three things the file was missing against the current direction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The direction: the interview configures the platform and learns enough to
 * write about the business. Services are PLACEHOLDERS carrying a name and the
 * owner's words; price, duration and per-service exceptions belong to the
 * editor. Every question earns its turn. Nothing is invented on the owner's
 * behalf.
 *
 * Measured against that, three things were absent rather than wrong, which is
 * why no test caught them:
 *
 *   1. NOTHING NAMED THE SERVICES. The interview collects a count, so the build
 *      wrote rows called "Service 1", "Service 2", "Service 3" and the website
 *      published a catalogue of numbered blanks. A `description` field had been
 *      threaded all the way from the extraction to the draft row, and the only
 *      thing that would have filled it sat in the unreachable half of
 *      `service_details`: correct plumbing, faucet off.
 *
 *   2. `needs_intake` WAS SET FOR NOBODY. Its only writer was reached from that
 *      same unreachable half, and `extractClientWorkflow` dropped the field in
 *      its own return block while the prompt asked for it and the type declared
 *      it. Asked for, discarded, nothing said so.
 *
 *   3. THE PREVIEW CONFIRMATION MATCHED SUBSTRINGS. "necesito cambiar el
 *      precio" contains "si"; "restart" contains "start"; "broken" contains
 *      "ok". An owner asking for a change had their account built instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const manager = read('lib/services/OnboardingConversationManager.ts');
const config = read('lib/services/OnboardingConfigurationService.ts');
const catalog = read('lib/business-os/llm/callCatalog.ts');
const policy = read('lib/business-os/llm/modelSettingsPolicy.ts');

/** Comments stripped: this file necessarily names what it forbids. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the placeholder services are named', () => {
  it('names them from what the owner already said, not from a new question', () => {
    /*
     * The interview is six turns. The owner has already described their work,
     * their clients and what those clients get; a seventh question asking what
     * they sell would be asking something they have largely answered.
     */
    expect(manager).toMatch(/private async draftServices\(/);
    expect(manager).toMatch(/How the work runs, in their words:/);
  });

  it('is registered in the call catalogue AND the model policy', () => {
    /*
     * Both halves, or the CI attribution type check fails. Forgotten once
     * already on `business_deepening`.
     */
    expect(catalog).toMatch(/'service_drafting'/);
    expect(policy).toMatch(/service_drafting: tokenCall\(/);
  });

  it('asks for a name and a description, and for nothing we do not know', () => {
    const prompt = manager.slice(
      manager.indexOf('private async draftServices'),
      manager.indexOf('Return JSON: {"services"')
    );

    expect(prompt).toMatch(/"name": what a client would see on a booking page/);
    expect(prompt).toMatch(/"description": one or two sentences/);
    // The whole point of placeholders: these are the editor's fields.
    expect(prompt).toMatch(/NEVER state a price, a length, a qualification, or a result/);
  });

  it('never invents a duration or a price on the row it returns', () => {
    const builder = manager.slice(
      manager.indexOf('const drafted: ExtractedService[]'),
      manager.indexOf("logger.info({ wanted: count")
    );
    expect(builder).not.toMatch(/duration_minutes|price:/);
  });

  it('keeps a name the owner typed over one we generated', () => {
    // The story sometimes names a service outright, and that name is theirs.
    expect(manager).toMatch(/const owed = count - named\.length;/);
    expect(manager).toMatch(/taken\.has\(service\.name\.toLowerCase\(\)\.trim\(\)\)/);
  });

  it('strips the dash from a generated name and description', () => {
    expect(manager).toMatch(/name: withoutDashPunctuation\(row\.name\.trim\(\)\)/);
  });

  it('degrades to the build\'s own naming rather than failing the turn', () => {
    // A failed naming call is a worse catalogue, never a missing one.
    expect(manager).toMatch(/'Naming the draft services failed'/);
  });
});

describe('a placeholder still carries the answers the owner gave', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE SUBTLE HALF, and the reason it is pinned.
   *
   * `computeConfiguration` reads the catalogue to decide two things, and an
   * EMPTY catalogue has a fallback while a populated one does not. So a row
   * carrying a name and nothing else does not merely fail to inform those
   * decisions, it inverts them.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('stamps the scheduling and collection answers onto the generated rows', () => {
    expect(manager).toMatch(/\.map\(service => \(\{ \.\.\.service, is_scheduled: sellsScheduled, collection \}\)\)/);
  });

  it('keeps the Stripe decision reading an answer that is actually there', () => {
    /*
     * `needs_stripe_connect` switches from the business-wide `collection_method`
     * to `services.some(collection === 'online')` the moment a catalogue
     * exists. Unstamped, an owner who had just said "the client pays online by
     * card" would have been given no processor — the exact bug the comment at
     * that line records being fixed once already.
     */
    expect(config).toMatch(/needs_stripe_connect: services\.length > 0/);
    expect(config).toMatch(/services\.some\(service => service\.collection === 'online'\)/);
  });

  it('decides the scheduling capability on is_scheduled, not on row count', () => {
    /*
     * This is the ONLY place that capability is ever added, and it read
     * `services.length > 0` — so on a flow that collects a count rather than a
     * catalogue it never fired at all, while `sells_scheduled` was carried
     * through and read by nothing.
     */
    expect(config).toMatch(/data\.services\.some\(service => service\.is_scheduled !== false\)/);
    expect(config).not.toMatch(/if \(data\.services && data\.services\.length > 0\) \{\n      addCapability\('scheduling'/);
  });
});

describe('intake is asked, and only where it means anything', () => {
  it('is asked of a business that books appointments', () => {
    expect(manager).toMatch(/pendingQuestion = 'intake'/);
    expect(manager).toMatch(/clientWorkflow\?\.sells_scheduled !== false/);
  });

  it('is a question rather than an inference', () => {
    /*
     * It creates a `user_intake_settings` row and puts a form in front of the
     * owner's clients. Guessing that from prose is the one place in this file
     * where being wrong writes something a stranger has to fill in.
     */
    expect(manager).toMatch(/private readIntakeAnswer\(/);
    expect(manager).toMatch(/intake_prompt:/);
  });

  it('asks what the client does, not what the feature is called', () => {
    // "Do you need an intake form?" asks the owner to know what we mean by one.
    expect(manager).toMatch(/Do your clients fill in anything before you see them/);
    expect(manager).toMatch(/הלקוחות שלכם ממלאים משהו לפני שאתם נפגשים/);
    expect(manager).toMatch(/¿Tus clientes rellenan algo antes de verte/);
  });

  it('defaults to NO when nothing is recognised', () => {
    /*
     * The opposite direction to `readScheduledAnswer`, deliberately. A missing
     * form is something the owner adds when they want it; an unwanted one is a
     * questionnaire their clients must fill in, with questions nobody wrote.
     */
    const reader = manager.slice(
      manager.indexOf('private readIntakeAnswer'),
      manager.indexOf('private readIntakeNeed')
    );
    expect(reader).toMatch(/return !negated && words\.some/);
  });

  it('still reads the older form\'s labels, so a stored conversation resumes', () => {
    expect(manager).toMatch(/if \(this\.readIntakeNeed\(message\)\) return true;/);
  });
});

describe('a change at the preview is never read as agreement', () => {
  it('matches whole words, not substrings', () => {
    expect(manager).toMatch(/return patterns\.some\(p => containsWholeWord\(lowerMsg, p\)\)/);
  });

  it('treats a negated confirm word as a rejection', () => {
    // "no vale así" is a rejection written in the vocabulary of acceptance.
    expect(manager).toMatch(/if \(NEGATORS\.some\(word => containsWholeWord\(lowerMsg, word\)\)\) return false;/);
    expect(manager).toMatch(/const NEGATORS = \[/);
  });

  it('records why the asymmetry points this way', () => {
    /*
     * A false positive builds an account from a plan the owner was objecting
     * to. A false negative routes to `preview_adjustment`, whose model reads
     * the same sentence and may return `confirm` anyway.
     */
    expect(manager).toMatch(/a false POSITIVE builds the account/);
  });
});

describe('the file says what it now does', () => {
  it('the header describes the live flow, not a retired one', () => {
    // It described "3. Client Workflow - services, pricing, payment timing".
    expect(manager).not.toMatch(/3\. Client Workflow - services, pricing/);
    expect(manager).toMatch(/THE INTERVIEW HAS TWO JOBS/);
    expect(manager).toMatch(/intake \(if booked\) → channels → plan/);
  });

  it('says plainly that it does not collect a catalogue', () => {
    expect(manager).toMatch(/What it does NOT do, by decision: collect a catalogue/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * A SLIP IS NOT AN ANSWER.
 *
 * Reported from a real run:
 *
 *   "Thanks! Now tell me about the business. What do you do, and what brought
 *    you here today?"
 *   > I
 *   "What do your clients have or feel differently after working with you?"
 *
 * `business_story` accepted any non-empty message, so "I" became the business
 * description and everything downstream was written from it: the follow-up
 * questions, the composed description, the service names, the website.
 *
 * The first fix was a word and letter count. It was thrown away, and the reason
 * is the part worth pinning: a threshold cannot tell "I" from "מאמן כושר"
 * because Hebrew says more per character, so any number is stricter in one
 * script than another — before it ever meets a vertical that describes itself
 * in two words.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('an answer that describes no business is asked for again', () => {
  it('the model judges it, not a rule in this file', () => {
    expect(manager).toMatch(/describes_business === false/);
    expect(manager).toMatch(/5\. describes_business\. Is there enough here to tell what this business/);
  });

  it('counts nothing: no length, word or character threshold', () => {
    /*
     * Scoped to the `business_story` branch, because two length checks
     * elsewhere are legitimate and must stay: a follow-up reply under two
     * characters is read as a SKIP (which only means "move on" and never
     * becomes copy), and `writeDescription` rejects an unusably short reply
     * from our OWN model. Neither judges what the owner said about their
     * business.
     *
     * A count in THIS branch would be invisible until a Hebrew or Spanish
     * owner hit it.
     */
    const code = strip(manager);
    expect(code).not.toMatch(/tooThinToDescribe/);

    const branch = code.slice(
      code.indexOf("case 'business_story':"),
      code.indexOf("case 'business_deepening':")
    );
    expect(branch.length).toBeGreaterThan(200);
    expect(branch).not.toMatch(/\.length < \d|letters < \d|words < \d|\.length >= \d/);
  });

  it('treats a missing or failed judgement as "yes, they answered"', () => {
    /*
     * Both directions. A model that omits the field, or a provider that errors,
     * must never cost the owner a repeated question: our failure is not
     * evidence that they said nothing.
     */
    expect(manager).toMatch(/describes_business: extracted\.describes_business !== false/);
    expect(manager).toMatch(/return \{ vertical: 'default', describes_business: true \};/);
  });

  it('asks once, never twice, and accepts whatever comes back', () => {
    // An interview that can refuse to move on is one somebody cannot finish.
    expect(manager).toMatch(/!updatedState\.collectedData\.storyAlreadyReasked/);
    expect(manager).toMatch(/storyAlreadyReasked = true/);
    expect(manager).toMatch(/storyAlreadyReasked\?: boolean;/);
  });

  it('words the second ask differently, in all three languages', () => {
    // Repeating the same sentence reads as though the answer never arrived.
    expect(manager).toMatch(/business_story_again_prompt: "Sorry, I need a little more/);
    expect(manager).toMatch(/business_story_again_prompt: 'סליחה, אני צריך קצת יותר/);
    expect(manager).toMatch(/business_story_again_prompt: 'Perdona, necesito un poco más/);
  });

  it('shows the second ask instead of the first when one is owed', () => {
    expect(manager).toMatch(/state\.pendingQuestion === 'story_again'/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE NAME IS READ BACK, because it is the one answer talking cannot fix.
 *
 * It is taken exactly as typed, deliberately: it used to be INFERRED from
 * whatever the owner wrote about their business, falling back to "your
 * business" when they never said it, so an account could be built under a name
 * nobody chose.
 *
 * But exactly-as-typed keeps a slip exactly too, and this field is not one the
 * owner meets again in passing: it goes on every invoice and every email the
 * platform sends for them. The plan screen is the only other sighting, and by
 * then it is several questions back and reads as settled.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the business name is confirmed before the interview moves on', () => {
  it('reads it back instead of accepting it silently', () => {
    expect(manager).toMatch(/pendingQuestion = 'name_confirm'/);
    expect(manager).toMatch(/private readNameConfirmation\(/);
  });

  it('says WHERE the name ends up, in all three languages', () => {
    /*
     * "Is this correct?" invites a reflexive yes. Naming the consequence is
     * what makes somebody actually look at the string.
     */
    expect(manager).toMatch(/It goes on every invoice and email we send for you/);
    expect(manager).toMatch(/זה יופיע על כל חשבונית וכל מייל שנשלח בשמכם/);
    expect(manager).toMatch(/Va en cada factura y cada correo que enviamos por ti/);
  });

  it('treats a typed replacement as a correction, not as a yes or a no', () => {
    // What somebody who spots their own typo actually does.
    expect(manager).toMatch(/'yes' \| 'no' \| 'renamed'/);
    expect(manager).toMatch(/they typed a replacement/);
  });

  it('never stores a word of refusal as the business name', () => {
    /*
     * The failure the third verdict exists to prevent. A reply that is ONLY a
     * refusal is a refusal; anything longer is the name they meant.
     */
    expect(manager).toMatch(/if \(NEGATORS\.includes\(text\)\) return 'no';/);
  });

  it('reuses the existing refusal vocabulary rather than a second list', () => {
    // One list, so "לא" means the same here as at the preview.
    const reader = manager.slice(
      manager.indexOf('private readNameConfirmation'),
      manager.indexOf('private readIntakeAnswer')
    );
    expect(reader).toMatch(/NEGATORS/);
    expect(reader).not.toMatch(/const [A-Z_]+ = \[/);
  });

  it('asks again without repeating the opening line', () => {
    // "Let's start with the name" after they already gave one reads as deaf.
    expect(manager).toMatch(/business_name_again_prompt: 'No problem\. What should it be\?'/);
    expect(manager).toMatch(/state\.pendingQuestion === 'name_again'/);
  });

  it('counts nothing when judging the reply', () => {
    const reader = manager.slice(
      manager.indexOf('private readNameConfirmation'),
      manager.indexOf('private readIntakeAnswer')
    );
    expect(reader).not.toMatch(/\.length [<>]=? \d/);
  });
});
