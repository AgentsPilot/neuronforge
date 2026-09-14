/**
 * The three sets of bones, as CSS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A STRING AND NOT A STYLESHEET FILE
 *
 * The rules have to be scoped to whatever selector the emitter was given. Five
 * surfaces own their whole document (`html[data-public-surface]`) and three
 * render inside the app shell and scope to their own wrapper (`[data-ap-site]`).
 * A static `.css` file cannot vary its own selector, and stamping an extra
 * `data-composition` attribute would mean editing all eight mount sites and
 * every future one — the kind of wiring where one surface gets forgotten and
 * renders unstyled with nothing saying why.
 *
 * Emitting from `PublicThemeStyle` instead means a surface gets its composition
 * by the same act that gives it its colours. There is no way to have one and not
 * the other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE RULES CAN WIN
 *
 * The blocks are built from Tailwind utilities — `rounded-2xl`, `p-8`,
 * `shadow-lg`. Every rule here is at least `<scope> .ap-x`, which is one class
 * plus an attribute or element selector against Tailwind's single class, so
 * these win on specificity without a single `!important`.
 *
 * What they cannot beat is an inline `style`. That is why the blocks had their
 * inline `borderRadius` / `boxShadow` / `border` declarations removed: those
 * three properties are exactly the ones a composition needs to own, and an
 * inline declaration is unreachable from here at any specificity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY RULE IS IN LOGICAL PROPERTIES
 *
 * `padding-inline`, `margin-inline-start`, `border-inline-start`, `text-align:
 * start`. Hebrew is a live locale, not a future one, and the compositions were
 * drawn to work in both directions without a mirrored stylesheet. A single
 * `padding-left` here is a bug that only shows up on a Hebrew page.
 *
 * Colour, type and radius all come through `--ap-*`, which is what lets six
 * flavours share three compositions: Bloom wears Warm's bones in blush, Lumen
 * and Aster wear Bold's in lime and indigo.
 *
 * @module components/public/compositions
 */

import type { Composition, PageTheme } from '@/lib/website-builder/pageTheme';
import { resolveComposition } from '@/lib/website-builder/pageTheme';
import { getArchetype } from '@/lib/website-builder/archetypes';

/**
 * Shared bones. Everything every composition agrees on.
 *
 * Mostly this is the job of undoing decoration the blocks hardcode — the
 * gradient orbs, the blur panels, the hover lifts — so that a composition starts
 * from something flat and adds back only what it actually wants. A composition
 * that wants orbs can switch them on again; none of the three does.
 */
/**
 * Shape defaults, emitted for EVERY public surface whether it has a composition
 * or not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SEPARATE FROM THE SKELETON BELOW
 *
 * The blocks used to carry their corner and shadow inline —
 * `style={{ borderRadius: theme?.borderRadius || '1.5rem' }}` — which is how a
 * theme's radius reached the page, and also why no stylesheet could ever
 * restyle it. Removing those inline declarations is what makes compositions
 * possible, but on its own it would leave a page with NO archetype falling back
 * to whatever fixed Tailwind radius the markup happened to carry, silently
 * losing the radius its theme asked for.
 *
 * So the same values come back as rules keyed on the tokens. A page with no
 * composition ends up exactly where it started; a page with one has these
 * overridden by source order.
 */
/**
 * The element the size rules measure.
 *
 * `container-type: inline-size` applies size containment, and the one scope that
 * is not an element is `html[data-public-surface]` — containment on the root
 * element affects viewport propagation and scrolling, which is not a trade worth
 * making for a breakpoint. `body` is directly inside it, is the full page width,
 * and is an ancestor of every section, so it answers the same question safely.
 */
function containerHost(s: string): string {
  return s.startsWith('html') ? `${s} > body` : s;
}

function base(s: string): string {
  return `
    /*
     * The surface is the container every size rule measures.
     *
     * The breakpoints were media queries and the type scale was in vw — both
     * measure the BROWSER WINDOW. The editor previews a phone by putting the
     * site in a 375px-wide div in its own document, so on a wide screen every
     * desktop breakpoint matched inside the phone frame and the headline
     * resolved at its desktop size: two columns in 375px, one word a line. The
     * preview was not lying about production; it could not answer the question
     * it was being asked, because neither a media query nor a vw can see a div.
     *
     * A container query and cqi both measure THIS element, which is the page's
     * own width in the preview and in production alike. This layer is always
     * emitted, composed page or not, because cqi with no container in scope
     * silently falls back to the viewport — straight back to the bug.
     */
    ${containerHost(s)} {
      container-type: inline-size;
      container-name: apc;
    }
    ${s} .apc-panel,
    ${s} .apc-qa { border-radius: var(--ap-radius-lg); }
    ${s} .apc-btn { border-radius: var(--ap-radius-md); }

    /*
     * A control that is present but cannot be used.
     *
     * The one case is a landing page whose single service has been deleted: the
     * button is still the page's call to action and the owner is still looking
     * at it in the editor, so removing it would make the section look broken
     * rather than blocked. Every composition inherits this, because "disabled"
     * is a state rather than a style — and a design that wants its own can
     * still override it at the same specificity.
     */
    ${s} .apc-btn[disabled],
    ${s} .apc-btn[aria-disabled="true"] {
      opacity: 0.45;
      cursor: not-allowed;
      pointer-events: none;
    }
    ${s} .apc-shot { border-radius: var(--ap-radius-md); background-size: cover; background-position: 50% 30%; }

    /* The empty slot.
       A tint mixed from the template's own ink, so it reads as part of the
       design rather than as a grey box dropped into it — and because it is a
       tint of the ground it stays quiet on a near-black page and on warm paper
       alike. It holds the shape a photograph will take, which is what lets an
       owner see where one belongs. */
    ${s} .apc-shot--empty {
      background-image: none;
      background-color: color-mix(in srgb, var(--ap-text) 7%, var(--ap-bg));
      border: 1px solid var(--ap-border);
    }
    ${s} .apc-close { border-radius: var(--ap-radius-lg); }

    @media (prefers-reduced-motion: reduce) {
      ${s} * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
    }
  `;
}

/**
 * Shared bones, emitted only for a surface that HAS a composition.
 *
 * Mostly the job of undoing decoration the blocks hardcode — the gradient orbs,
 * the accent underlines — so a composition starts from something flat and adds
 * back only what it wants. None of this may apply to an uncomposed page: those
 * orbs are part of how that page looks today, and removing them would be a
 * redesign nobody asked for.
 */
