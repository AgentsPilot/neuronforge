/**
 * The admin form and create for a Paid invite (plan payments P-9.2; workplan
 * §3.6, §7 "Admin ops / form"; SA C-3, C-4).
 *
 *   - the Paid type offers only tiers that can be paid for (`sellableTiers()`,
 *     a Stripe price exists), in tier order, each labelled
 *     "<plan> · $<price> a month" from `planLabel` / `planMonthlyPriceUsd` on
 *     the SAME injected config; the default is the type's default when payable;
 *   - it carries the "pays at signup" note; the champion type carries none;
 *   - with no payable tier the type is unavailable with its reason;
 *   - create refuses a Paid grant nobody could pay for with 409
 *     `grant_not_available` BEFORE any read or write; a payable one reaches the
 *     write;
 *   - Paid stays disabled while `paidInvitesAvailable` is off.
 * No tier name or price is written here: both come from the config.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import { readFileSync } from 'fs';
import { join } from 'path';

import * as billing from '@/lib/business-os/billing/planCheckoutEligibility';
import { sellableTiers } from '@/lib/business-os/billing/planCheckoutEligibility';
import { CHAMPION_INVITE_TYPE, INVITE_ISSUANCE_POLICY, INVITE_LINK_EXPIRY, INVITE_TYPES, PAID_INVITE_TYPE } from '@/lib/business-os/entitlements/config/invites';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { planLabel, planMonthlyPriceUsd } from '@/lib/business-os/entitlements/planPresentation';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';

import {
  PAID_INVITE_FORM_NOTE,
  PAID_INVITE_NO_PRICED_PLAN,
  buildInviteFormOptions,
  createInviteForAdmin,
  type CreateInviteDeps,
} from '../adminInviteOps';
import { createInviteSchema } from '../inviteSchemas';

const config = getEntitlementConfig();
const policy = INVITE_ISSUANCE_POLICY as unknown as { paidInvitesAvailable: boolean };
const shippedPaid = INVITE_ISSUANCE_POLICY.paidInvitesAvailable;
const NOW = new Date('2026-10-14T12:00:00.000Z');

afterEach(() => {
  policy.paidInvitesAvailable = shippedPaid;
  jest.restoreAllMocks();
});

function paidOption() {
  const option = buildInviteFormOptions(config).inviteTypes.find((type) => type.type === PAID_INVITE_TYPE);
  if (!option) throw new Error('the Paid type is not offered to admins');
  return option;
}

describe('buildInviteFormOptions: the Paid type (SA C-3, C-4)', () => {
  it('offers exactly the sellable tiers, in tier order, each "<plan> · $<price> a month" from the injected config', () => {
    policy.paidInvitesAvailable = true;
    const paid = paidOption();
    expect(paid.available).toBe(true);
    expect(paid.grants.map((grant) => grant.id)).toEqual([...sellableTiers()]);
    for (const grant of paid.grants) {
      expect(grant.label).toBe(`${planLabel(config, grant.id)} · $${planMonthlyPriceUsd(config, grant.id)} a month`);
    }
    expect(paid.grants.filter((grant) => grant.default).map((grant) => grant.id)).toEqual([INVITE_TYPES[PAID_INVITE_TYPE].defaultGrantId]);
  });

  it('carries the "pays at signup" note; the champion type carries none', () => {
    const options = buildInviteFormOptions(config);
    expect(paidOption().note).toBe(PAID_INVITE_FORM_NOTE);
    expect(PAID_INVITE_FORM_NOTE).toBe('The invitee pays this plan at signup and cannot use AgentPilot until they have paid.');
    expect(options.inviteTypes.find((type) => type.type === CHAMPION_INVITE_TYPE)?.note).toBeNull();
  });

  it('a tier without a Stripe price is not offered, and the default moves to the first payable tier', () => {
    policy.paidInvitesAvailable = true;
    const defaultTier = INVITE_TYPES[PAID_INVITE_TYPE].defaultGrantId;
    const rest = sellableTiers().filter((tier) => tier !== defaultTier);
    jest.spyOn(billing, 'sellableTiers').mockReturnValue(rest);
    const paid = paidOption();
    expect(paid.grants.map((grant) => grant.id)).toEqual(rest);
    if (rest.length > 0) expect(paid.grants.filter((grant) => grant.default).map((grant) => grant.id)).toEqual([rest[0]]);
  });

  it('no payable tier at all: the Paid type is unavailable with its reason, and offers nothing', () => {
    policy.paidInvitesAvailable = true;
    jest.spyOn(billing, 'sellableTiers').mockReturnValue([]);
    const paid = paidOption();
    expect(paid.available).toBe(false);
    expect(paid.unavailableReason).toBe(PAID_INVITE_NO_PRICED_PLAN);
    expect(paid.grants).toEqual([]);
  });

  it('while the Paid switch is off (production): disabled with "available when payments are live"', () => {
    policy.paidInvitesAvailable = false;
    const paid = paidOption();
    expect(paid.available).toBe(false);
    expect(paid.unavailableReason).toBe(INVITE_ISSUANCE_POLICY.paidUnavailableReason);
  });

  it('source (C-3): the decision uses sellableTiers, never buyableTiers or the type\'s grant list; price via planMonthlyPriceUsd, never TIER_MATRIX', () => {
    // Code only: comments may name what is NOT used.
    const text = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'adminInviteOps.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(text).toContain('sellableTiers()');
    expect(text).not.toContain('buyableTiers');
    expect(text).not.toContain('TIER_MATRIX');
    expect(text).not.toMatch(/definition\.grantIds/);
    expect(text).toContain('planMonthlyPriceUsd(config, tier)');
  });
});

function createHarness() {
  const deps = {
    adminId: '22222222-2222-4222-8222-222222222222',
    adminEmail: 'Admin@Example.com',
    config,
    now: NOW,
    repository: {
      // Fails on purpose: reaching it proves the Paid checks let the grant through.
      createForAdmin: jest.fn(async () => ({ data: null, error: new Error('insert failed') })),
      recordInviteEmailOutcome: jest.fn(async () => ({ data: true, error: null })),
    },
    profileRepository: { findById: jest.fn(async () => ({ data: { full_name: 'Dana Levi' }, error: null })) },
    logger: { warn: () => undefined },
    email: {
      sendEmail: jest.fn(),
      senderAddress: () => 'team@agentpilot.example',
      now: () => NOW,
      logger: { info: () => undefined, warn: () => undefined },
    },
  } as unknown as CreateInviteDeps;
  return deps;
}

const paidBody = (grantId: string) =>
  createInviteSchema.parse({
    inviteType: PAID_INVITE_TYPE,
    grantId,
    email: 'buyer@example.com',
    linkExpiryDays: INVITE_LINK_EXPIRY.defaultDays,
    language: 'he',
    reason: 'P-9.2 test',
    sendEmail: false,
  });

describe('createInviteForAdmin: a Paid grant nobody could pay for is refused (SA C-3, C-4)', () => {
  const TOP = TIER_ORDER[TIER_ORDER.length - 1];

  it('an unpriced tier → 409 grant_not_available, before the inviter read or any write', async () => {
    policy.paidInvitesAvailable = true;
    jest.spyOn(billing, 'sellableTiers').mockReturnValue(sellableTiers().filter((tier) => tier !== TOP));
    const deps = createHarness();
    expect(await createInviteForAdmin(paidBody(TOP), deps)).toEqual({ ok: false, status: 409, error: 'grant_not_available' });
    expect(deps.repository.createForAdmin).not.toHaveBeenCalled();
    expect((deps.profileRepository as unknown as { findById: jest.Mock }).findById).not.toHaveBeenCalled();
  });

  it.each(sellableTiers().map((tier) => [tier]))('a payable tier (%s) passes the Paid checks and reaches the write', async (tier) => {
    policy.paidInvitesAvailable = true;
    const deps = createHarness();
    expect(await createInviteForAdmin(paidBody(tier), deps)).toEqual({ ok: false, status: 500, error: 'could_not_create_invite' });
    expect(deps.repository.createForAdmin).toHaveBeenCalledTimes(1);
    expect((deps.repository.createForAdmin as jest.Mock).mock.calls[0][0]).toMatchObject({ grant_kind: 'tier', grant_id: tier });
  });

  it('the switch off still answers paid_invites_not_available first (unchanged)', async () => {
    policy.paidInvitesAvailable = false;
    const deps = createHarness();
    expect(await createInviteForAdmin(paidBody(TOP), deps)).toEqual({ ok: false, status: 409, error: 'paid_invites_not_available' });
    expect(deps.repository.createForAdmin).not.toHaveBeenCalled();
  });
});
