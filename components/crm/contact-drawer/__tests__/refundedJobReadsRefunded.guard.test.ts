/**
 * A job whose money went back does not read as a sale.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT LOOKED LIKE
 *
 * A ₪2,000 quote, both stages collected and both fully refunded, rendered:
 *
 *     header          "Completed", in green
 *     journey node    green, with the card glyph
 *     stage dots      green
 *     totals strip    "returned ₪2,000" in amber, beside "kept ₪0"
 *
 * Every mark on the card said a completed sale. Only the small print said
 * otherwise, and the small print was the quietest ink on it.
 *
 * The cause is the same in each case: a refund is recorded against the INVOICE,
 * so the booking stays `completed`, the stage stays `paid`, and the payment
 * step was mapped to `completed` outright with the note "transaction done" —
 * true of the transaction, and the wrong thing to say about the job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HALF THESE EXIST TO PROTECT
 *
 * Every rule here is conditioned on a FULL refund with nothing left to collect.
 * A partial refund leaves the business holding money and a plan can be refunded
 * on its deposit while its final milestone has never been billed — so the loud
 * version of each rule would hide live money. That is the failure mode worth
 * guarding, and it is what most of these assert.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const tab = read('components/crm/contact-drawer/BookingsTab.tsx');
const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
const totals = read('components/payments/PaymentPlanTotals.tsx');
const types = read('components/crm/contact-drawer/types.ts');

describe('the journey node', () => {
  it('has a state of its own, rather than borrowing "completed"', () => {
    expect(types).toMatch(/'skipped' \| 'refunded'/);
    expect(tab).toMatch(/type StepStatus =[^;]*'refunded'/);
    expect(drawer).toMatch(/payment\.status === 'refunded' \? 'refunded'/);

    // The mapping it replaces, which painted the node green.
    expect(drawer).not.toMatch(/payment\.status === 'refunded' \? 'completed'/);
  });

  it('carries its own glyph, not the step default', () => {
    /*
     * The node has two channels, colour and glyph. Red alone puts a refund in
     * with overdue money, a declined card, a bounced email and a cancelled
     * booking — all of which need the owner to act. The returned arrow is what
     * separates it from them.
     */
    expect(tab).toMatch(/step\.status === 'refunded'\s*\n?\s*\?\s*RotateCcw/);
  });
});

describe('the header', () => {
  it('says the money came back instead of "Completed"', () => {
    expect(tab).toMatch(/const statusInfo = moneyReturned/);
    expect(tab).toMatch(/crm\.payment\.status\.refunded/);
  });

  it('still says "Lost" on a cancelled booking', () => {
    // Two different outcomes, and the cancelled one is the more useful label.
    expect(tab).toMatch(/booking\.status !== 'cancelled'/);
  });

  it('and on one whose job was called off after the meeting was held', () => {
    /*
     * The status is not enough on its own any more: `cancel` preserves a
     * recorded attendance, so a held-then-cancelled job keeps `completed` and
     * would have fallen through to "Refunded" on a card that deliberately
     * says "Lost".
     */
    expect(tab).toMatch(/const moneyReturned =\s*\n?\s*!jobCalledOff &&/);
  });

  it('reads the refund from either side', () => {
    /*
     * A quoted job's money sits on the stage invoices, not on the booking row,
     * so `payment_status` there can lag what the invoices say.
     */
    expect(tab).toMatch(/booking\.payment_status === 'refunded' \|\|/);
    expect(tab).toMatch(/s\.key === 'payment' && s\.status === 'refunded'/);
  });
});

describe('a refund is still money that arrived', () => {
  it('counts as paid when deciding whether a quote was collected', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE REGRESSION THE NODE CHANGE CAUSED, AND THE REASON THIS FILE IS
     * WORTH MORE THAN ITS COLOUR ASSERTIONS.
     *
     * `quotePaid` asked whether the payment step read `completed`. The moment
     * a refund stopped reporting that, the header fell through to "won,
     * awaiting payment" — a job whose money had been returned, telling the
     * owner to go and collect it.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(tab).toMatch(
      /s\.key === 'payment' && \(s\.status === 'completed' \|\| s\.status === 'refunded'\)/
    );
  });
});

describe('full and partial stay distinguishable', () => {
  it('the stage dot turns only when ALL of it went back', () => {
    expect(tab).toMatch(/fullyReturned =\s*\n?\s*stageRefunded > 0 && stageRefunded >= stage\.amount/);
  });

  it('the totals cell asks the shared tone which colour this refund is', () => {
    // One cell, both answers, so a job that kept half its money never shows
    // the colour reserved for one that kept none.
    //
    // The DENOMINATOR is deliberately not pinned. It was `total`, and is now
    // `collected || total`: a plan is refunded out of the money that actually
    // arrived, so judging the extent against the agreed total called "every
    // penny taken has gone back" a partial refund whenever later periods were
    // still unbilled. What this guard holds is that the cell ASKS the shared
    // helper rather than choosing a colour itself.
    expect(totals).toMatch(/tone: REFUND_HEX\[refundExtent\(/);
  });

  it('the card badge makes the same distinction', () => {
    /*
     * COMMENTS STRIPPED, AND NO MAGIC WINDOW.
     *
     * This read `badge.slice(0, 900)` and required the two classes within 200
     * characters of each other. Both numbers were guesses about how much prose
     * would ever sit between them, and a note explaining when the badge is
     * shown pushed `REFUND_CLASS.full` past 900 — so the guard failed over a
     * comment while the distinction it protects was untouched.
     *
     * The rule is "the badge asks for full or partial, never one colour for
     * both". That is a fact about the CODE, so the code is what is measured:
     * comments out, then the badge expression up to its closing `)}`.
     */
    const code = tab.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const from = code.indexOf("payment?.status === 'refunded' || refunded > 0");
    expect(from).toBeGreaterThan(-1);

    const badge = code.slice(from, code.indexOf('</span>', from));

    expect(badge).toContain('REFUND_CLASS.full');
    expect(badge).toContain('REFUND_CLASS.partial');
  });

  it('and the tone itself still means what the rest of this file assumes', () => {
    /*
     * The assertions above moved from literal colours to a token, which is only
     * an improvement while the token holds the rule. Pinned here so the meaning
     * cannot drift out from under four surfaces at once.
     */
    const tone = read('components/payments/refundTone.ts');

    expect(tone).toMatch(/full: '#F04438'/);
    expect(tone).toMatch(/partial: '#F79009'/);
    expect(tone).toMatch(/whole > 0 && back >= whole \? 'full' : 'partial'/);
  });
});

describe('"Manage payment" disappears only when there is nothing to manage', () => {
  it('requires BOTH a full refund and every stage finished', () => {
    /*
     * `status: 'refunded'` means everything COLLECTED came back, which on a
     * plan can be true while a later stage has never been billed — a deposit
     * taken and returned, the final milestone still owed. Hiding the button
     * there would remove the only way to record that milestone in cash.
     */
    expect(tab).toMatch(/nothingLeftToManage =\s*\n?\s*payment\?\.status === 'refunded' && everyStageFinished/);
    expect(tab).toMatch(/\['paid', 'cancelled', 'refunded'\]\.includes\(String\(stage\.status\)\)/);
  });
});
