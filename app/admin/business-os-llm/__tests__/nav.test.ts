/**
 * The nav entry — the only way in (D-U1).
 *
 * The user's decision, 2026-09-22: the sidebar is the navigation, and NO
 * cross-link is added to `app/admin/system-config/page.tsx`. That file carries
 * 20 `console.*` calls, and CLAUDE.md's logging rule binds files you touch —
 * so adding a one-line link there would pull a 2,000-line Pino conversion into
 * this feature's diff. If the link is ever wanted, that conversion comes first,
 * as its own commit.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('the screen is reachable from the admin sidebar', () => {
  const sidebar = read('app/admin/components/AdminSidebar.tsx');

  it('has exactly one entry pointing at the page', () => {
    expect(sidebar).toContain("href: '/admin/business-os-llm'");
    expect(sidebar.match(/\/admin\/business-os-llm/g)).toHaveLength(1);
  });

  /**
   * R-T16 / AC-22 / FR-12. The description said 'Models & Switches' and
   * NOTHING asserted it — so it would have shipped stale and green beside a
   * page that no longer mirrors the switch at all (the switch is runbook §4).
   *
   * ── RC-11: scoped to THIS entry ──────────────────────────────────────────
   * This file is a source scan over the whole sidebar, and ~20 other entries
   * carry descriptions of their own. A bare `toContain` would pass if the
   * string turned up on any of them, so the assertion is made in PROXIMITY to
   * the href, using the same `indexOf` + `slice` idiom the ordering test uses.
   */
  it('describes the page by what it now shows, next to the href it belongs to', () => {
    const oursAt = sidebar.indexOf("href: '/admin/business-os-llm'");
    expect(oursAt).toBeGreaterThan(-1);
    // The entry runs from its href to the start of the next one.
    const entry = sidebar.slice(oursAt, sidebar.indexOf("href: '", oursAt + 10));
    expect(entry).toContain("description: 'Models & temperatures'");
    // And the superseded string is gone from the file entirely.
    expect(sidebar).not.toContain('Models & Switches');
  });

  it('sits beside System Config, where an operator looks for configuration', () => {
    const systemConfigAt = sidebar.indexOf("href: '/admin/system-config'");
    const oursAt = sidebar.indexOf("href: '/admin/business-os-llm'");
    expect(systemConfigAt).toBeGreaterThan(-1);
    expect(oursAt).toBeGreaterThan(systemConfigAt);
    // Same group: no other section title intervenes.
    expect(sidebar.slice(systemConfigAt, oursAt)).not.toContain('title:');
  });

  it('the page it points at exists', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/admin/business-os-llm/page.tsx'))).toBe(true);
  });
});

describe('D-U1: System Config is left alone', () => {
  it('carries no link to this screen, and is therefore untouched', () => {
    expect(read('app/admin/system-config/page.tsx')).not.toContain('business-os-llm');
  });
});
