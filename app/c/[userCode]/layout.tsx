// app/c/[userCode]/layout.tsx

import { PublicBrandProvider } from '@/components/public/PublicBrandProvider';
import { PublicDirScript } from '@/components/public/PublicDirScript';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SmartLinkLayout' });

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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * CAUGHT, BECAUSE A THROW HERE HAS NOWHERE TO GO.
   *
   * This layout resolves branding from the database before the page below it
   * renders. An uncaught failure — a dropped connection, a timeout, a row that
   * vanished mid-request — lands after the response shell is flushed, and there
   * is no render pass left to route it into `error.tsx`. Next defers its own
   * boundary onto a timer, and that boundary calls `usePathname` from the timer
   * callback, where React's dispatcher is null:
   *
   *   Warning: Invalid hook call...
   *   TypeError: Cannot read properties of null (reading 'useContext')
   *     at usePathname → at ErrorBoundary → at Timeout._onTimeout
   *
   * Both lines describe the BOUNDARY failing, not the original fault, so the
   * real error is lost entirely. That is what made this page undiagnosable from
   * its logs: every report showed the same secondary crash.
   *
   * Unbranded children are the right fallback. The pages below each resolve
   * their own branding and render their own error screen, so losing the frame
   * costs styling, not function — and a smart link that loads plain beats one
   * that 500s.
   */
  let brand: Awaited<ReturnType<typeof resolvePublicBranding>> | null = null;

  try {
    brand = await resolvePublicBranding({ by: 'userCode', userCode });
  } catch (error) {
    logger.error({ err: error, userCode }, 'Failed to resolve smart-link branding');
  }

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
