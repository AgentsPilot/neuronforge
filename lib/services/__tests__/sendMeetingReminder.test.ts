/**
 * What the reminder actually puts in front of two different people.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The template tests assert that `generateMeetingReminderEmail` renders what it
 * is given. These assert that it is given the RIGHT THING, which is a separate
 * question and the one that was wrong: the sender read `booking.client_name`,
 * which is neither a column on `scheduling_bookings` nor one of the convenience
 * fields `findById` derives from the joined contact. It was always undefined,
 * so every client reminder opened "Hi there," and the owner's heads-up — whose
 * whole job is to lead with WHO is coming — announced that "there" was booked
 * in. Both emails rendered perfectly and said nothing.
 *
 * So these tests go through the real `sendMeetingReminder` with a booking
 * shaped the way the repository actually returns one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/*
 * Imported lazily, AFTER the environment is set.
 *
 * `APP_URL` is captured once at module load (`process.env.NEXT_PUBLIC_APP_URL
 * || ''`), so setting it in `beforeEach` sets it too late and every manage link
 * comes out empty — which is also true in production: an unset
 * NEXT_PUBLIC_APP_URL costs every booking email its links, not just this one.
 */
let BookingEmailService: typeof import('../BookingEmailService').BookingEmailService;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  // Signing is fatal without one, by design — see `bookingTokenSecret`.
  process.env.BOOKING_TOKEN_SECRET = 'test-signing-key';
  ({ BookingEmailService } = await import('../BookingEmailService'));
});

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(),
    child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  }),
}));

type Sent = { to: string[]; subject: string; html: string; ownerUserId?: string };
const sent: Sent[] = [];
const sendOutcome = { client: true, owner: true };

jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: jest.fn(async (args: Sent) => {
    sent.push(args);
    // The owner's copy is the one addressed to the account address.
    const ok = args.to[0] === 'owner@example.test' ? sendOutcome.owner : sendOutcome.client;
    return ok ? { sent: true, provider: 'resend' } : { sent: false, error: 'bounced' };
  }),
}));

jest.mock('@/lib/email/branding', () => ({
  resolveEmailBranding: async () => ({ businessName: 'Harbour Physio', primaryColor: '#F97316' }),
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findByUserId: async () => ({ data: { company_name: 'Harbour Physio', language: 'en' }, error: null }),
  },
}));

/*
 * A booking shaped as `SchedulingBookingRepository.findById` returns one:
 * the table's own columns PLUS the `client_*` convenience fields it derives
 * from the joined contact. `scheduling_bookings` itself holds no name, no
 * email and no manage URL — which is exactly what the bug depended on.
 */
const bookingState: { data: Record<string, unknown> | null } = { data: null };

function bookingAsRepositoryReturnsIt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    user_id: 'u1',
    service_id: 'svc-1',
    contact_id: 'c1',
    start_time: new Date(Date.now() + 26 * 3_600_000).toISOString(),
    timezone: 'UTC',
    status: 'confirmed',
    payment_status: 'paid',
    payment_amount: null,
    payment_currency: null,
    intake_sent_at: null,
    intake_completed_at: null,
    // Derived by the repository from crm_contacts, not columns.
    client_first_name: 'Dana',
    client_last_name: 'Levi',
    client_email: 'dana@example.test',
    ...overrides,
  };
}

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: { findById: async () => ({ data: bookingState.data, error: null }) },
  schedulingServiceRepository: {
    findById: async () => ({ data: { service_name: 'Initial assessment' }, error: null }),
  },
}));

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'owner@example.test' } } }) } },
    from() {
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
      };
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update']) chain[m] = () => chain;
      return chain;
    },
  },
}));

const clientMail = () => sent.find(m => m.to[0] === 'dana@example.test');
const ownerMail = () => sent.find(m => m.to[0] === 'owner@example.test');

beforeEach(() => {
  sent.length = 0;
  sendOutcome.client = true;
  sendOutcome.owner = true;
  bookingState.data = bookingAsRepositoryReturnsIt();
});

