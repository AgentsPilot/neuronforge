/**
 * The privacy notice, rendered on either public surface.
 *
 * One component behind two routes — `/site/[subdomain]/privacy` and
 * `/c/[userCode]/privacy` — because a business's notice must not differ
 * depending on which of its own addresses a visitor arrived at.
 *
 * Resolves the body in the order the settings describe: the owner's own text
 * where they have written one, otherwise the generated default. A business that
 * has switched the notice off does not reach here — the route 404s, so the
 * consent checkbox's missing link and this page's absence agree with each other.
 *
 * @module components/public/PrivacyPolicyPage
 */

import { PrivacyNotice } from '@/components/public/PrivacyNotice';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import type { PublicBrand } from '@/lib/branding/publicBranding';
import { generatePrivacyPolicy } from '@/lib/consent/privacyPolicy';
import type { MarketingConsentSettings } from '@/lib/repositories/MarketingConsentRepository';

interface Props {
  brand: PublicBrand;
  settings: MarketingConsentSettings | null;
}

export function PrivacyPolicyPage({ brand, settings }: Props) {
  const own = settings?.privacy_policy_body?.trim();

  const body =
    own ||
    generatePrivacyPolicy({
      businessName: brand.businessName,
      contactEmail: brand.info.email,
      postalAddress: settings?.postal_address ?? brand.info.address ?? null,
    });

  const updated = settings?.privacy_policy_updated_at;

  return (
    <main
      dir={brand.dir}
      className="min-h-screen px-4 py-10"
      style={{ background: 'var(--ap-bg)', color: 'var(--ap-text)' }}
    >
      <div className="mx-auto w-full max-w-[760px]">
        <PublicHeader brand={brand} />

        <article className="mt-8">
          <PrivacyNotice body={body} />

          {updated && (
            <p className="mt-8 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
              {new Intl.DateTimeFormat(brand.localeCode, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              }).format(new Date(updated))}
            </p>
          )}
        </article>

        {/* No privacy link: this IS the privacy notice. */}
        <PublicFooter brand={brand} showPrivacy={false} />
      </div>

      {/*
        Scoped to this page. The notice is long-form prose, which no other
        public surface renders, and the site templates style headings for
        marketing copy rather than for a document.

        Logical properties throughout: Hebrew is live, and a privacy notice
        that reads left-to-right for an Israeli business is a broken page.
      */}
      <style>{`
        .ap-privacy { line-height: 1.7; }
        .ap-privacy-h1 {
          font-size: 1.75rem; font-weight: 700; margin-block-end: 1.25rem;
        }
        .ap-privacy-h2 {
          font-size: 1.2rem; font-weight: 650;
          margin-block-start: 2rem; margin-block-end: 0.6rem;
        }
        .ap-privacy-h3 {
          font-size: 1rem; font-weight: 600;
          margin-block-start: 1.5rem; margin-block-end: 0.4rem;
        }
        .ap-privacy-p { margin-block-end: 0.9rem; }
        .ap-privacy-ul {
          margin-block-end: 1rem; padding-inline-start: 1.25rem; list-style: disc;
        }
        .ap-privacy-ul li { margin-block-end: 0.35rem; }
        .ap-privacy-hr {
          margin-block: 2rem; border: 0;
          border-block-start: 1px solid var(--ap-border, rgba(0,0,0,0.1));
        }
      `}</style>
    </main>
  );
}
