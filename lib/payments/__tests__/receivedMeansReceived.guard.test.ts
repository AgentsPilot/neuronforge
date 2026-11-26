/**
 * The contact drawer says what arrived, what went back, and what is left.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * "The numbers in Payments & Invoices don't make any sense with total
 * collected/paid."
 *
 * They were right, and nothing was miscounted. Checked against the live ledger
 * for one contact, every figure reconciled to the cent:
 *
 *   taken in          707.01
 *   refunded          290.00
 *   left with them    417.01   ← `totals.collected`
 *   still owed        407.04   (one unpaid invoice + six unbilled stages)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WORD, NOT THE SUM
 *
 * `collected` is computed as `entry.amount - entry.refunded`. It is what the
 * owner KEPT. The drawer printed it under the word RECEIVED, beside a RETURNED
 * tile holding the refunds — so the obvious subtraction, 417.01 − 290.00, gives
 * 127.01, a number belonging to nothing at all. And the figure that would have
 * made sense of the pair, the 707.01 actually taken, appeared nowhere on the
 * screen.
 *
 * The sentence above the tiles was worse, because it is a claim rather than a
 * label: "So far you have received $417.01 from them" is simply untrue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ARITHMETIC WAS LEFT ALONE
 *
 * `collected` being net is not a bug. `collected + refunded` is the gross, which
 * is exactly what makes the money page's bar add up to everything ever billed.
 * Redefining it to gross would have moved every figure on the reports page and
 * the dashboard to fix a word in a drawer.
 *
 * So the three facts an owner reconciling against their bank wants are each
 * STATED — what came in, what went back, what is theirs — and none is implied
 * by arithmetic the reader has to do, or hidden because it was already done.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const SECTION = 'components/crm/contact-drawer/PaymentsSection.tsx';
const ITEMS = 'lib/payments/moneyItems.ts';

/** Source with comments removed, so these notes cannot satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('what collected actually means', () => {
  it('is net of refunds, and stays that way', () => {
    /*
     * The premise of everything below. If this ever becomes gross, the drawer
     * starts double counting the refunds instead of hiding them, and these
     * cases should fail loudly rather than the screen quietly lying again.
     */
    const items = code(read(ITEMS));

    expect(items).toContain('collected += entry.amount - entry.refunded;');
    expect(items).toContain('flow.collected += entry.amount - entry.refunded;');
  });
});

describe('no label calls a net figure "received"', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THIS SUITE ONCE PINNED A DESIGN THAT WAS THEN REPLACED, AND SAID SO LATE.
   *
   * The first repair kept the word RECEIVED and made it hold the gross, with
   * RETURNED and YOURS beside it. The design that shipped is different — a
   * total and the three parts of it — and these cases went on asserting the
   * superseded one until CI said so. That is the failure mode of a guard
   * written against a shape rather than a rule.
   *
   * So what is left here is the part that is true of ANY shape: `collected` is
   * net, and no label may present it as money received. The current tiles and
   * sentence are asserted by `theListsAddUpToTheTiles`, beside the lists they
   * have to reconcile with.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * 2026-11-26: THE GROSS/NET PAIR IS BACK, STATED AS A SUM.
   *
   * The "Total sales · Collected · …" design that replaced it confused the
   * owner and testers in its turn: Total sales counted refunded money as sold,
   * and Collected, being net, matched nothing in the processor. The tiles are
   * now Received (gross) · −Refunded · Kept (net) · Still to collect, and the
   * sentence spells the subtraction out, so the reader is never left to do it.
   * The rule below is the one that never changed: the net figure is never
   * called "received".
   * ───────────────────────────────────────────────────────────────────────────
   */
  const section = code(read(SECTION));

  it('the word for the net figure is "kept"', () => {
    /* Which is what it is: money that came in and stayed. */
    expect(section).toContain("['kept', totals.collected, STATUS_TONE.paid]");
  });

  it('and "received" holds the gross, never the net', () => {
    expect(section).toContain('const received = totals.collected + totals.refunded;');
    expect(section).not.toContain("['received', totals.collected");
  });

  it('the sentence says what came in, what went back, and so what was kept', () => {
    /*
     * The claim that was once false: "you have received $417.01" of $707.01
     * taken. The sentence opens on the gross and names the net only as what is
     * left after the refund it states beside it.
     */
    expect(section).toContain("fill('payments.answer.paid_you'");
    expect(section).toContain("fill('payments.answer.refunded_kept'");
    expect(section).toContain('amount: <span>{money(received)}</span>');
  });

  it('and the net is never presented on its own as what was received', () => {
    expect(section).not.toContain("t('payments.answer.received_net')");
  });
});

describe('the arithmetic the screen now shows', () => {
  /* Reproduced on the reported contact's real figures. */
  const collected = 417.01;
  const refunded = 290.0;

  it('Received minus Returned is what is left', () => {
    const received = collected + refunded;

    expect(received).toBeCloseTo(707.01, 2);
    expect(received - refunded).toBeCloseTo(collected, 2);
  });

  it('and the old pairing subtracted the refunds twice', () => {
    /* 417.01 − 290.00 = 127.01, which is what the owner was invited to work
       out and what nothing in the business matches. */
    expect(collected - refunded).toBeCloseTo(127.01, 2);
  });
});
