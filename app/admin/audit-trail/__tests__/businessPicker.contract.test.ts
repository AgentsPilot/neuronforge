/**
 * The two standing costs of reusing another surface's endpoint, pinned in source.
 *
 * The account picker gets its list from `GET
 * /api/admin/business-os/llm-usage/businesses` — an endpoint the LLM usage tab
 * owns — instead of a new sibling route, because that route already returns
 * `{ userId, companyName }` from `businessProfileRepository.searchForAdmin`, and
 * the 50-row limit is `BUSINESS_SEARCH_MAX_LIMIT` INSIDE the repository, which
 * clamps whatever limit a caller passes. A sibling route would have fetched the
 * same rows from the same method.
 *
 * That reuse has exactly two costs, and each is checked here rather than trusted:
 *
 *  1. **It must stay a fetch, never an import.** `lib/audit -> lib/business-os`
 *     was rejected in review (see `lib/audit/requestSchemas.ts:61-72`, where the
 *     same temptation was refused for a one-line helper). An HTTP call creates no
 *     module coupling; an `import type` does, and is the easy accident.
 *  2. **The audit surface now depends on a contract it does not own.** If that
 *     route is moved, renamed or reshaped, the picker silently stops finding
 *     businesses. This turns that into a red test instead.
 *
 * Source-text assertions, so they survive any refactor of the code they describe.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');

const PICKER = 'app/admin/audit-trail/BusinessAccountPicker.tsx';
const REUSED_ROUTE = 'app/api/admin/business-os/llm-usage/businesses/route.ts';

/** Every file on the audit surface: the admin page, its route, the shared lib. */
const AUDIT_SURFACE_DIRS = ['app/admin/audit-trail', 'app/api/admin/audit-trail', 'lib/audit'];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Strip comments, so a path discussed in prose is not read as an import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function walk(rel: string): string[] {
  const absolute = path.join(ROOT, rel);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) return walk(child);
    return /\.(ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

const SURFACE_FILES = AUDIT_SURFACE_DIRS.flatMap((dir) => walk(dir));

/**
 * One pattern for EVERY way a module edge can be written, because an earlier
 * version of this guard was a statement matcher anchored at `^import` and `['"];?$`
 * — and so was silently blind to four forms, including the likeliest accident of
 * all: `import type { X } from '@/lib/business-os/…'; // TODO`. A trailing comment
 * is stripped to a trailing SPACE, which broke the end anchor, and the guard went
 * green on the exact import it exists to stop.
 *
 * So: no anchors. Any of `import` / `export` / `require` — which covers the
 * side-effect `import 'x'` (no `from`), the re-export `export type { A } from 'x'`,
 * and both dynamic forms — followed by anything up to the module specifier.
 * `[^;]*?` spans newlines (multi-line clauses) but never crosses a statement
 * boundary, so two unrelated statements cannot be spliced into a false positive.
 *
 * The specifier arm accepts the alias AND any relative path, for dynamic imports
 * too: the old dynamic check was `@/`-alias-only while the static one handled
 * relative paths, which is a bypass on its own.
 */
function businessOsModuleEdges(source: string): string[] {
  const pattern = /\b(?:import|export|require)\b[^;]*?['"](?:@\/lib\/business-os|\.\.?\/[^'"]*lib\/business-os)/g;
  return (stripComments(source).match(pattern) ?? []).map((hit) => hit.replace(/\s+/g, ' ').trim());
}

describe('the audit surface imports nothing from Business OS', () => {
  it('finds the files it checks', () => {
    expect(SURFACE_FILES).toContain(PICKER);
    expect(SURFACE_FILES).toContain('app/admin/audit-trail/page.tsx');
    expect(SURFACE_FILES).toContain('app/api/admin/audit-trail/route.ts');
    expect(SURFACE_FILES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(SURFACE_FILES)('%s has no lib/business-os module edge', (file) => {
    // `import type` counts: a type-only import is still a module edge, and it is
    // the shape this would most plausibly arrive as (`BusinessListResponse`).
    expect({ file, offenders: businessOsModuleEdges(read(file)) }).toEqual({ file, offenders: [] });
  });
});

describe('the guard above actually catches what it claims to', () => {
  // A guard nobody mutation-tests is a guard that passes while checking nothing.
  // Every form here was also planted in a real surface file and confirmed red.
  //
  // The two specifiers are ASSEMBLED rather than written out, because this test
  // file lives inside `app/admin/audit-trail` and is therefore scanned by the
  // guard itself — a literal sample would make the file its own offender.
  const ALIAS = ['@/lib', 'business-os', 'x'].join('/');
  const RELATIVE = ['../../../lib', 'business-os', 'x'].join('/');

  const CAUGHT: Array<[string, string]> = [
    ['plain', `import { listBusinesses } from '${ALIAS}';`],
    ['type-only', `import type { BusinessListResponse } from '${ALIAS}';`],
    ['inline type', `import { type BusinessListResponse } from '${ALIAS}';`],
    ['namespace', `import * as bos from '${ALIAS}';`],
    ['multi-line', `import {\n  BusinessListResponse,\n} from '${ALIAS}';`],
    ['relative', `import { x } from '${RELATIVE}';`],
    ['dynamic aliased', `const m = await import('${ALIAS}');`],
    ['side-effect (no from)', `import '${ALIAS}';`],
    ['re-export', `export type { BusinessListResponse } from '${ALIAS}';`],
    ['dynamic relative', `const m = await import('${RELATIVE}');`],
    ['require relative', `const m = require('${RELATIVE}');`],
    ['trailing comment', `import type { A } from '${ALIAS}'; // TODO`],
    ['trailing whitespace', `import type { A } from '${ALIAS}';   `],
  ];

  it.each(CAUGHT)('catches the %s form', (_name, source) => {
    expect(businessOsModuleEdges(source)).toHaveLength(1);
  });

  const ALLOWED: Array<[string, string]> = [
    // The picker's own URL constant — a Business OS ROUTE is the whole point;
    // only a module edge is forbidden.
    ['the reused route path', `export const BUSINESS_SEARCH_PATH = '/api/admin/business-os/llm-usage/businesses';`],
    ['a path named in prose', `// we deliberately do not import from '${ALIAS}'`],
    ['an unrelated import', `import { createLogger } from '@/lib/logger';`],
  ];

  it.each(ALLOWED)('does not fire on %s', (_name, source) => {
    expect(businessOsModuleEdges(source)).toEqual([]);
  });
});

describe('the endpoint the picker reuses', () => {
  const routeSource = read(REUSED_ROUTE);

  it('is the path the picker names', () => {
    // The constant is the single place the URL is written; if it stops matching a
    // real route file, the picker returns nothing at runtime and nothing else fails.
    const declared = read(PICKER).match(/BUSINESS_SEARCH_PATH\s*=\s*'([^']+)'/)?.[1];
    expect(declared).toBe('/api/admin/business-os/llm-usage/businesses');
    expect(fs.existsSync(path.join(ROOT, `app${declared}/route.ts`))).toBe(true);
  });

  it('still returns the two fields the picker reads', () => {
    // Renaming either field server-side would leave an empty list here, because
    // the shape is re-declared locally rather than imported.
    expect(routeSource).toMatch(/userId:\s*entry\.user_id/);
    expect(routeSource).toMatch(/companyName:\s*entry\.company_name/);
    expect(routeSource).toMatch(/limit:\s*LLM_USAGE_LIMITS\.BUSINESS_LIST/);
  });

  it('is still admin-only, and still reads through the repository', () => {
    // The picker adds a second consumer to this route; both rely on the server
    // being the thing that decides who may list businesses.
    expect(routeSource).toMatch(/AdminAccessService|requireAdmin/);
    expect(routeSource).toMatch(/businessProfileRepository\.searchForAdmin/);
    // Never the user-writable profile role (CLAUDE.md § Security Rules).
    expect(stripComments(routeSource)).not.toMatch(/profiles?\.role/);
  });

  it('caps the list in the repository, which is why no sibling route was built', () => {
    const repo = read('lib/repositories/BusinessProfileRepository.ts');
    expect(repo).toMatch(/BUSINESS_SEARCH_MAX_LIMIT\s*=\s*50/);
    // The clamp is what makes the cap a repository property rather than this
    // endpoint's: any caller asking for more still gets at most 50.
    expect(repo).toMatch(/Math\.min\([\s\S]{0,80}BUSINESS_SEARCH_MAX_LIMIT\)/);
  });
});

describe('no business name and no search text may be logged (AC-B13)', () => {
  /**
   * The object argument of every logger call in a file. `[A-Za-z]*[Ll]ogger`
   * because the call site is as often `requestLogger` as `logger`, and a
   * lowercase-only pattern matched NEITHER (it silently found nothing, which is
   * the way a guard like this passes while checking nothing).
   */
  function loggedContexts(source: string): string[] {
    return [
      ...stripComments(source).matchAll(
        /[A-Za-z]*[Ll]ogger\s*\.\s*(?:info|warn|error|debug|trace)\s*\(\s*(\{[^}]*\})/g
      ),
    ].map((match) => match[1]);
  }

  it('the picker logs only the error, with no term and no name', () => {
    const contexts = loggedContexts(read(PICKER));
    expect(contexts.length).toBeGreaterThan(0);
    for (const context of contexts) {
      expect(context).not.toMatch(/query|term|search|companyName|business(?!\s)/i);
    }
  });

  it('the reused route logs a length and a count, never the text or the names', () => {
    const contexts = loggedContexts(read(REUSED_ROUTE));
    expect(contexts.some((context) => /searchLength/.test(context))).toBe(true);
    for (const context of contexts) {
      expect(context).not.toMatch(/companyName/);
      // `searchLength` is fine; a bare `search` (the text itself) is not.
      expect(context).not.toMatch(/\bsearch\b\s*[,}:]/);
    }
  });
});
