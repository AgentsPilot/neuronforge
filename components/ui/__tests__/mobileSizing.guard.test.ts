/**
 * A panel on a phone may not be taller than the phone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SOURCE TEST
 *
 * jsdom has no viewport, no address bar and no layout. A panel that overflows a
 * 375px screen measures exactly the same there as one that fits, so no render
 * test can see this class of fault. What can be checked anywhere is the unit the
 * height is written in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO UNITS, AND WHY ONLY ONE OF THEM IS SAFE
 *
 * `100vh` is the LARGE viewport: the height the page would have if the browser's
 * address bar were collapsed. On a phone with the bar showing, it is taller than
 * what the visitor can see. `100dvh` is the DYNAMIC viewport — what is actually
 * visible right now.
 *
 * So a dialog sized `h-[100vh]` extends past the bottom of the screen. These
 * panels are flex columns with `overflow-hidden` and their action row —
 * Save, Confirm, Refund — is the last child, so it lands below the fold with
 * nothing able to scroll it into view. The owner fills in the form and has no
 * Save button. That is what "cannot make changes on mobile" was.
 *
 * `components/ui/dialog.tsx` already documents this and uses `100dvh` in its own
 * base string; these panels opt out of that base by passing `flex`, so they are
 * on their own and have to get the unit right themselves.
 *
 * `min-h-screen` is deliberately NOT caught: a minimum is a floor, not a height,
 * and the page still scrolls past it. There are over a hundred of those and they
 * are all fine.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

/** What an owner runs the business from, and what a client is shown. */
const SURFACES = [
  'components/business-os',
  'components/crm',
  'components/scheduling',
  'components/payments',
  'components/website',
  'components/public',
  'app/business-os',
];

function sourcesUnder(dir: string): string[] {
  const absolute = join(ROOT, dir);
  const out: string[] = [];

  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.(test|backup)\./.test(entry)) out.push(full);
    }
  };

  walk(absolute);
  return out;
}

const FILES = SURFACES.flatMap(sourcesUnder);

/**
 * The file with its prose removed.
 *
 * The comments beside each fix NAME the construct they replaced — `100vh` and
 * `h-screen` are written out in full there, deliberately, so the next reader
 * knows what not to go back to. Matching raw source made this guard fail on its
 * own explanations, which would teach whoever hit it to delete the comment.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('a height in viewport units is written in dvh', () => {
  it('scans a realistic number of files', () => {
    // A guard that silently stops finding anything is worse than no guard.
    expect(FILES.length).toBeGreaterThan(100);
  });

  /*
   * `h-screen` is Tailwind's `100vh` under another name and fails the same way.
   * The negative lookbehind keeps `min-h-screen` out of it.
   */
  const FORBIDDEN = /(?<!min-)(?:max-)?h-\[100vh\]|(?<!min-)h-screen/;

  it('nowhere on these surfaces sizes a box against the collapsed address bar', () => {
    const offenders = FILES.filter(file => FORBIDDEN.test(codeOf(file)))
      .map(file => file.replace(ROOT + '/', ''));

    expect(offenders).toEqual([]);
  });

  it('is reading code rather than the comments that name the old construct', () => {
    // Proves the strip above actually works, so a green run means something.
    const sample = '/* was h-screen */\nconst a = "h-[100dvh]"; // not h-[100vh]\n';
    expect(FORBIDDEN.test(sample)).toBe(true);
    expect(FORBIDDEN.test(sample.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))).toBe(false);
  });
});

/**
 * The second fault, which is not a unit but an interaction.
 *
 * `ConfigurationDialog` is the shell the Services tab lives in. Its panel is
 * correctly capped at `max-h-[100dvh]` — but it sat inside a `fixed inset-0`
 * flex container that CENTRED it, and a fixed box with `inset-0` is sized to the
 * LARGE viewport. So a correctly-sized panel was centred inside a box taller
 * than the screen and ended up offset by half the address bar: the header and
 * the first fields above the top edge, the footer below the bottom one, and
 * nothing able to scroll either back. The only scroll on that tab belongs to the
 * services list, which is inside the region already clipped away.
 *
 * Asserted on this file by name rather than as a sweep over every `fixed
 * inset-0` overlay: most of those have no capped panel at all, which is a
 * different fault with a different fix, and lumping them together would make
 * this test fail for reasons it cannot describe. That sweep is tracked
 * separately.
 */
describe('the Business OS configuration shell', () => {
  const SHELL = readFileSync(join(ROOT, 'components/business-os/ConfigurationDialog.tsx'), 'utf8');

  it('bounds its own height to the visible viewport', () => {
    expect(SHELL).toMatch(/fixed inset-x-0 top-0 h-\[100dvh\]/);
  });

  it('fills the screen on a phone instead of centring inside a taller box', () => {
    expect(SHELL).toContain('items-stretch sm:items-center');
  });

  it('still centres, and still insets, from sm upwards', () => {
    // The desktop dialog must not change: inset, centred, capped at 95/90dvh.
    expect(SHELL).toMatch(/sm:inset-4/);
    expect(SHELL).toContain('sm:items-center');
    expect(SHELL).toMatch(/sm:max-h-\[95dvh\]/);
  });
});
