// app/consent/confirm/[token]/layout.tsx

import { PublicBrandProvider } from '@/components/public/PublicBrandProvider';
import { PublicDirScript } from '@/components/public/PublicDirScript';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { verifyConsentConfirmToken } from '@/lib/consent/confirmToken';

/**
 * The branded frame for a subscription confirmation.
 *
 * Same shape as the quote, the invoice and the booking-management pages,
 * because it is the same kind of surface: a page a business hands to a client,
 * often the second thing they have ever seen from that business. It has to wear
 * their template, not the platform's default — `PublicThemeStyle` emits the
 * composition along with the colours, so this one act gives the page both.
 *
 * Resolved in the LAYOUT, not the page. The theme has to be in the first byte
 * of HTML: a page that fetches its own brand paints once unstyled and then
 * repaints, and a flash of somebody else's design is exactly wrong on a screen
 * whose entire job is to be recognised as coming from this business.
 *
 * The token is read here as well as in the page. That is two verifications of
 * the same string, and it is the cheap half — no database, no consent written,
 * just the signature and the user id it names. The alternative is threading a
 * resolved brand from layout to page, which Next does not offer.
 */
export default async function ConsentConfirmLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const verdict = verifyConsentConfirmToken(token);

  /*
   * An expired or forged token still has to render — the page explains what
   * happened. It does so unbranded, which is correct rather than a shortfall:
   * a token we cannot read names no business, and guessing at one would mean
   * dressing an unverified page in somebody's identity.
   */
  if (!verdict.ok) return <>{children}</>;

  const brand = await resolvePublicBranding({ by: 'userId', userId: verdict.payload.u });
  if (!brand) return <>{children}</>;

  return (
    <>
      <PublicDirScript brand={brand} />
      <PublicFontLinks brand={brand} />
      <PublicThemeStyle brand={brand} />
      <PublicBrandProvider brand={brand}>{children}</PublicBrandProvider>
    </>
  );
}
