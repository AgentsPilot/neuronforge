/**
 * C-7 — the invite settings are config, derived from the entitlements config,
 * and hold the two decisions the user made (BQ-1, BQ-3) and the one switch SA
 * requires to stay off until Slice 5 (C-6, T-15).
 *
 * It lives in `entitlements/__tests__` on purpose: this is the one invite test
 * allowed to NAME plan ids (the tier-literal guard's allowed prefix), so every
 * other invite test can derive them from `TIER_ORDER` and name none.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  CHAMPION_ACCESS_MONTHS_MAX,
  CHAMPION_INVITE_TYPE,
  FRIEND_INVITE_LIMITS,
  INVITE_ISSUANCE_POLICY,
  INVITE_LINK_EXPIRY,
  INVITE_TYPE_IDS,
  INVITE_TYPES,
  PAID_INVITE_TYPE,
} from '@/lib/business-os/entitlements/config/invites';

describe('link expiry (BQ-1, T-14)', () => {
  it('offers exactly 15, 30 and 60 days, defaulting to 30', () => {
    expect([...INVITE_LINK_EXPIRY.optionsDays]).toEqual([15, 30, 60]);
    expect(INVITE_LINK_EXPIRY.defaultDays).toBe(30);
  });

  it('the default is one of the options', () => {
    expect(INVITE_LINK_EXPIRY.optionsDays as readonly number[]).toContain(INVITE_LINK_EXPIRY.defaultDays);
  });

  it('every option is a positive whole number of days', () => {
    for (const days of INVITE_LINK_EXPIRY.optionsDays) {
      expect(Number.isInteger(days) && days > 0).toBe(true);
    }
  });
});

describe('invite types and their grants (GR-1, BQ-3)', () => {
  it('there are exactly two types: champion and paid', () => {
    expect(INVITE_TYPE_IDS).toEqual(['champion', 'paid']);
    expect(CHAMPION_INVITE_TYPE).toBe('champion');
    expect(PAID_INVITE_TYPE).toBe('paid');
  });

  it('champion grants the champion cohort, and its grant ids are all real cohorts', () => {
    const champion = INVITE_TYPES[CHAMPION_INVITE_TYPE];
    expect(champion.grantKind).toBe('cohort');
    expect([...champion.grantIds]).toEqual(['champion']);
    for (const id of champion.grantIds) expect(COHORT_IDS).toContain(id);
    expect(champion.defaultGrantId).toBe('champion');
  });

  it('paid grants every tier, and defaults to the first tier in TIER_ORDER (C-7)', () => {
    const paid = INVITE_TYPES[PAID_INVITE_TYPE];
    expect(paid.grantKind).toBe('tier');
    expect([...paid.grantIds]).toEqual([...TIER_ORDER]);
    expect(paid.defaultGrantId).toBe(TIER_ORDER[0]);
    expect(paid.defaultGrantId).toBe('basic');
  });

  it('no invite type grants the trial (BQ-3)', () => {
    for (const type of INVITE_TYPE_IDS) {
      expect(INVITE_TYPES[type].grantIds as readonly string[]).not.toContain('trial');
    }
  });

  it('each default grant is one of that type\'s grants', () => {
    for (const type of INVITE_TYPE_IDS) {
      expect(INVITE_TYPES[type].grantIds as readonly string[]).toContain(INVITE_TYPES[type].defaultGrantId);
    }
  });

  it('champion access is capped at a positive whole number of months', () => {
    expect(Number.isInteger(CHAMPION_ACCESS_MONTHS_MAX)).toBe(true);
    expect(CHAMPION_ACCESS_MONTHS_MAX).toBe(60);
  });
});

describe('issuance policy (GR-3, T-15, C-6)', () => {
  it('an admin may issue both types', () => {
    expect([...INVITE_ISSUANCE_POLICY.admin]).toEqual(['champion', 'paid']);
  });

  it('Paid invites are switched OFF until Slice 5, when the Business OS checkout exists', () => {
    // Flipping this is the Slice 5 decision, made with S-4a live and G-1 closed.
    // Until then the server refuses every Paid invite (C-6).
    expect(INVITE_ISSUANCE_POLICY.paidInvitesAvailable).toBe(false);
    expect(INVITE_ISSUANCE_POLICY.paidUnavailableReason).toBe('available when payments are live');
  });
});

describe('friend invites from champion accounts (Slice 5a, T-17, T-18, T-21)', () => {
  it('a champion account may issue Paid to the first tier, and nothing else (BQ-14, FR-30)', () => {
    expect(INVITE_ISSUANCE_POLICY.account.issuerCohort).toBe('champion');
    expect(COHORT_IDS).toContain(INVITE_ISSUANCE_POLICY.account.issuerCohort);
    expect(INVITE_ISSUANCE_POLICY.account.inviteType).toBe(PAID_INVITE_TYPE);
    expect(INVITE_ISSUANCE_POLICY.account.grantId).toBe(TIER_ORDER[0]);
    expect(INVITE_ISSUANCE_POLICY.account.grantId).toBe('basic');
    expect(INVITE_TYPES[INVITE_ISSUANCE_POLICY.account.inviteType].grantKind).toBe('tier');
  });

  it('friend invites are switched OFF until the user chooses (BQ-13, T-18)', () => {
    expect(INVITE_ISSUANCE_POLICY.accountInvitesAvailable).toBe(false);
  });

  it('the lifetime allowance is 5, the rate limit 10 per rolling 24 hours (BQ-10, T-21)', () => {
    expect(FRIEND_INVITE_LIMITS).toEqual({ lifetimeAllowance: 5, dailySendLimit: 10, dailyWindowHours: 24 });
  });
});

describe('the schemas build their enums from config, not from adminOps (C-7)', () => {
  const schemas = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'inviteSchemas.ts'), 'utf8');

  it('never references COHORT_VALUES or adminOps', () => {
    expect(schemas).not.toContain('COHORT_VALUES');
    expect(schemas).not.toMatch(/entitlements\/adminOps/);
  });

  it('imports its values from the entitlements config folder', () => {
    expect(schemas).toMatch(/from '@\/lib\/business-os\/entitlements\/config\/invites'/);
    expect(schemas).toMatch(/from '@\/lib\/business-os\/entitlements\/config\/tierMatrix'/);
  });
});
