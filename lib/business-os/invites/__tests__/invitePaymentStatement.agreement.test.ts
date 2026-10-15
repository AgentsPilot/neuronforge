/**
 * FR-22 (plan payments P-9.2; workplan §3.5, §7 "Public view"; SA C-6, A-1).
 *
 * The invite page says "Payment is required at signup" (`payment: 'required'`)
 * EXACTLY when the account the invite creates would be offered Pay on the
 * holding screen and admitted by the held checkout, for every combination of
 * the three switches and every paid invite shape:
 *   - an admin Paid invite for each tier, and one whose tier lost its price;
 *   - a champion's friend invite, and one whose friend tier has no price.
 * Every case also asserts the EXPECTED answer (SA O-1), so the file stands
 * alone: `required` only with all three switches on and a priced tier.
 * A champion (cohort) invite says nothing about payment (`none`).
 *
 * The real `viewInviteByToken`, `heldPaymentOffer` and `readHeldPaymentView`
 * run over minimal fakes; the switches are injected into both sides.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('never called here');
  },
}));

import * as billing from '@/lib/business-os/billing/planCheckoutEligibility';
import { heldPaymentOffer, sellableTiers, type HeldPaymentHold, type HeldPaymentSwitches } from '@/lib/business-os/billing/planCheckoutEligibility';
import { readHeldPaymentView } from '@/lib/business-os/billing/heldPaymentView';
import { CHAMPION_INVITE_TYPE, INVITE_ISSUANCE_POLICY, INVITE_TYPES, PAID_INVITE_TYPE } from '@/lib/business-os/entitlements/config/invites';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsInvitePublicView } from '@/lib/repositories/types';

import { generateInviteToken, hashInviteToken } from '../inviteToken';
import { viewInviteByToken } from '../publicInviteView';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const TOKEN = generateInviteToken();
const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const config = getEntitlementConfig();
const policy = INVITE_ISSUANCE_POLICY as unknown as { paidInvitesAvailable: boolean; accountInvitesAvailable: boolean; account: { grantId: string } };
const shipped = { paid: policy.paidInvitesAvailable, account: policy.accountInvitesAvailable, grantId: policy.account.grantId };

interface Shape {
  label: string;
  kind: 'admin' | 'friend';
  /** The tier the invite row names. */
  grantId: string;
  /** Remove this tier's Stripe price for the case (the invited tier lost its price). */
  unpriced?: boolean;
}

const SHAPES: Shape[] = [
  ...TIER_ORDER.map((tier): Shape => ({ label: `admin Paid, ${tier}`, kind: 'admin', grantId: tier })),
  { label: 'admin Paid, a tier that lost its price', kind: 'admin', grantId: TIER_ORDER[TIER_ORDER.length - 1], unpriced: true },
  { label: 'friend', kind: 'friend', grantId: INVITE_ISSUANCE_POLICY.account.grantId },
  { label: 'friend, the friend tier lost its price', kind: 'friend', grantId: INVITE_ISSUANCE_POLICY.account.grantId, unpriced: true },
];

const BOOLS = [false, true] as const;
const COMBINATIONS: HeldPaymentSwitches[] = BOOLS.flatMap((checkoutEnabled) =>
  BOOLS.flatMap((pricesEnabled) => BOOLS.map((paidInvitesAvailable) => ({ checkoutEnabled, pricesEnabled, paidInvitesAvailable })))
);

function row(shape: Shape): BusinessOsInvitePublicView {
  return {
    id: INVITE_ID,
    issuer_kind: shape.kind === 'admin' ? 'admin' : 'account',
    invite_type: PAID_INVITE_TYPE,
    grant_kind: 'tier',
    grant_id: shape.grantId,
    access_open_ended: null,
    access_months: null,
    inviter_display_name: 'Dana',
    language: 'he',
    personal_note: null,
    link_expires_at: '2026-10-31T00:00:00.000Z',
    first_viewed_at: null,
    revoked_at: null,
    redeemed_at: null,
  };
}

