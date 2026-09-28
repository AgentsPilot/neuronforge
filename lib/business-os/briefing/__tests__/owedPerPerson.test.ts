/**
 * What "3 clients owe you" counts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `owed` was a list of INVOICES and every reader downstream treated it as a
 * list of PEOPLE. A real account on 2026-09-27 held:
 *
 *     INV-00004   דויד המלך    ₪4,250   sent
 *     INV-00007   דויד המלך    ₪4,250   sent
 *     INV-00006   אופיר עומר     ₪300   sent
 *
 * and the briefing read "3 לקוחות חייבים ₪8,800" — three clients, about two.
 * The sum was right and the noun was wrong, which is the worse half: an owner
 * reads the figure, believes the sentence around it, and goes looking for a
 * third debtor who does not exist.
 *
 * The list form was wrong in the same way. With two debts named individually,
 * דויד המלך appeared on two consecutive lines differing in nothing a reader
 * could see.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { summariseMoney } from '../BriefingFactsService';

/** The three invoices above, as the repository returns them. */
const LIVE_INVOICES = [
  { id: '4', contact_name: 'דויד המלך', amount: 4250, currency: 'ILS', status: 'sent', due_date: '2026-11-09' },
  { id: '7', contact_name: 'דויד המלך', amount: 4250, currency: 'ILS', status: 'sent', due_date: '2026-11-11' },
  { id: '6', contact_name: 'אופיר עומר', amount: 300, currency: 'ILS', status: 'sent', due_date: '2026-09-27' },
];

const money = (rows: unknown[]) =>
  summariseMoney(rows as never, [], [], []);

describe('money owed', () => {
  it('counts people, not invoices', () => {
    expect(money(LIVE_INVOICES).owed).toHaveLength(2);
  });

  it('still totals every invoice', () => {
    // The grouping must not lose money — only stop miscounting the debtors.
    expect(money(LIVE_INVOICES).totalOwed).toBe(8800);
  });

  it('adds one person\'s invoices together', () => {
    const david = money(LIVE_INVOICES).owed.find(e => e.name === 'דויד המלך');
    expect(david?.amount).toBe(8500);
  });

  it('keeps the SOONEST due date of the group', () => {
    /*
     * The briefing filters out debts that are not due for weeks. Taking the
     * later date would hide a debt half of which falls due today behind its
     * own sibling invoice.
     */
    const david = money(LIVE_INVOICES).owed.find(e => e.name === 'דויד המלך');
    expect(david?.dueDate).toBe('2026-11-09');
  });

  it('treats a person as overdue when ANY of their invoices is', () => {
    const rows = [
      { contact_name: 'Ana', amount: 100, currency: 'USD', status: 'sent', due_date: '2026-10-01' },
      { contact_name: 'Ana', amount: 50, currency: 'USD', status: 'overdue', due_date: '2026-09-01' },
    ];

    expect(money(rows).owed[0].overdue).toBe(true);
  });

  it('never adds two currencies into one person', () => {
    /*
     * There is no FX rate anywhere in this platform. A client billed in two
     * currencies is two amounts, and one combined figure would be invented —
     * the same rule the totals already follow.
     */
    const rows = [
      { contact_name: 'Ana', amount: 100, currency: 'USD', status: 'sent', due_date: null },
      { contact_name: 'Ana', amount: 400, currency: 'ILS', status: 'sent', due_date: null },
    ];

    const result = money(rows);
    expect(result.owed).toHaveLength(2);
    expect(result.mixedCurrency).toBe(true);
    // The dominant currency only — never 500 of something.
    expect(result.totalOwed).toBe(400);
    expect(result.currency).toBe('ILS');
  });

  it('subtracts a refund before deciding anything is owed', () => {
    const rows = [
      { contact_name: 'Ana', amount: 300, refunded_amount: 300, currency: 'USD', status: 'sent', due_date: null },
    ];

    expect(money(rows).owed).toEqual([]);
  });
});
