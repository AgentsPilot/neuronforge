/**
 * @jest-environment jsdom
 */

/**
 * `ChangePasswordDrawer` (settings drawer review S-2, C-4, C-7; S-2 workplan).
 *
 * The harness plays the page: an opener row whose ref is the return target, and
 * an open state the drawer's `onOpenChange` drives. `changePassword` is a
 * stand-in, so a request can be held in flight to prove the drawer refuses to
 * close, and the logger records every call so "no password is ever logged" is
 * checked against what was actually logged.
 */

import fs from 'fs';
import path from 'path';
import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      isRTL: mockLang.language === 'he',
      t: (key: string, vars?: Record<string, string | number>) => {
        let text: string = translations[mockLang.language][key] || key;
        for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        return text;
      },
    }),
  };
});
// The dictionary module creates a browser Supabase client at import; only its
// `translations` are used here.
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

const mockChangePassword = jest.fn();
jest.mock('@/lib/client/change-password', () => ({
  changePassword: (...args: unknown[]) => mockChangePassword(...args),
}));

const mockLogCalls: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const record = (...args: unknown[]) => {
    mockLogCalls.push(args);
  };
  const logger = { error: record, warn: record, info: record, debug: record, trace: record, fatal: record };
  // Everything else in the module (the shared client logger the dictionary uses)
  // stays real; only the loggers created by `createLogger` record.
  return { ...jest.requireActual('@/lib/logger'), createLogger: () => ({ ...logger, child: () => logger }) };
});

import { ChangePasswordDrawer } from '@/components/business-os/settings/ChangePasswordDrawer';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;

const CURRENT = 'old-secret-111';
const NEXT = 'new-secret-2222';

function Harness() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <ChangePasswordDrawer open={open} onOpenChange={setOpen} returnFocusRef={opener} />
    </>
  );
}

async function openDrawer(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
  return screen.findByRole('dialog');
}

function fields(dialog: HTMLElement) {
  return {
    current: within(dialog).getByLabelText(COPY['settings.security.current_password']) as HTMLInputElement,
    next: within(dialog).getByLabelText(COPY['settings.security.new_password']) as HTMLInputElement,
    confirm: within(dialog).getByLabelText(COPY['settings.security.confirm_password']) as HTMLInputElement,
  };
}

function fill(dialog: HTMLElement, current: string, next: string, confirm: string) {
  const f = fields(dialog);
  fireEvent.change(f.current, { target: { value: current } });
  fireEvent.change(f.next, { target: { value: next } });
  fireEvent.change(f.confirm, { target: { value: confirm } });
}

function submit(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: COPY['settings.security.update_password'] }));
}

function closeButton(dialog: HTMLElement): HTMLButtonElement {
  // The drawer's own X. jsdom also shows the sheet's built-in one (hidden by
  // `[&>button]:hidden` in a browser), so take the one inside the header.
  const buttons = within(dialog).getAllByRole('button', { name: COPY['common.close'] });
  const own = buttons.find((b) => !b.className.includes('absolute'));
  if (!own) throw new Error("The drawer's own X was not found");
  return own as HTMLButtonElement;
}

beforeEach(() => {
  mockLang.language = 'en';
  mockChangePassword.mockReset();
  mockLogCalls.length = 0;
});

describe('opening', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens with the title as its name and three empty fields', async () => {
    render(<Harness />);
    const dialog = await openDrawer();
    expect(screen.getByRole('dialog', { name: COPY['settings.security.change_password'] })).toBe(dialog);
    const f = fields(dialog);
    expect(f.current.value).toBe('');
    expect(f.next.value).toBe('');
    expect(f.confirm.value).toBe('');
    expect(f.current.type).toBe('password');
    expect(f.current.autocomplete).toBe('current-password');
    expect(f.next.autocomplete).toBe('new-password');
  });
});

