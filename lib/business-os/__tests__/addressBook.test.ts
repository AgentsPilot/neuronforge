/**
 * Saving an address from a form, and what it does to the book.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN ENTRY MEANS ONE ADDRESS. Correcting it corrects it everywhere it is used.
 *
 * This once FORKED a shared entry, so correcting the profile's address could
 * not change the invoice's. That was right while the two were separate records
 * that merely looked alike. It became wrong the moment the book worked: an
 * owner who picks ONE address for both uses then got a near-duplicate on every
 * save, the profile moving to a new entry and the invoice left on the old one.
 *
 * So the rules under test are:
 *
 *   EDITING an entry   → corrected in place, and EVERY use pointing at it gets
 *                        the refreshed copy. Refreshing only the form that did
 *                        it leaves the other rendering a stale address, which is
 *                        the drift the book was added to end.
 *   SELECTING another  → points at that one; nothing is written.
 *   A NEW address      → a new entry, and diverging is this and only this.
 *
 * Every collaborator is faked: no Supabase.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const mockGetPointers = jest.fn();
const mockSetPointer = jest.fn();
const mockFindById = jest.fn();
const mockFindOrCreate = jest.fn();
const mockUpdate = jest.fn();
const mockList = jest.fn();
const mockDelete = jest.fn();
const mockSetDefault = jest.fn();

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    getAddressPointers: (...a: unknown[]) => mockGetPointers(...a),
    setAddressPointer: (...a: unknown[]) => mockSetPointer(...a),
  },
}));

jest.mock('@/lib/repositories/BusinessAddressRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/BusinessAddressRepository');
  return {
    // The real comparison, so "is this the same address" cannot drift between
    // the service and the repository that defines it.
    sameParts: actual.sameParts,
    businessAddressRepository: {
      findById: (...a: unknown[]) => mockFindById(...a),
      findOrCreate: (...a: unknown[]) => mockFindOrCreate(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      list: (...a: unknown[]) => mockList(...a),
      delete: (...a: unknown[]) => mockDelete(...a),
      setDefault: (...a: unknown[]) => mockSetDefault(...a),
    },
  };
});

import { saveAddressForUse, updateBookEntry, deleteBookEntry } from '../addressBook';

const USER = 'user-1';

const VENUS = {
  line1: '14 Venus Drive',
  line2: '',
  city: 'Closter',
  state: 'NJ',
  postal_code: '07624',
  country: 'US',
};

/** The same street, corrected. */
const VENUS_FIXED = { ...VENUS, line1: '14 Venus Drive, Suite 2' };

const entry = (id: string, parts: Record<string, unknown>) => ({
  id,
  user_id: USER,
  parts,
  label: null,
  is_default: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSetPointer.mockResolvedValue({ data: { updated: true }, error: null });
  mockUpdate.mockImplementation(async (id: string, _u: string, changes: { parts: unknown }) => ({
    data: entry(id, changes.parts as Record<string, unknown>),
    error: null,
  }));
  mockFindOrCreate.mockResolvedValue({ data: entry('addr-new', VENUS_FIXED), error: null });
  mockFindById.mockResolvedValue({ data: entry('addr-shared', VENUS), error: null });
  mockList.mockResolvedValue({ data: [], error: null });
  mockDelete.mockResolvedValue({ data: { deleted: true }, error: null });
  mockSetDefault.mockResolvedValue({ data: entry('addr-next', VENUS), error: null });
});

describe('an address both uses point at', () => {
  beforeEach(() => {
    mockGetPointers.mockResolvedValue({
      data: { address_id: 'addr-shared', invoice_address_id: 'addr-shared' },
      error: null,
    });
  });

  /*
   * THE ONE THAT CHANGED. This used to fork, which split one chosen address
   * back into two on every correction.
   */
  it('corrects the shared entry rather than creating another', async () => {
    const result = await saveAddressForUse({ userId: USER, use: 'profile', parts: VENUS_FIXED });

    expect(result.error).toBeNull();
    expect(result.data!.forked).toBe(false);
    expect(result.data!.address.id).toBe('addr-shared');
    expect(mockUpdate).toHaveBeenCalledWith('addr-shared', USER, { parts: VENUS_FIXED });
    // No new entry: the book does not grow for a typo.
    expect(mockFindOrCreate).not.toHaveBeenCalled();
  });

  /*
   * BOTH copies are refreshed. `invoice_address` is what the invoice PDF
   * renders; leaving it on the old parts would put the book and the document
   * back out of step, which is the whole failure this table exists to end.
   */
  it('refreshes the rendered copy for both uses', async () => {
    await saveAddressForUse({ userId: USER, use: 'profile', parts: VENUS_FIXED });

    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'profile', 'addr-shared', VENUS_FIXED);
    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'invoice', 'addr-shared', VENUS_FIXED);
  });

  it('does the same from the invoice side', async () => {
    await saveAddressForUse({ userId: USER, use: 'invoice', parts: VENUS_FIXED });

    expect(mockUpdate).toHaveBeenCalledWith('addr-shared', USER, { parts: VENUS_FIXED });
    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'invoice', 'addr-shared', VENUS_FIXED);
    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'profile', 'addr-shared', VENUS_FIXED);
  });

  it('writes nothing at all when the address did not change', async () => {
    const result = await saveAddressForUse({ userId: USER, use: 'profile', parts: VENUS });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.data!.address.id).toBe('addr-shared');
  });
});

