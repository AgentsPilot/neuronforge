/**
 * One invoice is chased once a week, by whichever sender gets there first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `sendInvoiceChase` sent and recorded NOTHING. Three callers reach it — the
 * scheduled reminder, the insight queue, and a scheduled agent — and nothing
 * anywhere could tell that a chase had already gone out.
 *
 * The agent's plan believed it was deduped by a filter on the invoice's own
 * `sent_at`, which is the day the INVOICE was sent and never changes. So the
 * filter was permanently true and bought nothing. With `daily` offered as a
 * cadence and `120` days as a stop rule, that is up to a hundred and twenty
 * consecutive mornings of the same email to one client about one debt.
 *
 * And a second collision the plan only claimed to prevent: its
 * `worksAlongside` note says an automation must never act on something the
 * milestone chaser can still reach, and there was no mechanism — the agent and
 * the 1/3/7-day chaser could land on the same client the same morning.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `payment_reminders` AND NOT A PRIVATE MARKER
 *
 * Because the scheduled chaser already writes its overdue reminders there. One
 * shared table answers both questions at once: have WE chased this recently,
 * and has ANYTHING else. A private marker would have fixed the agent repeating
 * itself and left the collision untouched.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findById = jest.fn();
const findRecentByInvoice = jest.fn();
const createReminder = jest.fn();
const sendEmail = jest.fn();

jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: { findById: (...a: unknown[]) => findById(...a) },
}));

jest.mock('@/lib/repositories/PaymentReminderRepository', () => ({
  paymentReminderRepository: {
    findRecentByInvoice: (...a: unknown[]) => findRecentByInvoice(...a),
    create: (...a: unknown[]) => createReminder(...a),
  },
}));

jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

jest.mock('@/lib/email/templates/insight-actions', () => ({
  generateChaseInvoiceEmail: () => ({ subject: 'Your invoice is overdue', html: '<p/>' }),
  generateFollowupNudgeEmail: () => ({ subject: '', html: '' }),
  generateBookingReminderEmail: () => ({ subject: '', html: '' }),
}));

jest.mock('@/lib/payments/invoicePayLink', () => ({
  invoicePayLink: jest.fn().mockResolvedValue('https://example/pay'),
}));

import { sendInvoiceChase } from '../InsightActionDispatchService';

const USER = 'owner-1';
const INVOICE = 'invoice-1';

/** Overdue, unpaid, with somewhere to send to. */
function invoice(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: INVOICE,
      user_id: USER,
      status: 'sent',
      due_date: '2026-09-01',
      client_email: 'client@example.com',
      client_name: 'Client',
      contact_id: 'contact-1',
      invoice_number: 'INV-1',
      amount: 100,
      currency: 'GBP',
      ...overrides,
    },
    error: null,
  };
}

const CONTEXT = {
  businessName: 'A Business',
  branding: {},
  locale: 'en',
  tone: 'warm',
} as never;

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(invoice());
  findRecentByInvoice.mockResolvedValue({ data: [], error: null });
  createReminder.mockResolvedValue({ data: { id: 'rem-1' }, error: null });
  sendEmail.mockResolvedValue({ sent: true });
});

