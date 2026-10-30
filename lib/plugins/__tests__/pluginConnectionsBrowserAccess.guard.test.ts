/**
 * Browser access guard for `plugin_connections` (data export DE-0a,
 * BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.1.3 A-5).
 *
 * The table holds every connected plugin's `access_token` and `refresh_token`.
 * Three settings screens read it with `select('*')` from the browser to build
 * the data export file, so the tokens were in the download. DE-0a moved those
 * three to the server export; DE-0b revokes the token columns from the browser
 * role. Until then — and after, so nobody builds the next one — this guard
 * fails on any NEW browser-side `.from('plugin_connections')`.
 *
 * A "browser file" starts with `'use client'` OR imports `supabaseClient` (the
 * anon-key browser client). The second half matters: a hook or class with no
 * banner still runs in the browser when it uses that client (C7, C11).
 *
 * ALLOWED_FILES is FROZEN: today's remaining sites, all DE-0b's to shrink. It
 * can only get shorter — an allow-listed file that no longer makes the call
 * fails too, so the entry is removed in the same PR that removed the call.
 * Adding an entry needs SA review.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'components', 'hooks', 'lib'];
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * The remaining browser sites after DE-0b-prep (§0.1.2 C5–C11), with why. C4
 * (`app/v2/settings/page.tsx`) was deleted in DE-0b.
 */
const ALLOWED_FILES: Record<string, string> = {
  'app/(protected)/settings/page.tsx': 'C5: feeds PluginsTab; narrowed in DE-0b to granted non-token columns',
  'components/settings/PluginsTab.tsx': 'C6: UPDATE status/disconnected_at only; covered by the DE-0b column grant',
  'components/dashboard/AgentSandBox/useAgentSandbox.ts': 'C7: reads plugin_key only; covered by the DE-0b column grant',
  'components/onboarding/PluginsStep.tsx': 'C8: reads plugin_key only; dead code (Onboarding_old.tsx only)',
  'components/wizard/hooks/useWorkflowData.ts': 'C9: dead code (AgentWizard imported only by a .tsxold); fails closed after DE-0b',
  'components/orchestration-NOT-USED/components/configuration/PluginConnectionManager.tsx':
    'C10: dead code; fails closed after DE-0b',
  'lib/plugins/v2/core/UniversalOAuthHandler.ts': 'C11: dead code (plugins/v2/registry imported nowhere); fails closed after DE-0b',
};

/**
 * The three export screens DE-0a moved to the server export (C1–C3). Since
 * data export DE-9 none has an export handler of its own: each renders the one
 * shared `DownloadMyDataButton`, which reaches the server only through
 * lib/client/businessOsDataExport.ts.
 */
const EXPORT_SCREENS = [
  'app/business-os/settings/page.tsx',
  'components/settings/SecurityTab.tsx',
  'components/v2/settings/SecurityTabV2.tsx',
];

