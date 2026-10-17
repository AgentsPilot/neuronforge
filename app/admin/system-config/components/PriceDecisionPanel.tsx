'use client';

/**
 * Apply or Dismiss pending provider prices (AI model price review slice 8;
 * MP-FR-8, MP-FR-10, UF-3, RR-5, SA RC-15, O-19). One panel for the per-row
 * Apply (one model), bulk Apply (the selected models) and Dismiss.
 *
 *  - Apply: per line, ours → provider per unit, and the reason PRE-FILLED from
 *    the line's own source and date (`prefilledReason`), editable, required.
 *    A line with a blocking flag gets an EMPTY override field, required: a
 *    pre-filled override would defeat the flag (RR-5).
 *  - Dismiss: one reason for every listed line, required and NOT pre-filled.
 *  - Cached input (RC-15, slice 7 F-1): "derived (half of input)" when nothing is
 *    stored; a non-OpenAI cached price is labelled "stored, not charged"; a new
 *    price without a cached rate over a stored one says the stored rate goes.
 *  - Image rows (O-19): a warning when the model would still miss a size at low,
 *    medium or high, so the image guardrail keeps refusing it. Warn and allow.
 *  - Focus (SA CR8-2): the panel opens above the table, possibly far from the row
 *    button, so on mount it focuses its own heading and scrolls it into view. The
 *    page returns focus to the opening button on Cancel.
 *
 * Every price shown is the server's own text; nothing is parsed or computed here.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import type { ComparisonRow, PendingView } from '@/lib/ai/pricing-research/comparisonModel';
import { BLOCKING_FLAGS } from '@/lib/ai/pricing-research/lineFlags';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { applyPrices, dismissPrices, prefilledReason, type ApplyRequestLine } from '@/app/admin/system-config/priceApply';
import { APPLY_WORDS } from '@/app/admin/system-config/priceReviewCopy';

export type DecisionMode = 'apply' | 'dismiss';

export type DecisionOutcome =
  | { kind: 'applied'; appliedAt: string; effective: string; marginNeeded: boolean }
  | { kind: 'dismissed' };

interface Props {
  mode: DecisionMode;
  rows: readonly ComparisonRow[];
  onFinished: (outcome: DecisionOutcome) => void;
  onClose: () => void;
}

const INPUT =
  'w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 aria-[invalid=true]:border-red-500';

const MIN_REASON = 3;

function isBlocked(line: PendingView): boolean {
  return line.flags.some((flag) => (BLOCKING_FLAGS as readonly string[]).includes(flag));
}

function blockingLabels(line: PendingView): string[] {
  return line.flagLabels.filter((entry) => (BLOCKING_FLAGS as readonly string[]).includes(entry.flag)).map((entry) => entry.label);
}

function money(value: string | null): string {
  return value === null ? '—' : `$${value}`;
}

/** The unit lines shown for one pending line: every unit of a token row, or the image unit of that line. */
function unitLines(row: ComparisonRow, line: PendingView): Array<{ unit: string; ours: string; provider: string; note: string | null }> {
  const units = row.kind === 'image' ? row.units.filter((unit) => unit.unit === line.unit) : row.units;
  return units
    // Every unit with a new price, plus cached input whenever we charge one today (RC-15: old → new, derived or stored).
    .filter((unit) => unit.pending !== null || (unit.unit === 'cached_input' && unit.current !== null))
    .map((unit) => {
      let note: string | null = null;
      if (unit.unit === 'cached_input') {
        if (row.provider !== 'openai' && unit.pending !== null) note = APPLY_WORDS.cachedNotCharged;
        else if (unit.currentBasis === 'table' && unit.pending === null) note = APPLY_WORDS.cachedRemoved;
        else if (unit.currentBasis === 'derived') note = APPLY_WORDS.cachedDerived;
      }
      return { unit: unit.unit.replace('_', ' '), ours: money(unit.current), provider: money(unit.pending), note };
    });
}