describe('an address only this use points at', () => {
  beforeEach(() => {
    mockGetPointers.mockResolvedValue({
      data: { address_id: 'addr-mine', invoice_address_id: null },
      error: null,
    });
    mockFindById.mockResolvedValue({ data: entry('addr-mine', VENUS), error: null });
  });

  /*
   * Corrected where it stands. Forking here would leave an orphan entry behind
   * every typo and refill the book with near-duplicates.
   */
  it('corrects it in place, creating nothing', async () => {
    const result = await saveAddressForUse({ userId: USER, use: 'profile', parts: VENUS_FIXED });

    expect(result.data!.forked).toBe(false);
    expect(result.data!.address.id).toBe('addr-mine');
    expect(mockUpdate).toHaveBeenCalledWith('addr-mine', USER, { parts: VENUS_FIXED });
    expect(mockFindOrCreate).not.toHaveBeenCalled();
  });

  /* An unchanged save must not bump `updated_at` or read as an edit. */
  it('writes nothing when the address did not change', async () => {
    const result = await saveAddressForUse({ userId: USER, use: 'profile', parts: VENUS });

    expect(result.error).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.data!.address.id).toBe('addr-mine');
  });
});

describe('a business with no address yet', () => {
  beforeEach(() => {
    mockGetPointers.mockResolvedValue({
      data: { address_id: null, invoice_address_id: null },
      error: null,
    });
    mockFindOrCreate.mockResolvedValue({ data: entry('addr-first', VENUS), error: null });
  });

  it('adds the first entry and points this use at it', async () => {
    const result = await saveAddressForUse({ userId: USER, use: 'profile', parts: VENUS });

    expect(result.data!.address.id).toBe('addr-first');
    expect(result.data!.forked).toBe(false);
    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'profile', 'addr-first', VENUS);
  });

  /*
   * The invoice form choosing the address the profile already saved points at
   * the SAME row, rather than writing a second copy of it. That sharing is the
   * reason the book exists; the fork rule above is what keeps it safe.
   */
  it('shares the profile entry when billing picks the same address', async () => {
    mockGetPointers.mockResolvedValue({
      data: { address_id: 'addr-first', invoice_address_id: null },
      error: null,
    });
    mockFindOrCreate.mockResolvedValue({ data: entry('addr-first', VENUS), error: null });

    const result = await saveAddressForUse({ userId: USER, use: 'invoice', parts: VENUS });

    expect(result.data!.address.id).toBe('addr-first');
    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'invoice', 'addr-first', VENUS);
  });
});

describe('refusals', () => {
  it('refuses an empty address rather than writing a blank entry', async () => {
    const result = await saveAddressForUse({
      userId: USER,
      use: 'profile',
      parts: { line1: '', line2: '', city: '', state: '', postal_code: '', country: '' },
    });

    expect(result.error).toBeTruthy();
    expect(mockFindOrCreate).not.toHaveBeenCalled();
    expect(mockSetPointer).not.toHaveBeenCalled();
  });

  /* An unreadable pointer read must not be treated as "nothing is shared" —
     that is the reading under which a shared row gets rewritten. */
  it('stops when it cannot tell what the pointers are', async () => {
    mockGetPointers.mockResolvedValue({ data: null, error: new Error('connection reset') });

    const result = await saveAddressForUse({ userId: USER, use: 'profile', parts: VENUS_FIXED });

    expect(result.error).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetPointer).not.toHaveBeenCalled();
  });
});

