/**
 * One configurable call: what it will actually use, where each value came
 * from, what the code has locked, and every issue the resolver raised.
 *
 * ── Resolved first, always ───────────────────────────────────────────────
 * The stored row and the resolved value diverge silently: a row can set a
 * field the guardrails refuse and the call still runs on something else. So
 * every number here is the RESOLVED one, and the provenance chip beside it is
 * the only thing that says whether the row had anything to do with it.
 *
 * ── Read-only in this slice ──────────────────────────────────────────────
 * The `enabled` control is a disabled checkbox rather than plain text because
 * a lock has to be VISIBLE as a lock (FR-12/AC-12) — and its reason is
 * rendered as text beside it, never as a tooltip alone.
 */

import { Lock } from 'lucide-react';

import {
  ISSUE_GLOSS,
  LOCK_CALL_NOT_SWITCHABLE,
  LOCK_TEMPERATURE_FIXED,
  LOCK_TEMPERATURE_NOT_APPLICABLE,
  PROVENANCE_LABEL,
  PROVENANCE_TITLE,
  TEMPERATURE_NOT_SET,
} from '../copy';
import type { CallView, ProvenanceLevel, SettingField, SettingIssue } from '../types';
import { Chip } from './Chip';

function ProvenanceChip({ level }: { level: ProvenanceLevel }) {
  return (
    <Chip
      tone={level === 'call' ? 'info' : level === 'area' ? 'accent' : 'quiet'}
      title={PROVENANCE_TITLE[level]}
      testId="provenance"
    >
      {PROVENANCE_LABEL[level]}
    </Chip>
  );
}

function IssueList({ issues }: { issues: SettingIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {issues.map((issue, index) => (
        <li
          key={`${issue.field}-${issue.kind}-${index}`}
          data-testid="field-issue"
          className="text-[11px] leading-snug text-amber-300/90"
        >
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
  label,
  field,
  call,
  children,
}: {
  label: string;
  field: SettingField;
  call: CallView;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={`field-${field}`} className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
        <ProvenanceChip level={call.provenance[field]} />
      </div>
      <div className="mt-0.5 break-words text-sm text-slate-100">{children}</div>
      <IssueList issues={call.issues.filter((issue) => issue.field === field)} />
    </div>
  );
}

export function CallRow({ call }: { call: CallView }) {
  const { resolved, locks } = call;

  // Issues the resolver raised against something other than the four fields
  // (an unknown call key, for instance). They belong to the call, so they are
  // shown here rather than dropped.
  const otherIssues = call.issues.filter(
    (issue) => !['enabled', 'provider', 'model', 'temperature'].includes(issue.field)
  );

  return (
    <div
      data-testid={`call-${call.callName}`}
      className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-300">{call.callName}</span>
        {!locks.switchable && (
          <Chip tone="warn" testId="lock-chip">
            <Lock className="h-3 w-3" aria-hidden="true" /> switch locked
          </Chip>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="enabled" field="enabled" call={call}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={resolved.enabled}
              disabled
              readOnly
              aria-label={`${call.callName} enabled`}
              className="h-3.5 w-3.5 accent-purple-500"
            />
            <span>{resolved.enabled ? 'enabled' : 'not enabled'}</span>
          </label>
          {!locks.switchable && (
            <p data-testid="lock-reason" className="mt-1 text-[11px] text-amber-300/90">
              {LOCK_CALL_NOT_SWITCHABLE}
            </p>
          )}
        </Field>

        <Field label="provider" field="provider" call={call}>
          {resolved.provider}
        </Field>

        <Field label="model" field="model" call={call}>
          <span className="font-mono text-xs">{resolved.model}</span>
          {call.provenance.model !== 'default' && (
            <span className="ml-1 text-[11px] text-slate-500">
              (code default: <span className="font-mono">{call.defaults.model}</span>)
            </span>
          )}
        </Field>

        <Field label="temperature" field="temperature" call={call}>
          {locks.temperatureNotApplicable ? (
            <span className="text-slate-400">not applicable</span>
          ) : resolved.temperature === null ? (
            /* `null` is "we send none". Rendering 0 here would be a different
               instruction to the provider (FR-4). */
            <span className="text-slate-400">{TEMPERATURE_NOT_SET}</span>
          ) : (
            resolved.temperature
          )}
          {locks.temperatureNotApplicable && (
            <p data-testid="lock-reason" className="mt-1 text-[11px] text-amber-300/90">
              {LOCK_TEMPERATURE_NOT_APPLICABLE}
            </p>
          )}
          {locks.lockedTemperature !== null && (
            <p data-testid="lock-reason" className="mt-1 text-[11px] text-amber-300/90">
              {LOCK_TEMPERATURE_FIXED} It is fixed at {locks.lockedTemperature}.
            </p>
          )}
        </Field>
      </div>

      {otherIssues.length > 0 && (
        <div className="mt-2">
          <IssueList issues={otherIssues} />
        </div>
      )}
    </div>
  );
}
