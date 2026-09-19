/**
 * Regression guard: the "System Ready" toast and the `/api/system/*` startup
 * initializer stay removed (Slice 1 of
 * docs/requirements/SYSTEM_READY_TOAST_AND_STARTUP_INITIALIZER_REMOVAL_REQUIREMENT.md;
 * covers AC-2, AC-3, AC-13, AC-14).
 *
 * The repo has no E2E setup, so this is the durable automated evidence that no
 * page mounts the initializer and that the unauthenticated routes stay gone:
 *   - `/api/system/initialize` ran a cross-tenant service-role write for anyone.
 *   - `/api/system/status` let anyone read platform-wide agent metadata (F4).
 *
 * Assertion (a) requires BOTH the component and the `/initialize` route to be
 * absent, so restoring either one alone fails. Restoring only the component
 * would put an error toast on every page (its POST would 404); restoring only
 * the route would reopen the anonymous write path.
 *
 * Modelled on lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts.
 * Unlike that guard it does NOT strip comments: a doc comment that still names
 * a removed route is stale and should be fixed too.
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');

/** Scoped to shipped code so the requirement and workplan docs don't trip it. */
const SCAN_ROOTS = ['app', 'components', 'lib', 'hooks'];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

/** This file must name the removed paths to check for them, so it skips itself. */
const SELF = 'lib/__tests__/system-initializer-removed.guard.test.ts';

const REMOVED_FILES = [
  'components/SafeSystemInitializer.tsx',
  'components/SystemInitializer.tsx',
  'app/api/system/initialize/route.ts',
  'app/api/system/status/route.ts',
  'lib/startup/initialize.ts',
  'lib/cleanup/executionCleanup.ts',
];

const FORBIDDEN_LITERALS = ['/api/system/initialize', '/api/system/status'];

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

describe('guard: system initializer and /api/system/{initialize,status} stay removed', () => {
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

  it('no source file references the removed routes', () => {
    const offenders: string[] = [];
    for (const s of SCANNED) {
      for (const literal of FORBIDDEN_LITERALS) {
        if (s.source.includes(literal)) offenders.push(`${s.file}: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('can actually fail: the literal check detects a synthetic hit', () => {
    const fixture = "await fetch('/api/system/initialize', { method: 'POST' })";
    expect(FORBIDDEN_LITERALS.some((l) => fixture.includes(l))).toBe(true);
  });
});
