/**
 * Plan payments P-9.1 (SA C-2, workplan A-2): the public invite page and the
 * signup must agree about an ADMIN Paid invite, for every row shape and both
 * values of the Paid switch.
 *
 *   page "valid"        ⇔ the signup accepts it (a code is sent)
 *   page "unavailable"  ⇔ the signup refuses it with 409, and the refusal is
 *                         `paid_invites_not_available` exactly when the switch
 *                         is off, `unavailable` otherwise
 *
 * Both run the real modules (`publicInviteView.ts`, `inviteRedemption.ts`)
 * over minimal fakes; both reach the one predicate `adminPaidInviteRedemption`.
 */

import * as billing from '@/lib/business-os/billing/planCheckoutEligibility';
import { sellableTiers } from '@/lib/business-os/billing/planCheckoutEligibility';
import { CHAMPION_INVITE_TYPE, INVITE_ISSUANCE_POLICY, PAID_INVITE_TYPE } from '@/lib/business-os/entitlements/config/invites';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsInvitePublicView, BusinessOsInviteRedemptionView } from '@/lib/repositories/types';

import { adminPaidInviteRedemption } from '../inviteOffer';
import { requestSignupCode, type RedemptionDeps } from '../inviteRedemption';
import { generateInviteToken, hashInviteToken } from '../inviteToken';
import { viewInviteByToken } from '../publicInviteView';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const TOKEN = generateInviteToken();
const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'invitee@example.com';
const config = getEntitlementConfig();
const policy = INVITE_ISSUANCE_POLICY as unknown as { paidInvitesAvailable: boolean };
const shippedPaid = INVITE_ISSUANCE_POLICY.paidInvitesAvailable;
const PAID_TIER = sellableTiers()[0];

interface Shape {
  label: string;
  invite_type: string;
  grant_id: string;
  /** Remove this tier's price for the case (SA C-3). */
  unpriced?: boolean;
}

const SHAPES: Shape[] = [
  { label: 'Paid type, a priced tier', invite_type: PAID_INVITE_TYPE, grant_id: PAID_TIER },
  { label: 'Paid type, a tier the config no longer carries', invite_type: PAID_INVITE_TYPE, grant_id: 'tier-x' },
  { label: 'Paid type, a configured tier with no price', invite_type: PAID_INVITE_TYPE, grant_id: PAID_TIER, unpriced: true },
  { label: 'a cohort type carrying a tier grant', invite_type: CHAMPION_INVITE_TYPE, grant_id: PAID_TIER },
  { label: 'an unknown type', invite_type: 'type-z', grant_id: PAID_TIER },
];

function publicRow(shape: Shape): BusinessOsInvitePublicView {
  return {
    id: INVITE_ID,
    issuer_kind: 'admin',
    invite_type: shape.invite_type,
    grant_kind: 'tier',
    grant_id: shape.grant_id,
    access_open_ended: null,
    access_months: null,
    inviter_display_name: 'Dana',
    language: 'en',
    personal_note: null,
    link_expires_at: '2026-10-31T00:00:00.000Z',
    first_viewed_at: null,
    revoked_at: null,
    redeemed_at: null,
  };
}

function redemptionRow(shape: Shape): BusinessOsInviteRedemptionView {
  return {
    id: INVITE_ID,
    email: EMAIL,
    invite_type: shape.invite_type,
    issuer_kind: 'admin',
    issuer_account_id: null,
    issuer_admin_id: '55555555-5555-4555-8555-555555555555',
    grant_kind: 'tier',
    grant_id: shape.grant_id,
    access_open_ended: null,
    access_months: null,
    language: 'en',
    link_expires_at: '2026-10-31T00:00:00.000Z',
    revoked_at: null,
    redeemed_at: null,
    signup_code_hash: null,
    signup_code_expires_at: null,
    signup_code_attempts: 0,
    signup_code_sent_count: 0,
    signup_code_window_started_at: null,
    signup_code_last_sent_at: null,
    claimed_at: null,
    claimed_account_id: null,
  };
}

