/**
 * @jest-environment jsdom
 *
 * The address book beside a form that stores its address as TEXT (F-18).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The marketing postal line is one line of free text. The picker cannot compare
 * it part by part, so it cannot tell whether it is "empty", and its default
 * fill used to write the book's default over the stored legal postal line on
 * every open. A caller that stores text passes `matchCurrent`, and the picker
 * then only MARKS the entry the caller recognises. It never fills by itself.
 *
 * The structured behaviour (profile, invoice) is pinned, unchanged, by
 * `SavedAddressPicker.default.test.tsx`. This file is a separate one on
 * purpose, so that file stays untouched as the pin for the other callers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { render, waitFor, screen, fireEvent } from '@testing-library/react';

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

const COPY: Record<string, string> = {
  'settings.address.book_title': 'Your addresses',
  'settings.address.add_new': 'Add a new address',
  'settings.address.edit': 'Edit this address',
  'settings.address.delete': 'Remove this address',
  'settings.address.delete_title': 'Remove this address?',
  'settings.address.delete_confirm': 'Anywhere already using it keeps showing it.',
  'button.cancel': 'Cancel',
  'settings.address.delete_action': 'Remove',
  'settings.address.used_by.profile': 'Shown to clients as your business address',
  'settings.address.used_by.invoice': 'Your invoices go out with this one',
};

const t = (key: string) => COPY[key] ?? key;

const entry = (over: Partial<KnownAddress> = {}): KnownAddress => ({
  id: 'addr-venus',
  label: '14 Venus Drive, Closter, NJ, 07624, United States',
  name: null,
  address: VENUS,
  isDefault: true,
  usedBy: [],
  ...over,
});

const TLV = entry({ id: 'addr-tlv', label: '1 Rothschild Blvd, Tel Aviv, Israel', address: ELSEWHERE, isDefault: false });

/** The book on every GET; a DELETE succeeds and removes the entry from later GETs. */
function mockBook(addresses: KnownAddress[]) {
  let book = [...addresses];
  global.fetch = jest.fn().mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'DELETE') {
      const id = url.split('/').pop();
      book = book.filter((option) => option.id !== id);
      return { ok: true, json: async () => ({ success: true }) };
    }
    return { ok: true, json: async () => ({ success: true, data: { addresses: book } }) };
  }) as unknown as typeof fetch;
}

function gets(): number {
  return (global.fetch as jest.Mock).mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method !== 'DELETE').length;
}

