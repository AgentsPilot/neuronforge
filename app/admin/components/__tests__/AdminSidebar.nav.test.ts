/**
 * Admin sidebar IA: slice 1 of ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md.
 *
 * Pins three things the slice promises:
 *   1. the section order (Monitor, Businesses, Settings, AgentsPilot (parked));
 *   2. every admin page on disk (except Exchange Rates) is reachable from
 *      exactly one sidebar entry, and no entry points at a page that is not
 *      there. The page list is read from the filesystem, so a new admin page
 *      fails this test until it is given a place in the sidebar;
 *   3. the hardcoded status footer is gone and nothing else claims status;
 *   4. the parked AgentsPilot section is kept in the data but hidden, so it
 *      takes no sidebar space while every one of its routes still works by URL;
 *   5. (slice 4) `/admin` is the Health landing, and the old dashboard moved to
 *      `/admin/platform-dashboard`, listed only in the hidden parked section
 *      (URL-only, user decision U-6);
 *   6. (slice 5) Scheduled jobs & queues is third under Monitor;
 *   7. (ADMIN_BOS_CLEANUP slice 2) Model pricing is split from the AgentsPilot
 *      billing settings, which moved to a parked page, and Free tier &
 *      onboarding moved to the parked section;
 *   8. (Money M-5, finance health §11H.3) a Money section follows Monitor,
 *      holding Finance (first), Charge checks and AI calls & usage (detail),
 *      and nothing with action buttons;
 *   9. (M-5) Charge checks lives at a NESTED route, `/admin/finance/charges`,
 *      which the one-level page scan cannot see, so it is allowed for
 *      explicitly (`NESTED_LISTED`) and checked to exist on disk;
 *  10. (Money M-8, finance health §11J, BD-34) the old dashboard is redundant:
 *      its hidden parked item is removed and it joins Exchange Rates in
 *      `UNLISTED`. Both pages stay on disk (the on-disk scan still finds them).
 *
 * Source scan, like the per-page nav tests: the component is a client
 * component importing next/image and framer-motion, and the navigation lives
 * in a literal inside it, so reading the literal is the lightest honest check.
 */

import * as fs from 'fs';
import * as path from 'path';

const ADMIN_DIR = path.join(process.cwd(), 'app/admin');
const sidebar = fs.readFileSync(path.join(ADMIN_DIR, 'components/AdminSidebar.tsx'), 'utf8');

/** The `navigationSections` literal, and nothing after it (the JSX). */
const navBlock = (() => {
  const start = sidebar.indexOf('const navigationSections');
  const end = sidebar.indexOf('export default function AdminSidebar');
  if (start < 0 || end < 0) throw new Error('navigationSections literal not found');
  return sidebar.slice(start, end);
})();

interface ParsedItem {
  name: string;
  href: string;
  description: string;
}
interface ParsedSection {
  title: string;
  hidden: boolean;
  items: ParsedItem[];
}

const sections: ParsedSection[] = navBlock
  .split(/title: '/)
  .slice(1)
  .map((chunk) => {
    const title = chunk.slice(0, chunk.indexOf("'"));
    const items: ParsedItem[] = [];
    const itemRe = /name: '([^']+)',\s*href: '([^']+)',[\s\S]*?description: '([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(chunk)) !== null) {
      items.push({ name: m[1], href: m[2], description: m[3] });
    }
    const hidden = /^[^']*',\s*hidden: true,/.test(chunk);
    return { title, hidden, items };
  });

const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));
const hrefsOf = (title: string) =>
  sections.find((s) => s.title === title)?.items.map((i) => i.href) ?? [];

/** Every `app/admin/<dir>/page.tsx`, plus `app/admin/page.tsx`, as a route. */
const adminPageRoutes = (): string[] => {
  const routes = fs.existsSync(path.join(ADMIN_DIR, 'page.tsx')) ? ['/admin'] : [];
  for (const entry of fs.readdirSync(ADMIN_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(ADMIN_DIR, entry.name, 'page.tsx'))) {
      routes.push(`/admin/${entry.name}`);
    }
  }
  return routes.sort();
};

