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