function mountText(matchCurrent: (option: KnownAddress) => boolean, selectedId: string | null = null) {
  const onSelectedChange = jest.fn();
  const onSelect = jest.fn();

  const view = render(
    <SavedAddressPicker
      use="marketing"
      selectedId={selectedId}
      onSelectedChange={onSelectedChange}
      onSelect={onSelect}
      matchCurrent={matchCurrent}
      locale="en"
      isRTL={false}
      t={t}
    />
  );

  return { ...view, onSelectedChange, onSelect };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

afterEach(() => jest.restoreAllMocks());

describe('a text form: recognise, never fill', () => {
  it('P-1: matches nothing, with a default in the book: nothing is reported and nothing filled', async () => {
    mockBook([TLV, entry()]);
    const { onSelectedChange, onSelect } = mountText(() => false);

    await screen.findByText('Your addresses');
    await settle();
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('P-2: marks the entry the caller recognises, and copies nothing', async () => {
    mockBook([entry(), TLV]);
    const { onSelectedChange, onSelect } = mountText((option) => option.id === 'addr-tlv');

    await waitFor(() => expect(onSelectedChange).toHaveBeenCalledWith('addr-tlv', 'derived'));
    expect(onSelectedChange).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  /*
   * The case `SavedAddressPicker.default.test.tsx` pins as "takes the default
   * and fills the fields when the form is empty" must NOT happen here.
   */
  it('P-3: a form that "looks empty" does not take the default', async () => {
    mockBook([TLV, entry({ isDefault: true })]);
    const { onSelectedChange, onSelect } = mountText(() => false);

    await screen.findByText('Your addresses');
    await settle();
    expect(onSelectedChange).not.toHaveBeenCalledWith('addr-venus', 'derived');
    expect(onSelect).not.toHaveBeenCalled();
  });

  /*
   * Exactly two GETs: the first read and the refetch after the delete. A
   * re-render with a NEW predicate (every render of the panel makes one) must
   * not refetch, because the predicate is read through a ref (C-1, C-7).
   */
  it('P-4: deleting refetches once and still fills nothing; a new predicate does not refetch', async () => {
    mockBook([entry(), TLV]);
    const onSelect = jest.fn();
    const onSelectedChange = jest.fn();
    const renderWith = (match: (option: KnownAddress) => boolean) => (
      <SavedAddressPicker
        use="marketing"
        selectedId={null}
        onSelectedChange={onSelectedChange}
        onSelect={onSelect}
        matchCurrent={match}
        locale="en"
        t={t}
      />
    );
    const { rerender } = render(renderWith(() => false));

    await screen.findByText('Your addresses');
    rerender(renderWith(() => false));
    rerender(renderWith(() => false));

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this address' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByText('1 Rothschild Blvd, Tel Aviv, Israel')).toBeNull());
    rerender(renderWith(() => false));
    await settle();

    expect(gets()).toBe(2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('P-5: does not re-derive over a selection the caller already has', async () => {
    mockBook([entry(), TLV]);
    const { onSelectedChange, onSelect } = mountText((option) => option.id === 'addr-venus', 'addr-tlv');

    await screen.findByText('Your addresses');
    await settle();
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('P-5b: a click on an entry still fills, as on every screen', async () => {
    mockBook([entry()]);
    const { onSelectedChange, onSelect } = mountText(() => false);

    fireEvent.click(await screen.findByRole('radio', { name: /14 Venus Drive/ }));
    expect(onSelectedChange).toHaveBeenCalledWith('addr-venus', 'chosen');
    expect(onSelect).toHaveBeenCalledWith(VENUS);
  });
});

describe('the marketing form', () => {
  it('P-6: every radio is in its own group, saved-address-marketing', async () => {
    mockBook([entry(), TLV]);
    mountText(() => false);

    const radios = (await screen.findAllByRole('radio')) as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(radio.name).toBe('saved-address-marketing');
  });

  it('P-7: names every other use on the marketing screen, one line each, and still only the other one on the profile screen', async () => {
    mockBook([entry({ usedBy: ['profile', 'invoice'] })]);
    const { unmount } = mountText(() => false);

    const invoiceLine = await screen.findByText(COPY['settings.address.used_by.invoice']);
    const profileLine = screen.getByText(COPY['settings.address.used_by.profile']);
    // Same markup as before: a bare span each, no wrapper, siblings of the address.
    for (const line of [profileLine, invoiceLine]) {
      expect(line.tagName).toBe('SPAN');
      expect(line.className).toBe('mt-1 block text-[11px]');
    }
    expect(profileLine.parentElement).toBe(invoiceLine.parentElement);
    unmount();

    render(
      <SavedAddressPicker
        use="profile"
        selectedId="addr-venus"
        onSelect={jest.fn()}
        locale="en"
        t={t}
      />
    );
    const only = await screen.findByText(COPY['settings.address.used_by.invoice']);
    expect(only.className).toBe('mt-1 block text-[11px]');
    expect(screen.queryByText(COPY['settings.address.used_by.profile'])).toBeNull();
  });

  it('P-8: the "none of these" row takes the caller\'s words, and keeps "Add a new address" without them', async () => {
    mockBook([entry()]);
    const { unmount } = render(
      <SavedAddressPicker
        use="marketing"
        onSelect={jest.fn()}
        matchCurrent={() => false}
        otherLabel="Enter a different address"
        locale="en"
        t={t}
      />
    );
    expect(await screen.findByRole('radio', { name: /Enter a different address/ })).toBeTruthy();
    expect(screen.queryByText('Add a new address')).toBeNull();
    unmount();

    mountText(() => false);
    expect(await screen.findByRole('radio', { name: /Add a new address/ })).toBeTruthy();
  });
});
