/**
 * The three reasons this detector was deleted, as rules.
 *
 * It produced "1 Client at Final Instalment, $1,000 Impact" on a real account
 * about a $1,000 quote somebody had chosen to pay in two halves, and had
 * finished paying. Every clause of that sentence was wrong: they were not at
 * their final instalment, it was not a package, and there was no impact because
 * nothing was ending.
 */

import { RetPackageEndingDetector } from '../RetPackageEndingDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

interface Row {
  id: string;
  payment_plan_id: string | null;
  contact_id: string | null;
  status: string;
  installment_number: number;
  amount: number;
  currency: string | null;
  due_date: string | null;
}

/**
 * A package: `paid` for each settled instalment, anything else for the rest.
 * e.g. plan('p1', 'c1', ['paid', 'paid', 'pending'])
 */
function plan(planId: string, contactId: string | null, statuses: string[], amount = 500): Row[] {
  return statuses.map((status, i) => ({
    id: `${planId}-${i}`,
    payment_plan_id: planId,
    contact_id: contactId,
    status,
    installment_number: i + 1,
    amount,
    currency: 'USD',
    due_date: null,
  }));
}

function mockSupabase(rows: Row[]) {
  return {
    from(table: string) {
      const data = table === 'crm_contacts'
        ? [{ id: 'c1', first_name: 'Dana', last_name: 'Levi' }]
        : rows;
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data, error: null }),
      };
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'gte']) chain[m] = () => chain;
      return chain;
    },
  };
}

function detector(rows: Row[]) {
  const d = new RetPackageEndingDetector(mockSupabase(rows) as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

describe('RetPackageEndingDetector', () => {
  it('reports a real package with one instalment left', async () => {
    // The live case it gets right: 3 instalments, two paid, one to go.
    const result = await detector(plan('p1', 'c1', ['paid', 'paid', 'pending'])).evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.affectedCount).toBe(1);
    expect(result!.estimatedImpactUsd).toBe(1500);
  });

  it('says nothing about a package that has already finished', async () => {
    /*
     * The first bug. The test was `remaining <= 1`, which includes zero — so a
     * client who had paid everything was reported as being AT their final
     * instalment, and the advice arrived after the moment it was for.
     */
    const result = await detector(plan('p1', 'c1', ['paid', 'paid', 'paid'])).evaluate('user-1');

    expect(result).toBeNull();
  });

  it('says nothing about a payment split in two', async () => {
    /*
     * The second bug, and the card that was actually on the dashboard: a
     * $1,000 quote paid in two instalments of $500. Halving one payment is not
     * committing to a block of work, and there is no next block to offer.
     */
    const result = await detector(plan('p1', 'c1', ['paid', 'pending'], 500)).evaluate('user-1');

    expect(result).toBeNull();
  });

  it('claims no percentage change', async () => {
    // The third bug: `percentChange: 100` against a baseline of nothing,
    // narrated as "a 100% increase in risk compared to your usual retention".
    const result = await detector(plan('p1', 'c1', ['paid', 'paid', 'pending'])).evaluate('user-1');

    expect(result!.percentChange).toBe(0);
  });

  it('says nothing while two instalments are still to come', async () => {
    const result = await detector(plan('p1', 'c1', ['paid', 'pending', 'pending'])).evaluate('user-1');

    expect(result).toBeNull();
  });

  it('says nothing about a package nobody has started paying', async () => {
    const result = await detector(plan('p1', 'c1', ['pending', 'pending', 'pending'])).evaluate('user-1');

    expect(result).toBeNull();
  });

  it('says nothing when the client already has the next package booked', async () => {
    // A second package IS the renewal here; there is no flag for one.
    const rows = [
      ...plan('p1', 'c1', ['paid', 'paid', 'pending']),
      ...plan('p2', 'c1', ['pending', 'pending', 'pending']),
    ];

    expect(await detector(rows).evaluate('user-1')).toBeNull();
  });

  it('ignores instalments belonging to a template nobody has bought', async () => {
    /*
     * `payment_plans` is a pricing template — three rows on the live database
     * have no instalments at all. An instalment with no `contact_id` has no
     * client to advise about.
     */
    const result = await detector(plan('p1', null, ['paid', 'paid', 'pending'])).evaluate('user-1');

    expect(result).toBeNull();
  });

  it('counts two clients on the same template as two packages', async () => {
    /*
     * One template can be sold to several clients. Keying on the plan alone
     * would merge them and report one ending when two people were finishing.
     */
    const rows = [
      ...plan('p1', 'c1', ['paid', 'paid', 'pending']),
      ...plan('p1', 'c2', ['paid', 'paid', 'pending']),
    ];

    const result = await detector(rows).evaluate('user-1');
    expect(result!.affectedCount).toBe(2);
  });

  it('names the client rather than only counting them', async () => {
    const result = await detector(plan('p1', 'c1', ['paid', 'paid', 'pending'])).evaluate('user-1');

    const packages = result!.processParameters!.packages as Array<{ client: string | null }>;
    expect(packages[0].client).toBe('Dana Levi');
  });
});
