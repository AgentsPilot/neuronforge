// app/consent/unsubscribe/[token]/layout.tsx

import { PublicBrandFrame } from '@/components/public/PublicBrandFrame';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { verifyUnsubscribeToken } from '@/lib/consent/unsubscribeToken';

/**
 * The branded frame for an unsubscribe.
 *
 * The same shape as the confirmation page beside it, and for the same reason:
 * this is a page a business hands to a client, and it has to wear their
 * template rather than the platform's default. Somebody leaving a list should
 * still be able to see whose list it was.
 *
 * Resolved in the LAYOUT so the theme is in the first byte of HTML. A page that
 * fetches its own brand paints once unstyled and then repaints, and a flash of
 * somebody else's design is wrong on any page whose job is to be recognised.
 */
export default async function UnsubscribeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = verifyUnsubscribeToken(token);

  /* A token we cannot read names no business, so there is nothing to dress the
     page in. The page itself explains what happened. */
  if (!payload) return <>{children}</>;

  const brand = await resolvePublicBranding({ by: 'userId', userId: payload.userId });

  return <PublicBrandFrame brand={brand}>{children}</PublicBrandFrame>;
}
