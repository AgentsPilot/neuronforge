/**
 * @jest-environment jsdom
 *
 * The picker with a book its caller already read (`initialBook`; settings
 * drawer review §0.6 C-3, C-a workplan T-P1..T-P10, SA-CA-3 / SA-CA-4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MUST HOLD
 *
 * A seeded book is shown in the first render with no request, and it is judged
 * EXACTLY as a fetched book: the text form (`matchCurrent`, F-18) marks and
 * never fills, the structured form takes the default for an empty form. A
 * delete, a `refreshKey` change and a language change read the book again, as
 * without a seed, and the seed never comes back after a language change
 * (he → en → he).
 *
 * The real picker; only `fetch` is stubbed, routed by method and locale. No
 * assertion depends on how long anything takes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SavedAddressPicker, type KnownAddress } from '@/components/ui/SavedAddressPicker';
import type { StructuredAddress } from '@/lib/geo/address';

const VENUS: StructuredAddress = {
  line1: '14 Venus Drive',
  line2: '',
  city: 'Closter',
  state: 'NJ',
  postal_code: '07624',
  country: 'US',
};

const ELSEWHERE: StructuredAddress = {
  line1: '1 Rothschild Blvd',
  line2: '',
  city: 'Tel Aviv',
  state: '',
  postal_code: '6688101',
  country: 'IL',
};

const EMPTY: StructuredAddress = { line1: '', line2: '', city: '', state: '', postal_code: '', country: '' };

const COPY: Record<string, string> = {
  'settings.address.book_title': 'Your addresses',
  'settings.address.add_new': 'Add a new address',
  'settings.address.delete': 'Remove this address',
  'settings.address.delete_action': 'Remove',
  'settings.address.delete_title': 'Remove this address?',
  'settings.address.delete_confirm': 'Anywhere already using it keeps showing it.',
  'button.cancel': 'Cancel',
};
const t = (key: string) => COPY[key] ?? key;

type Lang = 'en' | 'he' | 'es';

/** The label the route would write for this entry in this locale. */
const labelOf = (id: string, locale: string) => `${id === 'addr-venus' ? '14 Venus Drive' : '1 Rothschild Blvd'} [${locale}]`;

function bookFor(locale: string, ids: string[]): KnownAddress[] {
  return ids.map((id) => ({
    id,
    label: labelOf(id, locale),
    name: null,
    address: id === 'addr-venus' ? VENUS : ELSEWHERE,
    isDefault: id === 'addr-venus',
    usedBy: [],
  }));
}

let serverIds: string[];
const mockFetch = jest.fn();

beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

beforeEach(() => {
  serverIds = ['addr-tlv', 'addr-venus'];
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'DELETE') {
      const id = url.split('/').pop();
      serverIds = serverIds.filter((x) => x !== id);
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }
    const locale = new URL(url, 'http://test').searchParams.get('locale') ?? 'en';
    return { ok: true, status: 200, json: async () => ({ success: true, data: { addresses: bookFor(locale, serverIds) } }) };
  });
});

function gets(): number {
  return mockFetch.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method !== 'DELETE').length;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

interface Props {
  locale?: Lang;
  refreshKey?: number;
  initialBook?: { locale: string; addresses: KnownAddress[] };
  matchCurrent?: (option: KnownAddress) => boolean;
  current?: StructuredAddress;
  onSelectedChange: jest.Mock;
  onSelect: jest.Mock;
}

function picker(p: Props) {
  return (
    <SavedAddressPicker
      use={p.matchCurrent ? 'marketing' : 'profile'}
      selectedId={null}
      onSelectedChange={p.onSelectedChange}
      onSelect={p.onSelect}
      matchCurrent={p.matchCurrent}
      current={p.current}
      locale={p.locale ?? 'en'}
      refreshKey={p.refreshKey}
      t={t}
      initialBook={p.initialBook}
    />
  );
}

