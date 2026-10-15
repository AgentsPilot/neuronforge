/**
 * @jest-environment jsdom
 *
 * T-P: `V2ThemeProvider` after TH-1. It renders its children on the server,
 * hydrates cleanly over the pre-paint script's `.dark`, never reads the
 * database, writes the server-supplied custom tokens from its first effect run,
 * and (SA RC-1) does all of that before paint on a client-side mount.
 */

import React, { useLayoutEffect } from 'react';
import { act } from 'react';
import { TextEncoder } from 'util';

Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToString } = require('react-dom/server') as typeof import('react-dom/server');
import { createRoot, hydrateRoot } from 'react-dom/client';

// T-P5: the provider must not reach the browser Supabase client at all.
jest.mock('@/lib/supabaseClient', () => {
  throw new Error('theme-provider must not import @/lib/supabaseClient');
});

// RC-16: the provider's client logger, captured (failures must be silent on the console).
const clientWarn = jest.fn();
jest.mock('@/lib/logger/client', () => {
  const l: Record<string, unknown> = { warn: (...a: unknown[]) => clientWarn(...a), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  l.child = () => l;
  return { clientLogger: l };
});

import { V2ThemeProvider, useV2Theme, V2_CUSTOM_TOKENS_CORRECTION_PATH } from '../theme-provider';
import { V2_THEME_STORAGE_KEY } from '../themeMode';
import type { V2CustomTokens } from '../customTokens';

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

const html = document.documentElement;

let consoleError: jest.SpyInstance;
beforeEach(() => {
  localStorage.clear();
  html.className = '';
  html.removeAttribute('style');
  document.body.innerHTML = '';
  mockOs(false);
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

/*
 * console.error calls other than one jsdom artefact: these tests server-render
 * in jsdom, where `window` exists, so the module's isomorphic alias picked
 * `useLayoutEffect` and React warns that it "does nothing on the server". On a
 * real server `window` is undefined and the alias is `useEffect`.
 */
const realErrors = () =>
  consoleError.mock.calls.filter((args) => !String(args[0]).includes('useLayoutEffect does nothing on the server'));

/** Records every `dark` flip on <html>, honouring RC-3 (a re-add is not a flip). */
function watchDarkFlips() {
  const flips: string[] = [];
  const handle = (records: MutationRecord[]) => {
    for (const r of records) {
      if (r.attributeName !== 'class') continue;
      const was = (r.oldValue ?? '').split(/\s+/).includes('dark');
      const is = html.classList.contains('dark');
      if (was !== is) flips.push(`${was}->${is}`);
    }
  };
  const observer = new MutationObserver(handle);
  observer.observe(html, { attributes: true, attributeOldValue: true });
  return () => {
    handle(observer.takeRecords());
    observer.disconnect();
    return flips;
  };
}

describe('T-P1 children are server-rendered', () => {
  it('renderToString contains the child', () => {
    const markup = renderToString(<V2ThemeProvider><span id="c">x</span></V2ThemeProvider>);
    expect(markup).toContain('id="c"');
  });
});

describe('T-P2 hydration over the script\'s .dark', () => {
  it('no warning, no flip, dark variables written', async () => {
    const tree = <V2ThemeProvider><span id="c">x</span></V2ThemeProvider>;
    const host = document.createElement('div');
    host.innerHTML = renderToString(tree);
    document.body.appendChild(host);

    localStorage.setItem(V2_THEME_STORAGE_KEY, 'dark');
    html.classList.add('dark'); // what V2ThemeScript did before paint
    const stop = watchDarkFlips();

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, tree);
    });
    const flips = stop();

    expect(realErrors()).toEqual([]);
    expect(flips).toEqual([]);
    expect(html.classList.contains('dark')).toBe(true);
    expect(html.style.getPropertyValue('--v2-bg')).toBe('#0F172A');
    act(() => root.unmount());
  });
});

function ToggleProbe() {
  const { toggleMode, mode } = useV2Theme();
  return <button onClick={toggleMode}>{mode}</button>;
}

