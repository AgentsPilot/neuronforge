/**
 * @jest-environment node
 *
 * The upgrade modal demo page stays a switched-off test surface (TEST ONLY,
 * upgrade modal UM-2, workplan §7, SA X-1 / X-2). Pinned:
 *   1. the switch defaults to OFF (unset, blank, unrecognised);
 *   2. the page is a server component whose FIRST statement asks the switch and
 *      returns `notFound()` before anything renders; `force-dynamic`;
 *   3. no `NEXT_PUBLIC_` variant of the switch exists anywhere in the source or
 *      `.env.example`, and the client child never reads the switch.
 * Each pin has a planted-violation control below.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

import { isUpgradeModalDemoEnabled } from '@/lib/business-os/upgradeModalDemoFlag';

const ROOT = process.cwd();
const PAGE = 'app/business-os/upgrade-modal-demo/page.tsx';
const CLIENT = 'app/business-os/upgrade-modal-demo/UpgradeModalDemo.tsx';
const FLAG = 'lib/business-os/upgradeModalDemoFlag.ts';
const SWITCH = 'BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED';

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function pinPage(page: string) {
  expect(page).not.toMatch(/^\s*['"]use client['"]/m);
  expect(page).toMatch(/export const dynamic = 'force-dynamic';/);
  const body = page.slice(page.indexOf('export default function'));
  const firstStatement = body.slice(body.indexOf('{') + 1).trim().split('\n')[0];
  expect(firstStatement).toBe('if (!isUpgradeModalDemoEnabled()) notFound();');
  // Nothing rendered before the check.
  expect(body.indexOf('notFound()')).toBeLessThan(body.indexOf('return'));
}

function pinNoPublic(sources: Record<string, string>) {
  const offenders = Object.entries(sources)
    .filter(([, text]) => text.includes(`NEXT_PUBLIC_${SWITCH}`) || /NEXT_PUBLIC_[A-Z_]*UPGRADE_MODAL_DEMO/.test(text))
    .map(([file]) => file);
  expect(offenders).toEqual([]);
}

function pinClient(client: string) {
  expect(client).not.toMatch(/process\.env|upgradeModalDemoFlag|isUpgradeModalDemoEnabled/);
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, '/'));
    }
  };
  for (const dir of ['app', 'components', 'lib', 'hooks']) walk(join(ROOT, dir));
  return out;
}

describe('the demo switch (X-1 / X-2)', () => {
  const saved = process.env[SWITCH];
  afterEach(() => {
    if (saved === undefined) delete process.env[SWITCH];
    else process.env[SWITCH] = saved;
  });

  it.each([undefined, '', 'yes please', 'off', 'false'])('defaults to OFF for %p', (value) => {
    if (value === undefined) delete process.env[SWITCH];
    else process.env[SWITCH] = value;
    expect(isUpgradeModalDemoEnabled()).toBe(false);
  });

  it('is on only when set (the control for the default)', () => {
    process.env[SWITCH] = 'true';
    expect(isUpgradeModalDemoEnabled()).toBe(true);
  });

  it('reads the server-only variable, no NEXT_PUBLIC_ prefix', () => {
    const flag = code(read(FLAG));
    expect(flag).toContain(`process.env.${SWITCH}`);
    expect(flag).toContain('parseBooleanFlag(process.env.BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED, false)');
  });

  it('the page asks the switch first and answers notFound() before rendering; force-dynamic', () => pinPage(code(read(PAGE))));

  it('no NEXT_PUBLIC_ variant of the switch exists (source and .env.example)', () => {
    pinNoPublic({ ...Object.fromEntries(sourceFiles().map((file) => [file, read(file)])), '.env.example': read('.env.example') });
  });

  it('the client child never reads the switch', () => pinClient(code(read(CLIENT))));
});

describe('negative controls', () => {
  const page = code(read(PAGE));

  it('a render before the check, or no check', () => {
    expect(() => pinPage(page.replace('if (!isUpgradeModalDemoEnabled()) notFound();', 'const x = <UpgradeModalDemo />;\n  if (!isUpgradeModalDemoEnabled()) notFound();'))).toThrow();
    expect(() => pinPage(page.replace('if (!isUpgradeModalDemoEnabled()) notFound();', ''))).toThrow();
    expect(() => pinPage(page.replace("export const dynamic = 'force-dynamic';", ''))).toThrow();
    expect(() => pinPage(`'use client';\n${page}`)).toThrow();
  });
  it('a NEXT_PUBLIC_ variant', () => {
    expect(() => pinNoPublic({ 'x.ts': `process.env.NEXT_PUBLIC_${SWITCH}` })).toThrow();
  });
  it('the switch read on the client', () => {
    expect(() => pinClient("const on = process.env.BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED;")).toThrow();
  });
});
