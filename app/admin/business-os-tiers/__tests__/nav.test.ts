/**
 * The nav entry — and the separation it has to preserve.
 *
 * The user asked for this page **because** the agent platform's free tier lives
 * on `/admin/onboarding`, and he did not want the two products confused. The
 * sidebar is where that confusion would start, so the entry says "Business OS"
 * in its description, sits under Businesses (slice 1 of the admin
 * reorganisation), and the onboarding entry still points where it did.
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

  /**
   * Admin reorganisation, slice 1 (ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT
   * §4.2): the entry is renamed "Plans & entitlements" and moves to the
   * Businesses section. The product name moves from the label to the
   * description, so the entry as a whole still says "Business OS" and cannot
   * be mistaken for the AgentsPilot free tier.
   */
  it('names the product, so it cannot be mistaken for the agent platform tier', () => {
    const hrefAt = sidebar.indexOf("href: '/admin/business-os-tiers'");
    const nameAt = sidebar.lastIndexOf("name: '", hrefAt);
    // The entry runs from its name to the start of the next one.
    const entry = sidebar.slice(nameAt, sidebar.indexOf("name: '", hrefAt));
    expect(entry).toContain("name: 'Plans & entitlements'");
    expect(entry).toMatch(/description: '[^']*Business OS[^']*'/);
  });

  it('sits in the Businesses section, apart from the free-tier settings', () => {
    const businessesAt = sidebar.indexOf("title: 'Businesses'");
    const oursAt = sidebar.indexOf("href: '/admin/business-os-tiers'");
    const onboardingAt = sidebar.indexOf("href: '/admin/onboarding'");

    expect(businessesAt).toBeGreaterThan(-1);
    expect(oursAt).toBeGreaterThan(businessesAt);
    // Same group: no section title intervenes.
    expect(sidebar.slice(businessesAt + 1, oursAt)).not.toContain('title:');
    // The agent platform's free tier is in a different section.
    expect(sidebar.slice(oursAt, onboardingAt)).toContain('title:');
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
