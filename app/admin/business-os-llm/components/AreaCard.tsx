'use client';

/**
 * One area, collapsed to the four things that matter at a glance and expanded
 * to everything the resolver knows about it.
 *
 * ── The chip never says an area is OFF ───────────────────────────────────
 * It says "Configured: off" (FR-16). The distinction is the whole point of the
 * screen: `isBosLlmAreaEnabled` fails open, so the row saying `false` and the
 * fleet honouring it are two different facts, and only one of them is on this
 * page. The fail-open notice sits beside the chip for exactly that reason
 * (FR-17) and cannot be dismissed.
 */

import { ChevronDown, ChevronRight, Lock } from 'lucide-react';

import {
  ISSUE_GLOSS,
  LOCK_AREA_FAIL_OPEN,
  LOCK_AREA_NOT_SWITCHABLE,
  NO_STORED_ROW,
  READ_ONLY_NOTE,
} from '../copy';
import type { AreaView } from '../types';
import { CallRow } from './CallRow';
import { Chip } from './Chip';
import { FailOpenNotice } from './FailOpenNotice';
import { LastChangedLine } from './LastChangedLine';
import { LedgerCheckPanel } from './LedgerCheckPanel';
import { StoredRowPanel } from './StoredRowPanel';

interface Props {
  area: AreaView;
  expanded: boolean;
  onToggle: () => void;
}

/** How many calls have at least one field set on the call itself. */
function overrideCount(area: AreaView): number {
  return area.calls.filter((call) =>
    Object.values(call.provenance).some((level) => level === 'call')
  ).length;
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

export function AreaCard({ area, expanded, onToggle }: Props) {
  const overrides = overrideCount(area);

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

            {/* FR-16: the chip describes the CONFIGURATION, and says so. */}
            {!area.switchable ? (
              <Chip tone="neutral" testId="state-chip">
                <Lock className="h-3 w-3" aria-hidden="true" /> Cannot be switched off
              </Chip>
            ) : area.configuredEnabled ? (
              <Chip tone="info" testId="state-chip">
                Configured: on
              </Chip>
            ) : (
              <Chip tone="warn" testId="state-chip">
                Configured: off
              </Chip>
            )}

            <Chip tone="quiet">
              {area.calls.length} {area.calls.length === 1 ? 'call' : 'calls'}
            </Chip>
            {overrides > 0 && (
              <Chip tone="accent" testId="override-chip">
                {overrides} with a call override
              </Chip>
            )}
            {area.areaIssues.length > 0 && (
              <Chip tone="warn" testId="area-issue-chip">
                {area.areaIssues.length}{' '}
                {area.areaIssues.length === 1 ? 'row issue' : 'row issues'}
              </Chip>
            )}
          </div>

          <p className="truncate text-xs text-slate-400">
            model <span className="font-mono text-slate-300">{areaModelSummary(area)}</span>
          </p>

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
          <div className="space-y-2">
            {/* FR-17: beside the switch state of every area that HAS a switch,
                whenever the card is open. The word "always" belonged to the
                BANNER, which sits above the cards and is never collapsed (SA
                F-7) — this copy is the same claim at the point of use. Slice 3
                must place it adjacent to the real control and in the FR-15
                confirmation, where "beside every switch" becomes literal.

                The non-switchable area gets its own line INSTEAD (QA DEF-S2-4):
                telling an operator a switch-off is not a guarantee, one line
                above telling them the switch-off cannot exist, is a flat
                contradiction — and it was the most prominent text on the one
                card where the warning cannot apply. What does still apply there
                is the fail-open behaviour of the MODEL, which is that area's
                only lever, so that is what its line says. */}
            {area.switchable ? (
              <FailOpenNotice variant="inline" />
            ) : (
              <div data-testid="area-lock-reason" className="space-y-1 text-xs text-amber-300/90">
                <p>{LOCK_AREA_NOT_SWITCHABLE}</p>
                <p className="text-slate-400">{LOCK_AREA_FAIL_OPEN}</p>
              </div>
            )}
            <p className="text-xs text-slate-500">{READ_ONLY_NOTE}</p>
          </div>

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
            {area.calls.map((call) => (
              <CallRow key={call.callName} call={call} />
            ))}
          </div>

          <LedgerCheckPanel area={area.area} since={area.updatedAt} />

          <StoredRowPanel area={area} />
        </div>
      )}
    </article>
  );
}
