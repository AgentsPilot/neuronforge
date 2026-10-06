/**
 * @jest-environment jsdom
 *
 * The state dropdown can be searched, and SAYS SO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This control has always filtered: it is a Headless UI Combobox, and typing
 * "Calif" narrows the 62 US subdivisions to one. The bug report was "the US
 * states dropdown has no search option", written by somebody looking straight at
 * a working search box.
 *
 * Nothing about it said so. It wears a chevron, it shows the chosen value, and
 * it sits in a form of `select`-looking fields — so it reads as a list you
 * scroll, and sixty-two states get scrolled.
 *
 * So these tests cover two different things, and both matter:
 *   1. that filtering works at all — the behaviour, which a refactor of the
 *      Combobox could silently break;
 *   2. that the AFFORDANCE is present — the magnifier and the "type to search"
 *      prompt that appear when the list opens, which is the actual fix and the
 *      part most likely to be "tidied" away by someone who sees two icons and
 *      keeps one.
 *
 * Nothing is mocked: the subdivisions come from the real `lib-address/lite`, as
 * in `AdminAreaField.render.test.tsx`. A stubbed list would pass against a
 * build where no country resolves at all, which this suite has been bitten by.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { render, waitFor, fireEvent } from '@testing-library/react';

import { AdminAreaField } from '../AdminAreaField';

const SEARCH_PROMPT = 'Type to search…';

function mount(country: string, value = '') {
  return render(
    <AdminAreaField
      country={country}
      value={value}
      onChange={jest.fn()}
      label={(key: string) => key}
      searchPlaceholder={SEARCH_PROMPT}
      emptyLabel="none"
    />
  );
}

/** The combobox input, once the async address rules have resolved. */
async function openedCombobox(container: HTMLElement) {
  const input = await waitFor(() => {
    const el = container.querySelector('[role="combobox"]') as HTMLInputElement | null;
    if (!el) throw new Error('no combobox yet');
    return el;
  });

  fireEvent.focus(input);
  fireEvent.click(input);

  await waitFor(() =>
    expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0)
  );

  return input;
}

const optionTexts = () =>
  Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent ?? '');

describe('the US state dropdown filters as you type', () => {
  it('narrows 62 states to the one that was typed', async () => {
    const { container } = mount('US');
    const input = await openedCombobox(container);

    expect(optionTexts().length).toBe(62);

    fireEvent.change(input, { target: { value: 'Calif' } });

    await waitFor(() => expect(optionTexts().length).toBe(1));
    expect(optionTexts()[0]).toContain('California');
  });

  /* The code is searchable too — somebody typing an address knows "NJ" long
     before they would scroll to "New Jersey". `hint` carries it. */
  it('finds a state by its code as well as its name', async () => {
    const { container } = mount('US');
    const input = await openedCombobox(container);

    fireEvent.change(input, { target: { value: 'NJ' } });

    await waitFor(() => expect(optionTexts().length).toBe(1));
    expect(optionTexts()[0]).toContain('New Jersey');
  });

  it('says so when nothing matches, rather than showing an empty box', async () => {
    const { container } = mount('US');
    const input = await openedCombobox(container);

    fireEvent.change(input, { target: { value: 'zzzz' } });

    await waitFor(() => expect(optionTexts().length).toBe(0));
    expect(container.ownerDocument.body.textContent).toContain('none');
  });

  it('filters provinces in Canada too, not just US states', async () => {
    const { container } = mount('CA');
    const input = await openedCombobox(container);

    fireEvent.change(input, { target: { value: 'Ontario' } });

    await waitFor(() => expect(optionTexts().length).toBe(1));
    expect(optionTexts()[0]).toContain('Ontario');
  });
});

describe('and it looks searchable, which is the half that was missing', () => {
  it('is a real text input, not a select', async () => {
    const { container } = mount('US');
    const input = await waitFor(() => {
      const el = container.querySelector('[role="combobox"]') as HTMLInputElement | null;
      if (!el) throw new Error('no combobox yet');
      return el;
    });

    expect(input.tagName).toBe('INPUT');
    // A readOnly box would filter nothing and look identical.
    expect(input.readOnly).toBe(false);
  });

  it('prompts for typing once the list is open', async () => {
    const { container } = mount('US');
    const input = await openedCombobox(container);

    expect(input.getAttribute('placeholder')).toBe(SEARCH_PROMPT);
  });

  /*
   * Closed, it is a picker and says what it holds; open, it is a search box.
   * Showing "Type to search…" over a closed field would misdescribe a control
   * nobody has touched yet, and would hide the field's own label.
   */
  it('shows the field label again when closed', async () => {
    const { container } = mount('US');
    const input = await waitFor(() => {
      const el = container.querySelector('[role="combobox"]') as HTMLInputElement | null;
      if (!el) throw new Error('no combobox yet');
      return el;
    });

    expect(input.getAttribute('placeholder')).toBe('state');
  });

  /*
   * The icon swap. Both live in the slot `pe-9` already reserves, so this costs
   * no layout — and it is the signal somebody gets mid-click, before they start
   * scrolling. `lucide-react` stamps its name into a class, which is what makes
   * the two distinguishable without reaching into the SVG.
   */
  it('swaps the chevron for a magnifier while open', async () => {
    const { container } = mount('US');

    await waitFor(() => {
      const el = container.querySelector('[role="combobox"]');
      if (!el) throw new Error('no combobox yet');
    });

    expect(container.querySelector('.lucide-chevron-down')).not.toBeNull();
    expect(container.querySelector('.lucide-search')).toBeNull();

    await openedCombobox(container);

    expect(container.querySelector('.lucide-search')).not.toBeNull();
    expect(container.querySelector('.lucide-chevron-down')).toBeNull();
  });
});
