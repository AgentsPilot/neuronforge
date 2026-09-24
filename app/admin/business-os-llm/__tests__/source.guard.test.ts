/**
 * S2-T1 / S2-T2 — the two properties of this screen that no rendering test can
 * reach, and that neither CI gate can see.
 *
 * `check:bos-llm-literals` and `typecheck:bos-llm` both scope themselves to
 * files that import the call catalog. This page imports NOTHING from it, by
 * design (FR-6) — which is exactly why it is invisible to them, and why the
 * source scan below is the only enforcement that exists.
 */

import * as fs from 'fs';
import * as path from 'path';

import { codeOf, LITERAL_RULES } from '@/tests/helpers/bos-llm-literal-rules';

const ROOT = 'app/admin/business-os-llm';

/**
 * Every non-test source file of the screen, WALKED rather than listed — so a
 * component added tomorrow is covered before anyone remembers this file.
 */
function screenFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__snapshots__') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      found.push(full.replace(process.cwd() + path.sep, '').split(path.sep).join('/'));
    }
  };
  walk(path.join(process.cwd(), ROOT));
  return found.sort();
}

const allFiles = screenFiles();
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('S2-T2: the screen holds no server module and no setting of its own', () => {
  it('finds the page and its components, so the scan cannot fall behind the code', () => {
    expect(allFiles).toContain(`${ROOT}/page.tsx`);
    expect(allFiles).toContain(`${ROOT}/components/AreaCard.tsx`);
    expect(allFiles.length).toBeGreaterThanOrEqual(8);
  });

  /**
   * The four modules FR-6 names. Importing any of them would put the
   * guardrails, the locks or the catalogue itself in the browser bundle —
   * where they would be a SECOND answer to every question the payload already
   * answers, free to drift from the resolver's.
   */
  const FORBIDDEN_MODULES = [
    'modelSettings',
    'modelSettingsPolicy',
    'modelSettingsSchema',
    'callCatalog',
    'adminSettingsView',
    'modelOptions',
    'switchOffPredicate',
  ];

  it.each(allFiles)('%s imports no server module', (relative) => {
    const code = codeOf(read(relative));
    const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

    for (const forbidden of FORBIDDEN_MODULES) {
      expect({ file: relative, imports: imports.filter((i) => i.includes(forbidden)) }).toEqual({
        file: relative,
        imports: [],
      });
    }

    // Nothing from `lib/` at all except the one copy module the route shares
    // with the panel, which is plain by design (no `server-only`, no catalog).
    const libImports = imports.filter((i) => i.startsWith('@/lib/'));
    expect({ file: relative, libImports }).toEqual({
      file: relative,
      libImports: libImports.filter((i) => i === '@/lib/business-os/llm/ledgerCheckCopy'),
    });
  });

  it.each(allFiles)('%s writes no model id and no temperature literal', (relative) => {
    const code = codeOf(read(relative));
    for (const rule of LITERAL_RULES) {
      expect({ file: relative, rule: rule.name, matched: rule.pattern.test(code) }).toEqual({
        file: relative,
        rule: rule.name,
        matched: false,
      });
    }
  });

  it.each(allFiles)('%s logs through nothing — no console.* on a page either', (relative) => {
    expect(read(relative)).not.toMatch(/console\.(log|warn|error|info|debug)\s*\(/);
  });

  it('the shared ledger copy is still importable by the client', () => {
    // If this ever gains `server-only`, the panel stops building and the
    // temptation is to re-type the three readings into the component. That is
    // the drift the shared module exists to prevent.
    expect(read('lib/business-os/llm/ledgerCheckCopy.ts')).not.toContain("import 'server-only'");
  });
});

describe('S2-T1: the page adds no guard of its own, and offers no lesser tier', () => {
  const pageCode = codeOf(read(`${ROOT}/page.tsx`));

  it('does not re-implement the layout guard', () => {
    // `app/admin/layout.tsx` awaits `requireAdminPage()` before this page
    // renders, and a page cannot skip its parent layout. A second check here
    // would imply the first one is optional.
    expect(pageCode).not.toMatch(/requireAdminPage|requireAdmin\b/);
  });

  it('never decides who is an admin', () => {
    expect(pageCode).not.toMatch(/AdminAccessService|profiles\.role|app_metadata/);
    expect(pageCode).not.toMatch(/isAdmin/);
  });

  it('has no read-only-for-non-admins variant: admin or nothing (D-7)', () => {
    for (const relative of allFiles) {
      expect(codeOf(read(relative))).not.toMatch(/readOnlyView|viewerMode|nonAdmin/i);
    }
  });

  /*
   * The one guard over all 22 `/admin` pages, asserted three times over.
   *
   * ── The history of this assertion, because it is the point ───────────────
   * v1 read the layout RAW and looked for the substring `await
   * requireAdminPage()`. SA commented the call out and got 114/114 green
   * (F-1). v2 stripped comments and matched the call as a shape — and QA then
   * disabled the guard two more ways that still passed 115/115 (DEF-S2-1,
   * DEF-S2-2):
   *
   *   try { await requireAdminPage(); } catch {}        // redirect swallowed
   *   if (…) return <AdminChrome>{children}</AdminChrome>;  // guard bypassed
   *   await requireAdminPage();
   *
   * The first is the hazard `app/admin/layout.tsx` names in its OWN comment —
   * `requireAdminPage` redirects by THROWING, so a bare `catch` renders the
   * admin shell to a non-admin — and the second is OI-20's "the guard proves
   * present, not first" landing in the file where the guard actually lives.
   *
   * So the property asserted is no longer "the call exists somewhere" but
   * **the call is the FIRST statement of the component body**. That single
   * property subsumes all four known mutations: deleted, commented out,
   * wrapped in try/catch (the first statement becomes the `try`), and preceded
   * by an early return. `firstStatementOfAdminLayout` is exercised against
   * every one of them below, so the rule is proved on synthetic sources rather
   * than only on today's clean file.
   */
  const GUARD_CALL = /await\s+requireAdminPage\s*\(\s*\)/;

  /**
   * The first statement of `AdminLayout`'s body, comments stripped.
   *
   * Returns `null` when the signature cannot be found at all, which is itself
   * a failure — a silent `''` would make this assertion vacuous, which is the
   * exact defect class it exists to close.
   */
  function firstStatementOfAdminLayout(source: string): string | null {
    const code = codeOf(source);
    const opener = /export default async function AdminLayout\s*\([\s\S]*?\)\s*\{/.exec(code);
    if (!opener) return null;
    const body = code.slice(opener.index + opener[0].length).trim();
    // Statement-terminated by `;`, or by `{` for a block opener like `try {`
    // — which is precisely how a swallowed guard is caught.
    const end = Math.min(
      ...[body.indexOf(';'), body.indexOf('{')].filter((index) => index >= 0).concat([body.length])
    );
    return body.slice(0, end).trim();
  }

  it('the guard is the FIRST statement of the layout body', () => {
    expect(firstStatementOfAdminLayout(read('app/admin/layout.tsx'))).toMatch(GUARD_CALL);
  });

  it('the layout does not wrap the guard in a try/catch, which would swallow the redirect', () => {
    // Stated as its own assertion as well, because the failure message should
    // name the hazard the layout's own comment names.
    expect(codeOf(read('app/admin/layout.tsx'))).not.toMatch(/try\s*\{[\s\S]*?requireAdminPage/);
  });

  /**
   * Every way we know of to disable the guard, as synthetic layouts. A rule is
   * only proved by the inputs it must REJECT.
   */
  const DISABLED_LAYOUTS: ReadonlyArray<{ name: string; body: string }> = [
    { name: 'deleted', body: '  return <AdminChrome>{children}</AdminChrome>;' },
    {
      name: 'commented out',
      body:
        '  // TEMPORARILY DISABLED FOR DEBUGGING: await requireAdminPage();\n' +
        '  return <AdminChrome>{children}</AdminChrome>;',
    },
    {
      name: 'block-commented out',
      body: '  /* await requireAdminPage(); */\n  return <AdminChrome>{children}</AdminChrome>;',
    },
    {
      name: 'wrapped in try/catch (redirect swallowed)',
      body:
        '  try { await requireAdminPage(); } catch {}\n' +
        '  return <AdminChrome>{children}</AdminChrome>;',
    },
    {
      name: 'preceded by an early return (guard bypassed)',
      body:
        "  if (process.env.NODE_ENV === 'development') return <AdminChrome>{children}</AdminChrome>;\n" +
        '  await requireAdminPage();\n' +
        '  return <AdminChrome>{children}</AdminChrome>;',
    },
  ];

  const layoutWith = (body: string) =>
    `import { requireAdminPage } from '@/lib/admin/requireAdminPage';\n\n` +
    `export default async function AdminLayout({\n  children,\n}: {\n  children: React.ReactNode;\n}) {\n${body}\n}\n`;

  it.each(DISABLED_LAYOUTS.map((variant) => [variant.name, variant.body] as const))(
    'a guard that is %s fails the first-statement assertion',
    (_name, body) => {
      const first = firstStatementOfAdminLayout(layoutWith(body));
      expect({ first, guarded: first !== null && GUARD_CALL.test(first) }).toEqual({
        first,
        guarded: false,
      });
    }
  );

  it('a real guard passes, and an unrecognisable signature fails rather than passing vacuously', () => {
    expect(firstStatementOfAdminLayout(layoutWith('  await requireAdminPage();'))).toMatch(
      GUARD_CALL
    );
    expect(firstStatementOfAdminLayout('export default function Something() {}')).toBeNull();
  });

  it('the import alone never satisfies the rule', () => {
    const importOnly = layoutWith('  return <AdminChrome>{children}</AdminChrome>;');
    expect(importOnly).toContain('requireAdminPage');
    expect(firstStatementOfAdminLayout(importOnly)).not.toMatch(GUARD_CALL);
  });
});

describe('S2-T8 (source half): the warning cannot be dismissed', () => {
  const notice = read(`${ROOT}/components/FailOpenNotice.tsx`);

  it('FailOpenNotice has no dismiss affordance at all', () => {
    const code = codeOf(notice);
    expect(code).not.toMatch(/onClose|onDismiss|dismiss|useState|localStorage|sessionStorage/i);
  });
});
