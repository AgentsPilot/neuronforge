/**
 * @jest-environment jsdom
 *
 * The address book as a form sees it: what is listed, and what is selected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This control used to offer "the other column" — a business had two addresses
 * because `business_profiles` had two columns, so the list was named after
 * storage ("Billing address"), could show only one alternative, and EXCLUDED
 * the address the form was actually using. Nothing was ever selected, so the
 * screen said "use an address you already have" above a form holding a
 * different one.
 *
 * Now it lists the book and marks the entry this form is on. The three
 * situations that matter are about what gets selected, and one of them is
 * destructive if it goes the other way:
 *
 *   EMPTY FORM      → take the default and fill the fields. Nothing to lose,
 *                     and a blank form beside an unselected list is what sent
 *                     owners back to retyping what they had already given us.
 *   FORM MATCHES    → mark that entry, copy nothing.
 *   FORM DIFFERS    → leave it alone. A business whose public address is
 *                     genuinely not where it is billed must not have one
 *                     dropped on top of the other.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { render, waitFor, screen, fireEvent } from '@testing-library/react';

import { SavedAddressPicker, type KnownAddress } from '../SavedAddressPicker';
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

const EMPTY: StructuredAddress = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
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

const entry = (over: Partial<KnownAddress> = {}): KnownAddress => ({
  id: 'addr-venus',
  label: '14 Venus Drive, Closter, NJ, 07624, United States',
  name: null,
  address: VENUS,
  isDefault: true,
  usedBy: [],
  ...over,
});

function mockBook(addresses: KnownAddress[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { addresses } }),
  }) as unknown as typeof fetch;
}

function mount(current: StructuredAddress, selectedId: string | null = null) {
  const onSelectedChange = jest.fn();
  const onSelect = jest.fn();

  const view = render(
    <SavedAddressPicker
      use="profile"
      current={current}
      selectedId={selectedId}
      onSelectedChange={onSelectedChange}
      onSelect={onSelect}
      locale="en"
      isRTL={false}
      t={(key: string) => COPY[key] ?? key}
    />
  );

  return { ...view, onSelectedChange, onSelect };
}

afterEach(() => jest.restoreAllMocks());

describe('what it lists', () => {
  it('shows the saved addresses and a way to add another', async () => {
    mockBook([entry(), entry({ id: 'addr-tlv', label: '1 Rothschild Blvd, Tel Aviv, Israel', address: ELSEWHERE, isDefault: false })]);
    mount(EMPTY);

    await screen.findByText('Your addresses');
    expect(screen.getByText('14 Venus Drive, Closter, NJ, 07624, United States')).toBeTruthy();
    expect(screen.getByText('1 Rothschild Blvd, Tel Aviv, Israel')).toBeTruthy();
    expect(screen.getByText('Add a new address')).toBeTruthy();
  });

  /* The ADDRESS is the name. A business recognises where it is; it does not
     recognise which column we kept it in. */
  it('leads with the owner’s own name for an address when they gave one', async () => {
    mockBook([entry({ name: 'The studio' })]);
    mount(EMPTY);

    await screen.findByText('The studio');
    // The rendered line stays underneath, so the address is still readable.
    expect(screen.getByText('14 Venus Drive, Closter, NJ, 07624, United States')).toBeTruthy();
  });

  /*
   * Said only where it is NOT the screen you are on. "Your invoices use this
   * one" is worth knowing on the profile; on the invoice screen it is a label
   * saying "this is the screen you are on".
   */
  it('says what an entry is used for elsewhere, and not what it is used for here', async () => {
    mockBook([entry({ usedBy: ['profile', 'invoice'] })]);
    mount(EMPTY);

    await screen.findByText('Your invoices go out with this one');
    expect(screen.queryByText('Shown to clients as your business address')).toBeNull();
  });

  /* No book, no picker — the right screen for a business adding its first
     address is the fields, not an empty list. */
  it('renders nothing at all when the book is empty', async () => {
    mockBook([]);
    const { container } = mount(EMPTY);

    await waitFor(() => expect((global.fetch as jest.Mock)).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});

describe('what it selects', () => {
  it('takes the default and fills the fields when the form is empty', async () => {
    mockBook([
      entry({ id: 'addr-tlv', address: ELSEWHERE, isDefault: false }),
      entry({ id: 'addr-venus', isDefault: true }),
    ]);
    const { onSelectedChange, onSelect } = mount(EMPTY);

    await waitFor(() => expect(onSelectedChange).toHaveBeenCalledWith('addr-venus', 'derived'));
    expect(onSelect).toHaveBeenCalledWith(VENUS);
  });

  it('marks the entry the form is already holding, and copies nothing', async () => {
    mockBook([entry()]);
    const { onSelectedChange, onSelect } = mount(VENUS);

    await waitFor(() => expect(onSelectedChange).toHaveBeenCalledWith('addr-venus', 'derived'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  /*
   * THE ONE THAT MUST NOT CHANGE. A business billed in New Jersey and visited
   * in Tel Aviv has two real addresses, and the public one is not a draft of
   * the billing one.
   */
  it('leaves a genuinely different address alone', async () => {
    mockBook([entry()]);
    const { onSelectedChange, onSelect } = mount(ELSEWHERE);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not re-derive over a choice the owner has already made', async () => {
    mockBook([entry(), entry({ id: 'addr-tlv', address: ELSEWHERE, isDefault: false })]);
    const { onSelectedChange } = mount(EMPTY, 'addr-tlv');

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(onSelectedChange).not.toHaveBeenCalled();
  });
});

describe('choosing', () => {
  it('reports the id and fills the fields', async () => {
    mockBook([entry()]);
    const { onSelectedChange, onSelect } = mount(ELSEWHERE);

    const radio = await screen.findByRole('radio', {
      name: /14 Venus Drive/,
    });
    fireEvent.click(radio);

    expect(onSelectedChange).toHaveBeenCalledWith('addr-venus', 'chosen');
    expect(onSelect).toHaveBeenCalledWith(VENUS);
  });

  /* `null` is what opens the fields. It must not copy anything in — the owner
     asked for a new address, not a duplicate of an old one. */
  it('reports null for "add a new address", copying nothing', async () => {
    mockBook([entry()]);
    const { onSelectedChange, onSelect } = mount(VENUS, 'addr-venus');

    fireEvent.click(await screen.findByRole('radio', { name: /Add a new address/ }));

    expect(onSelectedChange).toHaveBeenCalledWith(null, 'chosen');
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('removing an entry', () => {
  /*
   * THE PLATFORM'S DIALOG, not `window.confirm`. This component held the only
   * `window.confirm` in the codebase: OS chrome, in the browser's language
   * rather than the reader's, and unable to show WHICH address it was about to
   * remove — which is the one thing that matters when two rows read
   * "14 Venus Drive, Closter".
   */
  it('asks in the platform dialog, naming the address', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm');
    mockBook([entry()]);
    mount(VENUS, 'addr-venus');

    fireEvent.click(await screen.findByRole('button', { name: 'Remove this address' }));

    expect(await screen.findByText('Remove this address?')).toBeTruthy();
    // The address itself, so the owner can see which row they hit.
    expect(screen.getAllByText('14 Venus Drive, Closter, NJ, 07624, United States').length).toBeGreaterThan(0);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('deletes nothing until it is confirmed', async () => {
    mockBook([entry()]);
    mount(VENUS, 'addr-venus');

    fireEvent.click(await screen.findByRole('button', { name: 'Remove this address' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(global.fetch).toHaveBeenCalledTimes(1); // the initial book read only
    expect(screen.queryByText('Remove this address?')).toBeNull();
  });

  it('calls the delete endpoint once confirmed', async () => {
    mockBook([entry()]);
    mount(VENUS, 'addr-venus');

    fireEvent.click(await screen.findByRole('button', { name: 'Remove this address' }));
    // The dialog's action has its own word, so it is unambiguous against the
    // row's icon button — which is the point of giving it one.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/business-os/addresses/addr-venus', { method: 'DELETE' })
    );
  });
});

describe('editing an entry', () => {
  /*
   * Pressing the pencil must not select the row, and must not submit the form
   * these controls sit inside — they live INSIDE the `<label>` that selects.
   */
  it('reports the entry without changing the selection', async () => {
    mockBook([entry()]);
    const onEdit = jest.fn();

    render(
      <SavedAddressPicker
        use="profile"
        current={ELSEWHERE}
        selectedId={null}
        onSelectedChange={jest.fn()}
        onSelect={jest.fn()}
        onEdit={onEdit}
        locale="en"
        isRTL={false}
        t={(key: string) => COPY[key] ?? key}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit this address' }));

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'addr-venus' }));
  });

  it('keeps the edited entry marked, rather than moving the mark to "add new"', async () => {
    mockBook([entry()]);
    mount(VENUS, 'addr-venus');

    const chosen = await screen.findByRole('radio', { name: /14 Venus Drive/ });
    const addNew = screen.getByRole('radio', { name: /Add a new address/ });

    // The selection belongs to the entry being corrected, not to a new address
    // the owner never asked to create.
    expect((chosen as HTMLInputElement).checked).toBe(true);
    expect((addNew as HTMLInputElement).checked).toBe(false);
  });

  it('offers no pencil when the caller cannot handle editing', async () => {
    mockBook([entry()]);
    mount(VENUS, 'addr-venus');

    expect(screen.queryByRole('button', { name: 'Edit this address' })).toBeNull();
  });
});
