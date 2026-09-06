// components/public/PublicSpinner.tsx

import { Loader2 } from 'lucide-react';

const SIZES = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-9 w-9' } as const;

/**
 * One spinner, in the business's colour.
 *
 * There were three different spinners across the public pages — a bordered
 * div, a smaller bordered div, and a `Loader2` — in about eight copies, all of
 * them in platform grey or white on pages that were otherwise trying to be
 * branded.
 */
export function PublicSpinner({
  size = 'md',
  label,
}: {
  size?: keyof typeof SIZES;
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3" role="status">
      <Loader2
        className={`${SIZES[size]} animate-spin`}
        style={{ color: 'var(--ap-brand)' }}
        aria-hidden
      />
      {label && (
        <span className="text-sm" style={{ color: 'var(--ap-text-muted)' }}>
          {label}
        </span>
      )}
      <span className="sr-only">{label ?? 'Loading'}</span>
    </div>
  );
}

/** A full-height centred spinner, for a page that has nothing to show yet. */
export function PublicPageSpinner({ label }: { label?: string }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'var(--ap-bg)' }}
    >
      <PublicSpinner size="lg" label={label} />
    </div>
  );
}
