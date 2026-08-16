/**
 * Unit tests for the emit→enqueue seam (paymentReactionEnqueuer).
 *
 * Asserts:
 *  - a MATCHING event enqueues a `pending` execution row carrying trigger_event_id.
 *  - a NON-matching event enqueues nothing.
 *  - the lazy guarded default-rule seed (ensureDefaultPaymentRules) is invoked.
 *
 * Repo singletons + the default-seed are mocked; ruleEvaluation stays real (pure).
 */

jest.mock('@/lib/repositories/PaymentAutomationRepository', () => ({
  paymentAutomationRuleRepository: { findActiveForEvent: jest.fn() },
  paymentAutomationExecutionRepository: { enqueue: jest.fn() },
}));
jest.mock('@/lib/payments/defaultPaymentRules', () => ({
  ensureDefaultPaymentRules: jest.fn().mockResolvedValue(undefined),
}));

import { enqueuePaymentReactions } from '@/lib/payments/paymentReactionEnqueuer';
import {
  paymentAutomationRuleRepository,
  paymentAutomationExecutionRepository,
} from '@/lib/repositories/PaymentAutomationRepository';
import { ensureDefaultPaymentRules } from '@/lib/payments/defaultPaymentRules';
import type { PaymentEvent } from '@/lib/services/PaymentEventService';

const findActive = paymentAutomationRuleRepository.findActiveForEvent as jest.Mock;
const enqueue = paymentAutomationExecutionRepository.enqueue as jest.Mock;

function makeEvent(metadata: Record<string, unknown>): PaymentEvent {
  return {
    id: 'evt-1',
    user_id: 'u1',
    event_type: 'installment.due_approaching',
    entity_type: 'installment',
    entity_id: 'inst-1',
    contact_id: 'c1',
    processor_type: null,
    metadata,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

const matchingRule = {
  id: 'rule-1',
  user_id: 'u1',
  name: 'r',
  description: null,
  is_active: true,
  trigger_event: 'installment.due_approaching',
  trigger_conditions: [{ field: 'metadata.days_until_due', operator: 'eq', value: 3 }],
  action_block: 'send_payment_reminder',
  action_parameters: { installment_id: '$entity_id' },
  delay_minutes: 0,
  max_executions_per_entity: 1,
  cooldown_hours: 24,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  enqueue.mockResolvedValue({ data: { id: 'exec-1' }, error: null });
});

describe('enqueuePaymentReactions', () => {
  it('seeds defaults then enqueues a pending row with trigger_event_id for a matching event', async () => {
    findActive.mockResolvedValue({ data: [matchingRule], error: null });

    await enqueuePaymentReactions(makeEvent({ days_until_due: 3 }));

    expect(ensureDefaultPaymentRules).toHaveBeenCalledWith('u1', paymentAutomationRuleRepository);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      user_id: 'u1',
      rule_id: 'rule-1',
      entity_type: 'installment',
      entity_id: 'inst-1',
      trigger_event_id: 'evt-1',
      status: 'pending',
    });
  });

  it('enqueues nothing when the event does not match the rule conditions', async () => {
    findActive.mockResolvedValue({ data: [matchingRule], error: null });

    await enqueuePaymentReactions(makeEvent({ days_until_due: 1 }));

    expect(ensureDefaultPaymentRules).toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues nothing when there are no active rules', async () => {
    findActive.mockResolvedValue({ data: [], error: null });

    await enqueuePaymentReactions(makeEvent({ days_until_due: 3 }));

    expect(enqueue).not.toHaveBeenCalled();
  });
});
