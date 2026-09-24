/**
 * The invariant: a claimed row is dispatched exactly once.
 *
 * This is the test the queue pattern exists for. Everything else in the
 * dispatcher is a judgement call about when not to send; this is the one
 * property that, if it breaks, sends a real email to a real client twice in the
 * owner's name.
 *
 * `FOR UPDATE SKIP LOCKED` is modelled rather than executed — the RPC is
 * Postgres, and a unit test has none. What is asserted is that the runner's
 * SHAPE cannot double-send given a claim that behaves as SKIP LOCKED does:
 * a second concurrent claim gets a disjoint batch, and a row already terminal
 * is never handed out again.
 */

import { drainInsightActions, LEASE_SECONDS, MAX_ATTEMPTS } from '../InsightActionDispatchService';
import { insightActionRepository } from '@/lib/repositories/InsightActionRepository';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

type SendResult = { sent: boolean; provider: 'resend' | 'none'; error?: string };
// Typed explicitly: inferred from the happy path alone, the mock could not
// express the failure case the retry test needs.
const sendEmail = jest.fn<Promise<SendResult>, unknown[]>(async () => ({ sent: true, provider: 'resend' }));
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...(args as [])),
}));

jest.mock('@/lib/email/branding', () => ({
  resolveEmailBranding: async () => ({
    businessName: 'Test', primaryColor: '#000', secondaryColor: '#fff',
  }),
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findByUserId: async () => ({ data: { company_name: 'Test', language: 'en' }, error: null }),
  },
}));

/*
 * The invoice's status is a mutable the mock reads, reset before each test.
 *
 * An earlier version reassigned `paymentInvoiceRepository.findById` inside one
 * test. `restoreAllMocks` does not undo a plain property assignment, so the
 * paid invoice leaked into the next test and its send never happened — the
 * failure looked like the dispatcher losing a retry when it was the fixture.
 */
const invoiceState = { status: 'sent' };

jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: {
    findById: async (id: string) => ({
      data: {
        id, status: invoiceState.status, invoice_number: 'INV-1', amount: 100, currency: 'GBP',
        client_email: 'client@example.com', client_name: 'A Client', due_date: null,
      },
      error: null,
    }),
  },
}));

const contactState: { data: Record<string, unknown> | null } = { data: null };
jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: { findById: async () => ({ data: contactState.data, error: null }) },
}));

/** Rows the lead-response queue would return for this contact. */
const leadResponseState: { rows: Array<{ id: string; kind: string }> } = { rows: [] };

/** The one profile column the booking reminder asks about. */
const profileState = { meeting_reminder_enabled: false };

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: leadResponseState.rows, error: null }),
        // Routed by table: the booking reminder reads one profile row, every
        // other caller here reads a list.
        maybeSingle: async () => ({
          data: table === 'business_profiles' ? { ...profileState } : null,
          error: null,
        }),
      };
      for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'limit']) chain[m] = () => chain;
      return chain;
    },
  },
}));

/** What the scheduling tables hold for the booking under test. */
const bookingState: { data: Record<string, unknown> | null } = { data: null };
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: { findById: async () => ({ data: bookingState.data, error: null }) },
  schedulingServiceRepository: {
    findById: async () => ({ data: { service_name: 'Assessment' }, error: null }),
  },
}));

/** Whether the standing reminder already has a row for this booking. */
const standingReminder = { hasRow: false };
jest.mock('@/lib/repositories/LeadResponseRepository', () => ({
  leadResponseRepository: { hasRowFor: async () => standingReminder.hasRow },
}));

/** A minimal queue that behaves the way the RPCs do. */
function fakeQueue(rows: Array<Record<string, unknown>>) {
  const state = new Map(rows.map(r => [r.id as string, { ...r, status: 'pending' }]));

  return {
    state,
    reapStale: jest.fn(async () => []),
    /** Claims only `pending` rows and flips them, exactly as the RPC does. */
    claimDue: jest.fn(async (_runner: string, batch: number) => {
      const taken = [...state.values()].filter(r => r.status === 'pending').slice(0, batch);
      for (const r of taken) r.status = 'processing';
      return taken.map(r => ({ ...r }));
    }),
    markSent: jest.fn(async (id: string) => { state.get(id)!.status = 'sent'; }),
    markSkipped: jest.fn(async (id: string) => { state.get(id)!.status = 'skipped'; }),
    markFailed: jest.fn(async (id: string) => { state.get(id)!.status = 'pending'; }),
    countSentSince: jest.fn(async () => 0),
  };
}

