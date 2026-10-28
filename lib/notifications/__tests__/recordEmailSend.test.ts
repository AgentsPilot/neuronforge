/**
 * The row that makes a delivery event matchable.
 *
 * None of this was covered while the function was private to
 * `BookingEmailService`, including the two facts that other code now depends on:
 * that it never throws, and that a failed send gets `sent_at: null`.
 */

import { recordEmailSend } from '../recordEmailSend';

const create = jest.fn();

jest.mock('@/lib/repositories/EmailAutomationRepository', () => ({
  emailSendRepository: { create: (...args: unknown[]) => create(...args) },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

/* Only reached for a mail that is about ONE APPOINTMENT — see
   `ABOUT_ONE_APPOINTMENT`. Whether it is called at all is the assertion in the
   invoice block below. */
const listAttempts = jest.fn();

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    listAttempts: (...args: unknown[]) => listAttempts(...args),
  },
}));

const base = {
  userId: 'user-1',
  contactId: 'contact-1',
  toEmail: 'client@example.com',
  subject: 'Your appointment',
  bodyHtml: '<p>hi</p>',
};

const sentOk = {
  sent: true,
  provider: 'resend' as const,
  providerMessageId: 'msg-abc',
};

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ data: { id: 'row-1' }, error: null });
  listAttempts.mockReset();
  listAttempts.mockResolvedValue({ 'booking-9': [{ id: 'meeting-1' }, { id: 'meeting-2' }] });
});

/**
 * AN INVOICE IS A FACT ABOUT THE JOB.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every invoice mail this platform ever sent was filed with no kind and no
 * booking. The sender holds the invoice row and uses its `booking_id` to build
 * the pay link, then dropped it when recording the send — so nothing could
 * answer "was this client actually billed?". An owner who had just marked a
 * session held and watched the invoice go out was shown no evidence of either,
 * and reasonably concluded nothing had been sent.
 *
 * Measured on a live account: of six invoice mails to one client, one carried
 * a booking and five did not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('an invoice going out to the client', () => {
  it('is filed against the booking it bills', async () => {
    await recordEmailSend({
      ...base,
      bookingId: 'booking-9',
      kind: 'invoice_sent',
      result: sentOk as never,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ booking_id: 'booking-9', email_kind: 'invoice_sent' })
    );
  });

  it('does not land inside one appointment, the way a receipt does not', async () => {
    /*
     * The distinction `ABOUT_ONE_APPOINTMENT` exists for. The journey draws its
     * rail from `meeting_id`, so filing a bill there would put a money fact
     * inside the history of a single session — which is what put a cancellation
     * under "you cancelled the meeting" and was fixed by the same rule.
     *
     * Asserted through `listAttempts` as well as the row: the resolver returns
     * before it ever asks, so a kind added to that set by accident fails here.
     */
    await recordEmailSend({
      ...base,
      bookingId: 'booking-9',
      kind: 'invoice_sent',
      result: sentOk as never,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ meeting_id: null }));
    expect(listAttempts).not.toHaveBeenCalled();
  });

  it('records a copy as a resend, not as a second original', async () => {
    await recordEmailSend({
      ...base,
      bookingId: 'booking-9',
      kind: 'invoice_sent',
      isResend: true,
      result: sentOk as never,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ is_resend: true }));
  });

  it('still records the send when the invoice belongs to no booking', async () => {
    /* An invoice raised on its own — no booking behind it — must still be
       recorded, or the delivery webhook has no row to match and a bounce is
       lost. The booking is an attribution, never a condition. */
    await recordEmailSend({
      ...base,
      bookingId: null,
      kind: 'invoice_sent',
      result: sentOk as never,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ booking_id: null, email_kind: 'invoice_sent' })
    );
  });
});

describe('when there is no contact', () => {
  /*
   * Not an error. Owner-facing mail belongs to no client, and until the
   * delivery migration `email_sends.contact_id` is NOT NULL — with a trigger
   * that inserts into `crm_activities`, whose own contact_id is NOT NULL. A row
   * with a null contact would abort the caller's transaction, so this exits.
   */
  it('writes nothing and does not throw', async () => {
    await expect(
      recordEmailSend({ ...base, contactId: null, result: sentOk as never })
    ).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('what it records', () => {
  it('writes the transport that actually sent it, not a constant', async () => {
    // This was `result.provider === 'resend' ? 'resend' : 'resend'` — both
    // branches the same — so every row claimed Resend whatever really sent it.
    await recordEmailSend({ ...base, result: { ...sentOk, provider: 'smtp' } as never });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ provider: 'smtp' }));
  });

  it("carries the provider's message id, which is what a webhook matches on", async () => {
    await recordEmailSend({ ...base, result: sentOk as never });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ provider_message_id: 'msg-abc' })
    );
  });

  it('records null when the transport returns no id, as SMTP and Gmail do', async () => {
    await recordEmailSend({
      ...base,
      result: { sent: true, provider: 'smtp' } as never,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ provider_message_id: null })
    );
  });

  /*
   * Both halves matter. `status` keeps it out of the dispatched roster, and
   * `sent_at: null` keeps it out of `emails_sent_30d`, which filters on that
   * column. Either one alone would let a failed send count as business activity.
   */
  it('records a failed send as failed, with no sent_at', async () => {
    await recordEmailSend({
      ...base,
      result: { sent: false, provider: 'resend', error: 'no transport' } as never,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        sent_at: null,
        error_message: 'no transport',
      })
    );
  });

  it('records a successful send as sent, with a timestamp', async () => {
    await recordEmailSend({ ...base, result: sentOk as never });
    const row = create.mock.calls[0][0];
    expect(row.status).toBe('sent');
    expect(typeof row.sent_at).toBe('string');
  });

  it('starts the delivery columns empty — only the webhook fills them', async () => {
    await recordEmailSend({ ...base, result: sentOk as never });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        delivered_at: null,
        opened_at: null,
        clicked_at: null,
        open_count: 0,
        click_count: 0,
      })
    );
  });
});

describe('when the write itself fails', () => {
  /*
   * Bookkeeping must not turn a delivered email into an error response. Callers
   * — five services now — rely on this never throwing.
   */
  it('swallows the error rather than failing the send', async () => {
    create.mockRejectedValue(new Error('db down'));
    await expect(
      recordEmailSend({ ...base, result: sentOk as never })
    ).resolves.toBeUndefined();
  });
});
