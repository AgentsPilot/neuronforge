/**
 * The properties of this screen that no rendering test can reach, and that
 * neither CI gate can see.
 *
 * `check:bos-llm-literals` and `typecheck:bos-llm` both scope themselves to
 * files that import the call catalog. This page imports NOTHING from it, by
 * design (FR-6) — which is exactly why it is invisible to them, and why the
 * source scan below is the only enforcement that exists. `next.config.js` sets
 * `ignoreBuildErrors`, so the type system gates nothing here either.
 *
 * ── Every rule here is proved against an input it must REJECT ────────────
 * This file's own history is the reason (F-1, QA DEF-S2-1/2, and the two dead
 * regexes in `bos-llm-literal-rules.ts` that compiled to something that could
 * never match). **A rule that cannot match looks exactly like a rule that
 * found nothing.** So each rule below carries a sample it is asserted to match,
 * or a synthetic source it is asserted to reject.
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
import { codeOf, flattened, LITERAL_RULES } from '@/tests/helpers/bos-llm-literal-rules';

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

/*
 * `flattened()` (CR-1) is imported, not written here.
 *
 * Two rules below match a phrase or a list a developer would naturally WRAP.
 * `copy.ts` — the very file the propagation clause lives in — authors every
 * multi-clause string as `'…' + '…'` across two lines (`PAGE_STANDING_NOTE`,
 * `AREA_OFF_CAVEAT`, `CALL_OFF_TITLE`, `READ_ONLY_NOTE`, `PROPAGATION_NOTE`),
 * and prettier wraps a long array literal the same way. A raw scan sees
 * neither: the mutation that re-typed the clause across two concatenated
 * literals SURVIVED, and only a single-line re-type turned it red.
 *
 * Both rules are proved on the wrapped forms below — including an assertion
 * that the wrapped form escapes WITHOUT the normalisation, which is what stops
 * it being deleted later as decoration.
 */

