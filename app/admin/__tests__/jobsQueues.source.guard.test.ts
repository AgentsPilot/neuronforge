/**
 * What no render test can reach on the jobs & queues page (admin
 * reorganisation slice 5; SA SC-7(g), SC-8, C-21 pattern):
 *   - client files import only `import type` from lib/admin/jobs, and nothing
 *     from the registry, a repository or a server module at runtime;
 *   - green classes live in exactly one constant, GREEN_STYLE;
 *   - no action verbs, no POST, no console, no "OK".
 *
 * Amended deliberately by ADMIN_BOS_CLEANUP slice 7d (SA W7D-2, OP-3), in the
 * narrowest form: `page.tsx` keeps every rule; `JobsQueuesView.tsx` keeps every
 * rule except that the word "Drain" may appear exactly once, in its header
 * sentence; the one action lives in the new `DrainNowDialog.tsx`, which may
 * make exactly one POST, to the literal drain URL, and nothing else.
 */

import * as fs from 'fs';
import * as path from 'path';

const PAGE = 'app/admin/jobs-queues/page.tsx';
const VIEW = 'app/admin/components/jobs/JobsQueuesView.tsx';
const DIALOG = 'app/admin/components/jobs/DrainNowDialog.tsx';
/** The two read-only files: every original rule applies (W7D-2). */
const FILES = [PAGE, VIEW];
/** Every client file on the page: client-only, C-21 imports, no console, no "OK". */
const CLIENT_FILES = [PAGE, VIEW, DIALOG];
const VIEW_HEADER_SENTENCE = 'Each queue has a Drain now button; everything else here is read-only.';
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function runtimeImports(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/import\s+(?!type\b)[^'"]*?from\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of code.matchAll(/import\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  return found;
}

const GREEN_PREFIXES = ['bg', 'text', 'border', 'from', 'to', 'via', 'shadow', 'outline', 'decoration', 'divide', 'ring', 'fill', 'stroke'];
const GREEN_CLASS = new RegExp(`(?<![\\w-])(?:${GREEN_PREFIXES.join('|')})-(?:green|emerald)-`);

describe('the jobs & queues client files', () => {
  it.each(CLIENT_FILES)('%s is a client component', (file) => {
    expect(read(file).trimStart().startsWith("'use client'")).toBe(true);
  });

  it.each(CLIENT_FILES)('%s imports no registry, repository, read or server module at runtime (C-21)', (file) => {
    for (const spec of runtimeImports(codeOf(read(file)))) {
      expect(spec).not.toMatch(/^@\/lib\/(repositories|cron|business-os|supabase)/);
      expect(spec).not.toMatch(/lib\/admin\/(jobs|health|readUnderDeadline)/);
      expect(spec).not.toMatch(/server-only/);
    }
  });

  it.each(FILES)('%s has no action button, no POST, no console and never says "OK"', (file) => {
    // The view's one allowance (W7D-2): its header sentence names the button.
    // Its presence and count are pinned in the slice 7d block below.
    const code = codeOf(read(file)).replace(VIEW_HEADER_SENTENCE, '');
    expect(code).not.toMatch(/\b(Retry|Requeue|Cancel|Drain)\b/);
    expect(code).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/);
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/\bOK\b/);
  });

  it('green lives in exactly one constant, GREEN_STYLE (SC-7(g))', () => {
    const code = codeOf(read('app/admin/components/jobs/JobsQueuesView.tsx'));
    const decl = code.match(/const GREEN_STYLE = '([^']*)';/);
    expect(decl?.[1]).toMatch(GREEN_CLASS);
    expect(code.replace(decl![0], '')).not.toMatch(GREEN_CLASS);
    expect(code.match(/\bGREEN_STYLE\b/g)).toHaveLength(2); // the declaration and TONE_CLASSES.green
    expect(codeOf(read('app/admin/jobs-queues/page.tsx'))).not.toMatch(GREEN_CLASS);
  });
});

describe('slice 7d: the one action, and nothing more (SA W7D-2)', () => {
  it('page.tsx never says "Drain" and makes no request', () => {
    const code = codeOf(read(PAGE));
    expect(code).not.toMatch(/\bDrain\b/);
    expect(code).not.toMatch(/fetch\(/);
  });

  it('JobsQueuesView.tsx says "Drain" exactly once, in its header sentence', () => {
    const code = codeOf(read(VIEW));
    expect(code).toContain(VIEW_HEADER_SENTENCE);
    expect(code.match(/\bDrain\b/g)).toHaveLength(1);
  });

  it('JobsQueuesView.tsx still has exactly one fetch: the jobs GET', () => {
    const code = codeOf(read(VIEW));
    expect(code.match(/fetch\(/g)).toHaveLength(1);
    expect(code).toContain("fetch('/api/admin/jobs-queues', { cache: 'no-store' })");
  });

  it('DrainNowDialog.tsx makes exactly one POST, with one fetch, to the literal drain URL', () => {
    const code = codeOf(read(DIALOG));
    expect(code.match(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g)).toEqual(["method: 'POST'"]);
    const fetches = [...code.matchAll(/fetch\(\s*([^,)]*)/g)].map((m) => m[1].trim());
    expect(fetches).toEqual(["'/api/admin/jobs-queues/drain'"]);
  });

  it('DrainNowDialog.tsx builds the body from queue and reason only', () => {
    const code = codeOf(read(DIALOG));
    expect(code.match(/JSON\.stringify\(/g)).toHaveLength(1);
    expect(code).toMatch(/body:\s*JSON\.stringify\(\{\s*queue:\s*queueId,\s*reason:\s*reason\.trim\(\)\s*\}\)/);
  });

  it('DrainNowDialog.tsx: no Retry or Requeue, no green, never "OK"; Cancel is allowed in this file only', () => {
    const code = codeOf(read(DIALOG));
    expect(code).not.toMatch(/\b(Retry|Requeue)\b/);
    expect(code).not.toMatch(GREEN_CLASS);
    expect(code).not.toMatch(/\bOK\b/);
    expect(code).not.toMatch(/console\./);
    expect(code).toMatch(/\bCancel\b/);
  });
});
