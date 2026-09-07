/**
 * Default payment automation rules.
 *
 * The 3 coded default rules seeded for a user the first time a payment event is
 * emitted (DEFAULTS ONLY — user decision 2026-08-14; no CRUD API/UI this cycle).
 *
 * `ensureDefaultPaymentRules` is the idempotent guarded seed: if the user already
 * has ≥1 rule it returns immediately, so it is safe to call on every emit. It
 * imports ONLY the rule repository + getBlock + types (no engine, no
 * PaymentEventService) to avoid an import cycle with the emit path (M2).
 */

import { createLogger } from '@/lib/logger';
import { getBlock } from '@/lib/payments/PaymentBuildingBlocks';
import type { PaymentAutomationRuleRepository } from '@/lib/repositories/PaymentAutomationRepository';
import type {
  AutomationRule,
  TriggerConditionOperator,
} from '@/lib/services/PaymentAutomationEngine';
import type { PaymentEventType } from '@/lib/services/PaymentEventService';

const logger = createLogger({ service: 'defaultPaymentRules' });

/** A default rule literal — the persisted columns minus the DB-managed ones. */
export type DefaultPaymentRule = Omit<
  AutomationRule,
  'id' | 'user_id' | 'created_at' | 'updated_at'
>;

export const DEFAULT_PAYMENT_RULES: DefaultPaymentRule[] = [
  {
    name: 'Send reminder 3 days before due',
    description: 'Automatically send a payment reminder 3 days before an installment is due',
    trigger_event: 'installment.due_approaching' as PaymentEventType,
    trigger_conditions: [
      { field: 'metadata.days_until_due', operator: 'eq' as TriggerConditionOperator, value: 3 },
    ],
    action_block: 'send_payment_reminder',
    action_parameters: {
      installment_id: '$entity_id',
      contact_id: '$contact_id',
      channel: 'email',
    },
    delay_minutes: 0,
    max_executions_per_entity: 1,
    cooldown_hours: 24,
    is_active: true,
  },
  {
    name: 'Auto-retry failed payment after 4 hours',
    description: 'Schedule a retry when a payment fails',
    trigger_event: 'payment.failed' as PaymentEventType,
    trigger_conditions: null,
    action_block: 'schedule_retry',
    action_parameters: {
      invoice_id: '$entity_id',
      delay_hours: 4,
    },
    delay_minutes: 0,
    max_executions_per_entity: 3,
    cooldown_hours: 4,
    is_active: true,
  },
  {
    name: 'Send overdue notice after 1 day',
    description: 'Send a reminder when an installment becomes overdue',
    trigger_event: 'installment.overdue' as PaymentEventType,
    trigger_conditions: [
      { field: 'metadata.overdue_days', operator: 'eq' as TriggerConditionOperator, value: 1 },
    ],
    action_block: 'send_payment_reminder',
    action_parameters: {
      installment_id: '$entity_id',
      contact_id: '$contact_id',
      channel: 'email',
      template: 'overdue_notice',
    },
    delay_minutes: 0,
    max_executions_per_entity: 1,
    cooldown_hours: 48,
    is_active: true,
  },
];

/**
 * Idempotently seed the default rules for a user.
 *
 * Two-layer idempotency:
 *  1. Fast path — if the user already has ≥1 rule, return without writing (the
 *     common case on every emit after the first).
 *  2. Race safety — the first-seed insert goes through
 *     `insertDefaultsIgnoringDuplicates`, an `ON CONFLICT DO NOTHING` upsert backed
 *     by the `(user_id, name)` unique index. Two concurrent first-emit seeders can
 *     both pass the empty-check, but only one set of rows actually lands (the loser's
 *     rows are ignored) — so the user never ends up with duplicate defaults.
 *
 * Invalid action blocks are filtered (not fatal). Best-effort — logs and returns on
 * any error; never throws into the emit path.
 */
export async function ensureDefaultPaymentRules(
  userId: string,
  ruleRepo: PaymentAutomationRuleRepository
): Promise<void> {
  try {
    const { data: existing, error } = await ruleRepo.list(userId, { limit: 1 });
    if (error) {
      logger.warn({ err: error, userId }, 'Failed to check existing rules; skipping default seed');
      return;
    }
    if (existing && existing.length > 0) {
      // User already has rules — idempotent no-op (fast path).
      return;
    }

    // Filter defaults whose action block is unknown (defensive; all 3 are valid today).
    const validRules = DEFAULT_PAYMENT_RULES.filter((rule) => {
      if (!getBlock(rule.action_block)) {
        logger.warn({ userId, actionBlock: rule.action_block }, 'Skipping default rule with unknown block');
        return false;
      }
      return true;
    });

    // Race-safe insert: ON CONFLICT DO NOTHING on (user_id, name).
    const { data: created, error: seedError } = await ruleRepo.insertDefaultsIgnoringDuplicates(
      userId,
      validRules
    );
    if (seedError) {
      logger.warn({ err: seedError, userId }, 'Failed to seed default payment automation rules');
      return;
    }

    logger.info({ userId, created: created ?? 0 }, 'Seeded default payment automation rules');
  } catch (err) {
    logger.warn({ err, userId }, 'ensureDefaultPaymentRules failed (non-fatal)');
  }
}
