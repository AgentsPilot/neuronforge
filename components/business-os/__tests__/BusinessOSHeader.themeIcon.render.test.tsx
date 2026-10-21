/**
 * @jest-environment jsdom
 *
 * T-H: the theme toggle's icon does not depend on `mode` (performance slice
 * TH-1, SA Q-3). The server HTML is painted before hydration, and `mode` is
 * 'light' until the provider mounts, so a mode-driven icon would show a Moon to
 * a dark-mode owner for the whole pre-hydration window. Both icons are rendered
 * and the `.dark` class (set before paint by V2ThemeScript) picks one.
 */

import React from 'react';
import { TextEncoder } from 'util';

Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');

let mockMode: 'light' | 'dark' = 'light';
jest.mock('@/lib/design-system-v2', () => ({
  useV2Theme: () => ({ mode: mockMode, toggleMode: () => {} }),
}));
jest.mock('@/lib/design-system-v2/theme-provider', () => ({
  useV2Theme: () => ({ mode: mockMode, toggleMode: () => {} }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: () => {}, t: (k: string) => k }),
}));
jest.mock('@/components/business-os/lazyDialogs', () => ({ LazySchedulingDialog: () => null }));

import { BusinessOSHeader } from '@/components/business-os/BusinessOSHeader';
import { DarkModeToggle } from '@/components/v2/DarkModeToggle';

// A dependency of the header uses useLayoutEffect; under jsdom React warns
// that it "does nothing on the server". Unrelated to the icon, so muted here;
// any other console.error still fails the test.
let consoleError: jest.SpyInstance;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
    throw new Error(`unexpected console.error: ${String(args[0])}`);
  });
});
afterEach(() => consoleError.mockRestore());

function render(mode: 'light' | 'dark', element: React.ReactElement) {
  mockMode = mode;
  return renderToStaticMarkup(element);
}

/** The toggle button's markup in the header. */
function headerToggle(markup: string): string {
  const at = markup.indexOf('aria-label="Toggle dark mode"');
  expect(at).toBeGreaterThan(-1);
  return markup.slice(at, markup.indexOf('</button>', at));
}

describe('BusinessOSHeader', () => {
  it('renders identical markup in light and dark', () => {
    expect(render('dark', <BusinessOSHeader />)).toBe(render('light', <BusinessOSHeader />));
  });

  it('holds both icons, switched by the dark class', () => {
    const toggle = headerToggle(render('light', <BusinessOSHeader />));
    expect(toggle).toMatch(/lucide-moon[^"]*dark:hidden/);
    expect(toggle).toMatch(/lucide-sun[^"]*hidden dark:block/);
  });
});

describe('DarkModeToggle', () => {
  it('icon markup is identical in light and dark (the aria-label is excluded, R-8)', () => {
    const strip = (m: string) => m.replace(/aria-label="[^"]*"/, '');
    expect(strip(render('dark', <DarkModeToggle />))).toBe(strip(render('light', <DarkModeToggle />)));
  });

  it('holds both icons, switched by the dark class', () => {
    const markup = render('light', <DarkModeToggle />);
    expect(markup).toMatch(/lucide-moon[^"]*dark:hidden/);
    expect(markup).toMatch(/lucide-sun[^"]*hidden dark:block/);
  });
});
