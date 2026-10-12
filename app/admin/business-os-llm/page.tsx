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
 * ── Two tabs (credit deduction slice 4a) ────────────────────────────────
 * **Settings** is everything above, unchanged. **Costs & credits** is the
 * operator cost report (`components/costs/CostsTab.tsx`): what Business OS
 * actions cost us and what we charged. It is read-only too — one more `GET`,
 * mounted only when the tab is first chosen, then KEPT mounted (hidden) so
 * switching tabs keeps the chosen window, account and report instead of
 * re-reading (SA CR-N2). Each tab controls its own `tabpanel`. The settings
 * refresh, "read at" and the standing note belong to the Settings tab and are
 * shown only there.
 *
 * ── Three tabs, addressable by URL (AI Activity view, Gap B slice B1a) ───
 * **Activity** (`components/activity/ActivityTab.tsx`) lists one row per
 * Business OS AI action from the credit ledger. It is mounted lazily and then
 * kept mounted, exactly like Costs & credits. The chosen tab is in the URL as
 * `?tab=settings|costs|activity` (SA-RC-13): read once on first render — which
 * also opens that tab's lazy panel (SA-B1-8) — and written back with
 * `history.replaceState`, so there is no navigation and no refetch. An unknown
 * value means Settings; any other parameter (a future `actionId`, B3) is left
 * alone and ignored.
 *
 * ── The standard header and tabs (Admin Layout Standard L-8a) ────────────
 * The header is the shared `AdminPageHeader`: the page's only h1, the
 * "Read-only" badge as the neutral chip, and a purpose line that follows the
 * tab (F-68: the Settings words no longer stand over the other two tabs; each
 * tab's intro moved up here and out of its body). The Settings refresh stays in
 * the header's action slot, shown on Settings only, unchanged until L-10.
 *
 * The tabs follow the APG tablist with MANUAL activation (SA Q-5): Left / Right
 * move focus (wrapping), Home / End go to the first / last, Enter or Space
 * selects; only the selected tab is in the Tab order (roving `tabIndex`).
 * Focus alone never selects, because selecting Costs or Activity for the first
 * time starts a read.
 *
 * `?tab=` is written with `replaceState(null, …)` (SA Q-2, the L-1c M-1
 * mechanism): with a state that already carries Next's own keys, Next 14.2
 * takes its "internal call" branch and never syncs `useSearchParams`, so the
 * Activity KPI tiles (real links built from that string) would carry the old
 * tab. With `null` Next syncs it.
 *
 * ── Two filter tabs, one address bar (L-9a, F-113) ──────────────────────
 * Costs and Activity both own `range`, `from`, `to` and `account` through the
 * shared `useAdminFilters`, and both stay mounted once opened. The rule: the
 * address bar describes the VISIBLE tab only. A tab's hook is `active` only
 * while its tab is shown AND the page's own `useSearchParams` already names it
 * (Next delivers the page's tab write in a later transition render, so in the
 * click's own render every hook still sees the leaving tab's string); a hidden
 * or not-yet-synced tab's hook neither re-reads nor writes. On a tab switch the
 * page saves the leaving tab's keys, drops every key either tab owns (and the
 * hash: an anchor belongs to the tab that drew it), sets `tab`, appends the
 * incoming tab's saved keys, and writes once. The incoming hook then finds its
 * projection already there: one write per switch, and no read.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §5
 * @see docs/workplans/BUSINESS_OS_CREDIT_DEDUCTION_SLICE_4_WORKPLAN.md §4.6
 * @see docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md § F
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import type { AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';

import { AreaCard } from './components/AreaCard';
import { ActivityTab } from './components/activity/ActivityTab';
import { CostsTab } from './components/costs/CostsTab';
import { ACTIVITY_FILTER_SPEC } from './activityFilters';
import { COSTS_FILTER_SPEC } from './costsFilters';
import { ACTIVITY_INTRO, ACTIVITY_TAB_LABEL, TIMES_ARE_UTC } from './activityCopy';
import { PAGE_STANDING_NOTE, PAGE_SUBTITLE } from './copy';
import { COSTS_INTRO, COSTS_TAB_LABEL, SETTINGS_TAB_LABEL } from './costCopy';
import { formatInstant } from './format';
import type { SettingsPayload } from './types';

type PageTab = 'settings' | 'costs' | 'activity';

const tabId = (id: PageTab) => `bos-llm-tab-${id}`;
const panelId = (id: PageTab) => `bos-llm-panel-${id}`;

const TABS: readonly (readonly [PageTab, string])[] = [
  ['settings', SETTINGS_TAB_LABEL],
  ['costs', COSTS_TAB_LABEL],
  ['activity', ACTIVITY_TAB_LABEL],
];

const TAB_PARAM = 'tab';

/** The header's purpose line follows the tab (F-68). The words moved here from each tab; none is new. */
const PURPOSE: Readonly<Record<PageTab, string>> = {
  settings: PAGE_SUBTITLE,
  costs: COSTS_INTRO,
  activity: `${ACTIVITY_INTRO} ${TIMES_ARE_UTC}`,
};

/** The tab a `?tab=` value names; anything else is Settings. */
function tabFromParam(value: string | null | undefined): PageTab {
  return TABS.some(([id]) => id === value) ? (value as PageTab) : 'settings';
}

/** Every URL key a filter spec owns: its keys and its alias keys (SA Q-2: derived, never a hand-written list). */
function ownedKeys<S>(spec: AdminFilterSpec<S>): string[] {
  return (Object.keys(spec) as Array<keyof S>).flatMap((key) => [
    ...spec[key].keys,
    ...Object.keys(spec[key].aliases ?? {}),
  ]);
}

/** The keys each tab's filters own in the address bar (L-9a). Settings has no filters. */
const TAB_KEYS: Readonly<Record<PageTab, readonly string[]>> = {
  settings: [],
  costs: ownedKeys(COSTS_FILTER_SPEC),
  activity: ownedKeys(ACTIVITY_FILTER_SPEC),
};

/** The union: a stray key of the other tab never survives a switch (the address bar is the visible tab only). */
const ALL_TAB_KEYS: readonly string[] = [...new Set([...TAB_KEYS.costs, ...TAB_KEYS.activity])];

type SavedKeys = Partial<Record<PageTab, Array<[string, string]>>>;

/**
 * Write the chosen tab into the address bar without navigating (no refetch, no
 * router). `null` as the state, so Next syncs `useSearchParams` (see the header).
 *
 * L-9a: on a switch the leaving tab's own keys are saved in `saved`, every
 * tab-owned key and the hash are dropped, and the incoming tab's saved keys are
 * appended, in one write. Choosing the tab already shown only sets `tab`.
 */
function writeTabToUrl(from: PageTab, id: PageTab, saved: SavedKeys) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (from !== id) {
    const leaving = TAB_KEYS[from];
    saved[from] = [...url.searchParams.entries()].filter(([key]) => leaving.includes(key));
    for (const key of ALL_TAB_KEYS) url.searchParams.delete(key);
    url.hash = '';
  }
  url.searchParams.set(TAB_PARAM, id);
  if (from !== id) {
    for (const [key, value] of saved[id] ?? []) url.searchParams.append(key, value);
  }
  window.history.replaceState(null, '', url.toString());
}

