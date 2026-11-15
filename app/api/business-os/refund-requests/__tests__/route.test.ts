/**
 * The contact drawer's read of a client's refund requests.
 *
 * Three cases, per CLAUDE.md § Testing: the happy path, no session, and a
 * request that fails validation. The fourth is the one that matters most here
 * — the account must come from the session and never from the query string,
 * because a contact id is a uuid somebody could hold and `supabaseServer` has
 * no RLS behind it to catch that.
 */

import { NextRequest } from 'next/server';

const listForContact = jest.fn();
const getUser = jest.fn();

jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));
jest.mock('@/lib/repositories/RefundRequestRepository', () => ({
  refundRequestRepository: {
    listForContact: (...args: unknown[]) => listForContact(...args),
  },
}));

import { GET } from '../route';

const CONTACT = '8742fcd8-fdfc-4e32-bb1f-c599cf72adf5';
const OWNER = '08456106-aa50-4810-b12c-7ca84102da31';

const get = (qs: string) =>
  new NextRequest(`http://localhost/api/business-os/refund-requests${qs}`);

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ id: OWNER });
  listForContact.mockResolvedValue({ data: [], error: null });
});

describe('GET /api/business-os/refund-requests', () => {
  it('returns the client’s requests', async () => {
    listForContact.mockResolvedValue({
      data: [{ id: 'r1', amount_requested: 300, currency: 'ILS', status: 'refunded' }],
      error: null,
    });

    const response = await GET(get(`?contact_id=${CONTACT}`));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].amount_requested).toBe(300);
  });

  it('refuses a caller with no session', async () => {
    getUser.mockResolvedValue(null);

    const response = await GET(get(`?contact_id=${CONTACT}`));

    expect(response.status).toBe(401);
    /* And nothing was read. A 401 after the query has run has satisfied its
       status code and leaked the data anyway. */
    expect(listForContact).not.toHaveBeenCalled();
  });

  it('refuses a contact id that is not one', async () => {
    const response = await GET(get('?contact_id=not-a-uuid'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid input');
    expect(listForContact).not.toHaveBeenCalled();
  });

  it('scopes to the SESSION’s account, never anything in the query string', async () => {
    /*
     * The query names the client. It must never be able to name the business:
     * this route reads through `supabaseServer`, so the `.eq('user_id', …)`
     * inside the repository is the only thing standing between one business
     * and another's refund history.
     */
    await GET(get(`?contact_id=${CONTACT}&user_id=someone-else`));

    expect(listForContact).toHaveBeenCalledWith(CONTACT, OWNER, undefined);
  });

  it('reports a repository failure without leaking its message', async () => {
    listForContact.mockResolvedValue({ data: null, error: new Error('relation does not exist') });

    const response = await GET(get(`?contact_id=${CONTACT}`));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('relation does not exist');
  });
});