function skeleton(s: string): string {
  return `
    ${s} .apc-decor { display: none; }
    ${s} .apc-idx { display: none; }

    /*
     * The coloured rounded badge behind an icon.
     *
     * Its fill is an inline gradient, which no rule here can override at any
     * specificity — so a composition that does not want one cannot restyle it,
     * only decline to draw it. Stone and Warm decline: neither mockup has a
     * single icon badge, they mark a section with a number or a rule. Bold
     * keeps them and squares them off.
     */
    ${s} .apc-icon { box-shadow: none; }

    ${s} .apc-sec { padding-block: var(--ap-space-8); }
    ${s} .apc-sec-head { margin-block-end: var(--ap-space-6); }
    ${s} .apc-eyebrow { display: block; }

    ${s} .apc-btn {
      display: inline-flex; align-items: center; justify-content: center;
      gap: var(--ap-space-2); white-space: nowrap; cursor: pointer;
      transition: background-color .18s ease, color .18s ease, border-color .18s ease;
    }

    @container apc (min-width: 820px) {
      ${s} .apc-shot--big { grid-column: span 2; grid-row: span 2; }
    }
    ${s} .apc-stat { text-align: center; }

    /* The bar: wordmark at the start, links in the middle, one control at the
       end. It had padding and a measure but no layout, so all three stacked
       vertically and the header rendered as three rows. */
    ${s} .apc-nav {
      display: flex; align-items: center; justify-content: space-between;
      gap: 18px; padding-block: 20px;
    }
    /* The links take the slack so the control stays pinned to the end. */
    ${s} .apc-menu { flex: 1 1 auto; justify-content: center; }
    ${s} .apc-footer { padding-block: 22px; }

    ${s} .apc-panel {
      background: var(--ap-surface);
      border: 1px solid var(--ap-border);
    }
    /* ── Structure every template shares ─────────────────────────────────
       Grids, aspect ratios and flow. What a template then decides is the look:
       whether a panel has a rule or a fill, what its corner is, which face its
       numbers are set in. Putting the scaffolding here is what stops a section
       rendering unstyled under any template that has not restated it. */

    ${s} .apc-bar { width: 100%; }
    ${s} .apc-menu { display: none; gap: 26px; align-items: baseline; }
    @container apc (min-width: 880px) { ${s} .apc-menu { display: flex; } }
    ${s} .apc-menu-item { display: inline-flex; align-items: baseline; gap: 7px; }
    ${s} .apc-wm-img { height: 30px; width: auto; display: block; }

    ${s} .apc-hero-shot { display: block; margin-block-start: 44px; aspect-ratio: 16 / 9; }

    ${s} .apc-split { display: grid; gap: 34px; align-items: start; }
    @container apc (min-width: 880px) { ${s} .apc-split { grid-template-columns: 1fr 1fr; gap: 54px; } }
    ${s} .apc-split-copy { display: grid; gap: 14px; align-content: start; }
    ${s} .apc-split-shot { aspect-ratio: 4 / 5; }
    ${s} .apc-prose { margin: 0; max-width: 58ch; }

    ${s} .apc-steps { list-style: none; margin: 0; padding: 0; display: grid; }
    ${s} .apc-step { display: grid; grid-template-columns: 44px 1fr; gap: 16px; }
    ${s} .apc-step h3 { margin: 0; }
    ${s} .apc-step p { margin: 4px 0 0; }

    ${s} .apc-facts-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; }
    ${s} .apc-facts-list li {
      display: flex; justify-content: space-between; gap: 20px; align-items: baseline;
    }
    ${s} .apc-facts-list i { font-style: normal; }

    ${s} .apc-quote { margin: 0; }
    ${s} .apc-quote cite { display: block; font-style: normal; margin-block-start: 22px; }

    ${s} .apc-stat-n { display: block; line-height: 1; font-variant-numeric: tabular-nums; }
    ${s} .apc-stat-l { display: block; margin-block-start: 8px; }

    ${s} .apc-team { display: grid; gap: 20px; }
    @container apc (min-width: 820px) { ${s} .apc-team { grid-template-columns: repeat(3, 1fr); } }
    ${s} .apc-member { display: grid; gap: 12px; }
    ${s} .apc-member-shot { aspect-ratio: 1; }
    ${s} .apc-member h3, ${s} .apc-member p { margin: 0; }

    ${s} .apc-gal { display: grid; gap: 10px; grid-template-columns: repeat(2, 1fr); }
    @container apc (min-width: 820px) {
      ${s} .apc-gal { grid-template-columns: repeat(4, 1fr); grid-auto-rows: 160px; }
    }

    ${s} .apc-qa-list { display: grid; }
    ${s} .apc-qa-q {
      width: 100%; display: flex; align-items: baseline; justify-content: space-between;
      gap: 20px; background: none; border: 0; padding: 0; cursor: pointer;
      text-align: start; font-family: inherit; color: var(--ap-text);
    }
    ${s} .apc-qa-mark { font-style: normal; line-height: 1; }
    ${s} .apc-qa-a { margin: 14px 0 0; max-width: 62ch; }

    ${s} .apc-logos {
      display: flex; flex-wrap: wrap; gap: 38px; align-items: center; justify-content: center;
    }
    ${s} .apc-logo-img { height: 26px; width: auto; filter: grayscale(1); opacity: .7; }

    ${s} .apc-video { position: relative; aspect-ratio: 16 / 9; overflow: hidden; }
    ${s} .apc-video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

    ${s} .apc-signup { display: flex; flex-wrap: wrap; gap: 12px; max-width: 520px; }
    ${s} .apc-field { flex: 1 1 220px; }

    ${s} .apc-footer-row {
      display: flex; flex-wrap: wrap; gap: 18px 40px; align-items: baseline;
      justify-content: space-between;
    }
    ${s} .apc-footer-who { display: grid; gap: 4px; }
    ${s} .apc-footer-contact, ${s} .apc-footer-links { display: flex; flex-wrap: wrap; gap: 18px; }

    /* Two classes, so the modifier outranks the compositions' own .apc-cta-row
       rule whatever the source order. With one class it lost to
       justify-content: flex-start further down — which in Hebrew put the
       closing button hard against the right edge of a centred panel. */
    ${s} .apc-cta-row.apc-cta-row--centred { justify-content: center; }
    /* The opening section gets more room above it than the ones that follow.
       It took the same rhythm as every other section, so the headline began
       almost against the header instead of after a breath — which is most of
       what makes a hero read as an opening rather than as the first row. */
    /* Two classes, deliberately.
       The hero IS a section, so .apc-sec and .apc-hero land on the same
       element — and each composition restates .apc-sec padding after the
       skeleton runs, which silently won. Matching both classes outranks it
       whatever the order. */
    ${s} .apc-sec.apc-hero {
      display: block;
      padding-block-start: clamp(48px, 9cqi, 96px);
      padding-block-end: clamp(44px, 8cqi, 78px);
    }

    /* Rhythm inside the hero.
       The shape renders the headline, the lede and the controls as bare
       siblings, so without this they sit flush against one another — the
       blocks got their spacing from Tailwind classes the shapes do not carry. */
    ${s} .apc-hero [data-apc="headline"] { margin: 0 0 clamp(14px, 2cqi, 20px); }
    ${s} .apc-hero .apc-lede { margin: 0 0 clamp(22px, 3cqi, 30px); }
    ${s} .apc-hero .apc-eyebrow { margin: 0 0 clamp(12px, 1.6cqi, 16px); }
    ${s} .apc-cta-row { display: flex; flex-wrap: wrap; gap: 12px; }

    /* Every section head and list needs the same, for the same reason. */
    ${s} .apc-sec h2 { margin: 0 0 clamp(10px, 1.4cqi, 14px); }
    ${s} .apc-sec-head + * { margin-block-start: 0; }
    /* The frame a brand surface renders inside: a smart link, an invoice, a
       proposal. Not a website section, so it takes only the ground and the
       measure — but its panels, controls and fields are the template's, which
       is what makes one business look like one business across all of them. */
    ${s} .apc-shell { background: var(--ap-bg); color: var(--ap-text); }
    ${s} .apc-footer-year { white-space: nowrap; }
    ${s} .apc-member-bio { grid-column: 1 / -1; }
    ${s} .apc-hero-card { position: relative; }
    ${s} .apc-chip { display: none; }
    ${s} .apc-chip-k { display: block; margin-block-end: 5px; }
    ${s} .apc-chip-dot { display: none; }
    ${s} .apc-tick { display: none; }
    ${s} .apc-step--photo { background-size: cover; background-position: center; }
    ${s} .apc-field--tall { min-height: 120px; }
    /* ── THE PAGE CONTAINER ──────────────────────────────────────────────
       The SECTION is the container: a measure, centred in the window, with
       responsive padding inside it. Children then need no rule of their own —
       a block element fills the container, and one with its own narrower
       measure (a 14ch headline, a 44ch lede) sits at the start edge because
       its default margin is zero.

       Two earlier attempts got this wrong in opposite directions. Giving every
       child margin-inline: auto centred each one independently, so a headline
       and the lede under it floated at different offsets. Giving them
       margin-inline-end: auto fixed that but pinned the container itself to one
       edge, so on a wide screen the whole page sat on one side.

       clamp rather than a media query: 20px of air on a phone and 40px on a
       desktop, moving continuously between them. */
    ${s} .apc-sec {
      max-width: 1180px;
      margin-inline: auto;
      padding-inline: clamp(20px, 5cqi, 40px);
    }

    ${s} .apc-bar,
    ${s} .apc-footer { padding-inline: clamp(20px, 5cqi, 40px); }

    ${s} .apc-nav,
    ${s} .apc-footer-row { max-width: 1180px; margin-inline: auto; }

    /* A banded section still needs its colour to reach both window edges, and
       it cannot: it is inside the measure like every other section. The shadow
       paints the band outward and the clip stops it spilling down the page. */
    ${s} .apc-quote-band {
      box-shadow: 0 0 0 100vw var(--ap-surface);
      clip-path: inset(0 -100vw);
    }

    /* Nothing may scroll the page sideways.
       A 100vw shadow, a wide table, a long unbroken word — any of them adds
       horizontal scroll, and a page that scrolls sideways on a phone reads as
       "shifted to one side" rather than as an overflow. clip rather than
       hidden because hidden on an ancestor silently kills position:
       sticky for everything inside it. */
    ${s} { overflow-x: clip; }
    ${s} * { min-width: 0; }
    ${s} img, ${s} video, ${s} iframe { max-width: 100%; }

  `;
}

