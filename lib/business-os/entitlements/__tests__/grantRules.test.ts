/**
 * The grant rules shared by `adminOps` and the invite redemption (T-2, R-5).
 * The RC-4 answer must be exactly what `adminOps` enforced inline before, and
 * an invite row is redeemable only as a decided, still-configured cohort grant.
 */

import { CHAMPION_ACCESS_MONTHS_MAX } from '@/lib/business-os/entitlements/config/invites';
import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';

import { championEndDecisionMissing, isGrantableCohort, isRedeemableCohortGrant } from '../grantRules';

const config = getEntitlementConfig();
const champion = 'champion';

describe('RC-4: championEndDecisionMissing (the rule adminOps applied inline)', () => {
  it('a champion with no end said is missing; null ("no end date") and a date are decisions', () => {
    expect(championEndDecisionMissing(champion, undefined)).toBe(true);
    expect(championEndDecisionMissing(champion, null)).toBe(false);
    expect(championEndDecisionMissing(champion, '2027-01-01T00:00:00.000Z')).toBe(false);
  });

  it('other cohorts, and no cohort, never need it', () => {
    expect(championEndDecisionMissing('trial', undefined)).toBe(false);
    expect(championEndDecisionMissing(null, undefined)).toBe(false);
  });
});

describe('GR-1: isGrantableCohort', () => {
  it('every configured cohort is grantable; a retired id is not', () => {
    for (const id of COHORT_IDS) expect(isGrantableCohort(config, id)).toBe(true);
    expect(isGrantableCohort(config, 'retired-cohort')).toBe(false);
  });

  it('a tier id is not a cohort', () => {
    for (const id of TIER_ORDER) expect(isGrantableCohort(config, id)).toBe(false);
  });
});

describe('R-5: isRedeemableCohortGrant', () => {
  const row = { grant_kind: 'cohort', grant_id: champion, access_open_ended: true, access_months: null } as const;

  it('open-ended with no months, or a month count within the cap, is redeemable', () => {
    expect(isRedeemableCohortGrant(config, row)).toBe(true);
    expect(isRedeemableCohortGrant(config, { ...row, access_open_ended: false, access_months: 12 })).toBe(true);
    expect(isRedeemableCohortGrant(config, { ...row, access_open_ended: false, access_months: CHAMPION_ACCESS_MONTHS_MAX })).toBe(true);
  });

  it.each([
    ['a tier grant', { grant_kind: 'tier', grant_id: TIER_ORDER[0] }],
    ['a retired cohort', { grant_id: 'retired-cohort' }],
    ['an undecided end', { access_open_ended: null }],
    ['open-ended with months', { access_months: 3 }],
    ['months missing', { access_open_ended: false, access_months: null }],
    ['zero months', { access_open_ended: false, access_months: 0 }],
    ['months over the cap', { access_open_ended: false, access_months: CHAMPION_ACCESS_MONTHS_MAX + 1 }],
    ['fractional months', { access_open_ended: false, access_months: 1.5 }],
  ])('%s is not redeemable', (_label, overrides) => {
    expect(isRedeemableCohortGrant(config, { ...row, ...overrides })).toBe(false);
  });
});
