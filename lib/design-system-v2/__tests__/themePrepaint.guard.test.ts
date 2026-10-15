/**
 * T-G: source guard for the theme's first frame (performance slice TH-1, with
 * TH-2 folded in; workplan §10.7 G-1..G-12).
 *
 * Each property below is a one-line edit away from silently reverting: a
 * layout that stops inlining the tokens, a script moved inside a provider, the
 * sheet or the tokens leaking onto a public page, the token read moved after
 * the payment hold, a layout that stops being force-dynamic and bakes the
 * tokens in at build, or the browser database read coming back.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(relative(ROOT, join(ROOT, rel)).replace(/\\/g, '/'));
  }
  return out;
}

const PRODUCTION = ['app', 'components', 'lib', 'hooks'].flatMap((d) => walk(d));

const GATED_LAYOUTS = [
  'app/business-os/layout.tsx',
  'app/onboarding-build/layout.tsx',
  'app/onboarding-chat/layout.tsx',
] as const;
const MOUNTING_LAYOUTS = [...GATED_LAYOUTS, 'app/v2/layout.tsx'].sort();

const SHEET_IMPORT = "import '@/lib/design-system-v2/v2-theme-tokens.css'";

const filesWhere = (test: (text: string) => boolean) => PRODUCTION.filter((f) => test(code(read(f)))).sort();

describe('G-1 the provider, the sheet, the script, the style and the read always travel together', () => {
  it('the five sets are the same four layouts', () => {
    expect(filesWhere((t) => /<V2ThemeProvider[\s>]/.test(t))).toEqual(MOUNTING_LAYOUTS);
    expect(filesWhere((t) => t.includes(SHEET_IMPORT))).toEqual(MOUNTING_LAYOUTS);
    expect(filesWhere((t) => /<V2ThemeScript[\s/]/.test(t))).toEqual(MOUNTING_LAYOUTS);
    expect(filesWhere((t) => /<V2CustomTokensStyle[\s/]/.test(t))).toEqual(MOUNTING_LAYOUTS);
    expect(filesWhere((t) => /readV2CustomTokens\(\)/.test(t)).filter((f) => f.startsWith('app/'))).toEqual(MOUNTING_LAYOUTS);
  });

  it.each(MOUNTING_LAYOUTS)('%s passes the same tokens to the style and the provider', (file) => {
    const text = code(read(file));
    expect(text).toContain('<V2CustomTokensStyle tokens={customTokens} />');
    expect(text).toContain('<V2ThemeProvider customTokens={customTokens} customTokensKnown={customTokensKnown}>');
  });
});

describe('G-2 the script and the style come before every provider', () => {
  it.each(MOUNTING_LAYOUTS)('%s', (file) => {
    const text = code(read(file));
    const body = text.slice(text.indexOf('return ('));
    for (const first of ['<V2ThemeScript', '<V2CustomTokensStyle']) {
      const at = body.indexOf(first);
      expect(at).toBeGreaterThan(-1);
      for (const provider of ['<V2ThemeProvider', '<UserProvider', '<LanguageProvider']) {
        const p = body.indexOf(provider);
        if (p > -1) expect([first, at < p]).toEqual([first, true]);
      }
    }
  });
});

describe('G-3 never on the root layout or a public segment', () => {
  const PUBLIC_LAYOUTS = PRODUCTION.filter((f) =>
    /^app\/(book|c|invoice|go|proposal|invite|payments|site|privacy)\/.*layout\.tsx$/.test(f)
  );
  it.each(['app/layout.tsx', ...PUBLIC_LAYOUTS])('%s', (file) => {
    const text = code(read(file));
    for (const forbidden of ['V2ThemeScript', 'V2CustomTokensStyle', 'v2-theme-tokens.css', 'readV2CustomTokens']) {
      expect([forbidden, text.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });
});

describe('G-4 the provider renders its children, keeps the mounted guard, and runs layout effects (RC-1)', () => {
  const provider = code(read('lib/design-system-v2/theme-provider.tsx'));

  it('has no `return null` and keeps `if (!mounted) return` in the mode effect', () => {
    expect(provider).not.toMatch(/return null/);
    const modeEffect = provider.slice(provider.lastIndexOf('useIsomorphicLayoutEffect(() => {'));
    expect(modeEffect.slice(0, modeEffect.indexOf('}, [mode, mounted, customTokens])'))).toContain('if (!mounted) return');
  });

  it('defines the isomorphic alias at module scope and uses it for both effects', () => {
    expect(provider).toContain(
      "const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect"
    );
    expect(provider.match(/useIsomorphicLayoutEffect\(\(\) => \{/g)).toHaveLength(2);
    // The only plain effect is the RC-16 correction, which paints nothing.
    expect(provider.match(/\buseEffect\(/g)).toHaveLength(1);
    const plain = provider.slice(provider.indexOf('useEffect(() => {'));
    expect(plain.slice(0, plain.indexOf('}, [customTokensKnown])'))).toContain('if (customTokensKnown) return');
    expect(provider.match(/\buseLayoutEffect\(/g)).toBeNull();
  });

  it('the storage key literal lives only in themeMode.ts', () => {
    const holders = PRODUCTION.filter((f) => read(f).includes("'v2-theme-mode'") || read(f).includes('"v2-theme-mode"'));
    expect(holders).toEqual(['lib/design-system-v2/themeMode.ts']);
    for (const f of ['lib/design-system-v2/theme-provider.tsx', 'lib/design-system-v2/V2ThemeScript.tsx']) {
      expect(read(f)).toMatch(/import \{ V2_THEME_STORAGE_KEY \} from '\.\/themeMode'/);
    }
  });
});

describe('G-5 the provider does not log through the console', () => {
  it('no console.', () => {
    expect(code(read('lib/design-system-v2/theme-provider.tsx'))).not.toMatch(/console\./);
  });
});

describe('G-6 the CRM layout has no provider and no client directive', () => {
  it('keeps only the /v2 stylesheet', () => {
    const text = code(read('app/business-os/crm/layout.tsx'));
    expect(text).not.toMatch(/V2ThemeProvider/);
    expect(text).not.toMatch(/['"]use client['"]/);
    expect(text).toContain("import '../../v2/globals-v2.css';");
  });
});

describe('G-7 the token read is started before the payment hold and used only after it', () => {
  const GATE = 'await redirectIfAwaitingPayment();';
  const START = 'const customTokensPending = readV2CustomTokens();';
  it.each(GATED_LAYOUTS)('%s', (file) => {
    const text = code(read(file));
    const gate = text.indexOf(GATE);
    const start = text.indexOf(START);
    expect(start).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(start);
    expect(text.match(/readV2CustomTokens\(\)/g)).toHaveLength(1);
    const firstUse = text.indexOf('customTokensPending', start + START.length);
    expect(firstUse).toBeGreaterThan(gate);
  });
});

describe('G-8 no browser read of system_settings_config where the theme lives (RC-11, narrowed scope)', () => {
  /*
   * Scope: the design system and every segment that mounts the provider.
   * `lib/hooks/useUIVersion.ts` is a known browser reader and writer outside
   * this scope; it is in the TH-2b inventory and deliberately not edited here.
   */
  const SCOPE = /^(lib\/design-system-v2\/|app\/business-os\/|app\/onboarding-build\/|app\/onboarding-chat\/|app\/v2\/)/;
  it('no client module in scope names the table', () => {
    const offenders = PRODUCTION.filter((f) => SCOPE.test(f)).filter((f) => {
      const raw = read(f);
      return /^\s*['"]use client['"]/m.test(raw) && code(raw).includes('system_settings_config');
    });
    expect(offenders).toEqual([]);
  });

  it('the provider does not import the browser Supabase client', () => {
    expect(read('lib/design-system-v2/theme-provider.tsx')).not.toMatch(/supabaseClient/);
  });
});

