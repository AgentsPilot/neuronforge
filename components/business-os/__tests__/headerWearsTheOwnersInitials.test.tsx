/**
 * @jest-environment jsdom
 *
 * The settings control in the header is the owner's initials.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED, AND WHAT MUST NOT HAVE
 *
 * A gear icon became a pair of letters. That is the whole visible change — and
 * the risk is entirely in the parts that are NOT supposed to move: the button
 * still goes to the settings page, still announces itself as settings to a
 * screen reader, and still occupies the same square beside the calendar and
 * theme controls. Initials alone say nothing about where the button goes, so
 * the `aria-label` is now the only thing carrying that meaning and is asserted
 * harder here than it was before.
 *
 * The fallback is the other half. The name comes from `profiles`, read on the
 * server, and every way that read can come back empty — no session, no profile
 * row, no name, no email, a thrown error — ends at `null`. The header must then
 * render the gear it has always rendered, because a blank tinted square in the
 * corner of every screen reads as a broken avatar.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { TextEncoder } from 'util';

Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');

jest.mock('@/lib/design-system-v2', () => ({
  useV2Theme: () => ({ mode: 'light', toggleMode: () => {} }),
}));
jest.mock('@/lib/design-system-v2/theme-provider', () => ({
  useV2Theme: () => ({ mode: 'light', toggleMode: () => {} }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: () => {}, t: (k: string) => k }),
}));
jest.mock('@/components/business-os/lazyDialogs', () => ({ LazySchedulingDialog: () => null }));

import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { ownerInitials } from '@/lib/business-os/ownerInitials';

// See BusinessOSHeader.themeIcon.render.test.tsx: a dependency uses
// useLayoutEffect, which React warns about when rendered to static markup.
let consoleError: jest.SpyInstance;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
    throw new Error(`unexpected console.error: ${String(args[0])}`);
  });
});
afterEach(() => consoleError.mockRestore());

/**
 * The settings button alone.
 *
 * Bounded on the button, because the header is full of other markup and an
 * unbounded search would happily find a gear belonging to something else — or,
 * worse, pass because the initials appear somewhere entirely different.
 */
function settingsButton(initials: string | null): string {
  const markup = renderToStaticMarkup(<BusinessOSHeader ownerInitials={initials} />);
  const at = markup.indexOf('aria-label="settings.title"');

  expect(at).toBeGreaterThan(-1);

  // Back to the opening tag, forward to the close: the whole element.
  return markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('</button>', at));
}

describe('the button', () => {
  it('shows the initials instead of the gear', () => {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE ONE THAT WAS ASKED FOR.
     * ───────────────────────────────────────────────────────────────────────
     */
    const button = settingsButton('OO');

    expect(button).toContain('OO');
    expect(button).not.toContain('lucide-settings');
  });

  it('keeps the gear when there is nothing to show', () => {
    /*
     * The server read returns `null` for a signed-out render, an account with
     * no profile row and no email, and any error on the way. All of them land
     * here, and all of them must leave the header exactly as it was.
     */
    const button = settingsButton(null);

    expect(button).toContain('lucide-settings');
  });

  it('still says where it goes, either way', () => {
    // Two capital letters are not a word for "settings". Without the label
    // this control becomes unreadable to anyone not already familiar with it.
    expect(settingsButton('OO')).toContain('aria-label="settings.title"');
    expect(settingsButton(null)).toContain('aria-label="settings.title"');
  });

  it('does not read the letters out loud on top of that label', () => {
    // "O O settings" is worse than either half alone, so the span is hidden
    // exactly as the icon it replaces was.
    expect(settingsButton('OO')).toMatch(/aria-hidden="true"/);
  });

  it('keeps the geometry of the controls beside it', () => {
    /*
     * The row is four squares of one size. A chip that sized itself to its
     * text would make the last one a different shape on every account.
     */
    for (const initials of ['OO', null]) {
      expect(settingsButton(initials)).toMatch(/w-9 h-9 sm:w-10 sm:h-10/);
    }
  });
});

describe('the initials themselves', () => {
  it.each([
    ['Offir Omer', 'OO'],
    ['offir omer', 'OO'],
    ['  Offir   Omer  ', 'OO'],
    ['Offir', 'O'],
  ])('reads %s as %s', (name, expected) => {
    expect(ownerInitials(name, 'someone@example.com')).toBe(expected);
  });

  it('takes the ends of a longer name, not the middle', () => {
    // Three letters do not fit the square, and the pair people recognise is
    // the first and the last.
    expect(ownerInitials('Ada Byron Lovelace')).toBe('AL');
  });

  it('works in a script that has no capitals', () => {
    // Hebrew has no case, so `toLocaleUpperCase` returns the letters unchanged
    // — which is the correct answer, not a failure to apply the rule.
    expect(ownerInitials('אופיר עומר')).toBe('אע');
  });

  it('falls back to the email when no name was ever saved', () => {
    expect(ownerInitials(null, 'offir@example.com')).toBe('O');
  });

  it('never takes a letter from the domain', () => {
    // `@` and everything after it belongs to the mail host, not the person.
    expect(ownerInitials('', '@example.com')).toBe('');
  });

  it('reports having nothing rather than inventing something', () => {
    /*
     * The empty string is what makes the gear fallback reachable. A default
     * letter here — 'U' for user, as an older layout does — would put the same
     * initial on every account that had not filled in a name.
     */
    expect(ownerInitials(null, null)).toBe('');
    expect(ownerInitials('   ', '   ')).toBe('');
  });
});
