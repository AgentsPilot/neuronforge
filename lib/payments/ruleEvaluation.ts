/**
 * Payment rule evaluation — pure helpers.
 *
 * Extracted from PaymentAutomationEngine so both the engine (drain) and the
 * emit-time enqueuer (paymentReactionEnqueuer) share ONE implementation of the
 * condition/parameter semantics. This module is intentionally dependency-free:
 * it imports ONLY types (erased at compile time — no runtime import cycle with
 * the engine or PaymentEventService).
 *
 * Operator semantics are copied verbatim from the original engine so behaviour
 * is preserved exactly.
 */

import type { PaymentEvent } from '@/lib/services/PaymentEventService';
import type {
  TriggerCondition,
  RuleEvaluationContext,
} from '@/lib/services/PaymentAutomationEngine';

/**
 * Evaluate all trigger conditions against the event context.
 * Returns true only when every condition matches (AND semantics).
 */
export function evaluateConditions(
  conditions: TriggerCondition[],
  context: RuleEvaluationContext
): boolean {
  for (const condition of conditions) {
    const value = getValueFromContext(condition.field, context);
    if (!evaluateCondition(condition, value)) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve a dotted field path against the evaluation context.
 */
export function getValueFromContext(field: string, context: RuleEvaluationContext): unknown {
  const parts = field.split('.');
  let value: unknown = context;

  for (const part of parts) {
    if (value && typeof value === 'object') {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Evaluate a single condition against an actual value.
 */
export function evaluateCondition(condition: TriggerCondition, actualValue: unknown): boolean {
  const { operator, value: expectedValue } = condition;

  switch (operator) {
    case 'eq':
      return actualValue === expectedValue;
    case 'neq':
      return actualValue !== expectedValue;
    case 'gt':
      return (actualValue as number) > (expectedValue as number);
    case 'gte':
      return (actualValue as number) >= (expectedValue as number);
    case 'lt':
      return (actualValue as number) < (expectedValue as number);
    case 'lte':
      return (actualValue as number) <= (expectedValue as number);
    case 'in':
      return Array.isArray(expectedValue) && expectedValue.includes(actualValue);
    case 'contains':
      return typeof actualValue === 'string' && actualValue.includes(expectedValue as string);
    default:
      return false;
  }
}

/**
 * Build action parameters, substituting event values into the rule's template.
 * Supports `{{ path }}` template syntax and `$entity_id` / `$contact_id` / `$user_id`.
 */
export function buildActionParameters(
  templateParams: Record<string, unknown>,
  event: PaymentEvent
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(templateParams)) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      // Template substitution
      const path = value.slice(2, -2).trim();
      params[key] = getEventValue(path, event);
    } else if (value === '$entity_id') {
      params[key] = event.entity_id;
    } else if (value === '$contact_id') {
      params[key] = event.contact_id;
    } else if (value === '$user_id') {
      params[key] = event.user_id;
    } else {
      params[key] = value;
    }
  }

  return params;
}

/**
 * Resolve a template path against the event (used by buildActionParameters).
 */
export function getEventValue(path: string, event: PaymentEvent): unknown {
  if (path.startsWith('metadata.')) {
    const metaKey = path.replace('metadata.', '');
    return (event.metadata as Record<string, unknown>)?.[metaKey];
  }

  switch (path) {
    case 'entity_id': return event.entity_id;
    case 'entity_type': return event.entity_type;
    case 'contact_id': return event.contact_id;
    case 'user_id': return event.user_id;
    case 'processor_type': return event.processor_type;
    default: return undefined;
  }
}
