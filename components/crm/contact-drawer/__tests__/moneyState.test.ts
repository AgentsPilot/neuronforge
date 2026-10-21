/**
 * Only one of these answers is a task, and that is the whole point.
 *
 * The failure this prevents is quiet: a free intro meeting, or a job whose
 * money was refunded, sitting in a chase list forever. An owner who is told to
 * collect money that was never owed stops reading the list.
 */

import { moneyStateFrom } from '../moneyState';
import type { SessionPayment } from '../types';

const base: SessionPayment = { amount: 300, currency: 'ILS', status: 'pending' };

describe('nothing was ever owed', () => {
  it('no payment record at all', () => {
    // A slow fetch must not read as a task either; absent means nothing owed.
    expect(moneyStateFrom(null)).toBe('nothing_to_collect');
    expect(moneyStateFrom(undefined)).toBe('nothing_to_collect');
  });

  it('a free service', () => {
    // פגישת היכרות is priced at zero.
    expect(moneyStateFrom({ ...base, status: 'free', amount: 0 })).toBe('nothing_to_collect');
  });
});

describe('the money arrived', () => {
  it('paid', () => {
    expect(moneyStateFrom({ ...base, status: 'paid' })).toBe('paid');
  });

  it('refunded counts as paid, because it asks whether money ever arrived', () => {
    /*
     * Reading a refund as unpaid once invited an owner to chase a client for
     * money that had already gone back.
     */
    expect(moneyStateFrom({ ...base, status: 'refunded' })).toBe('paid');
  });
});

describe('a single payment still outstanding', () => {
  it('is the owner’s move when nothing has been sent', () => {
    expect(moneyStateFrom(base)).toBe('needs_invoice');
  });

  it('is still the owner’s move when the invoice is only a DRAFT', () => {
    // A draft exists but the client has never seen it, so nobody has asked.
    expect(moneyStateFrom({ ...base, invoiceId: 'inv-1', invoiceStatus: 'draft' })).toBe(
      'needs_invoice'
    );
  });

  it('is the client’s once an invoice is out', () => {
    for (const invoiceStatus of ['sent', 'overdue'] as const) {
      expect(moneyStateFrom({ ...base, invoiceId: 'inv-1', invoiceStatus })).toBe('with_client');
    }
  });
});

describe('a plan with named stages', () => {
  /*
   * One stage of a plan, named once.
   *
   * `plan` is nullable and `stages` is optional, so both have to be unwrapped
   * before indexing — `Partial<…['stages']>[number]` was indexing a
   * possibly-undefined type by a number, which has no such index signature.
   *
   * The return annotation is what makes the spread typecheck: `{...defaults,
   * ...partial}` leaves every overlapping field possibly-undefined as far as
   * the compiler is concerned, even though the defaults always supply them.
   */
  type Stage = NonNullable<NonNullable<SessionPayment['plan']>['stages']>[number];

  const stage = (over: Partial<Stage> = {}): Stage => ({
    id: 's1',
    label: null,
    amount: 100,
    status: 'pending',
    trigger: 'date' as const,
    invoiceId: null,
    dueDate: null,
    ...over,
  });

  const withStages = (stages: ReturnType<typeof stage>[]): SessionPayment => ({
    ...base,
    plan: {
      installmentCount: stages.length,
      installmentAmount: 100,
      totalAmount: 100 * stages.length,
      frequency: 'monthly',
      stages,
    },
  });

  it('collects itself while every outstanding stage bills on a date', () => {
    expect(moneyStateFrom(withStages([stage({ status: 'paid' }), stage()]))).toBe('plan_auto');
  });

  it('asks the owner when a MANUAL stage has not been billed', () => {
    /*
     * A manual stage falls due when the owner says the work happened. Until
     * they bill it, nobody has asked the client for anything.
     */
    expect(
      moneyStateFrom(withStages([stage({ status: 'paid' }), stage({ trigger: 'manual' })]))
    ).toBe('plan_needs_billing');
  });

  it('does not ask again once that stage carries an invoice', () => {
    expect(
      moneyStateFrom(withStages([stage({ trigger: 'manual', invoiceId: 'inv-9' })]))
    ).toBe('plan_auto');
  });

  it('is finished when every stage is settled, refunds included', () => {
    expect(moneyStateFrom(withStages([stage({ status: 'paid' }), stage({ status: 'refunded' })]))).toBe(
      'paid'
    );
  });
});

describe('a uniform instalment schedule with no named stages', () => {
  const plan = (periodsPaid?: number): SessionPayment => ({
    ...base,
    plan: {
      installmentCount: 3,
      installmentAmount: 100,
      totalAmount: 300,
      frequency: 'monthly',
      ...(periodsPaid === undefined ? {} : { periodsPaid }),
    },
  });

  it('asks nothing while it runs: it bills on dates', () => {
    expect(moneyStateFrom(plan(1))).toBe('plan_auto');
  });

  it('is finished once every period is in', () => {
    expect(moneyStateFrom(plan(3))).toBe('paid');
  });

  it('treats an unknown period count as still running, never as a task', () => {
    // `periodsPaid` is undefined before the plan's local mirror exists.
    expect(moneyStateFrom(plan())).toBe('plan_auto');
  });
});
