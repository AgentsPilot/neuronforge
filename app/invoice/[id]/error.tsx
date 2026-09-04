// app/invoice/[id]/error.tsx

'use client';

import { useEffect } from 'react';

import { BrandButton } from '@/components/public/BrandButton';
import { PublicErrorScreen } from '@/components/public/PublicErrorScreen';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { publicT, toLocale } from '@/lib/i18n/public-pages';

/**
 * A runtime failure on a page whose branding already resolved.
 *
 * Unlike `not-found`, this boundary sits INSIDE the segment layout, so the
 * business is known and the error screen can wear its identity — the client
 * sees their hairdresser's colours and their own language, not a stack trace on
 * a white page.
 */
export default function InvoiceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const brand = useOptionalPublicBrand();
  const locale = toLocale(brand?.locale);

  useEffect(() => {
    // The boundary is a client component, so this is the browser console rather
    // than a logging path — the server has already recorded the throw.
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <PublicErrorScreen
      brand={brand}
      kind="error"
      locale={locale}
      actions={
        <BrandButton onClick={reset} size="lg" fullWidth>
          {publicT(locale, 'tryAgain')}
        </BrandButton>
      }
    />
  );
}
