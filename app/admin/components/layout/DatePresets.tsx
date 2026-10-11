'use client';

/**
 * The filter bar's Window control (Admin Layout Standard C-8, §5.5 parts 1 and
 * 2): Today, 7 days, 30 days, This month, Custom; and the Custom row with
 * From (UTC) / To (UTC) whole-date inputs and Apply.
 *
 * A preset applies at once and discards any unapplied typed dates (F-73).
 * Custom only opens the row; nothing is applied until Apply. Clicking the
 * pressed preset, or Apply with both inputs empty while a custom window is
 * applied, goes back to the page's default (SA M-2), so a page whose default
 * is "every date" has a way back that does not also clear the other filters.
 *
 * Only "From after To" is refused here (and real dates, which the native input
 * guarantees). Route-specific caps such as finance's 92 days are not this
 * control's rules (SA Q-11).
 *
 * L-2a: a page may add its own extra windows (`extras`, D-2 (b)), shown after
 * Custom with the same pressed and second-click rules, and may require both
 * dates before Apply (`requireBothDates`, for a route that cannot take a
 * one-sided window).
 *
 * L-4a (user request 2026-10-11, §5.5 Layout): every bar field is "label row,
 * then control", top-aligned. The group carries a visible "Window" label
 * (its accessible name stays exactly "Window", now through aria-labelledby),
 * the preset buttons are as tall as an input (py-1.5, SA Q-6), and a control
 * with no label of its own sits under `AdminFieldSpacer` (SA Q-4).
 */

import { useId, useState } from 'react';

import {
  ADMIN_WINDOW_EXTRA_LABELS,
  ADMIN_WINDOW_LABELS,
  resolveWindow,
  windowEquals,
  type AdminWindowExtra,
  type AdminWindowValue,
} from './adminWindow';
import { ADMIN_WINDOW_PRESETS } from '@/app/admin/components/adminWindowPresets';

/** Field-label class for the bar's controls, so every page's labels match. */
export const ADMIN_FIELD_LABEL = 'block text-[11px] text-slate-400 mb-1';

/** Native control classes for the bar (dark native popups, purple focus ring). No width: the page sizes each control. */
export const ADMIN_FIELD_CONTROL =
  'rounded-lg border border-slate-600 bg-slate-900/50 px-3 py-1.5 text-sm text-white placeholder-slate-400 [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

const RANGE_PROBLEM = 'The start date must not be after the end date';

/**
 * An invisible label-height row for a bar control that has no label of its own
 * (Clear, Refresh, Apply, a page's one-click button), so its control lines up
 * with the labelled ones under `items-start`. It carries `ADMIN_FIELD_LABEL`,
 * so its height is exactly a label's whatever the font metrics (SA Q-4).
 * Hidden from assistive technology.
 */
export function AdminFieldSpacer() {
  return (
    <span aria-hidden="true" className={`${ADMIN_FIELD_LABEL} invisible select-none`}>
      &nbsp;
    </span>
  );
}

export interface DatePresetsProps {
  value: AdminWindowValue;
  /** The page's default window: where a second click on the pressed preset goes back to (SA M-2). */
  defaultValue: AdminWindowValue;
  onChange: (next: AdminWindowValue) => void;
  /** The page's own extra windows, after Custom (D-2 (b)). Default none. */
  extras?: readonly AdminWindowExtra[];
  /** Apply needs both dates; the "both empty goes back to the default" rule then does not apply. Default false. */
  requireBothDates?: boolean;
}

/**
 * What the inputs start from: the applied custom dates, the applied preset's
 * or extra's dates, else empty (a linked value, or an extra that resolves to
 * instants, such as 24 hours).
 */
function draftFrom(value: AdminWindowValue): { from: string; to: string } {
  if (value.kind === 'custom') return { from: value.from ?? '', to: value.to ?? '' };
  if (value.kind === 'preset' || value.kind === 'extra') {
    const resolved = resolveWindow(value, new Date());
    if (resolved.kind === 'dates') return { from: resolved.from ?? '', to: resolved.to ?? '' };
  }
  return { from: '', to: '' };
}

