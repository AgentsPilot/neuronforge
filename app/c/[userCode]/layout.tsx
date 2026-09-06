// app/c/[userCode]/layout.tsx

import { PublicBrandProvider } from '@/components/public/PublicBrandProvider';
import { PublicDirScript } from '@/components/public/PublicDirScript';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';

/**
 * The branded frame for the smart-link pages.
 *
 * These are the pages a business hands out on WhatsApp, in a bio link, or on a
 * site it hosts elsewhere — often the only AgentPilot surface its clients ever
 * see. Both pages below used to inject their own font links and their own
 * `<style>` block, each with a slightly different copy of the same CSS and a
 * different default blue.
 *
 * Metadata stays on the individual pages: "Book with X" and "Contact X" are
 * different titles, and the pages already resolve their own data.
 */
export default async function SmartLinkLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ userCode: string }>;
}) {
  const { userCode } = await params;
  const brand = await resolvePublicBranding({ by: 'userCode', userCode });

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
