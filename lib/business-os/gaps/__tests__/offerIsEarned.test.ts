/**
 * An automation the owner has not earned the offer of is not offered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS GATE EXISTS
 *
 * `auto_complete_meetings` was a standing switch, findable by somebody who had
 * never used the feature. Saying yes to it sweeps up to ninety days of past
 * meetings and records every one as having happened — including the no-shows
 * nobody marked, which is the one judgement it cannot make and always resolves
 * the same way.
 *
 * So the offer is now earned: it appears once the audit trail shows the owner
 * doing the work themselves. The recommendation can then be phrased as an
 * observation rather than a feature tour, and nobody can switch on a backfill
 * over a history the platform knows nothing about.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { OPERATIONAL_AUTOMATIONS, offerIsEarned, automationById } from '../automations';

const autoComplete = automationById('auto_complete_meetings')!;
const chaseInvoices = automationById('chase_invoices')!;

describe('an automation with no evidence rule', () => {
  it('is offered regardless of what the owner has been doing', () => {
    expect(offerIsEarned(chaseInvoices, { enabled: false, evidence: 0 })).toBe(true);
  });

  /*
   * Four of the five are like this, and should stay like this. The gate is for
   * an automation that resolves a judgement, not for every automation.
   */
  it('is the normal case — only one entry in the registry is gated', () => {
    const gated = OPERATIONAL_AUTOMATIONS.filter(a => a.offerOnEvidence);

    expect(gated.map(a => a.id)).toEqual(['auto_complete_meetings']);
  });
});

describe('the automation that must be earned', () => {
  it('is withheld from an owner who has never done it by hand', () => {
    expect(offerIsEarned(autoComplete, { enabled: false, evidence: 0 })).toBe(false);
  });

  it('is still withheld just below the threshold', () => {
    expect(offerIsEarned(autoComplete, { enabled: false, evidence: 4 })).toBe(false);
  });

  it('is offered once the habit is established', () => {
    expect(offerIsEarned(autoComplete, { enabled: false, evidence: 5 })).toBe(true);
    expect(offerIsEarned(autoComplete, { enabled: false, evidence: 40 })).toBe(true);
  });

  /*
   * The one that would trap somebody. An owner who switched this on and then
   * had a quiet month must still be able to find it and switch it OFF — and
   * the card is the only screen that offers it.
   */
  it('never disappears on an owner who has it switched on', () => {
    expect(offerIsEarned(autoComplete, { enabled: true, evidence: 0 })).toBe(true);
  });
});

describe('the backlog it must never sweep', () => {
  /*
   * The promise the card's hint now makes: "Only meetings from here on, never
   * your past ones." Before this, saying yes swept the ninety days the gap
   * looks back over and closed up to two hundred past meetings — every one
   * recorded as having gone ahead, including the no-shows nobody marked.
   */
  it('refuses work that went due more than two days ago', () => {
    expect(autoComplete.actsWithinHours).toBe(48);
  });

  /*
   * In steady state the bound is inert: the work becomes due twelve hours
   * after the meeting and the sweep runs every five minutes, so a bound below
   * that would start dropping live work instead of a backlog.
   */
  it('leaves room for a stalled cron rather than hugging the due time', () => {
    expect(autoComplete.actsWithinHours!).toBeGreaterThan(autoComplete.delayHours);
  });

  /*
   * And it applies to this one only. A chase is still worth sending a week
   * late — the sweep says so — so bounding the chasers would silently stop
   * them doing work they are meant to do.
   */
  it('is not imposed on the automations that send rather than record', () => {
    const bounded = OPERATIONAL_AUTOMATIONS.filter(a => a.actsWithinHours !== undefined);

    expect(bounded.map(a => a.id)).toEqual(['auto_complete_meetings']);
  });
});

describe('what the evidence is counted from', () => {
  /*
   * The audit action written by the owner's OWN completion route. The
   * automation's completions are not audited, so the gate cannot feed on its
   * own output and talk itself into staying on — which would make "the owner
   * does this by hand" self-fulfilling after the first week.
   */
  it('reads the owner-performed action, not a generic booking event', () => {
    expect(autoComplete.offerOnEvidence).toEqual({
      action: 'SCHEDULING_BOOKING_COMPLETED',
      minCount: 5,
      windowDays: 30,
    });
  });
});
