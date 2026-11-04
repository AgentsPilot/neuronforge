'use client';

/**
 * The pieces the two "what happened, and what next" dialogs are built from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Marking a session MISSED and calling one OFF ask the same shape of question:
 * a short statement of what is being recorded, one or two decisions each with a
 * consequence attached, and a plain list of what will follow.
 *
 * They were built twice and drifted. The no-show dialog grew numbered steps, a
 * summary and a colour for money; the cancel dialog still rendered its date
 * picker ABOVE the switch that turns it on, so the owner was shown an answer
 * before being asked the question.
 *
 * Defined once here so the next change lands on both. Nothing in this file
 * knows which dialog it is in — the accent is a parameter and the copy is the
 * caller's.
 *
 * @module components/scheduling/decisionDialogParts
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Info } from 'lucide-react';

/**
 * The colour these dialogs lead with: amber, not red and not the brand.
 *
 * Red is an ending, and would read as the dialog refusing something rather
 * than asking. The brand colour would read as a success. Amber is the
 * product's existing word for "this wants a decision", which is what is being
 * asked — and it leaves green and red free to mean money kept and money given
 * up in the summary, where the distinction actually matters.
 */
export const DECISION_ACCENT = '#F0A33E';

/**
 * The step number beside a question.
 *
 * Two questions is few enough that numbering them looks fussy on paper and
 * reads as order on screen: the one that cannot be undone quietly first, then
 * what happens next. Without them the groups sat at the same visual weight as
 * the controls inside them.
 */
export function StepMark({ n, accent = DECISION_ACCENT }: { n: number; accent?: string }) {
  return (
    <span
      aria-hidden
      className="inline-grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full text-[10px] font-bold"
      style={{
        color: accent,
        border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)`,
        background: `color-mix(in srgb, ${accent} 14%, transparent)`,
      }}
    >
      {n}
    </span>
  );
}

/**
 * One question, answered on a single bar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * These were stacked cards, each with a title and two lines of prose, and
 * together they were most of the dialog's height — it read as a form to study
 * rather than a decision to take. Hiding the prose until an answer was chosen
 * was worse: the explanation is what the owner reads IN ORDER to choose.
 *
 * So the choices sit on one bar and the explanation becomes a single `Hint`
 * beneath it, describing the answer currently selected. Every option still
 * explains itself; only one explanation is on screen at a time.
 *
 * `tone` colours the chosen segment by what it MEANS — money kept, money given
 * up, or a plain arrangement — because on these dialogs the consequence is the
 * thing being weighed.
 */
export function ChoiceBar<T extends string>({
  value,
  options,
  onChoose,
  disabled,
  label,
  accent = DECISION_ACCENT,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; tone?: 'keep' | 'give' }>;
  onChoose: (next: T) => void;
  disabled: boolean;
  /** Names the group for assistive tech; the visible label is the caller's. */
  label: string;
  accent?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1 border p-1"
      style={{
        borderRadius: 'var(--v2-radius-button)',
        borderColor: 'var(--v2-border)',
        background: 'var(--v2-bg)',
      }}
    >
      {options.map(option => {
        const on = option.value === value;
        const tone =
          option.tone === 'keep' ? '#14B8A6' : option.tone === 'give' ? '#F2666E' : accent;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChoose(option.value)}
            className="flex-1 whitespace-nowrap px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{
              borderRadius: 'calc(var(--v2-radius-button) - 2px)',
              /* The chosen segment carries the colour and the rest stay quiet,
                 so the answer is readable at a glance rather than hunted for. */
              background: on ? tone : 'transparent',
              color: on ? '#0E1524' : 'var(--v2-text-muted)',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Why the selected answer is what it is — one line, under its bar. */
export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--v2-text-muted)]">
      <Info className="mt-0.5 h-3 w-3 flex-shrink-0 opacity-70" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * The closing panel: everything that will follow from the answers above.
 *
 * Each control says what IT does; this says what the whole answer does, in the
 * order the client will experience it. It is the last thing read before the
 * confirm button, so it carries its own ground rather than sharing the body's.
 */
export function OutcomePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="p-3.5"
      style={{
        borderRadius: 'var(--v2-radius-button)',
        /* Its own ground, not the body's. Bordered on the same background it
           sat on, it read as an afterthought stapled to the bottom rather than
           the conclusion the whole dialog builds to. */
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
      }}
    >
      <h4 className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--v2-text-muted)]">
        {title}
      </h4>
      <ul className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-[var(--v2-text-secondary)]">
        {children}
      </ul>
    </section>
  );
}

/**
 * One consequence, with its icon in a column of its own.
 *
 * The icon is not decoration: the money lines are the ones an owner scans back
 * to, and a row of identical bullets makes them hunt for it. `tone` colours
 * only the money — kept or given up — so the sentence that changed is the one
 * that stands out.
 */
export function OutcomeLine({
  icon: Icon,
  tone,
  children,
}: {
  /* A lucide component, not a character: the rest of this product draws its
     meaning with the same set, and an emoji renders at a different weight on
     every platform — on Windows several of them arrive in colour. */
  icon: LucideIcon;
  tone?: 'keep' | 'give';
  children: ReactNode;
}) {
  return (
    <li
      className="flex items-start gap-2"
      style={{ color: tone === 'keep' ? '#14B8A6' : tone === 'give' ? '#F2666E' : undefined }}
    >
      {/* `mt-[3px]`, not `mt-0.5`: a 14px icon against 12.5px text on a
          1.6 line-height sits a pixel low on the cap height otherwise, and
          three of them in a column make the list look loose. */}
      <Icon
        className="mt-[3px] h-3.5 w-3.5 flex-shrink-0"
        style={{ opacity: tone ? 1 : 0.55 }}
        aria-hidden
      />
      <span className="flex-1">{children}</span>
    </li>
  );
}
