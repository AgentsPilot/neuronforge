import { V2ThemeProvider } from '@/lib/design-system-v2/theme-provider';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';
import { redirectIfAwaitingPayment } from '@/lib/business-os/invites/paymentHoldGate';

// SA N-2: the payment hold reads the session on every request, so this segment
// is never prerendered (a static render would skip the gate, or swallow the
// dynamic-usage signal inside the gate's session read).
export const dynamic = 'force-dynamic';

/*
 * Slice 5b (T-13 layer 2, F5b-4): the payment hold runs FIRST. An account
 * created from a friend invite that has not paid is sent to the holding
 * screen and never reaches this segment. See `paymentHoldGate.ts`.
 */
export default async function OnboardingChatLayout({
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
