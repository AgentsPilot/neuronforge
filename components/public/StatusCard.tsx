// components/public/StatusCard.tsx

import { AlertTriangle, CheckCircle, Info, X, type LucideIcon } from 'lucide-react';

type Tone = 'success' | 'error' | 'warning' | 'info' | 'neutral';

interface StatusCardProps {
  tone: Tone;
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** A full-page centred treatment, for terminal states. */
  standalone?: boolean;
}

/**
 * Semantic, not branded, on purpose.
 *
 * "Cancelled" must read as cancelled and "paid" must read as paid regardless of
 * what colour the business chose — a green brand rendering its own error state
 * in green is a status nobody can read. So these four tones are fixed and the
 * business's colour appears elsewhere on the page.
 *
 * Replaces the four copies of the red error card, the three of the green
 * success card, and the five terminal states the intake page had inlined.
 */
const TONES: Record<Tone, { bg: string; fg: string; icon: LucideIcon }> = {
  success: { bg: '#DCFCE7', fg: '#15803D', icon: CheckCircle },
  error: { bg: '#FEE2E2', fg: '#B91C1C', icon: X },
  warning: { bg: '#FEF3C7', fg: '#B45309', icon: AlertTriangle },
  info: { bg: '#DBEAFE', fg: '#1D4ED8', icon: Info },
  neutral: { bg: 'var(--ap-brand-tint)', fg: 'var(--ap-brand)', icon: Info },
};

export function StatusCard({
  tone,
  icon,
  title,
  description,
  actions,
  children,
  standalone = false,
}: StatusCardProps) {
  const palette = TONES[tone];
  const Icon = icon ?? palette.icon;

  const body = (
    <div
      className={standalone ? 'p-8 text-center' : 'p-5'}
      style={{
        background: 'var(--ap-surface)',
        border: '1px solid var(--ap-border)',
        borderRadius: 'var(--ap-radius-lg)',
        boxShadow: standalone ? 'var(--ap-shadow-md)' : 'var(--ap-shadow-sm)',
      }}
    >
      <div className={standalone ? 'flex flex-col items-center' : 'flex items-start gap-3'}>
        <div
          className={`flex shrink-0 items-center justify-center ${standalone ? 'mb-4 h-16 w-16' : 'h-9 w-9'}`}
          style={{ background: palette.bg, borderRadius: '9999px' }}
        >
          <Icon
            className={standalone ? 'h-8 w-8' : 'h-5 w-5'}
            style={{ color: palette.fg }}
            aria-hidden
          />
        </div>

        <div className={standalone ? '' : 'min-w-0 flex-1'}>
          <h2
            className={standalone ? 'text-xl font-bold' : 'text-sm font-semibold'}
            style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
          >
            {title}
          </h2>
          {description && (
            <p
              className={`${standalone ? 'mt-2 text-sm' : 'mt-1 text-sm'}`}
              style={{ color: 'var(--ap-text-muted)' }}
            >
              {description}
            </p>
          )}
          {children && <div className="mt-4">{children}</div>}
          {actions && (
            <div className={`mt-5 flex flex-col gap-2 ${standalone ? 'items-stretch' : ''}`}>
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (!standalone) return body;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md">{body}</div>
    </div>
  );
}
