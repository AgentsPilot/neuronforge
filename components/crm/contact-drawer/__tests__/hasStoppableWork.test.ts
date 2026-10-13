/**
 * "Stop this job" appears only while there is a job left to stop.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The button cancels the UNBILLED phases and marks the work ended. It was gated
 * on `proposalStatus === 'accepted'` alone, and an accepted quote stays accepted
 * for ever — so it sat on a ₪2,000 job with both stages paid and both invoices
 * settled, inviting an owner to press it on finished, fully-collected work.
 *
 * The two live cases on the account where it was found, and they must come out
 * differently:
 *
 *     ₪2000   paid    paid       nothing left   → hidden
 *     ₪800    billed  pending    money at stake → shown
 *
 * Both are in here by name, because "it disappeared from the other one too"
 * was the next thing reported and a rule that hides both is worse than the bug.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { hasStoppableWork } from '@/components/crm/contact-drawer/CRMContactDrawerV2';
import type { SessionPayment } from '@/components/crm/contact-drawer/types';

/** A quoted job with the given stage statuses. */
const withStages = (...statuses: string[]): SessionPayment =>
  ({
    amount: 1000,
    currency: 'ILS',
    status: statuses.every(s => s === 'paid') ? 'paid' : 'pending',
    plan: {
      installmentCount: statuses.length,
      installmentAmount: 1000,
      totalAmount: 1000 * statuses.length,
      frequency: 'monthly',
      periodsPaid: statuses.filter(s => s === 'paid').length,
      stages: statuses.map((status, i) => ({
        id: `s${i}`,
        label: `stage ${i + 1}`,
        amount: 1000,
        status,
      })),
    },
  }) as unknown as SessionPayment;

describe('the two jobs it was reported on', () => {
  it('hides it on the ₪2000 job: both stages paid', () => {
    expect(hasStoppableWork(withStages('paid', 'paid'))).toBe(false);
  });

  it('KEEPS it on the ₪800 job: one billed, one pending', () => {
    /*
     * The half that must not be lost. Billed-but-unpaid money can still be
     * called off — that is most of what stopping a job does — and a pending
     * stage has not even been raised yet.
     */
    expect(hasStoppableWork(withStages('billed', 'pending'))).toBe(true);
  });
});

describe('which stage states still count as work', () => {
  it.each(['pending', 'billed', 'overdue'])('%s is stoppable', status => {
    expect(hasStoppableWork(withStages('paid', status))).toBe(true);
  });

  it.each(['paid', 'cancelled', 'refunded'])('%s is finished', status => {
    expect(hasStoppableWork(withStages(status, status))).toBe(false);
  });

  it('one unfinished stage among many is enough', () => {
    expect(hasStoppableWork(withStages('paid', 'paid', 'paid', 'pending'))).toBe(true);
  });

  it('a job whose stages were all cancelled is already stopped', () => {
    expect(hasStoppableWork(withStages('cancelled', 'cancelled'))).toBe(false);
  });
});

describe('a single-payment quote, which has no plan', () => {
  const noPlan = (status: string) => ({ amount: 500, currency: 'ILS', status }) as SessionPayment;

  it('is finished once the money is collected', () => {
    expect(hasStoppableWork(noPlan('paid'))).toBe(false);
  });

  it('is finished when it was refunded or free', () => {
    expect(hasStoppableWork(noPlan('refunded'))).toBe(false);
    expect(hasStoppableWork(noPlan('free'))).toBe(false);
  });

  it('is still stoppable while unpaid', () => {
    expect(hasStoppableWork(noPlan('pending'))).toBe(true);
    expect(hasStoppableWork(noPlan('failed'))).toBe(true);
  });
});

describe('when there is no payment object at all', () => {
  it('leaves the button alone rather than hiding it', () => {
    /*
     * Erring towards SHOWING. Hiding it on missing data would quietly remove
     * an owner's only way to end a job, and the absence of a payment object
     * is not evidence that the work is done.
     */
    expect(hasStoppableWork(null)).toBe(true);
    expect(hasStoppableWork(undefined)).toBe(true);
  });
});
