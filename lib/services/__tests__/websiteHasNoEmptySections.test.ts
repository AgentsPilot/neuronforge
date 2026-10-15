/**
 * A generated site has no heading over a void.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * A new account finished onboarding and published a site whose Services,
 * How-It-Works, Testimonials and Our-Impact sections were titles with empty
 * arrays under them. Reported as "it added the sections but not the content".
 *
 * The model was called and did answer — the ledger shows `business-os-website
 * gpt-4o` 0.57s before the page row. It was barely asked anything, because the
 * plan took one input: the list of BOOKABLE services. Three had been created as
 * drafts five seconds earlier and the first was not activated for another
 * ninety-seven, so `services:false, process:false` and the prompt never
 * requested descriptions or steps.
 *
 * Three further faults compounded it, and each is pinned below:
 *   · the plan was consulted by the prompt and ignored by the block builder;
 *   · `stats` was built with a hardcoded `[]` and never asked for at all;
 *   · the testimonials guidance was unconditional, and in live testing produced
 *     "Sarah M.", "David R." and "Emily T." with quotes, for a business that
 *     had never had a client.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'lib/services/WebsiteGenerationService.ts'),
  'utf8'
);

/** Comments stripped: this file necessarily names what it forbids. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the plan reads what the interview answered', () => {
  it('asks the answers whether the business sells anything', () => {
    /*
     * `service_count: 3` and `sells_scheduled: true` were on the profile the
     * whole time. A draft service still means the business sells something.
     */
    expect(code).toMatch(/sellsSomething:\s*services\.length > 0 \|\| Number\(answers\.service_count/);
    expect(code).toMatch(/const hasServices = facts\?\.sellsSomething \?\? services\.length > 0/);
  });

  it('lets the catalogue refine, not decide', () => {
    // Rows are a later and more specific statement than the one-tap answer.
    expect(code).toMatch(/isScheduled: services\.length/);
  });

  it('builds the journey from the answers too', () => {
    // It collapsed to ['confirmation'] because it read services.length alone.
    expect(code).toMatch(/client_flow: facts\?\.sellsSomething \|\| services\.length > 0/);
  });
});

describe('the brief reaches the model', () => {
  it('is rendered into the prompt', () => {
    expect(code).toMatch(/const brief = facts\?\.brief/);
    expect(code).toMatch(/WHAT THE OWNER TOLD US/);
  });

  it('carries the voice, so the copy stops switching person', () => {
    // The About text swung between "our mission", "I bring" and "We work" in
    // one paragraph because nothing recorded which this business is.
    expect(code).toMatch(/VOICE: one person/);
    expect(code).toMatch(/VOICE: a team/);
  });

  it('points the FAQ at what actually stops people buying', () => {
    expect(code).toMatch(/ANSWER THESE FIRST/);
  });
});