async function viewState(shape: Shape): Promise<string> {
  const outcome = await viewInviteByToken(TOKEN, {
    repository: {
      findByTokenHashForPublicView: async (hash: string) => ({ data: hash === hashInviteToken(TOKEN) ? publicRow(shape) : null, error: null }),
      markFirstViewed: async () => ({ data: true, error: null }),
      findInviteeEmailForPublicCheck: async () => ({ data: EMAIL, error: null }),
      markOpenedByExistingAccount: async () => ({ data: true, error: null }),
    },
    accounts: { emailHasAccount: async () => ({ data: false, error: null }) },
    config,
    now: NOW,
    logger: { warn: () => undefined },
  });
  if (!outcome.ok) throw new Error('the view failed');
  return outcome.response.state;
}

async function signupAnswer(shape: Shape): Promise<{ ok: boolean; error?: string }> {
  const unused = async () => {
    throw new Error('not reached by requestSignupCode');
  };
  const deps = {
    invites: {
      findByTokenHashForRedemption: async (hash: string) => ({ data: hash === hashInviteToken(TOKEN) ? redemptionRow(shape) : null, error: null }),
      issueSignupCode: async () => ({ data: true, error: null }),
      markOpenedByExistingAccount: async () => ({ data: true, error: null }),
      countSignupCodeAttempt: unused,
      claimForSignup: unused,
      claimForGoogleSignup: unused,
      releaseSignupClaim: unused,
      recordRedemptionFailure: unused,
    },
    accounts: {
      emailHasAccount: async () => ({ data: false, error: null }),
      createConfirmedUser: unused,
      createConfirmedUserWithoutPassword: unused,
      findUserExists: unused,
    },
    finalise: unused,
    finaliseFriend: unused,
    finaliseAdminPaid: unused,
    issuerPlans: { findEntitlementInputs: unused },
    sendCode: async () => ({ sent: true }),
    sendExistingAccountNotice: unused,
    audit: async () => undefined,
    config,
    now: () => NOW,
    newAccountId: () => '33333333-3333-4333-8333-333333333333',
    verifyGoogleIdToken: unused,
    notifyInviter: unused,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  } as unknown as RedemptionDeps; // Only the request-code path runs; the unused doors throw if reached.
  const outcome = await requestSignupCode(TOKEN, deps);
  return outcome.ok ? { ok: true } : { ok: false, error: 'error' in outcome ? outcome.error : outcome.kind };
}

afterEach(() => {
  policy.paidInvitesAvailable = shippedPaid;
  jest.restoreAllMocks();
});

describe.each([false, true])('the Paid switch %s', (switchOn) => {
  it.each(SHAPES.map((shape) => [shape.label, shape] as const))('%s: the page and the signup agree', async (_label, shape) => {
    policy.paidInvitesAvailable = switchOn;
    if (shape.unpriced) jest.spyOn(billing, 'sellableTiers').mockReturnValue(sellableTiers().filter((tier) => tier !== shape.grant_id));

    const predicate = adminPaidInviteRedemption(redemptionRow(shape), config);
    const page = await viewState(shape);
    const signup = await signupAnswer(shape);

    expect(page === 'valid').toBe(signup.ok);
    expect(page === 'valid').toBe(predicate === 'ok');
    if (!signup.ok) {
      expect(page).toBe('unavailable');
      expect(signup.error).toBe(switchOn ? 'unavailable' : 'paid_invites_not_available');
      expect(predicate).toBe(switchOn ? 'unavailable' : 'switch_off');
    }
  });
});

it('only a Paid-type invite for a priced, configured tier is redeemable, and only with the switch on', async () => {
  policy.paidInvitesAvailable = true;
  expect(await viewState(SHAPES[0])).toBe('valid');
  expect(await signupAnswer(SHAPES[0])).toEqual({ ok: true });
  policy.paidInvitesAvailable = false;
  expect(await viewState(SHAPES[0])).toBe('unavailable');
  expect(await signupAnswer(SHAPES[0])).toEqual({ ok: false, error: 'paid_invites_not_available' });
});
