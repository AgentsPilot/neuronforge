/**
 * The name the admin console header shows for the signed-in admin.
 *
 * Resolved on the SERVER (in `app/admin/layout.tsx`) and handed to the client
 * chrome as a plain string, so no id or token crosses to the browser for this.
 *
 * Profile name first, then the auth email, then a neutral label. A profile read
 * that fails is not an error here — the repository logs it, and the header
 * degrades to the email rather than blocking the admin page.
 *
 * @module app/admin/adminDisplayName
 */

import 'server-only';

import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';

/** Shown only when there is neither a profile name nor an email. */
export const ADMIN_NAME_FALLBACK = 'Admin';

/** Pure fallback chain — exported for the unit test. */
export function pickAdminDisplayName(fullName: string | null | undefined, email: string | null | undefined): string {
  const name = fullName?.trim();
  if (name) return name;
  const mail = email?.trim();
  if (mail) return mail;
  return ADMIN_NAME_FALLBACK;
}

/** Look up the admin's profile name and apply the fallback chain. */
export async function resolveAdminDisplayName(admin: { id: string; email?: string }): Promise<string> {
  // `findById` runs on the service-role client (RLS bypassed). Safe here: the id
  // is the admin's OWN id, verified server-side by `requireAdminPage`, never
  // supplied by the client, and the read is the single row keyed on it.
  const { data } = await userProfileRepository.findById(admin.id);
  return pickAdminDisplayName(data?.full_name, admin.email);
}
