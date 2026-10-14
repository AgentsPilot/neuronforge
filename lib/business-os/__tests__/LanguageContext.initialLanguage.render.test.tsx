/**
 * @jest-environment jsdom
 *
 * The REAL `LanguageProvider` with a server-supplied first language
 * (performance business round BR-1a; workplan §8.3 P-1..P-9, C-1..C-6, T-1).
 *
 * What this pins:
 *   - the first content render is the saved language, and a browser's older
 *     pick never flashes over it (AC-1.3);
 *   - with nothing saved, today's path is unchanged: English, then this
 *     browser's pick, then one backfill (AC-1.4, AC-1.5b);
 *   - the display currency is still derived from the LOCALSTORAGE language,
 *     never from the server one (SA-6, AC-1.10), and the timezone stays `UTC`
 *     until the preferences row arrives;
 *   - the `dir`/`lang` wrapper is right on the first commit and follows a switch.
 *
 * In production the provider is mounted inside `V2ThemeProvider`, which renders
 * nothing on the server, so the provider's first render is a CLIENT render.
 * That is what these tests do. P-8 is the one defensive server-render test.
 */

import React, { useLayoutEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';

jest.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) } },
}));

import { LanguageProvider, useLanguage, translations } from '@/lib/business-os/LanguageContext';
import type { InitialLanguage } from '@/lib/business-os/ownerLanguage';

const HE_LABEL = translations.he['settings.profile.language'];
const EN_LABEL = translations.en['settings.profile.language'];

// ── Network ────────────────────────────────────────────────────────────────

interface GetReply {
  status?: number;
  preferredLanguage?: string | null;
  timezone?: string | null;
  businessCurrency?: string | null;
}

let patches: unknown[] = [];
let releaseGet: () => void = () => {};

