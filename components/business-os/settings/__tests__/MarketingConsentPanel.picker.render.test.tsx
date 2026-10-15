/**
 * @jest-environment jsdom
 */

/**
 * Marketing permission with the REAL saved-address picker (F-18; settings
 * drawer review §7 F-18, SA S-3 ruling 3, QA K21, SA S-3 code review finding 1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PICKER IS NOT MOCKED HERE
 *
 * The bug lived in the CALL between the panel and the shared picker: the panel
 * passed props the picker no longer had, so the picker took its "empty form
 * gets the default" branch and wrote the book's default over the stored legal
 * postal line on every open. A stub picker cannot see that, which is how it
 * shipped. `MarketingConsentDrawer.render.test.tsx` keeps a stub for the
 * drawer's own behaviour; this file is the one that runs the two together.
 * `MarketingConsentPanel.pickerCall.guard.test.ts` fails if a mock of the
 * picker is ever added here.
 *
 * `fetch` is routed by URL and method: the consent GET and PUT, the addresses
 * GET (labels in the reader's language, as the route makes them) and the
 * addresses DELETE. `@/components/ui/select` is a native `<select>`, because
 * Radix's listbox cannot be driven in jsdom.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { KnownAddress } from '@/components/ui/SavedAddressPicker';
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

import { MarketingConsentPanel } from '@/components/business-os/settings/MarketingConsentPanel';
import { MarketingConsentDrawer } from '@/components/business-os/settings/MarketingConsentDrawer';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const copy = () => translations[mockLang.language];

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VENUS: StructuredAddress = {
  line1: '14 Venus Drive',
  line2: '',
  city: 'Closter',
  state: 'NJ',
  postal_code: '07624',
  country: 'US',
};

const TLV: StructuredAddress = {
  line1: '1 Rothschild Blvd',
  line2: '',
  city: 'Tel Aviv',
  state: '',
  postal_code: '6688101',
  country: 'IL',
};

/** The book's default (Y) and another entry (Z), as stored. */
interface BookRow {
  id: string;
  parts: StructuredAddress;
  isDefault: boolean;
  usedBy: KnownAddress['usedBy'];
}
const Y: BookRow = { id: 'addr-venus', parts: VENUS, isDefault: true, usedBy: ['profile', 'invoice'] };
const Z: BookRow = { id: 'addr-tlv', parts: TLV, isDefault: false, usedBy: [] };

const oneLine = (parts: StructuredAddress, locale: Lang) => formatAddressOneLine(parts, locale) as string;

/** A stored postal line that is NOT in the book: a PO box, a registered office. */
const X = 'PO Box 77, Haifa 3100001, Israel';
const X_EDITED = 'PO Box 78, Haifa 3100001, Israel';
const SERVER_BODY = 'The privacy notice, as the server now holds it.';

const DEFAULTS = {
  statement_en: 'I agree to receive occasional offers by email.',
  statement_he: 'אני מסכים לקבל הצעות בדוא"ל.',
  statement_es: 'Acepto recibir ofertas por email.',
  privacy_policy_body: 'Default privacy notice body.',
  postal_address: '',
};

function stored(postal: string | null, over: Record<string, unknown> = {}) {
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
    ...over,
  };
}

