/**
 * A part-paid order says what has already arrived on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SUM THAT COULD NOT BE CHECKED
 *
 * The drawer's groups are per ORDER, and `groupOf` buckets an order by its one
 * status. So a payment plan with one period paid and one still owed is not
 * `paid`, and the whole order lands in WAITING. The figure on that row is
 * `flow.outstanding`, which is correct — the owner is owed the unpaid half.
 *
 * But the paid half then appeared on NO row, in either group, while still
 * counting toward "So far you have received". The header invites the reader to
 * reconcile and the rows could not be made to agree.
 *
 * Seen live on a contact: the header read "received $873" above two paid rows
 * of $500 and $333. The missing $40 was the collected period of a $40 + $40
 * plan sitting in Waiting showing only the $40 still owed.
 *
 *   833  the two Paid rows
 *   +40  collected on the part-paid plan, listed nowhere
 *   ───
 *   873  Received
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT SIMPLY LIST IT UNDER PAID AS WELL
 *
 * Because then one order is two rows, and the `(n)` beside each heading stops
 * counting orders. The groups are the drawer's unit of work — "these need you,
 * these do not" — and an order that is half paid still needs somebody. It
 * belongs in Waiting, and what it owes is the right headline figure.
 *
 * So the row carries the fact rather than the list carrying the order twice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The alternative is mounting a collapsible section with a seeded contact, a
 * booking, a plan and two invoices to prove one string renders. What has to
 * stay true is structural: the waiting branch reads the SAME `flow.collected`
 * the summary bar above it already totals, so the row and the header cannot
 * disagree. A source assertion holds exactly that, and the arithmetic half is
 * proved against `itemFlow` itself below.
 */

import fs from 'fs';
import path from 'path';

import { itemFlow, type MoneyItem } from '@/lib/payments/moneyItems';

const SECTION = path.join(
  process.cwd(),
  'components/crm/contact-drawer/PaymentsSection.tsx'
);
const source = fs.readFileSync(SECTION, 'utf8');

/** The shape of the live case: one period collected, one still owed. */
const partPaidPlan = {
  key: 'booking-6cecd7eb',
  title: 'Quotation',
  currency: 'USD',
  amount: 80,
  date: '2026-11-17',
  status: 'awaiting_payment',
  entries: [
    { amount: 40, refunded: 0, status: 'paid', date: '2026-11-13' },
    { amount: 40, refunded: 0, status: 'awaiting_payment', date: '2026-11-17' },
  ],
} as unknown as MoneyItem;

describe('the money the row used to hide', () => {
  it('an order can be owed AND already partly collected at the same time', () => {
    const flow = itemFlow(partPaidPlan);

    /* Both non-zero is the whole case. If this ever became impossible the
       guard below would be guarding nothing. */
    expect(flow.outstanding).toBe(40);
    expect(flow.collected).toBe(40);
  });

  it('the ORDER is still waiting, which is why its paid half needs a row of its own', () => {
    /* `groupOf` sends everything that is not paid/refunded/cancelled to
       waiting, and a part-paid plan's status is the unpaid one. So the order
       belongs in Waiting — correctly, somebody still owes money — and the
       money already collected on it has to be listed separately or it appears
       nowhere at all. */
    expect(String(partPaidPlan.status)).not.toBe('paid');
  });
});

describe('the waiting row does NOT repeat it inline', () => {
  /*
   * The first attempt reported the collected half on the waiting row itself,
   * as "· $25.00 already paid". On a two-period plan the halves are usually
   * EQUAL, so the row read:
   *
   *   $25.00  …  due Nov 10 · $25.00 already paid
   *
   * Two identical figures, one owed and one received, and nothing saying which
   * was which. The owner reported it as confusing, and they were right: the
   * line answers "when is the rest due", and a second figure on it competes
   * with the amount at the head of the row.
   *
   * The collected half is a row under Paid instead. These assertions exist so
   * the inline note does not come back the next time somebody notices the
   * totals do not add up on screen.
   */
  const waiting = () =>
    source.slice(
      source.indexOf("group === 'waiting' ?"),
      source.indexOf("group === 'refunded' ?", source.indexOf("group === 'waiting' ?"))
    );

  it('puts no collected figure on the due-date line', () => {
    expect(waiting()).not.toContain('flow.collected');
  });

  it('left no dead translation key behind', () => {
    expect(source).not.toContain('payments.part_paid');
  });

  it('says only when the rest is due', () => {
    /* What the line IS for, so this fails loudly if the branch is gutted
       rather than silently passing on an empty string. */
    expect(waiting()).toContain("t('payments.due_on')");
    expect(waiting()).toContain("t('payments.due_soon')");
  });
});