describe('it asks before it sends', () => {
  it('reads the chase history for this invoice, over seven days', async () => {
    await sendInvoiceChase(INVOICE, USER, CONTEXT);

    expect(findRecentByInvoice).toHaveBeenCalledTimes(1);
    const [invoiceId, type, since, statuses] = findRecentByInvoice.mock.calls[0];

    expect(invoiceId).toBe(INVOICE);
    /* The type the scheduled chaser already writes, so one read sees both
       senders. */
    expect(type).toBe('overdue');
    expect(Math.round((Date.now() - Date.parse(since as string)) / 86_400_000)).toBe(7);
    expect(statuses).toEqual(['pending', 'processing', 'sent']);
  });

  it('refuses when anything chased this invoice inside the window', async () => {
    findRecentByInvoice.mockResolvedValue({ data: [{ id: 'rem-earlier' }], error: null });

    const outcome = await sendInvoiceChase(INVOICE, USER, CONTEXT);

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain('already chased');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses when the history cannot be read — fails closed', async () => {
    /*
     * An unreadable history is exactly when a duplicate is most likely, so it
     * is not permission to send. A chaser that goes quiet is a late invoice;
     * one that sends blind is a client hearing the same demand twice.
     */
    findRecentByInvoice.mockResolvedValue({ data: null, error: new Error('database unreachable') });

    const outcome = await sendInvoiceChase(INVOICE, USER, CONTEXT);

    expect(outcome.sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('counts a PENDING chase as a chase', async () => {
    /*
     * The collision with the milestone chaser. It writes a `pending` row the
     * moment it schedules, so an agent running an hour later must see it —
     * otherwise both land on the same client the same morning, which is the
     * thing the plan's `worksAlongside` note claims to prevent.
     *
     * Asserted through the status list the call passes, since that is what
     * decides it.
     */
    await sendInvoiceChase(INVOICE, USER, CONTEXT);

    const [, , , statuses] = findRecentByInvoice.mock.calls[0];
    expect(statuses).toContain('pending');
  });

  it('does not count a cancelled or failed one', async () => {
    /* The owner called it off, or it never arrived. Neither is in the client's
       inbox, so neither may silence a week of chasing. */
    const [, , , statuses] = (await sendInvoiceChase(INVOICE, USER, CONTEXT), findRecentByInvoice.mock.calls[0]);

    expect(statuses).not.toContain('cancelled');
    expect(statuses).not.toContain('failed');
  });
});

describe('it records what it sent', () => {
  it('writes an overdue reminder once the send is confirmed', async () => {
    const outcome = await sendInvoiceChase(INVOICE, USER, CONTEXT);

    expect(outcome.sent).toBe(true);
    expect(createReminder).toHaveBeenCalledTimes(1);

    const row = createReminder.mock.calls[0][0] as Record<string, unknown>;
    expect(row.invoice_id).toBe(INVOICE);
    expect(row.user_id).toBe(USER);
    expect(row.reminder_type).toBe('overdue');
    expect(row.status).toBe('sent');
    expect(row.sent_at).toBeTruthy();
  });

  it('records NOTHING when the send was refused', async () => {
    /*
     * The ordering that matters. Recording before the send would silence the
     * next seven days after a delivery that never happened — the client heard
     * nothing, so there is nothing to protect them from.
     */
    sendEmail.mockResolvedValue({ sent: false, blocked: 'no_consent' });

    const outcome = await sendInvoiceChase(INVOICE, USER, CONTEXT);

    expect(outcome.sent).toBe(false);
    expect(createReminder).not.toHaveBeenCalled();
  });

  it('records nothing when the send failed outright — which THROWS', async () => {
    /*
     * A hard delivery failure is not the same as a refusal, and
     * `outcomeFromSend` treats them differently on purpose: `blocked` RETURNS
     * (nobody agreed to be written to, and trying tomorrow gets the same
     * answer) while a transport error THROWS, so the caller's queue retries it.
     *
     * That throw is what keeps the record honest here — it happens before the
     * write, so a failed send leaves no row and the next attempt is not
     * silenced by a cooldown protecting a client who heard nothing.
     *
     * Asserted as a throw rather than a return because the first version of
     * this test assumed a return, passed nothing, and would have hidden the
     * ordering it was written to protect.
     */
    sendEmail.mockResolvedValue({ sent: false, error: 'mailbox unavailable' });

    await expect(sendInvoiceChase(INVOICE, USER, CONTEXT)).rejects.toThrow('mailbox unavailable');

    expect(createReminder).not.toHaveBeenCalled();
  });

  it('still reports the send when the record fails', async () => {
    /*
     * Non-blocking. The email has already left: telling the caller nothing was
     * sent would invite a retry that definitely duplicates, where a lost row
     * risks at most one duplicate in seven days.
     */
    createReminder.mockResolvedValue({ data: null, error: new Error('write failed') });

    const outcome = await sendInvoiceChase(INVOICE, USER, CONTEXT);

    expect(outcome.sent).toBe(true);
  });
});

describe('the checks that were already there still hold', () => {
  it('refuses a settled invoice before reading any history', async () => {
    /* Chasing somebody for money they have already sent is the worst outcome
       available, so it stays the first question asked. */
    findById.mockResolvedValue(invoice({ status: 'paid' }));

    const outcome = await sendInvoiceChase(INVOICE, USER, CONTEXT);

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain('paid');
    expect(findRecentByInvoice).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses an invoice that is not due yet', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    findById.mockResolvedValue(invoice({ due_date: tomorrow }));

    const outcome = await sendInvoiceChase(INVOICE, USER, CONTEXT);

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain('not due until');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
