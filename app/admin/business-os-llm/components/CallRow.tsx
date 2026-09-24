/**
 * One configurable call: what it will actually use, what the code has locked,
 * and every issue the resolver raised.
 *
 * ── Resolved first, always ───────────────────────────────────────────────
 * The stored row and the resolved value diverge silently: a row can set a
 * field the guardrails refuse and the call still runs on something else. So
 * every value here is the RESOLVED one, and the marker beside its label is the
 * only thing that qualifies it.
 *
 * ── Exceptions are marked; the normal case is not (FR-6) ─────────────────
 * A value that came from the stored row — at either level — carries nothing.
 * `*` marks the few set on the call itself; `c` marks a field where no stored
 * value is in force. The provenance BADGE this file used to put on all four
 * fields is gone: it labelled every value, including the 42 of 44 that are
 * simply normal, and it was read as "which settings have been migrated to the
 * database", which is a question nobody was asking.
 *
 * ── The switch is not mirrored here (FR-1) ───────────────────────────────
 * The disabled `enabled` checkbox and its lock badge rendered on all 22 rows
 * whether or not anything was switched off. The switch itself is unchanged and
 * script-only (runbook §4). What survives is the STATE, as an exception: a
 * `Configured: off` chip on a call the row switches off — and, per RC-6, only
 * when the area is not already saying it.
 *
 * ── One list, used twice (R-C) ───────────────────────────────────────────
 * `renderedFields` drives both the fields rendered and the catch-all filter.
 * See `../markers.ts` for why a second list here is the bug this round fixed.
 */

import {
  CALL_NAME_CAPTION,
  CALL_OFF_TITLE,
  ISSUE_GLOSS,
  LOCK_TEMPERATURE_FIXED,
  LOCK_TEMPERATURE_NOT_APPLICABLE,
  TEMPERATURE_NOT_SET,
} from '../copy';
import { markerFor, renderedFieldsFor, type MarkerKind, type RenderedField } from '../markers';
import type { CallView, SettingIssue } from '../types';
import { Chip } from './Chip';
import { Marker } from './Marker';

function IssueList({ issues, withField }: { issues: SettingIssue[]; withField?: boolean }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {issues.map((issue, index) => (
        <li
          key={`${issue.field}-${issue.kind}-${index}`}
          data-testid="field-issue"
          className="text-[11px] leading-snug text-amber-300/90"
        >
          {/* R-C condition 2: the catch-all NAMES its field. "This field is
              owned by the code" with no field named was sufficient while only
              `calls` and `row` could land here; now that a refused provider or
              a locked `enabled` does too, it is not actionable without it. */}
          {withField && <span className="font-mono text-slate-400">{issue.field} · </span>}
          {/* The guardrail's OWN words first, verbatim — the gloss is beside
              it, never instead of it (FR-5). */}
          <span className="font-mono text-amber-200">{issue.reason}</span>
          <span className="text-slate-400"> — {ISSUE_GLOSS[issue.kind]}</span>
        </li>
      ))}
    </ul>
  );
}

function Field({
  field,
  call,
  marker,
  children,
}: {
  field: RenderedField;
  call: CallView;
  marker: MarkerKind | null;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={`field-${field}`} className="min-w-0">
      {/* RC-1: the marker lives in the LABEL, never beside the value. */}
      <div
        data-testid={`field-label-${field}`}
        className="flex items-baseline gap-1 text-[11px] uppercase tracking-wide text-slate-500"
      >
        <span>{field}</span>
        {marker && <Marker kind={marker} />}
      </div>
      <div data-testid={`field-value-${field}`} className="mt-0.5 break-words text-sm text-slate-100">
        {children}
      </div>
      <IssueList issues={call.issues.filter((issue) => issue.field === field)} />
    </div>
  );
}

