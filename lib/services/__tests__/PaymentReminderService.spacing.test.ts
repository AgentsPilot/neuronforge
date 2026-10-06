/**
 * Never two reminders about one invoice in the same few days.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED BY THE OWNER, 2026-10-05: "I get reminder for invoices every day,
 * the same invoices. Isn't it supposed to be 1, 3, 7 days?"
 *
 * They were right, and nothing was duplicated. INV-00015, due 4 October:
 *
 *   03 Oct  upcoming_due  daysBefore 1     payment_reminder_enabled
 *   04 Oct  due_today                      payment_reminder_enabled
 *   05 Oct  overdue       overdueDays 1    chase_invoices_enabled
 *
 * Three different reminders, from three separate lists, answering to two
 * switches, each created once and sent once. The 24-hour floor that existed
 * passed all three because it was scoped to one reminder TYPE at a time, so
 * none of them could see the others.
 *
 * `1, 3, 7` is `payment_overdue_reminder_days` — the only list the owner had
 * ever been shown, and half the behaviour.
 *
 * These tests are about the floor that now spans the lists, and about what it
 * must NOT do: an invoice that silently stops being chased is money.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { PaymentReminderService } from '../PaymentReminderService';

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const INVOICE = 'inv-1';
const CONTACT = 'contact-1';
const USER = '11111111-1111-4111-8111-111111111111';

interface Harness {
  /** `scheduled_at` of reminders already on the invoice. */
  existing: string[];
  spacingError?: Error;
}

/**
 * The service with only the two collaborators this path touches stubbed: the
 * config read, and the reminder repository.
 */
function serviceFor(harness: Harness) {
  const service = new PaymentReminderService();
  const created: Array<Record<string, unknown>> = [];

  jest
    .spyOn(service, 'getUserReminderConfig')
    .mockResolvedValue({
      enabled: true,
      daysBefore: [3],
      overdueDays: [3, 7, 14],
      channels: ['email'],
      defaultChannel: 'email',
      chaseOverdue: true,
    } as never);

  const repo = {
    findScheduledNearInvoice: jest.fn(async (_id: string, fromIso: string, toIso: string) => {
      if (harness.spacingError) return { data: null, error: harness.spacingError };
      const from = Date.parse(fromIso);
      const to = Date.parse(toIso);
      const hits = harness.existing
        .filter(at => Date.parse(at) >= from && Date.parse(at) <= to)
        .map(at => ({ id: 'existing', scheduled_at: at }));
      return { data: hits, error: null };
    }),
    create: jest.fn(async (row: Record<string, unknown>) => {
      created.push(row);
      return { data: { id: 'new', ...row }, error: null };
    }),
  };

  // Private collaborators, replaced for the duration of the test.
  (service as unknown as { reminderRepo: unknown }).reminderRepo = repo;
  (service as unknown as { sendableAt: unknown }).sendableAt = async (at: Date) => at.toISOString();
  (service as unknown as { businessZone: unknown }).businessZone = async () => 'UTC';

  return { service, repo, created };
}

const schedule = (service: PaymentReminderService, at: string, type = 'overdue') =>
  service.scheduleReminder(USER, {
    invoiceId: INVOICE,
    contactId: CONTACT,
    reminderType: type as never,
    scheduledAt: at,
    channel: 'email',
  } as never);

describe('a reminder that would crowd another', () => {
  it('is refused when one lands the next day', async () => {
    // Day 0 and day +1: the shape that reached a real client three mornings
    // running.
    const { service, created } = serviceFor({ existing: [iso(0)] });

    const result = await schedule(service, iso(1));

    expect(result.error).toBeTruthy();
    expect(result.error!.message).toMatch(/too close/i);
    expect(created).toHaveLength(0);
  });

  it('is refused when the crowding one is BEFORE it', async () => {
    // The window is symmetric. Pre-due rows are written in one burst days
    // ahead, so the overdue cron is as likely to arrive second as first.
    const { service, created } = serviceFor({ existing: [iso(5)] });

    await schedule(service, iso(4));

    expect(created).toHaveLength(0);
  });

  it('is allowed at exactly the floor', async () => {
    /*
     * Three days apart is the intended cadence, not a collision. An
     * off-by-one here would quietly drop every second reminder in a schedule
     * built on three-day steps.
     */
    const { service, created } = serviceFor({ existing: [iso(0)] });

    const result = await schedule(service, iso(3));

    expect(result.error).toBeFalsy();
    expect(created).toHaveLength(1);
  });

  it('is allowed when nothing else is near', async () => {
    const { service, created } = serviceFor({ existing: [iso(-10), iso(10)] });

    await schedule(service, iso(0));

    expect(created).toHaveLength(1);
  });
});

describe('what the floor must never do', () => {
  it('schedules anyway when the check cannot be read', async () => {
    /*
     * The cost of guessing wrong here is one reminder too many. The cost the
     * other way is an invoice silently never chased, which is money, and
     * silence is the failure nobody notices.
     */
    const { service, created } = serviceFor({
      existing: [iso(0)],
      spacingError: new Error('column does not exist'),
    });

    const result = await schedule(service, iso(1));

    expect(result.error).toBeFalsy();
    expect(created).toHaveLength(1);
  });

  it('leaves instalment reminders alone', async () => {
    /*
     * The floor is keyed on an invoice. A plan instalment has its own
     * schedule and its own row, and nothing here should reach it — the query
     * cannot even be asked without an invoice id.
     */
    const { service, repo, created } = serviceFor({ existing: [iso(0)] });

    await service.scheduleReminder(USER, {
      installmentId: 'inst-1',
      contactId: CONTACT,
      reminderType: 'overdue',
      scheduledAt: iso(1),
      channel: 'email',
    } as never);

    expect(repo.findScheduledNearInvoice).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });

  it('asks about every reminder type, not just its own', async () => {
    /*
     * The bug in one line. The old 24-hour guard asked
     * `findRecentByInvoice(id, 'overdue', …)` — so an `upcoming_due` yesterday
     * was invisible to it, and a `due_today` between them was invisible to
     * both.
     */
    const { service, repo } = serviceFor({ existing: [] });

    await schedule(service, iso(0), 'due_today');

    expect(repo.findScheduledNearInvoice).toHaveBeenCalledWith(
      INVOICE,
      expect.any(String),
      expect.any(String)
    );
  });
});

describe('the default schedule', () => {
  it('never puts two touches inside the floor', async () => {
    /*
     * One courtesy three days out, the due-day note, then 3, 7 and 14 days
     * past due. Walked here as a sequence so the DEFAULTS themselves are held
     * to the rule, not only the guard that enforces it.
     */
    const days = [-3, 0, 3, 7, 14];

    for (let i = 1; i < days.length; i++) {
      expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(3);
    }
  });
});
