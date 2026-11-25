/**
 * The cancel dialog states the money, and states what the write will do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ASKED, AND WHY THE SCREEN COULD NOT ANSWER IT
 *
 * "When cancelling it doesn't add the session with payment?" — of a package
 * session with a replacement being booked in the same breath.
 *
 * It was a fair question to be unable to answer. The dialog listed three
 * consequences — the hour goes back in the diary, the client is emailed, a
 * replacement is booked for this date — and said nothing about money. Its own
 * comment explained why: it was not told whether the session carried a stage,
 * so a line claiming the charge was voided would have asserted something it
 * could not see.
 *
 * Meanwhile the server decided the whole thing correctly and silently: the
 * cancelled hour's unbilled stage is voided by `setMeetingOutcome`, and the
 * replacement carries a stage or does not, by rules in the POST that nothing
 * surfaced.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE THING THIS SUITE REALLY PROTECTS
 *
 * That the sentence and the write ask the SAME function. The obvious way to
 * give the dialog its answer is to restate the billing rule in the GET, and a
 * second copy of a money rule is how a dialog comes to promise one thing while
 * the write does another — which is the defect class `replacementCharge`
 * already exists because of (two charges, one delivered hour, four packages).
 *
 * So `replacementStageOutlook` is asked by both, and these cases fail if either
 * stops asking it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const MEETINGS_ROUTE = 'app/api/scheduling/bookings/[id]/meetings/route.ts';
const OUTLOOK = 'lib/scheduling/replacementStage.ts';
const DIALOG = 'components/scheduling/CancelMeetingDialog.tsx';
const DRAWER = 'components/crm/contact-drawer/CRMContactDrawerV2.tsx';
const REPOSITORY = 'lib/repositories/SchedulingRepository.ts';

/** Source with comments removed, so the notes about the rule do not satisfy it. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('one function decides whether a replacement is billed', () => {
  const route = code(read(MEETINGS_ROUTE));

  it('the write asks it', () => {
    expect(route).toContain('replacementStageOutlook(');
    /* And acts on its answer rather than re-deriving one. */
    expect(route).toContain('outlook?.bills');
  });

  it('the offer the dialog opens with asks it too', () => {
    /* Two call sites, one per handler. A single one would mean the GET is
       guessing or the POST is. */
    expect((route.match(/await replacementStageOutlook\(/g) ?? []).length).toBe(2);
  });

  it('and the rule is not written out a second time anywhere', () => {
    /*
     * The chain walk belongs to `replacementCharge` and is reached through the
     * outlook. A route calling it directly again would be the second copy this
     * exists to prevent.
     */
    expect(route).not.toContain('replacedHourAlreadyPaid(');
  });

  it('refusing an upfront block before anything else', () => {
    /* Order matters: an upfront package must never reach the chain walk, and
       the POST still turns a charge against one away outright. */
    const outlook = code(read(OUTLOOK));

    expect(outlook.indexOf("return none('upfront')")).toBeLessThan(
      outlook.indexOf('replacedHourAlreadyPaid(')
    );
    expect(route).toContain("code: 'cannot_charge_upfront_package'");
  });

  it('and answering the chain before it reads the plan', () => {
    /*
     * An hour whose money is already in must not depend on a plan read
     * succeeding — that would bill a second time on a transient failure.
     */
    const outlook = code(read(OUTLOOK));

    expect(outlook.indexOf("return none('already_paid'")).toBeLessThan(
      outlook.indexOf("return none('no_plan')")
    );
  });
});

describe('what the offer tells the dialog', () => {
  const route = code(read(MEETINGS_ROUTE));

  it.each([
    'replacementBills',
    'replacementReason',
    'replacementAmount',
    'releasedAmount',
  ])('carries %s', field => {
    expect(route).toContain(`${field}:`);
  });

  it('reads the released stage by the SAME four conditions the void uses', () => {
    /*
     * `setMeetingOutcome` voids `meeting_id = x AND user_id AND status pending
     * AND invoice_id is null`. A dialog reading anything wider would name a sum
     * the cancellation does not release — an invoiced stage, say, which stands.
     */
    const released = route.slice(
      route.indexOf('const { data: releasing }'),
      route.indexOf('const released =')
    );

    expect(released).toContain("eq('meeting_id', excluding)");
    expect(released).toContain("eq('status', 'pending')");
    expect(released).toContain("is('invoice_id', null)");

    const voiding = code(read(REPOSITORY));
    expect(voiding).toContain("eq('status', 'pending')");
    expect(voiding).toContain("is('invoice_id', null)");
  });

  it('sums the stages rather than reading one', () => {
    /* The void has no limit, and `maybeSingle` would error on a session
       carrying two rather than answer. */
    expect(route).not.toMatch(/eq\('meeting_id', excluding\)[\s\S]{0,200}maybeSingle\(\)/);
    expect(route).toContain('const released = (releasing ?? []).reduce(');
  });

  it('says nothing when no session was named', () => {
    /* Without `excluding` this is the add-a-meeting offer: nothing is being
       called off, so there is no money to describe and the dialog stays
       silent exactly as it did before. */
    expect(route).toContain('const outlook = excluding');
  });
});

describe('what the dialog does with it', () => {
  const dialog = code(read(DIALOG));
  const drawer = code(read(DRAWER));

  it('is handed the money by the drawer', () => {
    expect(drawer).toContain('money={replacementOffer?.money ?? null}');
  });

  it('shows the released charge only when there is one', () => {
    /* `!= null` and not a truthiness test: a stage of zero is not a sentence
       worth printing, and `null` means nothing was owing at all. */
    expect(dialog).toContain('money?.releasedAmount != null');
  });

  it('explains an already-paid replacement in its own words', () => {
    /*
     * The case that prompted all of this: a make-up for an hour the client has
     * already paid for carries no stage, which looks like a bug unless the
     * screen says why.
     */
    expect(dialog).toContain("money.replacementReason === 'already_paid'");
    expect(dialog).toContain('outcome_replacement_paid');
  });

  it('and only talks about the replacement when one is being booked', () => {
    expect(dialog).toContain('replacement && addReplacement && money?.replacementBills != null');
  });
});

describe('the words exist in every language', () => {
  it.each(['en', 'he', 'es'])('%s', language => {
    const file = read(`lib/business-os/translations/${language}.ts`);

    for (const key of [
      'scheduling.cancel_meeting.outcome_released',
      'scheduling.cancel_meeting.outcome_replacement_billed',
      'scheduling.cancel_meeting.outcome_replacement_paid',
      'scheduling.cancel_meeting.outcome_replacement_free',
    ]) {
      expect(file).toContain(key);
    }
  });
});