export function DatePresets({ value, defaultValue, onChange, extras = [], requireBothDates = false }: DatePresetsProps) {
  const fromId = useId();
  const toId = useId();
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(value));
  const [problem, setProblem] = useState<string | null>(null);

  // A new applied value (a preset, Apply, Clear, a link) resets the row to it:
  // the inputs always start from what is applied (F-73).
  const [applied, setApplied] = useState(value);
  if (!windowEquals(applied, value)) {
    setApplied(value);
    setOpen(false);
    setDraft(draftFrom(value));
    setProblem(null);
  }

  const showRow = open || value.kind === 'custom';
  const bothEmpty = draft.from === '' && draft.to === '';
  const bothSet = draft.from !== '' && draft.to !== '';
  const canApply = requireBothDates ? bothSet : !bothEmpty || value.kind === 'custom';

  const pickPreset = (next: AdminWindowValue) => {
    setOpen(false);
    setDraft(draftFrom(value));
    setProblem(null);
    onChange(windowEquals(next, value) ? defaultValue : next);
  };

  const openCustom = () => {
    setDraft(draftFrom(value));
    setProblem(null);
    setOpen(true);
  };

  const apply = () => {
    if (requireBothDates && !bothSet) return;
    if (bothEmpty) {
      onChange(defaultValue);
      return;
    }
    if (draft.from !== '' && draft.to !== '' && draft.from > draft.to) {
      setProblem(RANGE_PROBLEM);
      return;
    }
    setProblem(null);
    onChange({ kind: 'custom', from: draft.from === '' ? null : draft.from, to: draft.to === '' ? null : draft.to });
  };

  const buttonClass = (pressed: boolean) =>
    `rounded-md px-2.5 py-1.5 text-xs transition-colors ${FOCUS_RING} ${
      pressed ? 'bg-purple-500/20 text-purple-200' : 'text-slate-300 hover:bg-slate-800'
    }`;

  return (
    <div className="flex flex-wrap items-start gap-3">
      <div>
        <span id={labelId} className={ADMIN_FIELD_LABEL}>
          Window
        </span>
        <div role="group" aria-labelledby={labelId} className="inline-flex rounded-lg border border-slate-700 bg-slate-900/50 p-0.5">
          {ADMIN_WINDOW_PRESETS.map((preset) => {
            const pressed = value.kind === 'preset' && value.preset === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={pressed}
                onClick={() => pickPreset({ kind: 'preset', preset })}
                className={buttonClass(pressed)}
              >
                {ADMIN_WINDOW_LABELS[preset]}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={value.kind === 'custom'}
            onClick={openCustom}
            className={buttonClass(value.kind === 'custom')}
          >
            {ADMIN_WINDOW_LABELS.custom}
          </button>
          {extras.map((extra) => {
            const pressed = value.kind === 'extra' && value.extra === extra;
            return (
              <button
                key={extra}
                type="button"
                aria-pressed={pressed}
                onClick={() => pickPreset({ kind: 'extra', extra })}
                className={buttonClass(pressed)}
              >
                {ADMIN_WINDOW_EXTRA_LABELS[extra]}
              </button>
            );
          })}
        </div>
      </div>

      {showRow && (
        <div className="flex flex-wrap items-start gap-2">
          <div>
            <label htmlFor={fromId} className={ADMIN_FIELD_LABEL}>
              From (UTC)
            </label>
            <input
              id={fromId}
              type="date"
              value={draft.from}
              onChange={(event) => {
                setProblem(null);
                setDraft({ ...draft, from: event.target.value });
              }}
              className={`${ADMIN_FIELD_CONTROL} w-40`}
            />
          </div>
          <div>
            <label htmlFor={toId} className={ADMIN_FIELD_LABEL}>
              To (UTC)
            </label>
            <input
              id={toId}
              type="date"
              value={draft.to}
              onChange={(event) => {
                setProblem(null);
                setDraft({ ...draft, to: event.target.value });
              }}
              className={`${ADMIN_FIELD_CONTROL} w-40`}
            />
          </div>
          <div>
            <AdminFieldSpacer />
            <button
              type="button"
              onClick={apply}
              disabled={!canApply}
              className={`rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-60 ${FOCUS_RING}`}
            >
              Apply
            </button>
          </div>
          {problem && (
            <p role="alert" className="w-full text-xs text-red-300">
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
