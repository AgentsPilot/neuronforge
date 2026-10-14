/**
 * C-7 guard (RLS slice 2c-1; SA rulings R-8, R-9 and S-13, 2026-10-14).
 *
 * WHY (a). `@/lib/supabaseClient` is the browser client. Imported by server
 * code it has no session cookie, so it talks to the database as `anon`. Three
 * API routes did exactly that through the `executionRepository` and
 * `sharedAgentRepository` singletons, and broke the moment the 20261060
 * stopgap closed the agent tables to `anon`. Worse, before the stopgap they
 * "worked" only because `anon` could read every user's rows.
 *
 * WHY (c). The user switched agent sharing and the template gallery off
 * (BQ-2, 2026-10-14). The routes and pages were deleted (R-1), so Next.js
 * answers 404. A link or fetch that creeps back would be a dead end.
 *
 * WHAT IS PINNED.
 *   (a) No source file under `lib/repositories/` imports the browser client,
 *       except a frozen, dated allow-list of exactly three (S-13): capped by
 *       equality, and each entry must still import it (a stale entry fails, so
 *       the list only ever shrinks: the SECDEF / authz guard ratchet).
 *   (c) No source file under `app/`, `components/`, `lib/` or `hooks/` names
 *       `/api/shared-agents`, `/api/agents/import-shared`, `/v2/templates` or
 *       `/api/agents/<id>/metrics` (SA CR-4), or a quoted bare `/templates`
 *       path (SA CR-5: the legacy gallery, from any file, not just the layout).
 *   Mutation self-tests: each pattern catches the shapes it must catch.
 *   (Former part (b), the removed-singleton check, was dropped by SA R-9:
 *   importing a removed export already fails the build.)
 *
 * Pure fs scan, milliseconds. Tests are excluded: they mock the browser client
 * module by name, and this guard names the dead paths itself.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.next', '.git', '__tests__']);

/** Imports (static, dynamic or require) of the browser client module. */
const BROWSER_CLIENT_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:@\/lib\/supabaseClient|(?:\.\.?\/)+supabaseClient)['"]/;

/** A reference to a sharing route or gallery page removed by 2c-1 (R-9 c). */
const SHARING_PATH = /\/api\/shared-agents\b|\/api\/agents\/import-shared\b|\/v2\/templates\b/;

/** The deleted per-agent metrics route, literal or templated id (SA CR-4). */
const METRICS_ROUTE = /\/api\/agents\/(?:\$\{[^}]*\}|[^'"`\s/]+)\/metrics\b/;

/**
 * The removed legacy `/templates` page, as a quoted path anywhere (SA CR-5).
 * Quote-anchored, so `/api/website/templates` or `lib/email/templates` never
 * match.
 */
const TEMPLATES_PAGE_PATH = /['"`]\/templates['"`/?#]/;

/**
 * S-13: SA approval 2026-10-14 (Q-2C-2). Removing these defaults is FU-5.
 * Remove an entry when its file stops importing the browser client; never add
 * one without an SA ruling recorded beside it.
 */
const ALLOWED_BROWSER_DEFAULTS: ReadonlyArray<{ file: string; approved: string }> = [
  { file: 'lib/repositories/AgentMetricsRepository.ts', approved: '2026-10-14 SA Q-2C-2' },
  { file: 'lib/repositories/ConfigRepository.ts', approved: '2026-10-14 SA Q-2C-2' },
  { file: 'lib/repositories/MemoryRepository.ts', approved: '2026-10-14 SA Q-2C-2' },
];
const ALLOW_LIST_CAP = 3;

/** S-13 as a predicate, so the mutation self-test exercises the real check (SA CR-6). */
function allowListViolations(list: ReadonlyArray<{ file: string; approved: string }>): string[] {
  const problems: string[] = [];
  if (list.length !== ALLOW_LIST_CAP) problems.push(`size ${list.length} is not the cap ${ALLOW_LIST_CAP}`);
  for (const entry of list) {
    if (!/^\d{4}-\d{2}-\d{2} SA /.test(entry.approved)) problems.push(`${entry.file} is not dated with an SA approval`);
  }
  return problems;
}

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    if (/\.(test|spec)\.tsx?$/.test(name)) return [];
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [full] : [];
  });
}

const rel = (full: string) => relative(ROOT, full).split(sep).join('/');
const read = (relPath: string) => readFileSync(join(ROOT, relPath), 'utf8');

const REPOSITORY_FILES = walk(join(ROOT, 'lib', 'repositories')).map(rel);
const CODE_FILES = ['app', 'components', 'lib', 'hooks'].flatMap((dir) => walk(join(ROOT, dir))).map(rel);

