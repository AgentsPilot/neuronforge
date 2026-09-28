/**
 * C-5 / C-7 / AC-6 — the invite request schemas: enums from config, RC-4 a
 * required key, `.strict()` everywhere, the email normalised.
 *
 * Tier ids are read from `TIER_ORDER`, never written: this file is outside the
 * folders the tier-literal guard lets name one.
 */

import { locales } from '@/lib/i18n/config';
import {
  CHAMPION_ACCESS_MONTHS_MAX,
  CHAMPION_INVITE_TYPE,
  INVITE_LINK_EXPIRY,
  PAID_INVITE_TYPE,
} from '@/lib/business-os/entitlements/config/invites';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

import {
  createInviteSchema,
  inviteIdSchema,
  revokeInviteSchema,
  validateInviteBodySchema,
} from '../inviteSchemas';

function champion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inviteType: CHAMPION_INVITE_TYPE,
    email: 'Dana@Example.com',
    access: { kind: 'open_ended' },
    linkExpiryDays: INVITE_LINK_EXPIRY.defaultDays,
    language: 'en',
    personalNote: 'Welcome aboard',
    reason: 'Design partner',
    ...overrides,
  };
}

function paid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inviteType: PAID_INVITE_TYPE,
    email: 'lee@example.com',
    grantId: TIER_ORDER[0],
    linkExpiryDays: INVITE_LINK_EXPIRY.defaultDays,
    language: 'he',
    reason: 'Referred by a partner',
    ...overrides,
  };
}

describe('createInviteSchema', () => {
  it('accepts a champion invite and normalises the email', () => {
    const parsed = createInviteSchema.parse(champion({ email: '  Dana@Example.COM ' }));
    expect(parsed.email).toBe('dana@example.com');
  });

  it('accepts every configured expiry option, and nothing else', () => {
    for (const days of INVITE_LINK_EXPIRY.optionsDays) {
      expect(createInviteSchema.safeParse(champion({ linkExpiryDays: days })).success).toBe(true);
    }
    for (const days of [0, 7, 45, 90, 30.5, '30']) {
      expect(createInviteSchema.safeParse(champion({ linkExpiryDays: days })).success).toBe(false);
    }
  });

  it('the language enum equals the locale list', () => {
    for (const language of locales) {
      expect(createInviteSchema.safeParse(champion({ language })).success).toBe(true);
    }
    expect(createInviteSchema.safeParse(champion({ language: 'fr' })).success).toBe(false);
  });

  it('RC-4: a champion invite without an access decision is refused', () => {
    const body = champion();
    delete body.access;
    expect(createInviteSchema.safeParse(body).success).toBe(false);
  });

  it('champion access: open-ended, or 1 to the configured maximum of whole months', () => {
    expect(createInviteSchema.safeParse(champion({ access: { kind: 'months', months: 12 } })).success).toBe(true);
    expect(
      createInviteSchema.safeParse(champion({ access: { kind: 'months', months: CHAMPION_ACCESS_MONTHS_MAX } })).success
    ).toBe(true);
    for (const months of [0, -1, CHAMPION_ACCESS_MONTHS_MAX + 1, 1.5]) {
      expect(createInviteSchema.safeParse(champion({ access: { kind: 'months', months } })).success).toBe(false);
    }
    expect(createInviteSchema.safeParse(champion({ access: { kind: 'forever' } })).success).toBe(false);
    expect(createInviteSchema.safeParse(champion({ access: { kind: 'open_ended', months: 3 } })).success).toBe(false);
  });

  it('champion forbids a grantId: the grant comes from config, never the request', () => {
    expect(createInviteSchema.safeParse(champion({ grantId: TIER_ORDER[0] })).success).toBe(false);
  });

  it('paid requires a grantId from TIER_ORDER, and forbids access', () => {
    for (const id of TIER_ORDER) {
      expect(createInviteSchema.safeParse(paid({ grantId: id })).success).toBe(true);
    }
    const noGrant = paid();
    delete noGrant.grantId;
    expect(createInviteSchema.safeParse(noGrant).success).toBe(false);
    expect(createInviteSchema.safeParse(paid({ grantId: 'unknown-tier' })).success).toBe(false);
    expect(createInviteSchema.safeParse(paid({ access: { kind: 'open_ended' } })).success).toBe(false);
  });

  it('refuses an unknown invite type', () => {
    expect(createInviteSchema.safeParse(champion({ inviteType: 'trial' })).success).toBe(false);
  });

  it.each(['grant_id', 'grantKind', 'issuerAdminId', 'issuer', 'userId', 'tokenHash', 'cohort', 'level'])(
    'AC-6: an injected %s is refused by .strict()',
    (key) => {
      expect(createInviteSchema.safeParse(champion({ [key]: 'x' })).success).toBe(false);
      expect(createInviteSchema.safeParse(paid({ [key]: 'x' })).success).toBe(false);
    }
  );

  it('QA-3: a reason is counted in characters like SQL, so two emoji (4 UTF-16 units) are too short', () => {
    expect('😀😀'.length).toBe(4);
    expect(createInviteSchema.safeParse(champion({ reason: '😀😀' })).success).toBe(false);
    expect(revokeInviteSchema.safeParse({ reason: '😀😀' }).success).toBe(false);
    expect(createInviteSchema.safeParse(champion({ reason: '😀😀😀' })).success).toBe(true);
    expect(revokeInviteSchema.safeParse({ reason: '😀'.repeat(500) }).success).toBe(true);
    expect(revokeInviteSchema.safeParse({ reason: '😀'.repeat(501) }).success).toBe(false);
  });

  it.each([
    ['a bad email', { email: 'not-an-email' }],
    ['a missing reason', { reason: undefined }],
    ['a 2-character reason', { reason: 'ab' }],
    ['a reason of spaces', { reason: '     ' }],
    ['a 501-character reason', { reason: 'r'.repeat(501) }],
    ['a 1001-character note', { personalNote: 'n'.repeat(1001) }],
  ])('refuses %s', (_label, overrides) => {
    expect(createInviteSchema.safeParse(champion(overrides)).success).toBe(false);
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, 'x', 1, []]) {
      expect(createInviteSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('revokeInviteSchema and inviteIdSchema', () => {
  it('takes a reason of at least 3 characters and nothing else', () => {
    expect(revokeInviteSchema.safeParse({ reason: 'Sent to the wrong person' }).success).toBe(true);
    expect(revokeInviteSchema.safeParse({ reason: 'no' }).success).toBe(false);
    expect(revokeInviteSchema.safeParse({ reason: 'Wrong person', revokedBy: 'x' }).success).toBe(false);
    expect(revokeInviteSchema.safeParse({}).success).toBe(false);
  });

  it('the invite id is a uuid', () => {
    expect(inviteIdSchema.safeParse('11111111-1111-4111-8111-111111111111').success).toBe(true);
    expect(inviteIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('validateInviteBodySchema (shape only, F-2)', () => {
  it('takes { token: string } and nothing else', () => {
    expect(validateInviteBodySchema.safeParse({ token: 'abc' }).success).toBe(true);
    expect(validateInviteBodySchema.safeParse({}).success).toBe(false);
    expect(validateInviteBodySchema.safeParse({ token: 1 }).success).toBe(false);
    expect(validateInviteBodySchema.safeParse({ token: 'abc', email: 'x' }).success).toBe(false);
    expect(validateInviteBodySchema.safeParse({ token: 'a'.repeat(513) }).success).toBe(false);
  });
});
