/**
 * SA condition C-6 / Q-9 (plan payments P-3b, workplan §3.7): every Stripe
 * field the plan handler and router read must be present in the payloads the
 * production endpoint actually receives. That endpoint renders events in
 * `2025-09-30.clover`; the SDK pins `2025-10-29.clover`.
 *
 * How it works:
 *   - `FIELDS_READ` is §3.7 as data: per object, the paths read.
 *   - Every fixture in `fixtures/stripe/` is checked against it, HAND-BUILT and
 *     CAPTURED alike (a path must exist; its value may be null).
 *   - `CAPTURED_OBJECTS` records which objects have a CAPTURED fixture. It is a
 *     ratchet: equality, so the demo that captures them (workplan §9 step 9,
 *     T24/T26) must update it, and the captured payloads are then checked by
 *     the same loop.
 *
 * C-6 IS CLOSED ONLY WHEN `CAPTURED_OBJECTS` lists all five objects, each with
 * a `2025-09-30.clover` capture. Until then this file proves the hand-built
 * shapes and the checker; it does not prove the endpoint's version.
 */

import fs from 'fs';
import path from 'path';

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');

type ObjectKind = 'invoice' | 'invoice_line' | 'subscription' | 'checkout_session' | 'checkout_line_item';

/** §3.7: the fields read, per object. `[]` = every element of a non-empty array. */
const FIELDS_READ: Readonly<Record<ObjectKind, readonly string[]>> = {
  invoice: [
    'id',
    'customer',
    'currency',
    'amount_paid',
    'amount_due',
    'billing_reason',
    'discounts',
    'total_taxes',
    'status_transitions.paid_at',
    'livemode',
    'metadata',
    'lines.data',
    'lines.has_more',
    'parent.subscription_details.subscription',
    'parent.subscription_details.metadata',
  ],
  invoice_line: ['amount', 'period.start', 'period.end', 'pricing.price_details.price'],
  subscription: ['id', 'status', 'customer', 'billing_cycle_anchor', 'cancel_at_period_end', 'ended_at', 'livemode', 'metadata', 'items.data[].price.id', 'items.has_more'],
  checkout_session: ['id', 'mode', 'customer', 'subscription', 'metadata', 'amount_total', 'livemode'],
  // From `checkout.sessions.listLineItems`, not from the event (the demo saves that response too).
  checkout_line_item: ['price.id'],
};

/**
 * Objects with a CAPTURED fixture. Equality-checked.
 *
 * All five, from the P-3b.2 live demo (run 1, 2026-10-09, sandbox test mode):
 * the `invoice.paid`, `customer.subscription.created`,
 * `checkout.session.completed` and `customer.subscription.deleted` events as
 * `stripe listen` received them in `2025-09-30.clover`, plus the session's
 * `listLineItems` response, fetched read-only on 2026-10-11 at that version.
 * Their personal data is scrubbed; ids, prices, amounts and api_version are not.
 */
const CAPTURED_OBJECTS: readonly ObjectKind[] = [
  'checkout_line_item',
  'checkout_session',
  'invoice',
  'invoice_line',
  'subscription',
];

function has(value: unknown, segments: readonly string[]): boolean {
  if (segments.length === 0) return true;
  const [head, ...rest] = segments;
  if (head.endsWith('[]')) {
    const list = (value as Record<string, unknown> | null)?.[head.slice(0, -2)];
    return Array.isArray(list) && list.length > 0 && list.every((item) => has(item, rest));
  }
  if (value === null || typeof value !== 'object' || !(head in (value as Record<string, unknown>))) return false;
  const next = (value as Record<string, unknown>)[head];
  return rest.length === 0 || has(next, rest);
}

function missingFields(object: unknown, kind: ObjectKind): string[] {
  return FIELDS_READ[kind].filter((field) => !has(object, field.split('.')));
}

interface Fixture {
  name: string;
  source: string;
  apiVersion: string;
  objects: Array<{ kind: ObjectKind; value: unknown }>;
}

function load(name: string): Fixture {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Record<string, unknown>;
  const source = String(raw._fixture_source ?? '');
  const objects: Fixture['objects'] = [];
  if (raw.object === 'list') {
    // A saved `listLineItems` response.
    for (const item of (raw.data as unknown[]) ?? []) objects.push({ kind: 'checkout_line_item', value: item });
  } else {
    const object = (raw.data as { object: Record<string, unknown> }).object;
    if (object.object === 'invoice') {
      objects.push({ kind: 'invoice', value: object });
      for (const line of ((object.lines as { data: unknown[] }).data ?? [])) objects.push({ kind: 'invoice_line', value: line });
    } else if (object.object === 'subscription') {
      objects.push({ kind: 'subscription', value: object });
    } else if (object.object === 'checkout.session') {
      objects.push({ kind: 'checkout_session', value: object });
    }
  }
  return { name, source, apiVersion: String(raw.api_version ?? ''), objects };
}

const fixtures = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).map(load);

describe('C-6: the §3.7 field list against every fixture', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s carries every field the handler reads', (_name, fixture) => {
    expect(fixture.objects.length).toBeGreaterThan(0);
    for (const { kind, value } of fixture.objects) {
      expect({ kind, missing: missingFields(value, kind) }).toEqual({ kind, missing: [] });
    }
  });

  it('the checker bites: a removed field is reported, a null value is not', () => {
    const invoice = fixtures.find((f) => f.name === 'invoice-paid-subscription-create.json')!.objects[0].value as Record<string, unknown>;
    const copy = JSON.parse(JSON.stringify(invoice)) as Record<string, unknown>;
    delete copy.total_taxes;
    (copy.status_transitions as Record<string, unknown>).paid_at = null;
    expect(missingFields(copy, 'invoice')).toEqual(['total_taxes']);
    const sub = { items: { data: [], has_more: false } };
    expect(missingFields(sub, 'subscription')).toContain('items.data[].price.id');
  });
});

describe('C-6: captured payloads (ratchet)', () => {
  const captured = fixtures.filter((f) => f.source.startsWith('CAPTURED'));

  it('CAPTURED_OBJECTS is exactly the set of objects with a captured fixture', () => {
    const kinds = [...new Set(captured.flatMap((f) => f.objects.map((o) => o.kind)))].sort();
    expect(kinds).toEqual([...CAPTURED_OBJECTS].sort());
  });

  it('every captured fixture states its real api_version, which is a clover version', () => {
    for (const fixture of captured) {
      expect(['2025-09-30.clover', '2025-10-29.clover']).toContain(fixture.apiVersion);
      expect(fixture.source).toContain(fixture.apiVersion);
    }
  });
});
