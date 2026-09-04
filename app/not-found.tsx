// app/not-found.tsx

import { PublicErrorScreen } from '@/components/public/PublicErrorScreen';
import { getRequestLocale } from '@/lib/i18n/requestLocale';

/**
 * The application had no root 404 at all, so every unmatched URL — including
 * every mistyped booking or invoice link — rendered the raw Next.js default.
 */
export default async function NotFound() {
  const locale = await getRequestLocale();
  return <PublicErrorScreen kind="not-found" locale={locale} />;
}
