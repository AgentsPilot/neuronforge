/**
 * Static gate (Layer 2 Step 0, SA addendum §G): no route under
 * `app/api/admin/system-config/**` may reach the database on its own.
 *
 * All data access goes through `lib/repositories/` (CLAUDE.md mandatory rule 1).
 * This test fails the moment a `createClient`, a `supabaseServer`/`supabaseClient`
 * import or a raw `.from('<table>')` call comes back into these routes — which is
 * exactly how the pre-Step-0 code looked.
 *
 * It also holds the line on `console.*`: these three routes are Pino-only.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROUTES_DIR = join(process.cwd(), 'app', 'api', 'admin', 'system-config');

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      found.push(...routeFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      found.push(full);
    }
  }
  return found;
}

const files = routeFiles(ROUTES_DIR);

describe('app/api/admin/system-config/** data access', () => {
  it('finds the route files to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files.map((f) => [f.replace(process.cwd(), '').replace(/\\/g, '/'), f]))(
    '%s constructs no Supabase client and imports no raw client',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');

      expect(source).not.toContain('createClient');
      expect(source).not.toContain('@/lib/supabaseServer');
      expect(source).not.toContain('@/lib/supabaseClient');
      expect(source).not.toContain('@supabase/supabase-js');
    }
  );

  it.each(files.map((f) => [f.replace(process.cwd(), '').replace(/\\/g, '/'), f]))(
    '%s issues no direct table query',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');

      // `.from('table')` — the shape every direct PostgREST query starts with.
      expect(source).not.toMatch(/\.from\(\s*['"`]/);
    }
  );

  it.each(files.map((f) => [f.replace(process.cwd(), '').replace(/\\/g, '/'), f]))(
    '%s logs through Pino only (T0-6)',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');

      expect(source).not.toMatch(/console\.(log|warn|error|info|debug)/);
    }
  );
});
