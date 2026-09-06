'use client';

import type { ReactNode } from 'react';

/**
 * One thing that will happen as well as the money moving.
 *
 * Every option the refund and stop-plan dialogs offer — tell the client, stop
 * the plan, delete the booking, refund what was collected — is the same kind of
 * choice, so they are the same control rather than a checkbox above a toggle
 * looking like two unrelated widgets.
 *
 * Shared between the two dialogs rather than copied, because they sit side by
 * side in the same drawer and a switch that behaves differently in one of them
 * reads as a bug.
 */
export function SwitchRow({
  checked,
  onChange,
  label,
  description,
  icon,
  danger,
  isRTL,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  icon?: ReactNode;
  danger?: boolean;
  isRTL: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-[var(--v2-surface-hover)]"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-[var(--v2-text-primary)]">{label}</span>
        {description && (
          <span className="block text-[11.5px] text-[var(--v2-text-muted)]">{description}</span>
        )}
      </span>

      <span
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
          checked
            ? danger
              ? 'bg-orange-500'
              : 'bg-[#22C58B]'
            : 'bg-[var(--v2-border)]'
        }`}
      >
        {/* Anchored at the logical START and moved toward the logical END.
            `start-0.5` is the right-hand edge in RTL and the left in LTR, so one
            translate covers both directions — mixing `end-*` with a negative
            translate, as this first did, slid the knob off the track in Hebrew. */}
        <span
          className={`pointer-events-none absolute top-0.5 start-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? (isRTL ? '-translate-x-4' : 'translate-x-4') : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}
