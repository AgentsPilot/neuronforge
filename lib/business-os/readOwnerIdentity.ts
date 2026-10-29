import 'server-only';

/**
 * Who the owner is, for the header's identity chip — read on the server so the
 * first frame already carries it.
 *
 * ── Why on the server ───────────────────────────────────────────────────────
 * The chip sits in the chrome of every Business OS page. Fetched from the
 * browser it would render empty, then pop; and the name it needs lives in
 * `profiles`, which only a repository may read (CLAUDE.md rule 1) and a
 * `'use client'` header therefore cannot. The layout is `force-dynamic` and
 * already reads the session, so the name comes with the page.
 *
 * ── Which name, and why that one ────────────────────────────────────────────
 * `profiles.full_name` FIRST. The settings form writes there, and auth
 * metadata is written once at sign-up by whatever the provider handed over —
 * so an owner who corrects their name would otherwise keep seeing the initials
 * of the name they had just replaced, with nothing on either screen to explain
 * it. That is the same precedence `app/api/business-os/my-day/route.ts` settles
 * on for the greeting, for the same reason; the two must not disagree, because
 * they appear one above the other.
 *
 * ── The guarantees ─────────────────────────────────────────────────────────
 *   1. **Never throws.** Every failure is `null`, and `null` makes the header
 *      keep the gear icon it has always had. A wrong pair of initials is a
 *      claim about who is signed in, so silence is the better answer.
 *   2. **The session user only.** No parameter: the id is `getUser().id`, never
 *      a caller-supplied value. Reading one's own row needs no ownership
 *      pre-check (tenant-isolation-guard step 1).
 *   3. **No extra round trip for the session.** `getUser` is memoised per
 *      request, so this shares the lookup the layout's other reads make.
 *   4. **Initials only leave this module.** The full name is not returned: the
 *      header has no use for it, and the less identity in the client bundle the
 *      better.
 */

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';

import { ownerInitials } from './ownerInitials';

const logger = createLogger({ module: 'BusinessOsOwnerIdentityRead' });

export type OwnerIdentity = {
  /** One or two upper-case letters. Never empty — see `readOwnerIdentity`. */
  initials: string;
};

export async function readOwnerIdentity(): Promise<OwnerIdentity | null> {
  try {
    const user = await getUser();

    // No session: nothing is read and no id is invented.
    if (!user) return null;

    const { data } = await userProfileRepository.findSettingsCard(user.id);

    /*
     * A missing row is NOT an error here — an account whose onboarding never
     * wrote a profile still has an email, which is enough for one letter.
     * `findSettingsCard` reports both cases as `data: null`, and both are
     * handled by falling through to the address.
     */
    const initials = ownerInitials(data?.full_name, user.email);

    // Nothing to show rather than a blank square.
    return initials ? { initials } : null;
  } catch (error) {
    logger.warn({ err: error }, 'Owner identity unavailable; the header keeps the settings icon');
    return null;
  }
}
