/**
 * @jest-environment jsdom
 */

/**
 * `SettingsDrawer`'s unsaved-changes guard with the REAL Radix sheet and dialog
 * (settings drawer review C-5; S-3 workplan G-1 to G-14; SA S-3 ruling 1, C-5).
 *
 * The harness plays the owner: an opener row (the return target), and an input
 * inside the drawer whose value it turns into `isDirty`. The input lives in the
 * drawer's content, so "the draft goes on Discard" is observable as an empty
 * input after reopening.
 */

import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';

const TITLE = 'Marketing permission';
const CLOSE = 'Close this drawer';
const COPY = {
  title: 'Discard your changes?',
  description: 'You have changes here that are not saved.',
  keep: 'Keep editing',
  discard: 'Discard changes',
};

let onOpenChange: jest.Mock;
/** Lets a test close the drawer from the parent, by a route that is not the gate. */
let forceClose: () => void = () => undefined;

interface HarnessProps {
  isBusy?: boolean;
  isRTL?: boolean;
  /** Absent: the S-2 shape, with no guard props at all. */
  guarded?: boolean;
}

/** The content: owns the draft, so it goes when the sheet unmounts it. */
function Draft({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const [value, setValue] = useState('');
  return (
    <input
      aria-label="Draft"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onDirty(e.target.value !== '');
      }}
    />
  );
}

function Harness({ isBusy = false, isRTL = false, guarded = true }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  forceClose = () => {
    setDirty(false);
    setOpen(false);
  };
  const handle = (next: boolean) => {
    onOpenChange(next);
    // The owner resets its dirty flag on every close that got through.
    if (!next) setDirty(false);
    setOpen(next);
  };
  const common = {
    open,
    onOpenChange: handle,
    title: TITLE,
    isBusy,
    isRTL,
    closeLabel: CLOSE,
    returnFocusRef: opener,
    testId: 'settings-guard-drawer',
  };
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      {guarded ? (
        <SettingsDrawer {...common} isDirty={dirty} discardCopy={COPY}>
          <Draft onDirty={setDirty} />
        </SettingsDrawer>
      ) : (
        <SettingsDrawer {...common}>
          <Draft onDirty={() => undefined} />
        </SettingsDrawer>
      )}
    </>
  );
}

async function openDrawer(): Promise<HTMLElement> {
  const opener = screen.getByRole('button', { name: 'Opener' });
  opener.focus();
  fireEvent.click(opener);
  return screen.findByRole('dialog', { name: TITLE });
}

function draft(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Draft' }) as HTMLInputElement;
}

function type(text: string) {
  fireEvent.change(draft(), { target: { value: text } });
}

function ownX(sheet: HTMLElement): HTMLButtonElement {
  return within(sheet).getByRole('button', { name: CLOSE }) as HTMLButtonElement;
}

/**
 * The same sheet, still open. Read by test id: while the modal prompt is up,
 * Radix marks the sheet `aria-hidden`, so a role query no longer finds it.
 */
function expectSheetOpen(sheet: HTMLElement) {
  expect(screen.getByTestId('settings-guard-drawer')).toBe(sheet);
  expect(sheet.getAttribute('data-state')).toBe('open');
}

function prompt(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: COPY.title });
}

/** Radix registers its outside-pointer listener on a timer after mount; wait it out. */
async function letRadixSettle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  onOpenChange = jest.fn();
});

describe('dirty: every close route asks first', () => {
  it('G-1: the X opens the prompt and does not close', async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    fireEvent.click(ownX(sheet));
    expect(await screen.findByRole('dialog', { name: COPY.title })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expectSheetOpen(sheet);
  });

  it('G-2: Escape opens the prompt and does not close', async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    fireEvent.keyDown(draft(), { key: 'Escape' });
    expect(await screen.findByRole('dialog', { name: COPY.title })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expectSheetOpen(sheet);
  });

  it('G-3: an outside press opens the prompt and does not close', async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    await letRadixSettle();
    fireEvent.pointerDown(document.body);
    expect(await screen.findByRole('dialog', { name: COPY.title })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expectSheetOpen(sheet);
  });
});

