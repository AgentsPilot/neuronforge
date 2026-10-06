/**
 * Which addresses a business already has, for offering instead of retyping.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The product asks a business for its address in four places — the profile, the
 * invoice settings, the marketing postal address and the Stripe wizard — and
 * none of them could see what another one held. This route is the one answer
 * they all read.
 *
 * The behaviours that matter are about what it REFUSES to offer: an address
 * with nothing in it, and anything belonging to another business.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockList = jest.fn();
const mockGetPointers = jest.fn();

jest.mock('@/lib/repositories/BusinessAddressRepository', () => ({
  businessAddressRepository: {
    list: (...args: unknown[]) => mockList(...args),
    findOrCreate: jest.fn(),
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    getAddressPointers: (...args: unknown[]) => mockGetPointers(...args),
  },
}));

import { GET } from '../route';

/** A book row as the repository returns it. */
const row = (id: string, parts: Record<string, unknown>, isDefault = false) => ({
  id,
  user_id: 'user-1',
  parts,
  label: null,
  is_default: isDefault,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const PROFILE = {
  line1: '14 Venus DR',
  city: 'Closter',
  state: 'NJ',
  postal_code: '07624',
  country: 'US',
};

const BILLING = { line1: '1 Rothschild', city: 'Tel Aviv', country: 'IL' };

function request(locale?: string) {
  const url = locale
    ? `http://localhost/api/business-os/addresses?locale=${locale}`
    : 'http://localhost/api/business-os/addresses';
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

const body = async (locale?: string) => (await GET(request(locale))).json();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ id: 'user-1' });
  mockList.mockResolvedValue({
    data: [row('addr-profile', PROFILE, true), row('addr-billing', BILLING)],
    error: null,
  });
  mockGetPointers.mockResolvedValue({
    data: { address_id: 'addr-profile', invoice_address_id: 'addr-billing' },
    error: null,
  });
});

describe('what it offers', () => {
  /*
   * An entry is no longer named by the COLUMN it came from — every address now
   * lives in one table. `usedBy` says which pointer references it, so a screen
   * can mark the entry its invoices go out with, and an entry used by both
   * carries both: that is the shared record the book exists to make possible.
   */
  it('returns the book, saying what each entry is used for', async () => {
    const result = await body();

    expect(result.success).toBe(true);
    expect(result.data.addresses.map((a: { usedBy: string[] }) => a.usedBy)).toEqual([
      ['profile'],
      ['invoice'],
    ]);
  });

  it('gives every entry an id, so a form can point at one', async () => {
    expect((await body()).data.addresses.map((a: { id: string }) => a.id)).toEqual([
      'addr-profile',
      'addr-billing',
    ]);
  });

  it('marks the default, which is the one a form with no address offers first', async () => {
    const [first, second] = (await body()).data.addresses;

    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
  });

  /*
   * One row, both uses. This is the whole point: correcting it corrects the
   * profile and the invoice together, which two columns could never do.
   */
  it('reports both uses when the profile and the invoice share an address', async () => {
    mockGetPointers.mockResolvedValue({
      data: { address_id: 'addr-profile', invoice_address_id: 'addr-profile' },
      error: null,
    });

    const [first] = (await body()).data.addresses;
    expect(first.usedBy).toEqual(['profile', 'invoice']);
  });

  /* An address saved but not yet used by anything is ordinary, not a fault. */
  it('offers an entry nothing points at', async () => {
    mockGetPointers.mockResolvedValue({
      data: { address_id: null, invoice_address_id: null },
      error: null,
    });

    expect((await body()).data.addresses.map((a: { usedBy: string[] }) => a.usedBy)).toEqual([[], []]);
  });

  it('labels each one as a person would read it', async () => {
    const [profile] = (await body()).data.addresses;

    expect(profile.label).toContain('14 Venus DR');
    expect(profile.label).toContain('Closter');
    // The country is a CODE in the column; a label saying "US" is not a label.
    expect(profile.label).not.toMatch(/\bUS\b/);
    expect(profile.label).toContain('United States');
  });

  it('writes the country in the reader’s language', async () => {
    const he = (await body('he')).data.addresses.find(
      (a: { id: string }) => a.id === 'addr-billing'
    );

    expect(he.label).toContain('ישראל');
  });

  it('falls back to English for a language it does not speak', async () => {
    const [profile] = (await body('kl')).data.addresses;

    expect(profile.label).toContain('United States');
  });

  it('carries the parts, not only the line', async () => {
    // The Stripe wizard fills line1/city/state/postal separately.
    const [profile] = (await body()).data.addresses;

    expect(profile.address).toMatchObject({ line1: '14 Venus DR', postal_code: '07624' });
  });
});

describe('what it refuses to offer', () => {
  it('leaves out an address with nothing in it', async () => {
    // An empty option offers the owner their own blank form.
    mockList.mockResolvedValue({
      data: [row('addr-profile', PROFILE, true), row('addr-empty', {})],
      error: null,
    });

    const ids = (await body()).data.addresses.map((a: { id: string }) => a.id);
    expect(ids).toEqual(['addr-profile']);
  });

  it('returns an empty list for a business that has given us none', async () => {
    // The pickers render nothing at all for this, which is most businesses.
    mockList.mockResolvedValue({ data: [], error: null });

    expect((await body()).data.addresses).toEqual([]);
  });

  it('refuses a caller with no session', async () => {
    mockGetUser.mockResolvedValue(null);

    expect((await GET(request())).status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('asks only for the signed-in business', async () => {
    await GET(request());

    expect(mockList).toHaveBeenCalledWith('user-1');
    expect(mockGetPointers).toHaveBeenCalledWith('user-1');
  });

  it('says so when the read fails, rather than reporting no addresses', async () => {
    // An empty list means "you have none" and would hide the picker silently.
    mockList.mockResolvedValue({ data: null, error: new Error('connection reset') });

    const response = await GET(request());
    expect(response.status).toBe(500);
    expect((await response.json()).success).toBe(false);
  });
});
