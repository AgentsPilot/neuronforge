'use client';

/**
 * "Every [ 2 ] [ hours ]" — the one control both agent dialogs ask with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT CHIPS, WHICH IS WHAT THIS REPLACES
 *
 * Chips were right while each dialog offered three or four answers, and they
 * were two separate vocabularies that did not overlap: the mailbox wizard
 * offered five, fifteen or thirty minutes and hourly, the adopted dialog
 * offered daily through monthly. Nothing on the platform could say "every four
 * hours", and neither control could express the other's range.
 *
 * Covering minutes to months as chips is about ten rungs per question. That is
 * two crowded rows in English and worse in Hebrew, and it STILL cannot say
 * "every ten days" until somebody adds that rung too. A number and a unit
 * covers the whole span in two taps and never needs another rung.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RANGE IS THE POLICY, AND IT IS NOT A SUGGESTION
 *
 * Every caller passes one. `win_back_quiet_clients` writes to people who have
 * not been in touch for a year, so its floor is a fortnight — and a free number
 * box with no floor is how an owner mails a dormant client hourly.
 *
 * So the control never shows a value the range refuses: the units offered are
 * the ones the range can reach, the number input carries that unit's own
 * bounds, and a typed value is clamped on commit rather than on keystroke. On
 * keystroke would fight the owner mid-number — typing "10" into a field whose
 * floor is 7 passes through "1", and clamping there turns it into "7" before
 * the zero arrives.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  boundsForUnit,
  clampInterval,
  inUnit,
  unitsForRange,
  type IntervalRange,
  type IntervalUnit,
  type ScheduleInterval,
} from '@/lib/business-os/schedule/interval';

interface IntervalPickerProps {
  /** The question, as the owner reads it. */
  label: string;
  /** The word before the number: "Every", or "After". */
  lead?: string;
  value: ScheduleInterval;
  range: IntervalRange;
  onChange: (next: ScheduleInterval) => void;
  /** `minutes` / `hours` / `days` in the owner's language. */
  unitLabel: (unit: IntervalUnit, count: number) => string;
  /** A sentence under the control, where the question needs one. */
  hint?: string;
  disabled?: boolean;
  id?: string;
  /**
   * Label, number and unit on ONE line.
   *
   * For the editor inside the agents table, where the row is short and the
   * question already has a column heading over it. The dialogs stay stacked:
   * there the label is the question being asked and wants its own line.
   */
  inline?: boolean;
}

