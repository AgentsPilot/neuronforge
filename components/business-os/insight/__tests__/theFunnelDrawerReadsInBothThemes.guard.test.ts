/**
 * No panel in the funnel drawer paints a fixed light ground under themed ink.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ON SCREEN
 *
 * The dashboard in dark mode, Hebrew, on a phone. The funnel's leak panel —
 * "40 נשרו", the single most actionable thing on that card — drew its two
 * figures inside near-WHITE boxes:
 *
 *     background: '#F8F9FC'        the box
 *     color: 'var(--v2-text-primary)'   the number inside it
 *
 * In dark mode that token resolves to `#F1F5F9`. Near-white ink on a near-white
 * box: the owner saw two blank rectangles where 41 and 1 should have been, and
 * the percentage beside them was a dark red on the same ground.
 *
 * Nothing failed. The markup was correct, the numbers were computed correctly,
 * and every one of them was invisible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, AND WHY IT IS POSITIONAL
 *
 * This component styles inline rather than with Tailwind, so there is no
 * `dark:` variant to forget — a literal here simply never changes. Five
 * separate declarations had the fault, written at different times, each
 * reasonable on its own against a white card.
 *
 * So the rule is about the FILE, not any one panel: a `background` may not be
 * a hex literal. Backgrounds decide what the themed text sits on, and a fixed
 * one is a bet that the ground never moves.
 *
 * `color` is deliberately NOT banned. White on a coloured chip is correct in
 * both themes, and the orange accent is chosen to read on either ground. What
 * is banned there is the narrower thing that actually bit: a DARK ink literal,
 * which can only have been picked against a light surface.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SOURCE = 'components/business-os/insight/FunnelDrawer.tsx';

const source = fs
  .readFileSync(path.join(process.cwd(), SOURCE), 'utf8')
  .replace(/\r\n/g, '\n');

/** Comments stripped: they quote the very literals this file forbids. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every `background: '#...'` still written as a literal. */
function literalBackgrounds(): string[] {
  return code.match(/background:\s*'#[0-9A-Fa-f]{3,8}'/g) ?? [];
}

/**
 * How light a hex colour is, 0 (black) to 255 (white).
 *
 * Crude on purpose — this is a "could this be ink on a dark ground" test, not
 * a contrast calculation. Anything above the threshold is a colour nobody
 * picks for text unless they assumed a white card.
 */
function lightness(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe('the funnel drawer in dark mode', () => {
  it('scans a real file, so the rules below are not vacuous', () => {
    expect(code).toContain('lv-stat');
    expect(code.length).toBeGreaterThan(5000);
  });

  it('paints no background from a hex literal', () => {
    /*
     * THE BUG, AS ONE ASSERTION. `#F8F9FC` under `--v2-text-primary` is what
     * made the leak panel unreadable; `#F7F9FD`, `#E4E8F2` and `#DDE2EE` were
     * the same mistake on the confidence panel beside it.
     */
    expect(literalBackgrounds()).toEqual([]);
  });

  it('uses the themed surface for panels inside the card', () => {
    /* `--v2-bg` is the sunken tint the rest of the dashboard uses for a panel
       within a card, and it moves with the theme like the text on it. */
    expect(code).toContain("background: 'var(--v2-bg)'");
  });

  it('writes good and bad with the semantic tokens', () => {
    /*
     * Both are defined identically in the light and dark blocks of
     * `globals-v2.css`, chosen to read on either ground. The literals they
     * replaced — `#22C58B`, `#C0392B`, `#059669` — were picked against white.
     */
    expect(code).toContain('var(--v2-success)');
    expect(code).toContain('var(--v2-error)');
    expect(code).not.toContain('#C0392B');
    expect(code).not.toContain('#059669');
  });

  it('writes no DARK ink as a literal, which can only mean a light ground', () => {
    /*
     * The surviving literals are white-on-colour (`#fff` on a filled chip) and
     * the orange accent, both correct in either theme. A dark one is the tell
     * that somebody styled against a white card.
     */
    const inks = code.match(/color:\s*'#[0-9A-Fa-f]{3,8}'/g) ?? [];
    const dark = inks.filter(decl => {
      const hex = decl.match(/#[0-9A-Fa-f]{3,8}/)![0];
      return lightness(hex) < 140;
    });

    expect(dark).toEqual([]);
  });
});
