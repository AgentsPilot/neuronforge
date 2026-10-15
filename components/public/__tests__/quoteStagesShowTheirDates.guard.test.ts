/**
 * The client sees the schedule the owner sees.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The contact drawer shows each period of an accepted plan with its date —
 * "לתשלום עד 29 בנוב׳ 2026" — because an accepted quote has real
 * `payment_plan_installments` rows and the drawer reads them.
 *
 * The client's own quote page showed the same three amounts and no dates at
 * all. The one surface where the schedule is being AGREED TO was the only one
 * that could not state when the money was due.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ, NOT RECOMPUTED
 *
 * The rows are what will actually be billed. A second derivation on this page
 * would eventually disagree with them, and the anchor is not guessable anyway:
 * the first date is the ACCEPTANCE plus the payment terms — on the reported
 * account, 15 October plus 45 days, which is the 29 November the drawer shows.
 * Nothing can know that before the client presses accept.
 *
 * So before acceptance the rows carry no date, which is honest: there is no
 * schedule yet. A date printed in the offer is wrong the moment they accept a
 * week later, and it is printed in an email they keep.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const route = read('app/api/proposal/[token]/route.ts');
const page = read('components/public/ProposalAnswer.tsx');

describe('the dates come from the rows that will be billed', () => {
  it('reads the instalments rather than deriving a schedule', () => {
    expect(route).toMatch(/\.from\('payment_plan_installments'\)/);
    expect(route).toMatch(/\.select\('installment_number, due_date'\)/);
  });

  it('scopes that read to the owner and the booking', () => {
    const block = route.slice(route.indexOf('const dueByPeriod'));

    expect(block.slice(0, 600)).toMatch(/\.eq\('user_id', proposal\.user_id\)/);
    expect(block.slice(0, 600)).toMatch(/\.eq\('booking_id', proposal\.booking_id\)/);
  });

  it('matches a row to its period by number, not by position', () => {
    /* The labels are "1/3", "2/3" — one-based, like the rows. Indexing by
       array position would silently shift every date by one. */
    expect(route).toMatch(/dueDate: dueByPeriod\.get\(i \+ 1\) \?\? null/);
  });
});

describe('a milestone never gets one', () => {
  it('only the instalment branch carries a date', () => {
    /*
     * A milestone falls due when the work is done, which is why its row has a
     * null `due_date` and a 'manual' trigger. Giving it a date here would
     * invent a deadline the agreement does not contain.
     */
    const milestones = route.slice(
      route.indexOf("if (shape.kind === 'milestones')"),
      route.indexOf("} else if (shape.kind === 'installments')")
    );

    expect(milestones).not.toMatch(/dueDate/);
  });
});

describe('the page renders it', () => {
  it('shows the date beside the period', () => {
    expect(page).toMatch(/\{stage\.dueDate && \(/);
  });

  it('reads the bare DATE on the clock it was written in', () => {
    /*
     * `due_date` has no time and no zone. Parsed as midnight UTC and formatted
     * anywhere west of it, the date shown is the day before the one stored.
     */
    expect(page).toMatch(/new Date\(`\$\{stage\.dueDate\}T00:00:00Z`\)/);
    expect(page).toMatch(/'UTC'\s*\n\s*\)\}/);
  });

  it('carries the year, because a plan outlives one', () => {
    /* 29 Nov 2026, 29 Dec 2026, 29 Jan 2027 — the last one is a different year
       and "29 בינו׳" alone would read as two months away, not fourteen. */
    /* Scoped to the stage block: this file formats other dates too, and an
       unscoped match passed while the year was removed from this one. */
    const from = page.indexOf('THE DATE THE OWNER ALREADY SEES');
    expect(from).toBeGreaterThan(-1);

    expect(page.slice(from, from + 1400)).toMatch(/year: 'numeric' \}/);
  });

  it('types the field as optional, so an unaccepted quote still renders', () => {
    expect(page).toMatch(/dueDate\?: string \| null;/);
  });
});
