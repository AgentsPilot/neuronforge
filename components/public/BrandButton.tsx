// components/public/BrandButton.tsx

'use client';

import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface BrandButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  size?: Size;
  /** Renders an anchor instead of a button. */
  href?: string;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}

const SIZES: Record<Size, string> = {
  sm: 'text-sm px-3 py-2',
  md: 'text-sm px-4 py-3',
  lg: 'text-base px-6 py-3.5',
};

/**
 * The one button on the public pages.
 *
 * Every colour comes from the token layer, so a business's own palette is worn
 * without any component knowing a hex code. `--ap-on-brand` in particular is
 * doing real work: it is computed from the contrast against the brand colour,
 * where every one of these buttons previously hardcoded white text. On the
 * paler templates in the catalogue that was an unreadable button, and nothing
 * in the codebase was in a position to notice.
 */
export function BrandButton({
  variant = 'primary',
  size = 'md',
  href,
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...props
}: BrandButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold transition-colors duration-150 disabled:opacity-55 disabled:cursor-not-allowed';

  const style: React.CSSProperties = {
    borderRadius: 'var(--ap-radius-md)',
    ...(variant === 'primary'
      ? { background: 'var(--ap-brand)', color: 'var(--ap-on-brand)' }
      : variant === 'secondary'
        ? {
            background: 'var(--ap-brand-tint)',
            color: 'var(--ap-brand)',
            border: '1px solid var(--ap-brand-ring)',
          }
        : variant === 'danger'
          ? { background: '#DC2626', color: '#FFFFFF' }
          : { background: 'transparent', color: 'var(--ap-text-muted)' }),
  };

  const content = (
    <>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </>
  );

  const classes = `${base} ${SIZES[size]} ${fullWidth ? 'w-full' : ''} ${className}`;

  if (href && !disabled && !loading) {
    return (
      <a href={href} className={classes} style={style}>
        {content}
      </a>
    );
  }

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={classes}
      style={style}
      // A hover that reads on both a near-white and a near-black brand.
      onMouseEnter={e => {
        if (variant === 'primary' && !disabled && !loading) {
          e.currentTarget.style.background = 'var(--ap-brand-hover)';
        }
      }}
      onMouseLeave={e => {
        if (variant === 'primary') {
          e.currentTarget.style.background = 'var(--ap-brand)';
        }
      }}
    >
      {content}
    </button>
  );
}
