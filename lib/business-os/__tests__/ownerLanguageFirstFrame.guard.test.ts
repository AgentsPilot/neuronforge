/**
 * Source guard for the owner's first-frame language (performance business round
 * BR-1a; workplan §8.4 G-1..G-6).
 *
 * The behaviour lives in three layouts and one provider, and each property
 * below is a one-line edit away from silently reverting: a layout that stops
 * passing the language, a script moved inside a provider that renders nothing
 * on the server, a nested provider coming back, an importer that is not
 * `force-dynamic`, a cookie, or a currency default keyed on the wrong language.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '');

const LAYOUTS = [
  'app/business-os/layout.tsx',
  'app/onboarding-build/layout.tsx',
  'app/onboarding-chat/layout.tsx',
] as const;

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

describe('G-1: every provider layout supplies the first-frame language', () => {
  it.each(LAYOUTS)('%s reads it, renders the script and passes it to the provider', (file) => {
    const text = code(read(file));
    expect(text).toContain("import { readInitialLanguage } from '@/lib/business-os/readInitialLanguage';");
    expect(text).toContain("import { OwnerDirScript } from '@/components/business-os/OwnerDirScript';");
    expect(text).toMatch(/<OwnerDirScript language=\{initialLanguage\.language\} \/>/);
    expect(text).toMatch(/<LanguageProvider initial=\{initialLanguage\}>/);
  });

  // SA RC-2: written when V2ThemeProvider rendered null on the server, which
  // would have kept the script out of the HTML. Since TH-1 it renders its
  // children, but the script must still run before any content is parsed.
  it.each(LAYOUTS)('%s renders the script before every client provider', (file) => {
    const text = code(read(file));
    const body = text.slice(text.indexOf('return ('));
    const script = body.indexOf('<OwnerDirScript');
    expect(script).toBeGreaterThan(-1);
    for (const provider of ['<V2ThemeProvider', '<UserProvider', '<LanguageProvider']) {
      const at = body.indexOf(provider);
      if (at > -1) expect(script).toBeLessThan(at);
    }
  });
});

describe('G-2: the language read is started before the payment hold, used only after it (SA ruling on RC-6b)', () => {
  const GATE = 'await redirectIfAwaitingPayment();';
  const START = 'const initialLanguagePending = readInitialLanguage();';

  /** Positions every guarantee below is measured from. */
  function positions(file: string) {
    const text = code(read(file));
    const gate = text.indexOf(GATE);
    const start = text.indexOf(START);
    // The first use of the pending value after its own declaration.
    const firstUse = text.indexOf('initialLanguagePending', start + START.length);
    return { text, gate, start, firstUse };
  }

  it.each(LAYOUTS)('%s: (i) the read is started before the gate', (file) => {
    const { gate, start } = positions(file);
    expect(start).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(start);
  });

  it.each(LAYOUTS)('%s: (iv) readInitialLanguage() is called exactly once', (file) => {
    expect(positions(file).text.match(/readInitialLanguage\(\)/g)).toHaveLength(1);
  });

  it.each(LAYOUTS)('%s: (v) nothing reads or awaits the pending value before the gate decides', (file) => {
    const { gate, firstUse } = positions(file);
    expect(firstUse).toBeGreaterThan(gate);
  });

  it('/business-os: (ii) the Promise.all over the plan pill and the pending language comes after the gate', () => {
    const { text, gate } = positions('app/business-os/layout.tsx');
    const all = text.search(/await Promise\.all\(\[readPlanBadge\(\), initialLanguagePending\]\)/);
    expect(all).toBeGreaterThan(gate);
  });

  it('/business-os: (iii) readPlanBadge() appears once, after the gate', () => {
    const { text, gate } = positions('app/business-os/layout.tsx');
    expect(text.match(/readPlanBadge\(\)/g)).toHaveLength(1);
    expect(text.indexOf('readPlanBadge()')).toBeGreaterThan(gate);
  });

  it.each(LAYOUTS.slice(1))('%s: (ii) the pending language is awaited after the gate', (file) => {
    const { text, gate } = positions(file);
    expect(text.indexOf('await initialLanguagePending')).toBeGreaterThan(gate);
  });
});

describe('G-3: the provider is mounted only by those three layouts', () => {
  it('no other production file mounts <LanguageProvider', () => {
    const mounts = PRODUCTION.filter((f) => /<LanguageProvider[\s>]/.test(code(read(f))));
    expect(mounts.sort()).toEqual([...LAYOUTS].sort());
  });

  it('the CRM layout keeps its stylesheet and no longer reaches the language context (SA C-1)', () => {
    const text = code(read('app/business-os/crm/layout.tsx'));
    expect(text).not.toMatch(/LanguageContext|LanguageProvider/);
    expect(text).toContain("import '../../v2/globals-v2.css';");
  });
});

describe('G-4: only force-dynamic segments read the language (SA P-1)', () => {
  it('every importer of readInitialLanguage under app/ is force-dynamic', () => {
    const importers = PRODUCTION.filter((f) => f.startsWith('app/') && /from '@\/lib\/business-os\/readInitialLanguage'/.test(read(f)));
    expect(importers.sort()).toEqual([...LAYOUTS].sort());
    for (const file of importers) {
      expect(code(read(file))).toContain("export const dynamic = 'force-dynamic';");
    }
  });

  it('nothing outside app/ imports it except its own tests', () => {
    const others = PRODUCTION.filter((f) => !f.startsWith('app/') && /business-os\/readInitialLanguage'/.test(read(f)));
    expect(others).toEqual([]);
  });
});

describe('G-5: no cookie (SA-1)', () => {
  it.each([
    'lib/business-os/readInitialLanguage.ts',
    'components/business-os/OwnerDirScript.tsx',
    'lib/business-os/LanguageContext.tsx',
    'lib/business-os/ownerLanguage.ts',
  ])('%s neither reads nor writes one', (file) => {
    const text = code(read(file));
    expect(text).not.toMatch(/document\.cookie|cookies\(/);
  });

  it('the client provider imports nothing server-only', () => {
    const text = code(read('lib/business-os/LanguageContext.tsx'));
    expect(text).not.toMatch(/readInitialLanguage|userLanguage|server-only/);
  });
});

describe('G-6: the display-currency default is keyed on this browser\'s language (SA-6)', () => {
  it('DEFAULT_CURRENCY_BY_LANGUAGE is indexed by savedLang at mount, never by the server value', () => {
    const text = code(read('lib/business-os/LanguageContext.tsx'));
    expect(text).toContain('setCurrencyCode(DEFAULT_CURRENCY_BY_LANGUAGE[savedLang as Language]);');
    expect(text).not.toMatch(/DEFAULT_CURRENCY_BY_LANGUAGE\[\s*initial/);
  });

  /*
   * R-2: localStorage is never rewritten at mount, from the server value OR
   * from the state it seeded (`language`). The only writes of this key are the
   * GET's confirmation (`locale.preferredLanguage`) and `setLanguage` (`lang`).
   * Broadened after QA Edge Case 1: a mount write of `language` used to pass.
   */
  it('localStorage is written only from the confirmed GET value or a switch (R-2)', () => {
    const text = code(read('lib/business-os/LanguageContext.tsx'));
    const writes = text.match(/localStorage\.setItem\('business-os-language',\s*[^)]*\)/g) ?? [];
    expect(writes.map((w) => w.replace(/\s+/g, ' '))).toEqual([
      "localStorage.setItem('business-os-language', locale.preferredLanguage)",
      "localStorage.setItem('business-os-language', lang)",
    ]);
  });
});