describe('S2-T2: the screen holds no server module and no setting of its own', () => {
  it('finds the page and its components, so the scan cannot fall behind the code', () => {
    expect(allFiles).toContain(`${ROOT}/page.tsx`);
    expect(allFiles).toContain(`${ROOT}/components/AreaCard.tsx`);
    expect(allFiles).toContain(`${ROOT}/markers.ts`);
    expect(allFiles.length).toBeGreaterThanOrEqual(8);
  });

  /**
   * The modules FR-6 names. Importing any of them would put the guardrails, the
   * locks or the catalogue itself in the browser bundle — where they would be a
   * SECOND answer to every question the payload already answers, free to drift
   * from the resolver's.
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

/**
 * R-T17 / AC-8 / FR-13 — a provider NAME in a screen file.
 *
 * `tests/helpers/bos-llm-literal-rules.ts` has five rules and not one of them
 * matches a provider name, so `provider !== 'openai'` would have passed this
 * scan silently — and that is the exact line FR-8 forbids: the `varies by call`
 * fallback must compare the payload's values to EACH OTHER (`size > 1`), never
 * to a literal, or the per-call provider field never comes back on the day a
 * second provider is allowed.
 *
 * Deliberately NOT added to the shared `LITERAL_RULES`: `route.test.ts` consumes
 * those over server files, where a provider name is legitimate.
 */
describe('R-T17 / AC-8 / FR-13: no quoted provider name in a screen file', () => {
  const PROVIDER_LITERAL_RULE = {
    name: 'a quoted provider name in a screen file',
    pattern: /['"](openai|anthropic|groq|mistral|kimi|google|azure)['"]/i,
    mustMatch: `if (provider !== 'openai') {`,
  };

  it('the rule matches the line it exists to catch (no dead regex)', () => {
    expect(PROVIDER_LITERAL_RULE.pattern.test(PROVIDER_LITERAL_RULE.mustMatch)).toBe(true);
  });

  it.each(allFiles)('%s names no provider', (relative) => {
    const code = codeOf(read(relative));
    expect({ file: relative, matched: PROVIDER_LITERAL_RULE.pattern.test(code) }).toEqual({
      file: relative,
      matched: false,
    });
  });

  it('prose about a provider in a comment is not a violation', () => {
    const commented = `// the provider is 'openai' today\nconst x = 1;\n`;
    expect(PROVIDER_LITERAL_RULE.pattern.test(codeOf(commented))).toBe(false);
  });
});

/**
 * R-T2 (source half) / RC-9 — the R-C fix is DERIVED, not duplicated.
 *
 * `CallRow` used to render four named fields and filter its catch-all against a
 * second hand-written copy of those names. It now takes one list from
 * `renderedFieldsFor()` and uses it for both jobs in one scope, so the field
 * and its issues can only appear or disappear together.
 *
 * Two properties, and neither is asserted only against today's clean file:
 *   1. the catch-all references the SAME binding the render maps over;
 *   2. `CallRow.tsx` contains no array literal of field names at all — proved
 *      below against a planted violation, because this file's own history is
 *      full of rules that could not match.
 */
describe('R-T2 (source half) / RC-9: one list, used twice', () => {
  const callRow = codeOf(read(`${ROOT}/components/CallRow.tsx`));
  /** CR-1: a wrapped array literal is invisible to the rule otherwise. */
  const callRowFlat = flattened(callRow);

  const FIELD_LIST_RULE = {
    name: 'an array literal of field names',
    pattern: /\[[^\]\n]*['"](enabled|provider|model|temperature)['"]/,
    mustMatch: `const f = ['enabled', 'provider', 'model', 'temperature'];`,
    /** CR-1: the same list as prettier would leave it, over four lines. */
    mustMatchWrapped: "const f = [\n  'enabled',\n  'provider',\n  'model',\n  'temperature',\n];",
  };

  it('the rule matches a planted violation, so a clean file means something', () => {
    expect(FIELD_LIST_RULE.pattern.test(FIELD_LIST_RULE.mustMatch)).toBe(true);
    // The narrowed form the R-C ruling explicitly forbids, too.
    expect(FIELD_LIST_RULE.pattern.test(`const rendered = ['model', 'temperature'];`)).toBe(true);
    // And the shape that would sneak it back in beside the constant.
    expect(FIELD_LIST_RULE.pattern.test(`[...MARKED_FIELDS, 'provider']`)).toBe(true);
  });

  /**
   * CR-1. The rule's `[^\]\n]*` cannot cross a newline, so the WRAPPED list —
   * the form a formatter produces on its own — walked straight past it. The
   * normalisation is what closes that, and this asserts both halves so that
   * deleting `flattened()` turns a test red rather than silently re-opening
   * the hole.
   */
  it('a WRAPPED array literal is caught only because the source is flattened first', () => {
    expect(FIELD_LIST_RULE.pattern.test(FIELD_LIST_RULE.mustMatchWrapped)).toBe(false);
    expect(FIELD_LIST_RULE.pattern.test(flattened(FIELD_LIST_RULE.mustMatchWrapped))).toBe(true);
  });

  it('CallRow.tsx holds no array literal of field names, wrapped or not', () => {
    expect(FIELD_LIST_RULE.pattern.test(callRow)).toBe(false);
    expect(FIELD_LIST_RULE.pattern.test(callRowFlat)).toBe(false);
  });

  it('the catch-all is derived from the rendered-field list, in the same scope', () => {
    expect(callRow).toMatch(/const renderedFields = renderedFieldsFor\(/);
    const catchAll = /const otherIssues =[\s\S]{0,240}?;/.exec(callRow)?.[0] ?? '';
    expect(catchAll).toContain('renderedFields');
    expect(callRow).toMatch(/renderedFields\.map\(/);
  });

  it('the one list lives in markers.ts and documents the provider exception', () => {
    const markers = read(`${ROOT}/markers.ts`);
    expect(markers).toContain('export const MARKED_FIELDS');
    expect(markers).toContain('UNMARKED_RENDERED_FIELD');
    // AC-6: `provider` is rendered but must NEVER be marked, so it is not in
    // the marked set — and the constant says so, for the next person who adds
    // a rendered-but-unmarkable field.
    const markedLiteral =
      /export const MARKED_FIELDS = \[[^\]]*\]/.exec(codeOf(markers))?.[0] ?? '';
    expect(markedLiteral).not.toBe('');
    expect(markedLiteral).not.toMatch(/provider|enabled/);
    // Wrapped across lines in the doc block, so the gap is tolerant.
    expect(markers).toMatch(/never take a[\s*]+marker/i);
  });
});

/**
 * R-T1 / R-T3 / AC-1 / AC-3 / AC-17 — the strings that must not come back.
 *
 * A render test proves they are not on screen today. These prove they are not
 * in the tree at all, which is what stops the next edit re-mounting one.
 */
describe('R-T1 / R-T3 / AC-17 (source half): the deleted copy is gone', () => {
  const screenSource = allFiles.map(read).join('\n');
  /**
   * Comments stripped for the PHRASE scans below. A decision record that says
   * "`Configured: on` was dropped, and why" is the OPPOSITE of the defect — it
   * is the thing that stops the next reader adding it back. What must not
   * survive is the phrase as CODE.
   */
  const screenCode = allFiles.map((relative) => codeOf(read(relative))).join('\n');

  it('the FailOpenNotice component no longer exists', () => {
    expect(fs.existsSync(path.join(process.cwd(), `${ROOT}/components/FailOpenNotice.tsx`))).toBe(
      false
    );
    expect(screenSource).not.toContain('FailOpenNotice');
  });

  it.each([
    'FAIL_OPEN_HEADLINE',
    'FAIL_OPEN_BODY',
    'FAIL_OPEN_ACTION',
    'FAIL_OPEN_INLINE',
    'LOCK_AREA_FAIL_OPEN',
    'LOCK_AREA_NOT_SWITCHABLE',
    'LOCK_CALL_NOT_SWITCHABLE',
    'PROVENANCE_LABEL',
    'PROVENANCE_TITLE',
  ])('%s is absent from the screen', (name) => {
    expect({ name, found: screenSource.includes(name) }).toEqual({ name, found: false });
  });

  /** Q-2: neither superseded chip wording may survive. */
  it.each(['with a call override', 'on code defaults', 'Configured: on', 'Cannot be switched off'])(
    '%s appears nowhere in the screen',
    (phrase) => {
      expect({ phrase, found: screenCode.includes(phrase) }).toEqual({ phrase, found: false });
    }
  );

  /**
   * R-D: the propagation clause has ONE source. A second inline copy is how the
   * header and the (parked) panel drift the day slice 3 re-mounts it.
   *
   * ── CR-1: this rule is why `flattened()` exists ──────────────────────────
   * It used to scan the raw source, so it saw a single-line re-type and missed
   * a wrapped one — and wrapped is how `copy.ts` writes every string of this
   * length. It was also the only rule in this file carrying neither a
   * `mustMatch` sample nor a planted rejection, which is exactly the shape
   * this file's header warns about: a rule that cannot match reads identically
   * to a rule that found nothing.
   */
  const PROPAGATION_RULE = {
    name: 'the propagation clause, re-typed rather than composed',
    pattern: /pick a change up within about 60 seconds/,
    mustMatch: [
      // The single-line re-type: the only form the rule caught before CR-1.
      `const note = 'Running instances pick a change up within about 60 seconds.';`,
      // Wrapped across two concatenated literals — `copy.ts`'s own house style.
      "const note =\n  'Running instances pick a change up within about 60 ' +\n" +
        "  'seconds, and one that cannot read them on startup falls back.';",
      // Wrapped inside one template literal, which has no seam to strip.
      'const note = `Running instances pick a change up\n  within about 60 seconds`;',
    ],
  };

  const countClause = (source: string) =>
    (flattened(source).match(new RegExp(PROPAGATION_RULE.pattern.source, 'g')) ?? []).length;

  it('the rule matches every shape of re-type, wrapped included (no dead regex)', () => {
    for (const sample of PROPAGATION_RULE.mustMatch) {
      expect({ sample, caught: countClause(sample) }).toEqual({ sample, caught: 1 });
    }
  });

  it('the two WRAPPED re-types escape without the normalisation, which is why it is there', () => {
    for (const sample of PROPAGATION_RULE.mustMatch.slice(1)) {
      // Raw — invisible. This is the mutation that survived (M5, first run).
      expect(PROPAGATION_RULE.pattern.test(sample)).toBe(false);
      expect(PROPAGATION_RULE.pattern.test(flattened(sample))).toBe(true);
    }
  });

  it('the propagation clause is composed, never re-typed', () => {
    const copy = read(`${ROOT}/copy.ts`);
    expect(copy).toContain('const PROPAGATION_CLAUSE =');
    // Not exported: a third caller would be a third wording.
    expect(copy).not.toContain('export const PROPAGATION_CLAUSE');
    for (const relative of allFiles) {
      expect({ file: relative, occurrences: countClause(read(relative)) }).toEqual({
        file: relative,
        occurrences: relative.endsWith('copy.ts') ? 1 : 0,
      });
    }
  });
});

/**
 * R-T4 / AC-4 — parked means built, tested, not mounted.
 *
 * The next dead-code sweep reads the ROUTE, not the requirement, so the
 * declaration has to be in the route's own header (C-8 condition).
 */
describe('R-T4 / AC-4 (source half): the ledger check is parked, not deleted', () => {
  it('AreaCard neither renders nor imports the panel, and says why it does not', () => {
    const areaCard = read(`${ROOT}/components/AreaCard.tsx`);
    expect(codeOf(areaCard)).not.toContain('LedgerCheckPanel');
    // The comment survives `codeOf`'s stripping only in the raw source.
    expect(areaCard).toContain('PARKED 2026-09-24');
    // Wrapped across lines in the comment block, so asserted in two halves.
    expect(areaCard).toMatch(/Re-mounting is ONE import/i);
    expect(areaCard).toMatch(/plus ONE line/i);
    // R-D: the obligation that slice 3 must not then render it twice.
    expect(areaCard).toContain('PROPAGATION_CLAUSE');
  });

  it('the component, its copy module, the route and their tests all still exist', () => {
    for (const relative of [
      `${ROOT}/components/LedgerCheckPanel.tsx`,
      `${ROOT}/__tests__/ledgerPanel.render.test.tsx`,
      'lib/business-os/llm/ledgerCheckCopy.ts',
      'app/api/admin/business-os/llm-settings/ledger/route.ts',
      'app/api/admin/business-os/llm-settings/__tests__/ledger.route.test.ts',
    ]) {
      expect({ relative, exists: fs.existsSync(path.join(process.cwd(), relative)) }).toEqual({
        relative,
        exists: true,
      });
    }
  });

  it('the panel says it is parked, and the route says it is not dead code', () => {
    expect(read(`${ROOT}/components/LedgerCheckPanel.tsx`)).toMatch(/PARKED 2026-09-24/);
    const route = read('app/api/admin/business-os/llm-settings/ledger/route.ts');
    expect(route).toMatch(/NOT DEAD CODE/);
    expect(route).toMatch(/Slice 3 is this route's caller/);
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
