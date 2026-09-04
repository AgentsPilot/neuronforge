// components/public/PublicShell.tsx

import { PublicHeader } from '@/components/public/PublicHeader';
import { PublicFooter } from '@/components/public/PublicFooter';
import type { PublicBrand } from '@/lib/branding/publicBranding';

const WIDTHS = {
  narrow: 'max-w-lg',
  default: 'max-w-2xl',
  wide: 'max-w-4xl',
} as const;

interface PublicShellProps {
  brand: PublicBrand;
  children: React.ReactNode;
  width?: keyof typeof WIDTHS;
  header?:
    | false
    | { title?: string; subtitle?: string; backHref?: string; backLabel?: string; compact?: boolean };
  footer?: false | { showPoweredBy?: boolean; showContact?: boolean };
}

/**
 * The page frame every public surface shares.
 *
 * Before this, each page re-declared the same `min-h-screen bg-gray-50` →
 * `max-w-lg mx-auto` → logo header → white card → footer, and they had drifted:
 * two default blues, `rounded-2xl` on one family and `rounded-lg` on another,
 * `gray-*` on the booking pages and `slate-*` on the invoice. A client who
 * booked, then managed, then paid saw what looked like three different
 * companies' software.
 *
 * `dir` is set here as well as on the document, so the server-rendered markup
 * is correct for crawlers and for the moment before the dir script runs.
 */
export function PublicShell({
  brand,
  children,
  width = 'default',
  header,
  footer,
}: PublicShellProps) {
  return (
    <div
      dir={brand.dir}
      lang={brand.locale}
      className="min-h-screen px-4 py-8"
      style={{ background: 'var(--ap-bg)', color: 'var(--ap-text)' }}
    >
      <div className={`mx-auto ${WIDTHS[width]}`}>
        {header !== false && <PublicHeader brand={brand} {...(header ?? {})} />}
        <main>{children}</main>
        {footer !== false && <PublicFooter brand={brand} {...(footer ?? {})} />}
      </div>
    </div>
  );
}
