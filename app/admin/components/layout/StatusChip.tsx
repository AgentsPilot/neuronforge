'use client';

/**
 * The admin status chip (Admin Layout Standard C-12, §5.9).
 *
 * Generalised from the Jobs `Badge`: the same shape, plus the §5.9 icon, which
 * is hidden from screen readers because the words always say the status too
 * (A-7: colour and icon are never the only signal). A `<span>`, never a
 * `<div>` (F-62), so it can sit inside a table cell, a heading row or a link.
 *
 * L-1b builds the four tones its pilot (Scheduled jobs & queues) uses. L-1d
 * adds `info` with its first consumer (the Audit trail severity "Info").
 * `neutral` arrives with its first consumer (SA Q-4).
 */

import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** §5.9 tones built so far (L-1b; `info` L-1d). */
export type StatusTone = 'danger' | 'warn' | 'ok' | 'info' | 'unknown';

/**
 * THE ONLY GREEN in the shared admin layout folder (§6.1 S-7, pinned by the
 * C-14 guard in `__tests__/layoutFolder.guard.test.ts`: exactly one green
 * constant, and it lives in this file). A later tile status "Healthy" takes its
 * green from here too; this constant may then become one object literal
 * (for example chip, card and accent classes), never a second constant (SA Q-3).
 */
const OK_TONE = 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';

const TONES: Record<StatusTone, { classes: string; icon: LucideIcon }> = {
  danger: { classes: 'border-red-500/40 bg-red-500/15 text-red-300', icon: AlertOctagon },
  warn: { classes: 'border-amber-500/40 bg-amber-500/15 text-amber-300', icon: AlertTriangle },
  ok: { classes: OK_TONE, icon: CheckCircle2 },
  info: { classes: 'border-sky-500/40 bg-sky-500/15 text-sky-300', icon: Info },
  unknown: { classes: 'border-dashed border-slate-600 bg-slate-800/60 text-slate-400', icon: CircleDashed },
};

export interface StatusChipProps {
  tone: StatusTone;
  /** The status in words. Always present (A-7): colour is never the only signal. */
  children: string;
  /** Lets a page keep its existing test id (Jobs: "status-badge"). */
  testId?: string;
}

export function StatusChip({ tone, children, testId }: StatusChipProps) {
  const { classes, icon: Icon } = TONES[tone];
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {/* The icon adds no text, so the chip's textContent is exactly the words. */}
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}
