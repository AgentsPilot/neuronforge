/**
 * Business OS Layout - No sidebar, full-width design
 * Matches the onboarding chat style with V2 theme
 */
import { UserProvider } from '@/components/UserProvider';
import { V2ThemeProvider } from '@/lib/design-system-v2';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';
import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { BusinessOSTabs } from '@/components/business-os/BusinessOSTabs';
import { BUSINESS_OS_SCROLL_ID } from '@/lib/business-os/pageContainer';
import { ConfigurationDialogProvider } from '@/components/business-os/ConfigurationDialogProvider';
import { CapabilitiesProvider } from '@/components/business-os/CapabilitiesProvider';
import { UpgradeModalProvider } from '@/components/business-os/settings/UpgradeModalProvider';
import localFont from 'next/font/local';

import { readPlanBadge } from '@/lib/business-os/entitlements/readPlanBadge';
import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';
import { readInitialLanguage } from '@/lib/business-os/readInitialLanguage';
import { readOwnerIdentity } from '@/lib/business-os/readOwnerIdentity';
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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * READ FROM DISK, NOT DOWNLOADED WHILE BUILDING.
 *
 * This file is the one `next/font` named when it brought down the deploy on
 * 2026-11-06 — see the long note in `app/layout.tsx` for the error and why its
 * message points at nothing. Both faces are now vendored under `app/fonts`, so
 * the build reads two files instead of asking Google for them.
 *
 * These are the VARIABLE releases, one file per family covering the whole
 * weight axis, which is why the discrete `weight: ['500','600','700']` lists
 * are gone and a range stands in their place. Each range is what the file
 * carries, not what this layout happens to use today: Space Grotesk is drawn
 * 300-700, Inter 100-900. Naming the range rather than the subset means a
 * heading that later asks for 400 gets a real 400 instead of a browser
 * synthesising one.
 *
 * The variable names are unchanged on purpose — `--font-display` and
 * `--font-body` are referenced across the Business OS stylesheets, and this
 * change is meant to be invisible on screen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Space Grotesk for display text (headlines)
const spaceGrotesk = localFont({
  src: '../fonts/SpaceGrotesk-Variable-latin.woff2',
  weight: '300 700',
  style: 'normal',
  variable: '--font-display',
  display: 'swap',
});

// Inter for body text
const inter = localFont({
  src: '../fonts/Inter-Variable-latin.woff2',
  weight: '100 900',
  style: 'normal',
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
  // The header's identity chip (the owner's initials, in place of the settings
  // gear). Read here with the pill and AFTER the hold, for the same reasons:
  // the name lives in `profiles`, which only a repository may read, and the
  // header is a client component. Never rejects; `null` keeps the gear.
  const [planBadge, initialLanguage, paymentNotice, ownerIdentity] = await Promise.all([
    readPlanBadge(),
    initialLanguagePending,
    readPaymentNotice(),
    readOwnerIdentity(),
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
              {/*
                A COLUMN THE HEIGHT OF THE WINDOW, WITH ONE SCROLLING PART.
                ─────────────────────────────────────────────────────────────
                The document used to scroll and the chrome was held in place
                with `position: sticky`. That puts the scrollbar beside the
                header: the track runs from the very top of the window, past a
                header that never moves, so the thumb describes a page taller
                than the part anyone can actually scroll.

                The chrome is outside the scrolling element now, so the track
                begins under the tabs — beside the only thing that moves.

                `100dvh`, not `100vh`: on a phone `vh` is the viewport with the
                address bar collapsed, which is taller than what you can see,
                and the bottom of the page would sit under the browser chrome
                with nothing able to bring it back.
              */}
              <div
                className={`flex h-[100dvh] w-full flex-col overflow-hidden ${spaceGrotesk.variable} ${inter.variable}`}
              >
                {/*
                  The chrome lives here, not in each page.

                  Both were per-page before — six copies of <BusinessOSHeader />,
                  seven counting the one settings renders in its loading branch —
                  and navigation that every page has to remember to import is
                  navigation that will eventually go missing from one.

                  Wrapped together in one block above the scrolling body. They
                  were held in place with `position: sticky` while the document
                  scrolled underneath — which works, and puts the scrollbar
                  beside them. Out of the scroller entirely, they simply do not
                  move, and nobody has to hardcode the header's height into an
                  offset.
                */}
                {/* `shrink-0` so a long page cannot squeeze the chrome, and
                    `relative z-50` so the header's own menus still sit over the
                    body — `sticky` is gone, because nothing is scrolling past
                    this any more. */}
                <div className="relative z-50 shrink-0">
                  <BusinessOSHeader planBadge={planBadge} ownerInitials={ownerIdentity?.initials ?? null} />
                  <BusinessOSTabs />
                  <PlanPaymentBanner notice={paymentNotice} />
                </div>

                <div id={BUSINESS_OS_SCROLL_ID} className="flex-1 overflow-y-auto">
                  {children}
                </div>
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
