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
import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';
import { readInitialLanguage } from '@/lib/business-os/readInitialLanguage';
import { OwnerDirScript } from '@/components/business-os/OwnerDirScript';

// SA N-2: the payment hold reads the session on every request, so this segment
// is never prerendered (a static render would skip the gate, or swallow the
// dynamic-usage signal inside the gate's session read).
export const dynamic = 'force-dynamic';

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
  // BR-1a (SA ruling on RC-6b): STARTED before the payment hold so its round
  // trip overlaps the hold's lineage read rather than following it. Nothing
  // awaits or uses it until the gate has returned. Safe to leave dangling when
  // the gate redirects, because readInitialLanguage never rejects (its
  // contract, readInitialLanguage.test.ts). The plan read stays after the gate (F5b-4).
  const initialLanguagePending = readInitialLanguage();

  // Slice 5b (T-13 layer 2, F5b-4): the payment hold is the first AWAITED
  // statement. No plan read and no render happens before it decides. A friend
  // who has not paid never reaches Business OS. It keys on lineage, not on the
  // entitlements mode, so `shadow` cannot open it.
  await redirectIfAwaitingPayment();

  const [planBadge, initialLanguage] = await Promise.all([readPlanBadge(), initialLanguagePending]);

  return (
    <>
    {/* First, outside every provider: V2ThemeProvider renders nothing on the
        server, so a script inside it would never reach the HTML (SA RC-2). */}
    <OwnerDirScript language={initialLanguage.language} />
    <UserProvider>
      <V2ThemeProvider>
        <LanguageProvider initial={initialLanguage}>
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
    </>
  );
}
