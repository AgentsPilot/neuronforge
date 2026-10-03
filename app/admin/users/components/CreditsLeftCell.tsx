'use client';

/**
 * The "Credits left" cell of a Businesses row (credit deduction slice 8a;
 * FR-48, AC-43; BD-21; SA C-S8-1).
 *
 * The same percentage and colour the owner's Credits card shows, from the one
 * band definition (`creditBands.ts` — the only `lib/business-os` import on
 * this screen, by a pinned exception: it imports nothing itself). The
 * percentage is always written beside the colour dot, so colour is never the
 * only signal. English only, like the rest of `/admin`. A percentage only —
 * no credit count, token or dollar.
 *
 *   - no Business OS business → "—"
 *   - the business lookup failed, or the figure could not be read → "Unknown"
 *   - no allowance → "No allowance"
 *   - otherwise "64%", "less than 1%", "0%", with a "trial" marker on a trial.
 */

import { bandColor, bandFor, type ShownPercentLeft } from '@/lib/business-os/credits/creditBands';

import type { RowBusiness, RowCreditsLeft } from '../types';

interface Props {
  business: RowBusiness | null | undefined;
  creditsLeft?: RowCreditsLeft;
}

const percentFormat = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 });

function Muted({ children }: { children: string }) {
  return (
    <span data-testid="row-credits-left" className="text-sm text-slate-400 italic">
      {children}
    </span>
  );
}

export function CreditsLeftCell({ business, creditsLeft }: Props) {
  if (business === null) {
    return (
      <span data-testid="row-credits-left" className="text-sm text-slate-500" aria-label="No Business OS business">
        —
      </span>
    );
  }
  if (business === undefined || !creditsLeft || creditsLeft.kind === 'unknown') return <Muted>Unknown</Muted>;
  if (creditsLeft.kind === 'no_allowance') return <Muted>No allowance</Muted>;

  const shown: ShownPercentLeft =
    creditsLeft.kind === 'less_than_one' ? { kind: 'less_than_one' } : { kind: 'percent', value: creditsLeft.value };
  const band = bandFor(shown);
  const text = shown.kind === 'less_than_one' ? `less than ${percentFormat.format(0.01)}` : percentFormat.format(shown.value / 100);

  return (
    <span data-testid="row-credits-left" data-band={band} className="inline-flex items-center gap-2 text-sm text-white">
      <span
        data-testid="row-credits-dot"
        aria-hidden="true"
        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: bandColor(band) }}
      />
      <span className="tabular-nums">{text}</span>
      {creditsLeft.trial && (
        <span data-testid="row-credits-trial" className="text-xs text-slate-400 border border-slate-600 rounded px-1.5">
          trial
        </span>
      )}
    </span>
  );
}
