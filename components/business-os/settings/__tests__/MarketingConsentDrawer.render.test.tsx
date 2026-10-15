/**
 * @jest-environment jsdom
 */

/**
 * `MarketingConsentDrawer` (settings drawer review S-3, C-4, C-5, F-2, F-3;
 * S-3 workplan D-1 to D-14, D-7b; SA S-3 C-2, C-3, C-4).
 *
 * The harness plays the page: an opener row whose ref is the return target, and
 * an open state the drawer's `onOpenChange` drives. `fetch` is stubbed per
 * test, so a request can fail in each way it can fail, or be held in flight to
 * prove the drawer refuses to close. The logger records every call, so "no
 * form value is ever logged" is checked against what was actually logged.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO STAND-INS, AND WHY
 *
 * `SavedAddressPicker` is a button that calls `onSelect` with a fixed address.
 * It does NOT fill anything on mount, and neither does the real picker any
 * more: F-18 made the panel call it as a text form (`matchCurrent`), so it only
 * marks the entry the stored line already is and never writes on its own. The
 * real picker, with the panel and the drawer, is tested in
 * `MarketingConsentPanel.picker.render.test.tsx` (including K21: an untouched
 * open is clean). This file keeps the stub for the drawer's own behaviour.
 *
 * `@/components/ui/select` is a native `<select>`, because Radix's portalled
 * listbox cannot be driven in jsdom. Its layering over the drawer is a manual
 * check (QA K14); here only "changing the mode makes the form dirty" matters.
 * ─────────────────────────────────────────────────────────────────────────────
 */

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

const mockLogCalls: { level: string; args: unknown[] }[] = [];
jest.mock('@/lib/logger', () => {
  const at = (level: string) => (...args: unknown[]) => {
    mockLogCalls.push({ level, args });
  };
  const logger = {
    error: at('error'),
    warn: at('warn'),
    info: at('info'),
    debug: at('debug'),
    trace: at('trace'),
    fatal: at('fatal'),
  };
  return { ...jest.requireActual('@/lib/logger'), createLogger: () => ({ ...logger, child: () => logger }) };
});

// See the header: no fill on mount, as the real picker since F-18. The real one
// is tested in MarketingConsentPanel.picker.render.test.tsx.
jest.mock('@/components/ui/SavedAddressPicker', () => {
  const ReactInMock = jest.requireActual('react') as typeof React;
  return {
    SavedAddressPicker: ({ onSelect }: { onSelect: (address: Record<string, string>) => void }) =>
      ReactInMock.createElement(
        'button',
        { type: 'button', onClick: () => onSelect({ line1: '9 Picker Road', city: 'Haifa' }) },
        'Use saved address'
      ),
  };
});

jest.mock('@/components/ui/select', () => {
  const ReactInMock = jest.requireActual('react') as typeof React;
  type Kids = { children?: React.ReactNode };
  return {
    Select: ({ value, onValueChange, children }: Kids & { value: string; onValueChange: (v: string) => void }) =>
      ReactInMock.createElement(
        'select',
        { 'aria-label': 'Privacy notice mode', value, onChange: (e: { target: { value: string } }) => onValueChange(e.target.value) },
        children
      ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: Kids) => ReactInMock.createElement(ReactInMock.Fragment, null, children),
    SelectItem: ({ value, children }: Kids & { value: string }) => ReactInMock.createElement('option', { value }, children),
  };
});

import { MarketingConsentDrawer } from '@/components/business-os/settings/MarketingConsentDrawer';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const COPY = translations.en;
const DRAWER = 'settings-consent-drawer';
const URL_EN = '/api/business-os/consent-settings?locale=en';

const DEFAULTS = {
  statement_en: 'I agree to receive occasional offers by email.',
  statement_he: 'אני מסכים לקבל הצעות בדוא"ל.',
  statement_es: 'Acepto recibir ofertas por email.',
  privacy_policy_body: 'Default privacy notice body.',
  postal_address: '1 Main Street, Tel Aviv',
};

type StoredSettings = Record<string, unknown> | null;

function payload(settings: StoredSettings = null) {
  return {
    settings,
    defaults: DEFAULTS,
    counts: { mailable: 3, contacts: 10 },
    sending: { enabled: true, hasPostalAddress: true },
  };
}

