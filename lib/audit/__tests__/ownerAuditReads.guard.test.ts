/**
 * Owner-read guard for `audit_trail` (credit deduction BD-26; workplan
 * BUSINESS_OS_BD26_OWNER_AUDIT_HIDING_WORKPLAN.md §4, SA W26-6).
 *
 * Owner-hidden entries (lib/audit/ownerVisibility.ts) are left out by three
 * readers: the owner RLS policy, AuditTrailRepository.listOwnerEntries and the
 * data export route. A NEW owner-facing reader of the table would not know the
 * rule, so this guard fails on any `'audit_trail'` / `"audit_trail"` /
 * `` `audit_trail` `` string literal in application code (comments do not
 * count) outside the allow-list below. It matches the literal, not only
 * `from('audit_trail')`, because ArchiveRepository reaches the table through a
 * constant and a future reader could do the same.
 *
 * Adding a file to the allow-list is a review decision: it must be an admin
 * read behind `requireAdmin`, a server-side write, or a reader that applies
 * both owner exclusions.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'components', 'hooks', 'lib'];
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Files allowed to name the table (W26-6 b), with why. */
const ALLOWED_FILES: Record<string, string> = {
  'lib/repositories/AuditTrailRepository.ts': 'the owner read applies the BD-26 exclusions; admin methods are pinned to app/api/admin/**',
  'lib/services/AuditTrailService.ts': 'the server-side writer; query() / exportUserData() carry a CALLER CONTRACT and have no production caller',
  'lib/repositories/ArchiveRepository.ts': 'archives rows server-side; archived_records has no client policy',
  'lib/archiving/config.ts': 'archive source configuration, not a read',
  'lib/business-os/purge/descriptors.ts': 'purge descriptor, not an owner read',
  'hooks/useLatestArchiveCutoff.ts': 'an archive source key sent to an admin route, not a read',
};

/** Allowed only while it applies both owner exclusions (W26-6 c, ruling 5). */
const DATA_EXPORT_ROUTE = 'app/api/user/data-export/route.ts';

const isAdminApi = (file: string) => file.startsWith('app/api/admin/');

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (CODE_FILE.test(name) && !/\.(test|spec)\.[jt]sx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * The string literals of a source file, comments skipped. A small scanner:
 * quotes, escapes, template literals with `${ … }` code inside, line and block
 * comments. Regex literals are not special-cased; a `//` inside one at worst
 * hides the rest of that line, which cannot turn a real literal into a miss of
 * `'audit_trail'` written on its own line.
 */
function stringLiteralsOf(source: string): string[] {
  const literals: string[] = [];
  // Stack of contexts: 'code' (with the brace depth that ends a template `${`) or 'template'.
  const stack: Array<{ kind: 'code'; depth: number } | { kind: 'template'; text: string }> = [{ kind: 'code', depth: 0 }];
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1];
    const ch = source[i];
    if (top.kind === 'template') {
      if (ch === '\\') {
        top.text += source.slice(i, i + 2);
        i += 2;
      } else if (ch === '`') {
        literals.push(top.text);
        stack.pop();
        i += 1;
      } else if (ch === '$' && source[i + 1] === '{') {
        stack.push({ kind: 'code', depth: 0 });
        i += 2;
      } else {
        top.text += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (ch === "'" || ch === '"') {
      let text = '';
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        if (source[j] === '\\') {
          text += source.slice(j, j + 2);
          j += 2;
        } else {
          text += source[j];
          j += 1;
        }
      }
      literals.push(text);
      i = j + 1;
    } else if (ch === '`') {
      stack.push({ kind: 'template', text: '' });
      i += 1;
    } else if (ch === '{') {
      top.depth += 1;
      i += 1;
    } else if (ch === '}') {
      if (top.depth === 0 && stack.length > 1) stack.pop();
      else top.depth -= 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return literals;
}

/** Source with comments removed (string contents kept), for the data-export check. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function appliesBothOwnerExclusions(source: string): boolean {
  const code = withoutComments(source);
  return (
    /\.not\(\s*'entity_type'\s*,\s*'in'\s*,[\s\S]{0,80}?OWNER_HIDDEN_ENTITY_TYPES/.test(code) &&
    /\.not\(\s*'action'\s*,\s*'like'\s*,[\s\S]{0,80}?AI_ACTION_EVENT_PREFIX/.test(code)
  );
}

/** The guard's verdict for one file. */
function violation(file: string, source: string): string | null {
  if (!stringLiteralsOf(source).includes('audit_trail')) return null;
  if (isAdminApi(file) || file in ALLOWED_FILES) return null;
  if (file === DATA_EXPORT_ROUTE) {
    return appliesBothOwnerExclusions(source)
      ? null
      : `${file} reads audit_trail without both owner exclusions (OWNER_HIDDEN_ENTITY_TYPES and AI_ACTION_EVENT_PREFIX)`;
  }
  return `${file} names audit_trail outside the owner-read allow-list (BD-26: an owner-facing read must exclude OWNER_HIDDEN_ENTITY_TYPES)`;
}

const files = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir))).map((full) => ({
  file: relative(ROOT, full).split(sep).join('/'),
  source: readFileSync(full, 'utf8'),
}));