const PLUGIN_CONNECTIONS_FROM = /\.from\(\s*(['"`])plugin_connections\1/;
const SUPABASE_CLIENT_IMPORT =
  /(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)(['"`])(?:@\/lib\/|(?:\.\.?\/)+(?:lib\/)?)supabaseClient(?:\.[jt]sx?)?\1/;

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (CODE_FILE.test(name) && !/\.(test|spec)\.[jt]sx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Block comments and whole-line `//` comments removed; strings kept. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Runs in the browser: a `'use client'` banner or the browser Supabase client. */
export function isBrowserSource(source: string): boolean {
  const code = withoutComments(source).replace(/^﻿/, '');
  if (/^\s*(['"])use client\1/.test(code)) return true;
  return SUPABASE_CLIENT_IMPORT.test(code);
}

export function readsPluginConnections(source: string): boolean {
  return PLUGIN_CONNECTIONS_FROM.test(withoutComments(source));
}

const rel = (full: string) => relative(ROOT, full).split(sep).join('/');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

describe('plugin_connections browser access guard (DE-0a A-5)', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).map(rel);

  it('the detector flags a use-client file and a supabaseClient-only file (negative control)', () => {
    const banner = `'use client'\nimport { x } from 'y'\nconst r = await supabase.from('plugin_connections').select('*')\n`;
    expect(isBrowserSource(banner)).toBe(true);
    expect(readsPluginConnections(banner)).toBe(true);

    const clientOnly = `import { supabase } from '@/lib/supabaseClient'\nexport async function f() {\n  return supabase\n    .from("plugin_connections")\n    .select('plugin_key')\n}\n`;
    expect(isBrowserSource(clientOnly)).toBe(true);
    expect(readsPluginConnections(clientOnly)).toBe(true);

    const relativeClient = `import { supabase } from '../supabaseClient'\n`;
    expect(isBrowserSource(relativeClient)).toBe(true);

    // Server code and comments are not browser reads.
    const server = `import { supabaseServer } from '@/lib/supabaseServer'\nsupabaseServer.from('plugin_connections').select('id')\n`;
    expect(isBrowserSource(server)).toBe(false);
    const commented = `'use client'\n// supabase.from('plugin_connections')\n/* .from('plugin_connections') */\n`;
    expect(readsPluginConnections(commented)).toBe(false);
  });

  it('the scan sees the tree (sanity)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(EXPORT_SCREENS[0]);
  });

  it('no browser file outside the frozen allow-list reads plugin_connections', () => {
    const offenders = files.filter((f) => {
      if (ALLOWED_FILES[f]) return false;
      const source = read(f);
      return isBrowserSource(source) && readsPluginConnections(source);
    });
    expect(offenders).toEqual([]);
  });

  it('the allow-list only shrinks: every entry still makes the call', () => {
    const stale = Object.keys(ALLOWED_FILES).filter((f) => {
      if (!files.includes(f)) return true;
      const source = read(f);
      return !(isBrowserSource(source) && readsPluginConnections(source));
    });
    // Remove a stale entry from ALLOWED_FILES in the PR that removed the call.
    expect(stale).toEqual([]);
    expect(Object.keys(ALLOWED_FILES).length).toBeLessThanOrEqual(7);
  });

  it('C5 reads only the PluginsTab columns, never * or a token column (DE-0b)', () => {
    const code = withoutComments(read('app/(protected)/settings/page.tsx'));
    const columns = code.match(/const PLUGINS_TAB_COLUMNS\s*=\s*'([^']*)'/);
    expect(columns).not.toBeNull();
    expect(columns![1].split(',').map((c) => c.trim())).toEqual([
      'id', 'plugin_key', 'plugin_name', 'username', 'email', 'status', 'connected_at', 'last_used',
    ]);
    expect(code).toMatch(/\.from\('plugin_connections'\)\.select\(PLUGINS_TAB_COLUMNS\)/);
    expect(code).not.toMatch(/access_token|refresh_token|profile_data/);
  });

  it('C4 is gone: the v2 settings page no longer names plugin_connections (DE-0b)', () => {
    expect(withoutComments(read('app/v2/settings/page.tsx'))).not.toMatch(/plugin_connections/);
  });

  describe.each(EXPORT_SCREENS)('%s', (file) => {
    const source = read(file);
    const code = withoutComments(source);

    it('does not name plugin_connections in code', () => {
      expect(code).not.toMatch(/plugin_connections/);
    });

    it('exports through the one shared control, with no export handler of its own (DE-9)', () => {
      expect(code).toMatch(/import \{ DownloadMyDataButton \} from '@\/components\/business-os\/data-export\/DownloadMyDataButton'/);
      expect(code).toMatch(/<DownloadMyDataButton\b/);
      expect(code).not.toMatch(/handleExportData/);
      expect(code).not.toMatch(/downloadUserDataExport/);
    });

    it('sends no x-user-id header', () => {
      expect(code).not.toMatch(/['"`]x-user-id['"`]\s*:/);
    });
  });

  it('the shared export control makes no client audit call and reads no table (DE-9)', () => {
    // The server export writes its DATA_EXPORT_* entries itself (§0.1.2 C3).
    for (const file of [
      'components/business-os/data-export/DownloadMyDataButton.tsx',
      // MX-3.1 (2026-10-30): re-pointed from the deleted ZIP hook to the drawer files that drive the export.
      'components/business-os/data-export/useExportDrawer.ts',
      'components/business-os/data-export/ModuleExportEntry.tsx',
      'lib/client/businessOsDataExport.ts',
    ]) {
      const code = withoutComments(read(file));
      expect({ file, audit: /\/api\/audit\/log/.test(code) }).toEqual({ file, audit: false });
      expect({ file, table: /\.from\(|\bsupabase\b|plugin_connections/.test(code) }).toEqual({ file, table: false });
      expect({ file, xUserId: /['"`]x-user-id['"`]\s*:/.test(code) }).toEqual({ file, xUserId: false });
    }
  });
});
