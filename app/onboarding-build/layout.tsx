import { V2ThemeProvider } from '@/lib/design-system-v2/theme-provider';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';
import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';

// SA N-2: the payment hold reads the session on every request, so this segment
// is never prerendered (a static render would skip the gate, or swallow the
// dynamic-usage signal inside the gate's session read).
export const dynamic = 'force-dynamic';

/*
 * Slice 5b (SA R-1): the payment hold runs FIRST. This page writes a
 * COMPLETED business profile, after which middleware would let the account
 * into every signed-in page, so a held friend must never reach it. See
 * `paymentHoldGate.ts`.
 */
export default async function OnboardingBuildLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await redirectIfAwaitingPayment();

  return (
    <V2ThemeProvider>
      <LanguageProvider>
        {children}
      </LanguageProvider>
    </V2ThemeProvider>
  );
}
