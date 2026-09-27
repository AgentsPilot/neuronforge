/**
 * What no render test can reach on the jobs & queues page (admin
 * reorganisation slice 5; SA SC-7(g), SC-8, C-21 pattern):
 *   - client files import only `import type` from lib/admin/jobs, and nothing
 *     from the registry, a repository or a server module at runtime;
 *   - green classes live in exactly one constant, GREEN_STYLE;
 *   - no action verbs, no POST, no console, no "OK".
 */

import * as fs from 'fs';
import * as path from 'path';

const FILES = ['app/admin/jobs-queues/page.tsx', 'app/admin/components/jobs/JobsQueuesView.tsx'];
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
  it.each(FILES)('%s is a client component', (file) => {
    expect(read(file).trimStart().startsWith("'use client'")).toBe(true);
  });

  it.each(FILES)('%s imports no registry, repository, read or server module at runtime (C-21)', (file) => {
    for (const spec of runtimeImports(codeOf(read(file)))) {
      expect(spec).not.toMatch(/^@\/lib\/(repositories|cron|business-os|supabase)/);
      expect(spec).not.toMatch(/lib\/admin\/(jobs|health|readUnderDeadline)/);
      expect(spec).not.toMatch(/server-only/);
    }
  });

  it.each(FILES)('%s has no action button, no POST, no console and never says "OK"', (file) => {
    const code = codeOf(read(file));
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
