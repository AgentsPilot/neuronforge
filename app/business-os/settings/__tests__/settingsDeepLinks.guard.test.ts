/**
 * The settings page's deep links (settings drawer review C-2, C-3, C-7, C-11;
 * S-1 workplan, SA W-1, W-3, W-6; S-2 workplan).
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
 * It also pins the branches the drawer slices changed: `?section=plan` (S-1)
 * and `?section=password` (S-2) open their drawers through
 * `useLinkOpenedDrawer`, which marks them link-opened every time (W-3), and
 * closing takes only `section` off the address with a non-scrolling `replace`
 * (C-3), never touching `checkout` (C-11). The hook's behaviour has its own
 * unit test; this pins that the page uses it and that the hook keeps the rules.
 *
 * Every positive pin runs on comment-stripped source, so a commented-out branch
 * cannot satisfy it (W-6). The anchor id is JSX, so it may be read raw.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SETTINGS = 'app/business-os/settings/page.tsx';
const HOOK = 'components/business-os/settings/useLinkOpenedDrawer.ts';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const raw = read(SETTINGS);
const code = stripComments(raw);
const hook = stripComments(read(HOOK));

/** `if (requested === 'timezone') { … scrollToSection('timezone') … }`, within one block. */
const TIMEZONE_BRANCH = /if\s*\(\s*requested\s*===\s*'timezone'\s*\)\s*\{[^}]*scrollToSection\(\s*'timezone'\s*\)[^}]*\}/;

/** The non-scrolling replace (SA W-1: tolerates the nested call before `{ scroll: false }`). */
const REPLACE_NO_SCROLL = /router\.replace\([\s\S]*?,\s*\{\s*scroll:\s*false\s*\}\s*\)/;

/** `if (requested === 'password') { if (!signsInWithProvider) openPasswordFromLink(); return; }` */
const PASSWORD_BRANCH =
  /if\s*\(\s*requested\s*===\s*'password'\s*\)\s*\{\s*if\s*\(\s*!\s*signsInWithProvider\s*\)\s*openPasswordFromLink\(\);\s*return;\s*\}/;

/** The body of the `if (requested === '<section>') { … }` block, or null. */
function branchOf(source: string, section: string): string | null {
  const match = source.match(new RegExp(`if\\s*\\(\\s*requested\\s*===\\s*'${section}'\\s*\\)\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

/** The source from `marker` up to the first `closer` after it. */
function blockFrom(source: string, marker: string, closer: string): string {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(closer, start + marker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** The row button whose `ref` is `refName`, up to its closing tag. */
function rowOf(source: string, refName: string): string {
  return blockFrom(source, `ref={${refName}}`, '</button>');
}

describe('the stripping is real', () => {
  it('removes comments, so the explanations cannot satisfy a pin', () => {
    expect(raw).toContain('Nothing in the');
    expect(code).not.toContain('Nothing in the');
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

describe('both drawers run on the shared hook (SA S-1 finding 2)', () => {
  it('the page takes one link-opened drawer each for plan and password', () => {
    expect(code).toMatch(/const\s+planDrawer\s*=\s*useLinkOpenedDrawer\(\)/);
    expect(code).toMatch(/const\s+passwordDrawer\s*=\s*useLinkOpenedDrawer\(\)/);
  });

  it('the page keeps no inline copy of the pair, and changes the address nowhere itself', () => {
    expect(code).not.toContain('planOpenedByLink');
    expect(code).not.toContain('handlePlanDrawerChange');
    expect(code).not.toContain('useRouter');
    expect(code).not.toMatch(/router\.(replace|push)\(/);
  });
});

describe('C-2 / W-3: ?section=plan opens the plan drawer', () => {
  it('the plan branch opens it through the link opener, with no condition (SA Q-2)', () => {
    const branch = branchOf(code, 'plan');
    expect(branch).not.toBeNull();
    expect(branch).toContain('openPlanFromLink()');
    expect(branch).not.toMatch(/\bif\s*\(/);
    expect(branch).not.toContain('planDrawer.open');
    expect(code).not.toMatch(/if\s*\(\s*!\s*planDrawer\.open\s*\)/);
  });

  it("openPlanFromLink is the plan drawer's link opener", () => {
    expect(code).toMatch(/const\s*\{\s*openFromLink:\s*openPlanFromLink\s*\}\s*=\s*planDrawer/);
  });

  it('nothing expands a plan row any more', () => {
    expect(code).not.toContain("setExpandedSection('plan')");
    expect(code).not.toContain("expandedSection === 'plan'");
    expect(code).not.toMatch(/requested\s*!==\s*'plan'/);
  });

  it('the plan row is a dialog opener that never writes the address (C-10)', () => {
    const row = rowOf(code, 'planRowRef');
    expect(row).toContain('aria-haspopup="dialog"');
    expect(row).toContain('onClick={planDrawer.openFromRow}');
  });

  it('the plan drawer closes through the hook', () => {
    expect(code).toContain('onOpenChange={planDrawer.onOpenChange}');
  });
});

describe('S-2 / C-7: ?section=password opens the password drawer', () => {
  it('the password branch opens it for an account that has the form, and only then', () => {
    expect(code).toMatch(PASSWORD_BRANCH);
    expect(code).toMatch(/const\s*\{\s*openFromLink:\s*openPasswordFromLink\s*\}\s*=\s*passwordDrawer/);
  });

  it('nothing expands a password row any more', () => {
    expect(code).not.toContain("setExpandedSection('password')");
    expect(code).not.toContain("expandedSection === 'password'");
    expect(code).not.toMatch(/requested\s*!==\s*'password'/);
    expect(code).not.toContain('setExpandedSection(requested)');
  });

  describe('negative controls: the matcher is not vacuous', () => {
    it("fails on S-1's expand-in-place shape", () => {
      const snippet = `
        if (requested !== 'password') return;
        setExpandedSection(requested);
      `;
      expect(stripComments(snippet)).not.toMatch(PASSWORD_BRANCH);
    });

    it('fails when the provider gate is dropped', () => {
      const snippet = `if (requested === 'password') { openPasswordFromLink(); return; }`;
      expect(snippet).not.toMatch(PASSWORD_BRANCH);
    });

    it('fails when the branch is only in a comment', () => {
      const snippet = `// if (requested === 'password') { if (!signsInWithProvider) openPasswordFromLink(); return; }`;
      expect(snippet).toMatch(PASSWORD_BRANCH);
      expect(stripComments(snippet)).not.toMatch(PASSWORD_BRANCH);
    });
  });

  it('the password row is a dialog opener that never writes the address (C-10)', () => {
    const row = rowOf(code, 'passwordRowRef');
    expect(row).toContain('aria-haspopup="dialog"');
    expect(row).toContain('onClick={passwordDrawer.openFromRow}');
  });

  it('the drawer is wired to the hook and returns focus to the row', () => {
    const drawer = blockFrom(code, '<ChangePasswordDrawer', '/>');
    expect(drawer).toContain('open={passwordDrawer.open}');
    expect(drawer).toContain('onOpenChange={passwordDrawer.onOpenChange}');
    expect(drawer).toContain('returnFocusRef={passwordRowRef}');
  });

  it('the page holds no password field, toggle or in-flight state (C-7)', () => {
    expect(code).not.toContain('passwordForm');
    expect(code).not.toContain('setShowPassword');
    expect(code).not.toContain('changingPassword');
    expect(code).not.toContain('handlePasswordChange');
    expect(code).not.toContain('changePassword(');
    expect(code).not.toContain("from '@/lib/client/change-password'");
  });

  it('the provider notice stays inline, and the drawer sits only in the password branch', () => {
    const notice = code.indexOf('{signsInWithProvider ? (');
    const otherwise = code.indexOf(') : (', notice);
    const row = code.indexOf('ref={passwordRowRef}');
    const drawer = code.indexOf('<ChangePasswordDrawer');
    expect(notice).toBeGreaterThan(-1);
    expect(blockFrom(code, '{signsInWithProvider ? (', ') : (')).toMatch(/signsInWithBoth\s*\?\s*providerNotice\(/);
    expect(otherwise).toBeGreaterThan(notice);
    expect(row).toBeGreaterThan(otherwise);
    expect(drawer).toBeGreaterThan(row);
  });
});

