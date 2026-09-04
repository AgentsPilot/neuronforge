// components/public/PublicHeader.tsx

import { ArrowLeft, ArrowRight } from 'lucide-react';

import { brandGradient } from '@/lib/branding/color';
import type { PublicBrand } from '@/lib/branding/publicBranding';

interface PublicHeaderProps {
  brand: PublicBrand;
  /**
   * A connector placed BEFORE the business name — "Book with", "Contact".
   *
   * Deliberately not a free-form title: the heading is always the business's
   * name, because that is whose page this is. A prop that simply prefixed
   * whatever it was given produced "Manage Your Booking Ruth's Clinic" on the
   * pages whose context is not a connector; those pass `subtitle` instead.
   */
  prefix?: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  /** A tight header for pages whose content is the point. */
  compact?: boolean;
}

/**
 * The business's mark, at the top of every public page.
 *
 * Six near-identical copies of this existed, in two different alignments and
 * with two different default blues. The one behaviour worth calling out is the
 * monogram: when a business has no logo — which is most of them, since the only
 * upload point is an optional step of the website wizard — this draws its
 * initial in the brand colour rather than rendering an `<img>` with an empty
 * src, which is what the manage pages did.
 */
export function PublicHeader({
  brand,
  prefix,
  subtitle,
  backHref,
  backLabel,
  compact = false,
}: PublicHeaderProps) {
  const BackArrow = brand.dir === 'rtl' ? ArrowRight : ArrowLeft;
  const initial = brand.businessName.trim().charAt(0).toUpperCase() || '•';

  return (
    <header
      className={compact ? 'mb-5' : 'mb-8'}
      style={{
        background: compact
          ? 'transparent'
          : brandGradient(brand.theme.colors.primary, brand.theme.colors.secondary, 'subtle'),
        borderRadius: compact ? undefined : 'var(--ap-radius-lg)',
        padding: compact ? undefined : 'var(--ap-space-6) var(--ap-space-4)',
      }}
    >
      {backHref && (
        <a
          href={backHref}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-70"
          style={{ color: 'var(--ap-text-muted)' }}
        >
          <BackArrow className="h-4 w-4" aria-hidden />
          {backLabel}
        </a>
      )}

      <div className="flex flex-col items-center text-center">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a business logo is an
          // arbitrary remote URL; `next/image` would need every customer's host allow-listed.
          <img
            src={brand.logoUrl}
            alt={brand.businessName}
            className="mb-3 h-14 w-auto object-contain"
          />
        ) : (
          <div
            aria-hidden
            className="mb-3 flex h-14 w-14 items-center justify-center text-xl font-bold"
            style={{
              background: 'var(--ap-brand)',
              color: 'var(--ap-on-brand)',
              borderRadius: 'var(--ap-radius-lg)',
            }}
          >
            {initial}
          </div>
        )}

        <h1
          className={`font-bold ${compact ? 'text-xl' : 'text-2xl'}`}
          style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
        >
          {prefix ? (
            <>
              {prefix} <bdi>{brand.businessName}</bdi>
            </>
          ) : (
            <bdi>{brand.businessName}</bdi>
          )}
        </h1>

        {subtitle && (
          <p className="mt-1.5 text-sm" style={{ color: 'var(--ap-text-muted)' }}>
            {subtitle}
          </p>
        )}
      </div>
    </header>
  );
}
