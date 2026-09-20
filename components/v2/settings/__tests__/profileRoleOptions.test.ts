/**
 * The Settings → Profile tab must not offer to make you an administrator.
 *
 * It writes `profiles` directly with the browser anon key, and the `profiles`
 * UPDATE policy is `USING (auth.uid() = id)` with no WITH CHECK and no column
 * restriction — so the "Administrator" option this list used to carry really
 * did write `role = 'admin'` on your own row. Nothing authorizes on that column
 * (admin identity is `admin_users` via AdminAccessService), so nothing was
 * exploitable; but the option is exactly the kind of thing that gets re-added
 * by someone reading the old screenshot, so its absence is asserted here rather
 * than left to review.
 *
 * Second half: the old fallback was positional (`roleOptions[1]`). Deleting the
 * first entry would have shifted it to Viewer, so every legacy `role = 'admin'`
 * row and every onboarding persona would have silently displayed as read-only.
 */

import {
  PROFILE_ROLE_OPTIONS,
  getProfileRoleConfig,
} from '@/components/v2/settings/profileRoleOptions';

/**
 * Kept in step with `privileged_values` in
 * 20261002_profiles_role_privilege_guard.sql — already-normalised form.
 */
const PRIVILEGED_VALUES = [
  'admin',
  'administrator',
  'superadmin',
  'platformadmin',
  'supabaseadmin',
  'superuser',
  'sysadmin',
  'systemadmin',
  'root',
  'owner',
  'servicerole',
];

/**
 * Mirrors the trigger's
 * `lower(regexp_replace(normalize(v, NFKC), '[^a-zA-Z0-9]', '', 'g'))`
 * — NFKC, then strip, then lower, IN THAT ORDER.
 *
 * A mirror is not a test of the SQL: only the database can prove the trigger,
 * and the migration's VERIFICATION block does that. What it pins here is the
 * *semantics* the two halves must agree on, so a change to one shows up against
 * the other.
 *
 * The order is the point (QA D5). The first version lowercased first, which
 * diverges on a dotted capital I: `'ADMİN'.toLowerCase()` is `i` + U+0307,
 * whose combining mark the strip then discards, giving `admin` — where the SQL
 * gives `admn`. Two normalisers that disagree about what 'admin' is are the
 * exact class of bug this column already had.
 */
const normalise = (value: string) =>
  value.normalize('NFKC').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
const isPrivileged = (value: string) => PRIVILEGED_VALUES.includes(normalise(value));

/** Written to `profiles.role` from the browser by components/onboarding/RoleStep.tsx. */
const ONBOARDING_PERSONAS = [
  'business_owner',
  'manager',
  'consultant',
  'operations',
  'sales',
  'marketing',
  'finance',
  'other',
];

describe('profile role options', () => {
  it('offers no privileged value', () => {
    for (const option of PROFILE_ROLE_OPTIONS) {
      expect(isPrivileged(option.value)).toBe(false);
    }
  });

  /*
   * The normalisation the guard relies on. `btrim` — the first version — strips
   * ASCII spaces only, so E'\tadmin', E'admin\n' and an NBSP-padded 'admin'
   * were stored verbatim, while JavaScript's `.trim()` strips all three and
   * would read them back as exactly 'admin'. That gap is the point: the column
   * would hold a value that a JS reader normalises to a privilege claim.
   */
  describe('privileged-value normalisation (mirrors the SQL guard)', () => {
    it.each([
      '  ADMIN ',
      '\tadmin',
      'admin\n',
      ' admin ', // NBSP — survives btrim, dies to JS .trim()
      '​admin', // zero-width space
      'Super-Admin',
      'super admin',
      'super_admin',
      'service_role',
      'platform.admin',
      'SUPERUSER',
      'sys_admin',
      'System Admin',
      'ａｄｍｉｎ', // full-width 'admin' — folded by NFKC (QA D4)
    ])('clamps %j', value => {
      expect(isPrivileged(value)).toBe(true);
    });

    // 'staff' and 'moderator' are excluded from the denylist on purpose: both
    // are plausible ordinary job labels, which is what this column holds, and
    // neither is a privilege name anything in this codebase checks.
    it.each([...ONBOARDING_PERSONAS, 'user', 'viewer', 'staff', 'moderator', ''])(
      'leaves %j alone',
      value => {
        expect(isPrivileged(value)).toBe(false);
      }
    );

    /*
     * ACCEPTED RESIDUAL RISK — asserted so it stays a known quantity rather than
     * a surprise, and so the mirror cannot silently start disagreeing with the
     * database about any of them (see the migration's ACCEPTED RESIDUAL RISK
     * block). If one of these ever needs to clamp, the SQL normaliser changes
     * first and this test follows — never the other way round.
     */
    it.each([
      'аdmin', // Cyrillic U+0430: NFKC does not fold confusables -> 'dmin'
      'ΑDMIN', // Greek capital alpha -> 'dmin'
      'ADMİN', // dotted capital I -> 'admn'. The D5 divergence: the old
      //                 lowercase-first mirror returned TRUE here, the SQL FALSE.
      'admins',
      'adminuser',
      'org_admin',
    ])('does NOT clamp %j — documented residual, matches the SQL', value => {
      expect(isPrivileged(value)).toBe(false);
    });

    it('is equality, not a substring test — business_owner contains "owner"', () => {
      // The row that would break onboarding if the check were `LIKE '%owner%'`.
      expect(normalise('business_owner')).toBe('businessowner');
      expect(normalise('business_owner')).toContain('owner');
      expect(isPrivileged('business_owner')).toBe(false);
    });
  });

  it('does not label any option as an administrator', () => {
    const labels = PROFILE_ROLE_OPTIONS.map(o => `${o.label} ${o.description}`.toLowerCase());
    for (const label of labels) {
      expect(label).not.toMatch(/admin/);
      // "Full access to all features" was the Administrator description.
      expect(label).not.toMatch(/full access/);
    }
  });

  it('still offers the two non-privileged choices', () => {
    expect(PROFILE_ROLE_OPTIONS.map(o => o.value)).toEqual(['user', 'viewer']);
  });

  describe('getProfileRoleConfig', () => {
    it('returns the matching option when the stored role is offered', () => {
      expect(getProfileRoleConfig('user').label).toBe('User');
      expect(getProfileRoleConfig('viewer').label).toBe('Viewer');
    });

    it('falls back to User — not Viewer — for a legacy admin row', () => {
      // The regression the positional fallback would have caused.
      expect(getProfileRoleConfig('admin').value).toBe('user');
    });

    it('falls back to User for every onboarding persona', () => {
      for (const persona of ONBOARDING_PERSONAS) {
        expect(getProfileRoleConfig(persona).value).toBe('user');
      }
    });

    it('falls back to User for empty and unknown values', () => {
      expect(getProfileRoleConfig('').value).toBe('user');
      expect(getProfileRoleConfig('something-nobody-wrote').value).toBe('user');
    });

    it('never resolves to an option that is not on the list', () => {
      const offered = PROFILE_ROLE_OPTIONS.map(o => o.value);
      for (const value of [...PRIVILEGED_VALUES, ...ONBOARDING_PERSONAS, '', 'VIEWER']) {
        expect(offered).toContain(getProfileRoleConfig(value).value);
      }
    });
  });
});
