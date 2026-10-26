/**
 * The plan never says "nothing is charged" to a business that charges.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported from the plan screen, by an owner who had answered the money
 * question one turn earlier with "I collect the money myself: invoice,
 * transfer or cash":
 *
 *     How you get paid
 *     Nothing is charged.
 *
 * The cause was a price gate. `collectionShape` began
 *
 *     const priced = services.filter(service => (service.price || 0) > 0)
 *
 * and the interview NEVER COLLECTS A PRICE — it asks for a count, whether
 * clients book, and how money arrives, leaving every price to the services
 * editor. So `priced` was always empty, every branch of the summary fell
 * through to the last one, and the two owner cards that depend on the same
 * shape — "Connect payments" and "Your bank details" — could never appear
 * either. One dead filter, three wrong things on the screen.
 *
 * This was the FIFTH site with the same gate. The others: the build page's
 * owner cards, `computePaymentMode`, the per-service `collection`, and the
 * `payments` capability. It reads as a reasonable test for "does this business
 * take money" right up until you notice nobody is asked, which is why it kept
 * being written, and why this guard is about the GATE rather than the copy.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/** Comments stripped: this file's own source necessarily quotes the bug. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const chat = strip(read('app/onboarding-chat/page.tsx'));

describe('how the plan decides what to say about money', () => {
  it('does not gate the money summary on a price the chat never asks for', () => {
    /*
     * The shape of the dead filter, in any spelling: a services filter whose
     * test is a price comparison. Asserted against the whole file rather than
     * one function because the same gate has now been written in five places,
     * and the next one will not be called `collectionShape` either.
     */
    const priceGate = /\.filter\(\s*\w+\s*=>\s*\(?\s*\w+\.price[^)]*\)?\s*(>|>=|!==)\s*0/;
    expect(chat).not.toMatch(priceGate);
  });

  it('reads the collection the owner actually gave', () => {
    /*
     * The answer exists on the configuration and was simply not read. If this
     * ever stops being consulted, the summary is back to guessing.
     */
    expect(chat).toMatch(/configuration\?\.collection_method/);
  });

  it('treats an invoice and an in-person payment as money changing hands', () => {
    /*
     * Both are "I collect it myself" — the chip that produced the report. A
     * shape that recognised only `invoice` would still have told a cash
     * business that nothing is charged.
     */
    expect(chat).toMatch(/'invoice'/);
    expect(chat).toMatch(/'in_person'/);
  });

  it('keeps "nothing is charged" for the one answer that means it', () => {
    /*
     * `none` is a real answer — a business that charges for nothing — and the
     * sentence is correct for it. The fix must not make the plan claim money
     * where there is none, which is the opposite error and just as wrong.
     */
    expect(chat).toMatch(/method !== 'none'/);
  });

  it('still lets the services overrule the business-wide answer', () => {
    /*
     * Deliberately kept from the original: one account can hold a free
     * service, an invoiced one and one taking a card, and no single answer
     * describes that. The business-wide method is the FALLBACK, for the plan
     * screen, which is shown before any service row has a collection on it.
     */
    expect(chat).toMatch(/services \|\| \[\]\)\.filter\(service => !!service\.collection\)/);
  });
});
