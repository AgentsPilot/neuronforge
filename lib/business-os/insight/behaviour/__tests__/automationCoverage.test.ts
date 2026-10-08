/**
 * The number that measures the product's promise, and refuses to flatter it.
 */

import { automationCoverage, automatableNowPercent, type AutomationId } from '../automationCoverage';

const ON = (...ids: AutomationId[]) => new Set<AutomationId>(ids);

describe('what counts as work', () => {
  it('ignores logging in and asking the assistant a question', () => {
    /*
     * Neither is a task anybody wants taken off them. On the reporting account
     * BUSINESS_CHAT_QUERY alone is 294 of 555 actions, so counting it would
     * halve the apparent coverage while describing nothing about toil.
     */
    const report = automationCoverage(
      [
        { action: 'USER_LOGIN', count: 22 },
        { action: 'BUSINESS_CHAT_QUERY', count: 294 },
        { action: 'SCHEDULING_BOOKING_CREATED', count: 29 },
      ],
      ON()
    );

    expect(report.ownerActions).toBe(29);
    expect(report.lines.map(l => l.action)).toEqual(['SCHEDULING_BOOKING_CREATED']);
  });
});

describe('coverage', () => {
  it('counts an action only when an automation is on AND could do it', () => {
    const report = automationCoverage(
      [
        { action: 'INTAKE_EMAIL_RESENT', count: 4 },
        { action: 'SCHEDULING_BOOKING_CREATED', count: 6 },
      ],
      ON('chase_intake')
    );

    expect(report.automatable).toBe(4);
    expect(report.automatableNow).toBe(4);
    expect(automatableNowPercent(report)).toBe(40);
  });

  it('separates "nothing can do this" from "something can and it is off"', () => {
    /*
     * Opposite problems. One is a missing feature and the other is one switch,
     * and a single percentage would hide which you are looking at.
     */
    const report = automationCoverage([{ action: 'INTAKE_EMAIL_RESENT', count: 4 }], ON());

    expect(report.automatable).toBe(4);
    expect(report.automatableNow).toBe(0);
    expect(report.uncovered).toEqual([]);
  });

  it('does not credit a first invoice send to invoice chasing', () => {
    /*
     * The flattering mistake. `chase_invoices` pursues an invoice already
     * overdue; sending one for the first time is ordinary work it cannot take.
     * Mapping it would inflate the number with work the platform cannot do.
     */
    const report = automationCoverage([{ action: 'PAYMENT_INVOICE_SENT', count: 19 }], ON('chase_invoices'));

    expect(report.automatableNow).toBe(0);
    expect(report.uncovered.map(l => l.action)).toEqual(['PAYMENT_INVOICE_SENT']);
  });
});

describe('what the numbers do NOT claim', () => {
  it('still counts an owner action an enabled automation could have done', () => {
    /*
     * The flaw that renaming fixed. If the owner marked a meeting complete by
     * hand while `auto_complete_meetings` was ON, the automation did not take
     * that work -- it was late, or it never fired. Counting it as "covered"
     * would have reported the platform doing work it demonstrably did not do.
     *
     * So the action stays in `ownerActions`, and `automatableNow` is an UPPER
     * BOUND on hand-over rather than a measure of it. Measuring actual
     * hand-over needs the other ledger (`lead_responses`, `payment_reminders`).
     */
    const report = automationCoverage(
      [{ action: 'SCHEDULING_BOOKING_COMPLETED', count: 16 }],
      ON('auto_complete_meetings')
    );

    expect(report.ownerActions).toBe(16);
    expect(report.automatableNow).toBe(16);
    // Not in `uncovered`: something exists that could do it.
    expect(report.uncovered).toEqual([]);
  });
});

describe('the uncovered list', () => {
  it('ranks what nothing can do, which is the roadmap', () => {
    const report = automationCoverage(
      [
        { action: 'SCHEDULING_BOOKING_CREATED', count: 29 },
        { action: 'PROPOSAL_CREATED', count: 16 },
        { action: 'SCHEDULING_SERVICE_UPDATED', count: 22 },
      ],
      ON()
    );

    expect(report.uncovered.map(l => l.action)).toEqual([
      'SCHEDULING_BOOKING_CREATED',
      'SCHEDULING_SERVICE_UPDATED',
      'PROPOSAL_CREATED',
    ]);
  });
});

describe('when there is nothing to measure', () => {
  it('returns null rather than 0 per cent', () => {
    /*
     * A month with no recorded work has no coverage. Reporting 0% would read as
     * the platform failing, which is a different claim from having nothing to
     * say -- the distinction `funnelGap` draws for incomparable periods.
     */
    expect(automatableNowPercent(automationCoverage([], ON()))).toBeNull();
    expect(automatableNowPercent(automationCoverage([{ action: 'USER_LOGIN', count: 9 }], ON()))).toBeNull();
  });
});
