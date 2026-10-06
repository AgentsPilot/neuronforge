/**
 * The status colours exist twice, and must not drift.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED BY THE OWNER, 2026-10-05: the advisor card's "if I handle it" line
 * could not be read in dark mode.
 *
 * The twelve `--v2-status-*` tokens were declared ONLY in
 * `app/v2/globals-v2.css`, a stylesheet imported by `/v2` and
 * `/business-os/crm` and by nothing else. The advisor card lives on
 * `/business-os`, so every one of them was undefined there.
 *
 * An undefined custom property with no fallback invalidates the whole
 * declaration, and it fails quietly in two directions at once:
 *
 *   color       inherits instead, so a bright green turned muted grey
 *   background  resolves to nothing, so the tinted panel lost its tint and the
 *               two outcomes looked identical
 *
 * Neither throws, neither logs, and the only way to find it is for somebody to
 * look at the screen. `V2ThemeProvider` now sets all twelve inline, which
 * reaches every page using the provider.
 *
 * WHICH MEANS THEY NOW EXIST IN TWO PLACES. An inline style on the root element
 * beats a `:root` rule, so the provider's values are what render wherever both
 * are loaded — and a change to the stylesheet alone would do nothing at all,
 * visibly, while looking entirely correct in the diff.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(__dirname, '..', '..', '..', 'app', 'v2', 'globals-v2.css'), 'utf8');
const provider = readFileSync(join(__dirname, '..', 'theme-provider.tsx'), 'utf8');

/**
 * The status tokens from one block of the stylesheet.
 *
 * `:root` is everything up to the dark override; the dark block is what
 * follows it. Split on the selector rather than by line number so an edit
 * above does not silently point this at the wrong half.
 */
function stylesheetTokens(which: 'light' | 'dark'): Record<string, string> {
  const darkAt = css.indexOf('.dark,');
  const block = which === 'light' ? css.slice(0, darkAt) : css.slice(darkAt);

  const found: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/(--v2-status-[a-z-]+):\s*(#[0-9A-Fa-f]{3,8})/g)) {
    found[name] = value.toUpperCase();
  }
  return found;
}

/** What the provider writes, read out of its two literal objects. */
function providerTokens(which: 'light' | 'dark'): Record<string, string> {
  const block = provider.slice(provider.indexOf('const statusColors = isDark'));
  const [darkLiteral, lightLiteral] = block.split('      : {');
  const source = which === 'dark' ? darkLiteral : lightLiteral;

  /** `successBg: '#1E293B'` → `--v2-status-success-bg`. */
  const found: Record<string, string> = {};
  for (const [, key, value] of source.matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{3,8})'/g)) {
    const kebab = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    found[`--v2-status-${kebab}`] = value.toUpperCase();
  }
  return found;
}

describe.each(['light', 'dark'] as const)('the %s status tokens', theme => {
  const fromCss = stylesheetTokens(theme);
  const fromProvider = providerTokens(theme);

  it('were found in both places, so this guard is comparing something', () => {
    // A rename that broke either parse would otherwise make every assertion
    // below pass against two empty objects.
    expect(Object.keys(fromCss)).toHaveLength(12);
    expect(Object.keys(fromProvider)).toHaveLength(12);
  });

  it('agree on every value', () => {
    /*
     * The provider's inline style beats the stylesheet's `:root`, so where
     * they disagree the stylesheet is dead text that still reads as the source
     * of truth. Change both, or neither.
     */
    expect(fromProvider).toEqual(fromCss);
  });
});

describe('the provider', () => {
  it('sets every status token it declares', () => {
    /*
     * Declaring a colour and never writing it leaves the token undefined,
     * which is the original bug exactly: the value looks present in the source
     * and is absent in the browser.
     */
    for (const name of Object.keys(stylesheetTokens('dark'))) {
      expect(provider).toContain(`root.style.setProperty('${name}'`);
    }
  });

  it('still sets the families it already owned', () => {
    // `--v2-success-*` and `--v2-error-*` are a different family from
    // `--v2-status-*-*`, and both are in use. Losing either is the same bug.
    for (const name of ['--v2-success-text', '--v2-error-text', '--v2-text-secondary']) {
      expect(provider).toContain(`root.style.setProperty('${name}'`);
    }
  });
});

describe('the dark values are actually readable', () => {
  /** Relative luminance, per WCAG. */
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map(i => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  const dark = stylesheetTokens('dark');

  it.each(['success', 'executing', 'error', 'warning'])(
    'puts %s text well clear of its own panel',
    kind => {
      /*
       * 4.5:1 is the WCAG AA floor for body text. Asserted against the token's
       * OWN background rather than the card's, because that is the pairing the
       * component renders — and the pairing nobody checked when the status
       * family was written.
       */
      const ratio = contrast(dark[`--v2-status-${kind}-text`], dark[`--v2-status-${kind}-bg`]);
      expect(ratio).toBeGreaterThan(4.5);
    }
  );
});
