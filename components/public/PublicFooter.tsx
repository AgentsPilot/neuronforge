// components/public/PublicFooter.tsx

import { publicT } from '@/lib/i18n/public-pages';
import type { PublicBrand } from '@/lib/branding/publicBranding';
import { resolvePrivacyPolicyUrl } from '@/lib/consent/privacyPolicyUrl';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';

interface PublicFooterProps {
  brand: PublicBrand;
  showPoweredBy?: boolean;
  showContact?: boolean;
  /**
   * Off for the privacy notice itself, which would otherwise link to the page
   * the reader is already on.
   */
  showPrivacy?: boolean;
}

/**
 * "Questions? Contact {name}" — but only when the client can actually act on it.
 *
 * That line existed in four copies and pointed nowhere: it told a client to get
 * in touch and gave them no way to. Where the business has a phone or an email
 * the name is now a link; where it has neither, the line still reassures
 * without pretending to be actionable.
 */
/*
 * Async, so the privacy link resolves here rather than in each of the pages
 * that render this. Every public surface needs the same link and none of them
 * had a reason to know how to build it; threading it through would have meant
 * the same two lines in five places, which is how the four copies of the
 * "Questions? Contact" line above came about in the first place.
 *
 * A server component throughout — no caller is a client component.
 */
export async function PublicFooter({
  brand,
  showPoweredBy = true,
  showContact = true,
  showPrivacy = true,
}: PublicFooterProps) {
  /*
   * Null is a real answer: a business may publish no notice at all. Failure is
   * also null, because a footer must never be the thing that breaks a booking
   * page.
   */
  let privacyPolicyUrl: string | null = null;

  if (showPrivacy) {
    try {
      const { data: settings } = await marketingConsentRepository.settings(brand.userId);
      privacyPolicyUrl = await resolvePrivacyPolicyUrl(brand.userId, settings, {
        user_code: brand.userCode,
      });
    } catch {
      privacyPolicyUrl = null;
    }
  }

  const contactHref = brand.info.phone
    ? `tel:${brand.info.phone.replace(/\s/g, '')}`
    : brand.info.email
      ? `mailto:${brand.info.email}`
      : null;

  const message = publicT(brand.locale, 'questionsContact', { name: brand.businessName });

  return (
    /*
      Not `apc-footer`.

      That class belongs to the website's FOOTER SECTION — the template's own
      closing band, which every composition gives a `border-block-start` because
      that is the design. This is a different thing wearing its name: the small
      "powered by" tail on a booking or invoice page. It inherited the rule and
      drew a second hairline a few rows under the one the details panel already
      had, which reads as a mistake rather than as structure.

      It loses nothing else by dropping the class — it sets its own muted
      colours inline, and `mt-8` gives it the space the composition's padding
      would have.
    */
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

      {/*
        A privacy notice reachable only from a consent checkbox is not really
        published.
      */}
      {privacyPolicyUrl && (
        <p className="mt-3 text-xs" style={{ color: 'var(--ap-text-muted)', opacity: 0.75 }}>
          <a href={privacyPolicyUrl} className="underline-offset-2 hover:underline">
            {publicT(brand.locale, 'privacyNotice')}
          </a>
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