// ─── fetch, routed by URL and method ─────────────────────────────────────────

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function respond(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Server {
  book: BookRow[];
  /** Answers to the consent GET, in turn. */
  consentGets: Array<FakeResponse | Promise<FakeResponse>>;
  /** The defaults' profile address for every consent GET. */
  profilePostal: string;
  put: () => FakeResponse | Promise<FakeResponse>;
}

let server: Server;
const mockFetch = jest.fn();

function consentLoad(settings: Record<string, unknown> | null) {
  return respond({
    success: true,
    data: {
      settings,
      defaults: { ...DEFAULTS, postal_address: server.profilePostal },
      counts: { mailable: 3, contacts: 10 },
      sending: { enabled: true, hasPostalAddress: true },
    },
  });
}

function route(url: string, init?: { method?: string; body?: string }): Promise<FakeResponse> {
  const method = init?.method ?? 'GET';
  if (url.startsWith('/api/business-os/consent-settings')) {
    if (method === 'PUT') return Promise.resolve(server.put());
    const next = server.consentGets.shift();
    if (!next) throw new Error(`Unexpected consent GET #${consentCalls('GET').length}`);
    return Promise.resolve(next);
  }
  if (url.startsWith('/api/business-os/addresses/') && method === 'DELETE') {
    const id = url.split('/').pop();
    server.book = server.book.filter((row) => row.id !== id);
    return Promise.resolve(respond({ success: true }));
  }
  if (url.startsWith('/api/business-os/addresses')) {
    // Labelled in the reader's language, as the route labels them.
    const locale = (new URL(url, 'http://test').searchParams.get('locale') ?? 'en') as Lang;
    const addresses: KnownAddress[] = server.book.map((row) => ({
      id: row.id,
      label: oneLine(row.parts, locale),
      name: null,
      address: row.parts,
      isDefault: row.isDefault,
      usedBy: row.usedBy,
    }));
    return Promise.resolve(respond({ success: true, data: { addresses } }));
  }
  throw new Error(`Unrouted fetch: ${method} ${url}`);
}

function consentCalls(method: 'GET' | 'PUT') {
  return mockFetch.mock.calls.filter(
    ([url, init]) =>
      String(url).startsWith('/api/business-os/consent-settings') &&
      ((init as { method?: string } | undefined)?.method ?? 'GET') === method
  );
}

function putBody(): Record<string, unknown> {
  const puts = consentCalls('PUT');
  expect(puts).toHaveLength(1);
  return JSON.parse((puts[0][1] as { body: string }).body);
}

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => {
  mockLang.language = 'en';
  mockFetch.mockReset();
  mockFetch.mockImplementation(route);
  server = {
    book: [Y, Z],
    consentGets: [],
    profilePostal: '',
    put: () => respond({ success: true }),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** Mounts the panel and waits for the form AND the book (and the picker's derive after it). */
async function mountPanel() {
  const dirty = jest.fn();
  render(<MarketingConsentPanel onDirtyChange={dirty} />);
  await screen.findByText(copy()['settings.address.book_title']);
  await settle();
  return { lastDirty: () => dirty.mock.calls.at(-1)?.[0] as boolean | undefined };
}

function postal(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(server.profilePostal || copy()['consent.postal_placeholder']) as HTMLTextAreaElement;
}

function radio(name: RegExp | string): HTMLInputElement {
  return screen.getByRole('radio', { name }) as HTMLInputElement;
}

const yRadio = () => radio(/14 Venus Drive/);
const zRadio = () => radio(/1 Rothschild Blvd/);
const otherRow = () => radio(copy()['settings.address.reuse_other']);

function checkedRadios(): HTMLInputElement[] {
  return (screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r.checked);
}

/** Opens the picker's confirmation for the row whose radio is `row`, and confirms. */
async function deleteEntry(row: HTMLInputElement) {
  const label = row.closest('label') as HTMLElement;
  fireEvent.click(within(label).getByRole('button', { name: copy()['settings.address.delete'] }));
  fireEvent.click(screen.getByRole('button', { name: copy()['settings.address.delete_action'] }));
  await waitFor(() => expect(mockFetch.mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === 'DELETE')).toBe(true));
  await settle();
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: copy()['common.save'] }) as HTMLButtonElement;
}

// ─── Opening ─────────────────────────────────────────────────────────────────

describe('opening: the stored line stays, and only what it already is gets marked', () => {
  it('R-1: a stored line that differs from the book default is not overwritten; clean; nothing but "other" marked', async () => {
    server.consentGets.push(consentLoad(stored(X)));
    const { lastDirty } = await mountPanel();

    expect(postal().value).toBe(X);
    expect(lastDirty()).toBe(false);
    expect(checkedRadios()).toEqual([otherRow()]);
    expect(consentCalls('PUT')).toHaveLength(0);
  });

  it('R-2: nothing stored, seeded from the profile (English): the field shows it, clean, and that entry is marked', async () => {
    server.profilePostal = oneLine(VENUS, 'en');
    server.book = [Z, Y];
    server.consentGets.push(consentLoad(null));
    const { lastDirty } = await mountPanel();

    expect(postal().value).toBe(server.profilePostal);
    expect(lastDirty()).toBe(false);
    expect(yRadio().checked).toBe(true);
    expect(zRadio().checked).toBe(false);
  });

  it('R-3: nothing stored and no profile address: the field stays empty, clean, and nothing is filled or marked', async () => {
    server.book = [Y];
    server.consentGets.push(consentLoad(null));
    const { lastDirty } = await mountPanel();

    expect(postal().value).toBe('');
    expect(lastDirty()).toBe(false);
    expect(yRadio().checked).toBe(false);
    expect(otherRow().checked).toBe(true);
  });

  it("R-4: a stored line equal to an entry's label (reader's language, other spacing and case) marks it; clean", async () => {
    const spaced = `  ${oneLine(VENUS, 'en').toUpperCase().replace(', ', ',   ')}  `;
    server.consentGets.push(consentLoad(stored(spaced)));
    const { lastDirty } = await mountPanel();

    expect(postal().value).toBe(spaced);
    expect(yRadio().checked).toBe(true);
    expect(lastDirty()).toBe(false);
  });

  it('R-5: a Hebrew reader whose line is the English form (as the profile writes it) still sees the entry marked', async () => {
    mockLang.language = 'he';
    expect(oneLine(VENUS, 'he')).not.toBe(oneLine(VENUS, 'en'));
    server.consentGets.push(consentLoad(stored(oneLine(VENUS, 'en'))));
    const { lastDirty } = await mountPanel();

    expect(yRadio().checked).toBe(true);
    expect(postal().value).toBe(oneLine(VENUS, 'en'));
    expect(lastDirty()).toBe(false);
  });

  /*
   * QA gap Q9 (2026-10-15). Recognition is equality after normalisation, not
   * containment: a stored line that is only PART of an entry's label (here the
   * city) is a different address and must not mark that entry.
   */
  it("R-17: a stored line that is only part of an entry's label (the city) does not mark it; clean", async () => {
    const fragment = VENUS.city as string;
    expect(oneLine(VENUS, 'en')).toContain(fragment);
    expect(oneLine(VENUS, 'en')).not.toBe(fragment);
    server.consentGets.push(consentLoad(stored(fragment)));
    const { lastDirty } = await mountPanel();

    expect(postal().value).toBe(fragment);
    expect(yRadio().checked).toBe(false);
    expect(checkedRadios()).toEqual([otherRow()]);
    expect(lastDirty()).toBe(false);
  });

  /*
   * Post-QA tweak (2026-10-15). A click writes the entry's line in the reader's
   * language at the time. Only the country name differs between languages, so a
   * line written for a Spanish reader is still that entry for a Hebrew one.
   */
  it('R-19: a line filled in Spanish, viewed by a Hebrew reader, still marks the entry; clean', async () => {
    mockLang.language = 'he';
    expect(oneLine(VENUS, 'es')).not.toBe(oneLine(VENUS, 'he'));
    expect(oneLine(VENUS, 'es')).not.toBe(oneLine(VENUS, 'en'));
    server.consentGets.push(consentLoad(stored(oneLine(VENUS, 'es'))));
    const { lastDirty } = await mountPanel();

    expect(postal().value).toBe(oneLine(VENUS, 'es'));
    expect(yRadio().checked).toBe(true);
    expect(zRadio().checked).toBe(false);
    expect(lastDirty()).toBe(false);
    expect(consentCalls('PUT')).toHaveLength(0);
  });
});

// ─── The owner's own changes ─────────────────────────────────────────────────

describe("only the owner's click changes the field", () => {
  it("R-6: clicking an entry writes its line in the reader's language, marks it, and makes the form dirty", async () => {
    server.consentGets.push(consentLoad(stored(X)));
    const { lastDirty } = await mountPanel();

    fireEvent.click(zRadio());
    expect(postal().value).toBe(oneLine(TLV, 'en'));
    expect(zRadio().checked).toBe(true);
    await waitFor(() => expect(lastDirty()).toBe(true));
  });

  it('R-7: typing after a click moves the mark to "other", and keeps the text as typed', async () => {
    server.consentGets.push(consentLoad(stored(X)));
    await mountPanel();

    fireEvent.click(zRadio());
    fireEvent.change(postal(), { target: { value: X_EDITED } });
    expect(postal().value).toBe(X_EDITED);
    expect(otherRow().checked).toBe(true);
    expect(zRadio().checked).toBe(false);
  });

  it('R-8: typed text survives deleting a different entry (the refetch fills nothing)', async () => {
    server.consentGets.push(consentLoad(stored(X)));
    await mountPanel();

    fireEvent.change(postal(), { target: { value: X_EDITED } });
    await deleteEntry(zRadio());

    expect(screen.queryByRole('radio', { name: /1 Rothschild Blvd/ })).toBeNull();
    expect(postal().value).toBe(X_EDITED);
    expect(yRadio().checked).toBe(false);
  });

  it('R-9: deleting the marked entry moves the mark to "other" and leaves the text alone', async () => {
    server.consentGets.push(consentLoad(stored(oneLine(VENUS, 'en'))));
    await mountPanel();
    expect(yRadio().checked).toBe(true);

    await deleteEntry(yRadio());

    expect(screen.queryByRole('radio', { name: /14 Venus Drive/ })).toBeNull();
    expect(otherRow().checked).toBe(true);
    expect(postal().value).toBe(oneLine(VENUS, 'en'));
  });

  /*
   * QA gap Q1 (2026-10-15). The picker reads `matchCurrent` through a ref that
   * is refreshed on every render. If it kept the predicate from the first
   * render, the refetch after a delete would match the text the panel OPENED
   * with (Y's line) and re-mark Y next to text that is no longer Y.
   */
  it('R-16: after typing over a recognised line, deleting another entry re-derives with the CURRENT text: only "other" is marked', async () => {
    server.consentGets.push(consentLoad(stored(oneLine(VENUS, 'en'))));
    await mountPanel();
    expect(yRadio().checked).toBe(true);

    fireEvent.change(postal(), { target: { value: X_EDITED } });
    expect(otherRow().checked).toBe(true);

    await deleteEntry(zRadio());

    expect(screen.queryByRole('radio', { name: /1 Rothschild Blvd/ })).toBeNull();
    expect(yRadio().checked).toBe(false);
    expect(checkedRadios()).toEqual([otherRow()]);
    expect(postal().value).toBe(X_EDITED);
  });

  it('R-10: its own radio group, and the "other" row says "Enter a different address", not "Add a new address"', async () => {
    server.consentGets.push(consentLoad(stored(X)));
    await mountPanel();

    for (const r of screen.getAllByRole('radio') as HTMLInputElement[]) {
      expect(r.name).toBe('saved-address-marketing');
    }
    expect(otherRow()).toBeTruthy();
    expect(screen.queryByText(copy()['settings.address.add_new'])).toBeNull();
    // An entry the profile and the invoices both use says both on this screen.
    const yLabel = yRadio().closest('label') as HTMLElement;
    expect(within(yLabel).getByText(copy()['settings.address.used_by.profile'])).toBeTruthy();
    expect(within(yLabel).getByText(copy()['settings.address.used_by.invoice'])).toBeTruthy();
  });
});

// ─── Saving ──────────────────────────────────────────────────────────────────

describe('saving', () => {
  it('R-11: saving untouched sends the stored line, not the book default', async () => {
    server.consentGets.push(consentLoad(stored(X)), consentLoad(stored(X)));
    await mountPanel();

    fireEvent.click(saveButton());
    await waitFor(() => expect(consentCalls('GET')).toHaveLength(2));
    expect(putBody().postal_address).toBe(X);
  });

  /*
   * SA S-3 code review finding 1. The reload after a save used to replace the
   * form unconditionally, dropping anything typed while the save was in flight.
   *
   * The reload here also returns a privacy notice the server changed, so the
   * last step can tell "baseline = what the server now holds" (correct, C-5)
   * from "baseline = what was sent": with the typed text reverted, the form
   * still differs from the server's notice, so it must stay dirty.
   */
  it('R-12: text typed during the save is kept after the reload; dirty; "Saved" hidden; baseline is the reloaded settings', async () => {
    const put = deferred<FakeResponse>();
    server.put = () => put.promise;
    server.consentGets.push(consentLoad(stored(X)), consentLoad(stored(X, { privacy_policy_body: SERVER_BODY })));
    const { lastDirty } = await mountPanel();

    fireEvent.click(saveButton());
    await waitFor(() => expect(consentCalls('PUT')).toHaveLength(1));
    fireEvent.change(postal(), { target: { value: X_EDITED } });

    await act(async () => {
      put.resolve(respond({ success: true }));
    });
    await waitFor(() => expect(consentCalls('GET')).toHaveLength(2));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    expect(postal().value).toBe(X_EDITED);
    expect(putBody().postal_address).toBe(X);
    expect(lastDirty()).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.change(postal(), { target: { value: X } });
    await settle();
    expect(lastDirty()).toBe(true);
  });

  it('R-13: with nothing typed during the save, the form becomes the reloaded settings; clean; "Saved" shows', async () => {
    server.consentGets.push(consentLoad(stored(X)), consentLoad(stored(X, { privacy_policy_body: SERVER_BODY })));
    const { lastDirty } = await mountPanel();

    fireEvent.click(saveButton());
    await waitFor(() => expect(consentCalls('GET')).toHaveLength(2));
    await screen.findByDisplayValue(SERVER_BODY);
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    expect(lastDirty()).toBe(false);
    expect(screen.getByRole('status').textContent).toContain(copy()['consent.saved']);
    expect(postal().value).toBe(X);
  });

  it('R-15: typed during the save and the reload then fails: the text stays, dirty, no "Saved", no load-failed screen', async () => {
    const put = deferred<FakeResponse>();
    server.put = () => put.promise;
    server.consentGets.push(consentLoad(stored(X)), respond({ success: false, error: 'Internal server error' }, 500));
    const { lastDirty } = await mountPanel();

    fireEvent.click(saveButton());
    await waitFor(() => expect(consentCalls('PUT')).toHaveLength(1));
    fireEvent.change(postal(), { target: { value: X_EDITED } });

    await act(async () => {
      put.resolve(respond({ success: true }));
    });
    await waitFor(() => expect(consentCalls('GET')).toHaveLength(2));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    expect(postal().value).toBe(X_EDITED);
    expect(lastDirty()).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(copy()['consent.load_failed'])).toBeNull();
  });
});

