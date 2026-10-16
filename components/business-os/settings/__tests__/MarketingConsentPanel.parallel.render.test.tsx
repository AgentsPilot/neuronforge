/**
 * @jest-environment jsdom
 */

/**
 * Marketing permission opens with both reads at once (settings drawer review
 * §0.6 C-3 / C-4 / C-5; C-a workplan T-M1..T-M12; SA-CA-1, -2, -9, -13).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * - The book and consent are BOTH requested before either answers (no
 *   waterfall), once each per open, StrictMode included.
 * - The form shows when consent is in; the picker's place is held by a
 *   placeholder until the book is in.
 * - Reads handed over by the page (`takePrefetched`) are used instead of new
 *   requests, but anything unusable in them is read once more, fresh, and is
 *   never shown. F-18 (mark, never fill), the user's empty-postal decision,
 *   S-3's clean untouched open and F-17's failed-load screen all hold with
 *   preloaded data.
 *
 * The REAL picker (G-4's rule for the real-picker suite applies in spirit).
 * `fetch` is routed by URL and method, with deferred replies, so every
 * assertion is about which requests exist and in what order they started, and
 * never about how long anything took.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { KnownAddress } from '@/components/ui/SavedAddressPicker';
import type { AddressBookRead } from '@/components/ui/addressBookRead';
import type { ConsentRead, MarketingDrawerReads } from '@/components/business-os/settings/marketingDrawerReads';
import { formatAddressOneLine, type StructuredAddress } from '@/lib/geo/address';

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

import { MarketingConsentPanel } from '@/components/business-os/settings/MarketingConsentPanel';
import { MarketingConsentDrawer } from '@/components/business-os/settings/MarketingConsentDrawer';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const copy = () => translations[mockLang.language];

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VENUS: StructuredAddress = { line1: '14 Venus Drive', line2: '', city: 'Closter', state: 'NJ', postal_code: '07624', country: 'US' };
const TLV: StructuredAddress = { line1: '1 Rothschild Blvd', line2: '', city: 'Tel Aviv', state: '', postal_code: '6688101', country: 'IL' };

const oneLine = (parts: StructuredAddress, locale: Lang) => formatAddressOneLine(parts, locale) as string;

/** The book's default (Y) and another entry (Z), labelled for `locale`. */
function bookFor(locale: Lang): KnownAddress[] {
  return [
    { id: 'addr-venus', label: oneLine(VENUS, locale), name: null, address: VENUS, isDefault: true, usedBy: ['profile'] },
    { id: 'addr-tlv', label: oneLine(TLV, locale), name: null, address: TLV, isDefault: false, usedBy: [] },
  ];
}

const X = 'PO Box 77, Haifa 3100001, Israel';
const X_EDITED = 'PO Box 78, Haifa 3100001, Israel';

const DEFAULTS = {
  statement_en: 'I agree to receive occasional offers by email.',
  statement_he: 'אני מסכים לקבל הצעות בדוא"ל.',
  statement_es: 'Acepto recibir ofertas por email.',
  privacy_policy_body: 'Default privacy notice body.',
  postal_address: '',
};

function stored(postal: string | null) {
  return {
    capture_enabled: true,
    statement_en: DEFAULTS.statement_en,
    statement_he: null,
    statement_es: null,
    privacy_policy_mode: 'hosted',
    privacy_policy_url: null,
    privacy_policy_body: DEFAULTS.privacy_policy_body,
    postal_address: postal,
    label_as_advertisement: false,
  };
}

const consentBody = (postal: string | null) => ({
  success: true,
  data: {
    settings: stored(postal),
    defaults: DEFAULTS,
    counts: { mailable: 3, contacts: 10 },
    sending: { enabled: true, hasPostalAddress: true },
  },
});

// ─── fetch, routed by URL and method ─────────────────────────────────────────

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

const respond = (body: unknown, status = 200): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Reply = FakeResponse | Promise<FakeResponse>;

/** Answers to each GET, in turn. An empty queue is a test bug, said loudly. */
let consentReplies: Reply[];
let bookReplies: Reply[];
let putReply: () => Reply;
const mockFetch = jest.fn();

