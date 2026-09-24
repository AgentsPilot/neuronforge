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
