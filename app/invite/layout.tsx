/**
 * The public invite page's segment layout (server component).
 *
 * Only metadata: `referrer: 'no-referrer'` as a `<meta>` on top of the
 * middleware's `Referrer-Policy` header (T-7), and no indexing, since every
 * address under this path belongs to one invitee.
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
