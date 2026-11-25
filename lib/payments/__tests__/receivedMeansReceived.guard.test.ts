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

describe('the tiles state all three figures', () => {
  const section = code(read(SECTION));

  it('Received is the gross, not the remainder', () => {
    expect(section).toContain("['received', totals.collected + totals.refunded, STATUS_TONE.paid]");
  });

  it('Returned is the refunds', () => {
    expect(section).toContain("['refunded', totals.refunded, STATUS_TONE.refunded]");
  });

  it('and what is left gets a tile of its own', () => {
    expect(section).toContain("['kept', totals.refunded > 0 ? totals.collected : 0, STATUS_TONE.paid]");
  });

  it('which is withheld when nothing was returned', () => {
    /*
     * With no refunds, gross and net are the same number: two tiles reading
     * the same amount under different words read as two amounts. The ternary
     * is what suppresses it, since the row below drops anything at zero.
     */
    expect(section).toContain('totals.refunded > 0 ? totals.collected : 0');
    expect(section).toContain('.filter(([, value]) => value > 0)');
  });
});

describe('the sentence makes a true claim', () => {
  const section = code(read(SECTION));

  it('naming all three amounts where money has gone back', () => {
    expect(section).toContain("t('payments.answer.received_net')");
    expect(section).toContain("'{amount}': paid('gross', totals.collected + totals.refunded)");
    expect(section).toContain("'{kept}': paid('kept', totals.collected)");
  });

  it('and keeping the original where none has', () => {
    /* The old sentence is exactly right when there are no refunds — the two
       figures are the same — and explaining an absent refund is noise. */
    expect(section).toContain('if (totals.refunded <= 0) {');
    expect(section).toContain("t('payments.answer.received')");
  });

  it('splitting on every placeholder at once, so word order is the language’s', () => {
    /*
     * Hebrew puts the amount before the verb. A chain of `.replace` calls in
     * English order would force the sentence into English shape; one split on
     * all three placeholders lets each translation order them as it likes.
     */
    expect(section).toMatch(/\.split\(\/\(\\\{amount\\\}\|\\\{refunded\\\}\|\\\{kept\\\}\)\//);
  });
});

describe('the words exist in every language', () => {
  it.each(['en', 'he', 'es'])('%s', language => {
    const file = read(`lib/business-os/translations/${language}.ts`);

    expect(file).toContain('payments.stat.kept');
    expect(file).toContain('payments.answer.received_net');
  });

  it.each(['en', 'he', 'es'])('%s carries all three placeholders', language => {
    /* A translation missing one would silently drop a figure out of the
       sentence — the failure this whole suite exists to prevent. */
    const file = read(`lib/business-os/translations/${language}.ts`);
    const line = file
      .split('\n')
      .find(row => row.includes('payments.answer.received_net')) as string;

    expect(line).toContain('{amount}');
    expect(line).toContain('{refunded}');
    expect(line).toContain('{kept}');
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
