/**
 * One plan, as the user described it: name, price, allowance, when it ends, and
 * what it includes against what it withholds.
 *
 * ── It renders, it does not decide ──────────────────────────────────────────
 * `granting` was computed server-side by `isGrantingValue` — the same function
 * the config loader uses to refuse a tier that grants something unbuilt. This
 * component does not look at a value and judge it, because a second judgement
 * is a second rule, free to drift from the first.
 *
 * ── "Withheld" and "refused" are different facts (SA R-1) ───────────────────
 * A capability can be withheld in the matrix with nothing in the product to
 * enforce it. Today the banner covers that — nothing is enforced at all — but
 * the moment the banner's words change, a page without this distinction would
 * assert something untrue about a specific capability, to the person deciding
 * whether to flip the switch.
 *
 * So the caveat sits AT the capability, in the same chip shape as the write-ops
 * list, and it is driven by `gateBuilt` in the payload rather than by a note
 * somebody must remember to delete. See `config/enforcementPoints.ts`.
 *
 * ── Withheld is shown, not hidden ───────────────────────────────────────────
 * A plan is defined as much by what it does not include, and the list is the
 * thing a commercial conversation actually needs. It is collapsed by default
 * only because there are more withheld than included on three of the four
 * plans, which would bury the part that is sold.
 */

'use client';

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Minus } from 'lucide-react';

import type { Plan } from '../types';

interface Props {
  plan: Plan;
}

export function PlanCard({ plan }: Props) {
  const [showWithheld, setShowWithheld] = useState(false);

  return (
    <article
      data-testid={`plan-${plan.id}`}
      className="flex flex-col rounded-lg border border-slate-700 bg-slate-800/40 p-4"
    >
      <header className="border-b border-slate-700 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-white">{plan.name}</h3>
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              plan.kind === 'tier'
                ? 'bg-blue-500/20 text-blue-300'
                : 'bg-slate-600/40 text-slate-300'
            }`}
          >
            {plan.kind}
          </span>
        </div>

        {/* The internal id is shown on purpose: it is what the `tier` and
            `cohort` columns hold, and an admin reading a plan row needs the
            mapping in front of them. A customer never sees it. */}
        <p className="mt-1 font-mono text-xs text-slate-500">{plan.id}</p>

        <p className="mt-2 text-2xl font-semibold text-white">
          {plan.monthlyPriceUsd === 0 ? (
            <span className="text-emerald-400">Free</span>
          ) : (
            <>
              ${plan.monthlyPriceUsd}
              <span className="text-sm font-normal text-slate-400"> / month</span>
            </>
          )}
        </p>
      </header>

      <dl className="space-y-2 border-b border-slate-700 py-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">AI actions</dt>
          <dd data-testid={`plan-${plan.id}-ai`} className="text-slate-200">
            {plan.aiActions}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Ends</dt>
          <dd data-testid={`plan-${plan.id}-ends`} className="text-slate-200">
            {plan.endsWhen}
          </dd>
        </div>
        {plan.inheritsFrom && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Inherits</dt>
            <dd className="text-slate-200">
              Everything from <span className="font-mono">{plan.inheritsFrom}</span>, so it changes
              when that plan changes.
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Resolver state</dt>
          <dd className="font-mono text-slate-400">{plan.state}</dd>
        </div>
      </dl>

      <div className="flex-1 pt-3">
        <h4 className="mb-2 text-xs uppercase tracking-wide text-slate-500">
          Includes ({plan.includes.length})
        </h4>
        <ul className="space-y-1">
          {plan.includes.map((capability) => (
            <li key={capability.capability} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
              <span className="text-slate-200">
                {capability.label}
                {/* Only shown when it says more than "yes": a list of 19 rows
                    each ending in "— yes" is noise that hides the two that
                    carry a number. */}
                {capability.display !== 'yes' && (
                  <span className="text-slate-400"> — {capability.display}</span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setShowWithheld((open) => !open)}
          className="mt-3 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          aria-expanded={showWithheld}
        >
          {showWithheld ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Withholds ({plan.withholds.length})
        </button>

        {showWithheld && (
          <ul data-testid={`plan-${plan.id}-withholds`} className="mt-2 space-y-1">
            {plan.withholds.map((capability) => (
              <li key={capability.capability} className="flex items-start gap-2 text-sm">
                <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden="true" />
                <span className="text-slate-400">
                  {capability.label}
                  {!capability.gateBuilt && (
                    <span
                      data-testid={`no-gate-${capability.capability}`}
                      title="Withheld by the plan, but nothing in the product refuses it yet."
                      className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300"
                    >
                      no gate yet
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
