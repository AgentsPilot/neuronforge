import 'server-only';

/**
 * How a capability VALUE is written for a human.
 *
 * ── Why it is one function and not two ──────────────────────────────────────
 * The plan cards and the account lookup show the same values, and they showed
 * them differently: the cards said `1 seat` while the lookup printed
 * `{"included":1,"purchasable":false}` straight out of `JSON.stringify` (QA-8).
 * One of those is a value an admin can read and the other is the shape of our
 * storage.
 *
 * A screen with two formatters is a screen that will eventually disagree with
 * itself about what an account has — which is the same failure as two granting
 * rules, one layer down. So there is one, it lives server-side with the rest of
 * the deciding, and both payloads carry its output rather than the raw value.
 *
 * The raw value is still sent alongside: this is presentation, and a caller
 * that wants to compare numbers should compare numbers.
 */

import type { CapabilityDef, CapabilityValue } from './types';

/** `{ perMonth: 500 }` → `500 per month`. Presentation only, never a decision. */
export function describeCapabilityValue(value: CapabilityValue, definition: CapabilityDef): string {
  const shape = definition.shape;

  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value;

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.perMonth === 'number') return `${record.perMonth.toLocaleString('en-US')} per month`;
    if (typeof record.total === 'number') return `${record.total.toLocaleString('en-US')} in total`;
    if (typeof record.ceilingPerMonth === 'number') {
      return `${record.ceilingPerMonth.toLocaleString('en-US')} per month (alerts, never blocks)`;
    }
    if (typeof record.included === 'number') {
      const unit = shape.kind === 'quantity' ? shape.unit : 'included';
      const purchasable = record.purchasable === true ? ', more purchasable' : '';
      return `${record.included} ${unit}${record.included === 1 ? '' : 's'}${purchasable}`;
    }
  }

  // Not reachable for any shape the catalog declares. Kept as a last resort so
  // a new shape shows SOMETHING rather than an empty cell — and it is ugly on
  // purpose, because it should be noticed and given a case above.
  return JSON.stringify(value);
}
