/**
 * The own-site lead questions are asked of owners with their own site, and nobody else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THEY ARE STEPS AND NOT CHIPS
 *
 * One chip used to carry both facts — "I already have a website: read the
 * enquiries it emails me". Two commitments in one tick, and an owner whose
 * enquiries arrive by phone could not make the second, so they did not tick it
 * and we lost the first. We ended up knowing neither.
 *
 * Split, the first fact is a chip and the rest are follow-ups, coherent only
 * for somebody who HAS a site: ask an owner taking a website from us about its
 * enquiries and the question is about a site that does not exist yet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY THERE ARE NOW TWO OF THEM
 *
 * `lead_arrival` asks whether those enquiries land in a mailbox, which presumes
 * the enquiries. A site with no contact form generates none, so its owner had
 * no honest answer to the only question we asked — and the agent that answer
 * gates reads a mailbox for form mail, so a yes would have offered them an
 * agent for a form that does not exist.
 *
 * `lead_form` now comes first and decides whether the second is asked at all.
 * A no at either point is what makes the dashboard offer the smart links
 * instead: our own contact form link, which needs no site of theirs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * Each of these has a silent failure if it drifts:
 *
 *   · both steps are in the ordered step set — the chat route validates a
 *     stored step against that list and DISCARDS THE WHOLE CONVERSATION when it
 *     is missing, so an omission here loses an interview mid-flight;
 *   · the branch in is gated on `has_website === true` and reaches `lead_form`,
 *     and every other answer still goes straight to the plan;
 *   · `lead_arrival` is reached ONLY from a yes to the form question;
 *   · every exit reaches `preview`, so no answer can strand an owner on a
 *     question with nowhere to go.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SOURCE = 'lib/services/OnboardingConversationManager.ts';

const source = fs
  .readFileSync(path.join(process.cwd(), SOURCE), 'utf8')
  .replace(/\r\n/g, '\n');

/** Comments stripped: this file asserts on code, and the prose repeats it. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The routing branch in `client_acquisition`, and ONLY that.
 *
 * Bounded at `case 'lead_form': {` rather than at the arrival case, which is
 * the trap this helper exists to avoid: the form handler sets
 * `currentStep = 'lead_arrival'`, so a slice that reaches past it makes "the
 * branch routes to the arrival question" pass no matter what the branch does.
 * It did, once this chain became two steps.
 */
function acquisitionBranch(): string {
  const from = code.indexOf('updatedState.collectedData.clientAcquisition = clientAcquisition;');
  const to = code.indexOf("case 'lead_form': {");

  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);

  return code.slice(from, to);
}

describe.each(['lead_form', 'lead_arrival'])('%s exists where the machinery looks for it', step => {
  it('is in the OnboardingStep union', () => {
    expect(code).toMatch(new RegExp(`\\|\\s*'${step}'`));
  });

  it("is in the ordered step set, or a live conversation standing on it is thrown away", () => {
    /*
     * The set is what the chat route validates a resumed conversation against.
     * A step reachable by the state machine but absent from the set is not a
     * dead branch — it discards the interview.
     */
    const set = code.slice(code.indexOf("'client_workflow',"), code.indexOf("'complete',"));

    expect(set).toContain(`'${step}',`);
  });

  it('has a handler and a question, not just a name', () => {
    /* Two switches: one reads the answer, the other asks it. A step in the
       union with only one of them is a conversation that cannot progress. */
    expect(code).toContain(`case '${step}': {`);
    expect(code).toContain(`case '${step}':\n        return {`);
  });
});

