import { Globe, User, type LucideIcon } from 'lucide-react';

/**
 * The role choices offered on the Settings → Profile tab.
 *
 * `profiles.role` is a **persona/display label, never an authorization signal**.
 * Admin identity lives in the `admin_users` allow-list, read through
 * `AdminAccessService` — see docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md.
 *
 * "Administrator" used to be on this list. The `profiles` UPDATE policy is
 * `USING (auth.uid() = id)` with no WITH CHECK and no column restriction, and
 * this tab writes `profiles` directly with the browser anon key, so picking it
 * genuinely wrote `role = 'admin'` on your own row. It granted nothing, because
 * nothing reads the column for authorization — but the UI was offering to make
 * you an administrator, and the database was agreeing. It is gone, and
 * supabase/migrations/20261002_profiles_role_privilege_guard.sql now drops the
 * value underneath every client write path, not just this one.
 *
 * Extracted from ProfileTabV2 so that "no privileged value is offered" can be a
 * test rather than a promise.
 */

export interface ProfileRoleOption {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const PROFILE_ROLE_OPTIONS: ProfileRoleOption[] = [
  {
    value: 'user',
    label: 'User',
    description: 'Standard access',
    icon: User,
  },
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Read-only access',
    icon: Globe,
  },
];

/** The option shown when the stored value is not one this tab offers. */
export const DEFAULT_PROFILE_ROLE_OPTION: ProfileRoleOption =
  PROFILE_ROLE_OPTIONS.find(option => option.value === 'user') ?? PROFILE_ROLE_OPTIONS[0];

/**
 * Resolve a stored `profiles.role` to the option to display.
 *
 * Found by value, not by index. The previous `roleOptions[1]` meant "the second
 * one, which happens to be User" — and removing Administrator would have
 * silently made it Viewer, relabelling every legacy `role = 'admin'` row and
 * every onboarding persona (`business_owner`, `manager`, `consultant`,
 * `operations`, `sales`, `marketing`, `finance`, `other` — written by
 * components/onboarding/RoleStep.tsx) as read-only.
 *
 * This is display only. The tab saves `profileForm.role`, the raw stored value,
 * which changes only when the user actually picks an option — so falling back
 * here never rewrites anyone's stored role.
 */
export function getProfileRoleConfig(role: string): ProfileRoleOption {
  return (
    PROFILE_ROLE_OPTIONS.find(option => option.value === role) ?? DEFAULT_PROFILE_ROLE_OPTION
  );
}