describe('the prompt', () => {
  it('G-4: Keep editing closes the prompt; the drawer and the edit stay', async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    fireEvent.click(ownX(sheet));
    const p = await screen.findByRole('dialog', { name: COPY.title });
    fireEvent.click(within(p).getByRole('button', { name: COPY.keep }));
    await waitFor(() => expect(prompt()).toBeNull());
    expectSheetOpen(sheet);
    expect(draft().value).toBe('Hello');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('G-5: Escape on the prompt acts as Keep editing (only the top layer hears it)', async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    fireEvent.click(ownX(sheet));
    const p = await screen.findByRole('dialog', { name: COPY.title });
    fireEvent.keyDown(p, { key: 'Escape' });
    await waitFor(() => expect(prompt()).toBeNull());
    await letRadixSettle();
    expectSheetOpen(sheet);
    expect(draft().value).toBe('Hello');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("G-6: a press on the prompt's backdrop acts as Keep editing", async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    fireEvent.click(ownX(sheet));
    await screen.findByRole('dialog', { name: COPY.title });
    await letRadixSettle();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(prompt()).toBeNull());
    await letRadixSettle();
    expectSheetOpen(sheet);
    expect(draft().value).toBe('Hello');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('G-7: Discard closes once, and the draft is gone on reopen', async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    fireEvent.click(ownX(sheet));
    const p = await screen.findByRole('dialog', { name: COPY.title });
    fireEvent.click(within(p).getByRole('button', { name: COPY.discard }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());
    expect(prompt()).toBeNull();
    expect(onOpenChange.mock.calls.filter(([next]) => next === false)).toHaveLength(1);

    const again = await openDrawer();
    expect(draft().value).toBe('');
    expect(prompt()).toBeNull();
    // Clean, so the X closes at once.
    fireEvent.click(ownX(again));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());
    expect(prompt()).toBeNull();
  });

  it('G-12: Keep editing leaves focus inside the sheet; Discard puts it on the row (SA C-5)', async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    fireEvent.click(ownX(sheet));
    let p = await screen.findByRole('dialog', { name: COPY.title });
    // The safe choice is first, so the prompt opens on it.
    await waitFor(() => expect(document.activeElement).toBe(within(p).getByRole('button', { name: COPY.keep })));
    fireEvent.click(within(p).getByRole('button', { name: COPY.keep }));
    await waitFor(() => expect(prompt()).toBeNull());
    // Back on what had focus when the prompt opened (the X, focused on open),
    // not on the body: the prompt has no Radix trigger to return to.
    await waitFor(() => expect(document.activeElement).toBe(ownX(sheet)));

    fireEvent.click(ownX(sheet));
    p = await screen.findByRole('dialog', { name: COPY.title });
    fireEvent.click(within(p).getByRole('button', { name: COPY.discard }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());
    await letRadixSettle();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Opener' }));

    // A later prompt in the same visit must restore focus again: the Discard
    // above set `discarding`, and opening a new prompt has to clear it (QA N13).
    const again = await openDrawer();
    draft().focus();
    type('Again');
    fireEvent.keyDown(draft(), { key: 'Escape' });
    p = await screen.findByRole('dialog', { name: COPY.title });
    fireEvent.click(within(p).getByRole('button', { name: COPY.keep }));
    await waitFor(() => expect(prompt()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(draft()));
    expectSheetOpen(again);
  });

  it('G-12b: Escape from the field, then Keep editing, puts focus back in the field', async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    draft().focus();
    type('Hello');
    fireEvent.keyDown(draft(), { key: 'Escape' });
    const p = await screen.findByRole('dialog', { name: COPY.title });
    fireEvent.click(within(p).getByRole('button', { name: COPY.keep }));
    await waitFor(() => expect(prompt()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(draft()));
    expectSheetOpen(sheet);
  });

  it('G-13: in Hebrew the prompt reads right to left', async () => {
    render(<Harness isRTL />);
    const sheet = await openDrawer();
    type('שלום');
    fireEvent.click(ownX(sheet));
    const p = await screen.findByRole('dialog', { name: COPY.title });
    expect(p.getAttribute('dir')).toBe('rtl');
    expect(p.getAttribute('data-testid')).toBe('settings-drawer-discard');
  });
});

describe('clean, busy and unguarded', () => {
  it('G-8: clean, the X, Escape and an outside press each close at once with no prompt', async () => {
    render(<Harness />);
    let sheet = await openDrawer();
    fireEvent.click(ownX(sheet));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    sheet = await openDrawer();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());

    await openDrawer();
    await letRadixSettle();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());
    expect(onOpenChange.mock.calls.filter(([next]) => next === false)).toHaveLength(3);
    expect(screen.queryByTestId('settings-drawer-discard')).toBeNull();
  });

  it('G-9: a parent close while the prompt is up leaves no stale prompt on reopen', async () => {
    render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    fireEvent.click(ownX(sheet));
    await screen.findByRole('dialog', { name: COPY.title });
    act(() => forceClose());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());

    const again = await openDrawer();
    await letRadixSettle();
    expect(prompt()).toBeNull();
    fireEvent.click(ownX(again));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());
    expect(prompt()).toBeNull();
  });

  it('G-10: busy and dirty, the X (disabled), Escape and an outside press neither close nor prompt', async () => {
    const { rerender } = render(<Harness />);
    const sheet = await openDrawer();
    type('Hello');
    rerender(<Harness isBusy />);
    const x = ownX(sheet);
    expect(x.disabled).toBe(true);
    fireEvent.click(x);
    fireEvent.keyDown(draft(), { key: 'Escape' });
    await letRadixSettle();
    fireEvent.pointerDown(document.body);
    await letRadixSettle();
    expect(prompt()).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expectSheetOpen(sheet);
  });

  it('G-11: opening is never guarded', async () => {
    render(<Harness />);
    await openDrawer();
    expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy();
    expect(prompt()).toBeNull();
  });

  it('G-14: with no guard props it behaves as S-2: the X closes at once and no prompt exists', async () => {
    render(<Harness guarded={false} />);
    const sheet = await openDrawer();
    type('Hello');
    expect(screen.queryByTestId('settings-drawer-discard')).toBeNull();
    fireEvent.click(ownX(sheet));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(prompt()).toBeNull();
  });
});
