/**
 * This app has TWO dark modes, and only one of them is its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MISMATCH
 *
 *   `--foreground` / `--background`   `app/globals.css` flips these inside
 *                                     `@media (prefers-color-scheme: dark)` —
 *                                     the OPERATING SYSTEM's preference. Nothing
 *                                     in the app can change them.
 *
 *   `--v2-*` and the `.dark` class    set by `V2ThemeProvider` from the in-app
 *                                     toggle and localStorage. The APP's own
 *                                     mode.
 *
 * They agree only while the two settings happen to match. Run the app in dark
 * mode on a phone that is in light mode and every element that did not name its
 * own colour inherits `body { color: var(--foreground) }` — `#171717` — while
 * the surface behind it is `--v2-surface`, `#1E293B`. Near-black text on
 * near-black ground: the control reads as a solid black box. The inverse pairing
 * gives an all-white one.
 *
 * That is what "the language selector is all black on mobile" was, and the same
 * for the currency and timezone pickers beside it: three dropdown option rows
 * that styled their background and their hover state and never their text.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS
 *
 * Not "every element names a colour" — most inherit perfectly well from a parent
 * that named one, and demanding it everywhere would be noise. What it forbids is
 * reaching for the OS-DRIVEN tokens on surfaces the app themes itself, because
 * that is the pairing that cannot be made consistent.
 *
 * The root cause is deliberately left standing: making `.dark` set
 * `--foreground` too would fix every future case at once, but it would also
 * extend the 27 hardcoded `bg-white` elements in Business OS from "wrong when
 * the OS is dark" to "wrong when either is dark". That is a decision to take
 * deliberately, not a side effect of this guard.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

/** Surfaces the app themes with its own tokens. */
const SURFACES = ['app/business-os', 'components/business-os', 'components/ui'];

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.(test|backup)\./.test(entry)) out.push(full);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/** Code only: the comments beside each fix name the token they replaced. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const FILES = SURFACES.flatMap(sourcesUnder);

describe('the app never colours itself from the operating system', () => {
  it('scans a realistic number of files', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  /*
   * THE RULE IS "DO NOT MIX", NOT "NEVER USE".
   *
   * `text-foreground` and `bg-background` resolve through the media-query
   * tokens, so on a surface the app themes itself they are a coin flip on the
   * visitor's OS setting. But `components/ui` serves more than the v2 surfaces:
   * `tabs.tsx` and `card.tsx` are pure shadcn and are rendered nowhere under
   * Business OS, where those tokens are the correct and only system.
   *
   * So the fault is a file that uses BOTH: it has committed to `--v2-*` for
   * some of its colours and then takes the rest from the operating system. That
   * file cannot be consistent in any configuration, and it is exactly what
   * `select.tsx` was — every colour from `--v2-*` except `SelectLabel`.
   */
  const OS_TOKENS = ['text-foreground', 'bg-background', 'text-muted-foreground'];

  it.each(OS_TOKENS)('no file mixes %s with the app\'s own tokens', token => {
    const offenders = FILES.filter(file => {
      const code = codeOf(file);
      return code.includes(token) && /--v2-(text|bg|surface|border)/.test(code);
    }).map(file => file.replace(ROOT + '/', ''));

    expect(offenders).toEqual([]);
  });

  /*
   * And the Business OS surfaces are wholly v2-themed — every colour there comes
   * from the provider — so for them the stronger rule holds outright.
   */
  it.each(OS_TOKENS)('Business OS never reaches for %s at all', token => {
    const offenders = FILES.filter(
      file => /\/(app|components)\/business-os\//.test(file) && codeOf(file).includes(token)
    ).map(file => file.replace(ROOT + '/', ''));

    expect(offenders).toEqual([]);
  });
});

describe('the settings pickers name their own text colour', () => {
  /*
   * The three that were reported: language, currency, timezone. They share one
   * row shape, so one assertion covers all three — and the count matters,
   * because a fourth picker added later should either match or fail here.
   */
  const SETTINGS = codeOf(join(ROOT, 'app/business-os/settings/page.tsx'));

  it('every dropdown option row sets a colour from the app tokens', () => {
    const rows = SETTINGS.match(/w-full px-4 py-3 text-sm flex items-center justify-between[^`"]*/g) ?? [];
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row).toContain('text-[var(--v2-text-primary)]');
    }
  });

  it('and they still take their background from the app tokens too', () => {
    // Both halves have to come from the same system, which is the whole point.
    expect(SETTINGS).toContain('hover:bg-[var(--v2-bg)]');
  });
});