describe('who is asked', () => {
  it('only an owner who said they already have a site', () => {
    const branch = acquisitionBranch();

    expect(branch).toMatch(/clientAcquisition\.has_website === true/);
    /* The FORM question first. The mailbox one presumes enquiries this one
       establishes — see the file header. */
    expect(branch).toMatch(/currentStep = 'lead_form'/);
  });

  it('=== true, so a null is not mistaken for a yes', () => {
    /*
     * `has_website` is null for every owner who declined our website without
     * claiming one of their own — the common case. Truthiness would read that
     * correctly today and wrongly the moment the field is ever defaulted;
     * `=== true` cannot.
     */
    expect(acquisitionBranch()).not.toMatch(/if \(clientAcquisition\.has_website\)/);
  });

  it('is not routed off the channels chip, which is about attribution', () => {
    /*
     * A reply-consent step briefly hung off "show me where my clients come
     * from". That chip says which channel a client arrived through and nothing
     * about how an enquiry reaches the business or who answers it — the same
     * mistake this file's header records about the bundled chip: an answer read
     * as evidence for a question it was not given.
     */
    expect(acquisitionBranch()).not.toMatch(/needs_channel_insights === true/);
  });

  it('everyone else still goes straight to the plan', () => {
    /* The branch returns early; the untouched path below it is what it used to
       be, and it must stay reachable. */
    const branch = acquisitionBranch();

    expect(branch).toContain('this.finalizeConfiguration(updatedState);');
    expect(branch).toMatch(/currentStep = 'preview'/);
  });
});

describe('the form question gates the mailbox question', () => {
  /** The `lead_form` handler, bounded by the case that follows it. */
  function formHandler(): string {
    const from = code.indexOf("case 'lead_form': {");
    const to = code.indexOf("case 'lead_arrival': {");

    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);

    return code.slice(from, to);
  }

  it('asks about the mailbox only after a yes', () => {
    expect(formHandler()).toMatch(/hasForm === true/);
    expect(formHandler()).toMatch(/currentStep = 'lead_arrival'/);
  });

  it('records a no as "no form mail", which is what offers the smart links', () => {
    /*
     * `leads_arrive_by_email: false` is the value the dashboard reads to offer
     * the contact form link instead of an agent that would find nothing to
     * read. Leaving it null would suppress BOTH offers and the owner would be
     * told nothing at all.
     */
    expect(formHandler()).toMatch(/leads_arrive_by_email = hasForm === false \? false : null/);
    expect(formHandler()).toMatch(/needs_inbox_channel = false/);
  });

  it('reaches the plan when it does not ask again', () => {
    const handler = formHandler();

    expect(handler).toContain('this.finalizeConfiguration(updatedState);');
    expect(handler).toMatch(/currentStep = 'preview'/);
  });
});

describe('what the answer decides', () => {
  it('grants the mailbox channel only on a yes', () => {
    const handler = code.slice(
      code.indexOf("case 'lead_arrival': {"),
      code.indexOf("case 'client_tracking':")
    );

    expect(handler).toMatch(/needs_inbox_channel = arrival === true/);
  });

  it('records the answer itself, null included', () => {
    /* Null is a real answer here and must reach the profile as null: the
       dashboard waits on it rather than offering either thing. */
    const handler = code.slice(
      code.indexOf("case 'lead_arrival': {"),
      code.indexOf("case 'client_tracking':")
    );

    expect(handler).toMatch(/leads_arrive_by_email = arrival/);
  });

  it('reaches the plan whatever the answer was', () => {
    const handler = code.slice(
      code.indexOf("case 'lead_arrival': {"),
      code.indexOf("case 'client_tracking':")
    );

    expect(handler).toContain('this.finalizeConfiguration(updatedState);');
    expect(handler).toMatch(/currentStep = 'preview'/);
  });
});

describe('the question is asked in every language', () => {
  it.each(['lead_arrival_prompt', 'lead_arrival_options'])('%s exists three times', key => {
    /*
     * Three response blocks: he, es, and the English fallback. A missing key
     * does not throw — `getResponseTemplates` returns `Record<string, any>`, so
     * the owner is shown `undefined` and the chat appears to have lost its
     * question.
     */
    const occurrences = source.split(`${key}:`).length - 1;

    expect(occurrences).toBe(3);
  });

  it('offers exactly two answers, which is what makes it single-select', () => {
    /* The question before it is multi-select. Two exclusive answers have no
       reading as "both", so this one deliberately is not. */
    const options = source.match(/lead_arrival_options: \[\s*\n([^\]]*)\]/g) ?? [];

    expect(options).toHaveLength(3);
    for (const block of options) {
      /* Count the quoted strings, not the lines: the opening bracket shares a
         line with nothing and the first option's comma is its terminator, so a
         line split miscounts by one. */
      expect(block.match(/'[^']+'/g) ?? []).toHaveLength(2);
    }
  });
});
