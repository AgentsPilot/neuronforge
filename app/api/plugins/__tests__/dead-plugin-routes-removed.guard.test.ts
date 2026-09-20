/**
 * Regression guard: the two dead plugin endpoints stay removed.
 *
 * Both were deleted during the auth_config exposure fix
 * (docs/workplans/plugin-auth-config-exposure-workplan.md) rather than hardened,
 * because neither had a live caller:
 *
 *   - `/api/user/plugins` — returned `_meta.connectedPluginData`, i.e. raw
 *     PluginDefinitionContext instances. Those alias the env-substituted definition, so
 *     JSON.stringify emitted the platform's real `client_secret` for every plugin the
 *     caller had connected. Self-declared deprecated in favour of
 *     `/api/plugins/user-status`.
 *   - `/api/plugins/suggest` — unauthenticated, unvalidated, no try/catch, and it called
 *     GPT-4o on arbitrary anonymous input (an open LLM-spend proxy).
 *
 * Their only caller was `components/wizard/Step3Plugins.tsx`, which had zero importers
 * (the wizard chain hangs off the disabled `app/(protected)/agents/new/page.tsxold`), so
 * it was deleted with them.
 *
 * Restoring any of the three must fail here: the secret egress and the anonymous LLM
 * spend both come back with the file. Modelled on
 * lib/__tests__/system-initializer-removed.guard.test.ts.
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

/** Scoped to shipped code so requirement/workplan docs don't trip it. */
const SCAN_ROOTS = ['app', 'components', 'lib', 'hooks'];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

/** This file must name the removed paths to check for them, so it skips itself. */
const SELF = 'app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts';

const REMOVED_FILES = [
  'app/api/user/plugins/route.ts',
  'app/api/plugins/suggest/route.ts',
  'components/wizard/Step3Plugins.tsx',
];

const FORBIDDEN_LITERALS = ['/api/user/plugins', '/api/plugins/suggest', 'Step3Plugins'];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name)) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(REPO_ROOT, f).split(path.sep).join('/');

const SCANNED = SCAN_ROOTS.flatMap((r) => walk(path.join(REPO_ROOT, r)))
  .filter((f) => rel(f) !== SELF)
  .map((f) => ({ file: rel(f), source: fs.readFileSync(f, 'utf-8') }));

describe('guard: dead plugin routes stay removed', () => {
  it('scanned a plausible number of files', () => {
    // Fail closed: "0 files scanned, 0 hits" would be a green build proving nothing.
    expect(SCANNED.length).toBeGreaterThan(500);
    for (const root of SCAN_ROOTS) {
      expect(SCANNED.some((s) => s.file.startsWith(`${root}/`))).toBe(true);
    }
  });

  it('none of the removed files exists', () => {
    const present = REMOVED_FILES.filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));
    expect(present).toEqual([]);
  });

  it('the parent route directories are gone too', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'app/api/user/plugins'))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, 'app/api/plugins/suggest'))).toBe(false);
  });

  it('no source file references the removed routes or component', () => {
    const offenders: string[] = [];
    for (const s of SCANNED) {
      for (const literal of FORBIDDEN_LITERALS) {
        if (s.source.includes(literal)) offenders.push(`${s.file}: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the supported replacement still exists', () => {
    // /api/user/plugins was deprecated in favour of this one; deleting it must not have
    // left callers with nothing.
    expect(fs.existsSync(path.join(REPO_ROOT, 'app/api/plugins/user-status/route.ts'))).toBe(true);
  });

  it('can actually fail: the literal check detects a synthetic hit', () => {
    const fixture = "const res = await fetch('/api/user/plugins')";
    expect(FORBIDDEN_LITERALS.some((l) => fixture.includes(l))).toBe(true);
  });
});
