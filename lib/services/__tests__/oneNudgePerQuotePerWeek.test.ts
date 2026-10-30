/**
 * One quote is nudged once a week, not once per run.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `sendQuoteReminder` had exactly one guard — the quote must still be `sent` or
 * `viewed` — and that guard releases only when the client ANSWERS. The entire
 * premise of a nudge is that they have not. So an unanswered quote passed every
 * check on every run.
 *
 * `followUpStalledDeals` is what made that expensive. Both of its filters look
 * like deduplication and neither is:
 *
 *     sent_at <  today - 7                     the day the QUOTE was sent
 *     sent_at >= today - stop_after_days       the same static day
 *
 * `sendQuoteReminder` deliberately never touches `sent_at` — its own comment
 * says so, because the 72-hour gap measure depends on it. So between those two
 * dates the pair is permanently true. With `daily` offered as a cadence and 45
 * days as a stop rule, that is weeks of consecutive mornings telling one client
 * about one quote they are still thinking about.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `crm_activities`, KEYED ON THE QUOTE
 *
 * The quote's own send already writes there as `proposal_sent`, from this same
 * file, with `source_entity_id: proposal.id`. The nudge is the same row shape
 * with its own verb, which means the gate reuses a table the owner already
 * reads instead of introducing a private marker nobody can see.
 *
 * Keyed on `source_entity_id` and NOT `contact_id`, because a contact may hold
 * two quotes and a nudge about one must not silence the other.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const findById = jest.fn();
const findRecentForEntity = jest.fn();
const createActivity = jest.fn();
const sendEmail = jest.fn();
const recordEmailSend = jest.fn();

jest.mock('@/lib/repositories/ProposalRepository', () => ({
  proposalRepository: { findById: (...a: unknown[]) => findById(...a) },
}));

jest.mock('@/lib/repositories/CRMActivityRepository', () => ({
  crmActivityRepository: {
    findRecentForEntity: (...a: unknown[]) => findRecentForEntity(...a),
    create: (...a: unknown[]) => createActivity(...a),
  },
}));

jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

jest.mock('@/lib/notifications/recordEmailSend', () => ({
  recordEmailSend: (...a: unknown[]) => recordEmailSend(...a),
}));

jest.mock('@/lib/email/branding', () => ({
  resolveEmailBranding: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/lib/email/templates/proposal', () => ({
  generateProposalEmail: () => ({ subject: '', html: '' }),
  generateQuoteStoppedEmail: () => ({ subject: '', html: '' }),
  generateQuoteReminderEmail: () => ({ subject: 'Still thinking it over?', html: '<p/>' }),
}));

/* The two direct reads this function still does: the client's address and the
   business's language. Neither is what the test is about, so both answer. */
jest.mock('@/lib/supabaseServer', () => {
  const row = (table: string) =>
    table === 'crm_contacts'
      ? { first_name: 'Dana', email: 'client@example.com' }
      : { language: 'en' };

  return {
    supabaseServer: {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: row(table), error: null }),
          insert: () => Promise.resolve({ data: null, error: null }),
        };
        return chain;
      },
    },
  };
});

/* The link is signed, and signing refuses without a secret. Set rather than
   mocked, so the test walks the real path the client's link is built on. */
process.env.BOOKING_TOKEN_SECRET = 'test-secret-for-quote-reminder-links';

import { sendQuoteReminder } from '../ProposalSendService';

const USER = 'owner-1';
const QUOTE = 'proposal-1';
const CONTACT = 'contact-1';

/** Sent, unanswered, with somewhere to send to. */
function quote(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: QUOTE,
      user_id: USER,
      contact_id: CONTACT,
      title: 'Six sessions',
      status: 'sent',
      total: 600,
      currency: 'GBP',
      valid_until: null,
      sent_at: '2026-10-01T09:00:00.000Z',
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(quote());
  findRecentForEntity.mockResolvedValue({ data: [], error: null });
  createActivity.mockResolvedValue({ data: { id: 'act-1' }, error: null });
  sendEmail.mockResolvedValue({ sent: true });
  recordEmailSend.mockResolvedValue(undefined);
});

