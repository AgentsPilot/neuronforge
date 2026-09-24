/**
 * The two properties of this screen that no rendering test can reach.
 *
 *   1. **It imports nothing from the entitlements module.** The page is a
 *      client component; anything it could import, it could also re-derive
 *      from — and each re-derivation is a second copy of a rule that already
 *      exists in the resolver, free to drift from it. The payload is the only
 *      channel, and this is what keeps it that way.
 *   2. **It adds no guard of its own, and offers no lesser view.** Protection
 *      comes from `app/admin/layout.tsx`, which a page cannot skip. A second
 *      check here would read as though the first were optional.
 *
 * Modelled on `app/admin/business-os-llm/__tests__/source.guard.test.ts`, which
 * learned most of this the hard way.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = 'app/admin/business-os-tiers';

/** Every non-test source file of the screen, WALKED rather than listed. */
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

/** Source with comments removed, so prose about a rule cannot satisfy it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the screen holds no server module and no rule of its own', () => {
  it('finds the page and its components, so the scan cannot fall behind the code', () => {
    expect(allFiles).toContain(`${ROOT}/page.tsx`);
    expect(allFiles).toContain(`${ROOT}/components/EnforcementBanner.tsx`);
    expect(allFiles).toContain(`${ROOT}/types.ts`);
    expect(allFiles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(allFiles)('%s imports nothing from outside the screen', (relative) => {
    // Not a list of forbidden modules but a blanket rule, because the hazard is
    // not any particular import — it is the screen having a second source of
    // truth at all. `adminPlansView` is `server-only`, so importing it would
    // fail the build; everything else in the module would merely be wrong.
    //
    // SA R-3: aliased imports are not the only way out. `../../../lib/...`
    // reaches exactly the same module and would have walked past a rule that
    // only knew about `@/lib/`. So the test is on where the specifier RESOLVES,
    // which covers both spellings and anything invented later.
    const imports = [...codeOf(read(relative)).matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    );

    const escaping = imports.filter((specifier) => {
      if (specifier.startsWith('@/')) return !specifier.startsWith(`@/${ROOT}`);
      if (!specifier.startsWith('.')) return false; // a package, not our code
      const resolved = path
        .normalize(path.join(path.dirname(relative), specifier))
        .split(path.sep)
        .join('/');
      return !resolved.startsWith(ROOT);
    });

    expect({ file: relative, escaping }).toEqual({ file: relative, escaping: [] });
  });

  it('the relative-import rule would actually catch one', () => {
    // The negative control. Without it this reads as "no file happens to have a
    // relative import", which is a different and much weaker statement.
    const resolve = (from: string, specifier: string) =>
      path.normalize(path.join(path.dirname(from), specifier)).split(path.sep).join('/');

    expect(resolve(`${ROOT}/page.tsx`, '../../../lib/business-os/entitlements/source')).toBe(
      'lib/business-os/entitlements/source'
    );
    expect(resolve(`${ROOT}/page.tsx`, '../../../lib/business-os/entitlements/source').startsWith(ROOT)).toBe(
      false
    );
    // …and does not flag the screen's own files.
    expect(resolve(`${ROOT}/page.tsx`, './components/PlanCard').startsWith(ROOT)).toBe(true);
    expect(resolve(`${ROOT}/components/PlanCard.tsx`, '../types').startsWith(ROOT)).toBe(true);
  });

  it.each(allFiles)('%s writes down no plan id, price or capability id', (relative) => {
    // The numbers belong to the config. A price or a plan name in the bundle is
    // a value that can disagree with the matrix — which is the whole failure
    // this screen exists to make impossible.
    const code = codeOf(read(relative));

    expect(code).not.toMatch(/\bEssentials\b|\bAutopilot\b|\bTest Flight\b|\bFounding Partner\b/);
    expect(code).not.toMatch(/\$\s?(79|129)\b/);
    expect(code).not.toMatch(/['"](basic|pro|trial|champion)['"]/);
    expect(code).not.toMatch(/['"]chat\.|['"]crm\.|['"]ai\.actions['"]/);
  });

  it.each(allFiles)('%s logs through nothing — no console.* on a page either', (relative) => {
    expect(read(relative)).not.toMatch(/console\.(log|warn|error|info|debug)\s*\(/);
  });

  it.each(allFiles)('%s uses no `any`', (relative) => {
    expect(codeOf(read(relative))).not.toMatch(/:\s*any\b/);
  });
});

describe('the guard and the read-only posture', () => {
  const pageCode = codeOf(read(`${ROOT}/page.tsx`));

  it('does not re-implement the layout guard', () => {
    expect(pageCode).not.toMatch(/requireAdminPage|requireAdmin\b/);
  });

  it('never decides who is an admin', () => {
    expect(pageCode).not.toMatch(/AdminAccessService|profiles\.role|app_metadata|isAdmin/);
  });

  it('the layout that protects it still awaits the guard as its FIRST statement', () => {
    // Asserted here as well as in the sibling's suite, because this page is one
    // of the things that guarantee protects, and a page author should be able
    // to see the guarantee from their own screen's tests.
    const layout = codeOf(read('app/admin/layout.tsx'));
    const opener = /export default async function AdminLayout\s*\([\s\S]*?\)\s*\{/.exec(layout);
    expect(opener).not.toBeNull();

    const body = layout.slice((opener?.index ?? 0) + (opener?.[0].length ?? 0)).trim();
    const end = Math.min(
      ...[body.indexOf(';'), body.indexOf('{')].filter((index) => index >= 0).concat([body.length])
    );

    expect(body.slice(0, end).trim()).toMatch(/await\s+requireAdminPage\s*\(\s*\)/);
  });

  it.each(allFiles)('%s sends no request that writes', (relative) => {
    // v1 is read-only. The only network calls are GETs; a method option on a
    // fetch here would be the first write, and it should be a reviewable event.
    const code = codeOf(read(relative));
    expect(code).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
  });
});