/**
 * The body of each rendered field.
 *
 * A `Record` keyed by `RenderedField`, so a field added to `MARKED_FIELDS`
 * without a body here is a **loud runtime throw** on the first render that
 * exercises it — `next.config.js` sets `ignoreBuildErrors`, so a type would
 * gate nothing, but a `TypeError` in a render test cannot be missed. The ninth
 * mutation (RC-9) proves it.
 */
const FIELD_BODIES: Record<RenderedField, (call: CallView) => React.ReactNode> = {
  model: (call) => (
    <>
      <span className="font-mono text-xs">{call.resolved.model}</span>
      {call.provenance.model !== 'default' && (
        <span className="ml-1 text-[11px] text-slate-500">
          (code default: <span className="font-mono">{call.defaults.model}</span>)
        </span>
      )}
    </>
  ),
  temperature: (call) => (
    <>
      {call.locks.temperatureNotApplicable ? (
        <span className="text-slate-400">not applicable</span>
      ) : call.resolved.temperature === null ? (
        /* `null` is "we send none". Rendering 0 here would be a different
           instruction to the provider (FR-4). */
        <span className="text-slate-400">{TEMPERATURE_NOT_SET}</span>
      ) : (
        call.resolved.temperature
      )}
      {/* C-6: the reason is TEXT, never a tooltip. Under FR-6 these two lines
          are the only carrier of "this value is code-owned by policy", which
          makes them more load-bearing than they were, not less. */}
      {call.locks.temperatureNotApplicable && (
        <p data-testid="lock-reason" className="mt-1 text-[11px] text-amber-300/90">
          {LOCK_TEMPERATURE_NOT_APPLICABLE}
        </p>
      )}
      {call.locks.lockedTemperature !== null && (
        <p data-testid="lock-reason" className="mt-1 text-[11px] text-amber-300/90">
          {LOCK_TEMPERATURE_FIXED} It is fixed at {call.locks.lockedTemperature}.
        </p>
      )}
    </>
  ),
  provider: (call) => call.resolved.provider,
};

interface Props {
  call: CallView;
  /** FR-8: true only for an area whose calls resolve to more than one provider. */
  showProvider: boolean;
  /**
   * RC-6: the area chip is already saying this card is off, so the per-call
   * chips are suppressed. A LOCKED call always resolves `enabled: true`
   * (`modelSettings.ts:703-707`), so without this an off chat card would mark
   * `analysis` and leave `planner` bare — which reads as "planner is still
   * running", and is false: the gate stops it at route entry.
   */
  areaShowsOff: boolean;
}

export function CallRow({ call, showProvider, areaShowsOff }: Props) {
  const renderedFields = renderedFieldsFor(showProvider);

  // Issues the resolver raised against something this row does not render —
  // an unknown call key, a refused provider, a locked `enabled`. They belong
  // to the call, so they are shown here rather than dropped (R-C).
  const otherIssues = call.issues.filter(
    (issue) => !(renderedFields as readonly string[]).includes(issue.field)
  );

  const showOffChip = !areaShowsOff && !call.resolved.enabled;

  return (
    <div
      data-testid={`call-${call.callName}`}
      className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3"
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        {/* FR-7. What KIND of identifier `planner` is — the caption answers
            "what is this string" without inventing prose about what the call
            does, which would be a copy table in a client file. */}
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          {CALL_NAME_CAPTION}
        </span>
        <span className="font-mono text-xs text-slate-300">{call.callName}</span>
        {showOffChip && (
          <Chip tone="warn" title={CALL_OFF_TITLE} testId="call-state-chip">
            Configured: off
          </Chip>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {renderedFields.map((field) => (
          <Field key={field} field={field} call={call} marker={markerFor(call, field)}>
            {FIELD_BODIES[field](call)}
          </Field>
        ))}
      </div>

      {otherIssues.length > 0 && (
        <div className="mt-2">
          <IssueList issues={otherIssues} withField />
        </div>
      )}
    </div>
  );
}