function mockNetwork(reply: GetReply, { hold = false } = {}): void {
  patches = [];
  const gate = new Promise<void>((resolve) => {
    releaseGet = resolve;
    if (!hold) resolve();
  });

  global.fetch = jest.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
    if (init?.method === 'PATCH') {
      patches.push(JSON.parse(init.body ?? '{}'));
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
    }
    await gate;
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => ({
        success: status < 400,
        data: {
          locale: { preferredLanguage: reply.preferredLanguage ?? null, timezone: reply.timezone ?? null },
          currency: { businessCurrency: reply.businessCurrency ?? null },
        },
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

// ── Probe ──────────────────────────────────────────────────────────────────

interface Seen {
  language: string;
  currencyCode: string;
  businessCurrency: string | undefined;
  timezone: string;
}

let seen: Seen[] = [];
let api: ReturnType<typeof useLanguage> | null = null;

function Probe() {
  const ctx = useLanguage();
  api = ctx;
  seen.push({
    language: ctx.language,
    currencyCode: ctx.currencyCode,
    businessCurrency: ctx.businessCurrency,
    timezone: ctx.timezone,
  });
  return <span data-testid="label">{ctx.t('settings.profile.language')}</span>;
}

const last = () => seen[seen.length - 1];
const settled = () => waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/**
 * Let a held GET through and wait, inside act, until the provider has applied
 * it, so no state update lands after the test has finished (SA O-1: no act()
 * warnings in the output).
 */
async function releaseAndSettle(): Promise<void> {
  await act(async () => { releaseGet(); });
  await waitFor(() => expect(seen.length).toBeGreaterThan(0));
  await flush();
}

function mount(initial?: InitialLanguage, { strict = false } = {}) {
  const tree = (
    <LanguageProvider initial={initial}>
      <Probe />
    </LanguageProvider>
  );
  return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
}

const SAVED_HE: InitialLanguage = { language: 'he', source: 'saved' };

beforeEach(() => {
  localStorage.clear();
  seen = [];
  api = null;
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

// ── Language ───────────────────────────────────────────────────────────────

describe('a saved language is drawn first and never overridden (AC-1.3)', () => {
  it('P-1/P-2: every render is he, and localStorage ends as he', async () => {
    localStorage.setItem('business-os-language', 'en');
    mockNetwork({ preferredLanguage: 'he' });

    mount(SAVED_HE);
    await settled();
    await flush();

    expect(seen.map((s) => s.language)).not.toContain('en');
    expect(new Set(seen.map((s) => s.language))).toEqual(new Set(['he']));
    expect(localStorage.getItem('business-os-language')).toBe('he');
    expect(patches).toEqual([]);
  });
});

describe('nothing saved: today\'s path (AC-1.4)', () => {
  it('P-3: English, then this browser\'s pick, then exactly one backfill', async () => {
    localStorage.setItem('business-os-language', 'es');
    mockNetwork({ preferredLanguage: null });

    mount({ language: 'en', source: 'none' });
    await settled();
    await flush();

    expect(seen[0].language).toBe('en');
    expect(last().language).toBe('es');
    expect(patches).toEqual([{ language: 'es' }]);
  });
});

describe('the client preferences GET fails (AC-1.5b, split by source)', () => {
  it('P-4: unknown → the localStorage pick applies, and nothing is backfilled', async () => {
    localStorage.setItem('business-os-language', 'es');
    mockNetwork({ status: 500 });

    mount({ language: 'en', source: 'unknown' });
    await settled();
    await flush();

    expect(last().language).toBe('es');
    expect(patches).toEqual([]);
  });

  it('P-4b (R-5): saved he → stays he, no PATCH, localStorage untouched, currency from localStorage (EUR)', async () => {
    localStorage.setItem('business-os-language', 'es');
    mockNetwork({ status: 500 });

    mount(SAVED_HE);
    await settled();
    await flush();

    expect(new Set(seen.map((s) => s.language))).toEqual(new Set(['he']));
    expect(patches).toEqual([]);
    expect(localStorage.getItem('business-os-language')).toBe('es');
    expect(last().currencyCode).toBe('EUR');
  });
});

describe('no initial prop: identical to before BR-1a', () => {
  it('P-5: starts in English, then the localStorage pick', async () => {
    localStorage.setItem('business-os-language', 'he');
    mockNetwork({ status: 500 });

    mount();
    await settled();
    await flush();

    expect(seen[0].language).toBe('en');
    expect(last().language).toBe('he');
  });
});

describe('the dir/lang wrapper', () => {
  it('P-6: follows a switch, and so does <html>', async () => {
    mockNetwork({ preferredLanguage: 'he' });
    const { container } = mount(SAVED_HE);
    await settled();
    await flush();

    const frame = container.querySelector('[data-owner-locale]') as HTMLElement;
    expect(frame.getAttribute('dir')).toBe('rtl');

    act(() => api!.setLanguage('en'));
    await flush();

    expect(frame.getAttribute('dir')).toBe('ltr');
    expect(frame.getAttribute('lang')).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('P-7 (RC-1): correct on the FIRST commit of a client mount, before any passive effect', async () => {
    localStorage.setItem('business-os-language', 'en');
    mockNetwork({ preferredLanguage: 'he' }, { hold: true });

    let atFirstCommit: { dir: string | null; lang: string | null; text: string | null; htmlDir: string; fetched: number } | null = null;

    function FirstCommitProbe() {
      useLayoutEffect(() => {
        if (atFirstCommit) return;
        const frame = document.querySelector('[data-owner-locale]');
        atFirstCommit = {
          dir: frame?.getAttribute('dir') ?? null,
          lang: frame?.getAttribute('lang') ?? null,
          text: document.querySelector('[data-testid="label"]')?.textContent ?? null,
          // Still the document's value: the provider's passive dir effect has not run.
          htmlDir: document.documentElement.dir,
          fetched: (global.fetch as jest.Mock).mock.calls.length,
        };
      }, []);
      return null;
    }

    render(
      <LanguageProvider initial={SAVED_HE}>
        <Probe />
        <FirstCommitProbe />
      </LanguageProvider>
    );

    expect(atFirstCommit).toEqual({ dir: 'rtl', lang: 'he', text: HE_LABEL, htmlDir: 'ltr', fetched: 0 });
    expect(HE_LABEL).not.toBe(EN_LABEL);
    await releaseAndSettle();
  });
});

describe('StrictMode (R-2)', () => {
  it('P-9: double effects still never show en, and the currency is still derived from localStorage', async () => {
    localStorage.setItem('business-os-language', 'es');
    mockNetwork({ preferredLanguage: 'he' });

    mount(SAVED_HE, { strict: true });
    await settled();
    await flush();

    expect(new Set(seen.map((s) => s.language))).toEqual(new Set(['he']));
    expect(last().currencyCode).toBe('EUR');
  });
});

describe('defensive only: server render + hydration (P-8)', () => {
  // Production never hydrates this provider today: V2ThemeProvider renders
  // nothing on the server. This guards the day it starts to.
  it('hydrates with no mismatch warning', async () => {
    // jsdom has no TextEncoder, which the browser build of react-dom/server needs.
    const { TextEncoder } = await import('util');
    Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
    const { renderToString } = await import('react-dom/server');
    const { hydrateRoot } = await import('react-dom/client');
    mockNetwork({ preferredLanguage: 'he' }, { hold: true });

    const tree = (
      <LanguageProvider initial={SAVED_HE}>
        <Probe />
      </LanguageProvider>
    );
    const markup = renderToString(tree);
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain(HE_LABEL);

    const container = document.createElement('div');
    container.innerHTML = markup;
    document.body.appendChild(container);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await act(async () => { hydrateRoot(container, tree); });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      await releaseAndSettle();
      container.remove();
    }
  });
});

// ── Currency and timezone: unchanged (FR-1.7, AC-1.10, SA-6) ───────────────

/*
 * Every case runs twice: with the server language and without it. Without it is
 * the pre-BR-1a code path, so equal answers mean the server language cannot have
 * moved the currency.
 */
const WITH_AND_WITHOUT: Array<[string, InitialLanguage | undefined]> = [
  ['with initial he/saved', SAVED_HE],
  ['without initial (pre-BR-1a path)', undefined],
];

describe.each(WITH_AND_WITHOUT)('currency, %s', (_label, initial) => {
  async function settle(storage: { lang?: string; pin?: string }, businessCurrency: string | null) {
    if (storage.lang) localStorage.setItem('business-os-language', storage.lang);
    if (storage.pin) localStorage.setItem('business-os-currency', storage.pin);
    mockNetwork({ preferredLanguage: 'he', businessCurrency });
    mount(initial);
    await settled();
    await flush();
    return last();
  }

  it('C-1: device pin GBP + business USD → display GBP, business USD', async () => {
    const s = await settle({ lang: 'he', pin: 'GBP' }, 'USD');
    expect([s.currencyCode, s.businessCurrency]).toEqual(['GBP', 'USD']);
  });

  it('C-2: device pin GBP + no business currency → GBP, undefined', async () => {
    const s = await settle({ lang: 'he', pin: 'GBP' }, null);
    expect([s.currencyCode, s.businessCurrency]).toEqual(['GBP', undefined]);
  });

  it('C-3: no pin + business USD → USD, USD', async () => {
    const s = await settle({ lang: 'he' }, 'USD');
    expect([s.currencyCode, s.businessCurrency]).toEqual(['USD', 'USD']);
  });

  it('C-4: no pin + no business currency → the localStorage language default (he → ILS)', async () => {
    const s = await settle({ lang: 'he' }, null);
    expect([s.currencyCode, s.businessCurrency]).toEqual(['ILS', undefined]);
  });

  it('C-5: saved he, localStorage es, nothing else → EUR', async () => {
    const s = await settle({ lang: 'es' }, null);
    expect(s.currencyCode).toBe('EUR');
  });

  it('C-6: saved he, no localStorage, nothing else → USD', async () => {
    const s = await settle({}, null);
    expect(s.currencyCode).toBe('USD');
  });

  it('businessCurrency is undefined on the first render', async () => {
    await settle({ lang: 'he' }, 'USD');
    expect(seen[0].businessCurrency).toBeUndefined();
  });
});

describe('timezone (T-1)', () => {
  it('stays UTC until the preferences row arrives, then takes its zone', async () => {
    mockNetwork({ preferredLanguage: 'he', timezone: 'Asia/Jerusalem' }, { hold: true });
    mount(SAVED_HE);
    await flush();

    expect(seen.every((s) => s.timezone === 'UTC')).toBe(true);

    await act(async () => { releaseGet(); });
    await flush();
    expect(last().timezone).toBe('Asia/Jerusalem');
  });
});
