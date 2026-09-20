'use client'

import { supabase } from '@/lib/supabaseClient'
import { clientLogger } from '@/lib/logger/client'
import { signOutUser } from '@/lib/client/auth-actions'
import { marketingLoginUrl } from '@/lib/utils/marketingUrl'

const logger = clientLogger.child({ module: 'LogoutButton' })

export default function LogoutButton() {
  /*
   * The sign-out itself lives in `lib/client/auth-actions`, shared with the
   * Business OS settings control and the test harness: one audit event, one
   * definition of which browser-storage keys belong to a PERSON rather than the
   * device. This button used to clear none of them, so the next account signed
   * in on the browser inherited the previous one's onboarding state, cached
   * profile and language.
   *
   * `scope: 'global'` is not a new choice — `supabase.auth.signOut()` with no
   * arguments defaults to global, which is what this button has always done.
   * It is spelled out because `signOutUser` defaults to `local`.
   *
   * Signing out ends on the marketing site's `/login`, a different application
   * on a different origin — so `window.location.href`, not `router.push`, which
   * cannot leave this app and would have resolved `/login` to a 404 here.
   */
  const handleLogout = async () => {
    // Only to attribute the audit entry. If it fails, sign out anyway and
    // accept an unattributed exit — nobody may be trapped in a session they
    // asked to leave because a lookup failed.
    let user: { id: string; email?: string | null } | null = null
    try {
      user = (await supabase.auth.getUser()).data.user
    } catch (err) {
      logger.warn({ err }, 'Could not resolve user before sign-out (non-blocking)')
    }

    const result = await signOutUser({ scope: 'global', user, method: 'manual' })
    if (!result.ok) {
      // Already cleared locally by `signOutUser`; the redirect below still
      // takes them out. Logged so a failing server-side sign-out is visible.
      logger.error({ err: result.error }, 'Sign-out reported an error — leaving anyway')
    }

    window.location.href = marketingLoginUrl()
  }

  return (
    <button
      onClick={handleLogout}
      className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
    >
      Logout
    </button>
  )
}