/**
 * STONE — ruled, numbered, type-led. No cards anywhere.
 *
 * Read off `stone-archetype.html` and `section-catalogue.html`. The defining
 * move is the ABSENCE of the box: where the other two draw a panel, Stone draws
 * a hairline and lets the type carry the section. Offers become numbered rows
 * (`42px 1fr 1.3fr auto`), the section head sits BESIDE its content at 880px,
 * controls are pills, and the closing block inverts to solid ink.
 */
function stone(s: string): string {
  return `
    ${s} .apc-sec { padding-block: clamp(36px, 7cqi, 56px) clamp(38px, 7.5cqi, 60px); }

    ${s} .apc-sec-head { display: grid; gap: 14px; text-align: start; }
    ${s} .apc-sec-head > * { margin-inline: 0; }
    @container apc (min-width: 880px) {
      ${s} .apc-sec-head { grid-template-columns: 170px 1fr; gap: 34px; align-items: start; }
    }
    ${s} .apc-eyebrow {
      font-size: 13px; font-weight: 500; color: var(--ap-text-muted);
      letter-spacing: 0; text-transform: none;
      background: none; box-shadow: none; padding: 0; border-radius: 0; backdrop-filter: none;
    }
    ${s} .apc-sec h2 {
      font-size: var(--ap-scale-h2); line-height: 1.07; letter-spacing: -.035em;
      font-weight: 600; max-width: 20ch; margin: 0;
    }

    ${s} .apc-btn {
      border: 1px solid var(--ap-text); border-radius: 9999px;
      padding-block: 9px; padding-inline: 20px;
      font-size: 13px; font-weight: 600; background: transparent; color: var(--ap-text);
    }
    ${s} .apc-btn--solid { background: var(--ap-text); color: var(--ap-bg); border-color: var(--ap-text); }

    /* Offers as ruled rows. This is the section the mockup leads with. */
    ${s} .apc-rows { border-block-start: 1px solid var(--ap-border); }
    ${s} .apc-row-item {
      display: grid; gap: 8px 26px; padding-block: 22px; padding-inline: 0;
      border-block-end: 1px solid var(--ap-border); align-items: baseline;
      background: none; border-inline: 0; border-block-start: 0; border-radius: 0; box-shadow: none;
    }
    @container apc (min-width: 880px) {
      ${s} .apc-row-item { grid-template-columns: 42px 1fr 1.3fr auto; }
    }
    ${s} .apc-idx {
      display: block; font-size: 12px; color: var(--ap-text-muted); font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    ${s} .apc-row-end {
      display: flex; align-items: center; gap: 18px; white-space: nowrap;
    }
    ${s} .apc-price { font-size: 17px; font-weight: 600; letter-spacing: -.02em; color: var(--ap-text); }

    /* Every grid of cards collapses to the same ruled stack. */
    /* Stone stacks: one ruled column, no gap, the rules doing the separating.
       Safe to force, because a single column cannot be squeezed. */
    ${s} .apc-grid { display: grid; grid-template-columns: 1fr; gap: 0; }
    ${s} .apc-panel {
      background: transparent; box-shadow: none;
      border: 0; border-block-start: 1px solid var(--ap-border);
      border-radius: 0; padding-block: 22px; padding-inline: 0;
    }
    ${s} .apc-icon { display: none; }

    ${s} .apc-close {
      background: var(--ap-text); color: var(--ap-bg);
      border-radius: var(--ap-radius-lg); padding-block: 56px; padding-inline: 30px;
      text-align: center;
    }
    ${s} .apc-close h2 { color: var(--ap-bg); margin-inline: auto; max-width: 16ch; }
    ${s} .apc-close .apc-btn { border-color: var(--ap-bg); background: var(--ap-bg); color: var(--ap-text); }

    ${s} .apc-shot { border-radius: var(--ap-radius-lg); }

    ${s} .apc-quote { text-align: center; padding-block: 76px; }
    ${s} .apc-quote blockquote, ${s} .apc-quote p {
      font-size: var(--ap-scale-h2); line-height: 1.22; letter-spacing: -.035em;
      font-weight: 500; margin-inline: auto; max-width: 19ch; color: var(--ap-text);
    }

    /* The facts strip: hairlines showing through a bordered grid. */
    ${s} .apc-facts {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px;
      background: var(--ap-border); border-radius: var(--ap-radius-lg); overflow: hidden;
    }
    @container apc (min-width: 880px) { ${s} .apc-facts { grid-template-columns: repeat(4, 1fr); } }
    ${s} .apc-stat {
      background: var(--ap-bg); padding: 22px; text-align: start;
      border: 0; border-radius: 0;
    }

    ${s} .apc-qa {
      border-block-start: 1px solid var(--ap-border); padding-block: 20px; padding-inline: 0;
      border-radius: 0; border-inline: 0; border-block-end: 0; background: none; box-shadow: none;
    }

    ${s} [data-apc="headline"] {
      font-size: var(--ap-scale-h1); line-height: 1.03; letter-spacing: -.04em;
      font-weight: 600; max-width: 17ch; text-align: start;
    }
    ${s} .apc-lede {
      font-size: 16.5px; font-weight: 300; line-height: 1.7;
      color: var(--ap-text-muted); max-width: 42ch; text-align: start;
    }
    ${s} .apc-cta-row, ${s} .apc-trust { justify-content: flex-start; }

    ${s} .apc-nav { border-block-end: 0; }
    ${s} .apc-wm { font-size: 15px; font-weight: 600; letter-spacing: -.02em; }
    ${s} .apc-footer {
      border-block-start: 1px solid var(--ap-border);
      color: var(--ap-text-muted); font-weight: 300;
    }
    /* The closing block is one panel on the page ground, not a panel inside a
       band. Switching the band off leaves exactly the mockup's arrangement. */
    ${s} .apc-sec { --apc-band: var(--ap-bg); --apc-band-ink: var(--ap-text); }
    /* ── Elements the Stone renderers introduce ─────────────────────────── */

    /* The hero picture: after the copy, full width, at the panel radius. */
    ${s} .apc-hero-shot {
      display: block; margin-block-start: 44px;
      aspect-ratio: 16 / 9; background-size: cover; background-position: center;
      border-radius: var(--ap-radius-lg);
    }

    /* The numbered process list. */
    ${s} .apc-steps { list-style: none; margin: 0; padding: 0; display: grid; }
    ${s} .apc-step {
      display: grid; grid-template-columns: 42px 1fr; gap: 16px;
      padding-block: 18px; border-block-start: 1px solid var(--ap-border);
    }
    ${s} .apc-step:last-child { border-block-end: 1px solid var(--ap-border); }
    ${s} .apc-step h3 {
      margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.02em; color: var(--ap-text);
    }
    ${s} .apc-step p {
      margin: 4px 0 0; font-size: 14.5px; line-height: 1.65;
      color: var(--ap-text-muted); font-weight: 300;
    }

    /* Questions: a rule, the question, and a mark at the far end. */
    ${s} .apc-qa-list { display: grid; }
    ${s} .apc-qa-q {
      width: 100%; display: flex; align-items: baseline; justify-content: space-between;
      gap: 20px; background: none; border: 0; padding: 0; cursor: pointer;
      font-size: 16.5px; font-weight: 400; color: var(--ap-text); text-align: start;
      font-family: inherit;
    }
    ${s} .apc-qa-mark { font-style: normal; color: var(--ap-text-muted); font-size: 20px; line-height: 1; }
    ${s} .apc-qa-a {
      margin: 14px 0 0; font-size: 15px; line-height: 1.7;
      color: var(--ap-text-muted); font-weight: 300; max-width: 62ch;
    }

    /* The closing block centres its controls; everywhere else they start. */
    ${s} .apc-cta-row.apc-cta-row--centred { justify-content: center; }
    ${s} .apc-close p {
      color: var(--ap-bg); opacity: .72; margin: 0 auto 28px; max-width: 38ch;
      font-size: 16.5px; font-weight: 300;
    }
    ${s} .apc-close .apc-btn--ghost { background: transparent; color: var(--ap-bg); border-color: var(--ap-bg); }
    /* ── Split band: prose one side, picture the other ───────────────────── */
    ${s} .apc-split { display: grid; gap: 34px; align-items: start; }
    @container apc (min-width: 880px) { ${s} .apc-split { grid-template-columns: 1fr 1fr; gap: 54px; } }
    ${s} .apc-split-copy { display: grid; gap: 14px; align-content: start; }
    ${s} .apc-split-shot { aspect-ratio: 4 / 5; border-radius: var(--ap-radius-lg); }
    ${s} .apc-prose {
      margin: 0; font-size: 16.5px; line-height: 1.75;
      color: var(--ap-text-muted); font-weight: 300; max-width: 58ch;
    }

    /* A dated credentials list: label at the start, year at the far end. */
    ${s} .apc-facts-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; }
    ${s} .apc-facts-list li {
      display: flex; justify-content: space-between; gap: 20px; align-items: baseline;
      padding-block: 14px; border-block-start: 1px solid var(--ap-border);
      font-size: 15px; color: var(--ap-text);
    }
    ${s} .apc-facts-list li:last-child { border-block-end: 1px solid var(--ap-border); }
    ${s} .apc-facts-list i { font-style: normal; color: var(--ap-text-muted); font-size: 13px; }

    /* ── Quote band ──────────────────────────────────────────────────────── */
    ${s} .apc-quote-band { background: var(--ap-surface); }
    ${s} .apc-quote { margin: 0; }
    ${s} .apc-quote cite {
      display: block; font-style: normal; font-size: 13.5px;
      color: var(--ap-text-muted); font-weight: 400; margin-block-start: 22px;
    }

    /* ── Facts ───────────────────────────────────────────────────────────── */
    ${s} .apc-stat-n {
      display: block; font-size: 30px; font-weight: 600; letter-spacing: -.035em;
      line-height: 1; color: var(--ap-text); font-variant-numeric: tabular-nums;
    }
    ${s} .apc-stat-l {
      display: block; margin-block-start: 8px; font-size: 13px;
      color: var(--ap-text-muted); font-weight: 300;
    }

    /* ── Team ────────────────────────────────────────────────────────────── */
    ${s} .apc-team { display: grid; gap: 20px; }
    @container apc (min-width: 820px) { ${s} .apc-team { grid-template-columns: repeat(3, 1fr); } }
    ${s} .apc-member { display: grid; gap: 12px; }
    ${s} .apc-member-shot { aspect-ratio: 1; border-radius: var(--ap-radius-lg); }
    ${s} .apc-member h3 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.02em; }
    ${s} .apc-member p { margin: 0; font-size: 13.5px; color: var(--ap-text-muted); font-weight: 300; }
    ${s} .apc-member-bio { line-height: 1.7; }

    /* ── Gallery mosaic ──────────────────────────────────────────────────── */
    ${s} .apc-gal { display: grid; gap: 10px; grid-template-columns: repeat(2, 1fr); }
    @container apc (min-width: 820px) {
      ${s} .apc-gal { grid-template-columns: repeat(4, 1fr); grid-auto-rows: 160px; }
    }
    ${s} .apc-gal .apc-shot { border-radius: var(--ap-radius-lg); }
    /* Stone numbers its navigation the way it numbers everything else. */
    ${s} .apc-menu-idx {
      font-style: normal; font-size: 11px; color: var(--ap-text-muted);
      font-variant-numeric: tabular-nums;
    }
    ${s} .apc-menu { color: var(--ap-text-muted); font-size: 13.5px; }
    ${s} .apc-bar { padding-block: 20px; }
    ${s} .apc-logo { font-size: 17px; font-weight: 600; color: var(--ap-text-muted); }
    ${s} .apc-footer-tag { color: var(--ap-text-muted); font-size: 13.5px; font-weight: 300; }
    ${s} .apc-footer-year { color: var(--ap-text-muted); font-size: 12.5px; }
    ${s} .apc-member-bio { font-size: 13.5px; line-height: 1.7; }
    ${s} .apc-field {
      border: 1px solid var(--ap-border); border-radius: 9999px;
      padding-block: 12px; padding-inline: 20px; background: transparent; color: var(--ap-text);
    }
    ${s} .apc-video { border-radius: var(--ap-radius-lg); }
    /* ── Transcribed from stone-archetype.html ───────────────────────────
       The facts band is inset from the page edge and rounded, its cells padded
       28/24 with the figure at 32px — the mockup's own numbers, not a guess. */
    ${s} .apc-facts {
      margin-block-start: 56px; border: 1px solid var(--ap-border);
      border-radius: var(--ap-radius-lg);
    }
    ${s} .apc-stat { padding: 28px 24px; }
    ${s} .apc-stat-n { font-size: 32px; font-weight: 600; letter-spacing: -.035em; line-height: 1.05; }
    ${s} .apc-stat-l { font-size: 13.5px; color: var(--ap-text-muted); font-weight: 300; }
    ${s} .apc-sec-head { margin-block-end: 44px; gap: 18px; }
    ${s} .apc-split { gap: 44px; align-items: center; }
    /* The picture band: full measure, held off the page edge, 24px corners. */
    ${s} .apc-hero-shot { height: min(52vh, 430px); aspect-ratio: auto; background-position: 50% 26%; }
    ${s} .apc-quote-band { background: var(--ap-surface); }
    /* Stone keeps even this quiet — muted, not accented, because Stone has no
       accent colour at all. */
    ${s} .apc-price--open { color: var(--ap-text-muted); font-size: 13px; font-weight: 500; }
  `;
}

