'use client';

/**
 * One area, collapsed to what matters at a glance and expanded to everything
 * the resolver knows about it.
 *
 * ── The chip never says an area is OFF ───────────────────────────────────
 * It says "Configured: off" (FR-16). The distinction is the whole point of the
 * screen: `isBosLlmAreaEnabled` fails open, so the row saying `false` and the
 * fleet honouring it are two different facts, and only one of them is on this
 * page. `PAGE_STANDING_NOTE` carries that once, at the top, and the caveat
 * beside this chip carries it again on the one card where it bites.
 *
 * ── The switch CONTROL is no longer mirrored (FR-1) ──────────────────────
 * Decision, 2026-09-24: the page deliberately no longer mirrors the on/off
 * switch. `Configured: on` and `Cannot be switched off` are gone; the switch
 * itself is UNCHANGED and remains script-only (runbook §4). What is kept is
 * the STATE, as an exception — the off chip here, the per-call chip in
 * `CallRow`, and the collapsed roll-up between them. **Slice 3 must restore
 * the full FR-17 treatment (the banner, the inline sentence and the
 * confirmation sentence) in the same change that puts a real control on the
 * page**; that obligation is recorded in the approved requirement under FR-17
 * and AC-16, not only here (FR-16), because slice 3 is the change most likely
 * to rewrite this comment.
 *
 * ── An off area is the card's ONLY off statement (RC-4, RC-6) ────────────
 * `areaShowsOff` guards the roll-up AND the per-call chips. With the area off
 * every switchable call inherits `enabled: false` while every LOCKED call
 * still resolves `enabled: true` — so an unguarded card would read
 * "Configured: off", mark `analysis` and leave `planner` bare, which reads as
 * "planner is still running". The state the call-level chip exists for is
 * *area on, calls off*: the `--include-calls` trap, where `--enabled true`
 * restores the area flag and leaves the call flags off.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  AREA_OFF_CAVEAT,
  ISSUE_GLOSS,
  MARKER_LEGEND,
  NO_STORED_ROW,
  READ_ONLY_NOTE,
  setPerCallTitle,
} from '../copy';
import { callsSetPerCall } from '../markers';
import type { AreaView } from '../types';
import { CallRow } from './CallRow';
import { Chip } from './Chip';
import { ExcludedCallRow } from './ExcludedCallRow';
import { LastChangedLine } from './LastChangedLine';
import { StoredRowPanel } from './StoredRowPanel';

interface Props {
  area: AreaView;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * The area-level model, which is what an operator scans for. There is no
 * area-level field in the payload — by design, since a call override makes the
 * area value irrelevant for that call — so it is read off the calls: the one
 * model they agree on, or "varies by call".
 */
function areaModelSummary(area: AreaView): string {
  const models = Array.from(new Set(area.calls.map((call) => call.resolved.model)));
  if (models.length === 0) return 'no configurable calls';
  return models.length === 1 ? models[0] : `varies by call (${models.length})`;
}

/**
 * The same shape for the provider (FR-8), deliberately — the two summaries sit
 * on one line, and a reader should not have to learn two conventions.
 *
 * ── Why it is derived, and why it defends itself ─────────────────────────
 * The provider was 22 repetitions of one word in the page's most expensive
 * space. It moves here because every call in every area resolves to the same
 * one today — a precondition that was CHECKED, not assumed. It is also checked
 * on every render: the day two calls in one area genuinely differ (a second
 * entry in the policy's allowed providers, which is a code change with its own
 * test) the header says so and the per-call field comes back automatically,
 * with its issues, through `renderedFieldsFor`.
 *
 * ⚠️ The condition is `size > 1` and must NEVER be a comparison against a
 * provider NAME — a literal here would be both a lie in the browser bundle and
 * a rule that stops working the day it matters. `source.guard.test.ts` makes
 * that enforceable (FR-13); until this round, nothing would have caught it.
 */
function areaProviderSummary(area: AreaView): string {
  const providers = Array.from(new Set(area.calls.map((call) => call.resolved.provider)));
  if (providers.length === 0) return 'no configurable calls';
  return providers.length === 1 ? providers[0] : `varies by call (${providers.length})`;
}