/** What the panel seeds from `payload(null)` in English. */
const SEEDED = {
  capture_enabled: true,
  statement_en: DEFAULTS.statement_en,
  statement_he: null,
  statement_es: null,
  privacy_policy_mode: 'hosted',
  privacy_policy_url: null,
  privacy_policy_body: DEFAULTS.privacy_policy_body,
  postal_address: DEFAULTS.postal_address,
  label_as_advertisement: false,
};

const TYPED = 'Only the monthly newsletter, nothing else.';

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function respond(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function notJson(status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  };
}

const okLoad = (settings: StoredSettings = null) => respond({ success: true, data: payload(settings) });

type Step = FakeResponse | Error | Promise<FakeResponse>;

const mockFetch = jest.fn();

/** Answers each call in turn; an `Error` is thrown, as a network failure would be. */
function queue(...steps: Step[]) {
  for (const step of steps) {
    mockFetch.mockImplementationOnce(() => (step instanceof Error ? Promise.reject(step) : Promise.resolve(step)));
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Harness() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <MarketingConsentDrawer open={open} onOpenChange={setOpen} returnFocusRef={opener} />
    </>
  );
}

/** The drawer, by test id: while the modal prompt is up Radix hides it from role queries. */
function drawer(): HTMLElement {
  return screen.getByTestId(DRAWER);
}

async function openDrawer(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
  return screen.findByTestId(DRAWER);
}

/** Opens and waits for the form (the seeded statement) to show. */
async function openLoaded(): Promise<HTMLElement> {
  const sheet = await openDrawer();
  await within(sheet).findByDisplayValue(DEFAULTS.statement_en);
  return sheet;
}

function statement(): HTMLTextAreaElement {
  return within(drawer()).getAllByRole('textbox')[0] as HTMLTextAreaElement;
}

function saveButton(): HTMLButtonElement {
  return within(drawer()).getByRole('button', { name: COPY['common.save'] }) as HTMLButtonElement;
}

function ownX(): HTMLButtonElement {
  // jsdom also shows the sheet's built-in X (hidden by `[&>button]:hidden` in a
  // browser), so take the one in the header.
  const own = within(drawer())
    .getAllByRole('button', { name: COPY['common.close'] })
    .find((b) => !b.className.includes('absolute'));
  if (!own) throw new Error("The drawer's own X was not found");
  return own as HTMLButtonElement;
}

function prompt(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: COPY['settings.drawer.discard_title'] });
}

async function expectClosesAtOnce() {
  fireEvent.click(ownX());
  await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());
  expect(prompt()).toBeNull();
}

async function expectPrompts() {
  fireEvent.click(ownX());
  expect(await screen.findByRole('dialog', { name: COPY['settings.drawer.discard_title'] })).toBeTruthy();
  expect(screen.getByTestId(DRAWER)).toBeTruthy();
}

function putBody(callIndex: number): Record<string, unknown> {
  const [, init] = mockFetch.mock.calls[callIndex] as [string, { method?: string; body?: string }];
  expect(init?.method).toBe('PUT');
  return JSON.parse(init.body as string);
}

function logsOf(level: string) {
  return mockLogCalls.filter((call) => call.level === level);
}

/** Everything that was logged, as text, so a leaked value can be searched for. */
function loggedText(): string {
  return mockLogCalls
    .map(({ args }) =>
      args
        .map((arg) => {
          if (arg && typeof arg === 'object') {
            const err = (arg as { err?: unknown }).err;
            const errText = err instanceof Error ? `${err.message} ${err.stack ?? ''}` : '';
            return `${JSON.stringify(arg)} ${errText}`;
          }
          return String(arg);
        })
        .join(' ')
    )
    .join('\n');
}

/** Radix registers its outside-pointer listener on a timer after mount; wait it out. */
async function letRadixSettle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => {
  mockLang.language = 'en';
  mockFetch.mockReset();
  mockLogCalls.length = 0;
});