describe('editing the ENTRY, as opposed to a form', () => {
  /*
   * This one DOES propagate, and it is not a contradiction of the fork rule.
   *
   * Editing the address on a form is a statement about that form. Editing the
   * saved entry is a statement that the entry is wrong — and a record corrected
   * once being corrected everywhere is the reason the book exists. The list
   * tells the owner which uses an entry has before they press the pencil.
   */
  it('refreshes the copy of every use pointing at it', async () => {
    mockGetPointers.mockResolvedValue({
      data: { address_id: 'addr-shared', invoice_address_id: 'addr-shared' },
      error: null,
    });

    const result = await updateBookEntry({
      userId: USER,
      addressId: 'addr-shared',
      parts: VENUS_FIXED,
    });

    expect(result.error).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith('addr-shared', USER, { parts: VENUS_FIXED, label: undefined });
    // Both copies, or the book says one thing and the invoice PDF renders another.
    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'profile', 'addr-shared', VENUS_FIXED);
    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'invoice', 'addr-shared', VENUS_FIXED);
  });

  it('touches no copy when nothing points at the entry', async () => {
    mockGetPointers.mockResolvedValue({
      data: { address_id: 'addr-other', invoice_address_id: null },
      error: null,
    });

    await updateBookEntry({ userId: USER, addressId: 'addr-spare', parts: VENUS_FIXED });

    expect(mockSetPointer).not.toHaveBeenCalled();
  });

  /* Renaming changes nothing any reader renders, so it must not rewrite copies
     — or read as an address change in anything watching those columns. */
  it('does not touch the copies for a rename', async () => {
    await updateBookEntry({ userId: USER, addressId: 'addr-shared', label: 'The studio' });

    expect(mockUpdate).toHaveBeenCalledWith('addr-shared', USER, { parts: undefined, label: 'The studio' });
    expect(mockGetPointers).not.toHaveBeenCalled();
    expect(mockSetPointer).not.toHaveBeenCalled();
  });

  it('refuses to empty an entry', async () => {
    const result = await updateBookEntry({
      userId: USER,
      addressId: 'addr-shared',
      parts: { line1: '', line2: '', city: '', state: '', postal_code: '', country: '' },
    });

    expect(result.error).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('deleting an entry', () => {
  it('removes it and leaves the addresses in use alone', async () => {
    mockFindById.mockResolvedValue({ data: { ...entry('addr-spare', VENUS), is_default: false }, error: null });

    const result = await deleteBookEntry({ userId: USER, addressId: 'addr-spare' });

    expect(result.error).toBeNull();
    expect(mockDelete).toHaveBeenCalledWith('addr-spare', USER);
    // The pointers are ON DELETE SET NULL and the rendered copies stay, so
    // nothing a client sees changes. Nothing here rewrites them.
    expect(mockSetPointer).not.toHaveBeenCalled();
  });

  /*
   * A book with no default leaves the next empty form with nothing to offer,
   * which sends the owner back to typing an address they already gave us.
   */
  it('moves the default when the deleted entry held it', async () => {
    mockFindById.mockResolvedValue({ data: entry('addr-default', VENUS), error: null });
    mockList.mockResolvedValue({
      data: [{ ...entry('addr-next', VENUS), is_default: false }],
      error: null,
    });

    await deleteBookEntry({ userId: USER, addressId: 'addr-default' });

    expect(mockSetDefault).toHaveBeenCalledWith('addr-next', USER);
  });

  it('needs no default for a book it has just emptied', async () => {
    mockFindById.mockResolvedValue({ data: entry('addr-only', VENUS), error: null });
    mockList.mockResolvedValue({ data: [], error: null });

    const result = await deleteBookEntry({ userId: USER, addressId: 'addr-only' });

    expect(result.error).toBeNull();
    expect(mockSetDefault).not.toHaveBeenCalled();
  });

  it('refuses an id that is not this owner\'s', async () => {
    mockFindById.mockResolvedValue({ data: null, error: null });

    const result = await deleteBookEntry({ userId: USER, addressId: 'someone-elses' });

    expect(result.error!.message).toBe('Address not found');
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('editing an entry that is NOT the one this form points at', () => {
  /*
   * The list shows every saved address, so the pencil can be pressed on an
   * entry the current form does not use. Without `addressId` the save fell back
   * to the entry the FORM points at — so correcting the billing address from
   * the profile screen rewrote the PROFILE's entry with the billing one's
   * content, and left the billing entry untouched. Silently, and backwards.
   */
  beforeEach(() => {
    mockGetPointers.mockResolvedValue({
      data: { address_id: 'addr-profile', invoice_address_id: 'addr-billing' },
      error: null,
    });
  });

  it('corrects the entry that was opened, not the one the form was on', async () => {
    mockFindById.mockResolvedValue({ data: entry('addr-billing', VENUS), error: null });

    await saveAddressForUse({
      userId: USER,
      use: 'profile',
      parts: VENUS_FIXED,
      addressId: 'addr-billing',
    });

    expect(mockUpdate).toHaveBeenCalledWith('addr-billing', USER, { parts: VENUS_FIXED });
    // The form's own entry is never written with another entry's content.
    expect(mockUpdate).not.toHaveBeenCalledWith('addr-profile', USER, expect.anything());
  });

  /* And the use that already points at it keeps a copy that matches. */
  it('refreshes the copy of the use that already pointed at it', async () => {
    mockFindById.mockResolvedValue({ data: entry('addr-billing', VENUS), error: null });

    await saveAddressForUse({
      userId: USER,
      use: 'profile',
      parts: VENUS_FIXED,
      addressId: 'addr-billing',
    });

    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'profile', 'addr-billing', VENUS_FIXED);
    expect(mockSetPointer).toHaveBeenCalledWith(USER, 'invoice', 'addr-billing', VENUS_FIXED);
  });

  /* No id sent — an older client — keeps the previous behaviour rather than
     editing something arbitrary. */
  it("falls back to the form's own entry when no id is sent", async () => {
    mockFindById.mockResolvedValue({ data: entry('addr-profile', VENUS), error: null });

    await saveAddressForUse({ userId: USER, use: 'profile', parts: VENUS_FIXED });

    expect(mockUpdate).toHaveBeenCalledWith('addr-profile', USER, { parts: VENUS_FIXED });
  });
});