describe('closing clears the form (C-7)', () => {
  it('typed values and "show" are gone after close and reopen', async () => {
    render(<Harness />);
    let dialog = await openDrawer();
    fill(dialog, CURRENT, NEXT, NEXT);
    fireEvent.click(within(dialog).getByRole('button', { name: COPY['common.show'] }));
    expect(fields(dialog).current.type).toBe('text');

    fireEvent.click(closeButton(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Nothing typed is left anywhere in the document.
    expect(document.body.innerHTML).not.toContain(CURRENT);

    dialog = await openDrawer();
    const f = fields(dialog);
    expect(f.current.value).toBe('');
    expect(f.next.value).toBe('');
    expect(f.confirm.value).toBe('');
    expect(f.current.type).toBe('password');
  });

  it('a message from the last visit is gone too', async () => {
    render(<Harness />);
    let dialog = await openDrawer();
    submit(dialog);
    expect(within(dialog).getByRole('alert').textContent).toContain(COPY['settings.security.password_required']);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await openDrawer();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('focus returns to the opener on close', async () => {
    render(<Harness />);
    const dialog = await openDrawer();
    fireEvent.click(closeButton(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Opener' }));
  });
});

describe('validation, inside the drawer, before any request', () => {
  it.each([
    ['empty', '', '', '', 'settings.security.password_required'],
    ['mismatch', CURRENT, NEXT, 'something-else', 'settings.security.password_mismatch'],
    ['short', CURRENT, 'short', 'short', 'settings.security.password_short'],
  ])('%s', async (_name, current, next, confirm, key) => {
    render(<Harness />);
    const dialog = await openDrawer();
    fill(dialog, current, next, confirm);
    submit(dialog);
    expect(within(dialog).getByRole('alert').textContent).toContain(COPY[key]);
    expect(mockChangePassword).not.toHaveBeenCalled();
  });
});

describe('the change', () => {
  it('goes through changePassword with the current and new password', async () => {
    mockChangePassword.mockResolvedValue({ success: true });
    render(<Harness />);
    const dialog = await openDrawer();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    await waitFor(() => expect(mockChangePassword).toHaveBeenCalledWith(CURRENT, NEXT));
  });

  it('Enter in a field submits', async () => {
    mockChangePassword.mockResolvedValue({ success: true });
    render(<Harness />);
    const dialog = await openDrawer();
    fill(dialog, CURRENT, NEXT, NEXT);
    fireEvent.submit(fields(dialog).confirm.form as HTMLFormElement);
    await waitFor(() => expect(mockChangePassword).toHaveBeenCalledTimes(1));
  });

  it('success: the message shows inside the drawer and the fields are cleared', async () => {
    mockChangePassword.mockResolvedValue({ success: true });
    render(<Harness />);
    const dialog = await openDrawer();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    expect((await within(dialog).findByRole('status')).textContent).toContain(COPY['settings.security.password_updated']);
    const f = fields(dialog);
    expect(f.current.value).toBe('');
    expect(f.next.value).toBe('');
    expect(f.confirm.value).toBe('');
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it("a refusal shows the server's message inside the drawer and keeps the fields", async () => {
    mockChangePassword.mockResolvedValue({
      success: false,
      code: 'invalid_current_password',
      error: 'Your current password is not right.',
    });
    render(<Harness />);
    const dialog = await openDrawer();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Your current password is not right.');
    expect(fields(dialog).current.value).toBe(CURRENT);
  });

  it('a refusal without a message falls back to the generic one', async () => {
    mockChangePassword.mockResolvedValue({ success: false });
    render(<Harness />);
    const dialog = await openDrawer();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toContain(COPY['settings.security.password_error']);
  });

  it('a thrown error is logged with no password in any logged argument', async () => {
    mockChangePassword.mockRejectedValue(new Error('network down'));
    render(<Harness />);
    const dialog = await openDrawer();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toContain(COPY['settings.security.password_error']);
    expect(mockLogCalls.length).toBeGreaterThan(0);
    const logged = JSON.stringify(mockLogCalls, (_k, v) => (v instanceof Error ? { message: v.message } : v));
    expect(logged).not.toContain(CURRENT);
    expect(logged).not.toContain(NEXT);
  });
});

describe('busy: the drawer refuses to close while the change is in flight (C-4)', () => {
  it('submit and X are disabled, Escape and X do not close; after the answer it closes', async () => {
    let settle: (value: { success: boolean }) => void = () => undefined;
    mockChangePassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        })
    );
    render(<Harness />);
    const dialog = await openDrawer();
    fill(dialog, CURRENT, NEXT, NEXT);
    submit(dialog);
    await waitFor(() => expect(mockChangePassword).toHaveBeenCalledTimes(1));

    const x = closeButton(dialog);
    expect(x.disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: COPY['settings.security.update_password'] }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(x);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    // A second submit while busy sends nothing.
    fireEvent.submit(fields(dialog).confirm.form as HTMLFormElement);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(mockChangePassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle({ success: true });
    });
    await waitFor(() => expect(closeButton(dialog).disabled).toBe(false));
    fireEvent.click(closeButton(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Hebrew', () => {
  it('opens right-to-left with the Hebrew title', async () => {
    mockLang.language = 'he';
    render(<Harness />);
    const dialog = await openDrawer();
    expect(dialog.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('dialog', { name: translations.he['settings.security.change_password'] })).toBe(dialog);
  });
});

describe('source', () => {
  const source = fs
    .readFileSync(path.join(process.cwd(), 'components/business-os/settings/ChangePasswordDrawer.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('logs through Pino only, and never a field', () => {
    expect(source).not.toContain('console.');
    const logCalls = source.match(/logger\.\w+\([^;]*\);/g) ?? [];
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      expect(call).not.toMatch(/passwordForm|current|confirm|\.new\b/);
    }
  });

  it('changes the password through the API client, never the browser auth client', () => {
    expect(source).toContain("from '@/lib/client/change-password'");
    expect(source).not.toContain('updateUser');
    expect(source).not.toContain('supabaseClient');
  });

  it('keeps nothing in the address or storage', () => {
    expect(source).not.toMatch(/localStorage|sessionStorage|router\.|window\.history/);
  });

  it('does not keep the form mounted while closed', () => {
    expect(source).not.toContain('forceMount');
  });
});
