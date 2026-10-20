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
import { UpgradeModalProvider } from '@/components/business-os/settings/UpgradeModalProvider';
import { Space_Grotesk, Inter } from 'next/font/google';

import { readPlanBadge } from '@/lib/business-os/entitlements/readPlanBadge';
import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';
import { readInitialLanguage } from '@/lib/business-os/readInitialLanguage';
import { OwnerDirScript } from '@/components/business-os/OwnerDirScript';
import '@/lib/design-system-v2/v2-theme-tokens.css';
import { V2ThemeScript } from '@/lib/design-system-v2/V2ThemeScript';
import { V2CustomTokensStyle } from '@/lib/design-system-v2/V2CustomTokensStyle';
import { readV2CustomTokens } from '@/lib/design-system-v2/server/readV2CustomTokens';
import { readPaymentNotice } from '@/lib/business-os/billing/readPaymentNotice';
import { PlanPaymentBanner } from '@/components/business-os/billing/PlanPaymentBanner';

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
  // TH-1: the platform's custom design tokens, started here for the same
  // reason (overlap the hold). Global, not per-user, so starting it before the
  // hold decides leaks nothing; never rejects, and never waits more than its
  // deadline (readV2CustomTokens.ts), so it is safe to leave dangling.
  const customTokensPending = readV2CustomTokens();

  // Slice 5b (T-13 layer 2, F5b-4): the payment hold is the first AWAITED
  // statement. No plan read and no render happens before it decides. A friend
  // who has not paid never reaches Business OS. It keys on lineage, not on the
  // entitlements mode, so `shadow` cannot open it.
  await redirectIfAwaitingPayment();

  // Plan payments P-6a.2 (SA C-13): the owner's payment banner, read with the
  // pill and AFTER the hold (F5b-4). `readPaymentNotice` never rejects and makes
  // no query while the price switch is off.
  const [planBadge, initialLanguage, paymentNotice] = await Promise.all([
    readPlanBadge(),
    initialLanguagePending,
    readPaymentNotice(),
  ]);
  // Already in flight since before the hold: no extra round trip. `known` is
  // false only when a cold read missed its deadline; the provider then
  // corrects the page from the browser (TH-1, SA RC-16).
  const { tokens: customTokens, known: customTokensKnown } = await customTokensPending;

  return (
    <>
    {/* First, outside every provider, so they apply before any content is
        parsed: language and direction, the dark class, and the custom tokens
        (SA RC-2, TH-1). */}
    <OwnerDirScript language={initialLanguage.language} />
    <V2ThemeScript />
    <V2CustomTokensStyle tokens={customTokens} />
    <UserProvider>
      <V2ThemeProvider customTokens={customTokens} customTokensKnown={customTokensKnown}>
        <LanguageProvider initial={initialLanguage}>
          {/*
            Inside LanguageProvider, because the configuration dialog it holds is
            translated. Outside the sticky chrome below, because a modal rendered
            inside a `sticky` element inherits its stacking context and would be
            trapped under the page it is supposed to cover.
          */}
          <CapabilitiesProvider>
            <ConfigurationDialogProvider>
              {/*
                Upgrade modal UM-2: the plan comparison window, opened from any
                page with `useUpgradeModal()`. Here for the same two reasons as
                the configuration dialog (translated; outside the sticky chrome),
                and inside it so a caller in that dialog can reach both.
              */}
              <UpgradeModalProvider>
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
                  <PlanPaymentBanner notice={paymentNotice} />
                </div>
                {children}
              </div>
              </UpgradeModalProvider>
            </ConfigurationDialogProvider>
          </CapabilitiesProvider>
        </LanguageProvider>
      </V2ThemeProvider>
    </UserProvider>
    </>
  );
}
