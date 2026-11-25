'use client';

/**
 * The frame the four questions are drawn in: header, stepper, rail, footer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE CHROME IS ITS OWN FILE
 *
 * The four steps differ in what they ask and in nothing else. Every one has the
 * same header, the same four dashes, the same client-view rail on the right and
 * the same single action pinned at the bottom — and the fastest way to lose
 * that is to copy it into four places and then fix three of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE LAYOUT, TWO WIDTHS
 *
 * The same components serve the dialog and the phone. Below `640px` the rail
 * stops being a column and becomes a line that opens, the stepper drops its
 * labels and keeps its dashes, and the footer button goes full width — because
 * a step that fits a phone fits a dialog, and the reverse is what fails.
 *
 * Styled with the product's own tokens rather than literals wherever one
 * exists, so this follows a theme change instead of drifting from it.
 *
 * @module components/scheduling
 */

import React from 'react';

import { CONFIG_ACCENT } from '@/components/business-os/configAccent';
import type { WizardStep } from '@/lib/business-os/serviceWizard';

/** Green for answered, accent for here, grey for ahead. */
const DONE = '#22C58B';

export interface StepFace {
  id: WizardStep;
  label: string;
  answered: boolean;
}

/**
 * Four dashes, and four words where there is room for them.
 *
 * The dashes carry the state on every width; the labels are the part that goes
 * first, because position already says which step this is.
 */
