/**
 * Where a smart link goes when it cannot go anywhere.
 *
 * All four failure paths in `/go/[code]` used to redirect to `/`, silently. A
 * client who clicked a campaign link from their hairdresser landed on a B2B
 * marketing page selling AI automation software, with no indication that
 * anything had gone wrong or that they were even in the wrong place.
 *
 * The segment name is eight characters, well outside the `^[a-z0-9]{6,10}$`
 * code pattern's alphabet — `unavailable` contains no digits but more
 * importantly is 11 characters, so it can never shadow a real short code.
 *
 * Where the link was merely turned off we still know whose it was, so this
 * renders fully branded and offers the business's links that DO work — which is
 * the difference between a dead end and a detour.
 */

import type { Metadata } from 'next';

import { BrandButton } from '@/components/public/BrandButton';
import { PublicDirScript } from '@/components/public/PublicDirScript';
import { PublicErrorScreen } from '@/components/public/PublicErrorScreen';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { publicT } from '@/lib/i18n/public-pages';
import { getRequestLocale } from '@/lib/i18n/requestLocale';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ reason?: string; u?: string }>;
}

export default async function SmartLinkUnavailablePage({ searchParams }: PageProps) {
  const { reason, u: userCode } = await searchParams;

  const brand = userCode ? await resolvePublicBranding({ by: 'userCode', userCode }) : null;
  const locale = brand?.locale ?? (await getRequestLocale());

  // "Turned off" and "never existed" are different things to be told.
  const kind = reason === 'inactive' ? 'expired' : 'not-found';

  return (
    <>
      {brand && (
        <>
          <PublicDirScript brand={brand} />
          <PublicThemeStyle brand={brand} />
        </>
      )}

      <PublicErrorScreen
        brand={brand}
        kind={kind}
        locale={locale}
        actions={
          brand?.info.bookingUrl ? (
            <>
              <BrandButton href={brand.info.bookingUrl} size="lg" fullWidth>
                {publicT(locale, 'bookWith')} {brand.businessName}
              </BrandButton>
              {brand.userCode && (
                <BrandButton href={`/c/${brand.userCode}/contact`} variant="secondary" fullWidth>
                  {publicT(locale, 'getInTouch')}
                </BrandButton>
              )}
            </>
          ) : undefined
        }
      />
    </>
  );
}
