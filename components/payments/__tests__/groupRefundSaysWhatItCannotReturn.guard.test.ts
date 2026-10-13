/**
 * A booking refund never claims money it cannot return.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT SAID
 *
 * A ₪800 quote, the deposit paid by card and the final milestone in cash, opened
 * its refund dialog on:
 *
 *     "This booking has 2 payments. All of them will be refunded in full —
 *      ₪400.00 in total."
 *
 * Each half is true alone; together they are a lie. ₪400 is ONE of the two
 * payments. The cash ₪400 cannot go back through Stripe — it has to be handed
 * over the way it arrived — so it was dropped from the figure while the
 * sentence went on saying "all of them". An owner reads that as ₪800 on its way
 * to a client who will receive ₪400.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CAUSE IS WORTH MORE THAN THE SYMPTOM
 *
 * The endpoint had reported `blocked_count` since it was written, with a comment
 * saying it exists "so a dialog offering everything can say honestly that some
 * of it will not come back". The dialog never read it.
 *
 * So both ends are asserted: that the server sends enough to be honest with,
 * and that the dialog spends it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { dictionarySource } from '@/tests/helpers/dictionarySource';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const route = read('app/api/payments/refunds/route.ts');
const modal = read('components/payments/RefundModal.tsx');
const copy = dictionarySource();

describe('the endpoint reports what it is holding back', () => {
  it('sends the blocked amount, not only the count', () => {
    // "One payment is excluded" does not say how much is still theirs.
    expect(route).toMatch(/blocked_remaining: sumRemaining\(blocked\)/);
  });

  it('names how that money arrived', () => {
    /*
     * "Paid outside Stripe — cash, a transfer or a cheque" asks the owner to
     * work out which of three it was about their own booking. The transaction
     * knows it was cash.
     */
    expect(route).toMatch(/blocked_methods: blockedMethods/);
  });

  it('counts as blocked only money that is still held', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE SECOND-ORDER BUG, CAUSED BY THE FIRST FIX.
     *
     * A payment already refunded in full is unrefundable AND has nothing
     * left. Counting it as "blocked" produced:
     *
     *   "Only ₪400.00 will be returned here. The remaining ₪0.00 must be
     *    refunded from their payment row."
     *
     * — pointing the owner at money that does not exist, about a refund they
     * had just made themselves. `refundGroup` already takes this view: a leg
     * with nothing remaining is skipped, not failed.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(route).toMatch(/!v\.refundable && \(v\.remaining \?\? 0\) > 0/);
  });

  it('reports how many payments will actually come back', () => {
    // Different from how many exist, the moment one has been refunded.
    expect(route).toMatch(/refundable_count: refundable\.length/);
  });

  it('separates money taken outside Stripe from money with no charge reference', () => {
    /*
     * Different problems, different words. Cash is handed back and recorded; a
     * Stripe payment whose reference was never written is a data fault, and
     * telling that owner to hand over cash sends them after money that does
     * not exist.
     */
    expect(route).toMatch(/blocked_manual_remaining/);
  });
});

describe('the fee warning, on a booking refund as well as a single one', () => {
  it('is sent from the group branch too', () => {
    /*
     * Stripe keeps its processing fee when money goes back, so a ₪400 refund
     * leaves the business $5.40 down. The single-payment branch always said
     * so; refunding the SAME payment from the booking said nothing, so whether
     * an owner was warned depended on which button they opened.
     */
    expect(route).toMatch(/processor_fee: groupFee/);
  });

  it('counts only the payments actually being returned', () => {
    // A blocked payment costs nothing, because nothing goes back through it.
    expect(route).toMatch(/const refundableIds = resolved\.transactionIds\.filter/);
  });

  it('refuses to add fees in different currencies', () => {
    /*
     * Stripe charges the fee in the settlement currency, which need not match
     * the payment's, and this platform has no FX rate anywhere. $5.40 + €3.10
     * is a number true of nothing, so mixed currencies say nothing at all.
     */
    expect(route).toMatch(/feeCurrencies\.size === 1/);
  });
});

describe('the dialog spends what it is given', () => {
  it('reads the blocked figures', () => {
    expect(modal).toMatch(/data\.blocked_count === 'number' && data\.blocked_count > 0/);
    expect(modal).toMatch(/amount: Number\(data\.blocked_remaining \?\? 0\)/);
  });

  it('names the method only when there is exactly one, covering all of it', () => {
    // Two blocked payments by different methods have no single honest answer.
    expect(modal).toMatch(/methods\.length === 1 &&/);
    expect(modal).toMatch(
      /Number\(data\.blocked_manual_remaining \?\? 0\) === Number\(data\.blocked_remaining \?\? 0\)/
    );
  });

  it('counts the payments coming back, not every one ever taken', () => {
    expect(modal).toMatch(/'\{count\}', String\(refundableCount \?\? paymentCount\)/);
  });

  it('delegates WHICH sentence to the one place that can be enumerated', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * This choice has been wrong twice, both times as correct code making a
     * wrong decision inline in JSX, where checking it meant reading the whole
     * expression and imagining the data. `groupNoticeVariant` is a pure
     * function with its own enumerated tests — including the ten-stage
     * proposal, which is the case nobody checks by hand.
     *
     * Asserted here so the next edit extends those rules rather than quietly
     * reintroducing a second copy of them in the markup.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(modal).toMatch(/const noticeVariant = groupNoticeVariant\(\{/);
    expect(modal).toMatch(/\{isGroup && noticeVariant && \(/);

    /* And the branch itself only picks a string from the variant — no second
       opinion about blocked money or counts living in the markup. */
    const notice = modal.slice(modal.indexOf('{isGroup && noticeVariant && ('));

    expect(notice.slice(0, 700)).toMatch(/noticeVariant === 'manual'/);
    expect(notice.slice(0, 700)).toMatch(/noticeVariant === 'partial'/);
    expect(notice.slice(0, 700)).not.toMatch(/blocked\.amount|refundableCount >/);
  });
});

describe('the copy exists in every language', () => {
  it.each(['payments.refund.group_notice_manual', 'payments.refund.group_notice_partial'])(
    '%s is translated three times',
    key => {
      /*
       * A missing key renders as the key. In a refund dialog that puts a raw
       * dotted string where the sentence about the missing money should be —
       * worse than the bug it replaces.
       */
      expect(copy.split(`'${key}':`).length - 1).toBe(3);
    }
  );

  it('carries no placeholder the dialog does not fill', () => {
    /*
     * Every one of these sentences once carried figures — what is returned,
     * what is held back, the method it arrived by — and they were removed:
     * the amount is already the largest thing on the dialog and sits on the
     * button that returns it, so prose repeating it gave the owner two numbers
     * to reconcile instead of one fact to read.
     *
     * `{count}` is the only placeholder the dialog still fills. Any other left
     * in a string renders as literal braces inside a refund warning.
     */
    for (const line of copy.split('\n')) {
      if (!line.includes('payments.refund.group_notice')) continue;

      for (const stale of ['{amount}', '{blocked}', '{method}']) {
        expect(line).not.toContain(stale);
      }
    }
  });

  it('uses a count only where a count cannot be one', () => {
    /*
     * "This returns all 1 payments in full" is the sentence this prevents. The
     * unqualified notice is the only one carrying `{count}`, and
     * `groupNoticeVariant` only returns it above 1.
     */
    for (const line of copy.split('\n')) {
      if (line.includes('group_notice_partial') || line.includes('group_notice_manual')) {
        expect(line).not.toContain('{count}');
      }
    }
  });
});
