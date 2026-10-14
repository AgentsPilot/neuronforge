/**
 * @jest-environment jsdom
 */

/**
 * LF-7: the shared admin confirmation dialog's own contract (AC-1 to AC-14;
 * AC-2 dropped with the description prop, SA C-3; AC-8 dropped at build: a
 * rejecting onConfirm surfaces as an unhandled rejection, as in the LF-3b
 * dialog, which Jest reports as a failure, so the contract is "must not
 * reject"). The page-level pin suites of Messages and Invites prove the two
 * migrations; this suite pins the component so a later adopter cannot quietly
 * change it.
 *
 * Keyboard and Cancel clicks go through user-event (SA C-4): a `fireEvent`
 * Enter on a button does nothing in jsdom and would pass with focus on the
 * confirm button.
 */

import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AdminConfirmDialog, ADMIN_CONFIRM_TONE_CLASS, type AdminConfirmTone } from '../AdminConfirmDialog';
import { ADMIN_DIALOG_CLASS } from '../adminDialog';

const TITLE = 'Do the thing?';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface HarnessProps {
  onConfirm: () => Promise<boolean | void>;
  tone?: AdminConfirmTone;
  cancelLabel?: string;
  canConfirm?: boolean;
  withField?: boolean;
  onClose?: () => void;
  onReturnFocus?: () => void;
}

/** A page: an opener button, the dialog, and focus return to the opener. */
function Harness({ onConfirm, tone, cancelLabel, canConfirm, withField = false, onClose, onReturnFocus }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  return (
    <div>
      <button ref={openerRef} type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <AdminConfirmDialog
        open={open}
        title={TITLE}
        cancelLabel={cancelLabel}
        confirmLabel="Go"
        tone={tone}
        testId="confirm-under-test"
        initialFocusRef={withField ? fieldRef : undefined}
        canConfirm={canConfirm}
        onConfirm={onConfirm}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        onReturnFocus={() => {
          onReturnFocus?.();
          openerRef.current?.focus();
        }}
      >
        {withField && (
          <>
            <label htmlFor="extra-field">Reason</label>
            <input id="extra-field" ref={fieldRef} type="text" />
          </>
        )}
      </AdminConfirmDialog>
    </div>
  );
}

const opener = () => screen.getByRole('button', { name: 'Open' });
const dialog = () => screen.getByRole('dialog', { name: TITLE });
const buttonIn = (name: string) => within(dialog()).getByRole('button', { name }) as HTMLButtonElement;
const formIn = () => dialog().querySelector('form') as HTMLFormElement;

async function openIt(user: ReturnType<typeof userEvent.setup>) {
  await user.click(opener());
  return screen.findByRole('dialog', { name: TITLE });
}