describe('the collected half is listed under Paid', () => {
  it('pushes a settled row built from the order still in waiting', () => {
    /* Over `out.waiting`, not over every item: an order already paid in full
       is in `paid` already, and a second row for it would be the same money
       twice. */
    expect(source).toMatch(/for \(const item of \[\.\.\.out\.waiting\]\)/);
    expect(source).toMatch(/out\.paid\.push\(/);
  });

  it('decides what counts as collected with `itemFlow`, not a copied status list', () => {
    expect(source).toMatch(/itemFlow\(\{[\s\S]{0,80}entries: \[entry\] \}\)\.collected > 0/);
  });

  it('carries only the collected entries, and drops the plan', () => {
    const block = source.slice(source.indexOf('out.paid.push('));

    expect(block).toContain('entries: collectedEntries');
    /* This row is the money, not the agreement: a plan on it would make the
       drawer and the row argue about what the order still owes. */
    expect(block.slice(0, 400)).toContain('plan: undefined');
  });

  it('dates the row by the latest payment, so "paid {date}" is the truth', () => {
    expect(source).toContain('date: paidOn ?? item.date');
  });

  it('keeps a distinct key, and opens the whole order rather than the half', () => {
    expect(source).toContain('SETTLED_SUFFIX');
    expect(source).toContain('setDetail(orderFor(item))');
    /* `orderFor` has to find its way back, or Open silently shows a
       half-order with the owed period missing. */
    expect(source).toMatch(/moneyItems\.find\(item => String\(item\.key\) === base\)/);
  });
});

/**
 * THE MIRROR: an order that is NOT waiting can still be owed money.
 *
 * An order's status is the state of its last event, so a plan whose first
 * period was refunded reads `refunded` and sits under "Money you returned" —
 * with a later period still live and still counted in the Waiting tile.
 *
 * Seen live: a contact's Waiting read $170 over six rows totalling $140. The
 * missing $30 was a refunded order whose second period was never stopped. The
 * two sibling orders that DID stop carry `cancel_reason: client_unresponsive`
 * and `client_not_paying`, so an owner stopped those on purpose and nobody
 * stopped this one. The debt is real, and it was invisible under a heading
 * that says "needs you".
 */
const refundedButStillOwed = {
  key: 'booking-620f1457',
  title: 'GYM time multi PAY',
  currency: 'USD',
  amount: 60,
  date: '2026-11-11',
  status: 'refunded',
  entries: [{ amount: 30, refunded: 30, status: 'refunded', date: '2026-11-11' }],
  plan: {
    periods: [
      { status: 'paid', amount: 30, dueDate: '2026-11-11' },
      { status: 'pending', amount: 30, dueDate: '2026-11-18' },
    ],
  },
} as unknown as MoneyItem;

describe('money still owed on an order that is not waiting', () => {
  it('a refunded order can carry a live period, and itemFlow counts it', () => {
    const flow = itemFlow(refundedButStillOwed);

    expect(flow.outstanding).toBe(30);
    /* Which is exactly why it cannot be left out: the tile above the list is
       built from these same figures. */
    expect(String(refundedButStillOwed.status)).not.toBe('awaiting_payment');
  });

  it('is surfaced from the settled groups, not from waiting', () => {
    expect(source).toMatch(
      /for \(const group of \['paid', 'refunded', 'cancelled'\] as MoneyGroup\[\]\)/
    );
    expect(source).toMatch(/out\.waiting\.push\(/);
  });

  it('keeps the plan, because the debt is usually a period and not an entry', () => {
    const block = source.slice(source.indexOf('out.waiting.push('));

    /* The settled row drops the plan; this one must not, or the row reports
       zero for money that is genuinely owed. */
    expect(block.slice(0, 500)).not.toContain('plan: undefined,\n          entries');
    expect(block).toContain(`key: \`\${item.key}\${OWED_SUFFIX}\``);
  });

  it('dates itself by the next unpaid period, through the shared helper', () => {
    expect(source).toContain('unpaidPeriods(item)');
    expect(source).toContain('date: nextDue || item.date');
  });

  it('takes lateness from the flow rather than comparing dates again', () => {
    expect(source).toMatch(/flow\.overdue > 0 \? 'overdue' : 'awaiting_payment'/);
  });

  it('opens the whole order, like the settled half does', () => {
    expect(source).toMatch(/\[SETTLED_SUFFIX, OWED_SUFFIX\]\.find/);
  });
});

describe('no language is left holding the withdrawn string', () => {
  it.each(['en', 'es', 'he'])('%s no longer defines payments.part_paid', lang => {
    const file = fs.readFileSync(
      path.join(process.cwd(), `lib/business-os/translations/${lang}.ts`),
      'utf8'
    );

    expect(file).not.toContain("'payments.part_paid'");
  });
});
