/**
 * The settings page's account card after the drawer moves (settings drawer
 * S-5: tidy the account card).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The page needs the auth, language, configuration and Supabase providers to
 * render, and what S-5 settles is a set of small, easily-undone choices:
 *
 *   - every row chevron mirrors in Hebrew (S-1 SA finding 4, S-4 O-2). Before
 *     S-5 only the invite row's did; a row added later with a hand-written
 *     class would quietly bring the mismatch back;
 *   - the plan row keeps `id="settings-section-plan"` (S-1 SA W-5);
 *   - the page fetches no row value of its own (C-8, tightened): the plan and
 *     consent drawers load their data when they open, and any page-load read
 *     belongs in its own effect through an existing route, never here by
 *     accident. Since C-a (C-5) the consent drawer's reads may start early
 *     through `useDrawerPrefetch` and the read module `marketingDrawerReads`,
 *     which names the route, so the page still never does
 *     (`consentPrefetch.guard.test.ts` pins that wiring). Since C-b (C-2) the
 *     plan drawer's read does the same through `planDrawerReads`
 *     (`planPrefetch.guard.test.ts`);
 *   - the two dead log-out helpers stay gone.
 *
 * Positive pins run on comment-stripped source, so a commented-out line cannot
 * satisfy them. The anchor id is JSX, so it is read from that same source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SETTINGS = 'app/business-os/settings/page.tsx';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const code = stripComments(read(SETTINGS));

describe('S-5: every account-card chevron mirrors in RTL', () => {
  it('the row chevron helper mirrors only when the page is right to left', () => {
    // The lookbehind rejects an inverted `!isRTL && …` (QA S-5 gap 1).
    expect(code).toMatch(/const rowChevron = [^\n]*=> cn\([^\n]*(?<![!\w])isRTL && 'scale-x-\[-1\]'\);/);
  });

  it('the Delete chevron keeps its red tone (QA S-5 gap 2)', () => {
    expect(code).toMatch(/<ChevronRight className=\{rowChevron\('text-red-400'\)\} aria-hidden="true" \/>/);
  });

  it('every ChevronRight on the page takes its class from the helper', () => {
    const chevrons = code.match(/<ChevronRight\b[^>]*\/>/g) ?? [];
    // Plan, consent, password, log out, delete. Invite and, since data export
    // DE-9, "Download my data" own their rows (and their mirrored chevrons).
    expect(chevrons.length).toBeGreaterThanOrEqual(5);
    for (const chevron of chevrons) {
      expect(chevron).toMatch(/className=\{rowChevron\(/);
      expect(chevron).toContain('aria-hidden="true"');
    }
  });

  it('the "Download my data" row, which owns its own chevron since DE-9, mirrors it', () => {
    expect(code).toMatch(/<DownloadMyDataButton variant="row" \/>/);
    // Export MX-3.1: the button always renders the module export entry, which
    // draws the row and must mirror the chevron (the ZIP control is gone).
    for (const file of ['components/business-os/data-export/ModuleExportEntry.tsx']) {
      const control = stripComments(read(file));
      expect(control).toMatch(/<ChevronRight[\s\S]*?(?<![!\w])isRTL && 'scale-x-\[-1\]'[\s\S]*?\/>/);
    }
    expect(stripComments(read('components/business-os/data-export/DownloadMyDataButton.tsx'))).toMatch(
      /<ModuleExportEntry/
    );
  });

  it('the invite row, which owns its own chevron, keeps its mirror', () => {
    const invite = stripComments(read('components/business-os/settings/InviteFriendsSection.tsx'));
    expect(invite).toMatch(/<ChevronRight[\s\S]*?(?<![!\w])isRTL && 'scale-x-\[-1\]'[\s\S]*?\/>/);
  });
});

describe('S-5: the plan anchor stays (SA W-5)', () => {
  it('the plan row keeps id="settings-section-plan" around its drawer opener', () => {
    const anchor = code.indexOf('id="settings-section-plan"');
    expect(anchor).toBeGreaterThan(-1);
    const opener = code.indexOf('onClick={planDrawer.openFromRow}', anchor);
    expect(opener).toBeGreaterThan(anchor);
  });
});

describe('S-5 / C-8: no row-value request from the page', () => {
  it.each(['/api/business-os/entitlements/my-plan', '/api/business-os/consent-settings'])(
    "the page does not call %s (only the drawers' read modules name it)",
    (route) => {
      expect(code).not.toContain(route);
    }
  );
});

describe('S-5: dead log-out helpers stay removed', () => {
  it.each(['withDeadline', 'clearSessionKeys'])('%s is not defined on the page', (name) => {
    expect(code).not.toMatch(new RegExp(`\\b${name}\\b`));
  });
});
