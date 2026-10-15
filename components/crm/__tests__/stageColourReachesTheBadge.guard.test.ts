/**
 * The owner's pipeline colour reaches the badge, and a phone number reads
 * forwards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COLOUR HAD NEVER BEEN APPLIED
 *
 * The badge asked for its colour like this:
 *
 *     `bg-[${stage.color}]/20 text-[${stage.color}]`
 *
 * Tailwind generates arbitrary values by SCANNING THE SOURCE at build time. A
 * class assembled from a database string appears in no source file, so no CSS
 * is emitted for it and the element receives a class name with nothing behind
 * it. Every stage rendered identically, and every colour an owner picked in
 * their pipeline was discarded without a word.
 *
 * It is a silent failure in the worst way: the code reads as though it works,
 * the class name looks plausible in devtools, and the only symptom is that two
 * stages look the same. There is no class-based fix, because the values are
 * per-user data — an inline style is the only thing that can carry a colour
 * chosen at runtime.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE PLUS WAS ON THE WRONG END
 *
 * `+1 201 364 3030` rendered as `12013643030+` for every Hebrew reader. The raw
 * string sat in a right-to-left row, and the bidi algorithm treats a leading
 * `+` as a neutral and reorders it to the other end. Every international number
 * in the CRM was shown backwards to the users who read it most.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const list = fs.readFileSync(
  path.join(process.cwd(), 'components/crm/CRMContactList.tsx'),
  'utf8'
);

/**
 * The same file with its comments removed.
 *
 * The assertions below forbid the broken pattern, and the fix is documented in
 * a comment that QUOTES the broken pattern. Matched against the raw file, the
 * guard fails on the explanation of the bug it is guarding against. `code` is
 * what the browser runs; `list` is for assertions about the prose.
 */