export function IntervalPicker({
  label,
  lead,
  value,
  range,
  onChange,
  unitLabel,
  hint,
  disabled,
  id,
  inline,
}: IntervalPickerProps) {
  const units = useMemo(() => unitsForRange(range), [range]);
  const bounds = useMemo(() => boundsForUnit(range, value.unit), [range, value.unit]);

  /*
   * What the number field is showing, separate from the committed value.
   *
   * Needed because the two disagree while somebody is typing: an empty field
   * and a half-typed number are both states the committed value cannot hold,
   * and writing through on every keystroke is what makes a clamped field
   * impossible to type into.
   */
  const [typed, setTyped] = useState<string | null>(null);

  const commit = useCallback(
    (raw: string) => {
      setTyped(null);

      const every = Number.parseInt(raw, 10);
      /* Nothing usable typed: put the committed value back rather than guess. */
      if (!Number.isFinite(every) || every <= 0) {
        onChange(value);
        return;
      }

      onChange(clampInterval({ every, unit: value.unit }, range));
    },
    [onChange, range, value]
  );

  const changeUnit = useCallback(
    (unit: IntervalUnit) => {
      /*
       * Converted, not reset. Switching days to hours on "every 1 day" has to
       * offer 24 hours — an owner changing the unit is reaching for a finer
       * grain around the answer they already have, and starting them at 1 hour
       * is a different cadence they did not ask for.
       */
      onChange(clampInterval(inUnit(value, unit), range));
    },
    [onChange, range, value]
  );

  const numberId = id ? `${id}-count` : undefined;

  return (
    /*
      A group with its own label rather than a fieldset and a legend.
      ──────────────────────────────────────────────────────────────────────────
      `<legend>` is rendered specially by the browser and does not participate
      in a flex row, so it could not sit beside the controls — and `inline` is
      exactly that: one line, for the editor inside the agents table, where the
      question already has a column heading above it.

      The group keeps its name for assistive software, and the number and unit
      each carry the same label, so nothing is lost by dropping the legend.
    */
    <div
      role="group"
      aria-label={label}
      className={
        inline
          ? 'flex items-center gap-2 flex-wrap min-w-0'
          : 'min-w-0'
      }
    >
      {/*
        ──────────────────────────────────────────────────────────────────────
        ONE PHRASE INLINE, A LABEL ABOVE WHEN STACKED.

        Inline, the `lead` IS the question — "Every", "Stops after" — and it
        reads as the first words of a sentence the controls finish. Printing the
        label as well gave "Stops after · After · 30 · days": the same question
        twice, and enough width to push the row onto a second line.

        The group keeps `aria-label`, and so do the number and the units, so
        the question is still announced. Only the duplicate ink goes.
        ──────────────────────────────────────────────────────────────────────
      */}
      {!inline && (
        <span
          className="text-xs font-medium text-[var(--v2-text-muted)]"
          style={{ display: 'block', marginBottom: '8px' }}
        >
          {label}
        </span>
      )}

      <div className="flex items-center gap-2">
        {lead && (
          <span className="text-[13px] text-[var(--v2-text-secondary)]">{lead}</span>
        )}

        {/*
          The design system's field, so the number and the unit beside it are
          one pair rather than two guesses at the same border. The height, the
          radius, the border and background tokens, the focus ring and the
          disabled treatment all come from the primitive, which is what makes it
          match the trigger beside it in both themes.

          ──────────────────────────────────────────────────────────────────────
          THE WIDTH IS AN INLINE STYLE, AND IT HAS TO BE.

          `Input` carries `w-full`, and this project's `cn` is a plain join
          rather than tailwind-merge — both classes survive and the stylesheet's
          own order decides, which `w-full` wins. A two-digit number was
          rendering as a field the width of its column, and the lead word and
          the unit were pushed onto their own lines by it.

          A style attribute beats every class, so it is the only override that
          is certainly applied. Changing `cn` to merge would fix this one case
          and silently re-resolve class conflicts in every component in the app.
          ──────────────────────────────────────────────────────────────────────
        */}
        <Input
          id={numberId}
          type="number"
          inputMode="numeric"
          min={bounds.min}
          max={bounds.max}
          disabled={disabled}
          value={typed ?? String(value.every)}
          onChange={e => setTyped(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            /* Enter commits, so the value is not left uncommitted by somebody
               who types and presses the dialog's own button next. */
            if (e.key === 'Enter') {
              e.preventDefault();
              commit((e.target as HTMLInputElement).value);
            }
          }}
          aria-label={label}
          /*
            ──────────────────────────────────────────────────────────────────
            WHY THE ARROW SOMETIMES DOES NOTHING, SAID OUT LOUD.

            `min` stops the spinner at the floor, which is correct — five
            minutes is the fastest the scheduler itself runs — and completely
            silent. An owner holding the down arrow at 5 and watching nothing
            happen has no way to learn that, and the only way they found out was
            by switching to days and seeing it move again.

            The bounds in the CURRENT unit, because they change with it: five
            to 129,600 in minutes is one to ninety in days, and quoting the
            wrong one would explain nothing. Built from `unitLabel` rather than
            a new translation key, since it is two numbers and a word the caller
            already localises.
            ──────────────────────────────────────────────────────────────────
          */
          title={`${bounds.min}–${bounds.max} ${unitLabel(value.unit, bounds.max)}`}
          className="text-center tabular-nums"
          style={{
            width: '4.25rem',
            /*
              The services panel's field radius, not the primitive's `rounded-md`.
              ────────────────────────────────────────────────────────────────────
              `--v2-radius-button` is 12px and is what every field on the service
              form uses, including the price box this control sits beside in the
              owner's memory. Six pixels next to a pill track reads as two
              different form languages on one line.

              Inline for the same reason as the width: `Input` sets its own
              radius by class, and this project's `cn` is a plain join rather
              than tailwind-merge, so a class passed alongside does not replace
              it — both survive and the stylesheet's order decides.
            */
            borderRadius: 'var(--v2-radius-button)',
          }}
        />

        {/*
          ────────────────────────────────────────────────────────────────────
          THE UNITS AS ONE CONNECTED CONTROL, NOT A DROPDOWN.

          A dropdown hides two of the three answers behind a press, and the
          whole set fits in the width of the word "minutes". Showing them
          costs nothing and makes the question answerable in one tap instead
          of two — and it says what the choices ARE, which a closed dropdown
          cannot.

          Connected rather than spaced, because these are three faces of one
          answer: the number beside them is meaningless until one is picked.
          Separate chips read as three independent toggles.

          It also removes the problem the dropdown brought with it. A native
          `<select>` renders the OS widget and ignores the dark theme
          entirely; the design system's one is a portalled listbox that needs
          pointer capture and a resize observer to open. Neither applies to
          three buttons.

          ONE UNIT, ONE WORD, AND NO CONTROL AT ALL. A segmented control with
          a single segment is something that cannot be operated, and it reads
          as broken rather than as settled. Every adopted agent's range admits
          only days, so this is the common case.
          ────────────────────────────────────────────────────────────────────
        */}
        {units.length === 1 ? (
          /*
            ──────────────────────────────────────────────────────────────────
            ONE UNIT IS STILL DRAWN AS A PILL, IN THE SAME TRACK.

            It was bare text, on the reasoning that a segmented control with one
            segment is something that cannot be operated and reads as broken.
            That was wrong about which thing reads as broken. Every adopted
            agent's range admits days alone, so the invoice chaser rendered as
            "כל 14 ימים" in plain words beside a mailbox rendering a pill group
            — two agents on one screen looking like two different products, and
            an owner reasonably asking why one of them is missing its control.

            So the shape stays and only the interaction goes: a span rather than
            a button, with no `radiogroup` around it, because there is genuinely
            nothing to choose. It states the unit where the others offer one.

            Styled as the CHOSEN segment — lifted onto `--v2-surface` — since
            that is what it is: the selected one, and the only one.
            ──────────────────────────────────────────────────────────────────
          */
          <span
            className="inline-flex p-0.5 border border-[var(--v2-border)] bg-[var(--v2-bg)] self-start"
            style={{ borderRadius: '999px' }}
          >
            <span
              className="px-3.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap bg-[var(--v2-surface)] text-[var(--v2-text-primary)] shadow-sm"
              style={{ borderRadius: '999px' }}
            >
              {unitLabel(units[0], value.every)}
            </span>
          </span>
        ) : (
          /*
            ──────────────────────────────────────────────────────────────────
            THE SERVICES PANEL'S OWN SEGMENT, COPIED RATHER THAN APPROXIMATED.

            `SchedulingServicesList`'s `segment()` is where this shape is
            defined: a pill TRACK — one border, one background, half a pixel of
            padding — holding pill buttons, where the chosen one is lifted onto
            `--v2-surface` with a small shadow and the rest are plain text.

            Matched to it exactly: `px-3.5 py-1.5`, 12.5px, `999px` on both the
            track and the buttons. An owner meets that control when they price a
            service and this one when they schedule an agent, and two shapes for
            "pick one of these" is two things to learn.

            The track is what makes them connected without any border
            arithmetic: there are no shared edges to collapse, no z-index to
            keep the accent on top, and it reads correctly in both writing
            directions because nothing is rounded per-corner.

            No radio dots. This is a lift-one-of-three control and the lift says
            which — the dots belong to the larger spaced chips in the service
            modal, where each is a paragraph rather than a word.
            ──────────────────────────────────────────────────────────────────
          */
          <div
            role="radiogroup"
            aria-label={label}
            className="inline-flex p-0.5 border border-[var(--v2-border)] bg-[var(--v2-bg)] self-start"
            style={{ borderRadius: '999px' }}
          >
            {units.map(unit => {
              const on = unit === value.unit;

              return (
                <button
                  key={unit}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => changeUnit(unit)}
                  className={`px-3.5 py-1.5 text-[12.5px] whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                    on
                      ? 'bg-[var(--v2-surface)] text-[var(--v2-text-primary)] font-medium shadow-sm'
                      : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                  }`}
                  style={{ borderRadius: '999px' }}
                >
                  {/*
                    ────────────────────────────────────────────────────────────
                    THE CHOSEN ONE AGREES WITH ITS NUMBER; THE REST NAME GRAINS.

                    The control is read as a sentence — "every 1 day" — and the
                    selected segment is its last word, so it has to agree. The
                    others are not in any sentence yet: they are categories on
                    offer, and a category is plural.

                    Labelling them ALL with the live count was the first bug: at
                    1 every segment went singular, so the button for 24 hours
                    read "hour". All-plural fixed that and broke the sentence
                    into "every 1 days" instead.
                    ────────────────────────────────────────────────────────────
                  */}
                  {unitLabel(unit, on ? value.every : 2)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {hint && (
        <p className="mt-2 mb-0 text-xs text-[var(--v2-text-muted)]">{hint}</p>
      )}
    </div>
  );
}
