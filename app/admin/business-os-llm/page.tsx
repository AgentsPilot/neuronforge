'use client';

/**
 * Business OS AI — what every catalogued Business OS AI call is set to.
 *
 * ── Why this page adds no guard of its own ───────────────────────────────
 * `app/admin/layout.tsx` awaits `requireAdminPage()` before this page's RSC
 * payload is produced, and in the App Router there is no way for a page to skip
 * its parent layout. Protection is a property of the route tree, not a
 * convention each page opts into — so a `requireAdminPage()` call here would be
 * a second, weaker copy of a guard that already ran, and would read as though
 * the layout's guarantee were optional. There is deliberately no read-only tier
 * for non-admins (D-7): admin or nothing.
 *
 * ── Why this file imports no server module (FR-6) ────────────────────────
 * Areas, call names, locks, providers, temperature bounds and the model options
 * all arrive in the `GET` payload. Nothing here imports `modelSettings`,
 * `modelSettingsPolicy`, `modelSettingsSchema` or `callCatalog`, and nothing
 * here writes down a model name or a temperature: the browser bundle therefore
 * cannot carry a guardrail rule that has drifted from the resolver's. The one
 * shared import is `ledgerCheckCopy`, which is a plain copy module by design so
 * the panel and the route render one string.
 *
 * ── Read-only (slice 2) ─────────────────────────────────────────────────
 * Nothing on this page writes. There is no form that submits; the only network
 * calls are two `GET`s. Changing a value is still `npm run bos:llm-settings`
 * (runbook §3) until slice 3 lands the writer.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §5
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { AreaCard } from './components/AreaCard';
import { PAGE_STANDING_NOTE, PAGE_SUBTITLE } from './copy';
import { formatInstant } from './format';
import type { SettingsPayload } from './types';

export default function BusinessOsLlmSettingsPage() {
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/business-os/llm-settings');
      const body = await response.json();
      if (!response.ok || !body?.success) {
        throw new Error(
          typeof body?.error === 'string' ? body.error : 'Could not read the settings'
        );
      }
      setPayload(body.data as SettingsPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
          <div>
            <div className="mb-1 flex items-center gap-3">
              <h1 className="text-xl font-semibold text-white">Business OS AI</h1>
              <span className="rounded bg-purple-500/20 px-2 py-1 text-xs text-purple-400">
                Read-only
              </span>
            </div>
            <p data-testid="page-subtitle" className="max-w-3xl text-sm text-slate-400">
              {PAGE_SUBTITLE}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* The label is not rendered without its value: `formatInstant`
                returns null for an unreadable instant, and "read at " alone
                would read as a missing fact rather than an absent one. */}
            {payload && formatInstant(payload.generatedAt) && (
              <span className="text-xs text-slate-500">
                read at {formatInstant(payload.generatedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              title="Re-read the settings"
              className="rounded-lg border border-slate-700 p-2 transition-colors hover:bg-slate-800 disabled:opacity-40"
            >
              <RefreshCw
                className={`h-5 w-5 text-slate-400 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </header>

      {/* Above the cards, not below them: the reason a card can be wrong has
          to be read before the card is.

          FR-5: this one muted line replaced a ~180-word amber banner. All four
          of that banner's strings were framed around the on/off switch, which
          is no longer on the page — but the residual truth is about the VALUES,
          and it is what makes every number below conditional. Muted, not styled
          as a warning, and with nothing to dismiss. */}
      <p data-testid="page-standing-note" className="text-xs leading-relaxed text-slate-500">
        {PAGE_STANDING_NOTE}
      </p>

      {error && (
        <div
          data-testid="page-error"
          className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading && !payload && (
        <div className="flex items-center gap-3 py-12 text-slate-300">
          <RefreshCw className="h-6 w-6 animate-spin text-purple-500" aria-hidden="true" />
          Reading the settings&hellip;
        </div>
      )}

      {payload && (
        <div className="space-y-3">
          {payload.areas.map((area) => (
            <AreaCard
              key={area.area}
              area={area}
              expanded={expanded === area.area}
              /* One at a time: the expanded card is long, and two open cards
                 invite comparing values that belong to different areas. */
              onToggle={() => setExpanded((current) => (current === area.area ? null : area.area))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
