/**
 * @jest-environment jsdom
 *
 * T-S: the pre-paint theme script (performance slice TH-1). It must make the
 * same light/dark decision `V2ThemeProvider` makes after mount, so the
 * provider never flips the class the script set (SA surprise 2, RC-3).
 */

import React from 'react';
import { act } from 'react';
import { TextEncoder } from 'util';

// jsdom has no TextEncoder, which the browser build of react-dom/server needs.
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
import { createRoot } from 'react-dom/client';

import { V2ThemeScript, V2_THEME_SCRIPT, V2_THEME_SCRIPT_FORCE_LIGHT } from '../V2ThemeScript';
import { V2ThemeProvider } from '../theme-provider';
import { V2_THEME_STORAGE_KEY } from '../themeMode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockOs(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const runScript = () => new Function(V2_THEME_SCRIPT)();
const isDark = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
});

type Stored = 'dark' | 'light' | 'garbage' | '' | null;
const STORED: Stored[] = ['dark', 'light', 'garbage', '', null];
const CASES = STORED.flatMap((stored) => [true, false].map((osDark) => [stored, osDark] as const));
const expected = (stored: Stored, osDark: boolean) => (stored ? stored === 'dark' : osDark);

describe('T-S1 behaviour', () => {
  it.each(CASES)('stored %p, OS dark %p', (stored, osDark) => {
    mockOs(osDark);
    if (stored !== null) localStorage.setItem(V2_THEME_STORAGE_KEY, stored);
    runScript();
    expect(isDark()).toBe(expected(stored, osDark));
  });
});

describe('T-S2 parity with the provider: no class flip at any mutation (RC-3)', () => {
  it.each(CASES)('stored %p, OS dark %p', async (stored, osDark) => {
    mockOs(osDark);
    if (stored !== null) localStorage.setItem(V2_THEME_STORAGE_KEY, stored);
    runScript();

    const flips: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.attributeName !== 'class') continue;
        const was = (r.oldValue ?? '').split(/\s+/).includes('dark');
        const is = document.documentElement.classList.contains('dark');
        if (was !== is) flips.push(`${was}->${is}`);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeOldValue: true });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<V2ThemeProvider><span /></V2ThemeProvider>);
    });
    await act(async () => {});
    // Deliver any queued records before reading.
    const pending = observer.takeRecords();
    for (const r of pending) {
      const was = (r.oldValue ?? '').split(/\s+/).includes('dark');
      if (r.attributeName === 'class' && was !== isDark()) flips.push('late');
    }
    observer.disconnect();
    act(() => root.unmount());
    host.remove();

    expect(flips).toEqual([]);
    expect(isDark()).toBe(expected(stored, osDark));
  });
});

describe('T-S3/T-S4 edge cases', () => {
  it('removes a stale .dark when light is stored', () => {
    mockOs(true);
    document.documentElement.classList.add('dark');
    localStorage.setItem(V2_THEME_STORAGE_KEY, 'light');
    runScript();
    expect(isDark()).toBe(false);
  });

  it('does nothing and does not throw when storage throws', () => {
    mockOs(true);
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(runScript).not.toThrow();
    expect(isDark()).toBe(false);
    spy.mockRestore();
  });
});

/**
 * The onboarding pairing, which has the same contract and one extra promise.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS. `v2-theme-mode` is a DEVICE key by deliberate design, excluded
 * from the keys sign-out clears on the grounds that it identifies nobody, so it
 * outlives the owner who set it. Reported from testing: the second owner to
 * onboard on a browser got the first one's dark mode, and a mere default could
 * not fix it because a value WAS stored.
 *
 * So this mode reads nothing. The extra promise is that it also WRITES nothing:
 * an owner who chose dark on their dashboard must still have dark after passing
 * through onboarding, and `applyTheme` persists on every call unless told not
 * to. That is asserted here because nothing else would notice it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('T-S6 the forced-light segment', () => {
  const runForced = () => new Function(V2_THEME_SCRIPT_FORCE_LIGHT)();

  it.each(CASES)('paints light whatever is stored: %p, OS dark %p', (stored, osDark) => {
    mockOs(osDark);
    if (stored !== null) localStorage.setItem(V2_THEME_STORAGE_KEY, stored);
    /* The class a previous segment may have left on the element. */
    document.documentElement.classList.add('dark');

    runForced();

    expect(isDark()).toBe(false);
  });

  it.each(CASES)('and the provider agrees, with no flip: %p, OS dark %p', async (stored, osDark) => {
    mockOs(osDark);
    if (stored !== null) localStorage.setItem(V2_THEME_STORAGE_KEY, stored);
    runForced();

    const flips: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.attributeName !== 'class') continue;
        const was = (r.oldValue ?? '').split(/\s+/).includes('dark');
        if (was !== isDark()) flips.push(`${was}->${isDark()}`);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeOldValue: true });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<V2ThemeProvider mode="light"><span /></V2ThemeProvider>);
    });
    await act(async () => {});
    observer.takeRecords();
    observer.disconnect();
    act(() => root.unmount());
    host.remove();

    expect(flips).toEqual([]);
    expect(isDark()).toBe(false);
  });

  it('leaves a dark preference exactly as it found it', async () => {
    /* The promise the whole mode depends on. A write here would mean passing
       through onboarding silently relit the rest of the product. */
    mockOs(false);
    localStorage.setItem(V2_THEME_STORAGE_KEY, 'dark');
    runForced();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<V2ThemeProvider mode="light"><span /></V2ThemeProvider>);
    });
    await act(async () => {});
    act(() => root.unmount());
    host.remove();

    expect(localStorage.getItem(V2_THEME_STORAGE_KEY)).toBe('dark');
  });

  it('still persists in an owner segment, which is the behaviour it must not break', () => {
    /* The control for the test above: `persist` defaults to true everywhere
       else, and a mode prop that silently disabled it would be invisible. */
    expect(V2_THEME_SCRIPT).toContain(JSON.stringify(V2_THEME_STORAGE_KEY));
    expect(V2_THEME_SCRIPT_FORCE_LIGHT).not.toContain(JSON.stringify(V2_THEME_STORAGE_KEY));
  });
});

describe('T-S5 static markup', () => {
  it('is one script, identical across renders, keyed by the shared constant, class only', () => {
    const a = renderToStaticMarkup(<V2ThemeScript />);
    const b = renderToStaticMarkup(<V2ThemeScript />);
    expect(a).toBe(b);
    expect(a.match(/<script>/g)).toHaveLength(1);
    expect(a).toMatch(/^<script>[\s\S]*<\/script>$/);
    expect(a).toContain(JSON.stringify(V2_THEME_STORAGE_KEY));
    for (const forbidden of ['lang', 'dir', 'colorScheme', 'data-public-surface', 'style']) {
      expect(V2_THEME_SCRIPT).not.toContain(forbidden);
    }
  });
});
