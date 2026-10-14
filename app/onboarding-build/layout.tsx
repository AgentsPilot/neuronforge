import { V2ThemeProvider } from '@/lib/design-system-v2/theme-provider';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';
import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';
import { readInitialLanguage } from '@/lib/business-os/readInitialLanguage';
import { OwnerDirScript } from '@/components/business-os/OwnerDirScript';

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

  // The payment hold is the first AWAITED statement; nothing renders before it
  // decides.
  await redirectIfAwaitingPayment();

  const initialLanguage = await initialLanguagePending;

  return (
    <>
      {/* Outside V2ThemeProvider, which renders nothing on the server (SA RC-2). */}
      <OwnerDirScript language={initialLanguage.language} />
      <V2ThemeProvider>
        <LanguageProvider initial={initialLanguage}>
          {children}
        </LanguageProvider>
      </V2ThemeProvider>
    </>
  );
}
