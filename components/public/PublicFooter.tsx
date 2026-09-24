// components/public/PublicFooter.tsx

import { publicT } from '@/lib/i18n/public-pages';
import type { PublicBrand } from '@/lib/branding/publicBranding';

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
 * ─────────────────────────────────────────────────────────────────────────────
 * PRESENTATIONAL, AND NOT ASYNC. BOTH DELIBERATE.
 *
 * This used to resolve the privacy link itself, which made it an async SERVER
 * component — and its own comment claimed "no caller is a client component".
 * That stopped being true: `PublicShell` renders this, and five `'use client'`
 * pages render `PublicShell` (the booking-management screens and the proposal
 * page). The fetch dragged `MarketingConsentRepository`, and through it
 * `lib/supabaseServer`, into the BROWSER bundle — where it builds its client at
 * module load from a service-role key that is deliberately not there. Every
 * public page died on hydration with "supabaseKey is required".
 *
 * The link now arrives on `brand`, resolved once per request with the rest of
 * branding. That keeps the "resolve it in one place" intent this component was
 * reaching for, without a component that renders in a client tree needing to
 * reach a database to do it.
 *
 * Keep it free of server imports. Anything it imports, every public page ships.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PublicFooter({
  brand,
  showPoweredBy = true,
  showContact = true,
  showPrivacy = true,
}: PublicFooterProps) {
  /*
   * Null is a real answer: a business may publish no notice at all, and the
   * resolver answers null on failure too — a footer must never be the thing
   * that breaks a booking page.
   */
  const privacyPolicyUrl = showPrivacy ? brand.privacyPolicyUrl : null;

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
