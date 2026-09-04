/**
 * The generic cancelled-payment screen. See the note in `../success/page.tsx`
 * for why these two exist and why they carry no business identity.
 */

import type { Metadata } from 'next';

import { PublicErrorScreen } from '@/components/public/PublicErrorScreen';
import { publicT } from '@/lib/i18n/public-pages';
import { getRequestLocale } from '@/lib/i18n/requestLocale';

export const metadata: Metadata = {
  title: 'Payment cancelled',
  robots: { index: false, follow: false },
};

export default async function PaymentCancelledPage() {
  const locale = await getRequestLocale();

  return (
    <PublicErrorScreen
      kind="unavailable"
      locale={locale}
      title={publicT(locale, 'paymentCancelled')}
      description={publicT(locale, 'paymentCancelledDesc')}
    />
  );
}
