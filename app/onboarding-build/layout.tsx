import { V2ThemeProvider } from '@/lib/design-system-v2/theme-provider';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';
import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';
import { readInitialLanguage } from '@/lib/business-os/readInitialLanguage';
import { OwnerDirScript } from '@/components/business-os/OwnerDirScript';
import '@/lib/design-system-v2/v2-theme-tokens.css';
import { V2ThemeScript } from '@/lib/design-system-v2/V2ThemeScript';
import { V2CustomTokensStyle } from '@/lib/design-system-v2/V2CustomTokensStyle';
import { readV2CustomTokens } from '@/lib/design-system-v2/server/readV2CustomTokens';

// SA N-2: the payment hold reads the session on every request, so this segment
// is never prerendered (a static render would skip the gate, or swallow the
// dynamic-usage signal inside the gate's session read).
export const dynamic = 'force-dynamic';

/*
 * Slice 5b (SA R-1): the payment hold is the first AWAITED statement (only the
 * un-awaited BR-1a language read is started before it). This page writes a
 * COMPLETED business profile, after which middleware would let the account
 * into every signed-in page, so a held friend must never reach it. See
 * `paymentHoldGate.ts`.
 */
export default async function OnboardingBuildLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // BR-1a (SA ruling on RC-6b): STARTED before the payment hold so its round
  // trip overlaps the hold's lineage read rather than following it. Nothing
  // awaits or uses it until the gate has returned. Safe to leave dangling when
  // the gate redirects, because readInitialLanguage never rejects (its
  // contract, readInitialLanguage.test.ts).
  const initialLanguagePending = readInitialLanguage();
  // TH-1: the platform's custom design tokens, started here for the same
  // reason (overlap the hold). Global, not per-user, so starting it before the
  // hold decides leaks nothing; never rejects, and never waits more than its
  // deadline (readV2CustomTokens.ts), so it is safe to leave dangling.
  const customTokensPending = readV2CustomTokens();

  // The payment hold is the first AWAITED statement; nothing renders before it
  // decides.
  await redirectIfAwaitingPayment();

  const initialLanguage = await initialLanguagePending;
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
      <V2ThemeProvider customTokens={customTokens} customTokensKnown={customTokensKnown}>
        <LanguageProvider initial={initialLanguage}>
          {children}
        </LanguageProvider>
      </V2ThemeProvider>
    </>
  );
}