// Unlisted on purpose (requirement §4.3): it writes from the browser straight
// to the database, so surfacing it would widen exposure. Money M-8 (BD-34): the
// redundant old dashboard is unlisted too; both routes are kept.
const UNLISTED = ['/admin/exchange-rates', '/admin/platform-dashboard'];

// Listed pages below the one-level scan (M-5): each must exist on disk.
const NESTED_LISTED = ['/admin/finance/charges'];

describe('section order', () => {
  it('is Monitor, Money, Businesses, Settings, AgentsPilot (parked)', () => {
    expect(sections.map((s) => s.title)).toEqual([
      'Monitor',
      'Money',
      'Businesses',
      'Settings',
      'AgentsPilot (parked)',
    ]);
  });

  it('puts the pages the requirement names in the first three sections', () => {
    // Scheduled jobs & queues follows AI cost & usage (slice 5, requirement
    // §4.2); Archiving sits directly under Audit trail (Admin Archiving,
    // condition C-2); Finance sits directly after Health (finance & business
    // health slice 1a, requirement §5). Money M-5 moved Finance and AI calls &
    // usage (detail) into the new Money section, Finance first (BD-21).
    expect(hrefsOf('Monitor')).toEqual([
      '/admin',
      '/admin/jobs-queues',
      '/admin/audit-trail',
      '/admin/archiving',
    ]);
    expect(hrefsOf('Money')).toEqual([
      '/admin/finance',
      // Money MK-4 (ruled): Subscriptions is now Finance's Plans & subscriptions tab; its item is gone.
      '/admin/finance/charges',
      '/admin/analytics',
    ]);
    expect(hrefsOf('Businesses')).toEqual([
      '/admin/users',
      '/admin/business-os-tiers',
      '/admin/business-os-invites',
      '/admin/messages',
    ]);
    expect(hrefsOf('Settings')).toEqual([
      '/admin/business-os-llm',
      '/admin/system-config',
      '/admin/settings',
    ]);
  });

  it('parks the fourteen AgentsPilot pages; the redundant legacy dashboard is no longer listed (M-8, BD-34)', () => {
    expect(hrefsOf('AgentsPilot (parked)')).toHaveLength(14);
    expect(hrefsOf('AgentsPilot (parked)')).not.toContain('/admin/platform-dashboard');
    // ADMIN_BOS_CLEANUP slice 2: the free tier and the AgentsPilot billing page.
    expect(hrefsOf('AgentsPilot (parked)')).toContain('/admin/onboarding');
    expect(hrefsOf('AgentsPilot (parked)')).toContain('/admin/agentspilot-billing');
  });

  it('the landing entry is Health (slice 4)', () => {
    const landing = sections.flatMap((s) => s.items).find((i) => i.href === '/admin');
    expect(landing?.name).toBe('Health');
  });
});

