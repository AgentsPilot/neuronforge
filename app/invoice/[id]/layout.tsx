// app/invoice/[id]/layout.tsx

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER CACHED, NEVER SHARED.
 *
 * Today this is safe by accident: the credential sits in the path, so every
 * client's URL is unique and nothing can serve one client's booking to
 * another even if something decided to cache it.
 *
 * That accident ends the moment the token moves into a cookie and the address
 * becomes a plain booking id — one URL rendering different content per caller
 * is exactly the shape a CDN, a proxy, or a Next.js caching default will
 * happily share between two people. A mistake here is a cross-client data
 * leak, which is strictly worse than the address-bar leak the cookie exists to
 * close.
 *
 * So this is declared BEFORE the cookie work, not after, and
 * `publicPagesAreNeverCached.guard` holds it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

import { PublicBrandFrame } from '@/components/public/PublicBrandFrame';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';

/**
 * The branded frame for a public invoice.
 *
 * The invoice page was the only public surface that read no brand colour at
 * all — logo and business name, then a hardcoded `bg-blue-600` pay button and a
 * `slate` palette shared with nothing else in the product. It is also the page
 * where the business is most obviously asking to be trusted, which makes it the
 * worst one to look unrelated to everything else the client has seen.
 *
 * The page keeps its own `generateMetadata` (it names the invoice number) and
 * sets `robots: noindex` there.
 */
export default async function InvoiceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brand = await resolvePublicBranding({ by: 'invoiceId', invoiceId: id });


  return <PublicBrandFrame brand={brand}>{children}</PublicBrandFrame>;
}
