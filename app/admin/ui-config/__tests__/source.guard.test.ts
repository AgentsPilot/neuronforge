/**
 * T-5 (slice F-1): the properties of `/admin/ui-config` and its route that the
 * behavioural tests cannot hold on their own.
 *
 *   1. No `console.*` in the route, the page or the presets (CLAUDE.md rule 3).
 *   2. The route builds no Supabase client and imports no raw client (rule 1).
 *   3. The route validates through the shared write schema and declares no token
 *      pattern of its own, so the grammar lives in one place (TH-1 customTokens).
 *   4. Each handler's first statement inside `try` is the `requireAdmin` gate.
 *   5. The page takes its presets from `./presets` and declares none inline (R-5).
 *   6. The two dead hooks stay deleted.
 *
 * Modelled on `app/admin/archiving/__tests__/source.guard.test.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

/** Source with comments removed, so prose about a rule cannot satisfy or break it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const ROUTE = 'app/api/admin/ui-config/route.ts';
const PAGE = 'app/admin/ui-config/page.tsx';
const PRESETS = 'app/admin/ui-config/presets.ts';

describe('/admin/ui-config source guard (F-1 T-5)', () => {
  it.each([ROUTE, PAGE, PRESETS])('%s has no console.*', (file) => {
    expect(codeOf(read(file))).not.toMatch(/\bconsole\./);
  });

  it('the page logs through clientLogger', () => {
    const page = codeOf(read(PAGE));
    expect(page).toContain("import { clientLogger } from '@/lib/logger/client'");
    expect(page).toMatch(/clientLogger\.child\(\{ module: 'AdminUiConfigPage' \}\)/);
  });

  it('the route reaches the database only through the repository', () => {
    const route = codeOf(read(ROUTE));
    expect(route).not.toMatch(/@supabase\/supabase-js|createClient|supabaseServer|supabaseClient/);
    expect(route).not.toMatch(/\.from\(\s*['"]/);
    expect(route).toContain("from '@/lib/repositories/SystemConfigRepository'");
  });

  it('the route validates with the shared schema and declares no token pattern', () => {
    const route = codeOf(read(ROUTE));
    expect(route).toContain("from '@/lib/validation/admin-ui-config-schema'");
    expect(route).toContain('uiConfigPostSchema.safeParse(');
    // No regex literal and no RegExp: the grammar is TH-1's, not the route's.
    expect(route).not.toMatch(/new RegExp|=\s*\/[^/*]/);
    // The admin route never uses the cached server reader (TH-1 G-13).
    expect(route).not.toMatch(/readV2CustomTokens/);
  });

  it.each(['GET', 'POST'])('%s gates with requireAdmin as its first statement in try', (handler) => {
    const route = codeOf(read(ROUTE));
    const start = route.indexOf(`export async function ${handler}(`);
    expect(start).toBeGreaterThan(-1);
    const afterTry = route.slice(route.indexOf('try {', start) + 'try {'.length);
    const statements = afterTry.trimStart().split('\n').map((l) => l.trim()).filter(Boolean);
    expect(statements[0]).toBe('const gate = await requireAdmin(requestLogger);');
    expect(statements[1]).toBe('if (gate instanceof NextResponse) return gate;');
    // Between the signature and the try there is only the correlation id and
    // the child logger: nothing can touch the body or the data before the gate.
    const preamble = route
      .slice(route.indexOf('{', start) + 1, route.indexOf('try {', start))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    expect(preamble).toEqual([
      "const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();",
      'const requestLogger = logger.child({ correlationId });',
    ]);
  });

  it('the page imports its presets and declares none inline (R-5)', () => {
    const page = codeOf(read(PAGE));
    expect(page).toContain(
      "import { radiusOptions, shadowOptions, spacingOptions, fontSizeOptions } from './presets'"
    );
    for (const name of ['radiusOptions', 'shadowOptions', 'spacingOptions', 'fontSizeOptions']) {
      expect([name, new RegExp(`(const|let|var)\\s+${name}\\b`).test(page)]).toEqual([name, false]);
    }
  });

  it.each(['lib/hooks/useUIVersion.ts', 'lib/hooks/useTheme.ts'])('%s stays deleted', (file) => {
    expect(fs.existsSync(path.join(process.cwd(), file))).toBe(false);
  });
});
