// app/book/manage/[token]/layout.tsx

import type { Metadata } from 'next';

import { PublicBrandProvider } from '@/components/public/PublicBrandProvider';
import { PublicDirScript } from '@/components/public/PublicDirScript';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { publicT } from '@/lib/i18n/public-pages';

/**
 * The branded frame for every booking-management page.
 *
 * WHY THE BRANDING IS RESOLVED HERE AND NOT IN THE PAGES
 *
 * All four pages below are client components that fetched the booking and only
 * then learned the business's colour and language. So every one of them painted
 * an unbranded grey skeleton first, in the wrong direction, and snapped into
 * place a moment later — and the cancel page, which never read the language at
 * all, simply stayed in English LTR for Hebrew clients.
 *
 * Resolving from the token on the server means the page arrives already in the
 * right colours and the right direction, and no page has to remember to set
 * `dir` for itself.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const brand = await resolvePublicBranding({ by: 'bookingToken', token }, { includeInfo: false });

  return {
    title: brand
      ? `${publicT(brand.locale, 'manageBooking')} · ${brand.businessName}`
      : 'Booking',
    // A booking link identifies a real person's appointment. It must never
    // reach a search index.
    robots: { index: false, follow: false },
  };
}

export default async function BookingManageLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const brand = await resolvePublicBranding({ by: 'bookingToken', token });

  // An invalid or expired token still has to render something. The page below
  // does its own verification and shows the branded "link expired" state, so
  // this just gets out of the way rather than throwing.
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
