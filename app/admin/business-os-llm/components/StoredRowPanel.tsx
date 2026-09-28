'use client';

/**
 * The stored row, as a secondary fact.
 *
 * It is collapsed by default and it is second on purpose: the row is NOT what
 * the platform runs on. A field the guardrails refused still sits in this JSON
 * looking authoritative, while the call resolves to something else entirely —
 * which is why the resolved values and their provenance come first, and this
 * panel exists only for the operator who needs to see what is literally in the
 * database (and match it against `npm run bos:llm-settings -- get <area>`).
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { NO_STORED_ROW } from '../copy';
import { formatInstant } from '../format';
import type { AreaView } from '../types';
import { LastChangedLine } from './LastChangedLine';

export function StoredRowPanel({ area }: { area: AreaView }) {
  const [open, setOpen] = useState(false);

  if (!area.rowPresent) {
    return (
      <p data-testid="stored-row-absent" className="text-xs text-slate-400">
        {NO_STORED_ROW}
      </p>
    );
  }

  const updatedAt = formatInstant(area.updatedAt);

  return (
    <div data-testid="stored-row" className="rounded-lg border border-slate-700 bg-slate-900/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Stored row
        <span className="font-mono text-[11px] normal-case tracking-normal text-slate-500">
          {area.key}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-slate-800 px-3 py-2">
          <p className="text-xs text-slate-500">
            {updatedAt ? `Written at ${updatedAt}` : 'No write timestamp recorded'}
          </p>
          {/* The SAME component the collapsed card uses, so the two renderings
              of FR-14 cannot drift apart. */}
          <LastChangedLine lastChangedBy={area.lastChangedBy} />
          <pre className="max-h-64 overflow-auto rounded bg-slate-950/60 p-2 text-[11px] leading-relaxed text-slate-300">
            {JSON.stringify(area.storedRow, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
