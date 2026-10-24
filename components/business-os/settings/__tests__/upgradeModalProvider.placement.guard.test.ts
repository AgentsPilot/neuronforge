/**
 * @jest-environment node
 *
 * Where the upgrade modal provider lives (upgrade modal UM-2, workplan §4.4,
 * C-4): exactly one production `<UpgradeModalProvider`, in the Business OS
 * layout, inside `LanguageProvider` (the window is translated) and
 * `CapabilitiesProvider`, and outside the chrome block (header + tabs, `relative z-50`; a modal
 * inside it would be trapped in its stacking context). Each pin has a
 * planted-violation control below.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const LAYOUT = 'app/business-os/layout.tsx';
const SCAN_DIRS = ['app', 'components', 'lib', 'hooks'];

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

function productFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, '/'));
    }
  };
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir));
  return out;
}

function pinOne(sources: Record<string, string>) {
  const mounts = Object.entries(sources).flatMap(([file, text]) => (text.match(/<UpgradeModalProvider\b/g) ?? []).map(() => file));
  expect(mounts).toEqual([LAYOUT]);
}

function pinOrder(layout: string) {
  const at = (needle: string) => {
    const index = layout.indexOf(needle);
    expect({ needle, found: index > -1 }).toEqual({ needle, found: true });
    return index;
  };
  const provider = at('<UpgradeModalProvider>');
  expect(provider).toBeGreaterThan(at('<LanguageProvider'));
  expect(provider).toBeGreaterThan(at('<CapabilitiesProvider>'));
  // The chrome block (header + tabs). It was `sticky top-0` until main moved the
  // scroll into the body (BUSINESS_OS_SCROLL_ID); the stacking rule is unchanged.
  expect(provider).toBeLessThan(at('relative z-50 shrink-0'));
  // Closed after the chrome and the page, before the providers around it close.
  const close = at('</UpgradeModalProvider>');
  expect(close).toBeGreaterThan(at('{children}'));
  expect(close).toBeLessThan(at('</CapabilitiesProvider>'));
}

describe('upgrade modal provider placement (UM-2 §4.4)', () => {
  const files = productFiles();

  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain(LAYOUT);
  });

  it('exactly one production <UpgradeModalProvider, in the Business OS layout', () => {
    // The provider's own module names itself in its error message; it defines the provider, it does not mount it.
    const mounting = files.filter((file) => file !== 'components/business-os/settings/UpgradeModalProvider.tsx');
    pinOne(Object.fromEntries(mounting.map((file) => [file, code(read(file))])));
  });

  it('inside LanguageProvider and CapabilitiesProvider, outside the sticky chrome', () => pinOrder(code(read(LAYOUT))));
});

describe('negative controls', () => {
  const layout = code(read(LAYOUT));

  it('a second mount elsewhere', () => {
    expect(() => pinOne({ [LAYOUT]: layout, 'app/business-os/settings/page.tsx': '<UpgradeModalProvider>{x}</UpgradeModalProvider>' })).toThrow();
  });
  it('the provider inside the sticky chrome', () => {
    const moved = layout
      .replace('<UpgradeModalProvider>', '')
      .replace('</UpgradeModalProvider>', '')
      .replace('<BusinessOSHeader', '<UpgradeModalProvider><BusinessOSHeader')
      .replace('<BusinessOSTabs />', '<BusinessOSTabs /></UpgradeModalProvider>');
    expect(() => pinOrder(moved)).toThrow();
  });
  it('the provider above LanguageProvider', () => {
    const moved = layout.replace('<UpgradeModalProvider>', '').replace('<UserProvider>', '<UpgradeModalProvider><UserProvider>');
    expect(() => pinOrder(moved)).toThrow();
  });
});