/**
 * WARM — paper, a serif, and cells rather than a row of equal cards.
 *
 * Read off `warm-archetype.html`. Offers are `.cell`s: 18px, white on warm
 * paper, a serif `h3`, and the content pushed apart with `space-between` so the
 * price sits at the foot of the box rather than beside the name. The section
 * head is a `.offer-head` — heading and its link on one baseline, pushed to
 * opposite ends — and the pull-quote carries a 44px violet rule above it.
 */
function warm(s: string): string {
  return `
    ${s} .apc-sec { padding-block: clamp(44px, 8cqi, 72px); }

    /* Heading and whatever sits beside it, on one baseline at opposite ends. */
    ${s} .apc-sec-head {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: 24px; flex-wrap: wrap; margin-block-end: 30px; text-align: start;
    }
    ${s} .apc-sec-head > * { margin-inline: 0; }
    ${s} .apc-eyebrow {
      font-family: "Heebo", system-ui, sans-serif; font-weight: 700;
      font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
      color: var(--ap-brand);
      background: none; box-shadow: none; padding: 0; border-radius: 0; backdrop-filter: none;
    }
    ${s} .apc-sec h2 {
      font-family: var(--ap-font-heading); font-weight: 400;
      font-size: var(--ap-scale-h2); line-height: 1.2; letter-spacing: -.018em; margin: 0;
    }

    ${s} .apc-btn {
      border: 1px solid var(--ap-text); border-radius: 9999px;
      padding-block: 11px; padding-inline: 24px; font-size: 14px; font-weight: 500;
      background: transparent; color: var(--ap-text);
    }
    ${s} .apc-btn--solid { background: var(--ap-brand); border-color: var(--ap-brand); color: var(--ap-on-brand); }

    /* Cells: even columns, but each box lays its own content out top-to-bottom
       with the price pushed to the foot. */
    /*
     * Gap only — never the column count.
     *
     * The blocks already size their grid to how many items there are: a single
     * plan is laid out in a max-w-lg container at one column. Forcing three
     * columns on top of that gave each card a third of 512px, and every word
     * wrapped onto its own line. What the composition owns is the rhythm
     * between boxes and the boxes themselves, not how many fit across.
     */
    ${s} .apc-grid { gap: 14px; }
    ${s} .apc-panel {
      border: 1px solid var(--ap-border); border-radius: 18px; padding: 26px;
      background: var(--ap-surface); box-shadow: none;
      display: flex; flex-direction: column; justify-content: space-between; gap: 12px;
    }
    ${s} .apc-panel h3 {
      font-family: var(--ap-font-heading); font-weight: 500; font-size: 19px; margin: 0 0 6px;
    }
    ${s} .apc-icon { display: none; }

    ${s} .apc-rows { display: grid; gap: 14px; border: 0; }
    ${s} .apc-row-item {
      background: var(--ap-surface); border: 1px solid var(--ap-border);
      border-radius: 18px; padding: 26px; box-shadow: none;
    }
    ${s} .apc-price { font-family: var(--ap-font-heading); font-weight: 400; font-size: 22px; color: var(--ap-text); }

    /* The ribbon: small facts on a tinted band rather than a bordered grid. */
    ${s} .apc-facts {
      display: flex; flex-wrap: wrap; gap: 28px; justify-content: space-between;
      background: var(--ap-brand-tint); border-radius: 18px; padding: 26px 30px;
    }
    ${s} .apc-stat { background: none; border: 0; border-radius: 0; text-align: start; padding: 0; }

    ${s} .apc-close {
      background: var(--ap-text); color: var(--ap-bg);
      border-radius: 18px; padding-block: 64px; padding-inline: 34px; text-align: center;
    }
    ${s} .apc-close h2 { color: var(--ap-bg); margin: 12px auto 16px; max-width: 17ch; }
    ${s} .apc-close .apc-btn { background: var(--ap-bg); border-color: var(--ap-bg); color: var(--ap-text); }

    ${s} .apc-shot { border-radius: 18px; }

    /* The rule above the quote is Warm's, and it is drawn rather than borrowed
       from a border so it can sit centred and short. */
    ${s} .apc-quote { padding-block: 64px; text-align: center; }
    ${s} .apc-quote::before {
      content: ""; display: block; width: 44px; height: 2px;
      background: var(--ap-brand); margin: 0 auto 30px;
    }
    ${s} .apc-quote blockquote, ${s} .apc-quote p {
      font-family: var(--ap-font-heading); font-weight: 400;
      font-size: var(--ap-scale-h2); line-height: 1.28; margin-inline: auto; max-width: 24ch;
      color: var(--ap-text);
    }

    ${s} .apc-qa {
      border: 1px solid var(--ap-border); border-radius: 18px;
      padding: 20px 24px; margin-block-end: 10px; background: var(--ap-surface); box-shadow: none;
    }

    ${s} [data-apc="headline"] {
      font-family: var(--ap-font-heading); font-weight: 400;
      font-size: var(--ap-scale-h1); line-height: 1.1; letter-spacing: -.022em;
      max-width: 15ch; text-align: start;
    }
    ${s} .apc-lede {
      font-size: 17px; font-weight: 300; line-height: 1.8;
      color: var(--ap-text-muted); max-width: 44ch; text-align: start;
    }
    ${s} .apc-cta-row, ${s} .apc-trust { justify-content: flex-start; }

    ${s} .apc-wm { font-family: var(--ap-font-heading); font-weight: 400; font-size: 17px; }
    ${s} .apc-footer {
      border-block-start: 1px solid var(--ap-border);
      color: var(--ap-text-muted); font-weight: 300;
    }
    /* The closing block is one panel on the page ground, not a panel inside a
       band. Switching the band off leaves exactly the mockup's arrangement. */
    ${s} .apc-sec { --apc-band: var(--ap-bg); --apc-band-ink: var(--ap-text); }
    /* ── Offers: ruled rows, not cells ───────────────────────────────────
       The cells in the Warm mockup are the ABOUT section. Its offer list is a
       ruled table: a violet index at the start edge, the name, the description,
       the price, and an outlined pill at the far end. */
    ${s} .apc-rows { display: block; border-block-start: 1px solid var(--ap-border); }
    ${s} .apc-row-item {
      display: grid; gap: 8px 28px; padding-block: 26px; padding-inline: 0;
      border: 0; border-block-end: 1px solid var(--ap-border);
      border-radius: 0; background: none; box-shadow: none; align-items: center;
    }
    @container apc (min-width: 880px) {
      ${s} .apc-row-item { grid-template-columns: 44px 1fr 1.4fr auto; }
    }
    ${s} .apc-idx {
      display: block; color: var(--ap-brand); font-weight: 600; font-size: 14px;
      font-variant-numeric: tabular-nums;
    }
    ${s} .apc-row-end { display: flex; align-items: center; gap: 20px; white-space: nowrap; }
    /* A figure is ink; "free" or "on request" is the accent, because it is an
       invitation rather than an amount. */
    ${s} .apc-price { font-family: var(--ap-font-heading); font-size: 21px; color: var(--ap-text); }
    /* ── Sections, in Warm's own register ────────────────────────────────
       Paper and a serif. Panels are soft 18px boxes on white, headings are the
       serif at book weight, and the accent appears once per section rather than
       on every element. Nothing is inverted except the closing block. */

    ${s} .apc-menu { color: var(--ap-text-muted); font-size: 14px; }
    ${s} .apc-menu-idx { color: var(--ap-brand); font-weight: 600; font-size: 12px; font-style: normal; }
    ${s} .apc-bar { padding-block: 18px; border-block-end: 1px solid var(--ap-border); }

    ${s} .apc-hero-shot { border-radius: 18px; }
    ${s} .apc-split-shot { border-radius: 18px; }
    ${s} .apc-prose { font-size: 17px; line-height: 1.85; color: var(--ap-text-muted); font-weight: 300; }

    ${s} .apc-step { padding-block: 20px; border-block-start: 1px solid var(--ap-border); }
    ${s} .apc-step:last-child { border-block-end: 1px solid var(--ap-border); }
    ${s} .apc-step h3 { font-family: var(--ap-font-heading); font-weight: 500; font-size: 18px; }
    ${s} .apc-step p { font-size: 14.5px; line-height: 1.7; color: var(--ap-text-muted); font-weight: 300; }

    ${s} .apc-facts-list li {
      padding-block: 14px; border-block-start: 1px solid var(--ap-border); font-size: 15px;
    }
    ${s} .apc-facts-list li:last-child { border-block-end: 1px solid var(--ap-border); }
    ${s} .apc-facts-list i { color: var(--ap-brand); font-size: 13px; font-weight: 600; }

    ${s} .apc-quote-band { background: var(--ap-brand-tint); }
    ${s} .apc-quote cite { font-size: 13px; letter-spacing: .14em; opacity: .62; }

    ${s} .apc-stat-n { font-family: var(--ap-font-heading); font-size: 34px; font-weight: 400; }
    ${s} .apc-stat-l { font-size: 13px; color: var(--ap-text-muted); font-weight: 300; }

    /* Warm's portraits are round — the one design in the set that softens a
       face rather than cropping it square. */
    ${s} .apc-member-shot { border-radius: 999px; }
    ${s} .apc-member h3 { font-family: var(--ap-font-heading); font-weight: 500; font-size: 18px; }
    ${s} .apc-member p { font-size: 13.5px; color: var(--ap-text-muted); font-weight: 300; }
    ${s} .apc-member-bio { line-height: 1.75; }

    ${s} .apc-gal .apc-shot { border-radius: 18px; }

    ${s} .apc-qa-q { font-size: 17px; font-weight: 500; font-family: var(--ap-font-heading); }
    ${s} .apc-qa-mark { color: var(--ap-brand); font-size: 22px; }
    ${s} .apc-qa-a { font-size: 15px; line-height: 1.75; color: var(--ap-text-muted); font-weight: 300; }

    ${s} .apc-logo { font-family: var(--ap-font-heading); font-size: 18px; opacity: .55; }
    ${s} .apc-video { border-radius: 18px; }
    ${s} .apc-field {
      border: 1px solid var(--ap-border); border-radius: 9999px;
      padding-block: 13px; padding-inline: 20px; background: var(--ap-surface); color: var(--ap-text);
    }
    ${s} .apc-footer-row { padding-block: 26px; }
    ${s} .apc-footer-tag { color: var(--ap-text-muted); font-size: 13.5px; font-weight: 300; }
    ${s} .apc-btn--ghost { background: transparent; color: var(--ap-bg); border-color: var(--ap-bg); }
    ${s} .apc-footer-year { color: var(--ap-text-muted); font-size: 12.5px; }
    /* ── Transcribed from warm-archetype.html ────────────────────────────
       The bento: cells rather than rows, the opening one inverted to night, any
       cell carrying a picture becoming the picture, and the index set in the
       serif at 34px in violet — which is the element that makes this design
       read as editorial rather than as a feature grid. */
    ${s} .apc-steps { display: grid; gap: 14px; }
    @container apc (min-width: 820px) {
      ${s} .apc-steps { grid-template-columns: repeat(3, 1fr); }
      ${s} .apc-step--lead { grid-column: span 2; }
    }
    ${s} .apc-step {
      display: flex; flex-direction: column; justify-content: space-between;
      border: 1px solid var(--ap-border); border-radius: 18px; padding: 26px;
      background: var(--ap-surface);
    }
    ${s} .apc-step:last-child { border-block-end: 1px solid var(--ap-border); }
    ${s} .apc-step--lead {
      background: var(--ap-text); border-color: var(--ap-text); color: var(--ap-bg);
    }
    ${s} .apc-step--lead h3, ${s} .apc-step--lead .apc-idx { color: var(--ap-bg); }
    ${s} .apc-step--lead p { color: color-mix(in srgb, var(--ap-bg) 76%, transparent); }
    ${s} .apc-step--photo { padding: 0; overflow: hidden; border: 0; min-height: 220px; }
    ${s} .apc-step--photo > * { display: none; }
    ${s} .apc-step .apc-idx {
      font-family: var(--ap-font-heading); font-size: 34px; font-weight: 300;
      color: var(--ap-brand); line-height: 1;
    }
    ${s} .apc-sec-head { max-width: 40ch; margin-block-end: 34px; }
    ${s} .apc-cta-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
    ${s} .apc-wm {
      font-family: var(--ap-font-heading); font-weight: 500; font-size: 17.5px; letter-spacing: -.01em;
    }
    /* A quiet secondary link: underlined by a rule rather than boxed. */
    ${s} .apc-btn--ghost {
      border: 0; border-block-end: 1px solid var(--ap-border); border-radius: 0;
      padding: 0 0 3px; font-size: 14.5px; color: var(--ap-text-muted); background: none;
    }
    ${s} .apc-price--open { color: var(--ap-brand); font-size: 14px; font-weight: 600; font-family: var(--ap-font-body); }
    /* ── A SPLIT HERO ────────────────────────────────────────────────────
       Copy on one side, the picture on the other, which is what this design's
       hero.layouts says and what its mockup shows. The shape renders the
       headline, lede, controls and picture as siblings in reading order, so the
       split is done by grid PLACEMENT rather than by a wrapper: every child
       except the picture takes the first column, and the picture takes the
       second across all rows.

       Reading order is therefore unchanged — copy first, picture second — which
       is what a screen reader and a phone both want. Below the breakpoint the
       grid collapses and it stacks, exactly as it does now. */
    @container apc (min-width: 900px) {
      /* Two children, so the picture sits BESIDE the copy rather than through
         it: the copy is one box and the picture is the other. Placement alone
         could not do this — the picture has to span every copy row, and a grid
         item taller than the rows it spans forces those rows to grow, which is
         what pushed the headline, lede and button apart. */
      ${s} .apc-sec.apc-hero {
        display: grid;
        grid-template-columns: 1.05fr .95fr;
        gap: 54px;
        align-items: center;
      }
      ${s} .apc-hero-card,
      ${s} .apc-hero > .apc-hero-shot { margin-block-start: 0; }
    }
  `;
}

