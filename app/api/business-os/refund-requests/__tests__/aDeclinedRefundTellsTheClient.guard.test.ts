/**
 * Declining a refund reaches the client, and the decision survives the send.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, AND WHY IT NEEDS A GUARD
 *
 * Approving a refund has always emailed the client. Refusing one said nothing:
 * the request closed, the card cleared, and the person who had asked for their
 * own money back heard nothing, indefinitely. The "no" is the message that
 * most needs sending, so it was the wrong way round.
 *
 * Four things are pinned here, because each of them is a way to get this
 * wrong again:
 *
 *  1. The owner's approved message leaves the building, to the client's own
 *     address, in the business's frame — and the subject names the REQUEST,
 *     not the answer. "Refund declined" in an inbox list is a refusal
 *     delivered before the client has opened what the owner wrote.
 *  2. Nothing is invented. The body is the owner's text and only their text:
 *     no figure, no policy line, no "unfortunately" they did not write.
 *  3. The decision outranks the transport. A send that fails must not cost the
 *     owner a press they have already confirmed, so the decline still stands
 *     and the route still answers 200.
 *  4. Silence stays possible on purpose. `handled` never writes to the client,
 *     and `declined` with no approved message sends nothing — that is what
 *     happens when the draft is off, and it is the old behaviour, not a bug.
 *
 * Plus the three CLAUDE.md § Testing cases: happy path, no session, and input
 * that fails validation. And one privacy pin: the message's LENGTH is logged,
 * never a word of it.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
const mockDecide = jest.fn();
const mockSendEmail = jest.fn();
const mockInserted: Array<{ table: string; row: Record<string, unknown> }> = [];
const mockRows: Record<string, unknown> = {};
const mockLogged: Array<{ level: string; context: Record<string, unknown>; message: string }> = [];

jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

jest.mock('@/lib/repositories/RefundRequestRepository', () => ({
  refundRequestRepository: {
    decide: (...args: unknown[]) => mockDecide(...args),
  },
}));

jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

jest.mock('@/lib/email/branding', () => ({
  resolveEmailBranding: async () => ({
    businessName: 'Studio Nine',
    primaryColor: '#1f2937',
    secondaryColor: '#6b7280',
  }),
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: {
    getInstance: () => ({
      log: async () => undefined,
      flush: async () => undefined,
    }),
  },
}));

/* A capturing logger, so the privacy pin can read every level. */
jest.mock('@/lib/logger', () => {
  const record = (level: string) => (context: unknown, message?: string) =>
    mockLogged.push({
      level,
      context: (context ?? {}) as Record<string, unknown>,
      message: message ?? '',
    });
  const instance = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    child: () => instance,
  };
  return { createLogger: () => instance };
});

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => ({
      select: () => {
        const chain: Record<string, unknown> = {
          eq: () => chain,
          maybeSingle: async () => ({ data: mockRows[table] ?? null, error: null }),
        };
        return chain;
      },
      insert: (row: Record<string, unknown>) => {
        mockInserted.push({ table, row });
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { POST } from '../decide/route';

const OWNER = '08456106-aa50-4810-b12c-7ca84102da31';
const REQUEST_ID = '0f3a9c21-5bb4-4a2e-9d5c-2e4c3a9b1f77';
const CONTACT = '8742fcd8-fdfc-4e32-bb1f-c599cf72adf5';

/* The owner's own words, with the punctuation that would break unescaped. */
const APPROVED = 'Hi Tal, I can’t refund this one — the room & therapist were held for you.';

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/business-os/refund-requests/decide', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const settledRequest = (overrides: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  status: 'declined',
  contact_id: CONTACT,
  booking_id: null,
  amount_requested: 40,
  currency: 'USD',
  reason: 'changed_mind',
  source: 'portal',
  source_thread_id: null,
  /* When they asked — one of the facts the email names under the message. */
  created_at: '2026-11-22T18:47:59.627305+00:00',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockInserted.length = 0;
  mockLogged.length = 0;
  for (const key of Object.keys(mockRows)) delete mockRows[key];
  mockRows.crm_contacts = { email: 'tal@example.com', first_name: 'Tal' };
  mockGetUser.mockResolvedValue({ id: OWNER });
  mockDecide.mockResolvedValue({ data: settledRequest(), error: null });
  mockSendEmail.mockResolvedValue({ sent: true, provider: 'resend' });
});

describe('POST /api/business-os/refund-requests/decide — the client is told', () => {
  it('sends the owner’s approved message to the client', async () => {
    const response = await POST(post({ requestId: REQUEST_ID, decision: 'declined', message: APPROVED }));

    expect(response.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.to).toEqual(['tal@example.com']);
    expect(sent.ownerUserId).toBe(OWNER);
    expect(sent.kind).toBe('transactional');

    /* The subject names what they asked about. It never answers it. */
    expect(sent.subject).toMatch(/refund request/i);
    expect(sent.subject).not.toMatch(/declin|refus|reject|unfortunate/i);

    /* Their words arrive, escaped, inside the business's frame. */
    expect(sent.html).toContain('I can’t refund this one');
    expect(sent.html).toContain('therapist were held');
    expect(sent.html).toContain('&amp;');
    expect(sent.html).toContain('Studio Nine');
  });

  it('names the service in the subject when the request has a booking', async () => {
    mockDecide.mockResolvedValue({
      data: settledRequest({ booking_id: 'b1f3c4d5-6789-4abc-8def-0123456789ab' }),
      error: null,
    });
    mockRows.scheduling_bookings = { service: { service_name: 'Deep tissue' } };

    await POST(post({ requestId: REQUEST_ID, decision: 'declined', message: APPROVED }));

    expect(mockSendEmail.mock.calls[0][0].subject).toContain('Deep tissue');
  });

  it('invents nothing the owner did not write', async () => {
    await POST(post({ requestId: REQUEST_ID, decision: 'declined', message: 'No refund this time.' }));

    const { html } = mockSendEmail.mock.calls[0][0];

    /*
     * NARROWED ON THE OWNER'S INSTRUCTION, and worth saying why.
     *
     * This used to forbid the FIGURE too, on the principle that a decline is
     * the owner's words and nothing else. In practice the client was left to
     * work out which request had been answered — "we got the email but no
     * booking information" — and somebody with two bookings and one request
     * in the air cannot.
     *
     * So the facts they themselves supplied now appear under the message: the
     * amount they asked for, when the appointment was, when they asked. What
     * stays forbidden is everything they did NOT supply and cannot act on:
     * our reason codes, our ids, and any policy sentence the owner did not
     * write.
     */
    expect(html).not.toContain('changed_mind');
    expect(html).not.toContain(REQUEST_ID);
    expect(html).not.toContain(CONTACT);
    /* No invented terms. The owner's sentence is the whole argument. */
    expect(html).not.toMatch(/policy|terms and conditions|non-refundable/i);
  });

  it('says which request it is answering', async () => {
    await POST(post({ requestId: REQUEST_ID, decision: 'declined', message: 'No refund this time.' }));

    const { html } = mockSendEmail.mock.calls[0][0];

    /* The amount they asked for, as money rather than a bare number. */
    expect(html).toMatch(/\$40\.00|40\.00/);
    /* And the day they asked, named rather than printed as an ISO string. */
    expect(html).not.toContain('2026-11-22T18:47:59');
    expect(html).toMatch(/November|Nov/);
  });

  it('keeps the decision when the send fails', async () => {
    mockSendEmail.mockRejectedValue(new Error('smtp is down'));

    const response = await POST(post({ requestId: REQUEST_ID, decision: 'declined', message: APPROVED }));
    const payload = await response.json();

    /* The press stands. A transport outage must not undo a confirmed answer. */
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('declined');
    expect(mockDecide).toHaveBeenCalledWith(REQUEST_ID, OWNER, 'declined');
  });

  it('says so, and sends nothing, when the client has no address on file', async () => {
    mockRows.crm_contacts = { email: '  ', first_name: 'Tal' };

    const response = await POST(post({ requestId: REQUEST_ID, decision: 'declined', message: APPROVED }));

    expect(response.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockLogged.some((entry) => entry.level === 'warn' && /no email address/i.test(entry.message))).toBe(true);
  });

  it('writes to the client only for a declined request carrying a message', async () => {
    /* `handled` is the owner settling it elsewhere — off-platform, in person,
       already paid back. Emailing about it would be a second message about a
       conversation they have already had. */
    mockDecide.mockResolvedValue({ data: settledRequest({ status: 'handled' }), error: null });
    await POST(post({ requestId: REQUEST_ID, decision: 'handled', message: APPROVED }));
    expect(mockSendEmail).not.toHaveBeenCalled();

    /* And a decline with nothing approved stays silent, as it always did. */
    mockDecide.mockResolvedValue({ data: settledRequest(), error: null });
    await POST(post({ requestId: REQUEST_ID, decision: 'declined' }));
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('logs the message’s length and never its content', async () => {
    await POST(post({ requestId: REQUEST_ID, decision: 'declined', message: APPROVED }));

    const haystack = JSON.stringify(mockLogged);
    expect(haystack).not.toContain('therapist were held');
    expect(haystack).not.toContain('refund this one');
    expect(mockLogged.some((entry) => entry.context.length === APPROVED.length)).toBe(true);
  });
});

describe('POST /api/business-os/refund-requests/decide — the guards', () => {
  it('refuses a caller with no session, before anything is recorded', async () => {
    mockGetUser.mockResolvedValue(null);

    const response = await POST(post({ requestId: REQUEST_ID, decision: 'declined', message: APPROVED }));

    expect(response.status).toBe(401);
    expect(mockDecide).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects input that fails validation, and tells the client nothing', async () => {
    for (const body of [
      { requestId: 'not-a-uuid', decision: 'declined', message: APPROVED },
      /* `refunded` is not this route's to record: money moves through the
         refund endpoints, never through a status write. */
      { requestId: REQUEST_ID, decision: 'refunded', message: APPROVED },
      /* An empty approved message would send a blank email in the business's
         name. Absent means silence; present means something to say. */
      { requestId: REQUEST_ID, decision: 'declined', message: '   ' },
    ]) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
    }

    expect(mockDecide).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('does not send on a request that was already settled', async () => {
    /* No row back means somebody else already answered it, or it was never
       this business's. A second press must not email a second time. */
    mockDecide.mockResolvedValue({ data: null, error: null });

    const response = await POST(post({ requestId: REQUEST_ID, decision: 'declined', message: APPROVED }));

    expect(response.status).toBe(409);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
