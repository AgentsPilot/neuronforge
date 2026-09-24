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

import {
  ADMIN_LAYOUT_GUARD_FAILURE,
  ADMIN_LAYOUT_UNPARSEABLE,
  adminLayoutGuardVerdict,
  adminLayoutWith,
  DISABLED_ADMIN_LAYOUTS,
  GUARDED_ADMIN_LAYOUTS,
  NOT_A_COMPONENT,
} from '@/tests/helpers/admin-page-guard';
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
   * The one guard over all 22 `/admin` pages.
   *
   * ── The assertion moved OUT of this file ─────────────────────────────────
   * It now lives in `tests/helpers/admin-page-guard.ts` and is shared with
   * rule R6 of `lib/admin/__tests__/admin-authz-surface.guard.test.ts` — the
   * REQUIRED `Admin authz surface guard` check.
   *
   * Why that mattered enough to move it: R6 asserted only
   * `toContain('requireAdminPage')`, which the IMPORT LINE satisfies, so the
   * gate that blocks every merge in the repo passed with the call deleted (F-2,
   * reproduced by SA four times) while THIS suite — which no CI gate runs —
   * held the real property. Two copies of one security assertion, and the
   * weaker copy was the one with authority.
   *
   * The shared module also closes the three shapes SA found still satisfying
   * the v3 rule (`&&`, the ternary, a locally shadowed no-op). Its header
   * carries the full history and SA's standing ruling that the durable fix is
   * behavioural rather than textual.
   */

  it('the guard is the FIRST statement of the layout body', () => {
    const verdict = adminLayoutGuardVerdict(read('app/admin/layout.tsx'), codeOf);
    expect({
      ...verdict,
      ifGenuinelyUnguarded: ADMIN_LAYOUT_GUARD_FAILURE,
      ifParsedIsFalse: ADMIN_LAYOUT_UNPARSEABLE,
    }).toEqual({
      // Echoed on BOTH sides, so it PRINTS on failure without being
      // CONSTRAINED. Pinning the literal text rejected the correct
      // `const admin = await requireAdminPage();` and
      // `const { id } = await requireAdminPage();` on the real file --
      // the same false-positive class SA found three of. The property is
      // the verdict, not the spelling.
      firstStatement: verdict.firstStatement,
      parsed: true,
      firstStatementIsTheGuard: true,
      importsCanonicalGuard: true,
      shadowsTheGuard: false,
      guarded: true,
      ifGenuinelyUnguarded: ADMIN_LAYOUT_GUARD_FAILURE,
      ifParsedIsFalse: ADMIN_LAYOUT_UNPARSEABLE,
    });
  });

  it('the layout does not wrap the guard in a try/catch, which would swallow the redirect', () => {
    // Stated as its own assertion as well, because the failure message should
    // name the hazard the layout's own comment names.
    expect(codeOf(read('app/admin/layout.tsx'))).not.toMatch(/try\s*\{[\s\S]*?requireAdminPage/);
  });

  /*
   * Every way we know of to disable the guard, as synthetic layouts. A rule is
   * only proved by the inputs it must REJECT — and, just as importantly, by the
   * correct inputs it must ACCEPT, because a rule that rejects a legitimate
   * edit is how a required check gets switched off.
   *
   * Both tables are run HERE and again in the surface guard. That is not the
   * duplication the extraction removed: the duplicated thing was the RULE, and
   * there is now one of those. Running the same fixtures in both suites is what
   * proves the two callers agree.
   */
  it.each(DISABLED_ADMIN_LAYOUTS.map((v) => [v.name, v] as const))(
    'a guard that is %s fails the assertion',
    (_name, variant) => {
      const verdict = adminLayoutGuardVerdict(variant.source, codeOf);
      expect({ name: variant.name, guarded: verdict.guarded }).toEqual({
        name: variant.name,
        guarded: false,
      });
      // The named part must be the one that catches it, so a rule cannot go
      // dead behind another rule that happens to cover the same fixture.
      expect({ name: variant.name, caught: verdict[variant.caughtBy] }).toEqual({
        name: variant.name,
        // `shadowsTheGuard` is the one sub-rule whose TRUE value is the
        // violation; the others report the property that must hold.
        caught: variant.caughtBy === 'shadowsTheGuard',
      });
    }
  );

  it.each(GUARDED_ADMIN_LAYOUTS.map((v) => [v.name, v.source] as const))(
    'a correctly guarded layout (%s) passes',
    (_name, source) => {
      expect(adminLayoutGuardVerdict(source, codeOf).guarded).toBe(true);
    }
  );

  it('a file with no default-exported component fails closed rather than vacuously', () => {
    // The parser is name-agnostic now (pinning the component's NAME is what made
    // three legitimate shapes report null), so the vacuity case is "no default
    // export at all" rather than "not called AdminLayout".
    const verdict = adminLayoutGuardVerdict(NOT_A_COMPONENT, codeOf);
    expect({ parsed: verdict.parsed, first: verdict.firstStatement, guarded: verdict.guarded }).toEqual(
      { parsed: false, first: null, guarded: false }
    );
  });

  it('the import alone never satisfies the rule', () => {
    const importOnly = adminLayoutWith('  return <AdminChrome>{children}</AdminChrome>;');
    expect(importOnly).toContain('requireAdminPage');
    expect(adminLayoutGuardVerdict(importOnly, codeOf).guarded).toBe(false);
  });
});

describe('S2-T8 (source half): the warning cannot be dismissed', () => {
  const notice = read(`${ROOT}/components/FailOpenNotice.tsx`);

  it('FailOpenNotice has no dismiss affordance at all', () => {
    const code = codeOf(notice);
    expect(code).not.toMatch(/onClose|onDismiss|dismiss|useState|localStorage|sessionStorage/i);
  });
});
