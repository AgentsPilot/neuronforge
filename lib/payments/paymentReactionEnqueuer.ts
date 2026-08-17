/**
 * Payment reaction enqueuer — the durable emit→enqueue seam (M2).
 *
 * Called from PaymentEventService.emit() after a payment event is persisted. It
 * replaces the retired in-process subscribe()/notifySubscribers() bus (§8.2 forbids
 * the bus — it silently drops events on cold start). Instead it evaluates the
 * user's active rules and INSERTS `pending` execution rows into the durable queue;
 * the automation cron drains them.
 *
 * REPO-ONLY by design: imports only repositories + pure rule helpers + the guarded
 * default-rule seed. It does NOT import PaymentEventService or PaymentAutomationEngine,
 * which breaks the circular-import risk the engine would introduce (M2 / SA Q2).
 *
 * Best-effort: the whole function is wrapped in try/catch and must never throw into
 * emit(). Per-rule failures log and continue.
 */

import { createLogger } from '@/lib/logger';
import {
  paymentAutomationRuleRepository,
  paymentAutomationExecutionRepository,
} from '@/lib/repositories/PaymentAutomationRepository';
import { evaluateConditions } from '@/lib/payments/ruleEvaluation';
import { ensureDefaultPaymentRules } from '@/lib/payments/defaultPaymentRules';
import type { PaymentEvent } from '@/lib/services/PaymentEventService';
import type { RuleEvaluationContext } from '@/lib/services/PaymentAutomationEngine';

const logger = createLogger({ service: 'paymentReactionEnqueuer' });

export async function enqueuePaymentReactions(event: PaymentEvent): Promise<void> {
  try {
    // (a) Lazy, guarded default-rule seed (Q3 — no capability-activation seam exists,
    //     so seed on the first payment event per user; idempotent if rules exist).
    await ensureDefaultPaymentRules(event.user_id, paymentAutomationRuleRepository);

    // (b) Active rules whose trigger matches this event type.
    const { data: rules, error } = await paymentAutomationRuleRepository.findActiveForEvent(
      event.user_id,
      event.event_type
    );
    if (error) {
      logger.warn({ err: error, eventId: event.id }, 'Failed to load rules for event (non-fatal)');
      return;
    }
    if (!rules || rules.length === 0) {
      return;
    }

    const context: RuleEvaluationContext = {
      event,
      entityType: event.entity_type,
      entityId: event.entity_id,
      contactId: event.contact_id,
      metadata: event.metadata as Record<string, unknown>,
    };

    // (c) Enqueue a pending execution for each matching rule. Per-rule non-fatal.
    for (const rule of rules) {
      try {
        if (rule.trigger_conditions && rule.trigger_conditions.length > 0) {
          if (!evaluateConditions(rule.trigger_conditions, context)) {
            continue;
          }
        }

        const scheduledAt = new Date(Date.now() + rule.delay_minutes * 60 * 1000).toISOString();

        const { error: enqueueError } = await paymentAutomationExecutionRepository.enqueue({
          user_id: rule.user_id,
          rule_id: rule.id,
          entity_type: event.entity_type,
          entity_id: event.entity_id,
          trigger_event_id: event.id,
          scheduled_at: scheduledAt,
          status: 'pending',
        });

        if (enqueueError) {
          logger.warn(
            { err: enqueueError, ruleId: rule.id, eventId: event.id },
            'Failed to enqueue execution for rule (non-fatal)'
          );
        }
      } catch (ruleErr) {
        logger.warn({ err: ruleErr, ruleId: rule.id, eventId: event.id }, 'Rule enqueue threw (non-fatal)');
      }
    }
  } catch (err) {
    // Never propagate into emit().
    logger.warn({ err, eventId: event.id }, 'enqueuePaymentReactions failed (non-fatal)');
  }
}
