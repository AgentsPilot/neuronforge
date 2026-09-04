/**
 * What a client sees when their booking link arrived truncated.
 *
 * Two things were wrong with this page. It was unreachable — `/book` (no
 * trailing slash) missed the middleware's public bypass and was redirected to
 * `/v2/book`, which does not exist, so the fallback for a broken link was
 * itself a 404. And its only call to action was "Go to Homepage", which sends
 * somebody trying to book a haircut to a B2B page selling AI automation
 * software.
 *
 * There is no identifier in this URL, so no business can be named here. What it
 * can do is tell the client where the working link actually is: their
 * confirmation email.
 */

import { Metadata } from 'next';

import { PublicErrorScreen } from '@/components/public/PublicErrorScreen';
import { getRequestLocale } from '@/lib/i18n/requestLocale';

export const metadata: Metadata = {
  title: 'Booking',
  description: 'Book an appointment',
  robots: { index: false, follow: false },
};

export default async function BookingRootPage() {
  const locale = await getRequestLocale();
  return <PublicErrorScreen kind="unavailable" locale={locale} />;
}
