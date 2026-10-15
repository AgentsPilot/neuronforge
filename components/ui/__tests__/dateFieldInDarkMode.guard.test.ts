/**
 * A native date field has to be READABLE, and its calendar button has to be
 * findable, in dark mode and on a phone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A GUARD AND NOT A RENDER TEST
 *
 * Everything here is drawn by the BROWSER, not by React. The editable date
 * text, the separators between its parts and the little calendar button are all
 * shadow pseudo-elements of the engine's own date control; jsdom has no such
 * control and renders `<input type="date">` as an empty box. So a render test
 * can assert the element exists and can assert nothing at all about whether a
 * person can see what is in it. The rules are in the class list, which is why
 * the class list is what is checked.
 *
 * THE TWO FAULTS THIS PINS, both reported from a phone against the quote dialog
 *
 * (a) THE ICON WAS PAINTED THE COLOUR OF THE FIELD BEHIND IT. `color-scheme:
 *     dark` already makes the engine draw the indicator in light ink — that is
 *     what the property is for. The class list ALSO inverted the indicator, a
 *     second correction of the same thing, which turned it back to near-black
 *     on a near-black field. Each half was correct on its own and together they
 *     cancelled, so the control looked absent rather than mis-styled. An
 *     invisible button is indistinguishable from a missing feature.
 *
 * (b) THE FIELD RAN OFF THE EDGE OF THE SCREEN. A date control has a wide
 *     intrinsic width, and a grid child may not shrink below its intrinsic
 *     width unless told it may. In a two-column row on a phone the field pushed
 *     its own column wider than the dialog and took its border and its calendar
 *     button off-screen with it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const input = readFileSync(join(__dirname, '..', 'input.tsx'), 'utf8');

/** The classes applied only to date-like inputs. */
const dateClasses = input.slice(input.indexOf('isDateInput &&'), input.indexOf('className\n'));