describe('it asks before it sends', () => {
  it('reads this quote nudge history over seven days', async () => {
    await sendQuoteReminder(QUOTE, USER);

    expect(findRecentForEntity).toHaveBeenCalledTimes(1);
    const [userId, entityId, type, since] = findRecentForEntity.mock.calls[0];

    expect(userId).toBe(USER);
    /* The QUOTE, not the contact. A contact holding two quotes must be able to
       hear about both. */
    expect(entityId).toBe(QUOTE);
    expect(type).toBe('proposal_reminder');
    expect(Math.round((Date.now() - Date.parse(since as string)) / 86_400_000)).toBe(7);
  });

  it('refuses when this quote was nudged inside the window', async () => {
    findRecentForEntity.mockResolvedValue({ data: [{ id: 'act-earlier' }], error: null });

    const outcome = await sendQuoteReminder(QUOTE, USER);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('already_reminded');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses when the history cannot be read — fails closed', async () => {
    /*
     * An unreadable history is exactly when a duplicate is most likely, so it
     * is not permission to send. A nudge that goes quiet is a quote somebody
     * chases by hand; one that sends blind is a client hearing the same
     * question twice.
     */
    findRecentForEntity.mockResolvedValue({ data: null, error: new Error('database unreachable') });

    const outcome = await sendQuoteReminder(QUOTE, USER);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('history_unreadable');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends when the window is clear', async () => {
    const outcome = await sendQuoteReminder(QUOTE, USER);

    expect(outcome.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('it records what it sent', () => {
  it('writes the nudge to the client timeline once the send is confirmed', async () => {
    await sendQuoteReminder(QUOTE, USER);

    expect(createActivity).toHaveBeenCalledTimes(1);
    const row = createActivity.mock.calls[0][0] as Record<string, unknown>;

    expect(row.user_id).toBe(USER);
    expect(row.contact_id).toBe(CONTACT);
    expect(row.activity_type).toBe('proposal_reminder');
    /* Not `proposal_sent`. That verb means the quote itself, and a nudge
       wearing it would read as a second quote on the timeline. */
    expect(row.activity_type).not.toBe('proposal_sent');
    expect(row.source_entity_id).toBe(QUOTE);
    expect(row.activity_date).toBeTruthy();
  });

  it('the row it writes is the row it later reads', async () => {
    /*
     * THE POINT OF THE WHOLE FIX, asserted as a pair. A marker written under
     * one key and read under another is not a gate, and nothing else here
     * would notice: the write succeeds, the read finds nothing, and the client
     * gets a nudge a day.
     */
    await sendQuoteReminder(QUOTE, USER);

    const written = createActivity.mock.calls[0][0] as Record<string, unknown>;
    const [, readEntityId, readType] = findRecentForEntity.mock.calls[0];

    expect(written.source_entity_id).toBe(readEntityId);
    expect(written.activity_type).toBe(readType);
  });

  it('records NOTHING when the send was refused', async () => {
    /*
     * The ordering that matters. A row written before a delivery that never
     * happened silences the next seven days for a client who heard nothing.
     */
    sendEmail.mockResolvedValue({ sent: false, error: 'mailbox unavailable' });

    const outcome = await sendQuoteReminder(QUOTE, USER);

    expect(outcome.ok).toBe(false);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it('does not let `recordEmailSend` stand in for the marker', async () => {
    /*
     * `recordEmailSend` runs on the failure path too, by design — a reminder
     * that failed is what somebody comes looking for. That is exactly why it
     * cannot double as the cooldown marker: it would silence a week on a send
     * that bounced.
     */
    sendEmail.mockResolvedValue({ sent: false, error: 'mailbox unavailable' });

    await sendQuoteReminder(QUOTE, USER);

    expect(recordEmailSend).toHaveBeenCalledTimes(1);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it('still reports the send when the record fails', async () => {
    /* Non-blocking. The email has already left: reporting a failure invites a
       retry that definitely duplicates. */
    createActivity.mockResolvedValue({ data: null, error: new Error('write failed') });

    const outcome = await sendQuoteReminder(QUOTE, USER);

    expect(outcome.ok).toBe(true);
  });
});

describe('the check that was already there still holds', () => {
  it('refuses an answered quote before reading any history', async () => {
    /* Nudging somebody about a decision they have already made is the worst
       outcome available, so it stays the first question asked. */
    findById.mockResolvedValue(quote({ status: 'accepted' }));

    const outcome = await sendQuoteReminder(QUOTE, USER);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('already_answered');
    expect(findRecentForEntity).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('the status check is not the repeat guard', async () => {
    /*
     * What was actually wrong, stated as a test. A quote still at `sent` is the
     * normal case for a nudge, so passing the status check must NOT be enough
     * to send — the history is still consulted.
     */
    await sendQuoteReminder(QUOTE, USER);

    expect(findById).toHaveBeenCalled();
    expect(findRecentForEntity).toHaveBeenCalled();
  });
});