describe('opening and closing untouched', () => {
  it('D-1: one GET with the locale; the count and the seeded wording show; Save sits in the fixed bar', async () => {
    queue(okLoad());
    render(<Harness />);
    const sheet = await openLoaded();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(URL_EN);
    expect(within(sheet).getByText('3 of your 10 contacts can receive marketing email.')).toBeTruthy();
    const save = saveButton();
    const body = sheet.querySelector('.overflow-y-auto') as HTMLElement;
    expect(body).toBeTruthy();
    expect(body.contains(save)).toBe(false);
    expect(sheet.contains(save)).toBe(true);
    expect(body.contains(statement())).toBe(true);
  });

  it('D-2: the seeded, untouched form is clean, so the X closes at once', async () => {
    queue(okLoad());
    render(<Harness />);
    await openLoaded();
    await expectClosesAtOnce();
  });

  it('D-5: typing a character and deleting it again is clean', async () => {
    queue(okLoad());
    render(<Harness />);
    await openLoaded();
    fireEvent.change(statement(), { target: { value: `${DEFAULTS.statement_en}x` } });
    fireEvent.change(statement(), { target: { value: DEFAULTS.statement_en } });
    await expectClosesAtOnce();
  });

  it("C-4: a field stored as '' that is typed into and cleared again is clean", async () => {
    queue(okLoad({ postal_address: '' }));
    render(<Harness />);
    await openLoaded();
    const postal = within(drawer()).getByPlaceholderText(DEFAULTS.postal_address) as HTMLTextAreaElement;
    expect(postal.value).toBe('');
    fireEvent.change(postal, { target: { value: 'a' } });
    // Every handler writes `value || null`, so the field is now null, not ''.
    fireEvent.change(postal, { target: { value: '' } });
    await expectClosesAtOnce();
  });
});

describe('unsaved edits ask before closing (C-5, F-3)', () => {
  it('D-3: an edit then X prompts; Discard closes, and reopening loads fresh with the edit gone', async () => {
    queue(okLoad(), okLoad());
    render(<Harness />);
    await openLoaded();
    fireEvent.change(statement(), { target: { value: TYPED } });
    await expectPrompts();
    fireEvent.click(within(prompt() as HTMLElement).getByRole('button', { name: COPY['settings.drawer.discard'] }));
    await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());

    await openLoaded();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe(URL_EN);
    expect(statement().value).toBe(DEFAULTS.statement_en);
    expect(within(drawer()).queryByDisplayValue(TYPED)).toBeNull();
  });

  it('D-14: after a Discard the reopened drawer is clean, so the X closes at once', async () => {
    queue(okLoad(), okLoad());
    render(<Harness />);
    await openLoaded();
    fireEvent.change(statement(), { target: { value: TYPED } });
    await expectPrompts();
    fireEvent.click(within(prompt() as HTMLElement).getByRole('button', { name: COPY['settings.drawer.discard'] }));
    await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());
    // Straight away, before the new panel has reported in.
    fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
    await screen.findByTestId(DRAWER);
    await expectClosesAtOnce();
  });

  it('D-4: Keep editing keeps the edit, and Save sends it', async () => {
    queue(okLoad(), respond({ success: true }), okLoad({ ...SEEDED, statement_en: TYPED }));
    render(<Harness />);
    await openLoaded();
    fireEvent.change(statement(), { target: { value: TYPED } });
    await expectPrompts();
    fireEvent.click(within(prompt() as HTMLElement).getByRole('button', { name: COPY['settings.drawer.keep_editing'] }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(statement().value).toBe(TYPED);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    expect(putBody(1).statement_en).toBe(TYPED);
  });

  it.each([
    ['the capture switch', () => fireEvent.click(within(drawer()).getAllByRole('switch')[0])],
    ['the privacy notice mode', () => fireEvent.change(within(drawer()).getByLabelText('Privacy notice mode'), { target: { value: 'url' } })],
    ['the postal address, through the picker', () => fireEvent.click(within(drawer()).getByRole('button', { name: 'Use saved address' }))],
    ['the advertising label switch', () => fireEvent.click(within(drawer()).getAllByRole('switch')[1])],
  ])('D-6: an edit to %s makes it dirty', async (_what, edit) => {
    queue(okLoad());
    render(<Harness />);
    await openLoaded();
    edit();
    await expectPrompts();
  });
});