function route(url: string, init?: { method?: string }): Promise<FakeResponse> {
  const method = init?.method ?? 'GET';
  if (url.startsWith('/api/business-os/consent-settings')) {
    if (method === 'PUT') return Promise.resolve(putReply());
    const next = consentReplies.shift();
    if (!next) throw new Error('Unexpected consent GET');
    return Promise.resolve(next);
  }
  if (url.startsWith('/api/business-os/addresses')) {
    const next = bookReplies.shift();
    if (!next) throw new Error('Unexpected addresses GET');
    return Promise.resolve(next);
  }
  throw new Error(`Unrouted fetch: ${method} ${url}`);
}

const bookOk = (locale: Lang = 'en') => respond({ success: true, data: { addresses: bookFor(locale) } });

function calls(kind: 'consent' | 'book', method = 'GET') {
  const prefix = kind === 'consent' ? '/api/business-os/consent-settings' : '/api/business-os/addresses';
  return mockFetch.mock.calls.filter(
    ([url, init]) => String(url).startsWith(prefix) && ((init as { method?: string } | undefined)?.method ?? 'GET') === method
  );
}

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => {
  mockLang.language = 'en';
  mockFetch.mockReset();
  mockFetch.mockImplementation(route);
  consentReplies = [];
  bookReplies = [];
  putReply = () => respond({ success: true });
  mockLogCalls.length = 0;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** Reads handed over as the page's prefetch would hand them, already answered. */
function handed(consent: ConsentRead, book: AddressBookRead, locale: Lang = 'en'): MarketingDrawerReads {
  return { locale, consent: Promise.resolve(consent), book: Promise.resolve(book) };
}

const consentOk = (postal: string | null): ConsentRead => ({ ok: true, status: 200, body: consentBody(postal) });
const bookRead = (locale: Lang = 'en'): AddressBookRead => ({ ok: true, locale, addresses: bookFor(locale) });

function mountPanel(takePrefetched?: () => MarketingDrawerReads | null, strict = false) {
  const dirty = jest.fn();
  const panel = <MarketingConsentPanel onDirtyChange={dirty} takePrefetched={takePrefetched} />;
  render(strict ? <React.StrictMode>{panel}</React.StrictMode> : panel);
  return { lastDirty: () => dirty.mock.calls.at(-1)?.[0] as boolean | undefined };
}

const placeholder = () => screen.queryByTestId('consent-address-book-placeholder');
const formShown = () => screen.queryByDisplayValue(DEFAULTS.statement_en);
function postal(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(copy()['consent.postal_placeholder']) as HTMLTextAreaElement;
}
const radio = (name: RegExp | string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const yRadio = () => radio(/14 Venus Drive/);
const zRadio = () => radio(/1 Rothschild Blvd/);
const otherRow = () => radio(copy()['settings.address.reuse_other']);
const checkedRadios = () => (screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r.checked);
const logsOf = (level: string) => mockLogCalls.filter((c) => c.level === level);

// ─── The drawer, for the close checks ────────────────────────────────────────

const DRAWER = 'settings-consent-drawer';

function DrawerHarness({ take }: { take?: () => MarketingDrawerReads | null }) {
  const [open, setOpen] = useState(true);
  return <MarketingConsentDrawer open={open} onOpenChange={setOpen} takePrefetched={take} />;
}

function ownX(): HTMLButtonElement {
  const own = within(screen.getByTestId(DRAWER))
    .getAllByRole('button', { name: copy()['common.close'] })
    .find((b) => !b.className.includes('absolute'));
  if (!own) throw new Error("The drawer's own X was not found");
  return own as HTMLButtonElement;
}

const discardPrompt = () => screen.queryByRole('dialog', { name: copy()['settings.drawer.discard_title'] });

// ─── Parallel ────────────────────────────────────────────────────────────────

describe('both reads at once (C-3)', () => {
  it('T-M1: with neither answered, the book and consent have both been requested, book first', async () => {
    const consent = deferred<FakeResponse>();
    const book = deferred<FakeResponse>();
    consentReplies.push(consent.promise);
    bookReplies.push(book.promise);
    mountPanel();

    expect(mockFetch.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/business-os/addresses?locale=en',
      '/api/business-os/consent-settings?locale=en',
    ]);
    // The consent GET is today's request: the URL alone (SA-CA-6).
    expect(calls('consent')[0]).toHaveLength(1);
    expect(calls('book')[0][1]).toEqual({ cache: 'no-store' });

    await act(async () => {
      consent.resolve(respond(consentBody(X)));
      book.resolve(bookOk());
    });
  });

  it('T-M2: consent in, book pending → the form and the placeholder, no picker; then the book → the list', async () => {
    const book = deferred<FakeResponse>();
    consentReplies.push(respond(consentBody(X)));
    bookReplies.push(book.promise);
    mountPanel();

    await waitFor(() => expect(formShown()).toBeTruthy());
    const hold = placeholder();
    expect(hold).toBeTruthy();
    // SA-CA-13: a shape, not content.
    expect(hold?.getAttribute('aria-hidden')).toBe('true');
    expect(hold?.textContent).toBe('');
    expect(hold?.className).toContain('motion-safe:animate-pulse');
    expect(hold?.className).not.toMatch(/(^|\s)animate-pulse/);
    expect(hold?.parentElement?.className).toBe('mb-2');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);

    await act(async () => {
      book.resolve(bookOk());
    });
    await screen.findByText(copy()['settings.address.book_title']);
    expect(placeholder()).toBeNull();
    expect(yRadio()).toBeTruthy();
  });

  it('T-M3: one consent GET and one addresses GET per open, under StrictMode; takePrefetched asked once', async () => {
    consentReplies.push(respond(consentBody(X)));
    bookReplies.push(bookOk());
    const take = jest.fn(() => null);
    mountPanel(take, true);
    await screen.findByText(copy()['settings.address.book_title']);
    await settle();
    expect(calls('consent')).toHaveLength(1);
    expect(calls('book')).toHaveLength(1);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it('T-M3: with reads handed over, under StrictMode: zero requests, and they are taken once', async () => {
    const take = jest.fn(() => handed(consentOk(X), bookRead()));
    mountPanel(take, true);
    await screen.findByText(copy()['settings.address.book_title']);
    await settle();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(take).toHaveBeenCalledTimes(1);
    expect(postal().value).toBe(X);
  });
});

// ─── Preloaded consent that cannot be used ───────────────────────────────────

describe('a handed-over consent read that cannot be used is read once more (SA-CA-2)', () => {
  it.each([
    ['a refusal', { ok: false, kind: 'refused', status: 500 } as ConsentRead],
    ['a throw', { ok: false, kind: 'threw', err: new Error('offline') } as ConsentRead],
    ['a 200 with success: false', { ok: true, status: 200, body: { success: false } } as ConsentRead],
    ['a malformed payload', { ok: true, status: 200, body: { success: true, data: { settings: null } } } as ConsentRead],
  ])('T-M4: %s → exactly one fresh consent GET → the form; no F-17, no extra book GET', async (_kind, early) => {
    consentReplies.push(respond(consentBody(X)));
    mountPanel(() => handed(early, bookRead()));

    await waitFor(() => expect(formShown()).toBeTruthy());
    await screen.findByText(copy()['settings.address.book_title']);
    await settle();
    expect(calls('consent')).toHaveLength(1);
    expect(calls('book')).toHaveLength(0);
    expect(screen.queryByText(copy()['consent.load_failed'])).toBeNull();
    expect(postal().value).toBe(X);
    // Not acted on, so not a load failure: debug only, and status or err only.
    expect(logsOf('warn')).toHaveLength(0);
    expect(logsOf('error')).toHaveLength(0);
    expect(logsOf('debug')).toHaveLength(1);
    const ctx = Object.keys(logsOf('debug')[0].args[0] as object);
    expect(ctx.length === 1 && (ctx[0] === 'status' || ctx[0] === 'err')).toBe(true);
  });

  it('T-M5: a handed-over failure, then a fresh failure → F-17 (no form, no Save), one warn; the drawer closes at once', async () => {
    consentReplies.push(respond({ success: false }, 500));
    render(<DrawerHarness take={() => handed({ ok: false, kind: 'refused', status: 503 }, bookRead())} />);

    const sheet = await screen.findByTestId(DRAWER);
    await within(sheet).findByRole('alert');
    expect(within(sheet).queryByRole('button', { name: copy()['common.save'] })).toBeNull();
    expect(within(sheet).queryAllByRole('textbox')).toHaveLength(0);
    expect(calls('consent')).toHaveLength(1);
    // Only the answer acted on is logged at warn, as on a plain open (D-12).
    expect(logsOf('warn')).toHaveLength(1);
    expect(logsOf('warn')[0].args[0]).toEqual({ status: 500 });
    expect(logsOf('error')).toHaveLength(0);

    await settle();
    fireEvent.click(ownX());
    await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());
    expect(discardPrompt()).toBeNull();
  });

  it('T-M5: a fresh throw after a handed-over failure is logged at error with { err } only', async () => {
    consentReplies.push(Promise.reject(new Error('network down')) as unknown as Reply);
    mountPanel(() => handed({ ok: true, status: 200, body: { success: false } }, bookRead()));
    await screen.findByRole('alert');
    expect(logsOf('error')).toHaveLength(1);
    expect(Object.keys(logsOf('error')[0].args[0] as object)).toEqual(['err']);
    expect(logsOf('warn')).toHaveLength(0);
  });
});

// ─── F-18 and the user's decision, with preloaded data ───────────────────────

describe('marking, never filling, whatever arrives first (F-18)', () => {
  it.each([
    ['the book before consent', 'book-first'],
    ['the book after consent', 'consent-first'],
  ])('T-M6: %s: a stored line equal to Z marks Z, writes nothing, clean', async (_case, order) => {
    const consent = deferred<FakeResponse>();
    const book = deferred<FakeResponse>();
    consentReplies.push(consent.promise);
    bookReplies.push(book.promise);
    const { lastDirty } = mountPanel();

    const zLine = oneLine(TLV, 'en');
    await act(async () => {
      if (order === 'book-first') book.resolve(bookOk());
      else consent.resolve(respond(consentBody(zLine)));
    });
    await act(async () => {
      if (order === 'book-first') consent.resolve(respond(consentBody(zLine)));
      else book.resolve(bookOk());
    });
    await screen.findByText(copy()['settings.address.book_title']);
    await settle();

    expect(postal().value).toBe(zLine);
    expect(zRadio().checked).toBe(true);
    expect(checkedRadios()).toEqual([zRadio()]);
    expect(lastDirty()).toBe(false);
    expect(calls('consent', 'PUT')).toHaveLength(0);
  });

  it('T-M6: the same with reads handed over: Z marked, nothing written, clean', async () => {
    const zLine = oneLine(TLV, 'en');
    const { lastDirty } = mountPanel(() => handed(consentOk(zLine), bookRead()));
    await screen.findByText(copy()['settings.address.book_title']);
    await settle();
    expect(postal().value).toBe(zLine);
    expect(checkedRadios()).toEqual([zRadio()]);
    expect(lastDirty()).toBe(false);
  });

  it('T-M7: a handed-over book with default Y, stored postal empty → empty field, "different address" checked, nothing marked, clean', async () => {
    const { lastDirty } = mountPanel(() => handed(consentOk(null), bookRead()));
    await screen.findByText(copy()['settings.address.book_title']);
    await settle();
    expect(postal().value).toBe('');
    expect(otherRow().checked).toBe(true);
    expect(yRadio().checked).toBe(false);
    expect(checkedRadios()).toEqual([otherRow()]);
    expect(lastDirty()).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── S-3 with preloaded data ─────────────────────────────────────────────────

describe('the dirty baseline with preloaded data (S-3)', () => {
  it('T-M8: an untouched open with handed-over reads is clean: the X closes with no prompt', async () => {
    render(<DrawerHarness take={() => handed(consentOk(X), bookRead())} />);
    const sheet = await screen.findByTestId(DRAWER);
    await within(sheet).findByText(copy()['settings.address.book_title']);
    await settle();
    fireEvent.click(ownX());
    await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());
    expect(discardPrompt()).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('T-M8: an edit then makes it dirty, and the X prompts', async () => {
    render(<DrawerHarness take={() => handed(consentOk(X), bookRead())} />);
    const sheet = await screen.findByTestId(DRAWER);
    await within(sheet).findByText(copy()['settings.address.book_title']);
    await settle();
    fireEvent.change(postal(), { target: { value: X_EDITED } });
    await settle();
    fireEvent.click(ownX());
    expect(await screen.findByRole('dialog', { name: copy()['settings.drawer.discard_title'] })).toBeTruthy();
    expect(screen.getByTestId(DRAWER)).toBeTruthy();
  });

  it('T-M9: the reload after a save is a fresh GET; text typed during the save is kept', async () => {
    const put = deferred<FakeResponse>();
    putReply = () => put.promise;
    consentReplies.push(respond(consentBody(X)));
    const { lastDirty } = mountPanel(() => handed(consentOk(X), bookRead()));
    await screen.findByText(copy()['settings.address.book_title']);

    fireEvent.click(screen.getByRole('button', { name: copy()['common.save'] }));
    await waitFor(() => expect(calls('consent', 'PUT')).toHaveLength(1));
    fireEvent.change(postal(), { target: { value: X_EDITED } });
    await act(async () => {
      put.resolve(respond({ success: true }));
    });
    await waitFor(() => expect(calls('consent')).toHaveLength(1));
    await settle();

    expect(postal().value).toBe(X_EDITED);
    expect(lastDirty()).toBe(true);
  });

  it('T-M10: Try again after F-17 is a fresh GET; the handed-over read is not reused', async () => {
    consentReplies.push(respond({ success: false }, 500), respond(consentBody(X)));
    mountPanel(() => handed({ ok: false, kind: 'refused', status: 503 }, bookRead()));
    const again = await screen.findByRole('button', { name: copy()['common.try_again'] });
    expect(calls('consent')).toHaveLength(1);

    fireEvent.click(again);
    await waitFor(() => expect(formShown()).toBeTruthy());
    expect(calls('consent')).toHaveLength(2);
    expect(postal().value).toBe(X);
    // The handed-over read was judged once, on mount, and never again.
    expect(logsOf('debug')).toHaveLength(1);
  });
});

// ─── The book failing, and another language ──────────────────────────────────

describe('the book and the language', () => {
  it('T-M11: a handed-over book failure is read once more; a second failure → no picker, no placeholder; the field still works', async () => {
    bookReplies.push(respond({ success: false }, 500));
    mountPanel(() => handed(consentOk(X), { ok: false, status: 503 }));
    await waitFor(() => expect(formShown()).toBeTruthy());
    await settle();

    expect(calls('book')).toHaveLength(1);
    expect(calls('consent')).toHaveLength(0);
    expect(placeholder()).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByText(copy()['settings.address.book_title'])).toBeNull();
    fireEvent.change(postal(), { target: { value: X_EDITED } });
    expect(postal().value).toBe(X_EDITED);
  });

  it('T-M11: a plain open whose book read fails → no picker, no placeholder; the field still works', async () => {
    consentReplies.push(respond(consentBody(X)));
    bookReplies.push(Promise.reject(new Error('offline')) as unknown as Reply);
    mountPanel();
    await waitFor(() => expect(formShown()).toBeTruthy());
    await settle();
    expect(placeholder()).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    fireEvent.change(postal(), { target: { value: X_EDITED } });
    expect(postal().value).toBe(X_EDITED);
  });

  it('T-M12: reads handed over in another language are ignored: fresh reads in the panel’s language', async () => {
    consentReplies.push(respond(consentBody(X)));
    bookReplies.push(bookOk('en'));
    const take = jest.fn(() => handed(consentOk(X_EDITED), bookRead('he'), 'he'));
    mountPanel(take);
    await screen.findByText(copy()['settings.address.book_title']);
    await settle();

    expect(take).toHaveBeenCalledTimes(1);
    expect(calls('consent')).toHaveLength(1);
    expect(calls('book')).toHaveLength(1);
    expect(postal().value).toBe(X);
    expect(screen.getByText(oneLine(VENUS, 'en'))).toBeTruthy();
  });
});
