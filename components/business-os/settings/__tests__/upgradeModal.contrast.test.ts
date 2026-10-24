/**
 * @jest-environment node
 *
 * WCAG contrast of the plan comparison window, on the computed token values
 * (upgrade modal UM-3 §7, A-1 to A-6; SA Y-3, Y-7; rewritten for live-test fix
 * LF-1, 2026-10-20). A TEST-ONLY helper: it reads the token hex values from
 * `app/v2/globals-v2.css`, light (`:root`) and dark (`html.dark`, falling back to
 * `:root` for a token it does not override), and computes the WCAG 2.x ratio. No
 * product code, no new dependency, no jest-axe.
 *
 * ── Why four themes (LF-1) ──────────────────────────────────────────────────
 * UM-3 checked the defaults only, and the live test showed why that was not
 * enough: the platform's admin ui-config sets custom tokens, and the theme
 * provider (`lib/design-system-v2/theme-provider.tsx`) writes them over
 * --v2-primary and --v2-secondary (never --v2-primary-dark). The live values
 * (GET /api/design-system/v2-custom-tokens, 2026-10-20) are orange, so a band
 * built on the indigo shade with white words became unreadable. Every pair below
 * is now checked on the DEFAULT tokens and on the LIVE CUSTOM tokens, light and
 * dark. The custom values are pinned here deliberately: if an admin changes the
 * theme, this file is where the new values are re-checked.
 *
 * Each pair is the one the modal actually paints, so a token swap that breaks
 * AA fails here: small text ≥ 4.5:1, non-text (icons, marks) ≥ 3:1.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'app/v2/globals-v2.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const match of Array.from(body.matchAll(/--(v2-[\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g))) tokens[match[1]] = match[2];
  return tokens;
}

/** The admin ui-config custom tokens live on 2026-10-20, as the theme provider writes them. */
const LIVE_CUSTOM = { 'v2-primary': '#fb923c', 'v2-secondary': '#f97316' };

const LIGHT = block(':root');
const DARK = { ...LIGHT, ...block('html.dark') };
const THEMES = {
  'default light': LIGHT,
  'default dark': DARK,
  'custom light': { ...LIGHT, ...LIVE_CUSTOM },
  'custom dark': { ...DARK, ...LIVE_CUSTOM },
} as const;
type Theme = keyof typeof THEMES;
const ALL = Object.keys(THEMES) as Theme[];

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];

