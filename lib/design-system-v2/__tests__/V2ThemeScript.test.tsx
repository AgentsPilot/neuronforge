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

import { V2ThemeScript, V2_THEME_SCRIPT } from '../V2ThemeScript';
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
