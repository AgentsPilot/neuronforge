'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { ServiceCurrency } from '@/lib/repositories/SchedulingRepository';

/**
 * What a service is charged in.
 *
 * The platform's own control, lifted out of SchedulingServiceModal so the
 * onboarding chat shows the same thing rather than a browser select — which
 * renders as the operating system's widget and belongs to no design system at
 * all.
 *
 * Currency is a choice, never inferred from the interface language: a practice
 * working in Hebrew and serving clients abroad charges in dollars.
 */

const SCHEDULING_COLOR = '#14B8A6';

export const CURRENCY_OPTIONS: { code: ServiceCurrency; label: string; symbol: string }[] = [
  { code: 'USD', label: '$ USD', symbol: '$' },
  { code: 'EUR', label: '€ EUR', symbol: '€' },
  { code: 'ILS', label: '₪ ILS', symbol: '₪' },
  { code: 'GBP', label: '£ GBP', symbol: '£' },
];

export function getCurrencySymbol(code: ServiceCurrency): string {
  return CURRENCY_OPTIONS.find(option => option.code === code)?.symbol || '₪';
}

interface ServiceCurrencySelectProps {
  value: ServiceCurrency;
  onChange: (code: ServiceCurrency) => void;
  /** Fills its container instead of the modal's fixed 24-unit width. */
  fullWidth?: boolean;
  /**
   * A bare symbol and chevron, for sitting inside a price field where there is
   * no room for a bordered control. The menu is unchanged — the trigger is the
   * only thing that shrinks.
   */
  compact?: boolean;
  /** Which side the menu opens from, for a trigger pinned inside a field. */
  align?: 'start' | 'end';
}

export function ServiceCurrencySelect({
  value,
  onChange,
  fullWidth = false,
  compact = false,
  align = 'start',
}: ServiceCurrencySelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking away, or the menu outlives the thing that opened it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={
          compact
            ? 'flex items-center gap-0.5 text-sm text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors cursor-pointer'
            : `flex items-center justify-between gap-2 ${fullWidth ? 'w-full' : 'w-24'} px-3 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm hover:bg-[var(--v2-surface-hover)] transition-all cursor-pointer`
        }
        style={compact ? undefined : { borderRadius: 'var(--v2-radius-button)' }}
      >
        <span className="font-medium">
          {getCurrencySymbol(value)}{compact ? '' : ` ${value}`}
        </span>
        <ChevronDown className={`${compact ? 'h-3 w-3 opacity-60' : 'h-4 w-4'} text-[var(--v2-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className={`absolute top-full mt-1 ${align === 'end' ? 'end-0' : 'start-0'} ${fullWidth ? 'w-full' : 'w-32'} bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-50 overflow-hidden`}
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {CURRENCY_OPTIONS.map(opt => (
            <button
              key={opt.code}
              type="button"
              onClick={() => {
                onChange(opt.code);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-[var(--v2-surface-hover)] transition-colors ${
                value === opt.code ? `bg-[${SCHEDULING_COLOR}]/10 text-[${SCHEDULING_COLOR}]` : 'text-[var(--v2-text-primary)]'
              }`}
              style={value === opt.code ? { background: `${SCHEDULING_COLOR}1A`, color: SCHEDULING_COLOR } : undefined}
            >
              <span className="font-medium">{opt.symbol} {opt.code}</span>
              {value === opt.code && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