describe('T-P2b hydration with a real `mode` consumer inside the boundary (SA CR-2)', () => {
  it('no error, no flip, server text light, settled text dark', async () => {
    const tree = <V2ThemeProvider><ToggleProbe /></V2ThemeProvider>;
    const serverHtml = renderToString(tree);
    expect(serverHtml).toContain('>light</button>');

    const host = document.createElement('div');
    host.innerHTML = serverHtml;
    document.body.appendChild(host);
    localStorage.setItem(V2_THEME_STORAGE_KEY, 'dark');
    html.classList.add('dark'); // what V2ThemeScript did before paint
    const button = host.querySelector('button')!;
    const stop = watchDarkFlips();

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, tree);
    });
    await act(async () => {});
    const flips = stop();

    expect(realErrors()).toEqual([]);
    expect(flips).toEqual([]);
    // The server node was hydrated, not replaced by a client render.
    expect(host.querySelector('button')).toBe(button);
    expect(button.textContent).toBe('dark');
    act(() => root.unmount());
  });
});

describe('T-P3 toggle', () => {
  it('flips .dark and persists the choice', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<V2ThemeProvider><ToggleProbe /></V2ThemeProvider>);
    });
    expect(html.classList.contains('dark')).toBe(false);
    await act(async () => {
      host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(html.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(V2_THEME_STORAGE_KEY)).toBe('dark');
    act(() => root.unmount());
  });
});

function ServerBomb(): React.ReactElement {
  if (typeof window === 'undefined' || (globalThis as { __SSR_BOMB__?: boolean }).__SSR_BOMB__) {
    throw new Error('server-only failure');
  }
  return <span id="ok">client</span>;
}

describe('T-P4 fail-soft boundary (RC-5; Jest approximation, T-1 is the real proof)', () => {
  it('a child that throws during server render does not fail the outer render', () => {
    (globalThis as { __SSR_BOMB__?: boolean }).__SSR_BOMB__ = true;
    try {
      const markup = renderToString(
        <div id="outer"><V2ThemeProvider><ServerBomb /></V2ThemeProvider></div>
      );
      expect(markup).toContain('id="outer"');
      expect(markup).not.toContain('id="ok"');
    } finally {
      delete (globalThis as { __SSR_BOMB__?: boolean }).__SSR_BOMB__;
    }
  });

  it('the boundary is a Suspense with a null fallback around the children', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'theme-provider.tsx'), 'utf8') as string;
    expect(source).toContain('<Suspense fallback={null}>{children}</Suspense>');
  });
});

describe('T-P5/T-P6 no database, no logging', () => {
  it('render, mount and toggle touch neither Supabase nor console', async () => {
    renderToString(<V2ThemeProvider><ToggleProbe /></V2ThemeProvider>);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      root.render(<V2ThemeProvider><ToggleProbe /></V2ThemeProvider>);
    });
    await act(async () => {
      host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(realErrors()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    act(() => root.unmount());
  });
});

describe('T-P7 custom tokens are written first, never defaults first', () => {
  it.each([false, true])('dark %p', async (dark) => {
    if (dark) localStorage.setItem(V2_THEME_STORAGE_KEY, 'dark');
    const tokens: V2CustomTokens = { colors: { primary: '#0000A1', background: '#0000A2' } };
    const seen: Record<string, string[]> = {};
    const real = CSSStyleDeclaration.prototype.setProperty;
    const spy = jest.spyOn(CSSStyleDeclaration.prototype, 'setProperty').mockImplementation(function (
      this: CSSStyleDeclaration, name: string, value: string | null, priority?: string
    ) {
      (seen[name] ??= []).push(String(value));
      return real.call(this, name, value, priority);
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<V2ThemeProvider customTokens={tokens}><span /></V2ThemeProvider>);
    });
    spy.mockRestore();
    // Written at mount and again when the mode state settles: always the custom
    // value, never a default first.
    expect(seen['--v2-primary'].length).toBeGreaterThan(0);
    expect(new Set(seen['--v2-primary'])).toEqual(new Set(['#0000A1']));
    expect(new Set(seen['--v2-bg'])).toEqual(new Set(['#0000A2']));
    act(() => root.unmount());
  });
});

describe('T-P8 client-side mount sets the theme in the same commit (RC-1)', () => {
  it('.dark and --v2-bg are set by the time a later layout effect runs', async () => {
    localStorage.setItem(V2_THEME_STORAGE_KEY, 'dark');
    const observed: Array<{ dark: boolean; bg: string }> = [];
    function Sibling() {
      // Runs after the provider's layout effects of the same commit (children
      // first, then parents, so this is placed AFTER the provider).
      useLayoutEffect(() => {
        observed.push({ dark: html.classList.contains('dark'), bg: html.style.getPropertyValue('--v2-bg') });
      });
      return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <>
          <V2ThemeProvider><span /></V2ThemeProvider>
          <Sibling />
        </>
      );
    });
    // Synchronous act: no passive effects have been allowed to run before this
    // check unless they were flushed inside the commit. The last observation is
    // after the provider's second (mounted) layout pass.
    expect(observed[observed.length - 1]).toEqual({ dark: true, bg: '#0F172A' });
    act(() => root.unmount());
  });
});