describe('saving (F-2)', () => {
  it('D-7: success sends the edited form, says Saved in the bar, reloads, and closes clean; the next edit hides Saved', async () => {
    const edited = { ...SEEDED, statement_en: TYPED };
    queue(okLoad(), respond({ success: true }), okLoad(edited));
    render(<Harness />);
    await openLoaded();
    fireEvent.change(statement(), { target: { value: TYPED } });
    fireEvent.click(saveButton());

    const status = await within(drawer()).findByRole('status');
    expect(status.textContent).toContain(COPY['consent.saved']);
    expect(putBody(1)).toEqual(edited);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    expect(mockFetch.mock.calls[2][0]).toBe(URL_EN);
    // In the fixed bar, not in the scroll body.
    const body = drawer().querySelector('.overflow-y-auto') as HTMLElement;
    expect(body.contains(status)).toBe(false);
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    fireEvent.change(statement(), { target: { value: `${TYPED}!` } });
    expect(within(drawer()).queryByRole('status')).toBeNull();
    fireEvent.change(statement(), { target: { value: TYPED } });
    await expectClosesAtOnce();
  });

  it.each([
    ['a 500', () => respond({ success: false, error: 'Internal server error' }, 500)],
    ['a thrown request', () => new Error('network down')],
  ])('D-7b: the save succeeds and the reload fails (%s): the form stays, Saved shows, and it closes clean', async (_kind, reload) => {
    queue(okLoad(), respond({ success: true }), reload());
    render(<Harness />);
    await openLoaded();
    fireEvent.change(statement(), { target: { value: TYPED } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(within(drawer()).getByRole('status').textContent).toContain(COPY['consent.saved']);
    expect(within(drawer()).queryByText(COPY['consent.load_failed'])).toBeNull();
    expect(statement().value).toBe(TYPED);
    expect(loggedText()).not.toContain(TYPED);
    await expectClosesAtOnce();
  });

  it.each([
    [400, { success: false, error: 'Invalid settings' }],
    [500, { success: false, error: 'Internal server error' }],
  ])('D-8: a refused save (%i) says so in the bar, keeps the edit, still prompts, and warns with the status only', async (status, body) => {
    queue(okLoad(), respond(body, status));
    render(<Harness />);
    await openLoaded();
    fireEvent.change(statement(), { target: { value: TYPED } });
    fireEvent.click(saveButton());

    const alert = await within(drawer()).findByRole('alert');
    expect(alert.textContent).toContain(COPY['consent.save_failed']);
    expect(alert.textContent).not.toContain(body.error);
    const scrollBody = drawer().querySelector('.overflow-y-auto') as HTMLElement;
    expect(scrollBody.contains(alert)).toBe(false);
    expect(statement().value).toBe(TYPED);
    expect(logsOf('warn')).toEqual([{ level: 'warn', args: [{ status }, 'Consent settings save refused'] }]);
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    await expectPrompts();
  });

  it('D-8: a 200 that says success: false is refused the same way', async () => {
    queue(okLoad(), respond({ success: false }));
    render(<Harness />);
    await openLoaded();
    fireEvent.change(statement(), { target: { value: TYPED } });
    fireEvent.click(saveButton());
    expect((await within(drawer()).findByRole('alert')).textContent).toContain(COPY['consent.save_failed']);
    expect(statement().value).toBe(TYPED);
  });

  it.each([
    ['a network error', () => new Error('network down')],
    ['a body that is not JSON', () => notJson(200)],
  ])('D-9: a save that throws (%s) says so, keeps the edit, still prompts, logs { err } only, and logs no form value', async (_kind, failure) => {
    queue(okLoad(), failure());
    render(<Harness />);
    await openLoaded();
    const postal = within(drawer()).getByDisplayValue(DEFAULTS.postal_address);
    fireEvent.change(postal, { target: { value: '77 Secret Lane, Eilat' } });
    fireEvent.change(statement(), { target: { value: TYPED } });
    fireEvent.click(saveButton());

    expect((await within(drawer()).findByRole('alert')).textContent).toContain(COPY['consent.save_failed']);
    expect(statement().value).toBe(TYPED);
    const errors = logsOf('error');
    expect(errors).toHaveLength(1);
    expect(Object.keys(errors[0].args[0] as object)).toEqual(['err']);
    const text = loggedText();
    for (const value of [TYPED, '77 Secret Lane', DEFAULTS.privacy_policy_body, DEFAULTS.statement_en]) {
      expect({ value, logged: text.includes(value) }).toEqual({ value, logged: false });
    }
    // A thrown save must not mark the form clean, or close would drop the edits
    // without asking (QA N9).
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    await expectPrompts();
  });

  it('D-10: while the save is in flight, Save and the X are disabled and nothing closes or prompts; afterwards it can close', async () => {
    const put = deferred<FakeResponse>();
    queue(okLoad(), put.promise, okLoad({ ...SEEDED, statement_en: TYPED }));
    render(<Harness />);
    await openLoaded();
    fireEvent.change(statement(), { target: { value: TYPED } });
    // Held: while saving the button shows only a spinner, so it has no name to
    // find it by again.
    const save = saveButton();
    fireEvent.click(save);

    await waitFor(() => expect(save.disabled).toBe(true));
    await waitFor(() => expect(ownX().disabled).toBe(true));
    fireEvent.click(ownX());
    fireEvent.keyDown(statement(), { key: 'Escape' });
    await letRadixSettle();
    fireEvent.pointerDown(document.body);
    await letRadixSettle();
    expect(prompt()).toBeNull();
    expect(screen.getByTestId(DRAWER)).toBeTruthy();

    await act(async () => {
      put.resolve(respond({ success: true }));
    });
    await waitFor(() => expect(ownX().disabled).toBe(false));
    await expectClosesAtOnce();
  });

  it('D-11: Save is enabled on the clean, seeded form, and sends the seeded wording', async () => {
    queue(okLoad(), respond({ success: true }), okLoad(SEEDED));
    render(<Harness />);
    await openLoaded();
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(putBody(1)).toEqual(SEEDED);
  });
});

describe('a failed first load (F-17, SA C-2)', () => {
  it.each([
    ['a thrown request', () => new Error('network down'), 'error'],
    ['a 500', () => respond({ success: false, error: 'Internal server error' }, 500), 'warn'],
    ['a 200 with success: false', () => respond({ success: false }), 'warn'],
    // A full payload must not rescue a response that says it failed (QA N11).
    ['a 200 with success: false and a full payload', () => respond({ success: false, data: payload() }), 'warn'],
    ['a body that is not JSON', () => notJson(200), 'error'],
    ['a payload with no defaults', () => respond({ success: true, data: { settings: null, counts: { mailable: 0, contacts: 0 } } }), 'warn'],
  ])('D-12: %s shows the alert and Try again, with no form and no Save; the X closes at once', async (_kind, failure, level) => {
    queue(failure());
    render(<Harness />);
    const sheet = await openDrawer();
    const alert = await within(sheet).findByRole('alert');
    expect(alert.textContent).toContain(COPY['consent.load_failed']);
    expect(within(sheet).getByRole('button', { name: COPY['common.try_again'] })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: COPY['common.save'] })).toBeNull();
    expect(within(sheet).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(sheet).queryAllByRole('switch')).toHaveLength(0);
    expect(logsOf(level)).toHaveLength(1);
    if (level === 'warn') expect(Object.keys(logsOf('warn')[0].args[0] as object)).toEqual(['status']);
    if (level === 'error') expect(Object.keys(logsOf('error')[0].args[0] as object)).toEqual(['err']);
    await expectClosesAtOnce();
  });

  it('D-12: Try again refetches once (a double press does not double-fire) and then shows the form', async () => {
    const retry = deferred<FakeResponse>();
    // A third answer, so a double-fire would show up as a third fetch rather
    // than as an unanswered call.
    queue(respond({ success: false }, 500), retry.promise, okLoad());
    render(<Harness />);
    const sheet = await openDrawer();
    const again = await within(sheet).findByRole('button', { name: COPY['common.try_again'] });
    // Both presses inside one act, so React cannot re-render between them: the
    // button is still mounted for the second press, and only the in-flight
    // guard stops a second fetch (QA N4). Two separate fireEvent calls would let
    // the first unmount the button and make the second press a no-op.
    act(() => {
      again.click();
      again.click();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      retry.resolve(okLoad());
    });
    await within(sheet).findByDisplayValue(DEFAULTS.statement_en);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(within(sheet).queryByText(COPY['consent.load_failed'])).toBeNull();
    expect(saveButton()).toBeTruthy();
  });

  it('D-12: a failed load is clean, so the X closes at once', async () => {
    queue(new Error('network down'));
    render(<Harness />);
    const sheet = await openDrawer();
    await within(sheet).findByRole('alert');
    await expectClosesAtOnce();
  });
});

describe('Hebrew (C-5 last bullet, §4.3)', () => {
  it('D-13: both switches sit in a dir="ltr" wrapper; the drawer is rtl on the left', async () => {
    mockLang.language = 'he';
    queue(okLoad());
    render(<Harness />);
    const sheet = await openDrawer();
    await within(sheet).findByDisplayValue(DEFAULTS.statement_he);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/business-os/consent-settings?locale=he');
    expect(sheet.getAttribute('dir')).toBe('rtl');
    expect(sheet.getAttribute('data-side')).toBe('left');
    const switches = within(sheet).getAllByRole('switch');
    expect(switches).toHaveLength(2);
    for (const control of switches) {
      expect(control.parentElement?.getAttribute('dir')).toBe('ltr');
    }
  });
});