async function view(invite: BusinessOsInvitePublicView, switches: HeldPaymentSwitches) {
  const outcome = await viewInviteByToken(TOKEN, {
    repository: {
      findByTokenHashForPublicView: async (hash: string) => ({ data: hash === hashInviteToken(TOKEN) ? invite : null, error: null }),
      markFirstViewed: async () => ({ data: true, error: null }),
      findInviteeEmailForPublicCheck: async () => ({ data: 'invitee@example.com', error: null }),
      markOpenedByExistingAccount: async () => ({ data: true, error: null }),
    },
    accounts: { emailHasAccount: async () => ({ data: false, error: null }) },
    config,
    now: NOW,
    logger: { warn: () => undefined },
    paymentSwitches: () => switches,
  });
  if (!outcome.ok) throw new Error('the view failed');
  return outcome.response as Record<string, unknown>;
}

function holdOf(shape: Shape): HeldPaymentHold {
  return shape.kind === 'admin'
    ? { ok: true, held: true, inviteId: INVITE_ID, source: 'admin_invite', grantId: shape.grantId }
    : { ok: true, held: true, inviteId: INVITE_ID, source: 'account_invite' };
}

afterEach(() => {
  policy.paidInvitesAvailable = shipped.paid;
  policy.accountInvitesAvailable = shipped.account;
  policy.account.grantId = shipped.grantId;
  jest.restoreAllMocks();
});

describe('C-6: the page says "required" ⇔ the holding screen offers Pay (and the checkout admits)', () => {
  const CASES = COMBINATIONS.flatMap((switches) => SHAPES.map((shape) => [shape.label, shape, switches] as const));

  it('covers 8 switch combinations × every paid shape', () => {
    expect(CASES).toHaveLength(8 * SHAPES.length);
  });

  it.each(CASES)('%s, switches %j', async (_label, shape, switches) => {
    // Redemption's own gate reads the constant: flip it the way a demo does.
    policy.paidInvitesAvailable = switches.paidInvitesAvailable;
    policy.accountInvitesAvailable = true;
    if (shape.unpriced && shape.kind === 'admin') {
      // Redemption's predicate reads `sellableTiers` through the module export.
      jest.spyOn(billing, 'sellableTiers').mockReturnValue(sellableTiers().filter((tier) => tier !== shape.grantId));
    }
    // The held step reads the friend tier from the invite policy, so a friend
    // tier "without a price" is a policy naming a tier nobody sells.
    if (shape.unpriced && shape.kind === 'friend') policy.account.grantId = 'tier_without_a_price';

    const response = await view(row(shape), switches);
    const offer = heldPaymentOffer(holdOf(shape), switches);
    const screen = await readHeldPaymentView(
      { userId: USER, accountId: USER, hold: holdOf(shape), language: 'he', checkoutReturned: false },
      {
        switches: () => switches,
        billing: { findByUser: async () => ({ data: null, error: null }) } as never,
        mode: () => 'test',
        logger: { warn: () => undefined, error: () => undefined },
      }
    );

    const allOn = switches.checkoutEnabled && switches.pricesEnabled && switches.paidInvitesAvailable;
    // An admin Paid invite is on the page only while redemption accepts it
    // (P-9.1, C-2): the Paid switch on and its tier sellable.
    const pageShown = shape.kind === 'friend' || (switches.paidInvitesAvailable && !shape.unpriced);
    expect(response.state).toBe(pageShown ? 'valid' : 'unavailable');
    if (!pageShown) return;

    // O-1: the expected answer, not only agreement.
    const expected = allOn && !shape.unpriced ? 'required' : 'opens_later';
    expect(response.payment).toBe(expected);
    // C-6: the page and the holding screen can never disagree.
    expect(response.payment === 'required').toBe(offer.kind === 'pay');
    expect(response.payment === 'required').toBe(screen.kind === 'pay');
    if (offer.kind === 'pay') expect(offer.tier).toBe(shape.grantId);
  });
});

describe('a free (champion) invite says nothing about payment', () => {
  it.each(COMBINATIONS.map((switches) => [switches]))('switches %j: payment none', async (switches) => {
    const champion: BusinessOsInvitePublicView = {
      ...row({ label: 'champion', kind: 'admin', grantId: INVITE_TYPES[CHAMPION_INVITE_TYPE].defaultGrantId }),
      invite_type: CHAMPION_INVITE_TYPE,
      grant_kind: 'cohort',
      access_open_ended: true,
    };
    const response = await view(champion, switches);
    expect(response.state).toBe('valid');
    expect(response.payment).toBe('none');
  });
});
