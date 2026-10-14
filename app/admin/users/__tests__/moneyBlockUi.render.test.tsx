/**
 * @jest-environment jsdom
 */

/**
 * `useReturnFocus` and `focusSectionHeading` (Admin Layout follow-ups LF-4b,
 * BD-15, F-108; SA C4, C6), on a small harness: a drawer section (a labelled
 * `role="group"` named by its `h3`, as `DrawerSection` renders it) holding a
 * block that uses the hook. The dialog is stood in for by calling the hook's
 * `onCloseAutoFocus` with a cancelable event, as Radix does on close.
 */

import React, { useRef, useState } from 'react';
import { act, render, screen } from '@testing-library/react';

import { focusSectionHeading, useReturnFocus, type ReturnFocus } from '../components/moneyBlockUi';
import { forbidRealNetwork } from '@/tests/helpers/noRealNetwork';

forbidRealNetwork();

let hook: ReturnFocus | null = null;
let setShowOpener: (show: boolean) => void = () => undefined;
let rerender: () => void = () => undefined;

function Block() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focus = useReturnFocus(rootRef);
  hook = focus;
  const [showOpener, setShow] = useState(true);
  const [, setTick] = useState(0);
  setShowOpener = setShow;
  rerender = () => setTick((n) => n + 1);
  return (
    <div data-testid="block" ref={rootRef}>
      {showOpener && (
        <button type="button" data-testid="opener">
          Open
        </button>
      )}
      <button type="button" data-testid="other">
        Other
      </button>
    </div>
  );
}

/** The section as `DrawerSection` renders it, with an unlabelled group in between (SA C4). */
function Section({ inner }: { inner: boolean }) {
  return (
    <div role="group" aria-labelledby="section-heading" data-testid="section">
      <h3 id="section-heading">Credits &amp; billing</h3>
      {inner ? (
        <div role="group" data-testid="inner-group">
          <h3>Not the section heading</h3>
          <Block />
        </div>
      ) : (
        <Block />
      )}
    </div>
  );
}

function closeDialog(): Event {
  const event = new Event('focus.autoFocusOnUnmount', { cancelable: true });
  act(() => {
    hook?.onCloseAutoFocus(event);
  });
  return event;
}

function rememberOpener() {
  hook?.remember(screen.getByTestId('opener'));
}

afterEach(() => {
  hook = null;
});

describe('useReturnFocus (BD-15, F-108)', () => {
  it('returns focus to the opener while it is in the document, and stops Radix from moving it', () => {
    render(<Section inner={false} />);
    rememberOpener();
    const event = closeDialog();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId('opener'));
  });

  it('goes to the section heading when the opener left before the close, and makes it focusable', () => {
    render(<Section inner={false} />);
    rememberOpener();
    act(() => setShowOpener(false));
    closeDialog();
    const heading = screen.getByText('Credits & billing');
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('goes to the section heading when the opener leaves in a later commit while it holds focus (the re-read case)', () => {
    render(<Section inner={false} />);
    rememberOpener();
    closeDialog();
    expect(document.activeElement).toBe(screen.getByTestId('opener'));
    act(() => setShowOpener(false));
    expect(document.activeElement).toBe(screen.getByText('Credits & billing'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('leaves focus alone once the admin moved it elsewhere, and stops guarding', () => {
    render(<Section inner={false} />);
    rememberOpener();
    closeDialog();
    act(() => {
      screen.getByTestId('other').focus();
    });
    act(() => rerender());
    act(() => setShowOpener(false));
    expect(document.activeElement).toBe(screen.getByTestId('other'));
  });

  it('finds the heading by the labelled group, not the first h3 of the nearest group (SA C4)', () => {
    render(<Section inner />);
    rememberOpener();
    act(() => setShowOpener(false));
    closeDialog();
    expect(document.activeElement).toBe(screen.getByText('Credits & billing'));
  });

  it('treats an opener inside a hidden fold as gone', () => {
    render(<Section inner={false} />);
    rememberOpener();
    screen.getByTestId('block').setAttribute('hidden', '');
    closeDialog();
    expect(document.activeElement).toBe(screen.getByText('Credits & billing'));
  });
});

describe('focusSectionHeading', () => {
  it('with no labelled group, focuses the block itself (never body)', () => {
    render(<Block />);
    focusSectionHeading(screen.getByTestId('block'));
    expect(document.activeElement).toBe(screen.getByTestId('block'));
    expect(screen.getByTestId('block').getAttribute('tabindex')).toBe('-1');
  });

  it('does nothing with no element', () => {
    expect(() => focusSectionHeading(null)).not.toThrow();
  });
});
