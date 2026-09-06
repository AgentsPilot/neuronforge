/**
 * The generic post-payment screen.
 *
 * `/payments/success` and `/payments/cancelled` were named as Stripe redirect
 * targets in two API routes and existed in neither — a customer who completed a
 * payment was returned to a 404.
 *
 * The redirect sources now prefer the branded invoice page wherever an invoice
 * is known, so these two are only reached when nothing identifies the customer.
 * They therefore carry no business identity, deliberately: guessing one on a
 * payment confirmation would be worse than showing none. They also cannot be
 * removed, because Stripe sessions created before this change still point here.
 */

import type { Metadata } from 'next';

import { PublicErrorScreen } from '@/components/public/PublicErrorScreen';
import { getRequestLocale } from '@/lib/i18n/requestLocale';

export const metadata: Metadata = {
  title: 'Payment received',
  robots: { index: false, follow: false },
};

export default async function PaymentSuccessPage() {
  const locale = await getRequestLocale();

  return <PublicErrorScreen kind="outcome" locale={locale} />;
}
