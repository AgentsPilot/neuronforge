/**
 * The composition layer, as a table of expectations.
 *
 * These exist because of the failure the layer was built to end: an owner
 * switched template and got a recolour. Tokens changed, markup did not, and
 * every archetype rendered the same card-and-shadow page. So the assertions
 * below care about three things that would each silently bring that back:
 *
 *   1. A composition that emits nothing, or emits the wrong one.
 *   2. Rules that cannot reach the page because they are unscoped, or that
 *      reach the WHOLE page because they are scoped to nothing.
 *   3. A physical property, which is a bug that only appears in Hebrew.
 */

import { compositionCss, compositionFor } from '../compositions';
import { COMPOSITIONS, resolveComposition } from '@/lib/website-builder/pageTheme';
import { ARCHETYPES } from '@/lib/website-builder/archetypes';

const SCOPE = '[data-ap-site]';

describe('resolveComposition', () => {
  it('takes the composition a theme names', () => {
    expect(resolveComposition({ composition: 'warm' })).toBe('warm');
    expect(resolveComposition({ composition: 'bold' })).toBe('bold');
  });

  /*
   * The regression this function was rewritten for.
   *
   * Themes are stored whole, so every page saved before this field existed
   * carries no composition. Defaulting those to Stone applied Stone's defining
   * move — no cards, no shadow, no radius, just a hairline — to dark pages
   * built entirely out of cards. That is not a different design, it is a
   * stripped one, and it hit every live page at once.
   */
  it('returns null rather than guessing for a theme that names none', () => {
    expect(resolveComposition({})).toBeNull();
    expect(resolveComposition(null)).toBeNull();
    expect(resolveComposition(undefined)).toBeNull();
  });

  it('returns null for a composition no stylesheet implements', () => {
    expect(resolveComposition({ composition: 'brutalist' })).toBeNull();
    expect(resolveComposition({ composition: '' })).toBeNull();
  });
});

describe('compositionFor', () => {
  it('prefers the composition the theme states', () => {
    expect(compositionFor({ composition: 'bold', id: 'bloom' } as never)).toBe('bold');
  });

  /*
   * The common case on live data: archetypes shipped before compositions, so a
   * stored theme usually names an archetype and no composition.
   */
  it('falls back to the archetype the theme names', () => {
    expect(compositionFor({ id: 'lumen' } as never)).toBe('bold');
    expect(compositionFor({ id: 'bloom' } as never)).toBe('warm');
    expect(compositionFor({ id: 'stone' } as never)).toBe('stone');
  });

  it('applies nothing to a theme that is only a palette', () => {
    expect(compositionFor({ colors: {}, fonts: {} } as never)).toBeNull();
    expect(compositionFor(null)).toBeNull();
    expect(compositionFor({ id: 'a-template-that-no-longer-exists' } as never)).toBeNull();
  });
});

describe('compositionCss', () => {
  it.each(COMPOSITIONS)('%s emits rules, every one of them scoped', composition => {
    const css = compositionCss(composition, SCOPE);
    expect(css.length).toBeGreaterThan(200);

    /*
     * Every selector must carry the scope. An unscoped rule leaks out of the
     * previewed site and restyles the surrounding app shell — the website
     * preview renders inside it.
     */
    const selectors = css
      .split('}')
      .map(chunk => chunk.split('{')[0].trim())
      .filter(sel => sel && !sel.startsWith('@') && !sel.startsWith('/*'));

    expect(selectors.length).toBeGreaterThan(0);
    selectors.forEach(sel => {
      expect(sel).toContain(SCOPE);
    });
  });

  it('honours the scope it is given rather than hardcoding one', () => {
    const css = compositionCss('stone', 'html[data-public-surface]');
    expect(css).toContain('html[data-public-surface]');
    expect(css).not.toContain('[data-ap-site]');
  });

  /*
   * Hebrew is a live locale. A physical property here is a bug that passes
   * every English review and mirrors the page for a Hebrew business.
   */
  it.each(COMPOSITIONS)('%s uses logical properties only', composition => {
    const css = compositionCss(composition, SCOPE);
    const physical = [
      'padding-left', 'padding-right', 'margin-left', 'margin-right',
      'border-left', 'border-right', 'text-align: left', 'text-align: right',
    ];
    physical.forEach(prop => {
      expect(css).not.toContain(prop);
    });
  });

  /*
   * The compositions have to actually differ. Three identical stylesheets would
   * pass every other test here and reproduce the original complaint exactly.
   */
  it('gives each composition a genuinely different rule set', () => {
    const rendered = COMPOSITIONS.map(c => compositionCss(c, SCOPE));
    expect(new Set(rendered).size).toBe(COMPOSITIONS.length);
  });

  it('never reaches for !important to beat the blocks', () => {
    COMPOSITIONS.forEach(composition => {
      const css = compositionCss(composition, SCOPE);
      // The one exception is the reduced-motion override, which must win over
      // inline animation styles the motion library writes at runtime.
      const importants = css.match(/!important/g) ?? [];
      expect(importants.length).toBeLessThanOrEqual(2);
    });
  });
});

