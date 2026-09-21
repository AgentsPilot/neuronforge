/**
 * Regression guard: dead / deleted API endpoints stay removed.
 *
 * ── The original two (auth_config exposure fix, PR #73) ────────────────────
 * Both were deleted rather than hardened
 * (docs/workplans/plugin-auth-config-exposure-workplan.md), because neither had a live
 * caller:
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
 * ── Added by the identity sweep, Slice 0 (2026-09-21) ──────────────────────
 * Three more, deleted for the same reason: an anonymously-reachable hole with no in-repo
 * caller, where deleting is strictly safer than gating because a deleted route cannot
 * regress. See docs/workplans/IDENTITY_SWEEP_WORKPLAN.md § Slice 0.
 *
 *   - `/api/v6/fetch-plugin-data` — read `userId` from the request body and passed it
 *     straight to `PluginExecuterV2.execute()`. No `getUser()`, no Zod, and middleware
 *     does not authenticate `/api/*` (middleware.ts:83), so an anonymous POST executed
 *     any plugin action against any named account **using that account's stored OAuth
 *     tokens** — reading their mail, writing their Drive, sending as them.
 *   - `/api/oauth/token` — rode the deprecated V1 plugin-strategy layer, built a
 *     service-role client inline, and parsed an identity out of an **unsigned** `state`
 *     parameter. Zero callers: every live V1 strategy redirects to
 *     `/oauth/callback/<plugin>` (gmailPluginStrategy.ts:39,174 and siblings), never
 *     here. NOTE: the unsigned-`state` class is NOT closed by this deletion — the
 *     sibling callback routes still parse it. That is tracked as R4 in
 *     docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md §3.
 *   - `/api/check-user-status` — anonymous POST `{ email }` → service-role
 *     `auth.admin.listUsers()` → `{ exists, onboardingCompleted }`. A purpose-built
 *     account-existence oracle for arbitrary email addresses, with zero callers — and
 *     wrong anyway, since `listUsers()` was unpaginated and only ever saw the first 50
 *     accounts.
 *
 * Restoring any of these must fail here: the secret egress, the anonymous LLM spend, the
 * anonymous plugin execution and the enumeration oracle all come back with the file.
 * Modelled on lib/__tests__/system-initializer-removed.guard.test.ts.
 *
 * ── What this guard does NOT claim ─────────────────────────────────────────
 * It proves these files are absent and unreferenced. It does not prove the *behaviour*
 * cannot reappear under a different path — a new route doing the same thing is invisible
 * here. That is the identity-surface guard's job (Slice A), not this one's.
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
  // Identity sweep, Slice 0 — 2026-09-21
  'app/api/v6/fetch-plugin-data/route.ts',
  'app/api/oauth/token/route.ts',
  'app/api/check-user-status/route.ts',
];

/**
 * Route directories that must not come back either. A directory surviving its
 * `route.ts` is how a "deleted" endpoint gets quietly re-added by someone who sees an
 * empty folder and assumes something belongs in it.
 */
const REMOVED_DIRS = [
  'app/api/user/plugins',
  'app/api/plugins/suggest',
  // Identity sweep, Slice 0 — 2026-09-21
  'app/api/v6/fetch-plugin-data',
  'app/api/oauth/token',
  'app/api/check-user-status',
];

const FORBIDDEN_LITERALS = [
  '/api/user/plugins',
  '/api/plugins/suggest',
  'Step3Plugins',
  // Identity sweep, Slice 0 — 2026-09-21
  '/api/v6/fetch-plugin-data',
  '/api/oauth/token',
  '/api/check-user-status',
];

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
    const present = REMOVED_DIRS.filter((d) => fs.existsSync(path.join(REPO_ROOT, d)));
    expect(present).toEqual([]);
  });

  it('the sibling routes that were NOT deleted are still present', () => {
    // Deleting `app/api/oauth/token` must not be read as "the OAuth surface is gone".
    // `app/oauth/token` and `app/oauth/callback/[plugin]` still exist and still parse an
    // unsigned `state` — tracked as R4, deliberately not closed by Slice 0. If either
    // disappears, someone has widened this deletion without saying so.
    expect(fs.existsSync(path.join(REPO_ROOT, 'app/oauth/token/route.ts'))).toBe(true);
    expect(
      fs.existsSync(path.join(REPO_ROOT, 'app/oauth/callback/[plugin]/route.ts'))
    ).toBe(true);
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

  it('can actually fail: each Slice 0 literal detects its own synthetic hit', () => {
    // One fixture per added literal. A single fixture would leave a typo'd entry
    // (the realistic failure mode when appending to a list) silently inert.
    const fixtures: Record<string, string> = {
      '/api/v6/fetch-plugin-data':
        "await fetch('/api/v6/fetch-plugin-data', { method: 'POST' })",
      '/api/oauth/token': "await fetch('/api/oauth/token?plugin=google-mail')",
      '/api/check-user-status':
        "await fetch('/api/check-user-status', { body: JSON.stringify({ email }) })",
    };
    for (const [literal, fixture] of Object.entries(fixtures)) {
      expect(FORBIDDEN_LITERALS).toContain(literal);
      expect(fixture.includes(literal)).toBe(true);
    }
  });
});