/* ── RC-16: the browser correction for an unknown server render ─────────── */

type FetchMock = jest.Mock<Promise<unknown>, [string, RequestInit?]>;
function installFetch(impl: (url: string, init?: RequestInit) => Promise<unknown>): FetchMock {
  const f = jest.fn(impl) as FetchMock;
  (globalThis as { fetch?: unknown }).fetch = f;
  return f;
}
const okJson = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

async function mountClient(props: { customTokensKnown?: boolean; customTokens?: V2CustomTokens }) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<V2ThemeProvider {...props}><span /></V2ThemeProvider>);
  });
  await act(async () => {});
  return root;
}

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
  clientWarn.mockReset();
});

describe('T-P9 no fetch when the server knew the tokens', () => {
  it.each([
    ['omitted (defaults to true)', {}],
    ['true', { customTokensKnown: true }],
    ['true with tokens', { customTokensKnown: true, customTokens: { colors: { primary: '#0000A1' } } }],
  ])('customTokensKnown %s → zero fetch calls', async (_label, props) => {
    const f = installFetch(() => okJson({ success: true, data: {} }));
    const root = await mountClient(props as { customTokensKnown?: boolean });
    expect(f).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

describe('T-P10 the correction when the server did not know', () => {
  it('fetches the one path, no-store, and applies the answer on <html>', async () => {
    const f = installFetch(() => okJson({ success: true, data: { colors: { primary: '#0000A1' } } }));
    const root = await mountClient({ customTokensKnown: false });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(V2_CUSTOM_TOKENS_CORRECTION_PATH);
    expect(f.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    expect(html.style.getPropertyValue('--v2-primary')).toBe('#0000A1');
    expect(realErrors()).toEqual([]);
    act(() => root.unmount());
  });

  it('re-sanitizes the answer: a poisoned value never reaches <html>', async () => {
    const written: string[] = [];
    const real = CSSStyleDeclaration.prototype.setProperty;
    const spy = jest.spyOn(CSSStyleDeclaration.prototype, 'setProperty').mockImplementation(function (
      this: CSSStyleDeclaration, name: string, value: string | null, priority?: string
    ) {
      written.push(`${name}:${String(value)}`);
      return real.call(this, name, value, priority);
    });
    installFetch(() => okJson({ success: true, data: { colors: { primary: 'url(javascript:alert(1))', secondary: '#0000A2' } } }));
    const root = await mountClient({ customTokensKnown: false });
    spy.mockRestore();
    expect(written.some((w) => w.includes('javascript'))).toBe(false);
    expect(html.style.getPropertyValue('--v2-primary')).toBe('#6366F1');
    expect(html.style.getPropertyValue('--v2-secondary')).toBe('#0000A2');
    act(() => root.unmount());
  });

  it.each([
    ['a 503', () => okJson({ success: false, error: 'Theme unavailable' }, 503)],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['success: false with 200', () => okJson({ success: false })],
    ['a non-JSON body', () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('x')) })],
  ])('%s leaves the defaults, with zero console.error', async (_label, impl) => {
    installFetch(impl as () => Promise<unknown>);
    const root = await mountClient({ customTokensKnown: false });
    expect(html.style.getPropertyValue('--v2-primary')).toBe('#6366F1');
    expect(realErrors()).toEqual([]);
    act(() => root.unmount());
  });

  it('writes nothing after unmount', async () => {
    let release!: (v: unknown) => void;
    installFetch((_url, init) => new Promise((resolve, reject) => {
      release = resolve;
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const root = await mountClient({ customTokensKnown: false });
    act(() => root.unmount());
    release({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { colors: { primary: '#0000A1' } } }) });
    await act(async () => {});
    expect(html.style.getPropertyValue('--v2-primary')).not.toBe('#0000A1');
    expect(clientWarn).not.toHaveBeenCalled();
    expect(realErrors()).toEqual([]);
  });
});