export function AreaCard({ area, expanded, onToggle }: Props) {
  /** One guard, not a second copy of the condition (RC-4). */
  const areaShowsOff = area.switchable && !area.configuredEnabled;
  const setPerCall = callsSetPerCall(area);
  const offCalls = areaShowsOff
    ? 0
    : area.calls.filter((call) => !call.resolved.enabled).length;
  /*
   * QA EDGE-1: ONE tolerant binding, not a `?? []` at each of the two sites.
   *
   * A payload without `excludedCalls` blanked the whole page (the area heading
   * never rendered), and nothing would have caught it: the `AreaView` wire pin
   * is one-directional (§8.1), `next.config.js` ignores type errors, and jest
   * is type-blind. Not reachable while client and server ship in one Vercel
   * deployment — but a missing list should cost a row, not the screen.
   */
  const excludedCalls = area.excludedCalls ?? [];
  /* FR-9: the chip answers "what does this area do", so it counts every
     catalogued call — including the ones this page cannot configure. */
  const callCount = area.calls.length + excludedCalls.length;
  const showPerCallProvider =
    new Set(area.calls.map((call) => call.resolved.provider)).size > 1;

  return (
    <article
      data-testid={`area-card-${area.area}`}
      className="rounded-xl border border-slate-700 bg-slate-800/40 backdrop-blur"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-slate-800/40"
      >
        {expanded ? (
          <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        ) : (
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{area.area}</h3>

            {/* FR-2 / FR-16: the chip describes the CONFIGURATION, says so,
                and renders only in the exception. */}
            {areaShowsOff && (
              <Chip tone="warn" testId="state-chip">
                Configured: off
              </Chip>
            )}

            <Chip tone="quiet" testId="call-count-chip">
              {callCount} {callCount === 1 ? 'call' : 'calls'}
            </Chip>
            {setPerCall > 0 && (
              <Chip tone="accent" title={setPerCallTitle(setPerCall)} testId="set-per-call-chip">
                {setPerCall} set per call
              </Chip>
            )}
            {offCalls > 0 && (
              <Chip tone="warn" testId="calls-off-chip">
                {offCalls} {offCalls === 1 ? 'call' : 'calls'} configured off
              </Chip>
            )}
            {area.areaIssues.length > 0 && (
              <Chip tone="warn" testId="area-issue-chip">
                {area.areaIssues.length}{' '}
                {area.areaIssues.length === 1 ? 'row issue' : 'row issues'}
              </Chip>
            )}
          </div>

          <p className="truncate text-xs text-slate-400" data-testid="area-summary">
            provider <span className="font-mono text-slate-300">{areaProviderSummary(area)}</span>
            {' · '}
            model <span className="font-mono text-slate-300">{areaModelSummary(area)}</span>
          </p>

          {/* On the one card where it bites, and nowhere else. */}
          {areaShowsOff && (
            <p data-testid="area-off-caveat" className="text-xs text-amber-300/90">
              {AREA_OFF_CAVEAT}
            </p>
          )}

          {/* FR-7 and FR-14 are mutually exclusive by construction: no row
              means no attribution line, and `LastChangedLine` renders nothing
              for that state. */}
          {area.rowPresent ? (
            <LastChangedLine lastChangedBy={area.lastChangedBy} />
          ) : (
            <p data-testid="no-row-note" className="text-xs text-slate-400">
              {NO_STORED_ROW}
            </p>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-slate-700 p-4">
          {/* RC-8: this line shared its wrapper with the two notices FR-1 and
              FR-5 deleted, and nothing asserted it. It stays, verbatim. */}
          <p data-testid="read-only-note" className="text-xs text-slate-500">
            {READ_ONLY_NOTE}
          </p>

          {area.areaIssues.length > 0 && (
            <ul className="space-y-1">
              {area.areaIssues.map((issue, index) => (
                <li
                  key={`${issue.field}-${issue.kind}-${index}`}
                  data-testid="area-issue"
                  className="text-[11px] leading-snug text-amber-300/90"
                >
                  <span className="font-mono text-amber-200">{issue.reason}</span>
                  <span className="text-slate-400"> — {ISSUE_GLOSS[issue.kind]}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Calls</h4>
            {/* At the point of use: only one card expands at a time, so exactly
                one legend is ever on screen. A page-header legend would be far
                from the marks, read once, then forgotten. */}
            <p data-testid="marker-legend" className="text-[11px] leading-relaxed text-slate-500">
              {MARKER_LEGEND}
            </p>
            {area.calls.map((call) => (
              <CallRow
                key={call.callName}
                call={call}
                showProvider={showPerCallProvider}
                areaShowsOff={areaShowsOff}
              />
            ))}
            {/* FR-9: catalogued, not configurable here. Below the configurable
                calls, and quiet. */}
            {excludedCalls.map((call) => (
              <ExcludedCallRow key={call.callName} call={call} />
            ))}
          </div>

          {/*
           * PARKED 2026-09-24 (FR-3) — `<LedgerCheckPanel area={…} since={…} />`
           * used to render here.
           *
           * WHY: the check is bounded to a change made in the last 24 hours and
           * every stored row is older than that, so every area's only reachable
           * state today is `too_long_ago` — eight identical shrugs. The panel
           * becomes informative again when slice 3 makes this page a writer.
           *
           * NOT DELETED: `components/LedgerCheckPanel.tsx`,
           * `lib/business-os/llm/ledgerCheckCopy.ts`, the `…/ledger` route and
           * all of their tests stay and stay green. Re-mounting is ONE import
           * plus ONE line.
           *
           * ⚠️ SLICE 3, READ THIS FIRST (R-D): while the panel is parked, the
           * ~60-second propagation statement is carried by `PAGE_STANDING_NOTE`
           * in the page header. Re-mounting the panel without revisiting that
           * line renders the propagation fact TWICE. Both compose the same
           * private `PROPAGATION_CLAUSE` in `copy.ts`, so the fix is a copy
           * decision, not a merge.
           */}

          <StoredRowPanel area={area} />
        </div>
      )}
    </article>
  );
}
