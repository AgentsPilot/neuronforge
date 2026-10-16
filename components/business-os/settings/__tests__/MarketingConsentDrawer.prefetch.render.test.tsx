/**
 * @jest-environment jsdom
 */

/**
 * The prefetch hook and the Marketing permission drawer together (C-a workplan
 * T-D1..T-D4; settings drawer review §0.6 C-5).
 *
 * A small harness plays the page: `useDrawerPrefetch` with the real starter,
 * a Warm button standing in for the row's hover / focus / press, and the
 * drawer with `takePrefetched={prefetch.take}`. The real panel and the real
 * picker; `fetch` routed by URL, with deferred replies. Time is moved only
 * through `Date.now()`, for the maximum age.
 */

import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { KnownAddress } from '@/components/ui/SavedAddressPicker';
import { formatAddressOneLine, type StructuredAddress } from '@/lib/geo/address';

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: 'en',
      isRTL: false,
      t: (key: string, vars?: Record<string, string | number>) => {
        let text: string = translations.en[key] || key;
        for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
        return text;
      },
    }),
  };
});
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
jest.mock('@/lib/logger', () => {
  const noop = () => undefined;
  const logger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop, fatal: noop };
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

import { MarketingConsentDrawer } from '@/components/business-os/settings/MarketingConsentDrawer';
import { startMarketingDrawerReads } from '@/components/business-os/settings/marketingDrawerReads';
import { DRAWER_PREFETCH_MAX_AGE_MS, useDrawerPrefetch } from '@/components/business-os/settings/useDrawerPrefetch';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<'en', Record<string, string>>;
};
const COPY = translations.en;
const DRAWER = 'settings-consent-drawer';

const VENUS: StructuredAddress = { line1: '14 Venus Drive', line2: '', city: 'Closter', state: 'NJ', postal_code: '07624', country: 'US' };
const BOOK: KnownAddress[] = [
  { id: 'addr-venus', label: formatAddressOneLine(VENUS, 'en') as string, name: null, address: VENUS, isDefault: true, usedBy: [] },
];

const WARMED = 'The wording as the warm read found it.';
const FRESH = 'The wording as a fresh read found it.';

