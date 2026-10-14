/**
 * The Stripe refund → ledger rules, as pure functions (STRIPE_CONNECT_REFUND_WEBHOOK
 * slice 2): the status mapping (FR 5, F2-a), the transition table (FR 6, F2-d,
 * exhaustive) and the untrusted-metadata checks (A-1, F1-e).
 *
 * No mocks: the module is a leaf with no I/O (SA Q-SA-2). The source-shape case
 * at the end keeps it that way.
 */

import fs from 'fs';
import path from 'path';

import {
  REFUND_ROW_ID_METADATA_KEY,
  mapStripeRefundStatus,
  nextLedgerRefundStatus,
  untrustedAppRowCheck,
  vetLedgerRowIdCandidate,
  type LedgerRefundStatus,
  type LedgerRowForMatch,
} from '../stripeRefundLedger';

describe('mapStripeRefundStatus (FR 5, F2-a)', () => {
  it.each([
    ['succeeded', 'succeeded'],
    ['failed', 'failed'],
    ['canceled', 'canceled'],
    ['pending', 'pending'],
    ['requires_action', 'pending'],
  ] as const)('%s → %s', (stripe, ledger) => {
    expect(mapStripeRefundStatus(stripe)).toBe(ledger);
  });

  it.each([[null], [undefined], [''], ['refunded'], ['SUCCEEDED']])(
    '%p is not a status we record → null (Q-SA-3: nothing is written on a guess)',
    (value) => {
      expect(mapStripeRefundStatus(value)).toBeNull();
    }
  );
});

describe('nextLedgerRefundStatus (FR 6, F2-d): every current × has-Stripe-id × incoming', () => {
  const STATUSES: LedgerRefundStatus[] = ['pending', 'succeeded', 'failed', 'canceled'];

  // The FR 6 table written out case by case: [current, hasStripeId, incoming] → expected.
  // `apply` carries the status it moves to and whether the move is flagged.
  type Expected = 'noop' | { status: LedgerRefundStatus; warn: boolean };
  const A = (status: LedgerRefundStatus, warn = false): Expected => ({ status, warn });
  const EXPECTED: Record<string, Expected> = {
    // incoming pending / requires_action: pending → pending changes nothing; a lost-reply
    // failed/canceled row (no Stripe id) moves to pending (SA CR-1, amending A-3)
    'pending|false|pending': 'noop',
    'pending|true|pending': 'noop',
    'succeeded|false|pending': 'noop',
    'succeeded|true|pending': 'noop',
    'failed|false|pending': A('pending'),
    'failed|true|pending': 'noop',
    'canceled|false|pending': A('pending'),
    'canceled|true|pending': 'noop',
    // incoming succeeded: from pending; from failed/canceled ONLY with no Stripe id (SA-5)
    'pending|false|succeeded': A('succeeded'),
    'pending|true|succeeded': A('succeeded'),
    'succeeded|false|succeeded': 'noop',
    'succeeded|true|succeeded': 'noop',
    'failed|false|succeeded': A('succeeded'),
    'failed|true|succeeded': 'noop',
    'canceled|false|succeeded': A('succeeded'),
    'canceled|true|succeeded': 'noop',
    // incoming failed: from pending or succeeded; failed ↔ canceled is a no-op
    'pending|false|failed': A('failed'),
    'pending|true|failed': A('failed'),
    'succeeded|false|failed': A('failed'),
    'succeeded|true|failed': A('failed'),
    'failed|false|failed': 'noop',
    'failed|true|failed': 'noop',
    'canceled|false|failed': 'noop',
    'canceled|true|failed': 'noop',
    // incoming canceled: from pending or succeeded (succeeded → canceled is flagged)
    'pending|false|canceled': A('canceled'),
    'pending|true|canceled': A('canceled'),
    'succeeded|false|canceled': A('canceled', true),
    'succeeded|true|canceled': A('canceled', true),
    'failed|false|canceled': 'noop',
    'failed|true|canceled': 'noop',
    'canceled|false|canceled': 'noop',
    'canceled|true|canceled': 'noop',
  };

  // Stripe's five statuses, mapped first, so `requires_action` is covered as itself.
  const INCOMING = ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const;
  const cases = STATUSES.flatMap((current) =>
    [false, true].flatMap((hasStripeId) => INCOMING.map((stripe) => [current, hasStripeId, stripe] as const))
  );

  it('covers 4 × 2 × 5 = 40 combinations', () => {
    expect(cases).toHaveLength(40);
    expect(Object.keys(EXPECTED)).toHaveLength(32);
  });

  it.each(cases)('current %s, has Stripe id %p, Stripe says %s', (current, hasStripeId, stripe) => {
    const incoming = mapStripeRefundStatus(stripe)!;
    const expected = EXPECTED[`${current}|${hasStripeId}|${incoming}`];
    const actual = nextLedgerRefundStatus(current, hasStripeId, incoming);
    if (expected === 'noop') {
      expect(actual).toEqual({ kind: 'noop' });
    } else {
      expect(actual).toEqual({ kind: 'apply', ...expected });
    }
  });

  it('only succeeded → canceled is flagged', () => {
    const flagged = cases.filter(([current, has, stripe]) => {
      const t = nextLedgerRefundStatus(current, has, mapStripeRefundStatus(stripe)!);
      return t.kind === 'apply' && t.warn;
    });
    expect(flagged.map(([c, , s]) => `${c}→${s}`)).toEqual(['succeeded→canceled', 'succeeded→canceled']);
  });
});

