/**
 * Drain test for PaymentAutomationEngine.processScheduledExecutions (claim-based).
 *
 * Regressions covered:
 *  - defect 1: a claimed execution goes pending→running(claim)→completed on the SAME
 *    row (complete() is called with the claimed row's id; no phantom second row).
 *  - a `completed` row is not re-claimed (the second, empty claim does nothing).
 *  - M3 guardrail at the choke point: when countCompletedForEntity (excluding self)
 *    >= max_executions_per_entity, the row is failed and the block is NOT executed.
 *
 * The execution repo singleton + the rule/event repo prototypes are spied; the pure
 * helpers (buildActionParameters) and getBlock stay real.
 */

import { PaymentAutomationEngine } from '@/lib/services/PaymentAutomationEngine';
import {
  PaymentAutomationRuleRepository,
  paymentAutomationExecutionRepository,
} from '@/lib/repositories/PaymentAutomationRepository';
import { PaymentEventRepository } from '@/lib/repositories/PaymentEventRepository';

function makeExecution() {
  return {
    id: 'exec-1',
    user_id: 'u1',
    rule_id: 'rule-1',
    entity_type: 'invoice',
    entity_id: 'inv-1',
    trigger_event_id: 'evt-1',
    status: 'running',
    scheduled_at: '2026-01-01T00:00:00.000Z',
    executed_at: null,
    result: null,
    error_message: null,
    created_at: '2026-01-01T00:00:00.000Z',
  } as any;
}

const rule = {
  id: 'rule-1',
  user_id: 'u1',
  name: 'retry',
  description: null,
  is_active: true,
  trigger_event: 'payment.failed',
  trigger_conditions: null,
  action_block: 'send_payment_reminder',
  action_parameters: { invoice_id: '$entity_id' },
  delay_minutes: 0,
  max_executions_per_entity: 1,
  cooldown_hours: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} as any;

const event = {
  id: 'evt-1',
  user_id: 'u1',
  event_type: 'payment.failed',
  entity_type: 'invoice',
  entity_id: 'inv-1',
  contact_id: 'c1',
  processor_type: null,
  metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
} as any;

describe('PaymentAutomationEngine.processScheduledExecutions — claim drain', () => {
  let engine: PaymentAutomationEngine;
  let claimSpy: jest.SpyInstance;
  let completeSpy: jest.SpyInstance;
  let failSpy: jest.SpyInstance;
  let countSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    engine = new PaymentAutomationEngine({} as any);

    jest.spyOn(paymentAutomationExecutionRepository, 'reapStale').mockResolvedValue({ data: [], error: null });
    claimSpy = jest.spyOn(paymentAutomationExecutionRepository, 'claimDue');
    completeSpy = jest.spyOn(paymentAutomationExecutionRepository, 'complete').mockResolvedValue({ data: null, error: null });
    failSpy = jest.spyOn(paymentAutomationExecutionRepository, 'fail').mockResolvedValue({ data: null, error: null });
    countSpy = jest
      .spyOn(paymentAutomationExecutionRepository, 'countCompletedForEntity')
      .mockResolvedValue({ data: 0, error: null });
    jest
      .spyOn(paymentAutomationExecutionRepository, 'hasRecentForEntity')
      .mockResolvedValue({ data: false, error: null });

    jest.spyOn(PaymentAutomationRuleRepository.prototype, 'findByIdUnscoped').mockResolvedValue({ data: rule, error: null });
    jest.spyOn(PaymentEventRepository.prototype, 'findByIdUnscoped').mockResolvedValue({ data: event, error: null });
  });

  it('completes a claimed execution on the SAME row; a second (empty) claim does nothing', async () => {
    claimSpy
      .mockResolvedValueOnce({ data: [makeExecution()], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await engine.processScheduledExecutions();

    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(completeSpy.mock.calls[0][0]).toBe('exec-1');
    expect(failSpy).not.toHaveBeenCalled();

    // Second drain: no pending rows returned → completed row is not re-executed.
    await engine.processScheduledExecutions();
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  it('skips at the choke point when countCompletedForEntity (excluding self) >= max', async () => {
    countSpy.mockResolvedValue({ data: 1, error: null }); // already hit max_executions_per_entity = 1
    claimSpy.mockResolvedValueOnce({ data: [makeExecution()], error: null });

    await engine.processScheduledExecutions();

    expect(countSpy).toHaveBeenCalledWith('rule-1', 'invoice', 'inv-1', 'exec-1'); // excludes self
    expect(failSpy).toHaveBeenCalledWith('exec-1', 'max executions reached');
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it('fails a claimed execution whose rule or event is missing', async () => {
    (PaymentAutomationRuleRepository.prototype.findByIdUnscoped as jest.Mock).mockResolvedValue({ data: null, error: null });
    claimSpy.mockResolvedValueOnce({ data: [makeExecution()], error: null });

    await engine.processScheduledExecutions();

    expect(failSpy).toHaveBeenCalledWith('exec-1', 'rule/event not found');
    expect(completeSpy).not.toHaveBeenCalled();
  });
});