describe('C-3 / C-11: closing a link-opened drawer (in the hook)', () => {
  /** The hook's close handler, from its declaration to its dependency list. */
  const handler = (() => {
    const start = hook.indexOf('const onOpenChange');
    const end = hook.indexOf('[router, pathname, searchParams]', start);
    return start > -1 && end > start ? hook.slice(start, end) : '';
  })();

  it('the handler is found', () => {
    expect(handler.length).toBeGreaterThan(0);
  });

  it('replaces the address without scrolling, through the section-only helper', () => {
    expect(handler).toMatch(REPLACE_NO_SCROLL);
    expect(handler).toContain('settingsUrlWithoutSection(pathname, searchParams)');
  });

  it('only when the link opened it, and clears the flag once used', () => {
    const gate = handler.indexOf('if (next || !openedByLink.current) return;');
    const clear = handler.indexOf('openedByLink.current = false');
    const replace = handler.indexOf('router.replace(');
    expect(gate).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(gate);
    expect(replace).toBeGreaterThan(clear);
  });

  it('the link opener marks the drawer before opening it, with no condition (W-3)', () => {
    const opener = blockFrom(hook, 'const openFromLink', '}, []);');
    const flag = opener.indexOf('openedByLink.current = true');
    const open = opener.indexOf('setOpen(true)');
    expect(flag).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(flag);
    expect(opener).not.toMatch(/\bif\s*\(/);
  });

  it('neither the page nor the hook pushes, writes `checkout` or hand-edits history', () => {
    for (const source of [code, hook]) {
      expect(source).not.toMatch(/router\.push\(/);
      expect(source).not.toMatch(/\.set\(\s*'checkout'/);
      expect(source).not.toMatch(/\.delete\(\s*'checkout'/);
      expect(source).not.toContain('window.history');
    }
  });

  it('the replace matcher is not vacuous', () => {
    expect('router.replace(settingsUrlWithoutSection(pathname, searchParams), { scroll: false });').toMatch(
      REPLACE_NO_SCROLL
    );
    expect('router.replace(settingsUrlWithoutSection(pathname, searchParams));').not.toMatch(REPLACE_NO_SCROLL);
  });
});