function consentBody(statement: string) {
  return {
    success: true,
    data: {
      settings: {
        capture_enabled: true,
        statement_en: statement,
        statement_he: null,
        statement_es: null,
        privacy_policy_mode: 'hosted',
        privacy_policy_url: null,
        privacy_policy_body: 'Notice.',
        postal_address: 'PO Box 77, Haifa',
        label_as_advertisement: false,
      },
      defaults: { statement_en: 'd', statement_he: 'd', statement_es: 'd', privacy_policy_body: 'd', postal_address: '' },
      counts: { mailable: 1, contacts: 2 },
      sending: { enabled: true, hasPostalAddress: true },
    },
  };
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
const respond = (body: unknown, status = 200): FakeResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Reply = FakeResponse | Promise<FakeResponse>;
let consentReplies: Reply[];
let bookReplies: Reply[];
const mockFetch = jest.fn();

function route(url: string, init?: { method?: string }): Promise<FakeResponse> {
  if (url.startsWith('/api/business-os/consent-settings')) {
    if (init?.method === 'PUT') return Promise.resolve(respond({ success: true }));
    const next = consentReplies.shift();
    if (!next) throw new Error('Unexpected consent GET');
    return Promise.resolve(next);
  }
  if (url.startsWith('/api/business-os/addresses')) {
    const next = bookReplies.shift();
    if (!next) throw new Error('Unexpected addresses GET');
    return Promise.resolve(next);
  }
  throw new Error(`Unrouted fetch: ${url}`);
}

const bookOk = () => respond({ success: true, data: { addresses: BOOK } });
const count = (prefix: string) =>
  mockFetch.mock.calls.filter(
    ([url, init]) => String(url).startsWith(prefix) && ((init as { method?: string } | undefined)?.method ?? 'GET') === 'GET'
  ).length;
const consentGets = () => count('/api/business-os/consent-settings');
const bookGets = () => count('/api/business-os/addresses');

let now: number;

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(route);
  consentReplies = [];
  bookReplies = [];
  now = Date.parse('2026-10-16T10:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => jest.restoreAllMocks());

/**
 * `pausedWhileOpen` plays the settings page's wiring since QA-CA-B1: the hook is
 * paused while the drawer is open (`paused: consentDrawerOpen`), and
 * `idle` turns on the idle warm, as the page has it.
 */
function Page({ pausedWhileOpen = false, idle = false }: { pausedWhileOpen?: boolean; idle?: boolean }) {
  const [open, setOpen] = useState(false);
  const prefetch = useDrawerPrefetch({
    start: () => startMarketingDrawerReads('en'),
    key: 'user-1:en',
    enabled: true,
    paused: pausedWhileOpen ? open : false,
    maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS,
    warmOnIdle: idle,
  });
  return (
    <>
      <button type="button" onClick={prefetch.warm}>
        Warm
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <MarketingConsentDrawer open={open} onOpenChange={setOpen} takePrefetched={prefetch.take} />
    </>
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const warm = () => fireEvent.click(screen.getByRole('button', { name: 'Warm' }));

async function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  return screen.findByTestId(DRAWER);
}

async function closeDrawer() {
  const own = within(screen.getByTestId(DRAWER))
    .getAllByRole('button', { name: COPY['common.close'] })
    .find((b) => !b.className.includes('absolute')) as HTMLButtonElement;
  fireEvent.click(own);
  await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());
}

describe.each([
  ['always on', false],
  ['paused while the drawer is open, as the page wires it (QA-CA-B1)', true],
] as const)('warm, then open (%s)', (_mode, pausedWhileOpen) => {
  it('T-D1: warmed and answered, then open → zero new requests, and the warmed wording shows', async () => {
    consentReplies.push(respond(consentBody(WARMED)));
    bookReplies.push(bookOk());
    render(<Page pausedWhileOpen={pausedWhileOpen} />);
    warm();
    await settle();
    expect(consentGets()).toBe(1);
    expect(bookGets()).toBe(1);

    const sheet = await openDrawer();
    await within(sheet).findByDisplayValue(WARMED);
    await within(sheet).findByText(COPY['settings.address.book_title']);
    await settle();
    expect(consentGets()).toBe(1);
    expect(bookGets()).toBe(1);
  });

  it('T-D1: warming twice before the open still makes one pair', async () => {
    consentReplies.push(respond(consentBody(WARMED)));
    bookReplies.push(bookOk());
    render(<Page pausedWhileOpen={pausedWhileOpen} />);
    warm();
    warm();
    await settle();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('T-D2: warm still in flight, then open → zero new requests; the form appears when the read lands', async () => {
    const consent = deferred<FakeResponse>();
    const book = deferred<FakeResponse>();
    consentReplies.push(consent.promise);
    bookReplies.push(book.promise);
    render(<Page pausedWhileOpen={pausedWhileOpen} />);
    warm();

    const sheet = await openDrawer();
    await settle();
    expect(within(sheet).queryByDisplayValue(WARMED)).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      consent.resolve(respond(consentBody(WARMED)));
      book.resolve(bookOk());
    });
    await within(sheet).findByDisplayValue(WARMED);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('T-D3: open, close, reopen with no new warm → one fresh pair (used once)', async () => {
    consentReplies.push(respond(consentBody(WARMED)), respond(consentBody(FRESH)));
    bookReplies.push(bookOk(), bookOk());
    render(<Page pausedWhileOpen={pausedWhileOpen} />);
    warm();
    await settle();

    const first = await openDrawer();
    await within(first).findByDisplayValue(WARMED);
    await settle();
    await closeDrawer();

    const second = await openDrawer();
    await within(second).findByDisplayValue(FRESH);
    await settle();
    expect(consentGets()).toBe(2);
    expect(bookGets()).toBe(2);
  });

  it('T-D4: warm, 61 s pass, then open → one fresh pair; the old set is not used', async () => {
    consentReplies.push(respond(consentBody(WARMED)), respond(consentBody(FRESH)));
    bookReplies.push(bookOk(), bookOk());
    render(<Page pausedWhileOpen={pausedWhileOpen} />);
    warm();
    await settle();

    now += 61_000;
    const sheet = await openDrawer();
    await within(sheet).findByDisplayValue(FRESH);
    await settle();
    expect(within(sheet).queryByDisplayValue(WARMED)).toBeNull();
    expect(consentGets()).toBe(2);
    expect(bookGets()).toBe(2);
  });
});

/*
 * QA-CA-B1 (QA probe S-7). The idle warm scheduled at page load fires only
 * after the owner has already opened the drawer. Before the fix it started a
 * pair while the drawer was open; that pair carried the wording from before
 * the save, closing did not replace it (a usable set was held), and a reopen
 * within 60 s showed the old wording as clean, so one more Save wrote it back.
 *
 * The idle callback is run by hand even though the hook asked to cancel it:
 * a browser that runs it anyway is the worst case, and the hook must still
 * start nothing while it is paused.
 */
describe('a late idle warm while the drawer is open (QA-CA-B1)', () => {
  let idleCallbacks: Array<() => void>;

  beforeEach(() => {
    idleCallbacks = [];
    (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = (cb: () => void) => {
      idleCallbacks.push(cb);
      return idleCallbacks.length;
    };
    (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback = () => undefined;
  });

  afterEach(() => {
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    delete (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback;
  });

  it('T-D5: starts nothing while open, and a reopen after a save shows the saved wording', async () => {
    const BEFORE = 'The wording before the save.';
    const SAVED = 'The wording the owner saved.';
    consentReplies.push(
      respond(consentBody(BEFORE)), // the press warm, taken by the open
      respond(consentBody(SAVED)), // the reload after the save
      respond(consentBody(SAVED)) // the fresh pair after the close
    );
    bookReplies.push(bookOk(), bookOk());
    render(<Page pausedWhileOpen idle />);
    expect(idleCallbacks).toHaveLength(1);

    warm(); // the row's press, before the idle warm has fired
    const sheet = await openDrawer();
    await within(sheet).findByDisplayValue(BEFORE);
    await settle();
    expect(consentGets()).toBe(1);
    expect(bookGets()).toBe(1);

    const beforeIdle = mockFetch.mock.calls.length;
    act(() => idleCallbacks[0]());
    await settle();
    expect(mockFetch.mock.calls.length - beforeIdle).toBe(0); // startedWhileOpen = 0

    fireEvent.change(within(sheet).getByDisplayValue(BEFORE), { target: { value: SAVED } });
    fireEvent.click(within(sheet).getByRole('button', { name: COPY['common.save'] }));
    await within(sheet).findByDisplayValue(SAVED);
    await waitFor(() => expect(consentGets()).toBe(2)); // the reload after the save
    await settle();
    await closeDrawer();

    now += 5_000;
    warm(); // focus returns to the row
    await settle();
    const again = await openDrawer();
    await within(again).findByDisplayValue(SAVED);
    await settle();
    expect(within(again).queryByDisplayValue(BEFORE)).toBeNull();
    expect(consentGets()).toBe(3);
    expect(bookGets()).toBe(2);
  });
});

describe('the hand-over under StrictMode, paused as the page wires it (QA-CA-B1)', () => {
  it('T-D6: warm, then open → zero new requests; the warmed wording shows', async () => {
    consentReplies.push(respond(consentBody(WARMED)));
    bookReplies.push(bookOk());
    render(
      <React.StrictMode>
        <Page pausedWhileOpen />
      </React.StrictMode>
    );
    warm();
    await settle();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const sheet = await openDrawer();
    await within(sheet).findByDisplayValue(WARMED);
    await within(sheet).findByText(COPY['settings.address.book_title']);
    await settle();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
