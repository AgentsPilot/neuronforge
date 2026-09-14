// app/proposal/[token]/layout.tsx

import { PublicBrandProvider } from '@/components/public/PublicBrandProvider';
import { PublicDirScript } from '@/components/public/PublicDirScript';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';

/**
 * The branded frame for a public quote.
 *
 * Every other public surface has one of these, and this page shipped without
 * it — so `PublicShell`'s `var(--ap-bg)` and `var(--ap-text)` resolved to
 * nothing and the page rendered on a bare white ground in default type, next to
 * an invoice and a booking page that both carried the business's own colours.
 *
 * Resolved in the LAYOUT, not the page: the theme has to be in the first byte
 * of HTML. A page that fetches its own brand paints once unstyled and then
 * repaints, and this is the screen where a business is asking to be trusted
 * with a five-figure number.
 */
export default async function ProposalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const brand = await resolvePublicBranding({ by: 'proposalToken', token });

  // An invalid or expired token still has to render — the page's own terminal
  // states explain what happened. It just does so unbranded, which is correct:
  // there is no business to brand it as.
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
