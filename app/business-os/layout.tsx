/**
 * Business OS Layout - No sidebar, full-width design
 * Matches the onboarding chat style with V2 theme
 */
import { UserProvider } from '@/components/UserProvider';
import { V2ThemeProvider } from '@/lib/design-system-v2';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { BusinessOSTabs } from '@/components/business-os/BusinessOSTabs';
import { ConfigurationDialogProvider } from '@/components/business-os/ConfigurationDialogProvider';
import { CapabilitiesProvider } from '@/components/business-os/CapabilitiesProvider';
import { Space_Grotesk, Inter } from 'next/font/google';

import { readPlanBadge } from '@/lib/business-os/entitlements/readPlanBadge';

// Load Space Grotesk for display text (headlines)
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

// Load Inter for body text
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

/*
 * The plan pill is read HERE, with the page.
 *
 * This layout is a server component, so the answer comes with the render rather
 * than from a `fetch` in the browser on every screen. The sibling
 * `CapabilitiesProvider` is a client provider because its data changes while
 * somebody is using the product (publish a service and a tab appears); a plan does
 * not change under you, so it needs no refresh hook — and one fewer request per
 * full load is worth the directness.
 *
 * The read itself lives in `lib/business-os/entitlements/readPlanBadge.ts`, not
 * here: as a private function in this file its three safety guarantees could not
 * be tested without rendering a layout, and two mutations to them passed a green
 * suite (QA-10). Every failure returns `null`, and `null` renders nothing.
 */

export default async function BusinessOSLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const planBadge = await readPlanBadge();

  return (
    <UserProvider>
      <V2ThemeProvider>
        <LanguageProvider>
          {/*
            Inside LanguageProvider, because the configuration dialog it holds is
            translated. Outside the sticky chrome below, because a modal rendered
            inside a `sticky` element inherits its stacking context and would be
            trapped under the page it is supposed to cover.
          */}
          <CapabilitiesProvider>
            <ConfigurationDialogProvider>
              <div className={`w-full h-full ${spaceGrotesk.variable} ${inter.variable}`}>
                {/*
                  The chrome lives here, not in each page.

                  Both were per-page before — six copies of <BusinessOSHeader />,
                  seven counting the one settings renders in its loading branch —
                  and navigation that every page has to remember to import is
                  navigation that will eventually go missing from one.

                  Wrapped in a single sticky container rather than sticking each
                  separately: the header already carried `sticky top-0`, and the
                  tabs have to sit BELOW it while scrolling. One wrapper does that
                  without anybody hardcoding the header's height into an offset.
                */}
                <div className="sticky top-0 z-50">
                  <BusinessOSHeader planBadge={planBadge} />
                  <BusinessOSTabs />
                </div>
                {children}
              </div>
            </ConfigurationDialogProvider>
          </CapabilitiesProvider>
        </LanguageProvider>
      </V2ThemeProvider>
    </UserProvider>
  );
}