describe('every admin page is reachable, exactly once', () => {
  const onDisk = adminPageRoutes();

  it('found the admin pages on disk (guards the scan itself)', () => {
    // 27 pages: slice 4 moved the legacy dashboard to its own route, Admin
    // Archiving slice 1 added /admin/archiving, slice 5 added
    // /admin/jobs-queues, and invite-only signup slice 0 added
    // /admin/business-os-invites. 28 since ADMIN_BOS_CLEANUP slice 2 added
    // /admin/agentspilot-billing. 29 since finance & business health slice 1a
    // added /admin/finance. 30 since plan payments P-8a.1 added
    // /admin/subscriptions. If this drops, the scan broke rather than the
    // sidebar.
    // Money MK-4 (ruled): /admin/subscriptions left the disk (it redirects to Finance's tab), so 29.
    expect(onDisk.length).toBeGreaterThanOrEqual(29);
    expect(onDisk).toContain('/admin/finance');
    expect(onDisk).not.toContain('/admin/subscriptions');
    expect(onDisk).toContain('/admin/agentspilot-billing');
    expect(onDisk).toContain('/admin/onboarding');
    expect(onDisk).toContain('/admin/business-os-invites');
    expect(onDisk).toContain('/admin/archiving');
    expect(onDisk).toContain('/admin/jobs-queues');
    expect(onDisk).toContain('/admin/platform-dashboard');
    expect(onDisk).toContain('/admin');
    expect(onDisk).toContain('/admin/exchange-rates');
  });

  it('lists every page except the deliberately unlisted ones', () => {
    const expected = [...onDisk.filter((r) => !UNLISTED.includes(r)), ...NESTED_LISTED].sort();
    expect([...allHrefs].sort()).toEqual(expected);
    // 22 before, + the legacy dashboard (slice 4) + Archiving (Admin Archiving
    // slice 1) + Scheduled jobs & queues (slice 5) + Invites (invite-only
    // signup slice 0) + AgentsPilot billing (ADMIN_BOS_CLEANUP slice 2) +
    // Finance (finance & business health slice 1a) + Charge checks (M-5)
    // − the redundant legacy dashboard (M-8, BD-34) + Subscriptions (plan
    // payments P-8a.1) − Subscriptions (Money MK-4: a Finance tab now).
    expect(allHrefs).toHaveLength(28);
  });

  it('every nested listed page exists on disk (M-5)', () => {
    for (const route of NESTED_LISTED) {
      expect({ route, exists: fs.existsSync(path.join(process.cwd(), 'app', `${route.slice(1)}/page.tsx`)) }).toEqual({ route, exists: true });
    }
  });

  it('never lists the same page twice', () => {
    expect(new Set(allHrefs).size).toBe(allHrefs.length);
  });

  it('keeps Exchange Rates unlisted', () => {
    expect(sidebar).not.toContain('exchange-rates');
  });

  it('keeps the redundant Platform dashboard unlisted (M-8, BD-34)', () => {
    expect(sidebar).not.toContain('platform-dashboard');
  });

  it('parsed every item (guards the parser: one href literal per parsed item)', () => {
    expect(navBlock.match(/href: '/g)).toHaveLength(allHrefs.length);
  });
});

describe('labels are honest', () => {
  it('every parked item says it is AgentsPilot', () => {
    const parked = sections.find((s) => s.title === 'AgentsPilot (parked)')?.items ?? [];
    expect(parked.length).toBeGreaterThan(0);
    for (const item of parked) {
      expect(item.description).toContain('AgentsPilot');
    }
  });

  it('the agent execution queue is no longer called "Queue Monitor"', () => {
    expect(sidebar).not.toContain('Queue Monitor');
    const queue = sections.flatMap((s) => s.items).find((i) => i.href === '/admin/queues');
    expect(queue?.name).toBe('Agent execution queue');
  });

  it('the account list is called "Businesses" now that each row shows its business (slice 2b)', () => {
    const item = sections.flatMap((s) => s.items).find((i) => i.href === '/admin/users');
    expect(item?.name).toBe('Businesses');
    expect(item?.description).toContain('Business OS');
  });

  it('the invite page is called "Signup Invites" (Slice 1a), and its route is unchanged', () => {
    const item = sections.flatMap((s) => s.items).find((i) => i.href === '/admin/business-os-invites');
    expect(item?.name).toBe('Signup Invites');
    expect(item?.description).toBe('Business OS invite links');
  });

  it('Model pricing is named for the one table it holds, and sits in Settings (ADMIN_BOS_CLEANUP slice 2)', () => {
    const item = sections.find((s) => s.title === 'Settings')?.items.find((i) => i.href === '/admin/system-config');
    expect(item?.name).toBe('Model pricing');
    expect(item?.description).toContain('Business OS');
  });

  it('Plans & entitlements says the Business OS trial lives there (FR-FT2)', () => {
    const item = sections.flatMap((s) => s.items).find((i) => i.name === 'Plans & entitlements');
    expect(item?.description).toContain('trial');
  });

  it('Free tier & onboarding is parked and names AgentsPilot (FR-FT1)', () => {
    const item = sections
      .find((s) => s.title === 'AgentsPilot (parked)')
      ?.items.find((i) => i.href === '/admin/onboarding');
    expect(item?.description).toContain('AgentsPilot');
  });

  it('item names are unique (they are the React keys)', () => {
    const names = sections.flatMap((s) => s.items.map((i) => i.name));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the hardcoded status footer is gone', () => {
  it('no "System Status" block and no API / Queue / DB rows', () => {
    expect(sidebar).not.toContain('System Status');
    expect(sidebar).not.toMatch(/>\s*(API|Queue|DB)\s*</);
  });

  it('nothing in the sidebar claims a status of OK', () => {
    expect(sidebar).not.toMatch(/\bOK\b/);
  });
});

describe('the parked AgentsPilot section is hidden, not removed', () => {
  it('only the parked section carries hidden: true', () => {
    expect(sections.filter((s) => s.hidden).map((s) => s.title)).toEqual(['AgentsPilot (parked)']);
    expect(navBlock.match(/hidden: true/g)).toHaveLength(1);
  });

  it('keeps all fourteen parked items in the data (routes are untouched; M-8 removed only the redundant dashboard item)', () => {
    expect(hrefsOf('AgentsPilot (parked)')).toHaveLength(14);
  });

  it('renders only the visible sections, and draws separators between those alone', () => {
    expect(sidebar).toContain('navigationSections.filter((section) => !section.hidden)');
    expect(sidebar).toContain('visibleSections.map((section, sectionIndex)');
    expect(sidebar).toContain('sectionIndex < visibleSections.length - 1');
    // No render path iterates the unfiltered list.
    expect(sidebar).not.toContain('navigationSections.map(');
  });
});

describe('slice 5: Scheduled jobs & queues', () => {
  it('is a visible Monitor entry, never says "OK", and its page is a client component', () => {
    const item = sections.find((s) => s.title === 'Monitor')?.items.find((i) => i.href === '/admin/jobs-queues');
    expect(item?.name).toBe('Scheduled jobs & queues');
    expect(item?.description).not.toMatch(/\bOK\b/);
    const page = fs.readFileSync(path.join(ADMIN_DIR, 'jobs-queues/page.tsx'), 'utf8');
    expect(page.trimStart().startsWith("'use client'")).toBe(true);
  });
});

describe('the logo matches the Business OS app (admin header identity)', () => {
  it('uses the shared Logo on its always-dark surface, not the legacy PNG', () => {
    expect(sidebar).toContain("import { Logo } from '@/components/brand/Logo'");
    expect(sidebar).toMatch(/<Logo\b[^>]*surface="dark"/);
    expect(sidebar).not.toContain('AgentPilot_Logo.png');
  });

  it('keeps the Admin badge beside the logo', () => {
    expect(sidebar).toMatch(/<Logo\b[^>]*\/>\s*<span[^>]*>\s*Admin\s*<\/span>/);
  });
});

describe('Money M-5: the Money section (finance health §11H.3)', () => {
  const money = () => sections.find((s) => s.title === 'Money')?.items ?? [];

  it('sits directly after Monitor and is visible', () => {
    const titles = sections.map((s) => s.title);
    expect(titles.indexOf('Money')).toBe(titles.indexOf('Monitor') + 1);
    expect(sections.find((s) => s.title === 'Money')?.hidden).toBe(false);
  });

  // Money MK-4 (ruled): the Subscriptions item is gone; its content is Finance's Plans & subscriptions tab.
  it('Finance first, then Charge checks, then AI calls & usage (detail), with their words (S-1 to S-3, AC-184)', () => {
    expect(money().map((i) => [i.name, i.href, i.description])).toEqual([
      ['Finance', '/admin/finance', 'Revenue, AI cost and credits, Business OS'],
      ['Charge checks', '/admin/finance/charges', 'Charged AI cost checked per account, Business OS'],
      ['AI calls & usage (detail)', '/admin/analytics', 'Every AI call and its recorded cost, both products'],
    ]);
  });

  it('holds no page whose main job is an action (AC-185, BD-21)', () => {
    const hrefs = money().map((i) => i.href);
    for (const action of ['/admin/users', '/admin/system-config', '/admin/jobs-queues', '/admin/business-os-invites']) {
      expect(hrefs).not.toContain(action);
    }
  });

  it('Business OS AI no longer claims costs (S-4, AC-186)', () => {
    const item = sections.flatMap((s) => s.items).find((i) => i.name === 'Business OS AI');
    expect(item?.description).toBe('Models, temperatures & AI activity');
    expect(item?.description.toLowerCase()).not.toContain('cost');
  });

  it('the old name "AI cost & usage" is gone from the sidebar', () => {
    expect(sections.flatMap((s) => s.items).map((i) => i.name)).not.toContain('AI cost & usage');
  });
});