describe('the archetypes, through the composition layer', () => {
  it('every shipped archetype resolves to a composition that emits rules', () => {
    ARCHETYPES.forEach(archetype => {
      const composition = compositionFor(archetype);
      expect(composition).not.toBeNull();
      expect(COMPOSITIONS).toContain(composition!);
      expect(compositionCss(composition!, SCOPE).length).toBeGreaterThan(200);
    });
  });

  /*
   * The whole point of separating composition from flavour: more archetypes
   * than compositions, so a palette can be swapped without redrawing a section.
   */
  it('reuses compositions across archetypes rather than one each', () => {
    const used = new Set(ARCHETYPES.map(a => compositionFor(a)));
    expect(used.size).toBeLessThan(ARCHETYPES.length);
    expect(used.size).toBeGreaterThan(1);
  });
});

/*
 * The requirement, stated as a test.
 *
 * Three stylesheets that differ only in colour would pass every other
 * assertion here and reproduce the original complaint exactly — same sections,
 * new palette. So each section that carries a design decision has to be
 * STRUCTURALLY different between the three: different box, different grid,
 * different alignment. Colour is excluded from the comparison deliberately,
 * because colour is the flavour's job, not the composition's.
 */
describe('each composition renders the same section differently', () => {
  const SECTIONS = [
    'apc-panel',     // the offer box: ruled row / paper cell / plan card
    'apc-grid',      // how a set is laid out
    'apc-sec-head',  // heading beside, above, or opposite its content
    'apc-close',     // the closing block
    'apc-quote',     // the pull-quote
    'apc-facts',     // the number band
    'apc-qa',        // a question
  ];

  /** The structural declarations for one class, colour stripped out. */
  function structure(composition: (typeof COMPOSITIONS)[number], cls: string): string {
    const css = compositionCss(composition, SCOPE);
    const rules = css
      .split('}')
      .filter(chunk => chunk.includes(`.${cls} {`) || chunk.includes(`.${cls},`))
      .join(' ');
    return rules
      .replace(/(background|color|border-color|box-shadow)[^;]*;/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  it.each(SECTIONS)('%s is built differently by at least two compositions', cls => {
    const shapes = COMPOSITIONS.map(c => structure(c, cls)).filter(Boolean);
    expect(shapes.length).toBeGreaterThan(1);
    expect(new Set(shapes).size).toBeGreaterThan(1);
  });

  /*
   * Stone's whole character. If this ever passes a border-radius or a filled
   * panel, Stone has quietly become the same card design as the other two.
   */
  it('stone draws rules where the others draw boxes', () => {
    // The LAST match: the shared skeleton declares a default panel first and
    // the composition overrides it by source order, so the first match is the
    // thing being overridden rather than the answer.
    const chunks = compositionCss('stone', SCOPE).split('}')
      .filter(c => c.includes('.apc-panel {'));
    const panel = chunks[chunks.length - 1] ?? '';
    expect(panel).toContain('border-radius: 0');
    expect(panel).toContain('border-block-start: 1px solid');
    expect(panel).toContain('box-shadow: none');

    expect(compositionCss('warm', SCOPE)).toContain('border-radius: 18px');
    expect(compositionCss('bold', SCOPE)).toContain('border-radius: 20px');
  });

  it('only bold sets its small print in mono', () => {
    expect(compositionCss('bold', SCOPE)).toContain('IBM Plex Mono');
    expect(compositionCss('stone', SCOPE)).not.toContain('IBM Plex Mono');
    expect(compositionCss('warm', SCOPE)).not.toContain('IBM Plex Mono');
  });

  /*
   * Stone and Warm both list offers as numbered ruled rows — Stone's index is
   * muted ink, Warm's is the brand violet. Bold does not number at all: its
   * offers are a two-up card grid whose first card carries the accent, so an
   * index would be numbering things the reader is meant to compare, not follow.
   */
  it('numbers rows in the two designs that have rows, and not in the one that does not', () => {
    expect(compositionCss('stone', SCOPE)).toContain('tabular-nums');
    expect(compositionCss('warm', SCOPE)).toContain('tabular-nums');

    const boldRows = compositionCss('bold', SCOPE);
    expect(boldRows).toContain('repeat(2, 1fr)');
    expect(boldRows).toContain('.apc-panel--lead');
  });
});

/*
 * A guard against a mistake made twice while building this.
 *
 * The rules live in template literals, so a backtick anywhere inside one — in a
 * comment, quoting a class name — closes the string early. The file still
 * parses often enough to reach the browser, and what ships is a fragment of the
 * intended CSS with the rest interpreted as code. `compositionCss` throwing is
 * the good case; silently emitting half a stylesheet is the bad one.
 */
describe('the CSS literals', () => {
  it.each([...COMPOSITIONS, 'stone' as const])('%s emits without throwing', composition => {
    expect(() => compositionCss(composition, SCOPE)).not.toThrow();
  });

  it('produces balanced braces, so no rule is left unterminated', () => {
    COMPOSITIONS.forEach(composition => {
      const css = compositionCss(composition, SCOPE);
      const open = (css.match(/\{/g) ?? []).length;
      const close = (css.match(/\}/g) ?? []).length;
      expect(open).toBe(close);
    });
  });

  it('contains no stray backtick, which would truncate the stylesheet', () => {
    COMPOSITIONS.forEach(composition => {
      expect(compositionCss(composition, SCOPE)).not.toContain('`');
    });
  });
});

/*
 * The breakpoints must measure the PAGE, not the browser window.
 *
 * The editor previews a phone by putting the site in a 375px-wide div in its
 * own document. A media query cannot see that div — it reads the window — so on
 * a wide screen every desktop breakpoint matched inside the phone frame, and
 * the split hero ran two columns in 375px with the headline broken to one word
 * a line. It was not a preview-only lie: the preview simply could not answer
 * the question it was being asked.
 */
describe('size rules are container queries', () => {
  const scopes = ['[data-ap-site]', 'html[data-public-surface]'];

  for (const composition of COMPOSITIONS) {
    for (const scope of scopes) {
      const css = compositionCss(composition, scope);

      it(`${composition} @ ${scope} declares the container the rules name`, () => {
        expect(css).toContain('container-name: apc');
        expect(css).toContain('container-type: inline-size');
      });

      it(`${composition} @ ${scope} has no width media query left`, () => {
        expect(css).not.toMatch(/@media\s*\(\s*(min|max)-width/);
      });

      it(`${composition} @ ${scope} queries by container`, () => {
        expect(css).toMatch(/@container apc \(min-width: \d+px\)/);
      });
    }
  }

  /*
   * Size containment on the root element affects viewport propagation and
   * scrolling. `body` is the full page width and an ancestor of every section,
   * so it answers the same question without that cost.
   */
  it('contains body rather than html on the document scope', () => {
    const css = compositionCss('bold', 'html[data-public-surface]');
    expect(css).toContain('html[data-public-surface] > body {');
    expect(css).not.toMatch(/html\[data-public-surface\]\s*\{\s*\n?\s*container-type/);
  });
});
