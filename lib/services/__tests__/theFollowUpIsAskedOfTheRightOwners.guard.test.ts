/**
 * The lead-arrival question is asked of owners with their own site, and nobody else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A STEP AND NOT A CHIP
 *
 * One chip used to carry both facts — "I already have a website: read the
 * enquiries it emails me". Two commitments in one tick, and an owner whose
 * enquiries arrive by phone could not make the second, so they did not tick it
 * and we lost the first. We ended up knowing neither.
 *
 * Split, the first fact is a chip and the second is a follow-up. The follow-up
 * is only coherent for somebody who HAS a site: ask an owner taking a website
 * from us whether its enquiries reach their email and the question is about a
 * site that does not exist yet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * Three things, each of which has a silent failure if it drifts:
 *
 *   · the step is in the ordered step set — the chat route validates a stored
 *     step against that list and DISCARDS THE WHOLE CONVERSATION when it is
 *     missing, so an omission here loses an interview mid-flight;
 *   · the branch into it is gated on `has_website === true`, and every other
 *     answer still goes straight to the plan;
 *   · both exits reach `preview`, so no answer can strand an owner on a
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

describe('the step exists where the machinery looks for it', () => {
  it('is in the OnboardingStep union', () => {
    expect(code).toMatch(/\|\s*'lead_arrival'/);
  });

  it("is in the ordered step set, or a live conversation standing on it is thrown away", () => {
    /*
     * The set is what the chat route validates a resumed conversation against.
     * A step reachable by the state machine but absent from the set is not a
     * dead branch — it discards the interview.
     */
    const set = code.slice(code.indexOf("'client_workflow',"), code.indexOf("'complete',"));

    expect(set).toContain("'lead_arrival',");
  });

  it('has a handler and a question, not just a name', () => {
    /* Two switches: one reads the answer, the other asks it. A step in the
       union with only one of them is a conversation that cannot progress. */
    expect(code).toContain("case 'lead_arrival': {");
    expect(code).toContain("case 'lead_arrival':\n        return {");
  });
});

describe('who is asked', () => {
  it('only an owner who said they already have a site', () => {
    const branch = code.slice(
      code.indexOf("updatedState.collectedData.clientAcquisition = clientAcquisition;"),
      code.indexOf("case 'lead_arrival': {")
    );

    expect(branch).toMatch(/clientAcquisition\.has_website === true/);
    expect(branch).toMatch(/currentStep = 'lead_arrival'/);
  });

  it('=== true, so a null is not mistaken for a yes', () => {
    /*
     * `has_website` is null for every owner who declined our website without
     * claiming one of their own — the common case. Truthiness would read that
     * correctly today and wrongly the moment the field is ever defaulted;
     * `=== true` cannot.
     */
    const branch = code.slice(
      code.indexOf("updatedState.collectedData.clientAcquisition = clientAcquisition;"),
      code.indexOf("case 'lead_arrival': {")
    );

    expect(branch).not.toMatch(/if \(clientAcquisition\.has_website\)/);
  });

  it('everyone else still goes straight to the plan', () => {
    /* The branch returns early; the untouched path below it is what it used to
       be, and it must stay reachable. */
    const branch = code.slice(
      code.indexOf("clientAcquisition.has_website === true"),
      code.indexOf("case 'lead_arrival': {")
    );

    expect(branch).toContain('this.finalizeConfiguration(updatedState);');
    expect(branch).toMatch(/currentStep = 'preview'/);
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
