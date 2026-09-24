/**
 * One catalogued call this page cannot configure (FR-9).
 *
 * ── Why it is on the page at all ─────────────────────────────────────────
 * Chat makes six catalogued AI calls and the screen showed two, so the page
 * understated what the platform does. The exclusion is about CONFIGURABILITY,
 * not secrecy: the four chat embeddings keep the shared embedding key because
 * changing an embedding model invalidates every stored vector, which makes it
 * a data migration rather than a setting. On a read-only page, rendering a
 * non-configurable call cannot create a second door.
 *
 * ── No values, no markers (C-7 condition) ────────────────────────────────
 * The row carries the FR-7 caption, the identifier and the server's reason —
 * and nothing else. A model or a temperature here would invite an edit that
 * this page, and the area row behind it, cannot make.
 *
 * ── The reason comes from the server (FR-14) ─────────────────────────────
 * `reason` is `BOS_LLM_SETTINGS_EXCLUSION_REASON`, authored once in
 * `modelSettingsPolicy.ts` and put on the wire by `adminSettingsView.ts`. The
 * client may not import the policy module (FR-6), so it could not know which
 * calls are excluded or why — and re-typing the sentence here would make the
 * policy's reason and the screen's reason two sentences free to drift.
 *
 * ── Quiet, not amber ─────────────────────────────────────────────────────
 * This is a normal, permanent state, not a warning. Amber is spoken for by the
 * issue lines and the off chips.
 */

import { CALL_NAME_CAPTION } from '../copy';
import type { ExcludedCallView } from '../types';

export function ExcludedCallRow({ call }: { call: ExcludedCallView }) {
  return (
    <div
      data-testid={`excluded-call-${call.callName}`}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-3"
    >
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-600">
          {CALL_NAME_CAPTION}
        </span>
        <span className="font-mono text-xs text-slate-400">{call.callName}</span>
      </div>
      <p data-testid="excluded-call-reason" className="text-[11px] leading-snug text-slate-500">
        {call.reason}
      </p>
    </div>
  );
}