/**
 * BOLD — night, flame, and mono on every piece of small print.
 *
 * Read off `bold-archetype.html`. Offers are `.plan`s: a 20px box, the name and
 * the amount on one line at the top, the description beneath, and the control
 * pushed to the foot as a full-width pill. Numbers are set in the heading face
 * at 26px; labels, steps and prices are mono, which is what keeps the contrast
 * from reading as shouting. The proof rail is a solid band, not a hairline grid.
 */
function bold(s: string): string {
  return `
    ${s} .apc-sec { padding-block: clamp(44px, 8cqi, 74px); }

    ${s} .apc-sec-head { max-width: 44ch; margin-block-end: 38px; text-align: start; display: grid; gap: 14px; }
    ${s} .apc-sec-head > * { margin-inline: 0; }
    ${s} .apc-eyebrow {
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px; font-weight: 500; letter-spacing: .12em; text-transform: uppercase;
      color: var(--ap-brand);
      background: none; box-shadow: none; padding: 0; border-radius: 0; backdrop-filter: none;
    }
    ${s} .apc-sec h2 {
      font-size: var(--ap-scale-h2); line-height: 1.08; letter-spacing: -.03em;
      font-weight: 600; margin: 0;
    }

    ${s} .apc-btn {
      border: 1px solid var(--ap-border); border-radius: 9999px;
      padding-block: 12px; padding-inline: 24px; font-size: 14px; font-weight: 600;
      background: transparent; color: var(--ap-text);
    }
    ${s} .apc-btn--solid { background: var(--ap-brand); border-color: var(--ap-brand); color: var(--ap-on-brand); }

    /*
     * Gap only — never the column count.
     *
     * The blocks already size their grid to how many items there are: a single
     * plan is laid out in a max-w-lg container at one column. Forcing three
     * columns on top of that gave each card a third of 512px, and every word
     * wrapped onto its own line. What the composition owns is the rhythm
     * between boxes and the boxes themselves, not how many fit across.
     */
    ${s} .apc-grid { gap: 14px; }
    ${s} .apc-panel {
      background: var(--ap-surface); border: 1px solid var(--ap-border);
      border-radius: 20px; padding: 28px; box-shadow: none;
      display: flex; flex-direction: column; gap: 16px;
    }
    ${s} .apc-panel--lead { border-color: var(--ap-brand); box-shadow: inset 0 0 0 1px var(--ap-brand); }
    ${s} .apc-panel h3 { font-size: 21px; font-weight: 600; margin: 0 0 8px; }
    /* The control sits at the foot of the box, full width, as a pill. */
    ${s} .apc-panel .apc-btn { margin-block-start: auto; width: 100%; }
    ${s} .apc-icon { border-radius: var(--ap-radius-md); box-shadow: none; }

    ${s} .apc-rows { display: grid; gap: 14px; border: 0; }
    ${s} .apc-row-item {
      background: var(--ap-surface); border: 1px solid var(--ap-border);
      border-radius: 18px; padding: 28px; box-shadow: none;
    }
    ${s} .apc-idx { display: block; }
    ${s} .apc-idx,
    ${s} .apc-eyebrow,
    ${s} .apc-stat .apc-lede {
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    ${s} .apc-price {
      font-family: var(--ap-font-heading); font-size: 26px; font-weight: 600;
      letter-spacing: -.03em; white-space: nowrap; color: var(--ap-text);
    }

    /* The proof rail: solid cells separated by the ground, not by hairlines. */
    ${s} .apc-facts {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px;
      background: var(--ap-border); border: 1px solid var(--ap-border);
      border-radius: var(--ap-radius-md); overflow: hidden;
    }
    @container apc (min-width: 820px) { ${s} .apc-facts { grid-template-columns: repeat(4, 1fr); } }
    ${s} .apc-stat {
      background: var(--ap-bg); padding: 26px 22px; text-align: start;
      border: 0; border-radius: 0;
    }

    ${s} .apc-close {
      background: var(--ap-brand); color: var(--ap-on-brand);
      border-radius: var(--ap-radius-md); padding-block: 60px; padding-inline: 32px;
      text-align: center;
    }
    ${s} .apc-close h2 { color: var(--ap-on-brand); margin-inline: auto; max-width: 16ch; }
    ${s} .apc-close p { margin: 0 auto 30px; max-width: 36ch; font-size: 16.5px; font-weight: 300; }
    ${s} .apc-close .apc-btn { background: var(--ap-text); border-color: var(--ap-text); color: var(--ap-bg); }

    ${s} .apc-shot { border-radius: 20px; }

    ${s} .apc-quote { padding-block: 60px; text-align: center; }
    ${s} .apc-quote blockquote, ${s} .apc-quote p {
      font-family: var(--ap-font-heading); font-weight: 400;
      font-size: var(--ap-scale-h2); line-height: 1.22; letter-spacing: -.03em;
      margin-inline: auto; max-width: 20ch; color: var(--ap-text);
    }
    ${s} .apc-quote cite {
      font-style: normal; color: var(--ap-text-muted);
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase;
    }

    ${s} .apc-qa {
      border: 1px solid var(--ap-border); border-radius: 18px;
      padding: 20px 24px; margin-block-end: 10px; background: var(--ap-surface); box-shadow: none;
    }

    ${s} [data-apc="headline"] {
      font-size: var(--ap-scale-h1); line-height: 1.02; letter-spacing: -.03em;
      font-weight: 700; max-width: 14ch; text-align: start;
    }
    ${s} .apc-lede {
      font-size: 17px; font-weight: 300; line-height: 1.7;
      color: var(--ap-text-muted); max-width: 44ch; text-align: start;
    }
    ${s} .apc-cta-row, ${s} .apc-trust { justify-content: flex-start; }

    ${s} .apc-wm { font-size: 15px; font-weight: 700; letter-spacing: -.02em; }
    ${s} .apc-footer {
      border-block-start: 1px solid var(--ap-border);
      color: var(--ap-text-muted); font-weight: 300;
    }
    /* The closing block is one panel on the page ground, not a panel inside a
       band. Switching the band off leaves exactly the mockup's arrangement. */
    ${s} .apc-sec { --apc-band: var(--ap-bg); --apc-band-ink: var(--ap-text); }
    /* ── Offers: a two-up grid whose first card carries the accent ────────
       Straight off bold-archetype.html: white cards on the paper ground, the
       lead one inverted to night with a flame control, the name and the amount
       on one line, and the button full width at the foot of every box. */
    ${s} .apc-grid { gap: 18px; }
    @container apc (min-width: 820px) { ${s} .apc-grid { grid-template-columns: repeat(2, 1fr); } }
    /* A lone offer takes the whole row. Two columns squeezed a single pricing
       card — which the block lays out inside its own narrow container — into
       half of it, and every word wrapped onto its own line. */
    ${s} .apc-grid > :only-child { grid-column: 1 / -1; }
    ${s} .apc-panel { border-radius: 20px; padding: 30px; }
    ${s} .apc-panel:first-child:not(:only-child),
    ${s} .apc-panel--lead:not(:only-child) {
      background: var(--ap-text); color: var(--ap-bg); border-color: var(--ap-text);
      box-shadow: none;
    }
    ${s} .apc-panel:first-child:not(:only-child) .apc-price,
    ${s} .apc-panel--lead:not(:only-child) .apc-price { color: var(--ap-bg); }
    ${s} .apc-panel:first-child:not(:only-child) p,
    ${s} .apc-panel--lead:not(:only-child) p { color: color-mix(in srgb, var(--ap-bg) 72%, transparent); }
    ${s} .apc-panel:first-child:not(:only-child) .apc-btn,
    ${s} .apc-panel--lead:not(:only-child) .apc-btn {
      background: var(--ap-brand); border-color: var(--ap-brand); color: var(--ap-on-brand);
    }
    ${s} .apc-panel .apc-btn {
      width: 100%; margin-block-start: auto; border-radius: 9999px;
      padding-block: 14px; justify-content: center;
    }
    ${s} .apc-panel-top {
      display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
    }
    /* ── Sections, in Bold's own register ────────────────────────────────
       Night, flame and mono. Panels are tight boxes on the raised surface, every
       label and figure is mono, and the accent marks the one thing on each
       screen the visitor is meant to do. Nothing is round. */

    ${s} .apc-bar { padding-block: 16px; background: var(--ap-surface); }
    ${s} .apc-menu { color: var(--ap-text-muted); font-size: 13.5px; }
    ${s} .apc-menu-idx { display: none; }

    ${s} .apc-hero-shot { border-radius: 20px; }
    ${s} .apc-split-shot { border-radius: 20px; }
    ${s} .apc-prose { font-size: 16.5px; line-height: 1.75; color: var(--ap-text-muted); font-weight: 300; }

    /* Steps are boxes here, not rules — the mockup gives each one its own card. */
    ${s} .apc-steps { gap: 14px; }
    ${s} .apc-step {
      background: var(--ap-surface); border: 1px solid var(--ap-border);
      border-radius: 18px; padding: 26px;
    }
    ${s} .apc-step h3 { font-size: 21px; font-weight: 600; }
    ${s} .apc-step p { font-size: 14.5px; line-height: 1.7; color: var(--ap-text-muted); font-weight: 300; }

    ${s} .apc-facts-list li {
      padding-block: 14px; border-block-start: 1px solid var(--ap-border); font-size: 15px;
    }
    ${s} .apc-facts-list i {
      font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; color: var(--ap-brand);
    }

    ${s} .apc-quote-band { background: var(--ap-surface); }
    ${s} .apc-quote cite {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ap-text-muted);
    }

    ${s} .apc-stat-n { font-size: 32px; font-weight: 700; letter-spacing: -.03em; }
    ${s} .apc-stat-l {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 12px; color: var(--ap-text-muted); letter-spacing: .06em;
    }

    ${s} .apc-member-shot { border-radius: var(--ap-radius-md); }
    ${s} .apc-member h3 { font-size: 18px; font-weight: 700; }
    ${s} .apc-member p { font-size: 13px; color: var(--ap-text-muted); font-weight: 300; }

    ${s} .apc-gal .apc-shot { border-radius: 20px; }

    ${s} .apc-qa-q { font-size: 16.5px; font-weight: 600; }
    ${s} .apc-qa-mark { color: var(--ap-brand); font-size: 20px; }
    ${s} .apc-qa-a { font-size: 15px; line-height: 1.7; color: var(--ap-text-muted); font-weight: 300; }

    ${s} .apc-logo {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 13px; letter-spacing: .1em; text-transform: uppercase; opacity: .6;
    }
    ${s} .apc-video { border-radius: 20px; }
    ${s} .apc-field {
      border: 1px solid var(--ap-border); border-radius: var(--ap-radius-md);
      padding-block: 13px; padding-inline: 18px; background: var(--ap-surface); color: var(--ap-text);
    }
    ${s} .apc-footer-row { padding-block: 24px; }
    ${s} .apc-footer-tag {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 12px; color: var(--ap-text-muted);
    }
    ${s} .apc-btn--ghost { background: transparent; color: var(--ap-on-brand); border-color: var(--ap-on-brand); }
    ${s} .apc-footer-year {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 11.5px; color: var(--ap-text-muted);
    }
    ${s} .apc-member-bio { font-size: 13.5px; line-height: 1.7; color: var(--ap-text-muted); }
    /* ── Transcribed from bold-archetype.html ────────────────────────────
       The chip cards floating over the hero picture, one at each side. Frosted
       night at 14px with a flame dot and the figure in the heading face — the
       single most recognisable element in this design. */
    ${s} .apc-hero-shot { aspect-ratio: 4 / 5; background-position: 50% 28%; border-radius: 20px; }
    ${s} .apc-chip {
      display: block; position: absolute;
      background: color-mix(in srgb, var(--ap-surface) 90%, transparent);
      backdrop-filter: blur(10px); border: 1px solid var(--ap-border);
      border-radius: 14px; padding: 12px 15px; min-width: 150px;
    }
    ${s} .apc-chip--one { inset-inline-start: -16px; top: 14%; }
    ${s} .apc-chip--two { inset-inline-end: -14px; bottom: 16%; }
    ${s} .apc-chip-k {
      color: var(--ap-text-muted);
      font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 11.5px;
    }
    ${s} .apc-chip-dot {
      display: inline-block; width: 7px; height: 7px; border-radius: 999px;
      background: var(--ap-brand); margin-inline-end: 7px;
    }
    ${s} .apc-chip-v {
      font-family: var(--ap-font-heading); font-size: 19px; font-weight: 600; letter-spacing: -.02em;
    }

    /* Bold ticks its list rather than ruling it. */
    ${s} .apc-tick {
      display: inline-block; color: var(--ap-brand);
      font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px;
      margin-inline-end: 9px;
    }
    ${s} .apc-tick::before { content: "→"; }

    /* Controls are pills at the mockup's measure, in the heading face. */
    ${s} .apc-btn {
      border-radius: 9999px; padding-block: 15px; padding-inline: 30px;
      font-size: 15px; font-family: var(--ap-font-heading);
    }
    ${s} .apc-btn--solid { font-weight: 600; }
    ${s} .apc-price--open {
      color: var(--ap-brand); font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 12px; letter-spacing: .08em; text-transform: uppercase; font-weight: 600;
    }
    /* ── A SPLIT HERO ────────────────────────────────────────────────────
       Copy on one side, the picture on the other, which is what this design's
       hero.layouts says and what its mockup shows. The shape renders the
       headline, lede, controls and picture as siblings in reading order, so the
       split is done by grid PLACEMENT rather than by a wrapper: every child
       except the picture takes the first column, and the picture takes the
       second across all rows.

       Reading order is therefore unchanged — copy first, picture second — which
       is what a screen reader and a phone both want. Below the breakpoint the
       grid collapses and it stacks, exactly as it does now. */
    @container apc (min-width: 900px) {
      /* Two children, so the picture sits BESIDE the copy rather than through
         it: the copy is one box and the picture is the other. Placement alone
         could not do this — the picture has to span every copy row, and a grid
         item taller than the rows it spans forces those rows to grow, which is
         what pushed the headline, lede and button apart. */
      ${s} .apc-sec.apc-hero {
        display: grid;
        grid-template-columns: 1.05fr .95fr;
        gap: 54px;
        align-items: center;
      }
      ${s} .apc-hero-card,
      ${s} .apc-hero > .apc-hero-shot { margin-block-start: 0; }
    }
  `;
}