// useSearchParams needs a Suspense boundary in Next 14.
export default function BusinessOsLlmSettingsPage() {
  return (
    <Suspense fallback={null}>
      <BusinessOsLlmSettingsContent />
    </Suspense>
  );
}

function BusinessOsLlmSettingsContent() {
  // Null outside the App Router (e.g. a unit test); treated as "no tab asked for".
  const searchParams = useSearchParams();
  const [initialTab] = useState<PageTab>(() => tabFromParam(searchParams?.get(TAB_PARAM)));
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<PageTab>(initialTab);
  const onSettings = tab === 'settings';
  // A lazy tab is not read until asked for — by a click OR by the URL it was
  // opened with (SA-B1-8) — and once asked, it stays mounted.
  const [costsOpened, setCostsOpened] = useState(initialTab === 'costs');
  const [activityOpened, setActivityOpened] = useState(initialTab === 'activity');
  // L-9a: each filter tab's keys as it left them, put back when it is shown again.
  const saved = useRef<SavedKeys>({});
  const chooseTab = (id: PageTab) => {
    if (id === 'costs') setCostsOpened(true);
    if (id === 'activity') setActivityOpened(true);
    setTab(id);
    writeTabToUrl(tab, id, saved.current);
  };
  // The tab the URL names, by the same rule as the read-once (SA S-1); null
  // outside the App Router, where the visible tab alone decides.
  const urlTab = searchParams ? tabFromParam(searchParams.get(TAB_PARAM)) : null;
  /** A tab's filters own the address bar only while it is shown AND the URL already names it (see the header). */
  const owns = (id: PageTab) => tab === id && (urlTab === null || urlTab === id);

  // Arrow keys move focus only (manual activation, SA Q-5); Enter / Space on
  // the focused tab is the button's own click.
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index + last) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    tabButtons.current[target]?.focus();
  };

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
      <div>
        <AdminPageHeader
          title="Business OS AI"
          purpose={PURPOSE[tab]}
          badge={{ label: 'Read-only' }}
          actions={
            <div className="flex items-center gap-3" hidden={!onSettings}>
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
          }
        />
        <nav className="flex gap-1 border-b border-slate-700" role="tablist" aria-label="Business OS AI">
          {TABS.map(([id, label], index) => (
            <button
              key={id}
              ref={(element) => {
                tabButtons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={tabId(id)}
              aria-selected={tab === id}
              aria-controls={panelId(id)}
              tabIndex={tab === id ? 0 : -1}
              data-testid={`tab-${id}`}
              onClick={() => chooseTab(id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                tab === id
                  ? 'border-purple-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div role="tabpanel" id={panelId('costs')} aria-labelledby={tabId('costs')} hidden={tab !== 'costs'}>
        {costsOpened && <CostsTab active={owns('costs')} />}
      </div>

      <div role="tabpanel" id={panelId('activity')} aria-labelledby={tabId('activity')} hidden={tab !== 'activity'}>
        {activityOpened && <ActivityTab active={owns('activity')} />}
      </div>

      <div
        role="tabpanel"
        id={panelId('settings')}
        aria-labelledby={tabId('settings')}
        hidden={!onSettings}
        className="space-y-6"
      >
        {/* Above the cards, not below them: the reason a card can be wrong has
            to be read before the card is.

            FR-5: this one muted line replaced a ~180-word amber banner. All four
            of that banner's strings were framed around the on/off switch, which
            is no longer on the page — but the residual truth is about the VALUES,
            and it is what makes every number below conditional. Muted, not styled
            as a warning, and with nothing to dismiss. */}
        <p data-testid="page-standing-note" className="text-xs leading-relaxed text-slate-500" hidden={!onSettings}>
          {PAGE_STANDING_NOTE}
        </p>

        {onSettings && error && (
          <div
            data-testid="page-error"
            className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {onSettings && loading && !payload && (
          <div className="flex items-center gap-3 py-12 text-slate-300">
            <RefreshCw className="h-6 w-6 animate-spin text-purple-500" aria-hidden="true" />
            Reading the settings&hellip;
          </div>
        )}

        {onSettings && payload && (
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
    </div>
  );
}