describe('sendMeetingReminder', () => {
  it('calls the client by name, not "there"', async () => {
    await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
      notifyClient: true,
      notifyOwner: false,
    });

    expect(clientMail()!.html).toContain('Dana Levi');
    expect(clientMail()!.html).not.toContain('Hi there');
  });

  it('names the client to the owner, in the subject', async () => {
    await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
      notifyClient: false,
      notifyOwner: true,
    });

    expect(ownerMail()!.subject).toContain('Dana Levi');
  });

  it('falls back to the address, then to a greeting, rather than to nothing', async () => {
    bookingState.data = bookingAsRepositoryReturnsIt({
      client_first_name: null,
      client_last_name: null,
    });

    await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
      notifyClient: true,
      notifyOwner: false,
    });

    expect(clientMail()!.html).toContain('dana@example.test');
  });

  it('sends the reminder without a link rather than not at all', async () => {
    /*
     * A missing signing secret is fatal to the TOKEN, deliberately — a link
     * signed with a known string would let anyone cancel a stranger's
     * appointment. But it must not be fatal to the reminder: the client still
     * needs telling, and the owner's copy needs no token at all and must not
     * be lost to the client's failure.
     */
    delete process.env.BOOKING_TOKEN_SECRET;

    try {
      const result = await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: true,
        notifyOwner: true,
      });

      expect(result.sent).toBe(true);
      expect(sent).toHaveLength(2);
      expect(clientMail()!.html).toContain('Dana Levi');
      expect(clientMail()!.html).not.toContain('/book/manage/');
    } finally {
      process.env.BOOKING_TOKEN_SECRET = 'test-signing-key';
    }
  });

  it('carries a reschedule link the client can actually use', async () => {
    /*
     * Minted here the way every other booking email mints one. Read off a
     * `manage_url` field — which does not exist — the reminder went out with no
     * way to move the appointment, which is the difference between a service
     * and a nag.
     */
    await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
      notifyClient: true,
      notifyOwner: false,
    });

    expect(clientMail()!.html).toContain('https://app.example.test/book/manage/');
    expect(clientMail()!.html).toContain('/reschedule');
  });


  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHO IT COMES FROM.
   *
   * `resolveSender` puts the business's name on the envelope and the owner's
   * address in Reply-To — but only when the send names the owner. Omit
   * `ownerUserId` and it falls back to the platform default, so a client gets
   * an appointment reminder from "NeuronForge", a company they have never heard
   * of, and a reply reaches the platform's inbox instead of the business.
   *
   * These two sends were the only ones in the file that omitted it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('who it comes from', () => {
    it('sends the client reminder as the business', async () => {
      await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: true,
        notifyOwner: false,
      });

      expect(clientMail()!.ownerUserId).toBe('u1');
    });

    it('sends the owner reminder as the business too', async () => {
      // So it sits with the rest of their own mail rather than reading as a
      // notice from a third party.
      await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: false,
        notifyOwner: true,
      });

      expect(ownerMail()!.ownerUserId).toBe('u1');
    });

    it('never sends one anonymously', async () => {
      await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: true,
        notifyOwner: true,
      });

      expect(sent).toHaveLength(2);
      for (const mail of sent) expect(mail.ownerUserId).toBe('u1');
    });
  });

  describe('what the owner is told is still outstanding', () => {
    it('says nothing about intake when no form was ever sent', async () => {
      // `intake_completed_at` is null for every booking of every business that
      // does not collect intake at all.
      bookingState.data = bookingAsRepositoryReturnsIt({
        intake_sent_at: null,
        intake_completed_at: null,
      });

      await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: false,
        notifyOwner: true,
      });

      expect(ownerMail()!.html).toContain('Nothing outstanding');
    });

    it('flags a form that was sent and never came back', async () => {
      bookingState.data = bookingAsRepositoryReturnsIt({
        intake_sent_at: new Date().toISOString(),
        intake_completed_at: null,
      });

      await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: false,
        notifyOwner: true,
      });

      expect(ownerMail()!.html).toContain('has not come back');
    });

    it('says nothing about a form that came back', async () => {
      bookingState.data = bookingAsRepositoryReturnsIt({
        intake_sent_at: new Date().toISOString(),
        intake_completed_at: new Date().toISOString(),
      });

      await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: false,
        notifyOwner: true,
      });

      expect(ownerMail()!.html).not.toContain('has not come back');
    });

    it('names money in the currency the booking was taken in', async () => {
      // Never a bare number: the platform holds no exchange rate, and a
      // business in Israel may bill a US client in dollars.
      bookingState.data = bookingAsRepositoryReturnsIt({
        payment_status: 'pending',
        payment_amount: 420,
        payment_currency: 'ILS',
      });

      await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: false,
        notifyOwner: true,
      });

      expect(ownerMail()!.html).toMatch(/₪\s?420/);
    });

    it('says nothing about money on a booking that is paid', async () => {
      await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: false,
        notifyOwner: true,
      });

      expect(ownerMail()!.html).toContain('Nothing outstanding');
    });
  });

  describe('the two audiences are independent', () => {
    it('sends to both when both are asked for', async () => {
      const result = await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: true,
        notifyOwner: true,
      });

      expect(result.sent).toBe(true);
      expect(sent).toHaveLength(2);
    });

    it('still reminds the owner when the client address bounces', async () => {
      sendOutcome.client = false;

      const result = await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: true,
        notifyOwner: true,
      });

      expect(result.sent).toBe(true);
      expect(ownerMail()).toBeDefined();
    });

    it('still reminds the client when there is no owner address', async () => {
      const result = await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: true,
        notifyOwner: false,
      });

      expect(result.sent).toBe(true);
      expect(clientMail()).toBeDefined();
    });

    it('reports failure only when it reached nobody', async () => {
      sendOutcome.client = false;
      sendOutcome.owner = false;

      const result = await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: true,
        notifyOwner: true,
      });

      expect(result.sent).toBe(false);
    });

    it('sends nothing to a client with no address on file', async () => {
      bookingState.data = bookingAsRepositoryReturnsIt({ client_email: '' });

      await BookingEmailService.sendMeetingReminder('bk-1', 'u1', {
        notifyClient: true,
        notifyOwner: false,
      });

      expect(sent).toHaveLength(0);
    });
  });
});
