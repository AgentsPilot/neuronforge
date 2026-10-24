/**
 * Guard: SheetJS (`xlsx`) stays on a patched CDN build.
 *
 * Why this exists: the npm registry's last `xlsx` is 0.18.5, which is
 * vulnerable when reading files (CVE-2023-30533 prototype pollution,
 * CVE-2024-22363 ReDoS). SheetJS now publishes only from https://cdn.sheetjs.com,
 * so we install its tarball by exact URL, with the integrity hash in the lock.
 * That is an SA-approved exception (rule 7) for `xlsx` only — not a pattern for
 * other dependencies.
 *
 * `npm audit` cannot see a tarball dependency, so nothing else would notice if
 * a plain `npm i xlsx` put the vulnerable registry build back. This test does.
 *
 * To upgrade: pick the version on https://cdn.sheetjs.com, then
 *   npm install --save-exact "xlsx@https://cdn.sheetjs.com/xlsx-<v>/xlsx-<v>.tgz"
 * check the lock diff touches only the xlsx entry, and check the lock's new
 * `integrity` against an independent download:
 *   curl -s <url> | openssl dgst -sha512 -binary | openssl base64 -A
 * See docs/workplans/sheetjs-cve-remediation-workplan.md.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface LockPackage {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
}

const root = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, LockPackage>;
};

const CDN_PREFIX = 'https://cdn.sheetjs.com/xlsx-';
const MIN_PATCHED: [number, number, number] = [0, 20, 2];

const atLeast = (version: string, min: [number, number, number]): boolean => {
  const parts = version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== min[i]) return parts[i] > min[i];
  }
  return true;
};

describe('SheetJS pin', () => {
  const spec = pkg.dependencies?.xlsx;
  const entry = lock.packages['node_modules/xlsx'];

  it('package.json installs xlsx from the SheetJS CDN by exact URL', () => {
    expect(spec).toBeDefined();
    expect(spec!.startsWith(CDN_PREFIX)).toBe(true);
    expect(spec!.endsWith('.tgz')).toBe(true);
  });

  it('the lock resolves the same URL, with a sha512 integrity', () => {
    expect(entry).toBeDefined();
    expect(entry.resolved).toBe(spec);
    expect(entry.integrity?.startsWith('sha512-')).toBe(true);
  });

  it('the locked version carries both CVE fixes (>= 0.20.2)', () => {
    expect(entry.version).toBeDefined();
    expect(atLeast(entry.version!, MIN_PATCHED)).toBe(true);
  });

  it('no other copy of xlsx is nested in the tree', () => {
    const nested = Object.keys(lock.packages).filter(
      p => p !== 'node_modules/xlsx' && p.endsWith('/node_modules/xlsx')
    );
    expect(nested).toEqual([]);
  });

  // Any source counts: https, git+ssh:, file:. Local workspace links do not.
  it('xlsx is the only dependency resolved outside the npm registry', () => {
    const offRegistry = Object.entries(lock.packages)
      .filter(([, p]) => p.resolved && !p.link && !p.resolved.startsWith('https://registry.npmjs.org/'))
      .map(([path]) => path);
    expect(offRegistry).toEqual(['node_modules/xlsx']);
  });
});
