// app/invoice/not-found.tsx

import { PublicErrorScreen } from '@/components/public/PublicErrorScreen';
import { getRequestLocale } from '@/lib/i18n/requestLocale';

/**
 * Deliberately unbranded.
 *
 * `not-found.tsx` receives no route params, so there is genuinely no way to
 * know which business the visitor was trying to reach — a 404 here means we
 * could not find them. Inventing an identity would be worse than wearing none,
 * so this is neutral, and only the language follows the visitor.
 */
export default async function NotFound() {
  const locale = await getRequestLocale();
  return <PublicErrorScreen kind="not-found" locale={locale} />;
}
