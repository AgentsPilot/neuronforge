/**
 * The nav entry — and the separation it has to preserve.
 *
 * The user asked for this page **because** the agent platform's free tier lives
 * on `/admin/onboarding`, and he did not want the two products confused. The
 * sidebar is where that confusion would start, so the entry says "Business OS"
 * in its name, sits with the other Business OS screen, and the onboarding entry
 * is left exactly as it was.
 */

import * as fs from 'fs';
import * as path from 'path';

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('the screen is reachable from the admin sidebar', () => {
  const sidebar = read('app/admin/components/AdminSidebar.tsx');

  it('has exactly one entry pointing at the page', () => {
    expect(sidebar).toContain("href: '/admin/business-os-tiers'");
    expect(sidebar.match(/\/admin\/business-os-tiers/g)).toHaveLength(1);
  });

  it('names the product, so it cannot be mistaken for the agent platform tier', () => {
    const entry = sidebar.slice(sidebar.indexOf("name: 'Business OS Tiers'"), sidebar.indexOf("href: '/admin/business-os-tiers'") + 60);
    expect(entry).toContain('Business OS');
  });

  it('sits beside the other Business OS screen', () => {
    const llmAt = sidebar.indexOf("href: '/admin/business-os-llm'");
    const oursAt = sidebar.indexOf("href: '/admin/business-os-tiers'");

    expect(llmAt).toBeGreaterThan(-1);
    expect(oursAt).toBeGreaterThan(llmAt);
    // Same group: no section title intervenes.
    expect(sidebar.slice(llmAt, oursAt)).not.toContain('title:');
  });

  it('the page it points at exists', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/admin/business-os-tiers/page.tsx'))).toBe(true);
  });
});

describe('the agent platform page is left alone', () => {
  it('the onboarding entry still points where it did', () => {
    const sidebar = read('app/admin/components/AdminSidebar.tsx');
    expect(sidebar).toContain("href: '/admin/onboarding'");
  });

  it('nothing was added to the onboarding page', () => {
    // A cross-link there would be the first step towards one screen for two
    // products — and that file carries `console.*` calls, so touching it would
    // pull a logging conversion into this feature's diff.
    const onboarding = read('app/admin/onboarding/page.tsx');
    expect(onboarding).not.toContain('business-os-tiers');
  });
});
