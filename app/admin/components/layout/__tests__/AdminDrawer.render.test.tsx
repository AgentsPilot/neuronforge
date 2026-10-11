/**
 * @jest-environment jsdom
 */

/**
 * The admin drawer family (Admin Layout Standard C-9, §5.8 D-4 to D-6; F-65,
 * F-66; L-1d SA S-4, S-5). jsdom sees class strings and inline styles only:
 * whether the `[&>button]` rules win in a real browser is proven by the QA
 * computed-style checks (L-1d SA M-2).
 *
 * The harness plays a page: an opener button, and a drawer whose
 * `onReturnFocus` puts focus back on it.
 */

import React, { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AdminDrawer, DrawerField, DrawerFields, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';

const TITLE = 'User Login';
const SUFFIX = '2026-10-10 09:00 UTC';

let onClose: jest.Mock;
let onReturnFocus: jest.Mock;

function Harness({ suffix = SUFFIX }: { suffix?: string }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <AdminDrawer
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        onReturnFocus={() => {
          onReturnFocus();
          opener.current?.focus();
        }}
        title={TITLE}
        titleSuffix={suffix}
        testId="x-drawer"
      >
        <DrawerSection title="Event" testId="x-section">
          <DrawerFields>
            <DrawerField label="Event ID" testId="x-field">
              log-1
            </DrawerField>
          </DrawerFields>
        </DrawerSection>
        <button type="button">Inside</button>
      </AdminDrawer>
    </>
  );
}

async function openDrawer(): Promise<{ opener: HTMLElement; dialog: HTMLElement }> {
  const opener = screen.getByRole('button', { name: 'Opener' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog');
  return { opener, dialog };
}

beforeEach(() => {
  onClose = jest.fn();
  onReturnFocus = jest.fn();
});

describe('AdminDrawer: the shell', () => {
  it('closed: no dialog', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('open: a dialog named exactly "title suffix", with a space between them (SA S-4)', async () => {
    render(<Harness />);
    await openDrawer();
    const dialog = screen.getByRole('dialog', { name: `${TITLE} ${SUFFIX}` });
    // jsdom's name computation pads elements with spaces whatever their CSS, so
    // the role name alone cannot see a missing space; textContent can: it joins
    // the title text and the suffix span with nothing but the literal space.
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe(`${TITLE} ${SUFFIX}`);
    expect(screen.getByText(SUFFIX).className).toContain('font-mono');
  });

  it('D-4: the dark palette, the X selectors and the inline background and width (SA S-5)', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    expect(dialog.getAttribute('data-testid')).toBe('x-drawer');
    const classes = dialog.className.split(/\s+/);
    for (const cls of [
      '[color-scheme:dark]',
      'bg-slate-900',
      'sm:max-w-3xl',
      'overflow-y-auto',
      '[&>button]:text-slate-300',
      '[&>button]:opacity-100',
      '[&>button]:focus:ring-purple-500',
      '[&>button]:focus:ring-offset-slate-900',
    ]) {
      expect({ cls, present: classes.includes(cls) }).toEqual({ cls, present: true });
    }
    // The width is inline, never a w-full class in an order contest with the sheet's w-3/4.
    expect(classes).not.toContain('w-full');
    expect(dialog.style.width).toBe('100%');
    expect(dialog.style.backgroundColor).toBe('rgb(15, 23, 42)');
  });

  it('F-65: the title carries an inline slate-100 colour', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    const title = within(dialog).getByRole('heading', { level: 2 });
    expect(title.style.color).toBe('rgb(241, 245, 249)');
  });

  it('F-66: the X is a direct child of the dialog, so the [&>button] selectors reach it', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(close.parentElement).toBe(dialog);
  });
});

describe('DrawerSection, DrawerFields, DrawerField (D-5)', () => {
  it('a section is a group named by its h3: no <section>, no region', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    const group = within(dialog).getByRole('group', { name: 'Event' });
    expect(group.getAttribute('data-testid')).toBe('x-section');
    expect(group.tagName).toBe('DIV');
    const heading = within(group).getByRole('heading', { level: 3, name: 'Event' });
    expect(group.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(dialog.querySelector('section')).toBeNull();
    expect(within(dialog).queryAllByRole('region')).toHaveLength(0);
  });

  it('a field is a dt and a dd inside the dl, reachable through the label', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    const label = within(dialog).getByText('Event ID', { selector: 'dt' });
    const value = within(dialog).getByTestId('x-field');
    expect(value.tagName).toBe('DD');
    expect(value.textContent).toBe('log-1');
    expect(label.parentElement).toBe(value.parentElement);
    expect(label.closest('dl')).toBeTruthy();
  });
});

describe('closing and focus (D-6)', () => {
  it('Escape calls onClose once, then onReturnFocus, and the opener has focus', async () => {
    render(<Harness />);
    const { opener, dialog } = await openDrawer();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    // Radix may run its unmount auto-focus more than once; what matters is that
    // the page's hook ran and the opener holds focus.
    expect(onReturnFocus).toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it('the X calls onClose, and focus returns to the opener', async () => {
    render(<Harness />);
    const { opener, dialog } = await openDrawer();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it('Tab from the last focusable stays inside the dialog (focus trap)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { dialog } = await openDrawer();
    const close = within(dialog).getByRole('button', { name: 'Close' });
    close.focus();
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(close);
  });
});
