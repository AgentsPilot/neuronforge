/**
 * Every control a person presses wears the platform's colour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The advisor card was built with its own three-stop orange gradient on the
 * primary button, plus a matching orange shadow, while the Needs-you card
 * directly beside it uses flat `var(--v2-primary)`. Two buttons, a few hundred
 * pixels apart, reading as two products.
 *
 * It was also a dark-mode fault rather than only a taste one: the gradient was
 * fixed hex values, so it ignored the theme entirely, and `--v2-danger` — used
 * on the agents card's destructive button — is not defined ANYWHERE, so its
 * fallback red was doing all the work on both grounds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT ORANGE KEEPS, AND WHY THIS TEST IS NARROW.
 *
 * The accent is the advisor's identity and stays on everything that is not a
 * button: the orb, the eyebrows, the offer panel's tint, the category colours,
 * and the carousel — dots and arrows both, which say where you are in the card
 * rather than doing anything.
 *
 * So this pins the BUTTONS only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (file: string) =>
  readFileSync(join(root, 'components', 'business-os', 'insight', file), 'utf-8');

const card = read('InsightAdvisorCard.tsx');
const agents = read('RunningAgentsCard.tsx');

describe('the advisor card presses like the rest of the dashboard', () => {
  it('has no orange gradient anywhere', () => {
    /*
     * The orb was the last one, and it is now an icon in a tint rather than a
     * filled circle. Nothing on this card paints a gradient.
     */
    const gradients = card.match(/linear-gradient\(120deg, #FFB454/g) ?? [];

    expect(gradients).toHaveLength(0);
  });

  it('paints the primary and the confirm with the platform token', () => {
    /*
     * Whitespace-insensitive, because the default-state primary resolves its
     * background through a ternary that Prettier wraps across lines. Asserting
     * the exact one-line spelling is how a formatting change starts failing a
     * test about colour.
     */
    const flat = card.replace(/\s+/g, ' ');

    /* Both buttons now carry colour and nothing else, in the list's own
       shorthand: `{ background: 'var(--v2-primary)', color: '#fff' }`. */
    const painted = flat.match(/background: 'var\(--v2-primary\)', color: '#fff'/g) ?? [];

    expect(painted.length).toBeGreaterThanOrEqual(2);
  });

  it('drops the orange glow that went with it', () => {
    expect(card).not.toContain('rgba(249,115,22,0.9)');
  });

  it('keeps the carousel in the advisor accent', () => {
    /* Chrome, not an action. Changed once and changed back. */
    expect(card).toContain("i === currentIndex ? '#F97316'");
  });
});

describe('the secondary is text, like the Needs-you card', () => {
  it('has no border and no fill', () => {
    /*
     * It was a bordered box filled with `--v2-surface`, which in DARK MODE is
     * the card's own colour: a faint outline around nothing, reading as
     * disabled beside a solid primary. Both secondaries — dismiss, and the
     * offer's "keep asking me" — were the same.
     */
    const boxed = card.match(/background: 'var\(--v2-surface\)',\s*\n\s*borderRadius: '12px'/g) ?? [];

    expect(boxed).toHaveLength(0);
  });

  it('darkens on hover, with the list\'s own class', () => {
    /* `hover:text-[...]` rather than mouse handlers approximating it: the
       handlers were an inline stand-in and could not match a pseudo-class on
       focus or touch. */
    const hovers = card.match(
      /text-\[var\(--v2-text-muted\)\] hover:text-\[var\(--v2-text-primary\)\] transition-colors/g
    ) ?? [];

    expect(hovers.length).toBeGreaterThanOrEqual(2);
  });
});

describe('one button, three places', () => {
  /*
   * The Needs-you ROW button is the canonical one: `px-3 py-1.5 text-xs
   * rounded-lg`, with `ap-primary-lift`, a brightness hover and a press.
   *
   * Two others had drifted. The Needs-you LEAD row, built first, was 13px in
   * `px-4 py-2` with none of the interaction — a bigger, flatter button sitting
   * directly above the smaller lively ones. The advisor's primary was bigger
   * still. A card is one control repeated, not three sizes of it.
   */
  const needsYou = read('NeedsYouCard.tsx');

  it('no button anywhere on either card keeps the old metrics', () => {
    /*
     * `text-[13px] px-4 py-2` was the lead row's original size. The primary
     * was moved off it first and the outlined "open the client" beside it was
     * missed, so one pair had a taller button next to a shorter one.
     */
    for (const [name, source] of [['NeedsYouCard', needsYou], ['InsightAdvisorCard', card]] as const) {
      expect(`${name}: ${source.includes('text-[13px] font-semibold px-4 py-2')}`).toBe(
        `${name}: false`
      );
    }
  });

  it('the Needs-you lead row uses the row button', () => {
    const leadButton = needsYou.slice(
      needsYou.indexOf('onClick={() => act(leadGap!'),
      needsYou.indexOf('onClick={() => act(leadGap!') + 1400
    );

    expect(leadButton).toContain('px-3 py-1.5 text-xs');
    expect(leadButton).toContain('ap-primary-lift');
    expect(leadButton).toContain('active:scale-[0.97]');
  });

  it('the advisor primary and confirm use the same CLASSES, not the same numbers', () => {
    /*
     * Copied rather than approximated. Setting `padding: 6px 12px` and
     * `fontSize: 12px` inline measured the same as `px-3 py-1.5 text-xs` and
     * still looked different: the Tailwind classes also carry a line-height
     * and a weight, and an explicit `fontFamily` overrode the stack the list
     * inherits.
     */
    const shape = card.match(
      /px-3 py-1\.5 text-xs font-semibold rounded-lg transition-all hover:brightness-110 active:scale-\[0\.97\]/g
    ) ?? [];

    /* The primary, and the confirm inside the offer. */
    expect(shape.length).toBeGreaterThanOrEqual(2);

    /* And nothing about the shape left inline on either. */
    expect(card).not.toContain("padding: '6px 12px'");
    expect(card).not.toContain("padding: '11px 18px'");
  });

  it('and the settled state keeps no lift', () => {
    /* A green "already handled" chip is not an invitation. The list applies
       the same rule to its `done` rows. */
    expect(card.replace(/\s+/g, ' ')).toContain(
      "operationalState === 'on' || agentAlreadyWorking ? '' : ' ap-primary-lift'"
    );
  });
});

describe('both themes', () => {
  it('uses no colour token that is undefined', () => {
    /* `--v2-danger` has never existed. A `var(--x, #hex)` fallback hides that:
       the page renders, in a colour nothing can theme. */
    expect(agents).not.toContain('--v2-danger');
    expect(card).not.toContain('--v2-danger');
  });

  it('gives the destructive button the status family, which both themes define', () => {
    for (const token of [
      '--v2-status-error-bg',
      '--v2-status-error-text',
      '--v2-status-error-border',
    ]) {
      expect(agents).toContain(token);
    }
  });
});