const BY_COMPOSITION: Record<Composition, (scope: string) => string> = {
  stone,
  warm,
  bold,
};

/**
 * Every rule a composition needs, scoped to the surface that asked for it.
 *
 * Returns the shared skeleton followed by the composition's own rules, so a
 * composition overrides the skeleton by source order rather than by having to
 * out-specify it.
 */

/**
 * What one particular template changes about the bones it inherits.
 *
 * Bloom wears Warm's structure and Lumen and Aster wear Bold's — but a template
 * is not only its structure, and these are read off `four-archetypes.html`
 * rather than left as a recolour. Bloom rounds everything and sets its headings
 * in Varela Round; Lumen takes the largest radius in the set and an acid lime
 * that needs black on top of it; Aster is the smallest radius, the heaviest
 * headings, and the only gradient anywhere in the six.
 *
 * Empty for stone, warm and bold: those three ARE their bones, so there is
 * nothing to override.
 */
const BY_ARCHETYPE: Partial<Record<string, (s: string) => string>> = {
  /**
   * BLOOM — Warm's bones, softened everywhere.
   *
   * 26px on every panel, round controls, a mint accent that reads as friendly
   * rather than commercial, and Varela Round on headings. The one template in
   * the set a parent or a patient is meant to find unthreatening.
   */
  bloom: (s: string) => `
    ${s} .apc-sec h2,
    ${s} [data-apc="headline"],
    ${s} .apc-member h3,
    ${s} .apc-step h3,
    ${s} .apc-qa-q { font-family: var(--ap-font-heading); font-weight: 400; letter-spacing: -.01em; }

    ${s} .apc-panel, ${s} .apc-qa, ${s} .apc-close,
    ${s} .apc-shot, ${s} .apc-video, ${s} .apc-hero-shot { border-radius: 26px; }
    ${s} .apc-btn { border-width: 1.5px; border-radius: 9999px; font-weight: 600; }
    ${s} .apc-eyebrow { color: var(--ap-brand); font-weight: 700; letter-spacing: .06em; text-transform: none; }
    ${s} .apc-idx { color: var(--ap-brand); font-weight: 700; }
    ${s} .apc-price { color: var(--ap-accent); }
    /* Bloom's close is tinted, not inverted — the only one of the six that does
       not go to ink, because a hard black panel is the opposite of its point. */
    ${s} .apc-close { background: var(--ap-brand-tint); color: var(--ap-text); }
    ${s} .apc-close h2 { color: var(--ap-text); }
    ${s} .apc-close p { color: var(--ap-text-muted); opacity: 1; }
    ${s} .apc-close .apc-btn { background: var(--ap-brand); border-color: var(--ap-brand); color: var(--ap-on-brand); }
    ${s} .apc-quote-band { background: var(--ap-surface); }
  `,

  /**
   * LUMEN — Bold's bones at 30px, in acid lime on near-black.
   *
   * The largest radius of the six, which is most of why it reads as recent, and
   * a lime that carries black rather than white on top of it. Its second accent
   * is a violet, used only on labels.
   */
  lumen: (s: string) => `
    ${s} .apc-panel, ${s} .apc-qa, ${s} .apc-step,
    ${s} .apc-shot, ${s} .apc-video, ${s} .apc-hero-shot, ${s} .apc-gal .apc-shot { border-radius: 30px; }
    ${s} .apc-close { border-radius: 30px; }
    ${s} .apc-btn { border-radius: 9999px; font-weight: 500; }
    ${s} .apc-btn--solid { font-weight: 600; }
    ${s} .apc-eyebrow {
      color: var(--ap-accent); font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
      font-family: var(--ap-font-body);
    }
    ${s} .apc-price { color: var(--ap-brand); }
    ${s} .apc-idx, ${s} .apc-stat-l, ${s} .apc-footer-tag, ${s} .apc-logo, ${s} .apc-quote cite {
      font-family: var(--ap-font-body); text-transform: none; letter-spacing: 0;
    }
    /* Lumen closes on the lime itself, which needs black type on it. */
    ${s} .apc-close { background: var(--ap-brand); color: var(--ap-on-brand); }
    ${s} .apc-close h2 { color: var(--ap-on-brand); }
    ${s} .apc-close .apc-btn { background: var(--ap-bg); border-color: var(--ap-bg); color: var(--ap-brand); }
  `,

  /**
   * ASTER — Bold's bones at 14px, the heaviest headings, and one gradient.
   *
   * The smallest radius in the set and the only place any of the six uses a
   * gradient: the closing panel, and the accent word in the headline. Everything
   * else is flat, because a gradient used twice stops being an accent.
   */
  aster: (s: string) => `
    ${s} .apc-panel, ${s} .apc-qa, ${s} .apc-step,
    ${s} .apc-shot, ${s} .apc-video, ${s} .apc-hero-shot, ${s} .apc-gal .apc-shot { border-radius: 14px; }
    ${s} .apc-btn { border-radius: 10px; font-weight: 500; }
    ${s} .apc-btn--solid { font-weight: 700; }
    ${s} [data-apc="headline"] { font-weight: 900; letter-spacing: -.03em; }
    ${s} .apc-sec h2 { font-weight: 900; letter-spacing: -.03em; }
    ${s} .apc-stat-n { font-weight: 900; }
    ${s} .apc-eyebrow {
      color: var(--ap-accent); font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
      font-family: var(--ap-font-body);
    }
    ${s} .apc-idx, ${s} .apc-stat-l, ${s} .apc-footer-tag, ${s} .apc-logo, ${s} .apc-quote cite {
      font-family: var(--ap-font-body); text-transform: none; letter-spacing: 0;
    }
    ${s} .apc-close {
      background: linear-gradient(135deg, var(--ap-brand), var(--ap-brand-hover));
      border-radius: 16px; color: var(--ap-on-brand);
    }
    ${s} .apc-close .apc-btn { background: var(--ap-bg); border-color: var(--ap-bg); color: var(--ap-brand); }
  `,
};

