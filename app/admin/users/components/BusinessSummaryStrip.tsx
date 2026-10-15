'use client';

/**
 * The Businesses drawer's summary strip (Admin Layout follow-ups LF-4a.2,
 * BD-1, BD-3, BD-12, BD-13): Plan, Credits left, Recorded AI cost and
 * Last sign-in, as one read-only `dl`.
 *
 * Presentational only. It sends no request: every value comes from the row or
 * from the panel's two reads, which the panel turns into slot states. No link,
 * no button. A slot that could not be read says so; it never shows a zero.
 * Credits left is the list's own `CreditsLeftCell` with the row's props, so the
 * drawer and the list cannot disagree (SQ-9). USD is formatted by the panel.
 */

import { DrawerField, DrawerFields } from '@/app/admin/components/layout/AdminDrawer';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ageLine } from '@/app/admin/users/usersFormat';
import type { RowBusiness, RowCreditsLeft } from '@/app/admin/users/types';
import { CreditsLeftCell } from './CreditsLeftCell';

export const STRIP_COPY = {
  reading: 'Reading…',
  notBos: 'Not a Business OS account',
  unreadable: 'Could not read',
  noPlan: 'No plan recorded',
  never: 'Never',
} as const;

/** A slot that depends on the panel's reads. */
export type StripSlot =
  | { kind: 'reading' }
  | { kind: 'not_bos' }
  | { kind: 'unreadable' }
  | { kind: 'value'; text: string; sub?: string };

/** Credits left: the row's cell, unless the reads have not settled or say "not Business OS". */
export type StripCreditsSlot = { kind: 'reading' } | { kind: 'not_bos' } | { kind: 'cell' };

export interface BusinessSummaryStripProps {
  plan: StripSlot;
  credits: StripCreditsSlot;
  aiSpend: StripSlot;
  business: RowBusiness | null | undefined;
  creditsLeft?: RowCreditsLeft;
  lastSignInAt: string | null;
}

function Muted({ children }: { children: string }) {
  return <span className="text-slate-400">{children}</span>;
}

function Slot({ slot }: { slot: StripSlot }) {
  if (slot.kind === 'reading') return <Muted>{STRIP_COPY.reading}</Muted>;
  if (slot.kind === 'not_bos') return <Muted>{STRIP_COPY.notBos}</Muted>;
  if (slot.kind === 'unreadable') return <span className="text-rose-300">{STRIP_COPY.unreadable}</span>;
  return (
    <>
      <span className="block tabular-nums">{slot.text}</span>
      {slot.sub && <span className="block text-xs text-slate-400">{slot.sub}</span>}
    </>
  );
}

export function BusinessSummaryStrip({ plan, credits, aiSpend, business, creditsLeft, lastSignInAt }: BusinessSummaryStripProps) {
  return (
    <div data-testid="drawer-strip" className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
      <DrawerFields>
        <DrawerField label="Plan" testId="strip-plan">
          <Slot slot={plan} />
        </DrawerField>
        <DrawerField label="Credits left" testId="strip-credits-left">
          {credits.kind === 'reading' ? (
            <Muted>{STRIP_COPY.reading}</Muted>
          ) : credits.kind === 'not_bos' ? (
            <Muted>{STRIP_COPY.notBos}</Muted>
          ) : (
            <CreditsLeftCell business={business} creditsLeft={creditsLeft} />
          )}
        </DrawerField>
        <DrawerField label="Recorded AI cost, 30 days" testId="strip-ai-spend">
          <Slot slot={aiSpend} />
        </DrawerField>
        <DrawerField label="Last sign-in" testId="strip-last-sign-in">
          {lastSignInAt ? (
            <>
              <span className="block">{formatUtc(lastSignInAt)}</span>
              <span className="block text-xs text-slate-400">{ageLine(lastSignInAt)}</span>
            </>
          ) : (
            STRIP_COPY.never
          )}
        </DrawerField>
      </DrawerFields>
    </div>
  );
}