// ─── K21, at the drawer ──────────────────────────────────────────────────────

describe('the drawer (QA K21)', () => {
  function Harness({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
    const [open, setOpen] = useState(true);
    return (
      <MarketingConsentDrawer
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          setOpen(next);
        }}
      />
    );
  }

  it('R-14: an untouched open with a book default different from the stored line closes at once, with no discard prompt', async () => {
    server.consentGets.push(consentLoad(stored(X)));
    const onOpenChange = jest.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    const sheet = await screen.findByTestId('settings-consent-drawer');
    await within(sheet).findByText(copy()['settings.address.book_title']);
    await settle();
    expect(postal().value).toBe(X);

    // jsdom also shows the sheet's built-in X (hidden by `[&>button]:hidden` in
    // a browser), so take the one in the header.
    const ownX = within(sheet)
      .getAllByRole('button', { name: copy()['common.close'] })
      .find((b) => !b.className.includes('absolute')) as HTMLButtonElement;
    fireEvent.click(ownX);

    await waitFor(() => expect(screen.queryByTestId('settings-consent-drawer')).toBeNull());
    expect(screen.queryByRole('dialog', { name: copy()['settings.drawer.discard_title'] })).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /*
   * Post-QA tweak (2026-10-15), the user's manual-test bug: a line filled from
   * the default entry while the reader used Hebrew, reopened in English, fell
   * to "Enter a different address". It must be recognised, untouched, and the
   * drawer must close without asking.
   */
  it('R-18: a line filled in Hebrew from the default entry, opened in English: the default is marked, untouched, and it closes without a prompt', async () => {
    expect(oneLine(VENUS, 'he')).not.toBe(oneLine(VENUS, 'en'));
    server.consentGets.push(consentLoad(stored(oneLine(VENUS, 'he'))));
    const onOpenChange = jest.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    const sheet = await screen.findByTestId('settings-consent-drawer');
    await within(sheet).findByText(copy()['settings.address.book_title']);
    await settle();

    expect(postal().value).toBe(oneLine(VENUS, 'he'));
    expect(yRadio().checked).toBe(true);
    expect(checkedRadios()).toEqual([yRadio()]);

    const ownX = within(sheet)
      .getAllByRole('button', { name: copy()['common.close'] })
      .find((b) => !b.className.includes('absolute')) as HTMLButtonElement;
    fireEvent.click(ownX);

    await waitFor(() => expect(screen.queryByTestId('settings-consent-drawer')).toBeNull());
    expect(screen.queryByRole('dialog', { name: copy()['settings.drawer.discard_title'] })).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(consentCalls('PUT')).toHaveLength(0);
  });
});
