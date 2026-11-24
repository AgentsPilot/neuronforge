/**
 * The refund dialog's two fields, and what each is for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A source guard rather than a render test. The dialog needs a transaction, a
 * booking, server-side remaining amounts and a live plan check before it will
 * draw anything, and the three rules below are all expressible as facts about
 * the code. A render test here would be mostly scaffolding.
 *
 * THE THREE RULES
 *
 * 1. THE CHIP SURVIVES THE SENTENCE. `reason` is derived from the chip alone
 *    (`reasonKey ?? ''`) and submit is disabled without it — so clearing the
 *    key when the text was edited meant that adding one word to the sentence
 *    greyed out the refund button with nothing on screen saying why, and free
 *    text could never be submitted at all. The chip is the CATEGORY, read by
 *    the ledger, the CSV and the refund-pattern detector; the box is the
 *    sentence. One must not erase the other.
 *
 * 2. A PARTIAL REFUND NEEDS A WRITTEN SENTENCE. The five chips are phrased for
 *    a full refund — "Cancelled by the client" says why money came back, never
 *    why some was kept — and on a partial that text is now sent to the client.
 *    So submit stays disabled while the box still holds the chip's own wording.
 *
 * 3. AND THE OWNER IS TOLD WHY. A disabled button with no explanation is the
 *    bug in rule 1 wearing different clothes.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const MODAL = fs.readFileSync(
  path.join(ROOT, 'components/payments/RefundModal.tsx'),
  'utf8'
);

describe('the refund dialog', () => {
  it('never clears the chosen category when the sentence is edited', () => {
    /*
     * The exact line that caused it. Pinned as absence: any future edit that
     * reintroduces "the text changed, so drop the key" brings back a dialog
     * whose submit button dies silently as the owner types.
     */
    expect(MODAL).not.toMatch(/next !== t\(`payments\.refund\.reason\.\$\{reasonKey\}`\)[\s\S]{0,80}setReasonKey\(null\)/);
  });

  it('still requires both a category and a sentence', () => {
    /* Countable AND explained — the comment's own words, and the reason the
       pair exists at all. */
    expect(MODAL).toContain("const reason = reasonKey ?? '';");
    expect(MODAL).toMatch(/disabled=\{[\s\S]*?!reason \|\|[\s\S]*?!reasonNote \|\|/);
  });

  it('refuses a partial refund whose explanation is only the chip wording', () => {
    expect(MODAL).toMatch(
      /const chipWordingUnchanged =\s*\n?\s*reasonKey !== null && reasonNote === t\(`payments\.refund\.reason\.\$\{reasonKey\}`\)\.trim\(\);/
    );
    /* Reached through `nothingWritten`, which folds in the prefill case too. */
    expect(MODAL).toMatch(/\(effectiveType === 'partial' && nothingWritten\) \|\|/);
  });

  it('says what it wants while the button is disabled', () => {
    expect(MODAL).toContain('payments.refund.partial_reason_needed');
    /* Amber, so it reads as a thing to do rather than a caption. */
    expect(MODAL).toMatch(/nothingWritten \? 'var\(--v2-warning\)'/);
  });

  it('carries the label and both hints in every language', () => {
    for (const lang of ['en', 'es', 'he']) {
      const file = fs.readFileSync(
        path.join(ROOT, `lib/business-os/translations/${lang}.ts`),
        'utf8'
      );
      for (const key of [
        'payments.refund.partial_reason_label',
        'payments.refund.partial_reason_hint',
        'payments.refund.partial_reason_needed',
      ]) {
        expect(file).toContain(`'${key}'`);
      }
    }
  });

  it('sends the sentence to the client only on a partial', () => {
    /* The route's side of the same rule: `reason_note` is internal on every
       other path, and `body.amount` is set only when part of a payment was
       asked for. */
    const route = fs.readFileSync(
      path.join(ROOT, 'app/api/payments/refunds/route.ts'),
      'utf8'
    );
    expect(route).toContain('partialExplanation: body.amount ? body.reason_note : undefined');
  });

  it('refuses a partial whose explanation is whatever it was opened with', () => {
    /*
     * The needs-you card used to open this dialog holding the CLIENT's own
     * message, from the days when the note stayed in the ledger. Sent as the
     * explanation it quotes their request back at them as the business's
     * account of why part was kept. The card no longer passes it, and this
     * blocks it for any caller that does.
     */
    expect(MODAL).toMatch(/const openedWith = useRef\(\(prefillReasonNote \?\? ''\)\.trim\(\)\);/);
    expect(MODAL).toMatch(
      /const nothingWritten =[\s\S]{0,40}chipWordingUnchanged \|\| \(openedWith\.current !== '' && reasonNote === openedWith\.current\);/
    );
    expect(MODAL).toMatch(/\(effectiveType === 'partial' && nothingWritten\) \|\|/);
  });

  it('does not hand the client their own words back', () => {
    const card = fs.readFileSync(
      path.join(ROOT, 'components/business-os/insight/NeedsYouCard.tsx'),
      'utf8'
    );
    /* `item.quote` is what the client typed on the refund form, and
       `refundReasoning` is the agent's advice to the OWNER. Neither is the
       owner's account of a partial refund. */
    expect(card).not.toMatch(/reasonNote:\s*item\.quote/);
    expect(card).not.toMatch(/reasonNote:\s*item\.refundReasoning/);
    /* The chip still arrives chosen — that is the part that saves typing. */
    expect(card).toMatch(/reasonKey: item\.noteKey\?\.replace/);
  });

  it('marks the box that the client will read', () => {
    /*
     * Every other field in this dialog belongs to the business. On a partial
     * this one is the client's, and it looked identical to the rest — which
     * is how an owner types a note to themselves into a box that is about to
     * be sent to somebody.
     *
     * The tint is the hint's own amber, and it is INLINE: as a Tailwind
     * arbitrary class `color-mix` emits a bare `var(--v2-warning)` fallback
     * and paints the field solid amber where it is unsupported, while an
     * unsupported inline declaration is simply dropped.
     */
    expect(MODAL).toMatch(
      /effectiveType === 'partial'[\s\S]{0,120}background: 'color-mix\(in srgb, var\(--v2-warning\) 10%, transparent\)'/
    );
    expect(MODAL).not.toMatch(/bg-\[color-mix/);
  });

  it('opens the amount empty when the prefill IS the whole amount', () => {
    /*
     * "A different amount" opened on Partial holding the agent's figure — and
     * when the agent recommends returning everything, that figure is the
     * whole paid sum. A partial refund of all of it is a full refund with
     * extra steps, offered under a button that promises the opposite.
     *
     * Compared against the props rather than `maxRefundable`: that is
     * declared hundreds of lines below and `useState` evaluates eagerly, so
     * reading it here threw on open and took the dialog with it. Pinned,
     * because the source guards in this file cannot see a render crash.
     */
    expect(MODAL).toMatch(/prefillAmount < originalAmount - alreadyRefunded/);
    expect(MODAL).not.toMatch(/useState\([\s\S]{0,400}prefillAmount < maxRefundable/);
  });

  it('gives the amount a money field rather than a cent-stepping spinner', () => {
    /*
     * `type="number"` stepped by 0.01 — forty presses to move a dollar on the
     * one field that IS the decision — and drew its value in the document's
     * locale, so a business running in Hebrew saw "20,00" in a box holding
     * "20.00".
     */
    expect(MODAL).toMatch(/type="text"\s*\n\s*inputMode="decimal"/);
    expect(MODAL).not.toMatch(/type="number"\s*\n\s*step="0\.01"/);
    /* A comma typed out of habit is normalised, not refused. */
    expect(MODAL).toMatch(/replace\(',', '\.'\)/);
  });

  it('says which payment the processing fee belongs to', () => {
    /*
     * The old sentence named the figure twice and, beside a $20 refund of a
     * $40 payment, read as a charge on the $20. It is the fee already taken
     * when the payment arrived, and none of it returns either way.
     */
    for (const lang of ['en', 'es', 'he']) {
      const file = fs.readFileSync(
        path.join(ROOT, `lib/business-os/translations/${lang}.ts`),
        'utf8'
      );
      const line = file
        .split('\n')
        .find(l => l.includes("'payments.refund.fee_kept'")) as string;
      expect(line).toBeDefined();
      /* Once, not twice. */
      expect(line.match(/\{fee\}/g)).toHaveLength(1);
    }
  });
});
