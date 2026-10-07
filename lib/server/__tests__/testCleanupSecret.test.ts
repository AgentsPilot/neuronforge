/**
 * lib/server/testCleanupSecret.ts: the ONE reader of the second secret that
 * unlocks the test-account cleanup function (R-5). The variable name is
 * assembled at run time, so this file does not itself name it.
 *
 * Also R-7: under app/ lib/ components/ hooks/, the function's name appears
 * only in the repository.
 */

import fs from 'fs';
import path from 'path';
import { isTestCleanupConfigured, readTestCleanupSecret } from '@/lib/server/testCleanupSecret';

const ENV_NAME = ['TEST', 'CLEANUP', 'SECRET'].join('_');
const FUNCTION_NAME = ['operator', 'test', 'account', 'cleanup'].join('_');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_ROOTS = ['app', 'lib', 'components', 'hooks'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

const files = SCAN_ROOTS.flatMap((root) => walk(path.join(REPO_ROOT, root)));
const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');
const naming = (needle: string) => files.filter((file) => fs.readFileSync(file, 'utf8').includes(needle)).map(rel);

const saved = process.env[ENV_NAME];
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = saved;
});

describe('single readers', () => {
  it('scanned a plausible number of files', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('the secret is named only by lib/server/testCleanupSecret.ts, which is server-only', () => {
    expect(naming(ENV_NAME)).toEqual(['lib/server/testCleanupSecret.ts']);
    const source = fs.readFileSync(path.join(REPO_ROOT, 'lib/server/testCleanupSecret.ts'), 'utf8');
    expect(source).toMatch(/^import 'server-only';$/m);
    expect(naming(`NEXT_PUBLIC_${ENV_NAME}`)).toEqual([]);
  });

  it('the cleanup function is named only by the repository (R-7)', () => {
    expect(naming(FUNCTION_NAME)).toEqual(['lib/repositories/TestAccountCleanupRepository.ts']);
  });
});

describe('readTestCleanupSecret', () => {
  it('is null, and not configured, when unset or blank', () => {
    delete process.env[ENV_NAME];
    expect(readTestCleanupSecret()).toBeNull();
    process.env[ENV_NAME] = '   ';
    expect(isTestCleanupConfigured()).toBe(false);
  });

  it('returns the trimmed value when set', () => {
    process.env[ENV_NAME] = '  abc  ';
    expect(readTestCleanupSecret()).toBe('abc');
    expect(isTestCleanupConfigured()).toBe(true);
  });
});
