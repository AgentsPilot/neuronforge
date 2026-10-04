/**
 * runQueueDrain (ADMIN_BOS_CLEANUP slice 7d; C7-10, C7-16): each queue calls
 * exactly the entry point its cron calls, once, with no arguments, and no
 * other. The five service modules are replaced by factories (W7D-6), so no
 * real service, database client or PDF chain is loaded.
 */

const mockProcessDueReminders = jest.fn();
const mockProcessOverdueItems = jest.fn();
const mockBillDueDatedStages = jest.fn();
const mockProcessScheduledExecutions = jest.fn();
const mockProcessDueBriefings = jest.fn();
const mockDispatchLeadResponses = jest.fn();
const mockDrainInsightActions = jest.fn();

jest.mock('@/lib/services/PaymentReminderService', () => ({
  paymentReminderService: {
    processDueReminders: (...args: unknown[]) => mockProcessDueReminders(...args),
    // The cron route also calls these two. Drain now must never.
    processOverdueItems: (...args: unknown[]) => mockProcessOverdueItems(...args),
    billDueDatedStages: (...args: unknown[]) => mockBillDueDatedStages(...args),
  },
}));
jest.mock('@/lib/services/PaymentAutomationEngine', () => ({
  paymentAutomationEngine: {
    processScheduledExecutions: (...args: unknown[]) => mockProcessScheduledExecutions(...args),
  },
}));
jest.mock('@/lib/services/DailyBriefingDispatchService', () => ({
  processDueBriefings: (...args: unknown[]) => mockProcessDueBriefings(...args),
}));
jest.mock('@/lib/services/LeadResponseDispatchService', () => ({
  dispatchLeadResponses: (...args: unknown[]) => mockDispatchLeadResponses(...args),
}));
jest.mock('@/lib/services/InsightActionDispatchService', () => ({
  drainInsightActions: (...args: unknown[]) => mockDrainInsightActions(...args),
}));

import { runQueueDrain } from '@/lib/admin/jobs/runQueueDrain';
import { BOS_QUEUES, type BosQueueId } from '@/lib/cron/bosCronJobs';

const ENTRY: Record<BosQueueId, jest.Mock> = {
  payment_reminders: mockProcessDueReminders,
  payment_automations: mockProcessScheduledExecutions,
  daily_briefing_sends: mockProcessDueBriefings,
  lead_responses: mockDispatchLeadResponses,
  insight_actions: mockDrainInsightActions,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProcessDueReminders.mockResolvedValue({ processed: 2, sent: 1, failed: 1 });
  mockProcessScheduledExecutions.mockResolvedValue(undefined);
  mockProcessDueBriefings.mockResolvedValue({ enqueued: 1, sent: 1, skipped: 0, failed: 0 });
  mockDispatchLeadResponses.mockResolvedValue({ reaped: 0, enqueued: 1, claimed: 1, sent: 1, skipped: 0 });
  mockDrainInsightActions.mockResolvedValue({ reaped: 0, claimed: 1, sent: 1, skipped: 0, failed: 0 });
});

describe('runQueueDrain', () => {
  it.each(BOS_QUEUES.map((q) => q.id))('%s calls exactly its own entry point, once, with no arguments', async (queue) => {
    await runQueueDrain(queue);

    for (const [id, mock] of Object.entries(ENTRY)) {
      if (id === queue) {
        expect(mock).toHaveBeenCalledTimes(1);
        expect(mock).toHaveBeenCalledWith();
      } else {
        expect(mock).not.toHaveBeenCalled();
      }
    }
    expect(mockProcessOverdueItems).not.toHaveBeenCalled();
    expect(mockBillDueDatedStages).not.toHaveBeenCalled();
  });

  it('returns the allow-listed counts of the drain', async () => {
    await expect(runQueueDrain('payment_reminders')).resolves.toEqual([
      { key: 'processed', label: 'picked up', value: 2 },
      { key: 'sent', label: 'sent', value: 1 },
      { key: 'failed', label: 'failed', value: 1 },
    ]);
    await expect(runQueueDrain('payment_automations')).resolves.toEqual([]);
  });

  it('a drain that rejects propagates the rejection', async () => {
    mockDrainInsightActions.mockRejectedValueOnce(new Error('claim failed'));
    await expect(runQueueDrain('insight_actions')).rejects.toThrow('claim failed');
  });
});
