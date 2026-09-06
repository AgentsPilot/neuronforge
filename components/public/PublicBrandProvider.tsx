// components/public/PublicBrandProvider.tsx

'use client';

import { createContext, useContext, useMemo } from 'react';

import { createPublicT } from '@/lib/i18n/public-pages';
import type { PublicBrand } from '@/lib/branding/publicBranding';

const BrandContext = createContext<PublicBrand | null>(null);

/**
 * Makes the resolved business available to the client components below it.
 *
 * The branding is resolved once, on the server, in the segment layout — so a
 * client page no longer renders an unbranded skeleton, fetches, and only then
 * learns what colour and language it should have been in all along. It also
 * means a client component can be branded without threading `primaryColor`
 * through five levels of props, which is how the manage pages ended up
 * decorating their entire UI with a value that turned out to be a constant.
 */
export function PublicBrandProvider({
  brand,
  children,
}: {
  brand: PublicBrand;
  children: React.ReactNode;
}) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

/** The business this page belongs to. Throws outside a provider. */
export function usePublicBrand(): PublicBrand {
  const brand = useContext(BrandContext);
  if (!brand) {
    throw new Error('usePublicBrand must be used inside a PublicBrandProvider');
  }
  return brand;
}

/** The business this page belongs to, or null when there is no provider. */
export function useOptionalPublicBrand(): PublicBrand | null {
  return useContext(BrandContext);
}

/** A translator bound to the business's language. */
export function usePublicT() {
  const brand = usePublicBrand();
  return useMemo(() => createPublicT(brand.locale), [brand.locale]);
}