describe('vetLedgerRowIdCandidate (A-1, shape only)', () => {
  const ROW_ID = '3f2b9c1e-7a4d-4e5f-9b8a-1c2d3e4f5a6b';

  it('reads the shared key', () => {
    expect(REFUND_ROW_ID_METADATA_KEY).toBe('refund_row_id');
    expect(vetLedgerRowIdCandidate({ refund_row_id: ROW_ID })).toEqual({ id: ROW_ID });
  });

  it.each([[null], [undefined], [{}], [{ refund_row_id: '' }], [{ other_key: ROW_ID }]])(
    'no candidate in %p',
    (metadata) => {
      expect(vetLedgerRowIdCandidate(metadata)).toEqual({ id: null });
    }
  );

  it.each([['not-a-uuid'], [`{${ROW_ID}}`], [ROW_ID.replace(/-/g, '')], [` ${ROW_ID}`]])(
    'a non-UUID value %p is dropped and only its length is returned',
    (value) => {
      const result = vetLedgerRowIdCandidate({ refund_row_id: value });
      expect(result).toEqual({ id: null, malformedLength: value.length });
      expect(JSON.stringify(result)).not.toContain(value);
    }
  );
});

describe('untrustedAppRowCheck (A-1, F1-e)', () => {
  const row = (over: Partial<LedgerRowForMatch> = {}): LedgerRowForMatch => ({
    source: 'app',
    processor_type: 'stripe',
    amount_minor: 2500,
    currency: 'USD',
    processor_refund_id: null,
    ...over,
  });
  const refund = { id: 're_1', amount: 2500, currency: 'usd' };

  it('the app’s own pending Stripe row for exactly this money passes (currency compared case-insensitively)', () => {
    expect(untrustedAppRowCheck(row(), refund)).toBeNull();
  });

  it('a row already carrying this same Stripe id passes', () => {
    expect(untrustedAppRowCheck(row({ processor_refund_id: 're_1' }), refund)).toBeNull();
  });

  it.each([
    ['source', row({ source: 'manual' })],
    ['source', row({ source: 'webhook' })],
    ['processor_type', row({ processor_type: 'manual' })],
    ['amount_minor', row({ amount_minor: 2400 })],
    ['currency', row({ currency: 'EUR' })],
    ['processor_refund_id', row({ processor_refund_id: 're_other' })],
  ] as const)('fails the %s check', (check, candidate) => {
    expect(untrustedAppRowCheck(candidate, refund)).toBe(check);
  });

  it('a refund with no currency cannot be matched to a row', () => {
    expect(untrustedAppRowCheck(row(), { ...refund, currency: null })).toBe('currency');
  });
});

describe('source shape (SA Q-SA-2: a leaf)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/payments/stripeRefundLedger.ts'), 'utf8');

  it('imports only from ./ownedLinkId, itself a leaf', () => {
    const imports = [...source.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./ownedLinkId']);
    const ownedLinkId = fs.readFileSync(path.join(process.cwd(), 'lib/payments/ownedLinkId.ts'), 'utf8');
    expect(ownedLinkId).not.toMatch(/^import /m);
  });
});
