/**
 * The owner's view of a boost purchase (credits boost slice 5b.1; SA C-3).
 */

import { boostPurchaseOwnerStatus, toBoostPurchaseView } from '@/lib/business-os/boost/boostPurchasesView';
import { BOOST_PURCHASE_STATUSES } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { BOOST_PURCHASE_OWNER_STATUSES } from '@/lib/business-os/boost/boostPurchasesTypes';
import { purchaseRow } from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';

const NAMES = new Map([['plus', { en: 'Plus', he: 'Plus', es: 'Plus' }]]);

/** SA C-3: exactly these keys. */
const VIEW_KEYS = [
  'createdAt',
  'creditsBonus',
  'creditsTotal',
  'currency',
  'id',
  'kind',
  'name',
  'packageId',
  'paidAt',
  'priceMinor',
  'receiptUrl',
  'status',
  'taxExclusive',
];

describe('toBoostPurchaseView', () => {
  it('has exactly the owner keys: no Stripe id, session id, flag reason, mode or lot id', () => {
    const row = purchaseRow({
      status: 'paid',
      stripePaymentIntentId: 'pi_test_1',
      stripeChargeId: 'ch_test_1',
      lotId: '77777777-7777-4777-8777-777777777777',
      flagReason: 'amount_mismatch',
      receiptUrl: 'https://pay.stripe.com/receipts/x',
      paidAt: '2026-10-08T10:00:00.000Z',
    });
    const view = toBoostPurchaseView(row, NAMES);
    expect(Object.keys(view).sort()).toEqual(VIEW_KEYS);
    const text = JSON.stringify(view);
    for (const secret of ['pi_test_1', 'ch_test_1', 'cs_test_boost_1', 'amount_mismatch', '77777777', 'livemode']) {
      expect(text).not.toContain(secret);
    }
    expect(view).toMatchObject({ status: 'credited', kind: 'bought', taxExclusive: true, creditsTotal: 13750, priceMinor: 2500 });
    expect(view.name).toEqual({ en: 'Plus', he: 'Plus', es: 'Plus' });
  });

  it('a retired package has no name (the UI shows its id)', () => {
    expect(toBoostPurchaseView(purchaseRow({ packageId: 'old' }), NAMES).name).toBeNull();
  });

  it('only an https receipt link is passed on', () => {
    expect(toBoostPurchaseView(purchaseRow({ receiptUrl: 'http://x' }), NAMES).receiptUrl).toBeNull();
    expect(toBoostPurchaseView(purchaseRow({ receiptUrl: null }), NAMES).receiptUrl).toBeNull();
  });

  it.each([
    ['pending', 'processing'],
    ['awaiting_payment', 'awaiting_payment'],
    ['paid', 'credited'],
    ['failed', 'failed'],
    ['expired', 'expired'],
    ['abandoned', 'expired'],
    ['flagged_mismatch', 'under_review'],
    ['disputed', 'under_review'],
    ['dispute_lost', 'reversed'],
    ['refunded', 'refunded'],
    ['partially_refunded', 'partially_refunded'],
  ] as const)('row status %s → owner status %s', (row, owner) => {
    expect(boostPurchaseOwnerStatus(row)).toBe(owner);
  });

  it('every row status maps to an owner status (no gap when a status is added)', () => {
    for (const status of BOOST_PURCHASE_STATUSES) expect(BOOST_PURCHASE_OWNER_STATUSES).toContain(boostPurchaseOwnerStatus(status));
  });
});
