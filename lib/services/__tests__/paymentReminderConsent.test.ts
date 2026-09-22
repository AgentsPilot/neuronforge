/**
 * One switch for chasing an unpaid invoice.
 *
 * Invoice chasing was built twice. `PaymentReminderService` sent on days 1, 3
 * and 7 past due, gated on `payment_reminder_enabled` — true everywhere, never
 * asked about. The advisor's own sweep sent once at 72 hours past due, gated on
 * `chase_invoices_enabled`. Seventy-two hours past due IS day three, and the two
 * dedupe in different tables, so a client got two emails from one business about
 * one invoice on the same day.
 *
 * These are the rules that keep it to one.
 */

import { PaymentReminderService } from '../PaymentReminderService';
import { OPERATIONAL_AUTOMATIONS } from '@/lib/business-os/gaps/automations';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/payments/paymentReactionEnqueuer', () => ({
  emitPaymentEvent: jest.fn().mockResolvedValue(undefined),
}));

interface Profile {
  payment_reminder_enabled?: boolean | null;
  chase_invoices_enabled?: boolean | null;
}

/** Only `business_profiles` is read by the paths under test. */
function mockSupabase(profile: Profile | null) {
  return {
    from() {
      const chain: Record<string, unknown> = {
        single: async () => ({ data: profile, error: null }),
        maybeSingle: async () => ({ data: profile, error: null }),
      };
      for (const m of ['select', 'eq', 'in', 'lt', 'gte', 'order', 'limit']) chain[m] = () => chain;
      return chain;
    },
  };
}

function service(profile: Profile | null) {
  return new PaymentReminderService(mockSupabase(profile) as never);
}

describe('who may be chased about a past-due invoice', () => {
  it('reads the advisor\'s answer, not the settings toggle', async () => {
    const config = await service({
      payment_reminder_enabled: true,
      chase_invoices_enabled: true,
    }).getUserReminderConfig('user-1');

    expect(config.chaseOverdue).toBe(true);
  });

  it('treats an absent column as no', async () => {
    /*
     * Every other default in this service is generous, because the cost of
     * guessing wrong is a reminder nobody needed. The cost here is writing to
     * someone else's client about a debt without the owner agreeing.
     */
    const config = await service({ payment_reminder_enabled: true }).getUserReminderConfig('user-1');

    expect(config.chaseOverdue).toBe(false);
  });

  it('refuses an overdue reminder when the owner has not said yes', async () => {
    const { data, error } = await service({
      payment_reminder_enabled: true,
      chase_invoices_enabled: false,
    }).scheduleReminder('user-1', {
      contactId: 'c1',
      invoiceId: 'i1',
      reminderType: 'overdue',
      scheduledAt: new Date().toISOString(),
    });

    expect(data).toBeNull();
    expect(error?.message).toMatch(/not been turned on/);
  });

  it('does not make the past-due chase depend on the pre-due toggle as well', async () => {
    /*
     * The card says "Working on its own". If a second switch could silently
     * stop the sending, the card would be stating something it cannot know —
     * the defect this whole change exists to remove. Past due answers to one
     * switch, and it is the one the owner was shown.
     */
    const { error } = await service({
      payment_reminder_enabled: false,
      chase_invoices_enabled: true,
    }).scheduleReminder('user-1', {
      contactId: 'c1',
      invoiceId: 'i1',
      reminderType: 'overdue',
      scheduledAt: new Date().toISOString(),
    });

    /*
     * It gets past the gate and on to writing the row, which this mock does not
     * serve — so the assertion is that it was NOT refused, rather than that it
     * succeeded. Mocking the whole insert would test the storage layer instead
     * of the rule.
     */
    expect(error?.message ?? '').not.toMatch(/disabled|not been turned on/);
  });

  it('still governs pre-due reminders with the settings toggle', async () => {
    // A reminder before the date is a courtesy — here is what is coming, on
    // this day. It needs no permission, and turning it off must still work.
    const { data, error } = await service({
      payment_reminder_enabled: false,
      chase_invoices_enabled: true,
    }).scheduleReminder('user-1', {
      contactId: 'c1',
      invoiceId: 'i1',
      reminderType: 'upcoming_due',
      scheduledAt: new Date().toISOString(),
    });

    expect(data).toBeNull();
    expect(error?.message).toMatch(/disabled/);
  });
});

describe('the advisor no longer sends this one itself', () => {
  it('marks the invoice chase as carried out elsewhere', () => {
    /*
     * The registry field the dispatch sweep checks. Removing it would restore
     * the day-three collision, so the assertion is on the fact rather than on
     * the sweep's behaviour.
     */
    const chase = OPERATIONAL_AUTOMATIONS.find(a => a.id === 'chase_invoices')!;

    expect(chase.carriedOutBy).toBe('payment_reminders');
  });

  it('leaves the other automations sending through the queue', () => {
    const others = OPERATIONAL_AUTOMATIONS.filter(a => a.id !== 'chase_invoices');

    expect(others.every(a => a.carriedOutBy === undefined)).toBe(true);
  });
});