export function compositionCss(composition: Composition, scope: string): string {
  return `${base(scope)}\n${skeleton(scope)}\n${(BY_COMPOSITION[composition] ?? stone)(scope)}`;
}

/**
 * Everything one template needs, in the order a later rule should win.
 *
 * Shape defaults, then the shared structure, then the bones this template is
 * built on, then whatever this particular template changes about them. Stone,
 * Warm and Bold add nothing at the last step because they ARE their bones.
 */
export function templateCss(
  archetypeId: string | null | undefined,
  composition: Composition,
  scope: string
): string {
  const own = archetypeId ? BY_ARCHETYPE[archetypeId] : undefined;
  return `${compositionCss(composition, scope)}${own ? `\n${own(scope)}` : ''}`;
}

/**
 * The shape defaults alone, for a surface with no composition.
 *
 * This is what keeps a theme that is only a palette rendering exactly as it did
 * before compositions existed — its blocks keep their arrangement and their
 * decoration, and its radius still comes from its own theme.
 */
export function baseCss(scope: string): string {
  return base(scope);
}

/**
 * The composition a theme should render in, or null to leave the blocks alone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ID IS CONSULTED AND NOT ONLY THE FIELD
 *
 * `website_pages.theme` is stored whole, and a page saved before compositions
 * existed carries no `composition` — but it very often DOES carry an `id`
 * naming its archetype, because archetypes shipped first. Reading only the
 * field would leave every one of those pages uncomposed while the template
 * picker insisted they were on Lumen or Aster.
 *
 * So: the field if the theme has one, otherwise the composition belonging to
 * the archetype it names, otherwise nothing. That last case is a theme that is
 * only a palette — which is all a theme was before archetypes — and those pages
 * must keep the arrangement their blocks give them.
 */
export function compositionFor(theme: PageTheme | null | undefined): Composition | null {
  return resolveComposition(theme) ?? getArchetype(theme?.id)?.composition ?? null;
}
