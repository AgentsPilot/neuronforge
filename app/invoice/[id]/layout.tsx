// app/invoice/[id]/layout.tsx

import { PublicBrandProvider } from '@/components/public/PublicBrandProvider';
import { PublicDirScript } from '@/components/public/PublicDirScript';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
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