describe('owner reads of audit_trail (BD-26, W26-6)', () => {
  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('no file outside the allow-list names the table in code', () => {
    const violations = files.map(({ file, source }) => violation(file, source)).filter((v): v is string => v !== null);
    expect(violations).toEqual([]);
  });

  it('every allow-listed file still names the table (no stale entry)', () => {
    for (const allowed of [...Object.keys(ALLOWED_FILES), DATA_EXPORT_ROUTE]) {
      const entry = files.find(({ file }) => file === allowed);
      expect({ allowed, found: Boolean(entry) }).toEqual({ allowed, found: true });
      expect({ allowed, names: stringLiteralsOf(entry!.source).includes('audit_trail') }).toEqual({ allowed, names: true });
    }
  });

  it('the scanner sees the known admin readers (it is not blind)', () => {
    const named = files.filter(({ source }) => stringLiteralsOf(source).includes('audit_trail')).map(({ file }) => file);
    for (const known of [
      'app/api/admin/audit-trail/route.ts',
      'app/api/admin/users/[id]/audit-logs/route.ts',
      'app/api/admin/users/[id]/login-stats/route.ts',
      'app/api/admin/archiving/route.ts',
    ]) {
      expect(named).toContain(known);
    }
  });

  it('the data export route applies both owner exclusions', () => {
    const entry = files.find(({ file }) => file === DATA_EXPORT_ROUTE);
    expect(entry && appliesBothOwnerExclusions(entry.source)).toBe(true);
  });
});

describe('the guard itself (negative controls)', () => {
  it('flags a planted read outside the allow-list, in each quote style', () => {
    for (const planted of ["supabase.from('audit_trail')", 'supabase.from("audit_trail")', 'supabase.from(`audit_trail`)', "const TABLE = 'audit_trail';"]) {
      expect(violation('app/api/business-os/new-owner-reader/route.ts', planted)).not.toBeNull();
    }
    expect(violation('components/SomeWidget.tsx', "fetchRows({ table: 'audit_trail' })")).not.toBeNull();
  });

  it('ignores comments and other literals', () => {
    expect(violation('app/api/x/route.ts', "// reads from('audit_trail')\n/* 'audit_trail' */ const a = 'audit_trail_archive';")).toBeNull();
    expect(violation('app/api/x/route.ts', 'const url = `${base}/audit_trail/${id}`;')).toBeNull();
  });

  it('finds a literal inside a template expression', () => {
    expect(stringLiteralsOf('const q = `${client.from(\'audit_trail\')}`;')).toContain('audit_trail');
  });

  it('allows admin routes and the allow-listed files', () => {
    expect(violation('app/api/admin/anything/route.ts', "from('audit_trail')")).toBeNull();
    expect(violation('lib/repositories/AuditTrailRepository.ts', "from('audit_trail')")).toBeNull();
  });

  it('fails the data export route when either exclusion is missing', () => {
    const both =
      "from('audit_trail').select('*').not('entity_type', 'in', `(${OWNER_HIDDEN_ENTITY_TYPES.join(',')})`).not('action', 'like', `${AI_ACTION_EVENT_PREFIX}%`)";
    expect(violation(DATA_EXPORT_ROUTE, both)).toBeNull();
    expect(violation(DATA_EXPORT_ROUTE, both.replace(/\.not\('action'[^]*$/, ''))).not.toBeNull();
    expect(violation(DATA_EXPORT_ROUTE, both.replace(/\.not\('entity_type'[^]*?\)`\)/, ''))).not.toBeNull();
    expect(violation(DATA_EXPORT_ROUTE, `// OWNER_HIDDEN_ENTITY_TYPES AI_ACTION_EVENT_PREFIX\nfrom('audit_trail')`)).not.toBeNull();
  });
});