export function PriceDecisionPanel({ mode, rows, onFinished, onClose }: Props) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // CR8-2: announce and show the panel where it opened; `scrollIntoView` is guarded for jsdom.
  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;
    heading.focus();
    heading.scrollIntoView?.({ block: 'start' });
  }, []);
  const lines = rows.flatMap((row) => row.pending.map((line) => ({ row, line })));
  const [reasons, setReasons] = useState<Record<string, string>>(() =>
    mode === 'apply' ? Object.fromEntries(lines.map(({ line }) => [line.lineId, prefilledReason(line.sourceUrl, line.checkedOn)])) : {}
  );
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [dismissReason, setDismissReason] = useState('');
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [failure, setFailure] = useState<{ message: string; problems: string[]; lineIds: string[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const describeLine = (lineId: string) => {
    const found = lines.find(({ line }) => line.lineId === lineId);
    return found ? `${found.row.modelName} (${found.line.unit})` : lineId;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setFailure(null);

    if (mode === 'dismiss') {
      if (dismissReason.trim().length < MIN_REASON) {
        setInvalid(new Set(['dismiss']));
        return;
      }
      setInvalid(new Set());
      setSaving(true);
      const result = await dismissPrices(lines.map(({ line }) => line.lineId), dismissReason.trim());
      setSaving(false);
      if (result.ok) {
        onFinished({ kind: 'dismissed' });
        return;
      }
      setFailure({ message: result.message, problems: result.problems, lineIds: result.lineIds });
      return;
    }

    const bad = new Set<string>();
    const request: ApplyRequestLine[] = lines.map(({ line }) => {
      const reason = (reasons[line.lineId] ?? '').trim();
      if (reason.length < MIN_REASON) bad.add(`reason:${line.lineId}`);
      if (!isBlocked(line)) return { lineId: line.lineId, reason };
      const override = (overrides[line.lineId] ?? '').trim();
      if (override.length < MIN_REASON) bad.add(`override:${line.lineId}`);
      return { lineId: line.lineId, reason, overrideReason: override };
    });
    setInvalid(bad);
    if (bad.size > 0) return;

    setSaving(true);
    const result = await applyPrices(request);
    setSaving(false);
    if (result.ok) {
      onFinished({ kind: 'applied', appliedAt: result.appliedAt, effective: result.effective, marginNeeded: result.marginNeeded });
      return;
    }
    setFailure({ message: result.message, problems: result.problems, lineIds: result.lineIds });
  };

  const title = mode === 'apply' ? APPLY_WORDS.applyTitle : APPLY_WORDS.dismissTitle;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={title}
      data-testid={`price-${mode}-panel`}
      className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 ref={headingRef} tabIndex={-1} data-testid="decision-heading" className="text-sm font-semibold text-white focus-visible:outline-none">
            {title}
          </h3>
          <p className="text-xs text-slate-400">{mode === 'apply' ? APPLY_WORDS.applyIntro : APPLY_WORDS.dismissIntro}</p>
        </div>
        <button type="button" onClick={onClose} className={ADMIN_BUTTON}>
          {APPLY_WORDS.cancel}
        </button>
      </div>

      {rows.map((row) => (
        <section key={`${row.kind}:${row.provider ?? ''}:${row.modelName}`} className="space-y-2 rounded-lg border border-slate-700 p-3">
          <h4 className="text-sm text-white">
            <span className="font-mono">{row.modelName}</span>
            <span className="ml-2 text-xs text-slate-400">{row.provider ?? '—'}</span>
          </h4>
          {mode === 'apply' && row.kind === 'image' && row.imageSetIncomplete && (
            <p data-testid="image-set-incomplete" className="text-xs text-amber-200">
              {APPLY_WORDS.imageSetIncomplete}
            </p>
          )}
          {row.pending.map((line) => {
            const reasonId = `${id}-reason-${line.lineId}`;
            const overrideId = `${id}-override-${line.lineId}`;
            return (
              <div key={line.lineId} className="space-y-1" data-testid={`decision-line-${line.lineId}`}>
                <ul className="text-xs text-slate-300">
                  {unitLines(row, line).map((unit) => (
                    <li key={unit.unit}>
                      {`${unit.unit}: ${APPLY_WORDS.ours} ${unit.ours} → ${APPLY_WORDS.provider} ${unit.provider}`}
                      {unit.note && <span className="ml-1 text-amber-200">{`(${unit.note})`}</span>}
                    </li>
                  ))}
                </ul>
                {mode === 'apply' && (
                  <>
                    <label htmlFor={reasonId} className="block text-xs text-slate-300">
                      {APPLY_WORDS.reason}
                    </label>
                    <input
                      id={reasonId}
                      type="text"
                      value={reasons[line.lineId] ?? ''}
                      onChange={(event) => setReasons((current) => ({ ...current, [line.lineId]: event.target.value }))}
                      aria-invalid={invalid.has(`reason:${line.lineId}`) || undefined}
                      aria-required="true"
                      aria-describedby={`${reasonId}-hint`}
                      data-testid={`apply-reason-${line.lineId}`}
                      className={INPUT}
                    />
                    <span id={`${reasonId}-hint`} className="block text-[11px] text-slate-400">
                      {invalid.has(`reason:${line.lineId}`) ? APPLY_WORDS.reasonTooShort : APPLY_WORDS.reasonHint}
                    </span>
                    {isBlocked(line) && (
                      <>
                        <label htmlFor={overrideId} className="block text-xs text-amber-200">
                          {`${APPLY_WORDS.override}: ${blockingLabels(line).join(', ')}`}
                        </label>
                        <input
                          id={overrideId}
                          type="text"
                          value={overrides[line.lineId] ?? ''}
                          onChange={(event) => setOverrides((current) => ({ ...current, [line.lineId]: event.target.value }))}
                          aria-invalid={invalid.has(`override:${line.lineId}`) || undefined}
                          aria-required="true"
                          aria-describedby={`${overrideId}-hint`}
                          data-testid={`apply-override-${line.lineId}`}
                          className={INPUT}
                        />
                        <span id={`${overrideId}-hint`} className="block text-[11px] text-slate-400">
                          {invalid.has(`override:${line.lineId}`) ? APPLY_WORDS.reasonTooShort : APPLY_WORDS.overrideHint}
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {mode === 'dismiss' && (
        <div>
          <label htmlFor={`${id}-dismiss`} className="block text-xs text-slate-300">
            {APPLY_WORDS.dismissReason}
          </label>
          <input
            id={`${id}-dismiss`}
            type="text"
            value={dismissReason}
            onChange={(event) => setDismissReason(event.target.value)}
            aria-invalid={invalid.has('dismiss') || undefined}
            aria-required="true"
            aria-describedby={invalid.has('dismiss') ? `${id}-dismiss-error` : undefined}
            data-testid="dismiss-reason"
            className={INPUT}
          />
          {invalid.has('dismiss') && (
            <span id={`${id}-dismiss-error`} className="block text-[11px] text-red-300">
              {APPLY_WORDS.reasonTooShort}
            </span>
          )}
        </div>
      )}

      {failure && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <p>{failure.message}</p>
          {failure.lineIds.length > 0 && (
            <p className="mt-1 text-xs">{`${APPLY_WORDS.failedLines} ${failure.lineIds.map(describeLine).join(', ')}`}</p>
          )}
          {failure.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {failure.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button type="submit" disabled={saving} className={ADMIN_BUTTON} data-testid={`confirm-${mode}`}>
        {saving ? APPLY_WORDS.working : mode === 'apply' ? APPLY_WORDS.confirmApply : APPLY_WORDS.confirmDismiss}
      </button>
    </form>
  );
}
