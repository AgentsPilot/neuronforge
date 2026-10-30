/**
 * A person the owner has filed as finished is not invited back by a machine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `past_client`, `lost` and `archived` are the stage TYPES that mean the
 * relationship has an ending. Both detectors behind the invite agents exclude
 * them deliberately — `ConvNoNextStepDetector` says it outright: reporting them
 * "would make the card a list of everyone the business has ever finished with".
 *
 * The AGENTS could not honour it. Their find reads bookings, and the stage KEY
 * is invented per business (`completed`, `finished`, `alumni`) while only
 * `crm_pipeline_stages.stage_type` carries the meaning — which the query
 * grammar cannot reach from a contact. So a client moved to "completed" with
 * nothing in the diary still matched, and the one gesture the owner made to say
 * "we are done here" was ignored.
 *
 * Asserted on the source: the behaviour needs a database, and what is worth
 * pinning is that the check exists, reads the TYPE rather than the key, and
 * applies to automated sends only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(process.cwd(), 'lib', 'services', 'LeadBookingLinkService.ts'),
  'utf-8'
);

describe('the terminal-stage check', () => {
  it('reads the stage TYPE, never the key', () => {
    /*
     * Stage keys are per business. Hardcoding `completed` would work for one
     * account and silently do nothing for the next, which is the failure mode
     * `StageTypeUtils` exists to remove.
     */
    expect(source).toContain("from('crm_pipeline_stages')");
    expect(source).toContain("select('stage_type')");
    expect(source).toContain('TERMINAL_STAGE_TYPES.includes');
    expect(source).not.toMatch(/stage === '(completed|past_client|archived)'/);
  });

  it('imports the constant it uses', () => {
    /*
     * The one these source-level tests nearly missed. An edit added the check
     * and the import separately; the import's anchor did not match, so
     * `TERMINAL_STAGE_TYPES` was referenced and never imported — a
     * ReferenceError on the first automated invite, and every assertion here
     * still passed, because reading the source is not running it.
     */
    expect(source).toMatch(
      /import \{[^}]*TERMINAL_STAGE_TYPES[^}]*\} from '@\/lib\/crm\/StageTypeUtils'/
    );
  });

  it('applies to automated sends only', () => {
    /*
     * A person pressing Send in the CRM on a past client is making a decision,
     * and refusing it would be the platform overruling them. This refuses the
     * queue and the agents, which decided nothing.
     */
    expect(source).toContain("if (options.trigger === 'automated' && contact.stage)");
  });

  it('runs before anything is composed or claimed', () => {
    /* Before the booking URL, the claim and the template — all wasted work on
       somebody who must not be written to. */
    const check = source.indexOf("options.trigger === 'automated' && contact.stage");
    const claim = source.indexOf('const claimType =');
    const send = source.indexOf('await sendEmail(');

    expect(check).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(check);
    expect(send).toBeGreaterThan(check);
  });

  it('says why, in a word the caller can report', () => {
    expect(source).toContain("reason: 'relationship_ended'");
  });

  it('is scoped to the owner, like every other read here', () => {
    const block = source.slice(
      source.indexOf("from('crm_pipeline_stages')"),
      source.indexOf("reason: 'relationship_ended'")
    );

    expect(block).toContain(".eq('user_id', userId)");
  });
});
