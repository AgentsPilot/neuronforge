/**
 * @jest-environment jsdom
 *
 * You can type a space in the orders search.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS
 *
 * The input rendered `free`, which is rebuilt from the PARSED terms, and the
 * parser normalises whitespace — `flush` ends with `pending.join(' ').trim()`.
 * So the space a person had just typed was gone by the time the value came back
 * to the box, on that very keystroke. "John" then space then "Doe" arrived as
 * "JohnDoe", and no client could be searched for by first and last name.
 *
 * What makes it worth a test rather than a one-line fix remembered in a comment:
 * the text search was never broken. `parseMoneySearch` joins consecutive text
 * tokens into ONE term, so "john doe" has always filtered correctly. Only the
 * typing of it was impossible, which is the kind of fault that looks like a
 * parser bug and is not — and the kind a future refactor reintroduces by
 * rendering the derived value again because it looks more correct.
 *
 * So these assert on the BOX: what it shows while you type, and that it still
 * follows along when something other than typing changes the filter.
 */

import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { MoneySearchField } from '@/components/payments/MoneySearchField';

const TODAY = '2026-11-16';

/** The field is controlled, so the test has to own the state the page owns. */
function Harness({ onValue }: { onValue?: (v: string) => void }) {
  const [value, setValue] = useState('');

  return (
    <MoneySearchField
      value={value}
      onChange={next => {
        setValue(next);
        onValue?.(next);
      }}
      today={TODAY}
      language="en"
      placeholder="Search"
      t={(key: string) => key}
    />
  );
}

/** Type one character at a time, as a person does. */
function type(input: HTMLInputElement, text: string) {
  for (const ch of text) {
    fireEvent.change(input, { target: { value: input.value + ch } });
  }
}

const box = () => screen.getByRole('combobox') as HTMLInputElement;

describe('a client name with a space in it', () => {
  it('keeps the space on the keystroke that typed it', () => {
    render(<Harness />);

    type(box(), 'John ');

    expect(box().value).toBe('John ');
  });

  it('types a first and last name as written', () => {
    render(<Harness />);

    type(box(), 'John Doe');

    expect(box().value).toBe('John Doe');
  });

  it('sends the whole name up, so the filter is what was typed', () => {
    const seen: string[] = [];
    render(<Harness onValue={v => seen.push(v)} />);

    type(box(), 'John Doe');

    expect(seen[seen.length - 1]).toBe('John Doe');
  });

  it('does not eat a space in the middle of a longer name either', () => {
    render(<Harness />);

    type(box(), 'Ana Maria Lopez');

    expect(box().value).toBe('Ana Maria Lopez');
  });
});

describe('the box still follows the filter it does not own', () => {
  it('empties when the clear button is pressed', () => {
    render(<Harness />);

    type(box(), 'John Doe');
    fireEvent.click(screen.getByLabelText('common.clear'));

    expect(box().value).toBe('');
  });

  it('drops the typed text into a chip when a filter is added from the panel', () => {
    render(<Harness />);

    type(box(), 'John');
    fireEvent.click(screen.getByLabelText('payments.search.add_filter'));

    /* Any period pill: the point is that the box resyncs to a change it did
       not make, rather than holding a draft that no longer matches. */
    const pill = screen.getAllByRole('button', { pressed: false })[0];
    fireEvent.click(pill);

    /* The name survives as free text; the pill becomes a chip beside it. */
    expect(box().value).toBe('John');
  });
});
