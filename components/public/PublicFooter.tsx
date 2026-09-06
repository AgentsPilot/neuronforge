// components/public/PublicFooter.tsx

import { publicT } from '@/lib/i18n/public-pages';
import type { PublicBrand } from '@/lib/branding/publicBranding';

interface PublicFooterProps {
  brand: PublicBrand;
  showPoweredBy?: boolean;
  showContact?: boolean;
}

/**
 * "Questions? Contact {name}" — but only when the client can actually act on it.
 *
 * That line existed in four copies and pointed nowhere: it told a client to get
 * in touch and gave them no way to. Where the business has a phone or an email
 * the name is now a link; where it has neither, the line still reassures
 * without pretending to be actionable.
 */
export function PublicFooter({
  brand,
  showPoweredBy = true,
  showContact = true,
}: PublicFooterProps) {
  const contactHref = brand.info.phone
    ? `tel:${brand.info.phone.replace(/\s/g, '')}`
    : brand.info.email
      ? `mailto:${brand.info.email}`
      : null;

  const message = publicT(brand.locale, 'questionsContact', { name: brand.businessName });

  return (
    <footer className="mt-8 text-center ap-no-print">
      {showContact && (
        <p className="text-sm" style={{ color: 'var(--ap-text-muted)' }}>
          {contactHref ? (
            <a href={contactHref} className="underline-offset-2 hover:underline">
              <bdi>{message}</bdi>
            </a>
          ) : (
            <bdi>{message}</bdi>
          )}
        </p>
      )}

      {showPoweredBy && (
        <p className="mt-3 text-xs" style={{ color: 'var(--ap-text-muted)', opacity: 0.75 }}>
          {publicT(brand.locale, 'poweredBy')}
        </p>
      )}
    </footer>
  );
}