export function WizardStepper({ steps, current }: { steps: StepFace[]; current: WizardStep }) {
  return (
    <div className="sw-stepper">
      {steps.map(step => {
        const here = step.id === current;
        return (
          <span key={step.id} className="sw-step">
            <span
              className="sw-dash"
              style={{ background: here ? CONFIG_ACCENT : step.answered ? DONE : 'var(--v2-border)' }}
            />
            <span
              className="sw-step-label"
              style={{
                color: here ? 'var(--v2-text-primary)' : 'var(--v2-text-muted)',
                fontWeight: here ? 600 : 400,
              }}
            >
              {step.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export interface RailStop {
  /** Reached, or still ahead. A stop is never claimed before its answer. */
  state: 'done' | 'waiting' | 'caveat';
  title: string;
  note?: string;
}

/**
 * What the client does, which is the only reason any of this is being asked.
 *
 * It fills in as the owner answers and never claims something they have not
 * said — the rule the old panel broke when it printed "Nothing is collected"
 * about a service with no price.
 */
export function ClientRail({ stops, summary }: { stops: RailStop[]; summary: string }) {
  return (
    <>
      {/* The column, where there is width for one. */}
      <aside className="sw-rail">
        <p className="sw-rail-head">What your client does</p>

        <ol className="sw-rail-list">
          {stops.map((stop, index) => (
            <li key={stop.title} className="sw-rail-stop">
              <span className="sw-rail-mark">
                <span
                  className="sw-rail-dot"
                  style={{
                    background: stop.state === 'done' ? DONE : stop.state === 'caveat' ? 'var(--v2-warning)' : 'transparent',
                    border: stop.state === 'waiting' ? '1.5px solid var(--v2-border)' : 'none',
                  }}
                />
                {index < stops.length - 1 && <span className="sw-rail-line" />}
              </span>
              <span className="sw-rail-text">
                <span
                  className="sw-rail-title"
                  style={{ color: stop.state === 'waiting' ? 'var(--v2-text-tertiary, #64748B)' : 'var(--v2-text-primary)' }}
                >
                  {stop.title}
                </span>
                {stop.note && <span className="sw-rail-note">{stop.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </aside>

      {/*
        The same thing on a phone: one line that opens.
        It is reassurance rather than input, so it does not deserve a column
        where there is no column to spare.
      */}
      <details className="sw-rail-compact">
        <summary className="sw-rail-summary">
          <span className="sw-rail-summary-text">
            <span className="sw-rail-summary-title">What your client sees</span>
            <span className="sw-rail-summary-note">{summary}</span>
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <ol className="sw-rail-list sw-rail-list-compact">
          {stops.map((stop, index) => (
            <li key={stop.title} className="sw-rail-stop">
              <span className="sw-rail-mark">
                <span
                  className="sw-rail-dot"
                  style={{
                    background: stop.state === 'done' ? DONE : stop.state === 'caveat' ? 'var(--v2-warning)' : 'transparent',
                    border: stop.state === 'waiting' ? '1.5px solid var(--v2-border)' : 'none',
                  }}
                />
                {index < stops.length - 1 && <span className="sw-rail-line" />}
              </span>
              <span className="sw-rail-text">
                <span className="sw-rail-title">{stop.title}</span>
                {stop.note && <span className="sw-rail-note">{stop.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}

/**
 * Every rule the four screens share, in one stylesheet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A PLAIN <style>, NOT styled-jsx, AND THE REASON IS THE PARSER.
 *
 * styled-jsx is used all over this codebase and works — but in every one of
 * those files the tag is NESTED inside an element. A component whose ROOT is a
 * jsx-attributed style tag does not parse at all: SWC answers "Unexpected
 * token style. Expected jsx identifier" and the build fails before any
 * transform runs. This was the only file in the repository shaped that way.
 *
 * Nesting it would mean giving a stylesheet a wrapper element it does not
 * need. `dangerouslySetInnerHTML` carries no risk here — the content is the
 * constant written below, with nothing from a user anywhere near it — and the
 * repo already uses the same pattern in five other components.
 *
 * NO BACKTICKS ANYWHERE IN THE CSS BELOW, comments included. One closes the
 * literal, and the failure is silent: the page renders with no styling at all.
 * There was one, around a property name, written in the comment that warns
 * about exactly this.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const WIZARD_CSS = `
      .sw {
        /*
         * ───────────────────────────────────────────────────────────────────
         * THE DIALOG'S ACCENT, NOT THE PLATFORM PRIMARY.
         *
         * The --v2-primary token is the BUSINESS's own brand colour at runtime: the
         * theme provider writes customTokens.colors.primary over it. So the
         * Continue button came up in whatever colour that account chose for
         * its website — orange on this one — inside a configuration dialog
         * painted in the configuration accent.
         *
         * One variable, set here and read by every control below, so the whole
         * wizard moves together. The value is CONFIG_ACCENT from
         * components/business-os/configAccent.ts, written out because this is
         * a static stylesheet and cannot import it.
         * ───────────────────────────────────────────────────────────────────
         */
        --sw-accent: #D14E97;
        /*
         * ───────────────────────────────────────────────────────────────────
         * A FALLBACK, BECAUSE THIS TOKEN IS NOT DEFINED EVERYWHERE.
         *
         * --v2-text-tertiary exists in app/v2/globals-v2.css and NOT in
         * lib/design-system-v2/v2-theme-tokens.css. Where the second is the
         * sheet in play the variable resolves to nothing, and a declaration
         * with an unresolvable var is dropped WHOLE — so
         * "border: 1.5px solid var(--v2-text-tertiary)" left the radio with no
         * border at all rather than with a default colour. Measured on the
         * cost step in dark mode: three options, no radios, space where they
         * should have been.
         *
         * One local variable with a literal fallback, used everywhere that
         * token was, so a missing definition degrades to a colour instead of
         * to nothing.
         * ───────────────────────────────────────────────────────────────────
         */
        --sw-faint: var(--v2-text-tertiary, #64748B);
        display: flex;
        flex-direction: column;
        /* The panel that mounts this is a flex column of its own, so without
           a flex of 1 the wizard would be only as tall as its content and the
           footer would float mid-dialog instead of sitting at the bottom.
           (No backticks in this comment: it lives inside a template literal,
           and one would close it.) */
        flex: 1;
        min-height: 0;
        background: var(--v2-bg);
        color: var(--v2-text-primary);
        font-family: 'Inter', system-ui, sans-serif;
      }

      .sw-head {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 18px 24px;
        border-bottom: 1px solid var(--v2-border);
      }
      .sw-head-text { flex: 1; min-width: 0; }
      .sw-head-title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sw-head-note {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--v2-text-muted);
      }

      .sw-stepper {
        display: flex;
        gap: 8px;
        padding: 14px 24px 0;
      }
      .sw-step { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
      .sw-dash { height: 3px; border-radius: 2px; }
      .sw-step-label {
        font-size: 11.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .sw-body {
        flex: 1;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 300px;
        gap: 26px;
        padding: 22px 24px;
        min-height: 0;
        overflow-y: auto;
      }
      .sw-main { min-width: 0; display: flex; flex-direction: column; gap: 16px; }

      .sw-title {
        margin: 0;
        font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif;
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.01em;
        line-height: 1.25;
      }
      .sw-lede {
        margin: 5px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--v2-text-secondary);
        text-wrap: pretty;
      }

      .sw-rail {
        border-inline-start: 1px solid var(--v2-surface);
        padding-inline-start: 22px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .sw-rail-head {
        margin: 0;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--v2-text-muted);
      }
      .sw-rail-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
      .sw-rail-stop { display: flex; gap: 11px; }
      .sw-rail-mark { display: flex; flex-direction: column; align-items: center; }
      .sw-rail-dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; box-sizing: border-box; }
      .sw-rail-line { flex: 1; width: 1px; background: var(--v2-border); margin: 4px 0; }
      .sw-rail-text { padding-bottom: 14px; min-width: 0; }
      .sw-rail-title { display: block; font-size: 13px; font-weight: 600; }
      .sw-rail-note {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--v2-text-muted);
      }

      .sw-rail-compact { display: none; }
      .sw-rail-summary {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 11px 13px;
        border: 1px solid var(--v2-border);
        border-radius: var(--v2-radius-button);
        background: var(--v2-surface);
        color: var(--v2-text-muted);
        cursor: pointer;
        list-style: none;
      }
      .sw-rail-summary::-webkit-details-marker { display: none; }
      .sw-rail-summary-text { flex: 1; min-width: 0; }
      .sw-rail-summary-title {
        display: block;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--v2-text-primary);
      }
      .sw-rail-summary-note {
        display: block;
        margin-top: 1px;
        font-size: 11.5px;
        color: var(--v2-text-muted);
      }
      .sw-rail-list-compact { margin-top: 12px; padding-inline-start: 2px; }

      .sw-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 15px 24px;
        border-top: 1px solid var(--v2-border);
      }
      .sw-foot-side { display: flex; align-items: center; gap: 14px; }
      /*
        ─────────────────────────────────────────────────────────────────────
        AN ICON BESIDE ITS LABEL, NOT ABOVE IT.

        This had no display, so it was a plain button, and Tailwind's preflight
        sets svg to display:block. That put the arrow on its own line with the
        word Back underneath it. On a phone, where the footer stretches this to
        full width, the arrow drifted to the far left and read as a stray
        control nobody could press, which is how it was reported.

        inline-flex is what sw-primary already uses for exactly this reason.
        The gap replaces the space character that used to separate them, which
        a flex container would otherwise collapse.

        NO BACKTICKS IN HERE. This whole stylesheet is one template literal, so
        a backtick around a class name ends it and the file stops parsing. That
        has happened three times in this file now.
        ─────────────────────────────────────────────────────────────────────
      */
      .sw-quiet {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: none;
        background: transparent;
        color: var(--v2-text-secondary);
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        padding: 10px 2px;
        min-height: 44px;
      }
      .sw-quiet:disabled { color: var(--sw-faint); cursor: not-allowed; }
      .sw-note { font-size: 12px; color: var(--v2-text-muted); }

      .sw-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: none;
        background: var(--sw-accent);
        color: #fff;
        font-size: 13.5px;
        font-weight: 600;
        font-family: inherit;
        padding: 12px 20px;
        border-radius: var(--v2-radius-button);
        cursor: pointer;
        min-height: 44px;
        transition: filter 0.15s;
      }
      .sw-primary:hover { filter: brightness(1.06); }
      .sw-primary:disabled {
        background: var(--v2-surface-hover);
        color: var(--sw-faint);
        cursor: not-allowed;
        filter: none;
      }

      /* ── fields ──────────────────────────────────────────────────────── */
      .sw-field { display: flex; flex-direction: column; gap: 6px; }
      .sw-label { font-size: 11.5px; font-weight: 600; color: var(--v2-text-secondary); }
      .sw-label-block { display: block; margin: 0 0 8px; }
      .sw-optional { font-weight: 400; color: var(--sw-faint); }
      .sw-hint { font-size: 11.5px; color: var(--sw-faint); line-height: 1.45; }
      .sw-question { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
      .sw-rule { height: 1px; background: var(--v2-surface); }

      .sw-input {
        width: 100%;
        box-sizing: border-box;
        background: var(--v2-bg);
        border: 1px solid var(--v2-border);
        border-radius: var(--v2-radius-button);
        color: var(--v2-text-primary);
        font-size: 14px;
        font-family: inherit;
        padding: 11px 13px;
        outline: none;
        min-height: 44px;
      }
      .sw-input:focus { border-color: var(--sw-accent); }
      .sw-textarea { resize: none; font-size: 13.5px; }

      /* ── two big choices ─────────────────────────────────────────────── */
      .sw-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .sw-choice {
        text-align: start;
        cursor: pointer;
        border: 1px solid var(--v2-border);
        background: var(--v2-bg);
        border-radius: 14px;
        padding: 13px 14px;
        font-family: inherit;
        min-height: 44px;
      }
      .sw-choice-on {
        border: 1.5px solid var(--sw-accent);
        background: color-mix(in srgb, var(--sw-accent) 10%, transparent);
      }
      .sw-choice-head { display: flex; align-items: center; gap: 8px; }
      .sw-choice-icon { width: 15px; height: 15px; flex: 0 0 auto; color: var(--v2-text-muted); }
      .sw-choice-on .sw-choice-icon { color: var(--sw-accent); }
      .sw-choice-title { font-size: 13.5px; font-weight: 600; color: var(--v2-text-primary); }
      .sw-choice-note {
        display: block;
        margin-top: 4px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--v2-text-muted);
      }

      /* ── length pills ────────────────────────────────────────────────── */
      .sw-pills { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
      /* Compact, and squared off: a 999px pill reads as a filter tag, and
         these are answers. 36px is a comfortable pointer target; the phone
         rules below take them back to 44 for a thumb. */
      .sw-pill {
        cursor: pointer;
        border: 1px solid var(--v2-border);
        background: var(--v2-bg);
        color: var(--v2-text-secondary);
        border-radius: 9px;
        padding: 7px 12px;
        font-size: 12.5px;
        font-family: inherit;
        min-height: 36px;
      }
      .sw-pill-on {
        border: 1.5px solid var(--sw-accent);
        background: color-mix(in srgb, var(--sw-accent) 12%, transparent);
        color: var(--v2-text-primary);
        font-weight: 600;
      }
      .sw-pill-other { border-style: dashed; padding: 0 4px 0 9px; display: inline-flex; align-items: center; }
      /* Wide enough for the words AND the number spinner.
         At 118px the placeholder ran under the up/down arrows, so the field
         read as clipped text rather than as something to type in. */
      .sw-pill-input {
        width: 172px;
        border: none;
        background: transparent;
        color: var(--v2-text-primary);
        font-size: 13px;
        font-family: inherit;
        padding: 7px 2px 7px 0;
        outline: none;
      }
      .sw-pill-input::placeholder { color: var(--v2-text-muted); }

      /* ── the three shapes ────────────────────────────────────────────── */
      .sw-shapes { display: flex; flex-direction: column; gap: 10px; }
      .sw-shape {
        text-align: start;
        cursor: pointer;
        border: 1px solid var(--v2-border);
        background: var(--v2-bg);
        border-radius: 14px;
        padding: 14px 16px;
        display: flex;
        gap: 13px;
        align-items: flex-start;
        font-family: inherit;
        min-height: 44px;
      }
      .sw-shape-on {
        border: 1.5px solid var(--sw-accent);
        background: color-mix(in srgb, var(--sw-accent) 10%, transparent);
      }
      .sw-shape-open { display: block; cursor: default; }
      .sw-shape-trigger {
        display: flex;
        gap: 13px;
        align-items: flex-start;
        width: 100%;
        text-align: start;
        border: none;
        background: transparent;
        padding: 0;
        cursor: pointer;
        font-family: inherit;
        color: inherit;
      }
      .sw-shape-text { min-width: 0; }
      .sw-shape-title { display: block; font-size: 14px; font-weight: 600; color: var(--v2-text-primary); }
      .sw-shape-note {
        display: block;
        margin-top: 3px;
        font-size: 12.5px;
        line-height: 1.45;
        color: var(--v2-text-muted);
      }
      .sw-shape-on .sw-shape-note { color: var(--v2-text-secondary); }

      .sw-radio {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 1.5px solid var(--sw-faint);
        flex: 0 0 auto;
        margin-top: 2px;
        box-sizing: border-box;
      }
      .sw-radio[data-on='1'] {
        border: 5px solid var(--sw-accent);
        background: var(--v2-bg);
      }

      /* ── the price, inside its own answer ────────────────────────────── */
      .sw-priced { margin-top: 13px; padding-inline-start: 31px; }
      .sw-money { display: flex; flex-direction: column; gap: 6px; }
      .sw-money-box {
        display: inline-flex;
        align-items: stretch;
        border: 1px solid var(--v2-border);
        border-radius: var(--v2-radius-button);
        overflow: hidden;
        background: var(--v2-bg);
        max-width: 260px;
      }
      .sw-money-code {
        display: grid;
        place-items: center;
        padding: 0 12px;
        background: var(--v2-surface);
        color: var(--v2-text-secondary);
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      }
      .sw-money-input {
        width: 120px;
        border: none;
        background: transparent;
        color: var(--v2-text-primary);
        /* 17px, not 15: iOS zooms the whole page on a focused input under 16. */
        font-size: 17px;
        font-weight: 600;
        font-family: inherit;
        padding: 11px 12px;
        outline: none;
      }
      /*
       * ──────────────────────────────────────────────────────────────────────
       * ONE GRID FOR THE PLAN AND ITS SCHEDULE.
       *
       * Four rows, four labels of different lengths — "Paid", "Split into",
       * "every", "first payment" — each followed by its control. Laid out as
       * flex rows they started at four different x positions, so a block that
       * describes ONE arrangement read as four unrelated settings.
       *
       * A fixed label column lines every control up. The width is set for the
       * longest label at this size rather than measured, which is what keeps
       * it stable while the owner changes the answer.
       * ──────────────────────────────────────────────────────────────────────
       */
      .sw-plan,
      .sw-schedule-row {
        display: grid;
        grid-template-columns: 94px minmax(0, 1fr);
        align-items: center;
        gap: 10px;
      }
      .sw-plan { margin-top: 12px; }

      /* One track, the answer raised inside it. Kept from the panel this
         replaces, where every short exclusive choice is drawn this way. */
      .sw-segment {
        display: inline-flex;
        padding: 2px;
        border: 1px solid var(--v2-border);
        background: var(--v2-bg);
        border-radius: 999px;
        /* Both, and they are not the same thing: a grid item STRETCHES to its
           column by default, which turned every segment into a full-width bar
           with its options floating in the middle of it. */
        align-self: center;
        justify-self: start;
      }
      .sw-segment-option {
        border: none;
        background: transparent;
        color: var(--v2-text-secondary);
        font-size: 12.5px;
        font-family: inherit;
        padding: 7px 14px;
        border-radius: 999px;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s, color 0.15s;
      }
      .sw-segment-option:hover { color: var(--v2-text-primary); }
      .sw-segment-on {
        background: var(--v2-surface);
        color: var(--v2-text-primary);
        font-weight: 500;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
      }

      /* The schedule, which only a plan has. Indented under its own answer so
         it reads as part of the price rather than as a new question. */
      /*
       * No box of its own.
       *
       * It sat in a bordered, filled card INSIDE the bordered, tinted answer
       * that owns it, inside the bordered panel — three frames deep for one
       * sentence about money. A rule and some air say "this belongs to the
       * price above it" without drawing another edge.
       */
      .sw-schedule {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--v2-border);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .sw-count-group { display: flex; align-items: center; gap: 8px; justify-self: start; }
      /* The first-payment row carries a segment AND, sometimes, a number after
         it. It wraps rather than squeezing either one. */
      /*
       * The first-payment row holds a segment and, when "later" is chosen, a
       * number and a word after it. Three things in the control column: they
       * sit in a line, with a gap of their own, and wrap together rather than
       * squeezing the segment.
       */
      /*
       * The first-payment row holds three things, not two: a segment and, when
       * "later" is chosen, a number and the word after it. A two-column grid
       * would push the third onto a line of its own — the same fault the
       * "payments" word had — so this row is flex instead.
       *
       * The label keeps the grid's 94px, which is what holds this row in line
       * with the three above it.
       */
      .sw-schedule-row-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        row-gap: 8px;
      }
      .sw-schedule-row-wrap > .sw-label:first-child { flex: 0 0 94px; }
      .sw-schedule-count {
        width: 58px;
        text-align: center;
        border: 1px solid var(--v2-border);
        border-radius: 9px;
        background: var(--v2-surface);
        color: var(--v2-text-primary);
        font-size: 13px;
        font-weight: 600;
        font-family: inherit;
        padding: 7px 9px;
        outline: none;
        min-height: 36px;
      }
      .sw-schedule-count:focus { border-color: var(--sw-accent); }
      /* Aligned with the controls, not with the labels: it is the answer the
         four rows produce, not a fifth question. */
      .sw-schedule-sum {
        margin: 0;
        grid-column: 2;
        padding-inline-start: 104px;
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--v2-text-secondary);
      }

      /* ── card or invoice ─────────────────────────────────────────────── */
      .sw-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .sw-way {
        text-align: start;
        cursor: pointer;
        border: 1px solid var(--v2-border);
        background: var(--v2-bg);
        border-radius: 14px;
        padding: 16px;
        font-family: inherit;
        min-height: 44px;
      }
      .sw-way-on {
        border: 1.5px solid var(--sw-accent);
        background: color-mix(in srgb, var(--sw-accent) 10%, transparent);
      }
      .sw-way-head { display: flex; align-items: center; gap: 9px; }
      .sw-way-title { font-size: 14.5px; font-weight: 600; color: var(--v2-text-primary); }
      .sw-way-note {
        display: block;
        margin-top: 6px;
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--v2-text-muted);
      }
      .sw-way-on .sw-way-note { color: var(--v2-text-secondary); }

      /* ── requirement rows ────────────────────────────────────────────── */
      .sw-needs { display: flex; flex-direction: column; gap: 9px; }
      .sw-need {
        display: flex;
        align-items: flex-start;
        gap: 11px;
        padding: 13px 14px;
        border-radius: var(--v2-radius-button);
        border: 1px solid var(--v2-border);
        background: var(--v2-bg);
      }
      .sw-need-done {
        border-color: rgba(34, 197, 139, 0.35);
        background: rgba(34, 197, 139, 0.07);
      }
      .sw-need-now {
        border: 1.5px solid rgba(245, 158, 11, 0.45);
        background: rgba(245, 158, 11, 0.07);
      }
      .sw-need-waiting { opacity: 0.8; }
      .sw-need-icon { flex: 0 0 auto; margin-top: 1px; display: inline-flex; }
      .sw-need-text { flex: 1; min-width: 0; }
      .sw-need-title { display: block; font-size: 13px; font-weight: 600; }
      .sw-need-note {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--v2-text-secondary);
      }
      .sw-need-action {
        flex: 0 0 auto;
        border: none;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        padding: 9px 13px;
        border-radius: 10px;
        cursor: pointer;
        min-height: 44px;
      }
      .sw-need-trailing { flex: 0 0 auto; font-size: 11.5px; color: var(--sw-faint); }

      /* ── the note card ───────────────────────────────────────────────── */
      .sw-card {
        border: 1px solid var(--v2-border);
        border-radius: 14px;
        background: var(--v2-surface);
        padding: 15px 16px;
      }
      .sw-card-head {
        margin: 0;
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--v2-text-muted);
      }
      .sw-card-list {
        margin: 9px 0 0;
        padding-inline-start: 18px;
        font-size: 12.5px;
        line-height: 1.75;
        color: var(--v2-text-secondary);
      }

      /* ── the phone ───────────────────────────────────────────────────────
         Below 640 the dialog is a sheet: no second column, no step labels,
         one full-width action. Everything that was beside something is now
         under it. */
      @media (max-width: 640px) {
        .sw-head { padding: 14px 16px; }
        .sw-stepper { padding: 12px 16px 0; gap: 5px; }
        .sw-step-label { display: none; }

        .sw-body {
          grid-template-columns: minmax(0, 1fr);
          gap: 16px;
          padding: 16px;
        }
        .sw-rail { display: none; }
        .sw-rail-compact { display: block; }

        .sw-title { font-size: 19px; }

        .sw-foot {
          flex-direction: column-reverse;
          align-items: stretch;
          gap: 8px;
          padding: 14px 16px calc(14px + env(safe-area-inset-bottom, 0px));
        }
        .sw-foot-side { flex-direction: column-reverse; align-items: stretch; gap: 8px; }
        .sw-primary { width: 100%; font-size: 15px; padding: 15px; min-height: 52px; }
        .sw-note { text-align: center; }

        /* Side by side, neither of a pair has room to be read or pressed. */
        .sw-choices { grid-template-columns: minmax(0, 1fr); }
        .sw-pair { grid-template-columns: minmax(0, 1fr); }

        /* The money box earns the full width it needs for a long currency. */
        .sw-money-box { max-width: none; width: 100%; }
        .sw-money-input { flex: 1; width: auto; }
        .sw-priced { padding-inline-start: 0; }

        /* An action under its text, full width, rather than squeezed beside it. */
        .sw-need { flex-wrap: wrap; }
        .sw-need-action { width: 100%; margin-top: 11px; font-size: 13px; padding: 12px; }
        .sw-need-trailing { width: 100%; margin-top: 6px; }

        /* 94px of label is a quarter of a phone. The label goes above its
           control, which is also the only way the longer ones fit. */
        .sw-plan,
        .sw-schedule-row {
          grid-template-columns: minmax(0, 1fr);
          gap: 6px;
        }
        .sw-schedule-sum { padding-inline-start: 0; }

        /* A four-option segment does not fit 358px. It scrolls on its own
           rather than shrinking its labels to nothing. */
        .sw-segment { max-width: 100%; overflow-x: auto; }
        .sw-segment-option { padding: 9px 14px; }

        /* A length pill is a thumb target before it is a chip. */
        .sw-pill { flex: 1 0 auto; text-align: center; min-height: 44px; font-size: 13px; }
        .sw-pill-other { flex: 1 0 100%; }
        .sw-pill-input { width: 100%; }
      }

      @media (prefers-reduced-motion: reduce) {
        .sw-primary { transition: none; }
      }
`;

export function WizardStyles() {
  return <style dangerouslySetInnerHTML={{ __html: WIZARD_CSS }} />;
}
