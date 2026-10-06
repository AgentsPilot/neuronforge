/**
 * reminderRetryTime (ADMIN_BOS_CLEANUP slice 7c; SA C7-8, OP-3, W7C-7;
 * workplan §2.4 and §5.13 H-1). The one service call on the admin action
 * path: the retried reminder's next sending-hours time, for the ROW's owner.
 * Its source shape is pinned by S-10 in
 * app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts.
 */

const mockNextSendableAt = jest.fn();
const mockProcessDueReminders = jest.fn();
jest.mock('@/lib/services/PaymentReminderService', () => ({
  paymentReminderService: {
    nextSendableAt: (...args: unknown[]) => mockNextSendableAt(...args),
    processDueReminders: (...args: unknown[]) => mockProcessDueReminders(...args),
  },
}));

import { reminderRetryTime } from '@/lib/admin/jobs/reminderRetryTime';

beforeEach(() => jest.clearAllMocks());

describe('H-1 reminderRetryTime', () => {
  it('calls nextSendableAt(owner, now) once and returns its result', async () => {
    const now = new Date('2026-10-04T21:30:00.000Z');
    const next = new Date('2026-10-05T08:00:00.000Z');
    mockNextSendableAt.mockResolvedValueOnce(next);
    await expect(reminderRetryTime('OWNER-A', now)).resolves.toBe(next);
    expect(mockNextSendableAt).toHaveBeenCalledTimes(1);
    expect(mockNextSendableAt).toHaveBeenCalledWith('OWNER-A', now);
    expect(mockProcessDueReminders).not.toHaveBeenCalled();
  });

  it('a rejection propagates (the route answers 500 action_failed and writes nothing)', async () => {
    mockNextSendableAt.mockRejectedValueOnce(new Error('zone read failed'));
    await expect(reminderRetryTime('OWNER-A', new Date())).rejects.toThrow('zone read failed');
  });
});