describe('C-7: no repository defaults to the browser (anon) client', () => {
  it('the scans actually ran', () => {
    expect(REPOSITORY_FILES.length).toBeGreaterThan(20);
    expect(REPOSITORY_FILES).toContain('lib/repositories/ExecutionRepository.ts');
    expect(CODE_FILES.length).toBeGreaterThan(500);
    expect(CODE_FILES).toContain('app/(protected)/layout.tsx');
  });

  it('(a) only the allow-listed repositories import the browser client', () => {
    const allowed = new Set(ALLOWED_BROWSER_DEFAULTS.map((entry) => entry.file));
    const offenders = REPOSITORY_FILES.filter((file) => !allowed.has(file)).filter((file) =>
      BROWSER_CLIENT_IMPORT.test(read(file))
    );
    expect(offenders).toEqual([]);
  });

  it('(a) S-13: the allow-list is capped at exactly 3, each entry dated with its SA approval', () => {
    expect(allowListViolations(ALLOWED_BROWSER_DEFAULTS)).toEqual([]);
  });

  it('(a) S-13: no stale entry, every allow-listed file exists and still imports the browser client', () => {
    for (const { file } of ALLOWED_BROWSER_DEFAULTS) {
      expect({ file, present: REPOSITORY_FILES.includes(file) }).toEqual({ file, present: true });
      expect({ file, imports: BROWSER_CLIENT_IMPORT.test(read(file)) }).toEqual({ file, imports: true });
    }
  });

  it('(a) ExecutionRepository no longer imports the browser client (R-8)', () => {
    expect(BROWSER_CLIENT_IMPORT.test(read('lib/repositories/ExecutionRepository.ts'))).toBe(false);
  });

  it('(c) no source file references a removed sharing route or the v2 gallery', () => {
    const offenders = CODE_FILES.filter((file) => SHARING_PATH.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('(c) CR-4: no source file calls the deleted /api/agents/<id>/metrics route', () => {
    const offenders = CODE_FILES.filter((file) => METRICS_ROUTE.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('(c) CR-5: no source file links to the removed legacy /templates page', () => {
    expect(CODE_FILES).toContain('app/(protected)/layout.tsx');
    const offenders = CODE_FILES.filter((file) => TEMPLATES_PAGE_PATH.test(read(file)));
    expect(offenders).toEqual([]);
  });

  describe('mutation self-tests', () => {
    it.each([
      "import { supabase as defaultSupabase } from '@/lib/supabaseClient';",
      'import { supabase } from "@/lib/supabaseClient"',
      "import { supabase } from '../supabaseClient';",
      "const { supabase } = await import('@/lib/supabaseClient');",
      "const { supabase } = require('@/lib/supabaseClient');",
    ])('BROWSER_CLIENT_IMPORT catches: %s', (line) => {
      expect(BROWSER_CLIENT_IMPORT.test(line)).toBe(true);
    });

    it.each([
      "import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';",
      "import { supabaseServer } from '@/lib/supabaseServer';",
      "import type { SupabaseClient } from '@supabase/supabase-js';",
      '// the old default was the browser client (supabaseClient)',
    ])('BROWSER_CLIENT_IMPORT ignores: %s', (line) => {
      expect(BROWSER_CLIENT_IMPORT.test(line)).toBe(false);
    });

    it.each([
      "fetch('/api/shared-agents', { method: 'POST' })",
      'fetch(`/api/shared-agents/exists?agentId=${id}`)',
      "await fetch('/api/agents/import-shared', { method: 'POST' })",
      "router.push('/v2/templates')",
      '<Link href="/v2/templates/abc">',
    ])('SHARING_PATH catches: %s', (line) => {
      expect(SHARING_PATH.test(line)).toBe(true);
    });

    it.each([
      "fetch('/api/agents/123/executions')",
      "fetch('/api/plugins/schema-metadata')",
      "router.push('/v2/agent-list')",
      "const templatePath = 'app/api/prompt-templates/x.txt'",
    ])('SHARING_PATH ignores: %s', (line) => {
      expect(SHARING_PATH.test(line)).toBe(false);
    });

    it.each([
      'fetch(`/api/agents/${agentId}/metrics`, { method: "GET" })',
      "fetch('/api/agents/abc/metrics')",
      "fetch('/api/agents/123/metrics')",
    ])('METRICS_ROUTE catches: %s', (line) => {
      expect(METRICS_ROUTE.test(line)).toBe(true);
    });

    it.each([
      'fetch(`/api/agents/${agentId}/executions`)',
      "fetch('/api/agents/123/intensity')",
      "import { MetricsComputeService } from '@/lib/business-os/insight/metrics'",
      "fetch('/api/v2/analytics/metrics')",
    ])('METRICS_ROUTE ignores: %s', (line) => {
      expect(METRICS_ROUTE.test(line)).toBe(false);
    });

    it.each([
      'href="/templates"',
      "href={'/templates'}",
      "router.push('/templates')",
      'href="/templates?x=1"',
      'router.push(`/templates/${id}`)',
    ])('TEMPLATES_PAGE_PATH catches: %s', (line) => {
      expect(TEMPLATES_PAGE_PATH.test(line)).toBe(true);
    });

    it.each([
      'href="/monitoring"',
      'href="/templates-builder"',
      "fetch('/api/website/templates')",
      "join(process.cwd(), 'lib', 'email', 'templates')",
    ])('TEMPLATES_PAGE_PATH ignores: %s', (line) => {
      expect(TEMPLATES_PAGE_PATH.test(line)).toBe(false);
    });

    it('CR-6: the S-13 predicate rejects a grown list and an undated entry', () => {
      const grown = [...ALLOWED_BROWSER_DEFAULTS, { file: 'lib/repositories/X.ts', approved: '2026-10-14 SA x' }];
      expect(allowListViolations(grown)).toEqual(['size 4 is not the cap 3']);
      const undated = ALLOWED_BROWSER_DEFAULTS.map((entry, i) => (i === 0 ? { ...entry, approved: 'later' } : entry));
      expect(allowListViolations(undated)).toEqual([`${ALLOWED_BROWSER_DEFAULTS[0].file} is not dated with an SA approval`]);
      const shrunk = ALLOWED_BROWSER_DEFAULTS.slice(1);
      expect(allowListViolations(shrunk)).toEqual(['size 2 is not the cap 3']);
    });
  });
});
