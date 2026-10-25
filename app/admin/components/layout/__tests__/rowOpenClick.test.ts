/**
 * @jest-environment jsdom
 *
 * Money MK-10 (SA-Q-MK10-1 option A, MK10-R5): the shared D-17 row click.
 * `rowOpenTarget` gives the row's Open button for a plain click, and null for
 * a click on any control inside the row, a click while selecting text in it,
 * or a row with no Open button.
 */

import { ROW_CONTROL_SELECTOR, ROW_OPEN_TEST_ID, isSelectingIn, rowOpenTarget } from '../rowOpenClick';

function row(inner: string): HTMLTableRowElement {
  const table = document.createElement('table');
  table.innerHTML = `<tbody><tr>${inner}</tr></tbody>`;
  document.body.appendChild(table);
  return table.querySelector('tr') as HTMLTableRowElement;
}
const OPEN = `<td><button type="button" data-testid="${ROW_OPEN_TEST_ID}">open</button></td>`;
const click = (tr: HTMLElement, target: Element) => rowOpenTarget({ currentTarget: tr, target });

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

describe('rowOpenTarget', () => {
  it('a plain cell click gives the row’s Open button', () => {
    const tr = row(`<td id="cell">Acme</td>${OPEN}`);
    expect(click(tr, tr.querySelector('#cell') as Element)).toBe(tr.querySelector(`[data-testid="${ROW_OPEN_TEST_ID}"]`));
  });

  it.each([
    ['a button', '<button type="button" id="c">x</button>'],
    ['a link', '<a href="#x" id="c">x</a>'],
    ['an input', '<input id="c" />'],
    ['a select', '<select id="c"><option>x</option></select>'],
    ['a textarea', '<textarea id="c"></textarea>'],
    ['a label', '<label id="c">x</label>'],
    ['a summary', '<details><summary id="c">x</summary></details>'],
    ['a role=button', '<span role="button" id="c">x</span>'],
    ['a role=link', '<span role="link" id="c">x</span>'],
    ['a contenteditable', '<div contenteditable="true" id="c">x</div>'],
    ['the inside of a link', '<a href="#x"><span id="c">x</span></a>'],
  ])('a click on %s inside the row is never an open', (_what, control) => {
    const tr = row(`<td>${control}</td>${OPEN}`);
    expect(click(tr, tr.querySelector('#c') as Element)).toBeNull();
  });

  it('a click on the Open button itself is the button’s own (rule 2): the row adds no second open', () => {
    const tr = row(`<td>Acme</td>${OPEN}`);
    expect(click(tr, tr.querySelector('button') as Element)).toBeNull();
  });

  it('a click while text is selected in the row is not an open (rule 3)', () => {
    const tr = row(`<td id="cell">Acme Dental</td>${OPEN}`);
    const text = (tr.querySelector('#cell') as Element).firstChild as Node;
    jest.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, anchorNode: text, focusNode: text } as unknown as Selection);
    expect(isSelectingIn(tr)).toBe(true);
    expect(click(tr, tr.querySelector('#cell') as Element)).toBeNull();
  });

  it('a selection elsewhere on the page does not block the row', () => {
    const tr = row(`<td id="cell">Acme</td>${OPEN}`);
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    document.body.appendChild(outside);
    jest.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, anchorNode: outside.firstChild, focusNode: outside.firstChild } as unknown as Selection);
    expect(click(tr, tr.querySelector('#cell') as Element)).not.toBeNull();
  });

  it('a row with no Open button gives null (nothing to open)', () => {
    const tr = row('<td id="cell">Platform account</td>');
    expect(click(tr, tr.querySelector('#cell') as Element)).toBeNull();
  });

  it('the control list keeps D-17’s exact text (MK10-R1)', () => {
    expect(ROW_CONTROL_SELECTOR).toBe(
      'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]'
    );
    expect(ROW_OPEN_TEST_ID).toBe('row-open');
  });
});
