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

import { PLAN_HANDLER_VERIFIED_EVENT_SHAPES } from '@/lib/business-os/billing/planBillingHandler';

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');

type ObjectKind =
  | 'invoice'
  | 'invoice_line'
  | 'subscription'
  | 'checkout_session'
  | 'checkout_line_item'
  // P-7b.1b (U-7 / G-3): the objects the upgrade path reads from Stripe's
  // answers to OUR calls (SDK responses at the pinned `2025-10-29.clover`).
  | 'invoice_preview'
  | 'upgrade_response'
  | 'pending_update'
  | 'invoice_payment'
  | 'stripe_error';

/** §3.7: the fields read, per object. `[]` = every element of a non-empty array. */
const FIELDS_READ: Readonly<Record<ObjectKind, readonly string[]>> = {
  invoice: [
    'id',
    'customer',
    'currency',
    'amount_paid',
    'amount_due',
    // P-7b.1a (U-3, CF-6): a paid upgrade with amount_paid 0 is judged by its total.
    'total',
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
  subscription: [
    'id',
    'status',
    'customer',
    'billing_cycle_anchor',
    'cancel_at_period_end',
    // Follow-ups C-3: read since P-7a.1 (the mirror's derived flag, Step B, the engine).
    'cancel_at',
    'ended_at',
    'livemode',
    'metadata',
    'items.data[].price.id',
    'items.has_more',
    // P-7b.1a (§3.3 a; U-4, V-2, V-8): the item id and period, the pending update and its invoice.
    'items.data[].id',
    'items.data[].current_period_start',
    'items.data[].current_period_end',
    'pending_update',
    'latest_invoice',
  ],
  checkout_session: ['id', 'mode', 'customer', 'subscription', 'metadata', 'amount_total', 'livemode'],
  // From `checkout.sessions.listLineItems`, not from the event (the demo saves that response too).
  checkout_line_item: ['price.id'],
  // P-7b.1b (U-7): `previewBusinessOsPlanUpgrade` reads the preview's amounts only.
  invoice_preview: ['amount_due', 'total', 'total_taxes', 'currency'],
  // `upgradeBusinessOsPlanSubscription`: the update's answer, `latest_invoice.confirmation_secret` expanded (E-1a).
  upgrade_response: ['id', 'livemode', 'pending_update', 'latest_invoice.id', 'latest_invoice.status', 'latest_invoice.confirmation_secret'],
  // `pendingUpdateFacts`: any subscription carrying one (E-1b, E-2, E-4).
  pending_update: ['expires_at', 'subscription_items[].price.id'],
  // `upgradePaymentStateOf`: one `invoicePayments.list` read with the PaymentIntent expanded (E-1b; the
  // expanded `latest_invoice.payments...` path hits `property_expansion_max_depth`, so the list is the path).
  invoice_payment: ['is_default', 'payment.payment_intent.status'],
  // `confirmPlanUpgrade`'s catch matches the in-flight conflict by its code, whatever its class (SA F-2, E-6).
  stripe_error: ['err.type', 'err.code', 'err.statusCode', 'raw.code', 'raw.type'],
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
  // P-7b.1b (U-7 / G-3), from the P-7b.1 sandbox experiments E-1 to E-6 of
  // 2026-10-13 (standard sandbox, test mode): the SDK's answers to our calls at
  // the pinned `2025-10-29.clover`, and the webhook events as the sandbox
  // renders them (`2026-09-30.endive`, requirement §9.1.2 F-4). Files
  // `captured-p7b1-*.json`, scrubbed as the P-3b captures were.
  'invoice_payment',
  'invoice_preview',
  'pending_update',
  'stripe_error',
  'upgrade_response',
  // P-8b.2 (SA ruling V-3): `checkout_session` gains an ENDIVE capture
  // (`captured-p8b2-event-checkout-session-completed-*.json`, the sandbox's
  // events as stored at `2026-09-30.endive`). Already listed above, so the set
  // is unchanged; the verified-shapes ratchet below reads the capture itself.
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
  /** The event type, for a fixture that is a webhook event; '' otherwise. */
  eventType: string;
  apiVersion: string;
  objects: Array<{ kind: ObjectKind; value: unknown }>;
}

function load(name: string): Fixture {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Record<string, unknown>;
  const source = String(raw._fixture_source ?? '');
  const objects: Fixture['objects'] = [];
  const addStripeObject = (object: Record<string, unknown>) => {
    if (object.object === 'invoice') {
      objects.push({ kind: 'invoice', value: object });
      for (const line of ((object.lines as { data: unknown[] }).data ?? [])) objects.push({ kind: 'invoice_line', value: line });
    } else if (object.object === 'subscription') {
      objects.push({ kind: 'subscription', value: object });
      if (object.pending_update) objects.push({ kind: 'pending_update', value: object.pending_update });
    } else if (object.object === 'checkout.session') {
      objects.push({ kind: 'checkout_session', value: object });
    }
  };
  if (raw.object === 'list') {
    // A saved list response: `listLineItems` (P-3b) or `invoicePayments.list` (P-7b.1).
    for (const item of (raw.data as Array<Record<string, unknown>>) ?? []) {
      objects.push({ kind: item.object === 'invoice_payment' ? 'invoice_payment' : 'checkout_line_item', value: item });
    }
  } else if (raw.err !== undefined) {
    // P-7b.1 E-6: a captured Stripe error (the SDK error's fields and Stripe's raw body).
    objects.push({ kind: 'stripe_error', value: raw });
  } else if (raw.object === 'invoice' && /-preview\.json$/.test(name)) {
    // P-7b.1: an `invoices.createPreview` answer; only its amounts are read.
    objects.push({ kind: 'invoice_preview', value: raw });
  } else if (raw.object === 'invoice' || raw.object === 'subscription') {
    // P-7b.1: an SDK answer to our own call, not an event.
    addStripeObject(raw);
    if (/-(update-response|replay)\.json$/.test(name)) objects.push({ kind: 'upgrade_response', value: raw });
  } else {
    addStripeObject((raw.data as { object: Record<string, unknown> }).object);
  }
  const eventType = typeof raw.type === 'string' && raw.data !== undefined ? raw.type : '';
  return { name, source, eventType, apiVersion: String(raw.api_version ?? raw._fixture_api_version ?? ''), objects };
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

  it('every captured fixture states its real api_version: clover, or the endive events of the sandbox (P-7b.1)', () => {
    for (const fixture of captured) {
      // P-3b events at the production endpoint's `2025-09-30.clover`; P-7b.1 SDK answers at the
      // pinned `2025-10-29.clover`; P-7b.1 events as the standard sandbox renders them (§9.1.2 F-4).
      expect(['2025-09-30.clover', '2025-10-29.clover', '2026-09-30.endive']).toContain(fixture.apiVersion);
      expect(fixture.source).toContain(fixture.apiVersion);
    }
  });
});

