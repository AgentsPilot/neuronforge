/**
 * The settings page's deep links (settings drawer review C-2, C-3, C-11; S-1
 * workplan, SA W-1, W-3, W-6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * `?section=timezone` is how the publish gate's "Set your timezone" fix lands
 * an owner on the picker (`journeyGapFix.ts`, href pinned by
 * `journeyReadiness.test.ts`). Nothing pinned the RECEIVING end: the anchor id
 * and the branch that scrolls to it. Moving rows into drawers is exactly the
 * kind of change that drops one of them silently, so this pins both (C-2).
 *
 * It also pins the plan branch S-1 changed: `?section=plan` opens the drawer,
 * marks it link-opened every time (W-3), and closing takes only `section` off
 * the address with a non-scrolling `replace` (C-3), never touching `checkout`
 * (C-11).
 *
 * Every positive pin runs on comment-stripped source, so a commented-out branch
 * cannot satisfy it (W-6). The anchor id is JSX, so it may be read raw.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SETTINGS = 'app/business-os/settings/page.tsx';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const raw = read(SETTINGS);
const code = stripComments(raw);

/** `if (requested === 'timezone') { … scrollToSection('timezone') … }`, within one block. */
const TIMEZONE_BRANCH = /if\s*\(\s*requested\s*===\s*'timezone'\s*\)\s*\{[^}]*scrollToSection\(\s*'timezone'\s*\)[^}]*\}/;

/** The non-scrolling replace (SA W-1: tolerates the nested call before `{ scroll: false }`). */
const REPLACE_NO_SCROLL = /router\.replace\([\s\S]*?,\s*\{\s*scroll:\s*false\s*\}\s*\)/;

/** The body of the `if (requested === 'plan') { … }` block, or null. */
function planBranchOf(source: string): string | null {
  const match = source.match(/if\s*\(\s*requested\s*===\s*'plan'\s*\)\s*\{([^}]*)\}/);
  return match ? match[1] : null;
}

/** The body of `handlePlanDrawerChange`, up to the first line closing it. */
function closeHandlerOf(source: string): string {
  const start = source.indexOf('const handlePlanDrawerChange');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n  };', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the stripping is real', () => {
  it('removes comments, so the explanations cannot satisfy a pin', () => {
    expect(raw).toContain('Opening from the row never');
    expect(code).not.toContain('Opening from the row never');
  });
});

describe('C-2: ?section=timezone still lands on the picker', () => {
  it('the anchor id is on the page', () => {
    expect(raw).toContain('id="settings-section-timezone"');
  });

  it('the timezone branch scrolls to it', () => {
    expect(code).toMatch(TIMEZONE_BRANCH);
  });

  describe('negative controls: the matcher is not vacuous', () => {
    it('fails on a snippet with the anchor but no timezone branch', () => {
      const snippet = `
        <div id="settings-section-timezone" />
        if (requested === 'password') { setExpandedSection(requested); }
      `;
      expect(stripComments(snippet)).not.toMatch(TIMEZONE_BRANCH);
    });

    it('fails when the branch exists but the scroll sits in another block', () => {
      const snippet = `
        <div id="settings-section-timezone" />
        if (requested === 'timezone') { return; }
        if (other) { scrollToSection('timezone'); }
      `;
      expect(stripComments(snippet)).not.toMatch(TIMEZONE_BRANCH);
    });

    it('fails when the branch is only in a comment', () => {
      const snippet = `
        <div id="settings-section-timezone" />
        /* if (requested === 'timezone') { scrollToSection('timezone'); } */
        // if (requested === 'timezone') { scrollToSection('timezone'); }
      `;
      expect(snippet).toMatch(TIMEZONE_BRANCH);
      expect(stripComments(snippet)).not.toMatch(TIMEZONE_BRANCH);
    });
  });
});

describe('C-2: the configuration-window links are unchanged', () => {
  it('?section=business and ?section=invoice open the configuration window', () => {
    expect(code).toMatch(
      /if\s*\(\s*requested\s*===\s*'business'\s*\|\|\s*requested\s*===\s*'invoice'\s*\)\s*\{\s*openConfiguration\(requested\);\s*return;\s*\}/
    );
  });
});

describe('C-2 / W-3: ?section=plan opens the plan drawer', () => {
  it('the plan branch marks the drawer link-opened, then opens it', () => {
    const branch = planBranchOf(code);
    expect(branch).not.toBeNull();
    const flag = (branch as string).indexOf('planOpenedByLink.current = true');
    const open = (branch as string).indexOf('setPlanDrawerOpen(true)');
    expect(flag).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(flag);
  });

  it('marks it every time, with no condition on the current open state (SA Q-2)', () => {
    const branch = planBranchOf(code) as string;
    expect(branch).not.toMatch(/\bif\s*\(/);
    expect(branch).not.toContain('planDrawerOpen');
    // Nothing outside the branch guards it either.
    expect(code).not.toMatch(/if\s*\(\s*!\s*planDrawerOpen\s*\)/);
  });

  it('nothing expands a plan row any more', () => {
    expect(code).not.toContain("setExpandedSection('plan')");
    expect(code).not.toContain("expandedSection === 'plan'");
    expect(code).not.toMatch(/requested\s*!==\s*'plan'/);
  });

  it('the plan row is a dialog opener (C-10)', () => {
    const row = code.slice(code.indexOf('ref={planRowRef}'), code.indexOf('</button>', code.indexOf('ref={planRowRef}')));
    expect(row).toContain('aria-haspopup="dialog"');
    expect(row).toContain('onClick={() => setPlanDrawerOpen(true)}');
  });
});

describe('C-3 / C-11: closing a link-opened drawer', () => {
  it('replaces the address without scrolling, through the section-only helper', () => {
    const handler = closeHandlerOf(code);
    expect(handler).toMatch(REPLACE_NO_SCROLL);
    expect(handler).toContain('settingsUrlWithoutSection(pathname, searchParams)');
  });

  it('only when the link opened it, and clears the flag once used', () => {
    const handler = closeHandlerOf(code);
    const gate = handler.indexOf('if (next || !planOpenedByLink.current) return;');
    const clear = handler.indexOf('planOpenedByLink.current = false');
    const replace = handler.indexOf('router.replace(');
    expect(gate).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(gate);
    expect(replace).toBeGreaterThan(clear);
  });

  it('the page never pushes, never writes `checkout`, never hand-edits history', () => {
    expect(code).not.toMatch(/router\.push\(/);
    expect(code).not.toMatch(/\.set\(\s*'checkout'/);
    expect(code).not.toMatch(/\.delete\(\s*'checkout'/);
    expect(code).not.toContain('window.history');
  });

  it('the replace matcher is not vacuous', () => {
    expect("router.replace(settingsUrlWithoutSection(pathname, searchParams), { scroll: false });").toMatch(
      REPLACE_NO_SCROLL
    );
    expect('router.replace(settingsUrlWithoutSection(pathname, searchParams));').not.toMatch(REPLACE_NO_SCROLL);
  });
});