const code = list.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the stage colour is a style, not a class', () => {
  it('never builds a Tailwind class from the stored colour again', () => {
    /* The exact shape of the bug. Any runtime-interpolated arbitrary value is
       the same failure wearing different brackets. */
    expect(code).not.toMatch(/bg-\[\$\{/);
    expect(code).not.toMatch(/text-\[\$\{/);
  });

  it('returns a style object carrying the hex', () => {
    expect(list).toMatch(/const stageTone = \(stageKey: string \| undefined\)/);
    expect(list).toMatch(/background: `\$\{stage\.color\}2E`, color: stage\.color/);
  });

  it('applies it to the badge', () => {
    expect(list).toMatch(/style=\{stageTone\(contact\.stage\)\}/);
  });

  it('refuses a malformed colour instead of painting the badge invisible', () => {
    /* A bad value in a style attribute is not a no-op: it can render text on a
       transparent ground, or the same colour on itself. */
    expect(list).toMatch(/\/\^#\[0-9a-f\]\{6\}\$\/i\.test\(stage\.color\)/);
  });

  it('falls back on the stage TYPE, which still carries meaning', () => {
    // Grey for everything would throw away the one signal that remains.
    expect(list).toMatch(/const byType: Record<string, string> = \{/);
    expect(list).toMatch(/prospect: '#f59e0b'/);
  });
});

describe('this guard reads the code, not its own explanation', () => {
  it('strips the comments first', () => {
    /*
     * The fix is documented in a comment that quotes the broken pattern. Without
     * this, the first assertion fails on the sentence explaining the bug — which
     * is how a guard comes to be deleted as "flaky" by the next person.
     */
    expect(list).toMatch(/bg-\[\$\{/);
    expect(code).not.toMatch(/bg-\[\$\{/);
  });
});

describe('the phone number keeps its own direction', () => {
  it('is isolated with bdi', () => {
    expect(list).toMatch(/<bdi className="text-\[13px\] tabular-nums/);
  });

  it('is no longer printed raw into the row', () => {
    expect(code).not.toMatch(/\{contact\.phone \|\| '-'\}/);
  });

  it('uses tabular figures, which is the point of a number column', () => {
    expect(list).toMatch(/tabular-nums/);
  });
});

describe('the row earns its height', () => {
  it('no cell is on the old padding', () => {
    /* `py-4` on seven cells put five contacts on a screen that fits fourteen. */
    expect(code).not.toMatch(/className="px-4 py-4/);
  });

  it('name and email are one cell, not two columns', () => {
    expect(code).not.toMatch(/handleSort\('email'\)/);
    /* The secondary line carries the phone too below `sm`, so it renders
       whenever EITHER exists. */
    expect(list).toMatch(/\{\(contact\.email \|\| contact\.phone\) && \(/);
  });

  it('tags keep their column but lose their dashes', () => {
    /*
     * The column rendered "-" on every row for an account with no tags at all,
     * spending a seventh of the width to say nothing. The column stays, because
     * it is how tags are scanned; the placeholder goes, because an empty cell
     * says the same thing quietly.
     */
    expect(code).not.toMatch(/<span className="text-sm text-\[var\(--v2-text-muted\)\]">-<\/span>/);
    expect(list).toMatch(/contact\.tags\?\.slice\(0, 2\)\.map/);
    expect(list).toMatch(/\{t\('crm\.table\.tags'\)\}/);
  });

  it('drops the tags column on a phone, not the stage', () => {
    /* A tag is a filter you apply; a stage is a fact you scan for. If one
       column has to go at 390px, it is this one. */
    expect(list).toMatch(/className="hidden px-2 py-2 md:table-cell md:px-4"/);
  });

  it('keeps the columns sortable, which is why this layout was chosen', () => {
    for (const column of ['name', 'phone', 'stage', 'updated_at']) {
      expect({ column, sortable: list.includes(`handleSort('${column}')`) }).toEqual({
        column,
        sortable: true,
      });
    }
  });
});

describe('initials work in both scripts', () => {
  it('takes the first letter of each of two words', () => {
    // "שלמה המלך" and "Eyal Omer" both have to give two letters.
    expect(list).toMatch(/\.slice\(0, 2\)\s*\n\s*\.map\(word => \[\.\.\.word\]\[0\] \?\? ''\)/);
  });

  it('still fills the circle for a contact with no name', () => {
    expect(list).toMatch(/\[\.\.\.\(contact\.email \?\? '-'\)\]\[0\] \?\? '-'/);
  });
});

describe('it works on a phone', () => {
  it('folds the phone column away below sm rather than scrolling sideways', () => {
    /*
     * Five columns on a 390px screen scroll horizontally, and a horizontally
     * scrolling list is one people stop scrolling: whatever sits past the fold
     * may as well not be rendered.
     */
    expect(list).toMatch(/className="hidden px-2 py-2 whitespace-nowrap sm:table-cell sm:px-4"/);
    /* The header's own `px-4` needs no mobile variant: it is hidden below `sm`,
       so that padding only ever applies where it is right. */
    expect(list).toMatch(/className="hidden whitespace-nowrap px-4 py-2\.5 text-start[^"]*sm:table-cell"/);
  });

  it('puts the number on the secondary line where the column is hidden', () => {
    // A contact row with no way to reach the person is just a name.
    expect(list).toMatch(/<span className="sm:hidden">\s*\n\s*<bdi className="tabular-nums">\{contact\.phone\}<\/bdi>/);
  });

  it('keeps the number isolated there too', () => {
    /* The mobile line is the SAME bidi hazard as the column: a `+` loose in a
       right-to-left row moves to the wrong end wherever it is rendered. */
    const mobile = list.slice(list.indexOf('<span className="sm:hidden">'));
    expect(mobile.slice(0, 200)).toMatch(/<bdi/);
  });

  it('lets the identity cell truncate instead of widening the table', () => {
    /*
     * A table cell sizes to its content: `min-w-0` and `truncate` inside it do
     * nothing on their own, and a long email simply pushes the stage and the
     * date off screen. `max-w-0` is what makes the cell absorb the remainder.
     */
    expect(list).toMatch(/className="w-full max-w-0 px-2 py-2 sm:px-4"/);
    expect(list).toMatch(/<div className="flex min-w-0 items-center gap-2\.5">/);
  });

  it('narrows the gutters below sm', () => {
    // px-4 on five columns spends ~40px of a 390px screen on nothing.
    expect(code).not.toMatch(/className="px-4 py-2/);
    expect(list).toMatch(/px-2 py-2 sm:px-4/);
  });
});

describe('the activity column reads as one kind of fact', () => {
  it('formats the fallback date in the page’s language, not the browser’s', () => {
    /*
     * A bare `toLocaleDateString()` takes the BROWSER's locale, which is not
     * the language the page is being read in, and renders `06/10/2026` — eight
     * digits whose day and month cannot be told apart, in a column whose other
     * rows say "19 שעות".
     */
    expect(code).not.toMatch(/toLocaleDateString\(\)/);
    expect(list).toMatch(/const locale = language === 'he' \? 'he-IL'/);
    expect(list).toMatch(/day: 'numeric',\s*\n\s*month: 'short',/);
  });

  it('prints the year only when it is not this one', () => {
    /* Four characters on every row to say what the reader already knows, in
       the narrowest column on the table. */
    expect(list).toMatch(
      /when\.getFullYear\(\) === new Date\(\)\.getFullYear\(\) \? \{\} : \{ year: 'numeric' \}/
    );
  });

  it('keeps every header on one line', () => {
    /*
     * "קשר אחרון" wrapped to two lines and made the whole header row taller;
     * Spanish has "Último contacto" and would do the same. Applied to all of
     * them rather than the one that happened to break.
     */
    const heads = list.match(/py-2\.5 text-(start|end) text-xs/g) ?? [];
    const nowrapped = list.match(/whitespace-nowrap[^"]*py-2\.5 text-(start|end) text-xs/g) ?? [];

    expect({ heads: heads.length, nowrapped: nowrapped.length }).toEqual({
      heads: heads.length,
      nowrapped: heads.length,
    });
  });
});

describe('the responsive columns stay aligned', () => {
  it('has the same number of headers as cells', () => {
    /*
     * Six of each: checkbox, name, phone, stage, tags, last contact. A table
     * with more headers than cells shears every row, and it is a silent
     * failure — the markup is valid and the browser simply guesses.
     */
    const heads = (list.match(/<th[\s>]/g) ?? []).length;
    const cells = (list.match(/<td[\s>]/g) ?? []).length;

    expect({ heads, cells }).toEqual({ heads: 6, cells: 6 });
  });

  it('hides each header at the SAME breakpoint as its cell', () => {
    /*
     * The real hazard of a responsive table. Hide a `td` at `sm` and leave its
     * `th` visible and every column after it slides one place along, at exactly
     * the width where nobody is looking.
     */
    /* `[\s\S]{0,40}` because a long className sits on the line BELOW its `<th`,
       and a same-line-only pattern silently counts one of the two. */
    const hiddenHeads = (list.match(/<th[\s\S]{0,40}className="hidden[^"]*(sm|md):table-cell/g) ?? []).length;
    const hiddenCells = (list.match(/<td[\s\S]{0,40}className="hidden[^"]*(sm|md):table-cell/g) ?? []).length;

    expect({ hiddenHeads, hiddenCells }).toEqual({ hiddenHeads: 2, hiddenCells: 2 });

    /* And at the same widths: phone at `sm`, tags at `md`. */
    expect(list).toMatch(/className="hidden whitespace-nowrap px-4 py-2\.5[^"]*sm:table-cell"/);
    expect(list).toMatch(/className="hidden whitespace-nowrap px-2 py-2\.5[^"]*md:table-cell md:px-4"/);
  });
});

describe('the contact export cannot carry a formula', () => {
  it('goes through the shared serialiser', () => {
    /*
     * It built `"${String(cell).replace(/"/g, '""')}"` by hand, which is valid
     * CSV and no defence: a spreadsheet evaluates a cell beginning `=`, `+`,
     * `-` or `@` once the quotes are parsed away.
     *
     * And this is the worst export to leave open. `first_name`, `email` and
     * `phone` are written by the PUBLIC contact form, which takes no
     * authentication, so the data is a stranger's to choose.
     */
    expect(list).toMatch(/toCsvFile\(\[headers, \.\.\.rows\]\)/);
    expect(code).not.toMatch(/replace\(\/"\/g, '""'\)/);
  });

  it('writes an unambiguous date', () => {
    // `06/10/2026` cannot be read as a day and a month by a person or a sheet.
    expect(list).toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });
});