describe('AdminConfirmDialog', () => {
  it('AC-1: title, default Cancel, confirm words, test id, admin dialog class, no aria-describedby', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={jest.fn(async () => undefined)} />);
    const shown = await openIt(user);
    expect(shown).toBe(screen.getByTestId('confirm-under-test'));
    for (const cls of ADMIN_DIALOG_CLASS.split(' ')) expect(shown.className).toContain(cls);
    expect(shown.hasAttribute('aria-describedby')).toBe(false);
    expect(within(shown).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Go', 'Close']);
  });

  it('AC-1: cancelLabel replaces the default words', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={jest.fn(async () => undefined)} cancelLabel="Keep it" />);
    await openIt(user);
    expect(buttonIn('Keep it').textContent).toBe('Keep it');
  });

  it('AC-3: focus starts on Cancel, and Enter on open sends nothing and closes', async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn(async () => undefined);
    render(<Harness onConfirm={onConfirm} />);
    await openIt(user);
    expect(document.activeElement).toBe(buttonIn('Cancel'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('AC-4: initialFocusRef takes focus on open', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={jest.fn(async () => undefined)} withField />);
    await openIt(user);
    expect(document.activeElement).toBe(within(dialog()).getByLabelText('Reason'));
  });

  it('AC-5: a double click sends once', async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const onConfirm = jest.fn(() => pending.promise);
    render(<Harness onConfirm={onConfirm} />);
    await openIt(user);
    const go = buttonIn('Go');
    act(() => {
      fireEvent.click(go);
      fireEvent.click(go);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
  });

  it('AC-5: two same-tick submits send once', async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const onConfirm = jest.fn(() => pending.promise);
    render(<Harness onConfirm={onConfirm} />);
    await openIt(user);
    const form = formIn();
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
  });

  it('AC-6: in flight, Escape, an outside click and X do nothing; both buttons disabled; busy and spinner shown', async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const onClose = jest.fn();
    render(<Harness onConfirm={() => pending.promise} onClose={onClose} />);
    const shown = await openIt(user);
    await act(async () => {
      fireEvent.click(buttonIn('Go'));
    });
    expect(buttonIn('Cancel').disabled).toBe(true);
    expect(buttonIn('Go').disabled).toBe(true);
    expect(shown.getAttribute('aria-busy')).toBe('true');
    expect(buttonIn('Go').getAttribute('aria-busy')).toBe('true');
    expect(buttonIn('Go').querySelector('svg.animate-spin')).not.toBeNull();
    fireEvent.keyDown(shown, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    fireEvent.click(buttonIn('Close'));
    fireEvent.click(buttonIn('Cancel'));
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBe(shown);
    await act(async () => pending.resolve());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('AC-7: a void result closes through onClose once', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<Harness onConfirm={async () => undefined} onClose={onClose} />);
    await openIt(user);
    await user.click(buttonIn('Go'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('AC-7: false does not call onClose, and the dialog is usable again', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    const onConfirm = jest.fn(async () => false);
    render(<Harness onConfirm={onConfirm} onClose={onClose} />);
    await openIt(user);
    await user.click(buttonIn('Go'));
    await waitFor(() => expect(buttonIn('Go').disabled).toBe(false));
    expect(onClose).not.toHaveBeenCalled();
    expect(buttonIn('Go').getAttribute('aria-busy')).toBe('false');
    expect(buttonIn('Go').querySelector('svg')).toBeNull();
    await user.click(buttonIn('Go'));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('AC-9: canConfirm false disables the confirm and a submit sends nothing', async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn(async () => undefined);
    render(<Harness onConfirm={onConfirm} canConfirm={false} withField />);
    await openIt(user);
    expect(buttonIn('Go').disabled).toBe(true);
    await user.keyboard('{Enter}');
    fireEvent.submit(formIn());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: TITLE })).not.toBeNull();
  });

  it.each(['Cancel', 'Escape', 'Close'])('AC-10: %s calls onClose and sends nothing', async (how) => {
    const user = userEvent.setup();
    const onConfirm = jest.fn(async () => undefined);
    const onClose = jest.fn();
    render(<Harness onConfirm={onConfirm} onClose={onClose} />);
    await openIt(user);
    if (how === 'Escape') await user.keyboard('{Escape}');
    else await user.click(buttonIn(how));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('AC-11: after closing, onReturnFocus runs and focus is on the opener, not body', async () => {
    const user = userEvent.setup();
    const onReturnFocus = jest.fn();
    render(<Harness onConfirm={async () => undefined} onReturnFocus={onReturnFocus} />);
    await openIt(user);
    await user.click(buttonIn('Go'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener());
    expect(document.activeElement).not.toBe(document.body);
  });

  it.each(['danger', 'primary'] as const)('AC-12: tone %s gives its class', async (tone) => {
    const user = userEvent.setup();
    render(<Harness onConfirm={async () => undefined} tone={tone} />);
    await openIt(user);
    expect(buttonIn('Go').className).toBe(ADMIN_CONFIRM_TONE_CLASS[tone]);
  });

  it('AC-12: the two tones differ, and the default is primary', async () => {
    expect(ADMIN_CONFIRM_TONE_CLASS.danger).toContain('bg-rose-700');
    expect(ADMIN_CONFIRM_TONE_CLASS.primary).toContain('bg-sky-600');
    const user = userEvent.setup();
    render(<Harness onConfirm={async () => undefined} />);
    await openIt(user);
    expect(buttonIn('Go').className).toBe(ADMIN_CONFIRM_TONE_CLASS.primary);
  });

  it('AC-13: after a settled confirm, a reopen can send again', async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn(async () => undefined);
    render(<Harness onConfirm={onConfirm} />);
    await openIt(user);
    await user.click(buttonIn('Go'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openIt(user);
    await user.click(buttonIn('Go'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('AC-14: children render inside the form, before the buttons; Enter in a field confirms', async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn(async () => undefined);
    render(<Harness onConfirm={onConfirm} withField />);
    await openIt(user);
    const field = within(dialog()).getByLabelText('Reason');
    const form = formIn();
    expect(form.contains(field)).toBe(true);
    expect(field.compareDocumentPosition(buttonIn('Go')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
