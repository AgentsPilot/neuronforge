/**
 * @jest-environment jsdom
 */

/**
 * `SettingsDrawer` (settings drawer review C-1, C-4; S-1 workplan, SA W-4).
 *
 * The harness plays the page: an opener row whose ref is the return target,
 * and the drawer's `onOpenChange` recorded so a refused close is visible as a
 * call that never happened.
 */

import fs from 'fs';
import path from 'path';
import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';

const TITLE = 'Your plan';
// Not "Close": the sheet's built-in X (hidden by `[&>button]:hidden` in a browser, not in
// jsdom) is named that, and the label must visibly come from the prop.
const CLOSE = 'Close this drawer';

let onOpenChange: jest.Mock;

interface HarnessProps {
  isBusy?: boolean;
  isRTL?: boolean;
  meta?: React.ReactNode;
  withReturnRef?: boolean;
}

function Harness({ isBusy = false, isRTL = false, meta, withReturnRef = true }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <button type="button">Elsewhere</button>
      <SettingsDrawer
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          setOpen(next);
        }}
        title={TITLE}
        meta={meta}
        isBusy={isBusy}
        isRTL={isRTL}
        closeLabel={CLOSE}
        returnFocusRef={withReturnRef ? opener : undefined}
        testId="settings-test-drawer"
      >
        <p>Drawer body</p>
        <button type="button">Inside</button>
      </SettingsDrawer>
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

/**
 * Radix registers its outside-pointer listener on a timer after mount, so an
 * outside press sent straight away is never seen and a "does not close"
 * assertion would pass for nothing (SA test-plan note). Wait it out first.
 */
async function letRadixSettle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  onOpenChange = jest.fn();
});

describe('SettingsDrawer: the shell', () => {
  it('closed: renders no dialog', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Drawer body')).toBeNull();
  });

  it('open: a dialog named by the title, with the children inside', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    expect(screen.getByRole('dialog', { name: TITLE })).toBe(dialog);
    expect(within(dialog).getByText('Drawer body')).toBeTruthy();
    expect(dialog.getAttribute('data-testid')).toBe('settings-test-drawer');
  });

  it("MoneyDetailDrawer's shell classes", async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    const classes = dialog.className.split(/\s+/);
    for (const cls of ['w-full', 'sm:max-w-xl', 'p-0', 'overflow-hidden', 'flex', 'flex-col', '[&>button]:hidden']) {
      expect({ cls, present: classes.includes(cls) }).toEqual({ cls, present: true });
    }
  });

  it('left to right: right side, dir ltr', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    expect(dialog.getAttribute('data-side')).toBe('right');
    expect(dialog.getAttribute('dir')).toBe('ltr');
  });

  it('right to left: left side, dir rtl', async () => {
    render(<Harness isRTL />);
    const { dialog } = await openDrawer();
    expect(dialog.getAttribute('data-side')).toBe('left');
    expect(dialog.getAttribute('dir')).toBe('rtl');
  });

  it('meta renders as the description; without it there is no aria-describedby', async () => {
    const { unmount } = render(<Harness meta="Founding Partner, monthly" />);
    let { dialog } = await openDrawer();
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe('Founding Partner, monthly');
    unmount();

    render(<Harness />);
    ({ dialog } = await openDrawer());
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('SettingsDrawer: closing', () => {
  it('the own X carries the close label and calls onOpenChange(false)', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    fireEvent.click(within(dialog).getByRole('button', { name: CLOSE }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Escape calls onOpenChange(false)', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('an outside press closes it when not busy (the control for the busy case)', async () => {
    render(<Harness />);
    await openDrawer();
    await letRadixSettle();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('focus returns to the opener row on close', async () => {
    render(<Harness />);
    const { opener, dialog } = await openDrawer();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('focus goes to the return target even when it was not the element focused before', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    // The link-opened case: something else held focus when the drawer opened.
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('SettingsDrawer: busy refusal (C-4)', () => {
  it('the X is disabled and does not close', async () => {
    render(<Harness isBusy />);
    const { dialog } = await openDrawer();
    const close = within(dialog).getByRole('button', { name: CLOSE }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(close);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Escape does not close', async () => {
    render(<Harness isBusy />);
    const { dialog } = await openDrawer();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await letRadixSettle();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('an outside press does not close', async () => {
    render(<Harness isBusy />);
    await openDrawer();
    await letRadixSettle();
    fireEvent.pointerDown(document.body);
    await letRadixSettle();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('the body says it is busy', async () => {
    render(<Harness isBusy />);
    const { dialog } = await openDrawer();
    expect(within(dialog).getByText('Drawer body').parentElement?.getAttribute('aria-busy')).toBe('true');
  });
});

describe('SettingsDrawer: source guard (C-1)', () => {
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'components/business-os/settings/SettingsDrawer.tsx'),
    'utf8'
  );
  // Comments explain what the wrapper is NOT; strip them so the explanation
  // cannot fail its own guard.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('strips comments before matching', () => {
    expect(raw).toContain('MoneyDetailDrawer');
    expect(code).not.toContain('MoneyDetailDrawer');
  });

  it('imports nothing from the entitlements module (type-only included)', () => {
    expect(code).not.toMatch(/business-os\/entitlements/);
  });

  // SA ruling Q-3 / W-4: S-3 may relax the `Provider` ban for exactly one
  // import, `TabFooterSlotProvider` from `./TabFooter` (an existing portal slot,
  // not shared state). `createContext` stays banned. That edit is expected.
  it('has no context and no provider', () => {
    expect(code).not.toContain('createContext');
    expect(code).not.toContain('useContext');
    expect(code).not.toContain('Provider');
  });

  it('does not log, and never keeps hidden content mounted', () => {
    expect(code).not.toContain('console.');
    expect(code).not.toContain('forceMount');
  });

  it("keeps MoneyDetailDrawer's width and hides the sheet's built-in X", () => {
    expect(code).toContain('[&>button]:hidden');
    expect(code).toContain('sm:max-w-xl');
  });
});
