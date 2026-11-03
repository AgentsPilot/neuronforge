/**
 * Every dropdown row in the invoice dialog names its own text colour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ON SCREEN
 *
 * Create Invoice, dark theme, Payment Terms open: "Due on Receipt", "Net 7",
 * "Net 30", "Net 60" and "Custom" were all but invisible. Only two rows could
 * be read — the hovered one and the selected one — because those are the two
 * that get a background of their own.
 *
 * Neither the row button nor its label set a colour, so the text inherited one,
 * and the inherited ink is dark. The list is drawn on `--v2-surface`, which is
 * also dark. Nothing failed, nothing logged: the options were rendered, in a
 * colour nobody can read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A WHOLE-FILE RULE AND NOT ONE ASSERTION
 *
 * This modal has three dropdowns. Two of them — contacts and services — stated
 * the colour on their own text and looked right; the third did not. One
 * omission among three identical-looking blocks is not something review
 * catches, and it cannot be caught by a type or a lint rule either: the class
 * is simply absent.
 *
 * So the rule is positional rather than per-dropdown. Every option row in this
 * file must carry an explicit `--v2-text-*` token, on the row or on its text.
 * A fourth dropdown added later is covered without anyone remembering to come
 * back here.
 *
 * The settings page's language and currency dropdowns put the token on the ROW,
 * which is the better place: anything added beside the label inherits it. That
 * is where this one now states it too.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SOURCE = fs
  .readFileSync(path.join(process.cwd(), 'components/payments/InvoiceModal.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

/**
 * Each option row of a dropdown, with the markup up to its closing tag.
 *
 * `hover:bg-[var(--v2-bg)]` is what every one of these rows has in common and
 * nothing else in the file uses: it is the hover tint of a list item sitting on
 * the raised `--v2-surface` panel.
 */
function optionRows(): string[] {
  const rows: string[] = [];
  const marker = 'hover:bg-[var(--v2-bg)]';

  let from = 0;
  for (;;) {
    const at = SOURCE.indexOf(marker, from);
    if (at === -1) break;

    /* Back to the opening `<button`, forward to the end of that element, so
       the slice holds the row's own classes AND its children. */
    const open = SOURCE.lastIndexOf('<button', at);
    const close = SOURCE.indexOf('</button>', at);
    rows.push(SOURCE.slice(open === -1 ? at : open, close === -1 ? at + 400 : close));
    from = at + marker.length;
  }
  return rows;
}

describe('the invoice dialog’s dropdown rows', () => {
  it('finds the rows at all, so the rule below is not vacuous', () => {
    /*
     * Three dropdowns: contacts, services, payment terms. If a refactor changes
     * the hover tint, this drops to zero and every assertion after it passes
     * over an empty list — which is the failure mode of every source guard.
     */
    expect(optionRows().length).toBeGreaterThanOrEqual(3);
  });

  it('every row states its text colour rather than inheriting one', () => {
    /*
     * THE BUG, as one assertion. An inherited colour is a dark ink on a dark
     * panel, and the only reason two rows were legible is that hover and
     * selection paint a background behind them.
     */
    const silent = optionRows().filter(row => !/text-\[var\(--v2-text-[a-z]+\)\]/.test(row));

    expect(silent).toEqual([]);
  });

  it('states it on the row itself, not only on one child', () => {
    /*
     * Where the settings dropdowns put it. A colour on the label alone leaves
     * the next element added beside it inheriting again, which is exactly how
     * this one went wrong.
     *
     * Checked on the payment-terms row specifically, because that is the one
     * that broke and the one whose fix this is pinning.
     */
    const terms = optionRows().find(row => row.includes('preset.label'));

    expect(terms).toBeDefined();
    expect(terms).toMatch(/className=\{`[^`]*text-\[var\(--v2-text-primary\)\][^`]*`\}/);
  });
});