function hex(theme: Theme, token: string): Rgb {
  const value = (THEMES[theme] as Record<string, string>)[token];
  if (!value) throw new Error(`token ${token} missing in ${theme}`);
  return [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb;
}

/** `top` at `alpha` over `under` (Tailwind's `/10`, `/15`, `opacity-90`). */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((channel, i) => channel * alpha + under[i] * (1 - alpha)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3;

const surface = (theme: Theme) => hex(theme, 'v2-surface');
/** The band: `bg-[var(--v2-surface)]` under an aria-hidden `bg-[var(--v2-primary)]/10` layer. */
const band = (theme: Theme) => over(hex(theme, 'v2-primary'), 0.1, surface(theme));
/** The recommended column: `bg-[var(--v2-primary)]/5` over the surface (/10 failed the secondary text below). */
const recommended = (theme: Theme) => over(hex(theme, 'v2-primary'), 0.05, surface(theme));
/** The "Recommended" / "Needed for this" badge: `/15` primary over the recommended column. */
const markBadge = (theme: Theme) => over(hex(theme, 'v2-primary'), 0.15, recommended(theme));
/** The own column ("Your plan"), a tier's or the LF-2 own-plan column. */
const own = (theme: Theme) => hex(theme, 'v2-surface-hover');

describe('the helper is right (known WCAG values)', () => {
  it('black on white is 21:1, white on white 1:1, #767676 on white about 4.54:1', () => {
    expect(contrast([0, 0, 0], WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(contrast([118, 118, 118], WHITE)).toBeCloseTo(4.54, 2);
  });

  it('reads four themes: dark overrides the surface; the custom theme overrides the primary and secondary', () => {
    expect(THEMES['default dark']['v2-surface']).not.toBe(THEMES['default light']['v2-surface']);
    expect(THEMES['custom light']['v2-primary']).not.toBe(THEMES['default light']['v2-primary']);
    expect(THEMES['custom dark']['v2-surface']).toBe(THEMES['default dark']['v2-surface']);
  });

  it('the finding that motivated LF-1 is real: white words on the old band fail on the live theme', () => {
    // The old band: white words over a gradient whose end the live theme turned orange.
    expect(contrast(WHITE, hex('custom light', 'v2-secondary'))).toBeLessThan(NON_TEXT);
    expect(contrast(WHITE, hex('custom light', 'v2-primary'))).toBeLessThan(NON_TEXT);
  });
});

describe('LF-1: the band headline and subheading, on the primary tint, in every theme', () => {
  it.each(ALL)('%s: --v2-text-primary (headline and subheading) ≥ 4.5:1', (theme) => {
    expect(contrast(hex(theme, 'v2-text-primary'), band(theme))).toBeGreaterThanOrEqual(TEXT);
  });

  it('why the subheading is not --v2-text-secondary: on the /10 tint in light it falls under AA', () => {
    expect(contrast(hex('default light', 'v2-text-secondary'), band('default light'))).toBeLessThan(TEXT);
  });

  it.each(ALL)('%s: the X (--v2-text-primary at opacity-90) on the band ≥ 3:1', (theme) => {
    const under = band(theme);
    expect(contrast(over(hex(theme, 'v2-text-primary'), 0.9, under), under)).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

describe('LF-1: badges and the recommended column on the --v2-primary family', () => {
  it.each(ALL)('%s: "Recommended" / "Needed for this" words (--v2-text-primary on the /15 badge) ≥ 4.5:1', (theme) => {
    expect(contrast(hex(theme, 'v2-text-primary'), markBadge(theme))).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(ALL)('%s: "Your plan" words (--v2-text-primary on --v2-surface-hover) ≥ 4.5:1', (theme) => {
    expect(contrast(hex(theme, 'v2-text-primary'), own(theme))).toBeGreaterThanOrEqual(TEXT);
  });
});

describe('A-4 / Y-7: small secondary text on every surface it sits on', () => {
  const surfaces = (theme: Theme): Array<[string, Rgb]> => [
    ['--v2-surface', surface(theme)],
    ['--v2-surface-hover (own column)', own(theme)],
    ['--v2-primary at 5 % (recommended column)', recommended(theme)],
  ];
  it.each(ALL)('%s: --v2-text-secondary ≥ 4.5:1 on the surface and both column tints', (theme) => {
    for (const [name, under] of surfaces(theme)) {
      expect({ name, ok: contrast(hex(theme, 'v2-text-secondary'), under) >= TEXT }).toEqual({ name, ok: true });
    }
  });

  it.each(ALL)('%s: the "Coming soon" chip on --v2-bg reads ≥ 4.5:1 in the token it uses (--v2-text-primary)', (theme) => {
    expect(contrast(hex(theme, 'v2-text-primary'), hex(theme, 'v2-bg'))).toBeGreaterThanOrEqual(TEXT);
  });

  it('why the chip is not --v2-text-secondary: on --v2-bg in light it is just under AA', () => {
    expect(contrast(hex('default light', 'v2-text-secondary'), hex('default light', 'v2-bg'))).toBeLessThan(TEXT);
  });
});

describe('A-5: the "Back to plans" link', () => {
  it.each(ALL)('%s: --v2-text-primary on the surface ≥ 4.5:1', (theme) => {
    expect(contrast(hex(theme, 'v2-text-primary'), surface(theme))).toBeGreaterThanOrEqual(TEXT);
  });
});

describe('A-6: ✓ / ✕ marks, non-text ≥ 3:1', () => {
  it.each(ALL)('%s: ✓ (--v2-success-icon on --v2-success/15) and ✕ (--v2-text-secondary on --v2-border)', (theme) => {
    const tick = contrast(hex(theme, 'v2-success-icon'), over(hex(theme, 'v2-success'), 0.15, surface(theme)));
    const cross = contrast(hex(theme, 'v2-text-secondary'), hex(theme, 'v2-border'));
    expect({ tick: tick >= NON_TEXT, cross: cross >= NON_TEXT }).toEqual({ tick: true, cross: true });
  });
});

/**
 * The app's primary button (`bg-[var(--v2-primary)] text-white`), which LF-1
 * adopts for the modal's, the islands' and the drawer's buttons because it is how
 * every Business OS primary button is drawn. MEASURED, not passed: white on the
 * default indigo is just under AA, and on the live orange it is about 2.3:1. That
 * is a property of the platform theme, shared by every primary button in the
 * app, not of this window: the fix is a theme decision (a darker primary, or an
 * "on-primary" text token), recorded for the user in the UM-3 workplan (LF-1).
 * Pinned so a theme change shows up here, in either direction.
 */
describe('the app primary button, as measured (a platform theme finding, LF-1)', () => {
  it('white on --v2-primary: default ≈ 4.47:1 (just under AA), live custom ≈ 2.26:1', () => {
    expect(contrast(WHITE, hex('default light', 'v2-primary'))).toBeCloseTo(4.47, 1);
    expect(contrast(WHITE, hex('custom light', 'v2-primary'))).toBeCloseTo(2.26, 1);
  });
});
