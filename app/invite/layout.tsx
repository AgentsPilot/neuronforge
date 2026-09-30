/**
 * The public invite page's segment layout (server component).
 *
 * Only metadata: `referrer: 'no-referrer'` as a `<meta>` on top of the
 * middleware's `Referrer-Policy` header (T-7), and no indexing, since every
 * address under this path belongs to one invitee.
 *
 * ── Slice 3b: Google Identity Services on this page (SA Q-1) ────────────────
 * "Continue with Google" loads `https://accounts.google.com/gsi/client` and
 * opens Google's popup. There is no Content-Security-Policy and no
 * Cross-Origin-Opener-Policy on this path today, so nothing needs changing.
 * If either is ever added:
 *   - a CSP must allow `https://accounts.google.com/gsi/` for `script-src`,
 *     `frame-src`, `connect-src` and `style-src`, or the button never draws;
 *   - a COOP must be `same-origin-allow-popups`, or the popup cannot hand the
 *     credential back and signing up with Google silently does nothing.
 * `referrer: 'no-referrer'` stays for now: whether Google's button works under
 * it is checked on localhost at 3b-10. SA pre-approved `strict-origin` for this
 * page if it does not (R-4); that change would be needed here AND in the
 * middleware's header for `/invite`.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Your invitation',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function InviteLayout({ children }: { children: ReactNode }) {
  return children;
}