describe('the browser is told which theme it is drawing into', () => {
  const css = readFileSync(join(__dirname, '..', '..', '..', 'app', 'globals.css'), 'utf8');

  it('once, at the root, where it inherits from', () => {
    /*
     * `color-scheme` is an inherited property, so one declaration on the
     * document element reaches every native control on the page — including the
     * dozen raw `<input type="date">` that never used this component, several
     * of which ask for `color-scheme: inherit` and were inheriting nothing.
     */
    expect(css).toMatch(/:root\s*\{[\s\S]*?color-scheme:\s*light/);
    expect(css).toMatch(/\.dark\s*\{\s*color-scheme:\s*dark/);
  });

  it('and NOT a second time on the field itself', () => {
    /*
     * THIS IS THE FIX, NOT AN OMISSION.
     *
     * The component declared `[color-scheme:light] dark:[color-scheme:dark]`.
     * Both are one class of specificity, so which one applied was decided by
     * their order in the GENERATED stylesheet, not by the order they appear in
     * the class list. With `light` last, the engine drew a light-UI control
     * inside a dark dialog — dark glyphs and a near-black calendar button on a
     * near-black field — which reads as an empty date and a missing button.
     *
     * Inheritance cannot race with itself, so the field declares nothing and
     * takes the root's answer.
     */
    expect(dateClasses).not.toContain('color-scheme');
  });

  it('covers every input the engine draws itself', () => {
    // A time and a datetime-local have the same shadow control and the same
    // problem; leaving one out fixes the field the bug was found on and no more.
    expect(input).toContain("type === 'date'");
    expect(input).toContain("type === 'datetime-local'");
    expect(input).toContain("type === 'time'");
  });
});

describe('the calendar button', () => {
  /*
   * EVERY PLACE THAT CAN STYLE IT, not just this component.
   *
   * The first version of this guard checked `input.tsx` alone and passed while
   * the button was black on black on screen, because the rules actually doing
   * it were in two STYLESHEETS — one of them `!important`, which no utility
   * class on an input could have outranked anyway. There were four copies of
   * the same invert in three files; removing any one changed nothing visible,
   * which is exactly how it survived being "fixed" twice.
   *
   * So the check follows the control rather than the file: every CSS rule that
   * targets the indicator, wherever it lives.
   */
  const STYLESHEETS = [
    join(__dirname, '..', '..', '..', 'app', 'globals.css'),
    join(__dirname, '..', '..', '..', 'app', 'v2', 'globals-v2.css'),
  ];

  /** Declaration blocks whose selector names the calendar indicator. */
  const indicatorRules = (): string[] =>
    STYLESHEETS.flatMap(file => {
      const css = readFileSync(file, 'utf8');
      // Strip comments first: these rules carry long explanations that mention
      // the very words being searched for.
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
      return bare
        .split('}')
        .filter(block => block.includes('calendar-picker-indicator'))
        .map(block => block.slice(block.indexOf('{') + 1));
    });

  it('is styled by rules that exist, so this guard is not vacuous', () => {
    // If the selectors are ever renamed, the assertions below would pass by
    // finding nothing at all.
    expect(indicatorRules().length).toBeGreaterThan(0);
  });

  /*
   * The fix is `color-scheme`, and it is complete on its own. Anything that
   * repaints the indicator on top of it is a second correction of a corrected
   * thing, which is how it came out invisible in the first place.
   */
  it('is not inverted on top of an already-corrected colour', () => {
    expect(dateClasses).not.toContain('invert');
    for (const rule of indicatorRules()) {
      expect(rule).not.toContain('invert');
    }
  });

  it('nor darkened by a brightness filter', () => {
    expect(dateClasses).not.toContain('brightness');
    for (const rule of indicatorRules()) {
      expect(rule).not.toContain('brightness');
    }
  });

  /*
   * Opacity is allowed and is not a colour correction: it de-emphasises a
   * control the owner needs only occasionally. The floor matters though — faint
   * enough and it is the original complaint again, by a different route.
   */
  it('stays visible at rest, and comes up on hover', () => {
    const idle = dateClasses.match(/calendar-picker-indicator\]:opacity-(\d+)/)?.[1];

    expect(Number(idle)).toBeGreaterThanOrEqual(70);
    expect(dateClasses).toContain(']:hover:opacity-100');
  });
});

describe('and it is the same colour as the field beside it', () => {
  /*
   * THE LAST PLACE THIS HID.
   *
   * After the invert was gone the field was still visibly darker than the
   * amount field next to it — same component, same classes, same row. A rule in
   * `globals-v2.css`, scoped to any date input inside a Radix dialog, set
   * `background-color: var(--v2-bg) !important`: the PAGE colour, where every
   * other control in that dialog uses `--v2-surface`.
   *
   * It cannot be fixed by changing the value either. The booking dialog's
   * fields are `--v2-bg` and the quote dialog's are `--v2-surface`, so any
   * single forced colour mismatches one of them. A blanket rule cannot know
   * which surface a field sits on; the component's own class does.
   */
  const STYLESHEETS = [
    join(__dirname, '..', '..', '..', 'app', 'globals.css'),
    join(__dirname, '..', '..', '..', 'app', 'v2', 'globals-v2.css'),
  ];

  /** Declaration blocks whose selector targets a date/time input itself. */
  const dateFieldRules = (): string[] =>
    STYLESHEETS.flatMap(file => {
      const bare = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      return bare
        .split('}')
        .filter(
          block =>
            /input\[type="(date|datetime-local|time)"\]/.test(block) &&
            // The control itself, not its shadow parts.
            !block.includes('::-webkit')
        )
        .map(block => block.slice(block.indexOf('{') + 1));
    });

  it('is targeted by rules, so this guard is not vacuous', () => {
    expect(dateFieldRules().length).toBeGreaterThan(0);
  });

  it('has no stylesheet dictating its fill', () => {
    for (const rule of dateFieldRules()) {
      expect(rule).not.toContain('background');
    }
  });

  it('and the component still sets one, so the field is never transparent', () => {
    const input = readFileSync(join(__dirname, '..', 'input.tsx'), 'utf8');

    expect(input).toContain('bg-[var(--v2-surface,var(--background))]');
  });
});

describe('and it fits the screen it is on', () => {
  it('is allowed to shrink below its intrinsic width', () => {
    expect(dateClasses).toContain('min-w-0');
  });

  it('is laid out one per row on a phone in the quote dialog', () => {
    /*
     * The amount and the expiry read well side by side on a desk and cannot
     * both fit on a phone, where each column is about 160px and a date control
     * will not go that narrow. Checked here rather than in the dialog's own
     * tests because it is the same defect as `min-w-0` above seen from the
     * parent's side: either one alone still overflows.
     */
    const dialog = readFileSync(
      join(__dirname, '..', '..', 'crm', 'contact-drawer', 'ProposalBuilderModal.tsx'),
      'utf8'
    );
    const row = dialog.slice(dialog.indexOf('grid grid-cols'), dialog.indexOf('proposal-valid-until-error'));

    expect(row).toContain('grid-cols-1 sm:grid-cols-2');
    // Both cells, since either one left out widens the whole track again.
    expect(row.match(/<div className="min-w-0">/g) ?? []).toHaveLength(2);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * AND NOWHERE RE-INVERTS IT LOCALLY.
 *
 * The task drawer's date icon was still black on dark long after the shared
 * fix landed, because the fix was never in one place to begin with. The same
 * `filter: invert(1) brightness(0.8)` sat in SIX files — `input.tsx`,
 * `globals.css`, `globals-v2.css` twice, and a `<style jsx>` block copied into
 * `CRMTaskModal` and `TasksSection`.
 *
 * The two component copies are the reason the global correction looked like it
 * had done nothing: `.dark .date-input-fix::-webkit-calendar-picker-indicator`
 * is two classes, and it out-specifies the stylesheet's
 * `html.dark input[type="date"]::-webkit-calendar-picker-indicator`. A local
 * copy does not merely duplicate the rule, it WINS over the corrected one.
 *
 * `color-scheme: dark` is set once, globally, and that is the whole mechanism.
 * Nothing below it needs to say anything about this button's colour.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('no file re-inverts the calendar button', () => {
  const { readdirSync, statSync } = require('fs') as typeof import('fs');

  /** Every source file that could carry a rule, comments stripped. */
  const sources: Array<[string, string]> = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(tsx|ts|css)$/.test(entry) && !/__tests__/.test(full)) {
        sources.push([full, readFileSync(full, 'utf8')]);
      }
    }
  };

  walk(join(__dirname, '..', '..', '..', 'components'));
  walk(join(__dirname, '..', '..', '..', 'app'));

  /* Comments go first: these files necessarily record WHY the invert is gone,
     and naming the thing they forbid must not count as doing it. */
  const withoutComments = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('scanned a meaningful number of files', () => {
    // A walk that silently found nothing would pass the assertion below while
    // checking precisely zero rules.
    expect(sources.length).toBeGreaterThan(200);
  });

  it('leaves the engine to colour it', () => {
    const offenders = sources
      .filter(([, source]) => /calendar-picker-indicator/.test(source))
      .filter(([, source]) => /filter:\s*invert/.test(withoutComments(source)))
      .map(([file]) => file.slice(file.indexOf('neuronforge/') + 'neuronforge/'.length));

    expect(offenders).toEqual([]);
  });
});