const CORRECTION_ROUTE = 'app/api/design-system/v2-custom-tokens/route.ts';

describe('G-9 every caller of the token read is force-dynamic', () => {
  it('no static page or route can bake the tokens in at build', () => {
    const importers = PRODUCTION.filter((f) => f.startsWith('app/') && /readV2CustomTokens'/.test(read(f)));
    expect(importers.sort()).toEqual([...MOUNTING_LAYOUTS, CORRECTION_ROUTE].sort());
    for (const file of importers) {
      expect([file, /export const dynamic = 'force-dynamic';?/.test(code(read(file)))]).toEqual([file, true]);
    }
  });
});

describe('G-10 the barrel stays unchanged (RC-8)', () => {
  it('exports none of the new modules', () => {
    const barrel = code(read('lib/design-system-v2/index.ts'));
    for (const name of ['readV2CustomTokens', 'V2CustomTokensStyle', 'V2ThemeScript', 'sanitizeV2CustomTokens', 'customTokens', 'themeMode']) {
      expect([name, barrel.includes(name)]).toEqual([name, false]);
    }
  });
});

describe('G-11 the cache reset is for tests only', () => {
  it('no production file other than its own module mentions it', () => {
    const callers = PRODUCTION.filter((f) => read(f).includes('__resetV2CustomTokensCacheForTests'));
    expect(callers).toEqual(['lib/design-system-v2/server/readV2CustomTokens.ts']);
  });
});

describe('G-12 customTokens.ts is pure, and the provider takes only its type and the sanitizer (amended by RC-16)', () => {
  it('imports nothing', () => {
    expect(code(read('lib/design-system-v2/customTokens.ts'))).not.toMatch(/^\s*import\s/m);
  });

  it('the provider imports only the type and sanitizeV2CustomTokens as a value', () => {
    const provider = read('lib/design-system-v2/theme-provider.tsx');
    const imports = provider.split(/\r?\n/).filter((line) => line.includes("from './customTokens'"));
    expect(imports).toEqual(["import { sanitizeV2CustomTokens, type V2CustomTokens } from './customTokens'"]);
  });
});

describe('G-13 the browser correction (SA RC-16)', () => {
  it.each(MOUNTING_LAYOUTS)('%s passes customTokensKnown from the read', (file) => {
    const text = code(read(file));
    expect(text).toMatch(/const \{ tokens: customTokens, known: customTokensKnown \} = await (customTokensPending|readV2CustomTokens\(\))/);
    expect(text).toContain('customTokensKnown={customTokensKnown}');
  });

  it('the provider fetches only the correction path, from one place', () => {
    const provider = code(read('lib/design-system-v2/theme-provider.tsx'));
    expect(provider.match(/\bfetch\(/g)).toHaveLength(1);
    expect(provider).toContain('fetch(V2_CUSTOM_TOKENS_CORRECTION_PATH, { cache: \'no-store\'');
    expect(provider).toContain("export const V2_CUSTOM_TOKENS_CORRECTION_PATH = '/api/design-system/v2-custom-tokens'");
    expect(provider).toContain('customTokensKnown = true');
  });

  it('the correction route exists, is force-dynamic, and is the only route reading the tokens', () => {
    const route = code(read(CORRECTION_ROUTE));
    expect(route).toContain("export const dynamic = 'force-dynamic';");
    expect(route).toContain('readV2CustomTokensWithStatus({ waitMs: V2_CUSTOM_TOKENS_ROUTE_WAIT_MS })');
    expect(route).toContain('sanitizeV2CustomTokens(tokens)');
    const readers = PRODUCTION.filter((f) => f.startsWith('app/api/') && /readV2CustomTokens/.test(read(f)));
    expect(readers).toEqual([CORRECTION_ROUTE]);
  });
});