function nudgeRow(id: string) {
  return {
    id, user_id: 'u1', kind: 'followup_nudge', process_id: 'send_followup_nudge',
    contact_id: 'c1', invoice_id: null, booking_id: null,
    payload: { reason: 'new_enquiry' }, attempts: 1, dedupe_key: `n-${id}`,
  };
}

/** A confirmed appointment two days out — well inside any reminder window. */
function futureBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    status: 'confirmed',
    start_time: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    timezone: 'UTC',
    contact_id: 'c1',
    service_id: 's1',
    ...overrides,
  };
}

function bookingReminderRow(id: string) {
  return {
    id, user_id: 'u1', kind: 'booking_reminder', process_id: 'send_booking_reminders',
    invoice_id: null, contact_id: 'c1', booking_id: 'b1',
    payload: {}, attempts: 1, dedupe_key: `b-${id}`,
  };
}

function invoiceRow(id: string) {
  return {
    id, user_id: 'u1', kind: 'chase_invoice', process_id: 'chase_overdue_invoices',
    invoice_id: `inv-${id}`, contact_id: null, booking_id: null,
    payload: {}, attempts: 1, dedupe_key: `k-${id}`,
  };
}

describe('drainInsightActions', () => {
  let queue: ReturnType<typeof fakeQueue>;

  function install(rows: Array<Record<string, unknown>>) {
    queue = fakeQueue(rows);
    for (const method of ['reapStale', 'claimDue', 'markSent', 'markSkipped', 'markFailed', 'countSentSince'] as const) {
      jest.spyOn(insightActionRepository, method).mockImplementation(queue[method] as never);
    }
  }

  beforeEach(() => {
    invoiceState.status = 'sent';
    contactState.data = null;
    leadResponseState.rows = [];
    profileState.meeting_reminder_enabled = false;
    bookingState.data = futureBooking();
    standingReminder.hasRow = false;
    sendEmail.mockClear();
    sendEmail.mockImplementation(async () => ({ sent: true, provider: 'resend' }));
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends once per row and closes each one', async () => {
    install([invoiceRow('a'), invoiceRow('b')]);

    const result = await drainInsightActions();

    expect(result.sent).toBe(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect([...queue.state.values()].every(r => r.status === 'sent')).toBe(true);
  });

  it('never dispatches the same row twice, even when two runners overlap', async () => {
    /*
     * THE invariant. Two drains race; the claim hands each row to exactly one
     * of them. Without the claim — a plain `select pending` — both runs would
     * pick up both rows and every client would be emailed twice.
     */
    install([invoiceRow('a'), invoiceRow('b')]);

    const [first, second] = await Promise.all([drainInsightActions(), drainInsightActions()]);

    expect(first.sent + second.sent).toBe(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('does not re-claim a row that is already terminal', async () => {
    install([invoiceRow('a')]);

    await drainInsightActions();
    sendEmail.mockClear();
    const second = await drainInsightActions();

    // The terminal status IS the dedupe marker: the claim only selects pending.
    expect(second.claimed).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('reaps before it claims', async () => {
    install([invoiceRow('a')]);
    await drainInsightActions();

    expect(queue.reapStale).toHaveBeenCalledWith(LEASE_SECONDS, MAX_ATTEMPTS);
    const reapOrder = queue.reapStale.mock.invocationCallOrder[0];
    const claimOrder = queue.claimDue.mock.invocationCallOrder[0];
    // A row abandoned by a dead runner has to be eligible for THIS pass, not
    // the next one.
    expect(reapOrder).toBeLessThan(claimOrder);
  });

  it('skips rather than sends when the invoice has been paid', async () => {
    /*
     * The world moves between queueing and sending. Chasing somebody for money
     * they have already paid is the worst thing this queue could do, so the
     * check lives here, at the moment of sending, not at enqueue.
     */
    invoiceState.status = 'paid';

    install([invoiceRow('a')]);
    const result = await drainInsightActions();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('stops at the daily cap', async () => {
    install([invoiceRow('a')]);
    queue.countSentSince.mockResolvedValue(999);

    const result = await drainInsightActions();

    expect(result.skipped).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not repeat a follow-up the lead-response queue has already sent', async () => {
    /*
     * The two queues say the same thing and neither knows the other exists.
     * Without this the lead gets an invitation, a chase five days later, and
     * then this nudge a week after that — the same message twice from one
     * business.
     */
    contactState.data = { id: 'c1', first_name: 'A', last_name: 'Lead', email: 'lead@example.com' };
    leadResponseState.rows = [{ id: 'lr1', kind: 'chase' }];

    install([nudgeRow('a')]);
    const result = await drainInsightActions();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends the nudge when nothing has chased that contact', async () => {
    contactState.data = { id: 'c1', first_name: 'A', last_name: 'Lead', email: 'lead@example.com' };
    leadResponseState.rows = [];

    install([nudgeRow('a')]);
    const result = await drainInsightActions();

    expect(result.sent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });


  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE TWO REMINDERS MUST NOT BOTH FIRE.
   *
   * The card off, this insight-triggered one is the safety net that wakes when
   * the no-show detector spots a spike. The card on, every confirmed
   * appointment already gets a reminder at the owner's chosen lead time. With
   * both running a client gets two emails about one appointment — the exact
   * collision invoice chasing had, where the card and the payment reminders
   * both fired on day three.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('against the standing meeting reminder', () => {
    it('sends when the card is off and nothing else has reminded them', async () => {
      contactState.data = { email: 'client@example.com', first_name: 'Dana' };
      install([bookingReminderRow('a')]);

      const result = await drainInsightActions();

      expect(result.sent).toBe(1);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('stands down while the card is on', async () => {
      contactState.data = { email: 'client@example.com', first_name: 'Dana' };
      profileState.meeting_reminder_enabled = true;
      install([bookingReminderRow('a')]);

      const result = await drainInsightActions();

      expect(result.sent).toBe(0);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('stands down for a booking the standing reminder already handled', async () => {
      /*
       * The owner switched the card off after it had already queued this one.
       * Reminders do not unsend themselves, so the safety net must not send a
       * second about the same appointment.
       */
      contactState.data = { email: 'client@example.com', first_name: 'Dana' };
      profileState.meeting_reminder_enabled = false;
      standingReminder.hasRow = true;
      install([bookingReminderRow('a')]);

      const result = await drainInsightActions();

      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('closes the row rather than leaving it to be retried forever', async () => {
      // A stand-down is a decision, not a failure. Left pending it would be
      // claimed again every run until it hit the attempt cap.
      contactState.data = { email: 'client@example.com', first_name: 'Dana' };
      profileState.meeting_reminder_enabled = true;
      install([bookingReminderRow('a')]);

      await drainInsightActions();

      expect(queue.state.get('a')!.status).toBe('skipped');
    });

    it('does not remind anyone about an appointment that was cancelled', async () => {
      contactState.data = { email: 'client@example.com', first_name: 'Dana' };
      bookingState.data = futureBooking({ status: 'cancelled' });
      install([bookingReminderRow('a')]);

      const result = await drainInsightActions();

      expect(result.sent).toBe(0);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('does not remind anyone about an appointment that has passed', async () => {
      contactState.data = { email: 'client@example.com', first_name: 'Dana' };
      bookingState.data = futureBooking({
        start_time: new Date(Date.now() - 3_600_000).toISOString(),
      });
      install([bookingReminderRow('a')]);

      const result = await drainInsightActions();

      expect(result.sent).toBe(0);
    });
  });

  it('leaves a failed send retryable rather than losing it', async () => {
    install([invoiceRow('a')]);
    sendEmail.mockImplementation(async () => ({ sent: false, provider: 'none', error: 'provider down' }));

    const result = await drainInsightActions();

    expect(result.failed).toBe(1);
    // Back to pending: a provider blip must not permanently lose a message.
    expect(queue.state.get('a')!.status).toBe('pending');
  });
});
