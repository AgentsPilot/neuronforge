/**
 * Drain test for PaymentReminderService.processDueReminders (claim-based).
 *
 * Models SKIP LOCKED: the first drain claims a batch, a second concurrent drain
 * gets an empty (disjoint) set. Asserts each claimed reminder is dispatched exactly
 * once and that an already-drained row is never re-dispatched.
 *
 * PaymentEventService.emit is mocked (no DB); the repo claim/reap/update methods
 * and the private dispatch helper are spied so the test is hermetic.
 */

jest.mock('@/lib/services/PaymentEventService', () => ({
  emitPaymentEvent: jest.fn().mockResolvedValue({ data: null, error: null }),
}));

import { PaymentReminderService } from '@/lib/services/PaymentReminderService';
import { PaymentReminderRepository } from '@/lib/repositories/PaymentReminderRepository';

function makeReminder(id: string) {
  return {
    id,
    user_id: 'u1',
    invoice_id: null,
    installment_id: null,
    contact_id: 'c1',
    reminder_type: 'upcoming_due',
    scheduled_at: '2026-01-01T00:00:00.000Z',
    sent_at: null,
    channel: 'email',
    template_id: null,
    status: 'processing',
    metadata: {},
    error_message: null,
    created_at: '2026-01-01T00:00:00.000Z',
  } as any;
}

describe('PaymentReminderService.processDueReminders — claim drain', () => {
  let service: PaymentReminderService;
  let claimSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;
  let dispatchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new PaymentReminderService({} as any);

    jest.spyOn(PaymentReminderRepository.prototype, 'reapStale').mockResolvedValue({ data: [], error: null });
    claimSpy = jest.spyOn(PaymentReminderRepository.prototype, 'claimDue');
    updateSpy = jest
      .spyOn(PaymentReminderRepository.prototype, 'updateStatus')
      .mockResolvedValue({ data: null, error: null });
    dispatchSpy = jest
      .spyOn(service as any, 'dispatchReminderRow')
      .mockResolvedValue({ sent: true, errorMessage: null });
  });

  it('dispatches each claimed reminder exactly once; a second (empty) drain re-dispatches nothing', async () => {
    // First drain claims two; second concurrent drain gets the disjoint empty set.
    claimSpy
      .mockResolvedValueOnce({ data: [makeReminder('r1'), makeReminder('r2')], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const first = await service.processDueReminders();
    const second = await service.processDueReminders();

    expect(first).toEqual({ processed: 2, sent: 2, failed: 0 });
    expect(second).toEqual({ processed: 0, sent: 0, failed: 0 });

    // Exactly one dispatch per claimed row, never re-dispatched.
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    const dispatchedIds = dispatchSpy.mock.calls.map((c: any[]) => c[0].id).sort();
    expect(dispatchedIds).toEqual(['r1', 'r2']);

    // Each row persisted terminal 'sent' on its own id.
    expect(updateSpy).toHaveBeenCalledTimes(2);
    for (const call of updateSpy.mock.calls) {
      expect(call[1]).toBe('u1');
      expect(call[2]).toMatchObject({ status: 'sent' });
    }
  });

  it('marks a reminder failed when dispatch reports not sent', async () => {
    dispatchSpy.mockResolvedValue({ sent: false, errorMessage: 'Contact not found' });
    claimSpy.mockResolvedValueOnce({ data: [makeReminder('r1')], error: null });

    const stats = await service.processDueReminders();

    expect(stats).toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(updateSpy.mock.calls[0][2]).toMatchObject({ status: 'failed', error_message: 'Contact not found' });
  });
});
