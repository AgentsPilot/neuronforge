// components/public/PublicErrorScreen.tsx

import { AlertTriangle, CheckCircle, LinkIcon, SearchX } from 'lucide-react';

import { publicT, toLocale } from '@/lib/i18n/public-pages';
import { getDirection, type Locale } from '@/lib/i18n/config';
// From `theme`, never `resolveTheme`: this component renders inside the client
// error boundaries, and `resolveTheme` reaches the service-role Supabase client.
import { DEFAULT_PUBLIC_THEME } from '@/lib/branding/theme';
import type { PublicBrand } from '@/lib/branding/publicBranding';

/** `outcome` is not a failure — it is the same full-page treatment, used for
 *  the generic post-payment confirmation, which has no business to be branded
 *  with either. */
type Kind = 'not-found' | 'expired' | 'error' | 'unavailable' | 'outcome';

interface PublicErrorScreenProps {
  /** Null when we could not work out which business the visitor wanted. */
  brand?: PublicBrand | null;
  kind: Kind;
  locale?: Locale;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
}

const KINDS: Record<Kind, { icon: typeof SearchX; titleKey: string; descKey: string }> = {
  'not-found': { icon: SearchX, titleKey: 'notFoundTitle', descKey: 'notFoundDesc' },
  expired: { icon: LinkIcon, titleKey: 'expiredTitle', descKey: 'expiredDesc' },
  error: { icon: AlertTriangle, titleKey: 'errorTitle', descKey: 'errorDesc' },
  unavailable: { icon: LinkIcon, titleKey: 'unavailableTitle', descKey: 'unavailableDesc' },
  outcome: { icon: CheckCircle, titleKey: 'paymentReceived', descKey: 'paymentReceivedDesc' },
};

/**
 * What a customer sees when the link they were given does not work.
 *
 * Every one of these paths used to be a dead end: `notFound()` rendered the
 * unstyled English Next.js 404, and an expired smart link silently redirected
 * to the platform's own B2B marketing homepage — so a client who clicked a
 * campaign link from their hairdresser landed on a page selling AI automation
 * software, with no explanation.
 *
 * Branded where the business is known (an expired link still identifies its
 * owner), neutral where it is not — a 404 means we could not find the business,
 * so there is no identity to wear, and inventing one would be worse.
 */
export function PublicErrorScreen({
  brand,
  kind,
  locale,
  title,
  description,
  actions,
}: PublicErrorScreenProps) {
  const resolved = brand?.locale ?? toLocale(locale);
  const dir = brand?.dir ?? getDirection(resolved);
  const theme = brand?.theme ?? DEFAULT_PUBLIC_THEME;
  const config = KINDS[kind];
  const Icon = config.icon;

  return (
    <div
      dir={dir}
      lang={resolved}
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{ background: theme.colors.background, color: theme.colors.text }}
    >
      <div className="w-full max-w-md text-center">
        {brand?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
          <img
            src={brand.logoUrl}
            alt={brand.businessName}
            className="mx-auto mb-6 h-12 w-auto object-contain"
          />
        )}

        <div
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center"
          style={{ background: `${theme.colors.primary}1a`, borderRadius: '9999px' }}
        >
          <Icon className="h-8 w-8" style={{ color: theme.colors.primary }} aria-hidden />
        </div>

        <h1 className="text-xl font-bold" style={{ color: theme.colors.text }}>
          {title ?? publicT(resolved, config.titleKey)}
        </h1>

        <p className="mt-2 text-sm" style={{ color: theme.colors.textSecondary }}>
          {description ?? publicT(resolved, config.descKey)}
        </p>

        {actions && <div className="mt-6 flex flex-col gap-2">{actions}</div>}
      </div>
    </div>
  );
}
