/**
 * Admin sidebar IA: slice 1 of ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md.
 *
 * Pins three things the slice promises:
 *   1. the section order (Monitor, Businesses, Settings, AgentsPilot (parked));
 *   2. every admin page on disk (except Exchange Rates) is reachable from
 *      exactly one sidebar entry, and no entry points at a page that is not
 *      there. The page list is read from the filesystem, so a new admin page
 *      fails this test until it is given a place in the sidebar;
 *   3. the hardcoded status footer is gone and nothing else claims status.
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
    return { title, items };
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
// to the database, so surfacing it would widen exposure.
const UNLISTED = ['/admin/exchange-rates'];

describe('section order', () => {
  it('is Monitor, Businesses, Settings, AgentsPilot (parked)', () => {
    expect(sections.map((s) => s.title)).toEqual([
      'Monitor',
      'Businesses',
      'Settings',
      'AgentsPilot (parked)',
    ]);
  });

  it('puts the pages the requirement names in the first three sections', () => {
    expect(hrefsOf('Monitor')).toEqual(['/admin', '/admin/analytics', '/admin/audit-trail']);
    expect(hrefsOf('Businesses')).toEqual([
      '/admin/users',
      '/admin/business-os-tiers',
      '/admin/messages',
    ]);
    expect(hrefsOf('Settings')).toEqual([
      '/admin/business-os-llm',
      '/admin/system-config',
      '/admin/onboarding',
      '/admin/settings',
    ]);
  });

  it('parks the other twelve AgentsPilot pages', () => {
    expect(hrefsOf('AgentsPilot (parked)')).toHaveLength(12);
  });
});

describe('every admin page is reachable, exactly once', () => {
  const onDisk = adminPageRoutes();

  it('found the admin pages on disk (guards the scan itself)', () => {
    // 23 pages today. If this drops, the scan broke rather than the sidebar.
    expect(onDisk.length).toBeGreaterThanOrEqual(23);
    expect(onDisk).toContain('/admin');
    expect(onDisk).toContain('/admin/exchange-rates');
  });

  it('lists every page except the deliberately unlisted ones', () => {
    const expected = onDisk.filter((r) => !UNLISTED.includes(r));
    expect([...allHrefs].sort()).toEqual(expected);
    expect(allHrefs).toHaveLength(22);
  });

  it('never lists the same page twice', () => {
    expect(new Set(allHrefs).size).toBe(allHrefs.length);
  });

  it('keeps Exchange Rates unlisted', () => {
    expect(sidebar).not.toContain('exchange-rates');
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
