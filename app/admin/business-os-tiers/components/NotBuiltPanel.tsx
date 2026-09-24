/**
 * The capabilities that cannot be sold at all, and why.
 *
 * ── The rule this list IS ───────────────────────────────────────────────────
 * The user's rule, 2026-09-22: **if a feature does not exist it cannot be
 * allocated.** It is not advice — the config loader refuses to start if a tier
 * grants one of these, so the list below is exactly the set of things no plan
 * can contain, checked by the same catalog the resolver reads.
 *
 * ── Why the note is shown in full ───────────────────────────────────────────
 * This screen is for the pricing conversation, where the question is always
 * "why not?". The `note` is the evidence recorded when the capability was
 * marked unbuilt — usually naming the file and what it does instead — so it
 * answers that question without anyone having to go and look. It is engineering
 * prose, and it is shown verbatim rather than summarised, because a summary is
 * a second claim that can be wrong.
 */

import { Ban } from 'lucide-react';

import type { NotBuiltCapability } from '../types';

interface Props {
  capabilities: NotBuiltCapability[];
}

export function NotBuiltPanel({ capabilities }: Props) {
  return (
    <section
      data-testid="not-built-panel"
      className="rounded-lg border border-slate-700 bg-slate-800/40 p-4"
    >
      <header className="mb-3 border-b border-slate-700 pb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Ban className="h-4 w-4 text-rose-400" aria-hidden="true" />
          Cannot be sold ({capabilities.length})
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          These exist in the catalog but not in the product. <strong>No plan may include one</strong>{' '}
          — the configuration refuses to load if it does. Each is here until somebody can show a
          customer getting the outcome.
        </p>
      </header>

      <ul className="space-y-3">
        {capabilities.map((capability) => (
          <li key={capability.capability} data-testid={`not-built-${capability.capability}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium text-slate-200">{capability.label}</span>
              <span className="font-mono text-xs text-slate-500">{capability.capability}</span>
              <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-xs text-slate-400">
                {capability.category}
              </span>
            </div>
            <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
              {capability.note}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