/**
 * P-8b.2 (SA API-version ruling, option (b), V-4): the RATCHET on the plan
 * handler's verified (api_version, event type) pairs. Every pair in
 * `PLAN_HANDLER_VERIFIED_EVENT_SHAPES` needs at least one event fixture of that
 * type that passes the C-6 field check above:
 *   - an `endive` (or any non-clover) pair needs a fixture CAPTURED at exactly
 *     that version; no substitution;
 *   - the two `clover` versions are one Stripe major (monthly releases within a
 *     major are additive), so a fixture at either clover version counts for
 *     both, captured or hand-built;
 *   - at clover only, `invoice.payment_action_required` may be met by an
 *     `invoice.payment_failed` fixture: both events carry the same Stripe
 *     object (an invoice), which is what the handler reads.
 * So the allow-list cannot grow without evidence.
 */
describe('P-8b.2 V-4: every verified (api_version, type) pair has a passing fixture (ratchet)', () => {
  const CLOVER_MAJOR = ['2025-09-30.clover', '2025-10-29.clover'];
  /** Clover only: the same Stripe object, so the failed-invoice fixture verifies the action-required event. */
  const CLOVER_SUBSTITUTES: Readonly<Record<string, string>> = { 'invoice.payment_action_required': 'invoice.payment_failed' };

  const passes = (fixture: Fixture) =>
    fixture.objects.length > 0 && fixture.objects.every(({ kind, value }) => missingFields(value, kind).length === 0);

  function evidenceFor(version: string, eventType: string): string[] {
    const clover = CLOVER_MAJOR.includes(version);
    const types = clover && CLOVER_SUBSTITUTES[eventType] ? [eventType, CLOVER_SUBSTITUTES[eventType]] : [eventType];
    return fixtures
      .filter((f) => types.includes(f.eventType) && passes(f))
      .filter((f) => (clover ? CLOVER_MAJOR.includes(f.apiVersion) : f.apiVersion === version && f.source.startsWith('CAPTURED')))
      .map((f) => f.name);
  }

  const pairs = Object.entries(PLAN_HANDLER_VERIFIED_EVENT_SHAPES).flatMap(([version, types]) => types.map((t) => [version, t] as const));

  it('lists the three verified versions', () => {
    expect(Object.keys(PLAN_HANDLER_VERIFIED_EVENT_SHAPES).sort()).toEqual(['2025-09-30.clover', '2025-10-29.clover', '2026-09-30.endive']);
  });

  it.each(pairs)('%s %s has a fixture', (version, eventType) => {
    expect({ version, eventType, evidence: evidenceFor(version, eventType).length > 0 }).toEqual({ version, eventType, evidence: true });
  });

  it('the ratchet bites: endive checkout.session.expired has no endive capture, and a clover fixture never counts for endive', () => {
    expect(evidenceFor('2026-09-30.endive', 'checkout.session.expired')).toEqual([]);
    expect(PLAN_HANDLER_VERIFIED_EVENT_SHAPES['2026-09-30.endive']).not.toContain('checkout.session.expired');
    expect(evidenceFor('2027-03-31.future', 'invoice.paid')).toEqual([]);
  });
});