describe('testimonials are never invented', () => {
  it('the prompt forbids them outright when there are none', () => {
    expect(code).toMatch(/Do NOT produce testimonials/);
  });

  it('the guidance is gated, not unconditional', () => {
    // Unconditional guidance is what produced Sarah M. while the JSON shape
    // omitted the field entirely.
    expect(code).toMatch(/\$\{sections\.testimonials \? `=== TESTIMONIALS GUIDELINES ===/);
  });

  it('the section is still built, and left empty', () => {
    // The owner needs somewhere to put real ones.
    expect(code).toMatch(/block_type: 'testimonials'/);
    expect(code).toMatch(/plan\.testimonials \? content\.testimonials \|\| \[\] : \[\]/);
  });

  it('is never backfilled', () => {
    const filler = code.slice(code.indexOf('private fillPlannedGaps'), code.indexOf('private journeySteps'));
    expect(filler).not.toMatch(/testimonials/);
  });
});

describe('no section is built that nothing can fill', () => {
  it('stats is not built at all', () => {
    /*
     * There is no `stats` key anywhere in the prompt, so the model is never
     * asked, and this emitted `stats: []` regardless — "Our Impact" over
     * nothing on every site that ordered one.
     */
    expect(code).not.toMatch(/block_type: 'stats'/);
  });

  it('gallery stays conditional on having images', () => {
    // The pattern the rest of this should have followed from the start.
    expect(code).toMatch(/gallery\.length/);
  });
});

describe('a planned section is never published empty', () => {
  it('process steps are written from the journey when the model omits them', () => {
    expect(code).toMatch(/plan\.process && !\(content\.processSteps\?\.length\)/);
    expect(code).toMatch(/private journeySteps/);
  });

  it('service descriptions are written from the catalogue', () => {
    expect(code).toMatch(/plan\.services && services\.length/);
    expect(code).toMatch(/private serviceSentence/);
  });

  it('writes the fallback steps in the business\'s own language', () => {
    // An English step list under Hebrew headings is the failure this platform
    // has already paid for once, in the onboarding extraction.
    const steps = code.slice(code.indexOf('private journeySteps'), code.indexOf('private serviceSentence'));
    expect(steps).toMatch(/he: \{/);
    expect(steps).toMatch(/es: \{/);
  });

  it('does not invent a price for a quoted service', () => {
    // Null is a real answer — "the fee is agreed with each client".
    const sentence = code.slice(code.indexOf('private serviceSentence'));
    expect(sentence).toMatch(/price === null \|\| price === undefined/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE TWO SECTIONS THAT WERE STILL EMPTY, measured on a real generated site.
 *
 *     Our Services
 *     Services Offered
 *     (nothing)
 *
 * The services existed. Three rows, `status=draft`, each carrying the
 * description the interview collected. The generator asked for BOOKABLE
 * services only, onboarding creates drafts, so it received zero — and with no
 * catalogue the process steps fell back to generic ones too.
 *
 * And the FAQ was planned with nothing to answer, because `brief.objections`
 * came back `[]` on that account.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('a draft page sees draft services', () => {
  it('asks for bookable-only ONLY when the page it writes may be live', () => {
    /*
     * A fresh generation creates the page as `status: 'draft'`, so page and
     * services are published together by the same owner and a draft page
     * describing draft services cannot mislead anybody. An UPDATE keeps the
     * page's existing status, so that path stays conservative.
     */
    expect(code).toMatch(/const pageMayBeLive = !!options\.pageId;/);
    expect(code).toMatch(/listAll\(userId, pageMayBeLive\)/);
  });

  it('no longer hardcodes the bookable-only fetch', () => {
    expect(code).not.toMatch(/listAll\(userId, true\)/);
  });
});

describe('a planned FAQ is never a heading over nothing', () => {
  it('is filled when the model returns none', () => {
    expect(code).toMatch(/if \(plan\.faq && !\(content\.faq\?\.length\)\)/);
    expect(code).toMatch(/private faqFromFacts\(/);
  });

  it('answers from what the owner actually said, claiming nothing else', () => {
    const filler = code.slice(code.indexOf('private faqFromFacts'), code.indexOf('private journeySteps'));

    // Booking, money, intake: three answers the owner gave.
    expect(filler).toMatch(/scheduled/);
    expect(filler).toMatch(/needsIntake/);
    // Never a price, a duration, a result or a qualification.
    expect(filler).not.toMatch(/price|guarantee|years|qualified|experience/i);
  });

  it('reads the real collection_method values', () => {
    /*
     * Written as `collects === 'online'` first, which matches none of
     * `card_online | invoice | in_person | mixed | none`. A silent no-op.
     */
    const filler = code.slice(code.indexOf('private faqFromFacts'), code.indexOf('private journeySteps'));
    expect(filler).toMatch(/collects === 'card_online' \|\| collects === 'mixed'/);
    expect(filler).toMatch(/collects === 'invoice' \|\| collects === 'in_person'/);
    expect(filler).not.toMatch(/collects === 'online'/);
  });

  it('says nothing about payment when they never said how', () => {
    /*
     * A guess here is the one FAQ answer a visitor would act on, so `null`
     * must add no question at all. Asserted structurally: the three branches
     * are explicit and there is NO catch-all `else`, which is what would
     * otherwise sweep an unanswered `collection_method` into "you pay by
     * invoice".
     *
     * (The first version of this looked for the explaining comment, in a file
     * that strips comments before asserting. It could never have passed.)
     */
    const filler = code.slice(code.indexOf('private faqFromFacts'), code.indexOf('private journeySteps'));
    const payment = filler.slice(filler.indexOf("collects === 'none'"), filler.indexOf('facts?.needsIntake'));

    expect(payment).toMatch(/else if/);
    expect(payment).not.toMatch(/\}\s*else\s*\{/);
  });

  it('writes it in the business\'s own language', () => {
    const filler = code.slice(code.indexOf('private faqFromFacts'), code.indexOf('private journeySteps'));
    expect(filler).toMatch(/he: \{/);
    expect(filler).toMatch(/es: \{/);
  });
});