function spies() {
  return { onSelectedChange: jest.fn(), onSelect: jest.fn() };
}

const seedEn = () => ({ locale: 'en', addresses: bookFor('en', serverIds) });
const matchVenus = (option: KnownAddress) => option.id === 'addr-venus';

describe('a seeded book', () => {
  it('T-P1: same locale → no request, and the list is in the first render', () => {
    const s = spies();
    render(picker({ ...s, initialBook: seedEn(), matchCurrent: () => false }));
    // Synchronously after render: no waitFor, no empty frame.
    expect(screen.getByText('Your addresses')).toBeTruthy();
    expect(screen.getByText(labelOf('addr-venus', 'en'))).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('T-P1: stays without a request after the effects have run', async () => {
    const s = spies();
    render(picker({ ...s, initialBook: seedEn(), matchCurrent: () => false }));
    await settle();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('T-P2: text form, a default in the seed and no match → nothing reported, nothing filled (F-18)', async () => {
    const s = spies();
    render(picker({ ...s, initialBook: seedEn(), matchCurrent: () => false }));
    await settle();
    expect(s.onSelectedChange).not.toHaveBeenCalled();
    expect(s.onSelect).not.toHaveBeenCalled();
  });

  it("T-P3: text form with a match → onSelectedChange(id, 'derived') once, onSelect never", async () => {
    const s = spies();
    render(picker({ ...s, initialBook: seedEn(), matchCurrent: matchVenus }));
    // Before paint: the layout effect has already reported it.
    expect(s.onSelectedChange).toHaveBeenCalledTimes(1);
    await settle();
    expect(s.onSelectedChange).toHaveBeenCalledTimes(1);
    expect(s.onSelectedChange).toHaveBeenCalledWith('addr-venus', 'derived');
    expect(s.onSelect).not.toHaveBeenCalled();
  });

  it.each([
    ['text form, a match', { matchCurrent: matchVenus }],
    ['text form, no match', { matchCurrent: () => false }],
    ['structured, empty form (takes the default)', { current: EMPTY }],
    ['structured, the form holds an entry', { current: ELSEWHERE }],
    ['structured, the form holds something else', { current: { ...ELSEWHERE, line1: '2 Other St' } }],
  ])('T-P4: parity, %s: seeded and fetched report the same calls', async (_case, extra) => {
    const seeded = spies();
    const a = render(picker({ ...seeded, ...extra, initialBook: seedEn() }));
    await settle();
    a.unmount();

    const fetched = spies();
    render(picker({ ...fetched, ...extra }));
    await waitFor(() => expect(gets()).toBe(1));
    await settle();

    expect(seeded.onSelectedChange.mock.calls).toEqual(fetched.onSelectedChange.mock.calls);
    expect(seeded.onSelect.mock.calls).toEqual(fetched.onSelect.mock.calls);
  });

  it('T-P4: the structured empty form takes the default from the seed, as from a fetch', async () => {
    const s = spies();
    render(picker({ ...s, current: EMPTY, initialBook: seedEn() }));
    await settle();
    expect(s.onSelectedChange).toHaveBeenCalledWith('addr-venus', 'derived');
    expect(s.onSelect).toHaveBeenCalledWith(VENUS);
  });

  it.each([
    ['with a seed', true],
    ['without a seed', false],
  ])('T-P5: a delete reads the book once more (%s)', async (_case, seeded) => {
    const s = spies();
    render(picker({ ...s, matchCurrent: () => false, initialBook: seeded ? seedEn() : undefined }));
    await screen.findByText('Your addresses');
    await settle();
    const before = gets();

    const row = screen.getByText(labelOf('addr-tlv', 'en')).closest('label') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Remove this address' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByText(labelOf('addr-tlv', 'en'))).toBeNull());
    await settle();
    expect(gets() - before).toBe(1);
  });

  it('T-P6: a refreshKey change reads the book again', async () => {
    const s = spies();
    const view = render(picker({ ...s, matchCurrent: () => false, initialBook: seedEn(), refreshKey: 0 }));
    await settle();
    expect(gets()).toBe(0);
    view.rerender(picker({ ...s, matchCurrent: () => false, initialBook: seedEn(), refreshKey: 1 }));
    await waitFor(() => expect(gets()).toBe(1));
  });

  it('T-P6: a locale change reads the book again', async () => {
    const s = spies();
    const view = render(picker({ ...s, matchCurrent: () => false, initialBook: seedEn(), locale: 'en' }));
    await settle();
    view.rerender(picker({ ...s, matchCurrent: () => false, initialBook: seedEn(), locale: 'es' }));
    await waitFor(() => expect(gets()).toBe(1));
    expect(mockFetch.mock.calls[0][0]).toBe('/api/business-os/addresses?locale=es');
    await screen.findByText(labelOf('addr-venus', 'es'));
  });

  it("T-P7: a seed for another locale is ignored: one request, as today, and the picker's own labels", async () => {
    const s = spies();
    render(picker({ ...s, matchCurrent: () => false, initialBook: seedEn(), locale: 'he' }));
    // Not shown from the seed: nothing until the read lands.
    expect(screen.queryByText('Your addresses')).toBeNull();
    await screen.findByText(labelOf('addr-venus', 'he'));
    expect(gets()).toBe(1);
    expect(screen.queryByText(labelOf('addr-venus', 'en'))).toBeNull();
  });

  it.each([
    ['text form', { matchCurrent: matchVenus }, 1, 0],
    ['structured, empty form', { current: EMPTY }, 1, 1],
  ])('T-P8: StrictMode with a seed (%s): zero requests, and the selection is derived exactly once', async (_case, extra, changes, selects) => {
    const s = spies();
    render(<React.StrictMode>{picker({ ...s, ...extra, initialBook: seedEn() })}</React.StrictMode>);
    await settle();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(s.onSelectedChange).toHaveBeenCalledTimes(changes);
    expect(s.onSelect).toHaveBeenCalledTimes(selects);

    // The same counts as the fetched path under StrictMode, whose cancelled
    // first run derives nothing.
    const fetched = spies();
    render(<React.StrictMode>{picker({ ...fetched, ...extra })}</React.StrictMode>);
    await waitFor(() => expect(gets()).toBeGreaterThan(0));
    await settle();
    expect(fetched.onSelectedChange).toHaveBeenCalledTimes(changes);
    expect(fetched.onSelect).toHaveBeenCalledTimes(selects);
  });

  it('T-P9: an empty seed renders nothing, as an empty fetched book does', async () => {
    const s = spies();
    const { container } = render(picker({ ...s, matchCurrent: () => false, initialBook: { locale: 'en', addresses: [] } }));
    expect(container.firstChild).toBeNull();
    await settle();
    expect(container.firstChild).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('T-P10: a he seed, then en, then he again → 2 requests, and the labels follow the language', async () => {
    const s = spies();
    const seedHe = { locale: 'he', addresses: bookFor('he', serverIds) };
    const view = render(picker({ ...s, matchCurrent: () => false, initialBook: seedHe, locale: 'he' }));
    expect(screen.getByText(labelOf('addr-venus', 'he'))).toBeTruthy();
    await settle();
    expect(gets()).toBe(0);

    view.rerender(picker({ ...s, matchCurrent: () => false, initialBook: seedHe, locale: 'en' }));
    await screen.findByText(labelOf('addr-venus', 'en'));
    expect(gets()).toBe(1);

    view.rerender(picker({ ...s, matchCurrent: () => false, initialBook: seedHe, locale: 'he' }));
    await waitFor(() => expect(gets()).toBe(2));
    await screen.findByText(labelOf('addr-venus', 'he'));
    expect(mockFetch.mock.calls[1][0]).toBe('/api/business-os/addresses?locale=he');
  });
});
